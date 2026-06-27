# London demo-day runbook

> The ordered steps for the first live demo (next London) — armed auto-fire on **Tradovate demo**, autonomous,
> Claude-monitored. Goal: [docs/intent/2026-06-27-end-goal.md](intent/2026-06-27-end-goal.md). London opens **03:00 ET**;
> the supervisor auto-arms ~10 min before. Everything here is operational — the engine owns the orders, you own launch + login.

## T-30 min — deploy + backend (do this BEFORE the lead window)

1. **Ship the code that's been validated.** Merge `feat/faithful-lanto-rebuild` → `main`, then **pull the main checkout
   and restart the app** (the running process must be on the deployed SHA — this is the parity keystone).
   - The new guard backs this up: if the running app is behind its on-disk code, the supervisor **refuses to arm** and
     notifies "Live arming BLOCKED — stale code." So a missed restart fails safe (no trade) instead of trading stale.
2. **TV Desktop up on CDP 9225** (the analysis backend). Verify: `curl -s --max-time 4 http://127.0.0.1:9225/json/version`
   returns JSON. If not: `osascript -e 'quit app "TradingView"'` then `open -a TradingView --args --remote-debugging-port=9225`.
   Confirm the chart: `./bin/tv status` → `cdp_connected: true`, the right symbol, `api_available: true`.
3. **Launch the trading app** and confirm the topbar **VER** cell is NOT red (RESTART) — green/dim means current.

## T-15 min — readiness + arm

4. **Capture health** for London (Asia + ETH + 30m), MES + MNQ: the supervisor runs `live-check` in the lead window, or
   run it yourself: `node cli/index.js live-check --session london` → expect clean / only known blockers.
5. **Tradovate demo login** (the 06-24 blocker): log the webview into the **Tradovate demo** account; confirm the account
   shows connected. **No real-money account.**
6. **Arm:** `automationMode=auto`, tap resume-auto, set guardrails (per-trade $ · daily-loss halt · max adds). Confirm the
   LIVE cell shows armed. The supervisor will also auto-arm at the window edge if mode isn't live.

## During the session (03:00–~05:00 ET) — monitor only

7. **Watch (the engine owns orders — hot-fix plumbing only):**
   - bar-close stream + `state/session/<date>/london/setups.jsonl` and `no-trades.jsonl`
   - the fills feed (Tradovate position + fills) and `detector-heartbeat.json` (< 120s)
   - the supervisor events (`supervisor:state` / readiness)
8. **Plumbing defects to hot-fix if they fire** (not strategy): slim-file starvation · unknown-session · missing-ltf-bias ·
   symbol-mismatch · capture-wedge · exec-route. The deterministic chain decides; you keep the pipes open.
9. **Do NOT** override a setup, change a stop/target, or place a manual order. Faithful-to-Lanto first; the bot pulls its
   own trigger.

## Post-session — capture the parity datapoint

10. **Recap:** per-trade (vs what the chain expected) + any defects + fixes.
11. **Grow the parity corpus** — this session ran on current code, so it's a valid same-code datapoint:
    `npm run parity:add <date> london` (the builder refuses if live≠backtest — a clean add is a parity proof). Then
    `npm run parity` to confirm green. Each clean demo session strengthens the keystone toward the real-money gate.

## The gates this demo feeds

- **Parity (keystone):** each clean session adds a `tests/parity/*.parity.json` proof (live ≡ backtest).
- **Faithfulness:** promote the session as a verified day-tape once you've hand-graded it vs Lanto (`npm run tapes`).
- **Real money (later, your call):** when the backtest shows faithful net-positive over a window you trust — parity
  guarantees live reproduces it.
