# Trading Automation v2 — plan + genesis prompt for the new project

> Date: 2026-07-25. Requested by the user: a plan to get maximum trading automation
> with great order-placement tooling, and a prompt that starts a **new** project using
> **this repo as a reference** — taking what this project was trying to do and making
> it actually happen.

---

## Part 1 — Honest assessment of the reference repo

What this project set out to do ([docs/intent/2026-06-27-end-goal.md](../intent/2026-06-27-end-goal.md)):
an autonomous bot trading Lanto's 3-pillar ICT method on a real Tradovate micro
account — deterministic brain, zero LLM in the trade path, backtest≡live parity,
guarded execution, transparent UI.

**What it proved (the assets worth carrying over):**

- The strategy engine works. The deterministic walker chain grades bias and hunts
  MSS/Trend/Inversion setups; on the 2026-H1 corpus it folded **+15.72R (MNQ) /
  +10.03R (MES)** after certified selection (per the 2026-07-10 audit).
- The doctrine is right: deterministic-only trade decisions, no LLM arithmetic,
  guardrails always on, sizing in code, fold-before-enable for every behavior lever.
- The strategy spec in `docs/strategy/` is a complete, buildable definition of the
  method — the most valuable artifact in the repo.
- A large recorded corpus (`state/backtest/`, 200+ sessions, MNQ+MES) exists and can
  be reused as the new engine's validation set.

**What it drowned in (the cost centers the new project must avoid):**

- **TradingView as backend.** TV Desktop driven over CDP 9225, multi-TF chart
  switching to read bars, and a Pine indicator's *rendered table* parsed as the
  evidence bus. Fragile, slow (~13s per full sweep), requires a chart app running
  with debug flags, and poisoned by replay.
- **Execution through a webview.** Orders placed by replaying TradingView's
  internal network messages from an Electron `<webview>`; Tradovate auth **sniffed
  off webview traffic** with no refresh path; position state parsed from the
  account-manager DOM.
- **Electron as load-bearing infrastructure.** The app *is* the bot; supervision,
  detection, and execution all die with the window.
- **Process machinery outpacing the product.** 38k LOC in the main path, 209 test
  files, 59 scripts, 130 docs — and the 2026-07-10 audit still lists as absent:
  durable order intents, boot-time reconciliation, a stop-protection watchdog,
  broker-clock EOD flatten. The safety-critical execution core was built last and
  never finished; everything around it was built first.

**The one-sentence lesson:** the strategy logic was solved; the integration layer
(screen-scraping a chart app for data and order routing) consumed the project.
The new project buys real APIs for both and keeps only the solved parts.

---

## Part 2 — Target architecture (new project)

Headless Node.js service + a control surface. No Electron, no CDP, no Pine, no DOM.

```
┌─────────────────────────────────────────────────────────────────┐
│ Control surface (local web UI or TUI)                           │
│  order ticket · positions · flatten/PANIC · mode arm · review   │
└──────────────┬──────────────────────────────────────────────────┘
               │ reads state / sends intents (never decides trades)
┌──────────────▼──────────────────────────────────────────────────┐
│ Engine core (headless service, survives UI restarts)            │
│  session clock (ET killzones) → bar builder (1m→5m/15m/1H/4H/D) │
│  → evidence engine (swings, FVG, BPR, sweeps, pools, quality)   │
│  → walker brain (bias grade, setup lifecycle, management)       │
│  → execution engine (intents, idempotency, reconciler,          │
│     protection watchdog, EOD flatten, guardrails, sizing)       │
└──────────────┬──────────────────────────────────────────────────┘
               │ official API only
┌──────────────▼──────────────────────────────────────────────────┐
│ Tradovate API (REST + WebSocket)                                │
│  auth with refresh · market data (bars/quotes) · orders · fills │
│  demo env = paper · live env = real money (same adapter code)   │
└─────────────────────────────────────────────────────────────────┘
```

Key decisions and why:

1. **Tradovate official API for both data and execution.** One authenticated
   connection replaces the CDP capture pipeline *and* the webview order path:
   real OAuth-style token renewal (fixes the sniffed-token expiry failure),
   server-authoritative positions/fills (fixes DOM-parsed state and missing
   reconciliation), historical bars for backtests (fixes tape recording).
   Demo environment = paper; live environment = real money, behind the arm gate.
   **M0 must verify current retail API access terms, market-data entitlements,
   and fees before committing.**
2. **Evidence computed in code, not parsed from Pine.** The Pine indicator only
   existed because TradingView held the data. With a real data feed, the
   structures (swings HH/HL/LH/LL, FVG, BPR, sweeps, liquidity pools,
   displacement/ATR quality) are computed directly from bars. The semantics to
   replicate are pinned down in `pine/ict-engine.pine` and
   `cli/lib/ict-engine-parser.js` — port them, then prove parity against the
   recorded corpus (below).
3. **The walker brain ports almost untouched.** `app/main/strategy/walkers/` is
   already pure deterministic functions over bars+evidence. Keep Node.js so this
   is a port, not a rewrite.
4. **Execution safety built FIRST this time.** Durable order intents (crash-safe
   idempotency), boot-time broker↔journal reconciler, continuous stop-protection
   watchdog, EOD flatten on the broker clock — these were the four missing
   blockers (B1–B4) in the old repo's final audit. In v2 they are the foundation
   the ticket and the bot both sit on, not a later phase.
5. **Manual cockpit before automation.** The order ticket (risk $ → auto-sized
   bracket, one-click accept, flatten/PANIC, hotkeys) is useful from the first
   week and exercises the exact execution path the bot later uses. Automation
   levels stack on top: manual → suggest → auto-paper → auto-live.
6. **LLM is an optional sidecar.** Read-only over state: journaling, session
   review, plain-language anomaly explanation. Never in the trade path, never
   does arithmetic, cites data paths — same doctrine as this repo's constraints
   #6/#7 and the end-goal doc. The system must trade correctly with the LLM off.
7. **TradingView demoted to a display option** (or dropped). If the user wants
   TV charts, run the free `lightweight-charts` library over the engine's own
   bar data — no automation of any TV app.

---

## Part 3 — Build plan (phases, each independently useful)

**M0 — API spike (days, go/no-go).** Tradovate demo auth with refresh; stream
MNQ/MES quotes; pull historical 1m bars; place + cancel one paper order; read
positions. Verdict: API covers data + execution, or pick the fallback broker
before any engine code is written. *(This mirrors the old repo's M0 spike
discipline — mechanism decided before engine code exists.)*

**M1 — Data + evidence engine.** Bar builder (1m base → 5m/15m/1H/4H/D, ET
session/killzone clock). Port the ICT evidence semantics. **Acceptance = parity
test:** replay the recorded sessions in `state/backtest/` (and the 7 hand-graded
oracle tapes) through the new evidence engine and show the structures match the
old chain's walker inputs. This is the old parity discipline, cheap: the corpus
already exists.

**M2 — Walker brain port.** Port `walkers/` + grade logic (`pillar1-bias.js`
3-vote grade, near-price draw, leader selection) as pure functions. Acceptance:
fold over the recorded corpus reproduces the reference chain's decisions
(same setups/grades/sides, tolerating evidence-engine deltas documented in M1).

**M3 — Execution core + manual ticket.** Durable intents, idempotency,
reconciler, protection watchdog, broker-clock EOD flatten, guardrails (valid
stop · size within ±$50 · max $/trade · daily-loss halt), sizing
(`floor($risk / (stopPts × pointValue))`, MNQ $2 / MES $5). Ticket UI:
risk-in-$ → sized bracket → one-click → live position card → flatten/PANIC.
Paper (demo env) only.

**M4 — Supervision + automation ladder.** Session supervisor (auto-arm in
killzones, readiness checks), suggest mode (bot proposes, user clicks accept),
then auto-paper. Unattended paper until **5 clean sessions** (zero unresolved
reconciliation/protection events) — the old repo's pre-ruled bar.

**M5 — Live arm.** Typed "LIVE" arm + per-session resume, fail-closed account
gate, normal strategy sizing from day one (the old repo's pre-approved ruling).
The LIVE arm is always the user's manual action; the software never self-arms.

**Throughout:** LLM sidecar features (auto-journal, review critique, anomaly
explainer) ship as read-only add-ons whenever convenient.

---

## Part 4 — The genesis prompt (copy everything in the fence into the new project's first session)

```
You are building a personal trading-automation system for a solo ICT futures
day-trader (the owner). It trades MNQ and MES during the London/NY killzones
following Lanto's 3-pillar ICT methodology. The goal: automate the trading as
much as safely possible, and provide excellent manual order-placement tooling
from week one.

A REFERENCE REPO exists at: /Users/agent/This Mac/02_Projects/claude-tradingview-analyser-v2
It is a working-but-overgrown earlier attempt. Treat it as a library to mine,
NOT a codebase to extend. Start the new project in a fresh directory.

READ FIRST, in this order:
1. docs/intent/2026-06-27-end-goal.md   — the north star (autonomy, determinism,
   parity, guardrails). This remains the definition of done.
2. docs/strategy/README.md + daily-bias.md + price-action.md + entry-models.md +
   confirmation.md + risk-and-management.md — the COMPLETE strategy spec. This is
   the authority on what to trade. Do not invent ICT concepts outside it.
3. docs/research/ai-trading-analysis.md + ai-consistency.md — why the hard rules
   below exist (LLMs hallucinate levels, miscompute arithmetic, are miscalibrated).
4. docs/plans/2026-07-25-trading-automation-v2.md — the assessment + architecture
   + phase plan for this new project. Follow it.
5. Then mine the code: app/main/strategy/walkers/ (the deterministic setup brain —
   port these pure functions), cli/lib/pillar1-bias.js (3-vote grade), cli/lib/
   ict-engine-parser.js + pine/ict-engine.pine (evidence semantics to reimplement),
   cli/lib/sizing.js (position sizing), app/main/execution/guardrails.js +
   account-gate.js (guardrail + arming doctrine), docs/superpowers/specs/
   2026-06-15-execution-engine-design.md (execution design; keep the doctrine,
   replace the mechanism).

HARD RULES (non-negotiable, inherited from the reference project):
- Zero LLM in the trade path. All trade decisions are deterministic code. The
  system must place correct trades with every LLM down. LLM features (journal,
  review, explanations) are read-only sidecars.
- No LLM arithmetic anywhere: sizing, R:R, stops, ATR — computed in code only.
- Every numeric price surfaced to the user cites its data source path.
- Grade enum is exactly A+ | B | no-trade. No other confidence vocabulary.
- Guardrails always on: valid stop required, size within ±$50 of target risk,
  max $/trade cap, daily-loss halt, EOD flatten on the broker clock.
- Paper first. Real money only behind a deliberate typed LIVE arm + per-session
  resume, fail-closed. The software never arms real money itself — that is the
  user's manual action, always.
- Every strategy-behavior change is a default-off lever, folded old-vs-new over
  the corpus before enabling, one at a time. Faithful-to-Lanto beats P&L.

ARCHITECTURE (per the plan doc — the short version):
- Headless Node.js service (no Electron, no CDP, no Pine, no DOM scraping).
- ONE official broker API for market data + execution: Tradovate (REST +
  WebSocket; demo env = paper, live env = real). Auth with proper token refresh.
  M0 spike verifies current API access terms before any engine code is written.
- Evidence (swings/FVG/BPR/sweeps/pools/quality) computed in code from bars —
  port the semantics from the reference repo's Pine + parser, do not scrape it.
- Walker brain ported as pure functions; validated by replaying the reference
  repo's recorded corpus (state/backtest/) and oracle tapes until decisions match.
- Execution core FIRST: durable order intents, idempotency, boot-time
  broker↔journal reconciler, continuous stop-protection watchdog, broker-clock
  EOD flatten. (These were the missing blockers in the old repo — build them
  before anything that fires orders.)
- Control surface (local web UI or TUI): risk-$ ticket → auto-sized bracket →
  one-click place, position card, FLATTEN, PANIC, mode display, typed LIVE arm.
  Charts via the open-source lightweight-charts library over our own bar data.

BUILD ORDER (each phase ships something usable):
M0 API spike (go/no-go) → M1 data+evidence with corpus-parity tests →
M2 walker port reproducing reference decisions on the corpus →
M3 execution core + manual ticket on paper →
M4 supervisor + suggest mode + auto-paper (bar: 5 clean unattended sessions) →
M5 live arm. LLM sidecar features slot in anywhere, read-only.

Start with M0. Verify Tradovate demo auth + market data + one paper order
end-to-end, report the verdict and any access/terms blockers, then stop and
present the M1 plan.
```

---

## Part 5 — What deliberately did NOT carry over

- The certification/parity bureaucracy (eight-gate verdicts, SHA-bound approval
  records). The *discipline* carries over (corpus folds, parity tests, 5 clean
  paper sessions); the machinery gets rebuilt only as big as a one-user tool needs.
- Electron + the Raycast design system. The control surface is functional first;
  if it earns polish later, DESIGN.md/PRODUCT.md are still there to mine.
- TradingView entirely, unless the user wants it back as a dumb display.
- The `/analyze` LLM command surface. Manual analysis was a workaround for not
  having a trustworthy bot; the new project's answer to "what do you see?" is the
  walker's own state, rendered directly.

## Open questions for the user

1. **Broker API verdict** — if M0 finds Tradovate retail API access unsuitable
   (terms, cost, entitlements), the fallback is keeping the old repo's sniffed-token
   adapter as a stopgap behind the same adapter interface, or evaluating another
   futures broker with a real API. Decide on M0 evidence.
2. **Control surface** — local web UI vs terminal TUI (the old repo already has a
   Go TUI pattern in `cmd/tv-dash/` if the terminal is preferred).
3. **Scope of v1 automation** — is "suggest mode + manual accept" enough for the
   first live month, with full AUTO paper-proven alongside? (Recommended: yes.)
