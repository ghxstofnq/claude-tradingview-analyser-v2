# Walker Engine + CLAUDE.md Slim — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans next to create the implementation plan.

**Goal:** Port the ghxstofnq/tradingview-mcp-ict walker-engine pattern for Pillar 3 + confirmation so the LLM is removed from the entry decision, with seven upgrades over the original. Separately, slim CLAUDE.md to match their shape.

**Architecture:** Three sub-projects, one spec, three PRs.

- **PR0 — ICT Engine V2 migration.** Update `cli/lib/ict-engine-parser.js` to parse V2's schema. Refresh fixtures. Document V2 row/field differences. Prerequisite for PR1 since the walker reads `gates.engine.*`.
- **PR1 — Walker engine.** Pure-JS state machine in `app/main/walker/`. Bar-close detector + backtest engine call `walkerTick({prev, gates, bars, rules, calendar, memory, history})` on every closed 1m bar (and 5m on 5m boundaries). Engine decides MSS/Trend/Inversion mechanically; Claude no longer runs during entry-hunt. ACCEPT/REJECT UI + trade tracking unchanged. **Depends on PR0.**
- **PR2 — CLAUDE.md slim.** Content relocation. Architecture-decisions table → `docs/decisions-log.md`. Recipes (analyze/session/dash/judge) → `docs/recipes/*.md`. Hard constraints + layout + project rules stay inline. Result: ~130 lines. **Independent of PR0/PR1.**

**Tech stack:** Node ES modules, `node --test` for unit tests, existing Electron main process, existing ICT Engine indicator output (`gates.engine.*`), existing per-session state-file pattern.

---

## PR0 — ICT Engine V2 migration

### Why

V2 is the current version of the ICT Engine Pine indicator. V1 is what our parser understands today; V2 has a different schema and our `ict-engine-parser.js` silently drops V2 rows. The webview migration log (2026-05-28) noted this gap and pinned us to V1. The walker engine reads `gates.engine.*` heavily, so any V1/V2 drift would land as walker bugs. Get the parser onto V2 first; build the walker on top.

### Scope

- Inspect V2's emit schema (rows, fields, types) against V1's. Capture the diff in `docs/research/ict-engine-v2-schema.md`.
- Update `cli/lib/ict-engine-parser.js` to recognize V2's row markers, parse new/renamed fields, coerce types correctly.
- Update `cli/lib/compute-engine-gates.js` only where V2 changes the shape the gates consumer sees. Keep gate output backward-compatible where possible; surface new fields where V2 exposes them.
- Bump `gates.engine.meta.schema` to `2` so downstream code can branch on schema if needed.
- Refresh `tests/fixtures/*.bundle.json` fixtures by re-running `./bin/tv analyze --out` against a V2-loaded chart. The hand-graded `expected.md` files stay valid as long as the cited paths still resolve.
- Update `scripts/verify-citations.js` if any cited path changed shape.
- Document the V2 schema in CLAUDE.md's analyze recipe (or `docs/recipes/analyze.md` after PR2).

### Out of scope for PR0

- Walker engine — that's PR1.
- Re-grading fixtures whose verdict changed because V2 surfaces new evidence — flag for separate review, don't change `expected.md` files quietly.

### Risks

| Risk | Mitigation |
|---|---|
| V2 introduces fields the bundle consumers (`compute-engine-gates.js`, brief turn, `data_get_pine_*` paths) silently rely on at V1 positions | Run smoke fixtures + a manual `tv analyze` after parser update; diff bundle shape vs pre-migration baseline. |
| V2 emit timing/cadence differs from V1 | Add timing assertions in the parser; flag stale emit in `gates.engine.meta.stale`. |
| User's TradingView chart still has V1 loaded after PR0 ships | Document chart-side step in CLAUDE.md: "User must swap V1 for V2 in TradingView before next session." |

### Validation

- `npm run smoke:fixtures` passes with refreshed fixtures
- `./bin/tv analyze --out state/last-analyze.json` against a V2-loaded chart produces a bundle whose `engine.meta.schema === 2` and whose `levels[]`, `fvgs[]`, `structures[]`, `quality` are all populated
- Brief turn runs end-to-end without errors against the V2 bundle (manual smoke)

---

## PR1 — Walker engine

### Why

We observe ghxstofnq/tradingview-mcp-ict's walker engine produces more accurate Pillar 3 + confirmation than our LLM-driven approach. Our system hands Claude a pre-computed `gates` bundle and asks it to reason MSS vs Trend vs Inversion every minute on bar close. Despite helpers (`entry_model_priority` resolver, `fvgs_ranked` sort, `brief_digest`), Claude still drifts. Theirs runs a deterministic state machine in JS; Claude orchestrates but doesn't decide. Removing the LLM from the critical Pillar 3 path eliminates the drift class entirely.

### Module layout

```
app/main/walker/
  walker-engine.js         tickWalkers({prev, gates, bars, rules, ...}) -> {next, triggers}
  walker-stages.js         stage definitions per model
  walker-spawn.js          detectIgnitions(gates, bars, prev) -> newWalkers
  walker-evaluate.js       evaluateAdvance(walker, gates, bars) -> nextStage|kill
  walker-cap.js            enforceCap(walkers, maxLive) -> walkers[]
  walker-sizing.js         computeSizeMultiplier(model, history, userMax) -> factor
  walker-runtime.js        impure: load/save walkers.json, news cal, memory parse, IPC dispatch
```

Pure functions in everything except `walker-runtime.js`. Pure files are unit-tested with `node --test`.

### Engine API

`walkerTick({prev, gates, bars, rules, calendar, memory, history})` returns `{next, triggers}`:

- `prev` — previous walkers.json state (`{walkers, triggers, proof}`)
- `gates` — engine bundle's gates object (`gates.engine.*`)
- `bars` — current TF bars + 5m bars
- `rules` — USER.md walker config (`walker_auto_sizing` on/off, `max_risk_per_trade`)
- `calendar` — ForexFactory weekly cache for news-pause check
- `memory` — parsed MEMORY.md lines tagged `walker-skip`
- `history` — last 20 closed trades per model (from setups.jsonl + trades.jsonl)

Returns:

- `next` — updated walkers + new triggers + updated proof
- `triggers` — array of events emitted this tick (`{ts, walker_id, stage, outcome, setup?}`)

Pure. No I/O. Same inputs → same outputs. Trivially testable.

### Stages per model

**MSS standard (1m trigger):**

1. `spawn` — `sweep_detected`. Price ran a session pool (engine emits `pillar1.sweeps[]`).
2. `displacement_done` — engine emits a `structure_event` with `event=MSS` (or `BoS` if same direction as the sweep would imply continuation) AND `displacement=true` AND a fresh FVG in the direction of the move.
3. `retrace_pending` — price wicks back into the displacement FVG.
4. `confirmation` — clean-body 1m close back above FVG CE in our direction.
5. `trigger` — emit setup, walker enters fired state.

**MSS sweep-into-5mFVG variant:** same chain, but the displacement FVG is on 5m and the confirmation is a 1m close back above the 5m FVG CE.

**Trend (5m trigger):**

1. `spawn` — `trend_intact`. Engine emits BoS in same direction as HTF bias; no opposing MSS.
2. `impulse_done` — fresh bullish/bearish FVG left by 5m displacement.
3. `retrace_pending` — price wicks back into the FVG (must be `bullish_fvg`, not `bullish_iFVG`).
4. `confirmation` — clean-body 5m close above FVG CE.
5. `trigger` — emit setup.

**Inversion aggressive variant:**

1. `spawn` — opposing PD array detected (e.g., bearish FVG in a bullish environment).
2. `inversion_violation` — strong candle closes through the opposing FVG.
3. `confirmation` — clean-body close above the violated FVG (now acting as bullish iFVG).
4. `trigger` — emit setup.

**Inversion patient variant:** same chain, but waits for a retrace into the iFVG after violation, then confirms.

Stage transitions are pure functions reading `gates.engine.*` and bars. No LLM.

### Kill conditions

Per stage, common patterns:

- `chop_timeout` — N minutes pass without stage advance (default 15 min).
- `structure_break` — for MSS waiting on retrace, kill if a new low forms below the swept swing.
- `news_window` — entering a red news ±15 min window kills all `retrace_pending` walkers.
- `session_end` — past killzone_end + grace, kill remaining walkers.
- `correlation_suppress` — if leader (MNQ) fires a trade, suppress (MES) walkers in same direction.

### Spawn detection

`detectIgnitions(gates, bars, prev)` scans for ignition events on every tick:

- **MSS spawn:** `gates.engine.pillar1.sweeps[]` with recency ≤ 10 min and no existing walker for that pool.
- **Trend spawn:** `gates.engine.pillar3.structure_events[]` `event=BoS`, `dir` aligned with HTF bias.
- **Inversion spawn:** `gates.engine.pillar3.fvgs[]` with `state=fresh` and `dir` opposing HTF bias.

Cap: max 4 live walkers per session. LIFO eviction (newest spawn evicts oldest if cap exceeded). Configurable via USER.md key `walker_max_live` (default 4).

### Seven upgrades beyond the ghxstofnq original

**1. News-aware spawn pause.** `walker-runtime.js` reads `app/main/calendar.js` weekly cache. Within ±15 min of any `impact: "high"` event, `detectIgnitions` returns empty and `evaluateAdvance` kills `retrace_pending` walkers.

**2. Volume gating on confirmation.** `evaluateAdvance` at the `confirmation` stage requires `gates.engine.confirmation.last_bar.volume_acceptable === true`. Filters low-participation candles. **Prerequisite:** the ICT Engine Pine indicator currently emits `range_3h, has_chop, atr_14, atr_17` in its quality row. `volume_acceptable` is a small Pine extension — one extra cell in the quality row (`ta.sma(volume, 20) * 1.0 < volume` boolean), plus a one-field parser update in `cli/lib/ict-engine-parser.js`. Walker PR1 includes this engine extension.

**3. Multi-TF coherence check.** At confirmation, walker checks `gates.engine_by_tf.m5.structure_events[]` for any opposing MSS in the last 5 5m bars. If found, advance fails (stage stays at `retrace_pending`, eventually times out).

**4. Memory-aware spawn vetoes.** `walker-runtime.js` parses `state/memory/MEMORY.md` for lines tagged `walker-skip:` at session start. Format: `walker-skip: {model} {side} {condition_string}`. `detectIgnitions` skips spawns matching any veto.

**5. Correlation suppression.** Tracked via `state/session/<date>/active_trade.json`. If `active_trade` exists with `side="long"` on the leader symbol, `detectIgnitions` suppresses long walkers on any other tracked symbol until the trade closes.

**6. Per-walker hypothetical R panel.** `evaluateAdvance` computes `hypothetical_r_to_stop` and `hypothetical_r_to_tp1` on every tick using current price + walker's projected stop/TP1. Stored on the walker object. LIVE renders.

**7. Auto-position-sizing from running win rate.** `walker-sizing.js` reads last 20 closed trades for the walker's model from `setups.jsonl` + `trades.jsonl`. Computes win rate. Returns size multiplier:

| Sample | Win rate | Multiplier |
|---|---|---|
| < 10 trades | n/a | 1.0× |
| ≥ 10 | < 40% | 0.5× |
| ≥ 10 | 40–60% | 1.0× |
| ≥ 10 | > 60% | 1.2× |

Hard cap from `USER.md`'s `max_risk_per_trade` always wins. Disabled by setting `walker_auto_sizing: off` in USER.md. LIVE renders the multiplier + reason inline.

### State file

`state/session/<date>/<session>/walkers.json` (atomic write — tmpfile + rename).

```json
{
  "session": "ny-am",
  "walkers": [
    {
      "id": "w_1717840980_a",
      "panel_id": "am_long_MSS",
      "model": "MSS",
      "variant": "standard",
      "side": "long",
      "stage": "retrace_pending",
      "swept_pool": { "name": "AS.L", "level": 29764.0 },
      "displacement_fvg": { "high": 29785.5, "low": 29782.0, "ce": 29783.75 },
      "retrace_zone": { "high": 29785.5, "low": 29783.75 },
      "entry": null,
      "stop": null,
      "tp1": null,
      "tp2": null,
      "size_multiplier": 1.2,
      "size_reason": "MSS last 20: 13W/7L · 65%",
      "hypothetical_r_to_stop": 1.5,
      "hypothetical_r_to_tp1": 2.1,
      "created_at": 1717840980,
      "last_advanced_at": 1717841040,
      "last_evaluated_at": 1717841100
    }
  ],
  "triggers": [
    {
      "ts": 1717841100,
      "walker_id": "w_1717840980_a",
      "stage": "confirmation",
      "outcome": "fired",
      "setup": {
        "model": "MSS",
        "side": "long",
        "entry": 29787,
        "stop": 29761,
        "tp1": 29820,
        "tp2": 29876,
        "size_multiplier": 1.2,
        "grade": "A+"
      }
    }
  ],
  "proof": { "last_1m_close": 1717841100, "last_5m_close": 1717840800 }
}
```

Auto-creates empty on first tick of session.

### Integration — bar-close detector

In `app/main/bar-close.js`:

```
on 1m close:
  phase = clock.phase
  if phase not in {entry-hunt, in-trade-open}: skip walker  // Claude still fires for brief / open-reaction / wrap
  gates = computeEngineGates(bundle)
  prev = readWalkersJson(session)
  calendar = readCalendarCache()
  memory = parseMemorySkipLines()
  history = readClosedTradesByModel(session, last=20)
  { next, triggers } = walkerTick({ prev, gates, bars, rules, calendar, memory, history })
  if next != prev: writeWalkersJson(next)
  for trigger in triggers:
    if trigger.stage == "confirmation" and trigger.outcome == "fired":
      persistSetup(trigger.setup)   // setups.jsonl + setup:current IPC + LIVE renders accept/reject
```

**Claude turn during entry-hunt: does not fire.** Detector skips. Brief, open-reaction, wrap, review, chat, catch-up still fire on Claude.

### Integration — backtest engine

`app/main/backtest-engine.js` currently calls `userTurn` per bar. After PR1, calls `walkerTick` per bar. Same engine = same logic = identical results in live and backtest. Faster + cheaper — no LLM cost per bar. UI states (IDLE / AUTO RUNNING / PAUSE AWAITING / DONE / LIBRARY / DETAIL) unchanged.

### What gets deleted

- `app/main/prompts/phase-bar-close.md` — strip entry-hunt section (~3K chars). Keep brief / open-reaction / catch-up routing.
- `cli/lib/entry-model-priority.js` — DELETE. Walker subsumes it.
- `cli/lib/setup-detector.js` — DELETE. Its candidate-detection logic moves into `walker-spawn.js`.
- `tests/entry-model-priority.test.js` — DELETE.
- `tests/setup-detector.test.js` — DELETE.

### What stays

- `cli/lib/sizing.js` — `walker-sizing.js` wraps it for size multiplier math.
- `cli/lib/brief-digest.js` — brief turn still uses it.
- `cli/lib/compute-engine-gates.js` — walker reads its output.
- All other Claude purposes (brief, open-reaction, wrap, review, chat, catch-up) — unchanged.

### UI changes

**LIVE popover, EntryHuntView** gains a new WALKER STATUS panel above the SetupCard:

```
WALKER STATUS
─────────────
am_long_MSS · MSS · standard · 1.2× size
  ▸ sweep_done → displacement_done → retrace_pending (2m)
  watching FVG 29782-29785.5 · R-to-stop 1.5 · R-to-TP1 2.1

am_short_TREND · TREND · standard · 1.0× size
  ▸ trend_intact → impulse_done → retrace_pending (4m)
  watching FVG 29812-29816 · R-to-stop 1.8 · R-to-TP1 1.9
```

On confirmation trigger, the existing SetupCard appears with ACCEPT / REJECT. Trade tracking + P&L ticking unchanged.

### Testing

Per-module unit tests with `node --test`:

- `tests/walker/walker-engine.test.js` — engine API contract (pure data in/out)
- `tests/walker/walker-spawn.test.js` — ignition detection per model
- `tests/walker/walker-evaluate.test.js` — advance + kill rules per stage
- `tests/walker/walker-cap.test.js` — eviction logic
- `tests/walker/walker-sizing.test.js` — size multiplier math + guardrails
- `tests/walker/walker-fixtures.test.js` — end-to-end replay of recorded sessions

6 to 8 fixtures covering: known A+ MSS, known A+ Trend, known A+ Inversion, known no-trade, known invalidated, known news-pause skip, known correlation suppression.

Backtest popover provides visual smoke: run a real historical session through the new engine.

---

## PR2 — CLAUDE.md slim

### Why

Our CLAUDE.md is 313 lines vs ghxstofnq's 169 lines. Bloat is one section: ~40-row architecture-decisions table with multi-paragraph entries per row. Recipe sections (analyze / session / dash / judge) embedded inline. Result: Claude loads more context than necessary per turn.

### Moves

- Architecture-decisions table → `docs/decisions-log.md` (the user-global CLAUDE.md already references this file)
- `/analyze` recipe → `docs/recipes/analyze.md`
- Session recipe → `docs/recipes/session.md`
- `/dash` recipe → `docs/recipes/dash.md`
- `/judge` recipe → `docs/recipes/judge.md`

### Stays inline in CLAUDE.md

- Research basis pointer
- Strategy basis pointer
- The 11 hard constraints (load-bearing for Claude behavior — must read every turn)
- Repo rules
- Workflow rules for Claude
- Project layout block
- Status section (current state)
- Pending implementation section (current TODO list)

### Cross-references

CLAUDE.md gains pointer lines at the section boundaries: "Architecture decisions: see `docs/decisions-log.md`. Operational recipes: see `docs/recipes/`."

### Result

~130 lines, matches the ghxstofnq shape. No content lost — relocated.

### No code changes in PR2

Documentation reorganization only. No tests to update. No runtime behavior change.

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Walker engine misses setups Claude would have caught | High | Backtest against ≥10 historical sessions before merging. Compare walker triggers to Claude-emitted setups from the same period. Differences resolve to "walker correctly rejected weak setup" or surface a fix. |
| Walker engine fires false positives | High | Volume gating + multi-TF coherence + memory vetoes add three filters past confirmation. ACCEPT/REJECT UI is the final human gate. |
| Auto-sizing destabilizes | Medium | Floor 0.5×, ceiling 1.2×, USER.md hard cap always wins, opt-out via `walker_auto_sizing: off`. |
| Backtest behavior diverges from live | Medium | Same `walkerTick` function in both paths — guaranteed identical by construction. Test with synthetic bar streams. |
| News calendar cache stale during session | Low | Calendar refreshes Monday 06:00 ET + on boot. Walker reads cache; if cache > 8 days old, news-pause defaults off (fail-open). |
| Memory veto patterns hard to write | Medium | First version: exact-string match only. Trader writes `walker-skip: MSS long AS.L` in MEMORY.md. Pattern matching grammar can grow later. |
| CLAUDE.md slim breaks Claude's context | Low | Relocated content reachable via cross-reference. Hard constraints stay inline. Smoke-test with one bar-close turn before merging. |

---

## Out of scope

- Self-tuning thresholds (machine-learning per-model parameters from outcomes — separate project)
- Sub-1m / tick-level walkers
- Walker over multiple symbols simultaneously at runtime (leader-only chosen)
- Full-Kelly position sizing (too aggressive for futures)
- Strategy-bound mode (refusing off-topic during sessions — separate UX decision)
- A "Pillar 1+2 walker" — those phases stay Claude-owned

---

## Decisions captured

- **ICT Engine V2 migration ships first (PR0).** Walker depends on the V2 bundle shape; parser update lands and is verified before walker code starts.
- **Engine in `app/main/walker/`, called by bar-close detector directly.** No Claude tool round-trip. Pure JS state machine.
- **Full coverage in PR1.** MSS standard + sweep-into-5m, Trend standard, Inversion aggressive + patient. No phased rollout.
- **Backtest engine ports in PR1.** Same engine for live + backtest = same results.
- **Leader-only at runtime.** Brief picks leader; walker runs walkers for that leader's session.
- **Thresholds via ICT Engine indicator quality row.** No new `rules.json`. Walker consumes `gates.engine.pillar2.current_tf.{range_quality, displacement, candle, volume_acceptable}`.
- **ACCEPT / REJECT UI stays.** Walker fires confirmation → setup card → trader gates the trade.
- **Seven upgrades over the original ghxstofnq engine.** News-aware spawn, volume gating, multi-TF coherence, memory vetoes, correlation suppression, hypothetical-R panel, auto-sizing.
- **CLAUDE.md slim is PR2, independent of PR1.** Documentation only, no runtime changes.
