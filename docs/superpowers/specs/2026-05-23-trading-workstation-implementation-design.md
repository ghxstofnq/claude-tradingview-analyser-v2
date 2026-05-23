# Trading Workstation — Implementation Design (v1)

**Date:** 2026-05-23
**Status:** Draft — implementation spec for v1
**Companions:**
- UI design spec — [`2026-05-22-trading-workstation-design.md`](2026-05-22-trading-workstation-design.md)
- Usage workflow — [`2026-05-22-trading-workstation-usage-workflow.md`](2026-05-22-trading-workstation-usage-workflow.md)

---

## 1. Summary

How the Electron desktop trading app gets built — process model, where Claude lives, how the live loop drives reads, how the new trade-tracking subsystem works, how fired alerts are detected, and the build phasing inside v1.

v1 scope: **vertical slice through trades.** Window + embedded TradingView + Claude conversation with `tv` tools + automatic bar-close loop + setup cards + Accept/Reject + `trades.jsonl` with bar-close-inferred outcomes + fired-alert detection. REVIEW mode and packaging are deferred.

The UI surface (modes, panels, colours, visual language) is defined in the design spec companion. The trading workflow (PREP → LIVE → REVIEW per session) is defined in the usage-workflow companion. This document describes the engineering shape that delivers both.

---

## 2. v1 scope

**In:**
- Single-window Electron app.
- Embedded TradingView webview (broker-connected, trader's account, order panel inside it).
- Claude conversation in the workstation panel, powered by the Claude Agent SDK in Electron's main process.
- Tool surface for Claude: `tv_analyze_full`, `tv_analyze_fast`, `tv_alert_create`, `tv_alert_list`, `surface_setup`, `surface_no_trade`.
- Bar-close detector spawned in LIVE, feeding Claude one turn per closed bar (1m + 5m), phase-aware.
- Setup cards rendered from `surface_setup` tool calls. Accept / Reject controls on the cards.
- `state/session/<date>/<session>/trades.jsonl` write path. Outcome inference module + per-bar tick.
- Fired-alert detection via CDP polling. Toast + fired-alerts feed.
- Loop-health indicator in the topbar.

**Out (deferred):**
- REVIEW mode (session journal, replay transport, past-sessions library).
- Packaging / DMG / notarization / auto-update — v1 runs from source.
- Broker-API reconciler — bar-close inference is sufficient for v1.

---

## 3. Architecture overview

Three things run when the app is open:

1. **TradingView Desktop** — already running today on CDP port 9223. The headless analysis target. The user does not look at this window. `./bin/tv` continues to drive it for every analysis sweep, unchanged from today.

2. **Electron main process** (Node, no UI). Hosts the Claude Agent SDK. Spawns and supervises a long-running `./bin/tv stream bar-close` subprocess. Shells out to `./bin/tv <cmd>` for one-shot tool calls. Bridges everything to the renderer over IPC.

3. **Electron renderer** (React + Vite, the visible window). The chart on the left is an Electron `<webview>` pointing at `tradingview.com` — the trader's broker-connected account, where the order panel lives. Chat panel and workstation panels are React components ported from the designer's prototype. Talks to main exclusively over IPC.

**Why two TradingViews:** the embedded webview must stay still on the trader's working chart (broker-connected, where they execute). The analysis pipeline does symbol/timeframe sweeps that cannot disturb the trader's chart. So: webview for execution, Desktop on CDP 9223 for analysis. Same product, two sessions, one job each. The existing CLI + analysis pipeline is reused untouched.

**Authentication:** the Agent SDK inherits the user's existing Claude Code credentials — no separate sign-in inside the app.

---

## 4. Repo layout

Single repo (this one). New top-level `app/` directory, sibling to `cli/`, `cmd/`, `packages/`:

```
app/
  main/                         Electron main process (Node)
    index.js                    entry point, BrowserWindow setup
    sdk.js                      Claude Agent SDK initialization
    tools/                      tool definitions exposed to Claude
      tv-analyze.js
      tv-alerts.js
      surface.js                surface_setup, surface_no_trade
    ipc.js                      IPC handlers (renderer → main)
    bar-close.js                detector subprocess + event bridge
    alerts.js                   alert poll + diff
    health.js                   loop-health + alert-poll-health computation
    prompts/
      analyze.md                copied from .claude/commands/analyze.md
    preload.js                  Electron preload (safe IPC API to renderer)
  renderer/                     Electron renderer (React + Vite)
    index.html
    main.jsx                    React entry
    app.jsx, prep.jsx, live.jsx, review.jsx, shared.jsx, tv-chart.jsx
                                ported from prototype
    app.css                     ported from prototype
    hooks/                      IPC-driven React hooks (useChat, useTrades, useAlerts, useHealth)
  vite.config.js
  package.json                  separate from project root for app deps
                                (electron, vite, react, @anthropic-ai/claude-agent-sdk, ...)
```

CLI changes (additive, in existing `cli/`):

```
cli/
  commands/
    trades.js                   NEW. tv trades tick / list / show <id>
  lib/
    trade-outcomes.js           NEW. core outcome inference module
    sizing.js                   NEW. grade + day-of-week → prescribed size
```

The Electron main process imports `cli/lib/*` modules directly (ESM, same Node runtime). For one-shot CLI calls it shells out via `./bin/tv` so calls go through the same code paths as direct CLI usage.

---

## 5. Process model

**Long-running, owned by main:**
- The Claude Agent SDK session (one per trading session — fresh at session start, resumes on crash, ends at session boundary).
- The bar-close detector subprocess (`./bin/tv stream bar-close`) — spawned on entry to LIVE, killed on exit / app close.
- The alert poller — interval timer; cadence varies by mode (5s in LIVE, 30s in PREP, off in REVIEW/idle).
- The health monitor — 2s interval, computes loop + alert-subsystem state.

**Spawned per call:**
- `./bin/tv analyze [...]` — one-shot. Fast poll completes in ~0.2s; full sweep in ~13s.
- `./bin/tv alert create / list / delete` — one-shot.
- `./bin/tv trades tick` — one-shot (also reachable as direct ESM import from main).

**Communication channels:**
- Renderer → main: IPC requests via `ipcMain.handle()`. Channels: `chat:send_message`, `mode:switch`, `trade:accept`, `trade:reject`, `alert:arm`, `trades:list`.
- Main → renderer: IPC events via `webContents.send()`. Channels: `chat:chunk`, `chat:tool_call`, `chat:turn_complete`, `bar:close`, `trade:outcome`, `trade:accepted`, `alert:fired`, `health:update`.
- Main → bar-close detector: stdin closed; reads stdout line-by-line as JSON.
- Main → Anthropic API: through the Agent SDK.

---

## 6. The Claude conversation surface

**Setup at app launch (main):**
1. Import the Claude Agent SDK and instantiate with the user's existing credentials (inherited from Claude Code's stored config).
2. Load the system prompt from `app/main/prompts/analyze.md` (copied from `.claude/commands/analyze.md`).
3. Register the tool surface (below).
4. Open a session that persists across the trading session. Resumes on crash.

**Tools Claude can call:**

*Read the world (wrap `./bin/tv`):*
- `tv_analyze_full({})` → `./bin/tv analyze --out state/last-analyze.json`. Full multi-TF sweep. Used at session boundaries, phase changes, and the baseline-refresh path.
- `tv_analyze_fast({baseline?: string})` → `./bin/tv analyze --pillar3-only --baseline <path> --out state/last-scan.json`. Fast poll. Used on every bar-close event. Falls back to a full call if no baseline file exists yet.
- `tv_alert_create({price: number, label: string})` → `./bin/tv alert create`.
- `tv_alert_list({})` → `./bin/tv alert list`.

*Surface structured output to the UI:*
- `surface_setup({grade, model, direction, entry, stop, tp1, tp2, invalidation, rr, confirmation_status, pillar_breakdown})` — main captures the call, appends to `state/session/<date>/<session>/setups.jsonl`, pushes a `chat:tool_call` IPC event to the renderer. Renderer renders a setup card in the workstation rail.
- `surface_no_trade({reason: string})` — marks the current period no-trade in the UI.

Tool-based surfacing replaces parsing JSON out of Claude's prose. Constraint #8 (prose-first reasoning) still holds: Claude reasons in prose, *then* calls a surface tool. Cleaner separation; the UI never has to regex Claude's text.

**Output discipline carries over from the existing slash command:**
- Prose first, structured output (tool call) last.
- No LLM arithmetic — Claude reads numbers, never produces one.
- Cite-or-reject — every numeric price in prose is cited with `(<json.path>)` from the bundle.
- Grade enum only — `A+ | B | no-trade`.

**What the chat panel renders** (four feed-item styles, per design spec §7):
1. Auto per-bar reads (Claude reacting to a `bar:close` event).
2. The trader's typed messages.
3. Claude's direct replies to typed messages.
4. Tool-call cards (setup cards from `surface_setup`, no-trade markers from `surface_no_trade`).

**Typed messages and auto-reads share one FIFO queue.** No interrupting an in-flight turn.

---

## 7. The live loop

**The detector** is already wired today: `./bin/tv stream bar-close` is a long-running Node process. It sleeps to each 60-second boundary, polls right after, prints one JSON line per closed 1m bar, an additional line per closed 5m bar, writes a heartbeat to `state/session/detector-heartbeat.json` per poll, and persists every event to `state/session/<date>/bar-close-events.jsonl`.

**Lifecycle:** main spawns the detector when the trader switches to LIVE; kills it when leaving LIVE or closing the app. If the child exits unexpectedly, main marks the loop `down` and bubbles to the topbar status. Auto-restart with backoff is in §10 polish (phase 8).

**Per closed bar (in this order):**
1. Main parses the JSONL line into `{ts, tf, ohlc}`.
2. **Baseline freshness** — if `state/baseline.json` is older than 900 seconds, main kicks off a `tv_analyze_full` call in the background to refresh it. (Strategy §2.4 allows HTF reuse intraday; staleness threshold 15 min.)
3. **Outcome tick first** — main calls `trade-outcomes.tick({latest_bar, trades_file})` synchronously. Any transitions append to `trades.jsonl` and emit `trade:outcome` IPC events. Doing this BEFORE Claude's turn means Claude's per-bar read sees fresh trade state.
4. **Then send Claude a turn** — main pushes a structured message into the SDK session: `"A new {tf} bar just closed at {iso_ts} ET. Phase: {phase}. {phase_specific_hint}."` Claude reads it as the next turn.
5. Claude calls `tv_analyze_fast` for fresh data + cached HTF context.
6. Claude reasons in prose; chunks stream to the renderer via `chat:chunk`.
7. If a setup is in play, Claude calls `surface_setup`. If nothing, `surface_no_trade` or silence (silence is fine; not every minute produces a card).

**Phase-aware behavior** — each turn carries the current phase, computed in main from the ET clock + `gates.session.phase`:
- **PREP** (pre-session) — detector is off. Claude runs a one-shot Pillar 1 + 2 grade when the trader opens PREP; trader-initiated, not bar-driven.
- **LIVE · open reaction** (09:30–09:45 ET) — every 1m close. Forming-LTF-bias verdicts only; no entry hunting. Claude should NOT call `surface_setup` in this phase.
- **LIVE · entry hunt** (09:45 onward) — every 1m close *and* every 5m close. Claude walks the 3-pillar checklist; surfaces setup cards as they form.
- **Idle / between sessions / market closed** — detector is off.

**Loop health** (computed in main on a 2s interval, pushed to renderer as `health:update`):
- **healthy** — heartbeat < 30s old AND last Claude turn completed within ~5s of last bar event.
- **stale** — heartbeat 30–90s old, OR Claude lagging 2+ bars.
- **down** — heartbeat > 90s, OR detector exited.

---

## 8. Trade tracking

**Net-new subsystem.** The project today tracks setups (Claude's `setups.jsonl`) but has no trader-decision or outcome tracking. v1 adds it.

**One new file per session:** `state/session/<date>/<session>/trades.jsonl`. Append-only. Three event types:

```jsonc
// accept — creates a trade
{
  "type": "accept",
  "id": "T-0427",
  "setup_id": "S-0431",
  "ts": "2026-05-25T13:50:14Z",
  "side": "long",
  "model": "MSS",
  "grade": "A+",
  "entry": 21487.25,
  "stop": 21472.00,
  "tp1": 21521.50,
  "tp2": 21548.00,
  "invalidation": 21465.00,
  "rr": 3.1,
  "size": { "contracts": 1, "dollar_risk": 76.25, "r_unit": 0.75 }
}

// reject — disposition only, no trade created
{
  "type": "reject",
  "setup_id": "S-0431",
  "ts": "...",
  "reason": "low conviction · lunch chop"
}

// outcome — updates an existing trade
{
  "type": "outcome",
  "id": "T-0427",
  "ts": "...",
  "status": "TP1_HIT",          // FILLED | INVALIDATED | TP1_HIT | TP2_HIT | STOPPED
  "bar_high": 21525.00,
  "bar_low": 21504.25,
  "fill_price": 21487.25,        // for FILLED transitions
  "r_realized": 2.25             // for terminal states (TP*, STOPPED)
}
```

To compute current-trades state: read all lines, group by `id`, fold.

**The outcome checker** — `cli/lib/trade-outcomes.js`, a plain ESM module main imports directly. Same module is exposed as `tv trades tick` for isolated testing. Logic:

- For each open trade, decide its lifecycle phase:
  - `pending_entry` — accepted, entry hasn't filled yet.
  - `filled` — entry has filled; managing toward TP1 / TP2 / stop.
- Apply the latest bar's OHLC:
  - `pending_entry`:
    - Bar's range crosses entry → emit `FILLED`.
    - Bar's range crosses invalidation → emit `INVALIDATED`, trade closes.
  - `filled`:
    - (long) bar.high ≥ TP1 → emit `TP1_HIT`, pull stop to break-even (entry).
    - (long) bar.high ≥ TP2 → emit `TP2_HIT`, runner closes.
    - (long) bar.low ≤ stop → emit `STOPPED`.
    - (short) symmetric.
- All comparisons. No arithmetic — constraint #7 is fine.

**Edge cases:**
- Single bar crossing BOTH entry and TP1 (or entry and stop) — without intra-bar time resolution, prefer the conservative interpretation: filled-then-stopped, never filled-and-TP1-hit in the same bar. Document the assumption in the module.
- TP1 + STOPPED on the runner in the same bar after BE move — emit both events as separate lines (TP1_HIT line first, STOPPED line second).

**Prescribed sizing** — `cli/lib/sizing.js`. Lookup keyed by `{grade, day_of_week}` where `grade ∈ {A+, B}` and `day_of_week ∈ {Mon, Tue, Wed, Thu, Fri}` (six combinations). Returns a size record — illustrative fields in the example above are `{contracts, dollar_risk, r_unit}`; the exact field set and the numbers are resolved during implementation by reading `docs/strategy/trading-strategy-2026.md` Step 7 (A+ takes more size than B; Monday/Friday reduced from Tue/Wed/Thu).

**Accept flow:**
1. Trader clicks Accept on a setup card.
2. Renderer → main: `trade:accept` with `setup_id`.
3. Main looks up the setup in `setups.jsonl`, generates a trade id (`T-NNNN` sequence per session), calls `sizing.lookup({grade, dow})`, appends the `accept` event to `trades.jsonl`.
4. Main → renderer: `trade:accepted` event with the full trade payload.
5. Renderer renders a "taken trade" card with sizing visible, replacing (not duplicating) the setup card.

**Reject flow:**
1. Trader clicks Reject (optionally types a reason).
2. Renderer → main: `trade:reject` with `setup_id` + reason.
3. Main appends the `reject` event.
4. Renderer grays out the setup card / moves it to a rejected stack.

**Outcome flow** is covered in §7 step 3 — the per-bar tick runs *before* Claude's turn.

**State exposed to the renderer:** main owns `trades.jsonl`. Renderer fetches via `ipcMain.handle('trades:list')` on demand and listens to `trade:outcome` / `trade:accepted` events for live updates. Renderer never touches the filesystem — standard Electron security (no Node integration in renderer).

---

## 9. Fired-alert detection

**Mechanism:** main polls TradingView's alert list and diffs against a remembered snapshot. Any alert that transitioned `armed → triggered` becomes one `alert:fired` IPC event.

**Cadence:**
- **LIVE** — every 5 seconds.
- **PREP / idle** — every 30 seconds.
- **REVIEW / market closed** — off.

(Per poll: one CDP call via `tv alert list`; cheap.)

**State:** in-memory map `{alert_id → last_known_status}`. On each tick:
1. Run `tv alert list`.
2. Diff new statuses against the map.
3. For each `armed → triggered` transition, emit `alert:fired` with `{id, price, label, fired_at, level_kind}`.
4. Update the map.

**At app start:** snapshot the current alert list *without* firing events. Anything already triggered before app launch is history, not a signal.

**Renderer behavior:**
- A subtle in-app toast (prototype already has the `AlertToast` component).
- A new entry in the fired-alerts feed (compact list, always reachable per design spec §10).
- Audio / native OS notifications are deferred — v1 is in-app visual only.

**Arming paths** (all converge on `tv alert create`):
- PREP key-level row → click → arm alert.
- Conversation price-click — trader clicks a price Claude named in prose → renderer sends `alert:arm` → main calls `tv alert create`.
- Claude's `tv_alert_create` tool — Claude arms on its own when appropriate.

**Claude's reaction to fires is implicit:** the bar after an alert fires is the bar the loop reads. The price action *is* what made the alert fire, so Claude comments on it as part of its normal per-bar read. No special wiring to inject alert events into the conversation.

**Health:** if the alert poll fails (CDP error, TV Desktop not running), main marks the alert subsystem `down` and bubbles to the topbar status.

---

## 10. Build phasing (within v1)

Eight phases, ordered by dependency. Each leaves the app runnable end-to-end at completion. Estimates are ballpark, solo-dev pace.

1. **Shell** (≈2 days). Electron + Vite + React scaffolded under `app/`. Designer's prototype JSX ported in — layout, mode switch, topbar, workstation panels. All mock data. Window opens, modes flip, panels lay out at the right ratios. No chart, no Claude.
2. **Chart** (≈0.5 day). Electron `<webview>` on the left pointing at `tradingview.com`. First-run login flow.
3. **Claude basic** (≈2–3 days). Agent SDK in main. System prompt loaded. IPC bridge wired: type a message → Claude responds → tokens stream into the chat panel. No tools yet.
4. **Claude tools + surfacing** (≈2 days). All tools at once: `tv_analyze_full / fast`, `tv_alert_create / list`, `surface_setup`, `surface_no_trade`. Setup cards render in the workstation rail. Manual conversation only. **Usable milestone:** trader can run PREP + manual LIVE inside the app.
5. **Live loop** (≈1–2 days). Bar-close detector spawned on LIVE; each event a Claude turn. Baseline refresh on 15-min staleness. Phase-aware messages. Loop-health pill.
6. **Trade tracking** (≈2–3 days). Accept / Reject controls. `trades.jsonl` writer. The outcome checker module + `tv trades tick` CLI. Outcome ticks on every bar close. "Taken trade" card. Sizing display. **Usable milestone:** v1 complete — vertical slice runs end-to-end.
7. **Fired alerts** (≈1 day). Poll-and-diff. Toast + feed. Subsystem health.
8. **Polish** (≈1–2 days). Mode-switch suggestions from the ET clock. Crash-resume. Keyboard shortcuts, error toasts, detector auto-restart with backoff, dev-mode smoke.

**Total: ≈12–17 working days for v1.**

---

## 11. Out of scope for v1

- **REVIEW mode** — session journal, replay-transport controls, past-sessions library. Substantial UI surface; no urgent value vs. trading live. Next major phase after v1.
- **Packaging** — v1 runs from source (`npm run dev`). DMG / notarization / auto-update is polish after the app is proven in daily use.
- **Broker-API reconciler** — bar-close inference is sufficient. Tradovate (or whichever broker) adapter slots in later as opt-in.
- **Multi-instrument** — one symbol at a time, per design spec §4.
- **Audio / native OS notifications** for fired alerts — in-app visual only.
- **Trade editing / cancellation** of accepted trades — Accept is committal in v1. Edits are a later refinement.

---

## 12. Open implementation details

Things to settle during the build, not blocking the plan:

- **Exact Agent SDK package name + initialization API.** Confirm against `code.claude.com/docs/en/agent-sdk/typescript` at implementation time; current best guess is `@anthropic-ai/claude-agent-sdk`.
- **Sizing rules concrete numbers.** Read `docs/strategy/trading-strategy-2026.md` Step 7 for the A+/B × DOW grid; encode in `cli/lib/sizing.js`.
- **Crash-resume semantics for the SDK session.** Does the SDK persist message history automatically? If yes, on app restart resume by session id; if no, write our own minimal log in `state/session/<date>/<session>/conversation.jsonl`.
- **Same-bar entry-and-TP edge case** — codify the conservative tie-break in `trade-outcomes.js` and add a fixture covering it.
- **Setup id ↔ trade id mapping in the renderer** — when a setup is accepted, the renderer transforms the original setup card into a taken-trade card (not duplicate it).
- **Process supervision detail** — auto-restart of the bar-close detector mid-LIVE: simple exponential backoff in main, surface a banner if it ever stays down.
- **Prompt-source consolidation** — v1 copies `.claude/commands/analyze.md` into `app/main/prompts/analyze.md`. Post-v1, split into a shared core (ICT vocab + behavioral rules) and per-consumer wrappers (slash-command vs Agent SDK) to avoid drift.

---

## 13. References

- Design spec: [`2026-05-22-trading-workstation-design.md`](2026-05-22-trading-workstation-design.md)
- Usage workflow: [`2026-05-22-trading-workstation-usage-workflow.md`](2026-05-22-trading-workstation-usage-workflow.md)
- Strategy: [`../../strategy/trading-strategy-2026.md`](../../strategy/trading-strategy-2026.md) — Lanto's 3-pillar framework + 7-step checklist
- Entry models: [`../../strategy/entry-models.md`](../../strategy/entry-models.md)
- Research (LLM consistency): [`../../research/ai-consistency.md`](../../research/ai-consistency.md)
- Research (LLM trading-analysis accuracy): [`../../research/ai-trading-analysis.md`](../../research/ai-trading-analysis.md)
- Project rules: [`../../../CLAUDE.md`](../../../CLAUDE.md) — hard constraints (port 9223, CLI-only, prose-first, no LLM arithmetic, cite-or-reject, grade enum) carry into the app.
- Designer's prototype: `~/Downloads/Claude trading agent (5)/` — source JSX/CSS for the direct port.
- Agent SDK starters: `vanzan01/claude-agent-sdk-starter`, `pheuter/claude-agent-desktop`.
