# Backtest (Popover) — Design Spec

**Date:** 2026-05-28
**Status:** Approved (brainstorm) — pending spec review and writing-plans handoff
**Driver:** validate the trading system against historical sessions without leaving the live workflow. "Replay yesterday's NY-AM and see if it caught the trades I would have caught" should be one click from anywhere in the app.

## Goal

Build a **Backtest** capability that re-runs the full live phase chain (brief → bar-close → catch-up → wrap) against a historical session, grades the resulting trades against actual market data, and surfaces the outcome through a single topbar popover — same UX pattern as CLAUDE and ALERTS. The TV chart stays the protagonist; backtest is a sidecar.

Success criterion: the user can pick a date + session, hit START, walk away or watch, and end up with a confidence signal ("the system would have caught 2/2 setups on 2026-05-20 NY-AM, +8.5R, agreement 100%"). Over time, an aggregate dashboard accumulates these signals into a track record.

## Background — why this matters

- The live pipeline ([app/main/bar-close.js](app/main/bar-close.js), [app/main/sdk.js](app/main/sdk.js), the phase prompts in `app/main/prompts/`) is mature and produces verifiable per-bar decisions. Trusting it in production needs evidence: "did this system make good calls across N past sessions?"
- The existing FIXTURES page covers schema regression for single bundles, but not multi-bar session-level behavior. A bug in `catch_up` or a regression in `entry_hunt` after a prompt change can pass fixture tests yet still trade badly across a session — exactly the surface Backtest covers.
- The 2026-05-28 webview migration unlocked this: TV chart is now in the in-app webview, so backtest can drive `replay.start/step/stop` against the same surface the trader uses. The PR-merged `replay --at HH:MM` flag gives precise session anchoring.

User-stated intent (verbatim from the brainstorm):
> "I want to verify the system actually works, that the entries are actually solid… see how the system actually performs not just live testing. Fix things before going live."

Primary lens (chosen during brainstorm): **build confidence before live** — the unit of attention is a *setup* and the question is "did the LLM catch the trade I would have caught."

## Scope — what's in v1

In:
- A new topbar cell `BACKTEST` (sits beside `CLAUDE` and `ALERTS`) with badge count of total runs
- Popover anchored to that cell (same recipe as `.claude-popover` / `.alerts-popover` in [app/renderer/src/app.css:736-815](app/renderer/src/app.css:736)) — six states:
  - **IDLE** — configure a new run + see recent 5
  - **AUTO RUNNING** — LLM driving autonomously, live activity feed, post-hoc agreement toggles
  - **PAUSE AWAITING** — run blocked on a surfaced setup, ACCEPT/REJECT decision
  - **DONE** — run just completed, summary + actions
  - **LIBRARY** — wider popover (880px) with all-runs table + aggregate dashboard
  - **DETAIL** — single-run deep view (setup ledger with rationale, full LLM activity log, run actions)
- A backtest engine in `app/main/backtest-engine.js` that drives the run by reusing the existing phase chain
- Per-run state under `state/backtest/<run-id>/<session>/` mirroring the live shape
- Outcome auto-grading (steps the chart forward after each accepted trade, watches for stop/TP hit)
- Cost tracking via the existing `metrics.jsonl` with a new `run_id` field
- Inline post-hoc agreement toggle on each setup (✓ AGREE / ✗ DISAGREE)
- Two modes: **AUTO** (LLM auto-accepts every setup) and **PAUSE ON SETUP** (run blocks until human accepts/rejects)

Out (deferred):
- Multi-session batch runs (queue many at once)
- Comparing two runs side-by-side
- Hand-graded expected files (only auto + inline grading in v1)
- Resuming a crashed run (treated as ephemeral; user re-runs from scratch)
- Cost ceilings or hard cost gates — user makes the call from the estimate

## UI states — six total

All six live inside the popover anchored to the BACKTEST cell. Same chrome (border-top:0, 880px max width, surface-1 background, 0 6px 20px box-shadow) — different bodies.

### 1. IDLE
- Header: amber `BACKTEST` + × close
- Section 1 (NEW RUN): date input, session segmented (LON/AM/PM), pair (read-only display), mode toggle (AUTO/PAUSE ON SETUP), estimated cost line, big amber `▶ START RUN` button
- Section 2 (RECENT): 5 most-recent run rows + a `VIEW ALL <N> RUNS →` link that expands the popover to LIBRARY width
- Topbar cell badge: count of past runs (e.g. `42`)

### 2. AUTO RUNNING
- Header: amber `BACKTEST · AUTO` with green pulse dot + blue `LLM DRIVING` chip
- Section 1 (progress): date · session · mode line, rows for BAR / TIME / PHASE / ELAPSED, progress bar, ~remaining estimate, `■ STOP RUN` button (dim, less prominent)
- Section 2 (LLM ACTIVITY FEED): rolling log of last ~6 turns (time · phase · message); current line has a pulsing dot; surfaced-setup lines are starred and amber
- Section 3 (SETUPS): read-only setup cards as they surface — each carries grade pill, side, model, time, ENTRY/STOP/TP1, auto outcome line, `AUTO-ACCEPTED` tag, and an optional `YOUR CALL? ✓ AGREE / ✗ DISAGREE` micro-toggle (purely annotative — does not block the run)
- Topbar cell badge: pulsing green dot + percentage (e.g. `52%`)

### 3. PAUSE AWAITING (PAUSE ON SETUP mode only)
- Header: red `BACKTEST · AWAITING DECISION` with pause-bars icon
- Section 1 (progress, de-emphasized): compact summary + STOP RUN
- Section 2 (decision): red pause banner ("RUN PAUSED — DECIDE BEFORE CONTINUING"), full setup card (grade, side, model, time, levels, LLM rationale prose), then **two big buttons**: green `✓ ACCEPT (A)` + red `✗ REJECT (R)` (keyboard shortcuts shown), one-line footnote spells out behavior
- Chart underneath: red replay marker + red last-price tag, trade levels overlay (STOP/ENTRY/TP1 dashed lines)
- Topbar cell badge: red `PAUSED` dot

### 4. DONE
- Header: green `BACKTEST · COMPLETE` with ✓ check; × dismissable
- Section 1 (summary): 4-cell grid — RESULT, SETUPS, WIN-RATE, BEST MODEL; agreement summary line (only if user touched any toggles); two actions: secondary `▸ OPEN DETAIL` + primary `+ RUN ANOTHER`
- Section 2 (setups): compact ledger of all setups from this run with grade/side/model/result
- Section 3 (recent): aggregate one-liner + `VIEW ALL <N> RUNS →` full-width button
- Topbar cell badge: green ✓ + count (incremented to include this run)

### 5. LIBRARY
- Header: amber `BACKTEST · LIBRARY · <N> RUNS · <date-range>` + × close
- Section 1 (AGGREGATE): 5-cell stats grid — TOTAL RUNS (with session breakdown), A+ HIT-RATE, B HIT-RATE, CUM P&L, YOUR AGREEMENT
- Section 2 (filters): segmented controls for SESSION / GRADE / MODE, wrapped search input (anti-autofill div pattern, all native chrome killed), inline `+` button (22×22 amber square)
- Section 3 (table): sortable `lib-table` with columns DATE, SESSION, MODE, SETUPS, W/L, GRADE pill, MODEL, P&L, YOU (agreement marks), COST, drill-in arrow. Row hover → surface-2 background. Click row → DETAIL.
- Popover width: 880px (max-width: calc(100vw - 40px) for safety)

### 6. DETAIL
- Header: `← LIBRARY` back link + run title (`2026-05-20 · AM`) + result + mode pills + × close
- Section 1 (SUMMARY): 4-cell grid (RESULT, SETUPS, WIN-RATE, AGREEMENT)
- Section 2 (SETUPS): full expanded cards with 4-column levels (ENTRY/STOP/TP1/TP2), LLM rationale in a `border-left: 2px solid var(--blue)` prose block, outcome line, **editable** AGREE/DISAGREE toggle
- Section 3 (LLM ACTIVITY LOG): full session timeline (brief → bar-close → setups → wrap), scrollable 200px region, phase color-coded
- Section 4 (ACTIONS): `▸ REPLAY ON CHART` (primary — drives the actual TV chart to that session's replay), `↻ RE-RUN`, `↗ EXPORT`, `DELETE RUN` (danger, right-aligned)

State transitions:
- IDLE → AUTO RUNNING / PAUSE AWAITING (on START RUN, depending on mode)
- AUTO RUNNING ↔ PAUSE AWAITING (only in PAUSE mode, when a setup surfaces)
- AUTO RUNNING / PAUSE → DONE (on completion or STOP RUN)
- DONE → IDLE (on dismiss × or RUN ANOTHER)
- Any state → LIBRARY (on `VIEW ALL` click)
- LIBRARY → DETAIL (on row click)
- DETAIL → LIBRARY (on `← LIBRARY` click)

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Renderer (React)                                                    │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  BacktestPopover.jsx — all 6 states above, state-machine'd     │  │
│  │  reads: useBacktest() hook (config, progress, setups, library) │  │
│  │  ipc:   backtest.start / backtest.stop / backtest.accept /     │  │
│  │         backtest.reject / backtest.delete / backtest.list      │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                  │                                   │
│                                  │ IPC                               │
│  ┌───────────────────────────────▼────────────────────────────────┐  │
│  │  Main process                                                  │  │
│  │  app/main/backtest-engine.js  ◄── new file (the loop)          │  │
│  │  app/main/backtest-store.js   ◄── new (run-id registry on disk)│  │
│  │  app/main/backtest-grader.js  ◄── new (auto outcome grading)   │  │
│  │                                                                │  │
│  │  reuses (unchanged):                                           │  │
│  │  - app/main/sdk.js          (userTurn, phase routing)          │  │
│  │  - app/main/session-memory.js (state file writes)              │  │
│  │  - app/main/persistent-memory.js (memory loader — read-only)   │  │
│  │  - app/main/surface.js      (surface_* output validators)      │  │
│  │  - app/main/metrics.js      (cost + per-turn metrics)          │  │
│  │  - app/main/scheduled-turn.js (brief/wrap orchestration)       │  │
│  │  - packages/core/replay.js  (TV chart replay control)          │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### The engine loop (backtest-engine.js)

Single async function `runBacktest({ date, session, mode, runId })` returning a result:

```
1. tvReplay.start({ date, time: sessionBriefAnchor(session) })       // e.g. 08:30 ET for NY-AM
2. emit('progress', { phase: 'brief', bar: 0, total: N })
3. await runPhase('brief', { runId, session, date })                  // writes pillar1.md, pillar2.md
4. emit('progress', { phase: 'catch_up_check', ... })
5. for each bar from session-open to session-close:
     await tvReplay.step()
     const bundle = await tvAnalyzePillar3({ baseline: briefBundle }) // fast-path
     const events = detectBarClose(bundle)                            // includes 5m close flag
     for each event:
       await runPhase(events.purpose, { runId, ...bundle })           // bar-close / catch-up
       if (mode === 'PAUSE' && newSetupSurfaced):
         emit('paused', { setup })
         await waitForUserDecision()                                  // accept / reject
       if (accepted):
         openTrades.push(setup)
       gradeOpenTrades(openTrades, bundle)                            // backtest-grader.js
       emit('progress', { bar: i, ...metrics })
6. await runPhase('wrap', { runId, ...summary })
7. tvReplay.stop()
8. writeSummary(runId, { setups, totalPnl, costUsd, agreement })
9. emit('done', { runId, summary })
```

`runPhase` is a thin wrapper around `sdk.userTurn({ purpose, ... })` that:
- Sets the writer context to `state/backtest/<run-id>/<session>/` instead of `state/session/<date>/<session>/`
- Tags emitted metric rows with `run_id`
- Otherwise unchanged — phase prompts and SDK behavior identical to live

**Mode-specific accept behavior:**
- **AUTO**: when an `entry_hunt` phase emits a `surface_setup` tool call, the engine treats it as if the user clicked ACCEPT — immediately opens a trade in `openTrades[]`, writes a trade-open row to `trades.jsonl`, and resumes the loop. The setup card shows `AUTO-ACCEPTED` in the outcome footer.
- **PAUSE**: same `surface_setup` triggers `emit('paused', { setup })` and the loop awaits `waitForUserDecision()`. The IPC handler resolves the promise with `{ decision: 'accept' | 'reject', user_grade }`. ACCEPT → trade opened, loop resumes. REJECT → trade rejected (logged with reason), loop resumes. STOP RUN during decision → engine sets stop flag, no trade opened, wrap fires.

Live behavior (where the user must explicitly accept every setup) is preserved — backtest PAUSE mode mirrors it; AUTO mode is the only deviation, and only happens inside the backtest context.

### Outcome grading (backtest-grader.js)

For each open trade, on every chart step:
```
bar = latest closed bar (from tvAnalyzePillar3 bundle's bars.last_bar)
if trade.side === 'long':
  if bar.low <= trade.stop:                outcome = 'stop_hit',  exit = trade.stop
  else if bar.high >= trade.tp1:           outcome = 'tp1_hit',   exit = trade.tp1
  else: pending
if trade.side === 'short':
  if bar.high >= trade.stop:               outcome = 'stop_hit',  exit = trade.stop
  else if bar.low <= trade.tp1:            outcome = 'tp1_hit',   exit = trade.tp1
  else: pending
```

**Intra-bar conflict rule:** if a single bar's `high >= stop` AND `low <= tp1` (both reachable), assume **stop hit first** (conservative). Live trading doesn't have intra-bar tick data either, so this matches the assumption a real trader would make. Flagged in setup metadata: `outcome_meta.conflict_bar: true`.

TP2 / runner behavior: not graded in v1. TP1 hit triggers stop-to-break-even on the rest. Outcome reported as "+1R + runner (BE)" until session close (then runner closed at session-end price).

Output: appended to `state/backtest/<run-id>/<session>/setups.jsonl` as outcome event:
```jsonl
{"ts":"09:51 ET","setup_id":"...","outcome":"tp1_hit","exit":29050,"r":1.2,"bars_to_outcome":9,"conflict_bar":false}
```

### Run-ID generation

```
{YYYYMMDD-HHMMSS}-{session-slug}-{target-date}
e.g. 20260528-103047-am-2026-05-20
```

Run IDs are unique by minute + session + target-date — collision-resistant for the realistic backtest cadence.

## Data flow

```
User clicks START RUN in IDLE popover
    │
    ▼
IPC: backtest:start(config)
    │
    ▼
backtest-engine: validate config, generate run-id, mkdir state/backtest/<run-id>/<session>/
    │
    ▼
backtest-engine: tvReplay.start({date, time: anchor})
    │
    ▼
backtest-engine: runPhase('brief')
    │       │
    │       └─> sdk.userTurn({purpose:'brief', writerContext:<backtest-path>})
    │             │
    │             └─> writes pillar1.md, pillar2.md to backtest path
    │
    ▼
loop: replay.step → analyze → bar-close turn → outcome grading
    │       │           │            │             │
    │       │           │            │             └─> writes setups.jsonl outcome rows
    │       │           │            └─> writes ltf-bias.md, surfaces setups
    │       │           └─> tvAnalyzePillar3 (cheap, current TF only)
    │       └─> ipc.emit('progress', {bar, phase, cost, setups})
    │
    ▼ (loop ends)
runPhase('wrap') → writes summary.md, summary.json
    │
    ▼
tvReplay.stop()
    │
    ▼
backtest-store: register run in index
    │
    ▼
ipc.emit('done', {runId, summary})
    │
    ▼
Renderer: popover transitions to DONE state
```

## State + persistence

**Layout (mirrors live):**
```
state/backtest/
├── index.json                              # registry: [{runId, date, session, mode, summary, cost, created_at}]
└── <run-id>/
    └── <session>/                          # ny-am | ny-pm | london
        ├── brief.json
        ├── pillar1.md
        ├── pillar2.md
        ├── ltf-bias.md
        ├── open-reaction.md                # if applicable
        ├── setups.jsonl                    # setup events + outcomes (combined)
        ├── trades.jsonl                    # trade events (open, tp1_hit, stop_hit)
        ├── bars.jsonl                      # 1m bars captured during run
        ├── bars-5m.jsonl                   # 5m bars
        ├── pair-decision.json              # leader vote
        ├── summary.md                      # written by wrap turn
        ├── summary.json                    # parsed summary frontmatter + metrics
        └── activity.jsonl                  # one line per LLM turn (for DETAIL log)
```

**`activity.jsonl`** is new for backtest — captures every turn's `{ts, purpose, phase, summary_msg, cost_usd, turn_ms}` so the DETAIL view can replay the LLM's progression. Live could adopt this later but it's not required.

**`index.json`** is the master list:
```json
{
  "runs": [
    {
      "run_id": "20260528-103047-am-2026-05-20",
      "date": "2026-05-20",
      "session": "ny-am",
      "mode": "auto",
      "created_at": "2026-05-28T10:30:47Z",
      "elapsed_ms": 923000,
      "cost_usd": 2.14,
      "setups": 2,
      "wins": 2,
      "losses": 0,
      "no_trades": 0,
      "total_r": 8.5,
      "best_model": "MSS",
      "your_agreement": { "agreed": 2, "disagreed": 0, "ungraded": 0 },
      "chain_status": "clean"
    }
  ]
}
```

LIBRARY reads index.json once on popover open; DETAIL reads the full per-run folder.

## Memory

- `state/memory/USER.md` and `state/memory/MEMORY.md` are read normally by every turn (same as live)
- Memory writes during backtest are **suppressed** — the memory tool (`mcp__tv__memory`) is wired up but the writer in [app/main/persistent-memory.js](app/main/persistent-memory.js) checks for a `backtest: true` context flag and short-circuits writes (returns success without modifying disk)
- Rationale: backtests are repeatable experiments. Letting them write to durable memory would mean the second run of the same session produces a different result than the first — defeats the purpose

This is the only behavioral difference vs live. It's a 5-line change in `persistent-memory.js` and is well-tested via existing memory-guardrails tests.

## Cost model

Per-turn cost is already extracted by [app/main/usage.js](app/main/usage.js) and written to `metrics.jsonl`. Backtest adds:
- A `run_id` field on every metric row emitted during a backtest run
- DETAIL view sums those entries: `cost_usd = sum(metrics where run_id === detailRun)`
- LIBRARY shows the cumulative per-run cost from `index.json` (precomputed at run-end)

Estimate shown on CONFIGURE form:
- `estimateCostUsd(session, mode) = baseTurnCount[session] × avgTurnCost`
- `baseTurnCount: { 'ny-am': 180, 'ny-pm': 180, 'london': 180 }` (3h × 60min)
- `avgTurnCost = 0.12` for AUTO (cache benefits), `0.15` for PAUSE (longer turns)
- Display: `EST. ~$X.XX` (1 decimal) — purely informational, no gate

Per user decision in brainstorm: **no confirmation dialog, no hard ceiling**. The estimate is enough information.

## Crash + recovery

Runs are **ephemeral until DONE**. If the app crashes or is force-quit mid-run:
- The partial folder under `state/backtest/<run-id>/` is left on disk with `chain_status: aborted` written by the engine's `finally` block (best-effort; if process dies abruptly, no status is written and the folder is identifiable by absence of `summary.json`)
- `index.json` is **not** updated for incomplete runs (it's only written at run-end)
- On next app launch, the renderer reconciles: any folders under `state/backtest/` not in `index.json` are detected as aborted runs and shown in LIBRARY with a `chain_status: aborted` pill
- User can DELETE aborted runs from DETAIL view (removes the folder)
- No resume — re-run from scratch if needed

## Failure modes + handling

| Failure | Detection | Behavior |
|---|---|---|
| Replay date unavailable (e.g. holiday) | `replay.start` throws `"Replay date unavailable"` | Surface error in IDLE popover, run never starts |
| LLM rate limit / API down | `sdk.userTurn` throws (existing error-classifier path) | Mark `chain_status: degraded:<reason>`, finish summary with partial setups |
| TV chart unresponsive mid-run | `replay.step` throws | Same — emit error event, write summary as-is |
| User clicks STOP RUN | IPC stop event | Engine sets stop flag; loop exits at next iteration boundary; wrap turn still fires; summary marks `chain_status: user-stopped` |
| Disk full during writes | `fs.writeFile` throws | Surface to renderer; run aborts; partial state preserved |
| Outcome grader sees both stop AND TP in same bar | conflict detection in grader | Assume stop first (conservative), tag `conflict_bar: true` on outcome |

Errors never close the popover — user can read what happened and decide.

## Exclusive mode

While a backtest is running, the chart is in TV's replay state. This breaks LIVE / PREP panels (they read real-time bars). To handle:
- A renderer-side `useBacktestRunning()` hook returns `{running: bool, runId, session}` from the same IPC store that drives the popover
- PREP / LIVE panels show a centered "BACKTEST RUNNING · <session>" placeholder (replaces their normal content)
- REVIEW stays usable — it's reading historical state files, doesn't care about chart state
- When the run ends (DONE), chart auto-returns to realtime, panels restore
- New backtest cannot be started while one is running (`+ NEW` button disabled with tooltip)

## Testing strategy

Unit (node --test):
- `backtest-engine.test.js` — orchestrator unit tests with mocked TV + SDK: verifies phase sequence, run-id generation, mode branching (auto vs pause), exclusive-mode enforcement
- `backtest-grader.test.js` — pure-function tests of outcome grading: long/short × stop-first/TP-first/conflict bars, BE move after TP1
- `backtest-store.test.js` — index.json read/write/reconcile, aborted-run detection

Integration (existing `tests/migration/` pattern):
- Fixtures: 2-3 captured replay sessions (NY-AM, NY-PM, LON) with known outcomes
- Run backtest against each, assert summary matches known good baseline (allowing 0.25pt drift like the bundle diff)
- Smoke fixtures unchanged (16/16)

Manual:
- Run a backtest end-to-end on 2026-05-20 NY-AM. Verify:
  - All 6 UI states render correctly
  - PAUSE mode actually pauses on each surfaced setup
  - Outcome grading reports correct W/L
  - `state/session/` is untouched
  - Cost matches metrics.jsonl sum
  - DELETE removes the folder + index entry

## What's NOT in scope (and what to defer)

- **Pre-graded expected files** — Mentioned in brainstorm; deferred. v1's auto-grading + inline grading is enough signal.
- **Multi-session batch queues** — One run at a time.
- **Side-by-side run comparison** — Useful future feature for prompt A/B; not in v1.
- **Cost ceilings / confirmation dialogs** — Per user decision, estimate only.
- **Resume from crashed run** — Ephemeral; user re-runs.
- **TP2 / runner separate grading** — v1 grades TP1 + a BE-stopped runner closed at session-end. Per-setup TP2 hit tracking can be added later.

## References

- [docs/strategy/trading-strategy-2026.md](docs/strategy/trading-strategy-2026.md) — the 3-pillar framework the LLM is being tested against
- [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — research basis (the "no LLM arithmetic" + "cite-or-reject" constraints apply to backtest output too)
- [app/main/bar-close.js](app/main/bar-close.js) — live bar-close orchestrator that backtest mirrors
- [app/main/sdk.js](app/main/sdk.js) — phase routing reused unchanged
- [packages/core/replay.js](packages/core/replay.js) — TV replay control, including the `--at HH:MM` flag from PR #77
- Mockups: `.superpowers/brainstorm/79492-1779929198/content/popover-v3-matched.html` (IDLE), `v5-pause-decision.html`, `v6-auto-running.html`, `v7-done.html`, `v12-library-fixed3.html`, `v13-shortlabels.html`, `v14-detail.html`
