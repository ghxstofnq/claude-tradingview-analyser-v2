<!-- Provenance: authored by Hermes on 2026-07-09 as .hermes/plans/2026-07-09_201121-app-and-trading-bot-improvement-plan.md; committed verbatim on 2026-07-10 as the execution backbone absorbed by docs/intent/2026-07-10-unified-goal.md. -->

# App and Trading Bot Improvement Implementation Plan

> **For Hermes:** Use `ctv-v2-agentic-coding-workflow` plus subagent-driven development to implement this plan one PR at a time. Each PR must run in an isolated worktree, receive strategy/spec review before code review, and merge only after the required gates pass.

**Goal:** Turn the existing Command Shell and deterministic trading engine into a trustworthy operator workstation and a fail-closed autonomous bot whose live behavior, backtests, broker state, and UI all tell the same truth.

**Architecture:** Improve the current system incrementally; do not rewrite it. Keep the deterministic walker chain as the only setup producer, keep the LLM out of the trade path, use the recorded corpus for every strategy decision, and make the app an operator view over real engine/broker state rather than a parallel source of calculations.

**Tech Stack:** Electron, React, Node.js, TradingView CDP, Pine ICT Engine V5/schema 4, deterministic walker state machines, Tradovate/TradingView paper adapters, Node test runner, Playwright design harness.

---

## 1. Verified starting point — 2026-07-09

### Repository and test baseline

- Branch: `main`.
- Working tree already contains three unrelated untracked design-harness scripts; leave them untouched:
  - `design-harness/reload-real.mjs`
  - `design-harness/shoot-bt-proto.mjs`
  - `design-harness/shoot-bt3.mjs`
- `npm run test` currently reports **1806 pass / 1 fail**. The failure is the corpus-dependent precondition in `tests/backtest-baseline.test.js:37-43`: the recorded 2026-06-09 bundle has already been refreshed from bullish to bearish, while the test still assumes the old baked bullish vote.
- No renderer component or end-to-end tests were found for `CommandShell`, `BriefingPage`, `LivePage`, `ReviewPage`, `BacktestPage`, `SettingsPage`, `SystemPage`, or `AgentPage`.

### Corpus and current verdict

- `state/backtest/index.json` contains 518 rows.
- The faithful fold currently resolves to 242 usable sessions per symbol.
- Current CLI outputs:
  - MNQ: `+17.65R over 242 sessions`, `ready:true`.
  - MES: `+12.03R over 242 sessions`, `ready:true`.
- The present `computeVerdict` gate in `cli/lib/backtest-verdict.js` requires only:
  1. at least 20 sessions; and
  2. cumulative R greater than zero.
- That is weaker than the real project contract in `docs/intent/2026-06-27-end-goal.md`: the window must be trusted, parity-proven, strategy-faithful, and user-approved. Therefore the green CLI verdict is encouraging evidence, **not yet sufficient authority to arm real money**.
- The index also contains duplicate date/session keys and historical/retry rows. `foldSymbol` filters unusable runs but does not produce a formal certification report explaining exactly why 242 sessions are trusted.

### Product and strategy constraints

- Deterministic walker chain remains the single setup brain.
- Backtest and live must fold the same truth function over equivalent inputs.
- LLMs may explain, narrate, and journal; they must not create, veto, grade, or route trades.
- UI values must come from deterministic engine, broker, or journal state; no fake health indicators or illustrative numbers presented as live truth.
- Strategy authority is `docs/strategy/*.md` plus `docs/strategy/transcripts/`.
- Strategy changes must be implemented as default-off levers, folded across the full MNQ+MES corpus, and hand-reviewed for every moved session before enablement.

---

## 2. Priority order

1. **P0 — Make the evidence and go-live verdict honest.** A red test suite or an under-specified corpus gate invalidates every later claim.
2. **P0 — Close execution lifecycle and restart/reconciliation risk.** Broker truth, stop protection, ambiguous submissions, and recovery outrank UI polish.
3. **P1 — Make the app an operational truth surface.** The app should show readiness, stale data, reconciliation, and current risk without decorative guesses.
4. **P1 — Add renderer workflow and failure-recovery tests.** Visual fidelity is already strong; interaction and degraded-state coverage are the missing confidence layer.
5. **P1 — Improve strategy faithfulness one lever at a time.** Never bundle several strategy changes into one result.
6. **P2 — Extend the trusted domain to SMT and London.** The current gate corpus proves NY single-symbol folds; the end goal also requires daily MNQ/MES selection and London.

---

# Phase A — Restore a clean, reproducible evidence baseline

## Task A1: Remove mutable-corpus assumptions from the unit suite

**Objective:** Make `npm run test` deterministic whether or not `state/backtest/` exists and regardless of which corpus revision is currently on disk.

**Files:**
- Modify: `tests/backtest-baseline.test.js:20-44`
- Test helper, if needed: `tests/helpers/backtest-fixtures.js`

**Steps:**
1. Replace the 2026-06-09 corpus precondition with a small test-owned bundle containing a deliberately stale HTF vote and the minimum fields `recomputeGate` needs.
2. Assert the fixture starts bullish, call `recomputeGate`, and assert the current lever resolves bearish.
3. Keep the real-corpus check as a separate optional integration script, not a unit test whose expected input changes when the corpus is refreshed.
4. Run `node --test tests/backtest-baseline.test.js` and confirm it passes with and without `state/backtest/` present.
5. Run `npm run test` and require zero failures before starting any feature branch.

**Acceptance criteria:**
- `npm run test` is green.
- Moving or refreshing `state/backtest/` cannot change unit-test results.
- No production behavior changes.

**Suggested commit:** `test(backtest): remove mutable corpus precondition`

## Task A2: Add a first-class corpus certification report

**Objective:** Produce a deterministic report that proves the corpus matches the committed manifest instead of inferring trust from “sessions >= 20.”

**Files:**
- Create: `cli/lib/corpus-certification.js`
- Create: `tests/corpus-certification.test.js`
- Modify: `cli/commands/backtest.js`
- Modify: `docs/gate-corpus-manifest.md`

**Certification input:**
- `state/backtest/index.json`
- Each selected run’s `tape.json`, `brief-bundle.json`, and first/last entries
- `docs/gate-corpus-manifest.md` constants, moved into code as a small explicit config object:
  - start `2026-01-10`
  - end `2026-07-03`
  - symbols `MNQ1!`, `MES1!`
  - sessions `ny-am`, `ny-pm`
  - schema `4`
  - `code_rev=1`
  - expected holiday/early-close exceptions

**Report shape:**

```js
{
  certified: false,
  manifest_id: "gate-corpus-2026-h1-v1",
  symbols: {
    "MNQ1!": { expected: 242, valid: 242, missing: [], duplicates: [], invalid: [] },
    "MES1!": { expected: 242, valid: 242, missing: [], duplicates: [], invalid: [] }
  },
  parity: { certified: true, artifact: "...", hard_mismatches: 0 },
  blockers: []
}
```

**Steps:**
1. Write failing tests for missing sessions, duplicate valid sessions, wrong symbol, wrong schema, wrong `code_rev`, data-gap runs, missing tape, and the documented 2026-07-03 PM early-close exception.
2. Build a canonical selector that chooses one valid run per `symbol + date + session` and records rejected/retry rows explicitly.
3. Require every selected tape entry to carry schema 4 and `code_rev=1`; do not certify a run by checking only the first bar.
4. Require an explicit parity-certificate artifact generated by `scripts/gate-corpus/parity-diff.py`; do not treat prose in the manifest as machine state.
5. Add `./bin/tv backtest certify` with machine-readable JSON output and nonzero exit on failure.
6. Add a human-readable compact summary to `docs/gate-corpus-manifest.md` after certification.

**Acceptance criteria:**
- Certification explains exactly which 242 sessions were selected for each symbol.
- Retries/duplicates are visible but cannot inflate session count or R.
- Any wrong schema/code revision/data-gap/missing session makes `certified:false`.
- Running certification twice without file changes is byte-stable except for an optional separate `checked_at` field.

**Suggested commit:** `feat(backtest): certify the real-money corpus`

## Task A3: Replace the simplistic go-live verdict with a gate composition

**Objective:** Make “READY” mean the end-goal contract, not only positive R.

**Files:**
- Modify: `cli/lib/backtest-verdict.js`
- Modify: `cli/commands/backtest.js`
- Modify: `app/main/backtest-baseline.js`
- Modify: `app/renderer/src/BacktestPopover.jsx`
- Modify: `tests/backtest-verdict.test.js`
- Modify: `tests/backtest-cli.test.js`

**New verdict inputs:**
- `tests_green`
- `corpus_certified`
- `parity_certified`
- `strategy_review_state` (`approved | pending | rejected`)
- `cum_r`
- `sessions`
- `user_approved_window`

**Verdict rules:**
- Any failed mechanical gate → `BLOCKED`.
- Mechanical gates green but strategy/user review pending → `REVIEW_REQUIRED`.
- Certified and net non-positive → `NOT_READY`.
- Certified, parity-proven, net positive, and user-approved → `NET_POSITIVE_APPROVED`.
- Keep cumulative R as evidence; never let R override a failed fidelity/parity gate.

**Steps:**
1. Write table-driven tests for every combination above.
2. Change the CLI to print a `gates[]` array with status, evidence path, and reason.
3. Update the Backtest page hero to show the same gate list from the same helper.
4. Persist user approval as a small audit record under `state/backtest/approvals/`, containing corpus manifest id, code SHA, symbol, timestamp, and note; never infer approval from clicking “run.”
5. Invalidate approval automatically when corpus manifest id, code SHA, or selected strategy lever set changes.

**Acceptance criteria:**
- CLI and GUI render identical verdicts from identical inputs.
- Current `+17.65R` / `+12.03R` cannot display as real-money approved until corpus, parity, and user approval are present.
- Approval is auditable and invalidated by code/data drift.

**Suggested commit:** `feat(backtest): compose the real-money readiness gate`

---

# Phase B — Make execution fail closed across submit, fill, restart, and exit

## Task B1: Add a durable order-intent lifecycle and idempotency key

**Objective:** Prevent duplicate orders and make every ambiguous submit recoverable.

**Files:**
- Create: `app/main/execution/order-intent.js`
- Create: `tests/order-intent.test.js`
- Modify: `app/main/execution/tranche-manager.js`
- Modify: `app/main/ipc-execution.js`
- Modify: `app/main/execution/tradovate-adapter.js`
- Modify: `app/main/execution/tv-adapter.js`

**Lifecycle:**

```text
INTENT_CREATED -> SUBMITTING -> BROKER_ACKNOWLEDGED -> POSITION_CONFIRMED -> STOP_CONFIRMED
                                  |                     |
                                  +-> REJECTED          +-> RECOVERY_REQUIRED
```

**Steps:**
1. Define a stable `decision_id` from packet id + account id + session + side; use it for manual and auto paths.
2. Persist `INTENT_CREATED` atomically before the first broker write.
3. Persist broker order ids and raw normalized acknowledgements after each call.
4. On timeout/connection close, mark state `UNKNOWN`, then reconcile by account/instrument/recent time before retrying; never blindly resubmit.
5. Reject a second active intent with the same `decision_id`.
6. Add tests for duplicated events, process restart between every transition, timeout after broker acceptance, rejection, and partial bracket creation.

**Acceptance criteria:**
- Replaying the same packet cannot open a second position.
- A process crash at any lifecycle point has a deterministic recovery decision.
- No catch block converts unknown broker state to success or flat.

**Suggested commit:** `feat(execution): persist idempotent order intents`

## Task B2: Add boot-time broker/journal reconciliation

**Objective:** On every launch, prove that broker position, protective stop, working target, local journal, and account routing agree before enabling new entries.

**Files:**
- Create: `app/main/execution/reconciler.js`
- Create: `tests/execution-reconciler.test.js`
- Modify: `app/electron-main.js`
- Modify: `app/main/execution/trading-feed.js`
- Modify: `app/main/execution/tradovate-adapter.js`
- Modify: `app/main/execution/auto-resume.js`
- Modify: `app/main/health.js`

**Reconciliation matrix:**
- Journal flat + broker flat → healthy.
- Journal open + broker flat → close journal from confirmed broker fills.
- Journal flat + broker open → block auto, surface orphan position, require adopt/flatten.
- Broker open + no protective stop → critical; block entries and require immediate protect/flatten action.
- Broker open + stop exists + journal agrees → management-only mode; keep new auto entries paused until explicit resume.
- Broker read unavailable → unknown; fail closed.

**Steps:**
1. Write the pure reconciliation matrix tests first.
2. Add broker-specific read adapters returning explicit `ok | flat | error`, never overloaded `null`.
3. Run reconciliation before `setAutoResumed` can become true.
4. Persist the last reconciliation result and evidence timestamp.
5. Emit one loud `app:error` for critical states and expose them through health IPC.
6. Provide only safe operator actions: `ADOPT`, `PROTECT`, `FLATTEN`, `RETRY`; destructive actions require a confirmation.

**Acceptance criteria:**
- The app cannot report “ready” while broker state is unknown.
- An open broker position without a working stop is impossible to hide behind a healthy detector heartbeat.
- Restarting during an open trade resumes management without allowing a duplicate entry.

**Suggested commit:** `feat(execution): reconcile broker and journal on boot`

## Task B3: Add continuous stop-protection and broker-auth watchdogs

**Objective:** Detect dangerous drift after boot, not only at order placement.

**Files:**
- Create: `app/main/execution/protection-watchdog.js`
- Create: `tests/protection-watchdog.test.js`
- Modify: `app/main/session-supervisor.js`
- Modify: `app/main/health.js`
- Modify: `app/main/execution/tradovate-adapter.js`
- Modify: `app/main/execution/tv-adapter.js`

**Checks while a position exists:**
- broker read is fresh;
- account and instrument match the armed route;
- aggregate protective-stop quantity covers position quantity;
- stop is on the protective side of price;
- working target/exit orders cannot reverse the position;
- authentication is valid;
- journal and broker quantities agree.

**Steps:**
1. Implement checks as pure functions with adversarial fixtures.
2. Poll independently from the bar detector so a dead chart loop cannot disable protection monitoring.
3. On loss of stop/auth/position truth, pause new entries immediately and show `RECOVERY REQUIRED`.
4. Do not auto-flatten on a single ambiguous read; confirm state, then use a typed recovery policy.
5. Record every intervention and result in the execution journal.

**Acceptance criteria:**
- A position-without-stop condition becomes visible within one watchdog interval.
- A failed recovery action remains red/unknown; it is never shown as completed.
- Watchdog failure itself is a readiness blocker.

**Suggested commit:** `feat(execution): monitor live stop protection`

## Task B4: Make EOD and emergency management independent of the analysis loop

**Objective:** Ensure a chart/LLM/detector failure cannot prevent required exit management.

**Files:**
- Modify: `app/main/trade-ticker-watchdog.js`
- Modify: `app/main/session-supervisor.js`
- Modify: `app/main/execution/reconciler.js`
- Modify: `tests/trade-ticker-watchdog.test.js`
- Create or extend: `tests/execution-chaos-replay.test.js`

**Steps:**
1. Add a broker-clock EOD action that runs independently of bar-close events.
2. Test app restart at 15:59, broker timeout at 16:00, stale journal tail, and restart after an unknown flatten result.
3. Reconcile after every flatten/cancel rather than trusting the mutation acknowledgement alone.
4. Keep live-auto paused after any unresolved emergency state.

**Acceptance criteria:**
- EOD close remains attempted and verified when the detector is stopped.
- “Flattened” is displayed only after a confirmed flat broker read.
- Chaos replay tests cover timeout, duplicate event, torn JSONL tail, stale auth, and restart.

**Suggested commit:** `fix(execution): decouple emergency exits from bar capture`

---

# Phase C — Make the app an operational truth surface

## Task C1: Add a unified Readiness card to System and Backtest

**Objective:** Give the user one decision-ready view of whether the bot is safe to observe, paper trade, or arm.

**Files:**
- Create: `app/main/readiness.js`
- Create: `tests/readiness.test.js`
- Modify: `app/main/ipc.js` or the existing system IPC registration
- Modify: `app/preload.js`
- Modify: `app/renderer/src/shell/pages/SystemPage.jsx`
- Modify: `app/renderer/src/BacktestPopover.jsx`

**Readiness rows:**
- tests/build
- running code vs disk/origin
- TradingView/Pine schema and `code_rev`
- detector bar-data freshness
- corpus certification
- parity certificate
- strategy approval
- broker/account confirmation
- broker reconciliation
- protective stop coverage
- automation mode and post-restart auto pause

**Steps:**
1. Implement a pure readiness reducer: any critical red blocks arming; warnings may allow paper/manual only.
2. Expose evidence and age for every row.
3. Use the same readiness object in System, Backtest, and Settings.
4. Add direct actions only where a real backend action exists: rerun test, retry broker read, restart detector, revert to SIM, open certification report.

**Acceptance criteria:**
- No page invents its own definition of “ready.”
- Every row has a source and timestamp.
- Red state remains visible until the underlying read proves recovery.

**Suggested commit:** `feat(app): surface one readiness truth`

## Task C2: Remove remaining misleading literals and illustrative numbers

**Objective:** Ensure safety-relevant UI text matches the actual mode and data.

**Files:**
- Modify: `app/renderer/src/shell/pages/SystemPage.jsx:91-96`
- Modify: `app/renderer/src/shell/pages/SettingsPage.jsx:102-108,188`
- Modify: `app/renderer/src/shell/pages/LivePage.jsx:35-39`
- Tests: `tests/command-shell-copy-contract.test.js`

**Known items:**
1. `SystemPage` currently renders `IPC bridge = ok` as a literal. Replace it with a real preload/IPC health probe or remove the row.
2. `SettingsPage` currently computes an example contract count from a fixed `24.25` point stop. Replace it with the latest server-side order preview, or label it explicitly as an example and keep it out of readiness/risk totals. Preferred: real preview.
3. `LivePage` footer says “fires only after your accept,” which is false in AUTO mode. Render mode-aware text:
   - MANUAL/SUGGEST: requires acceptance.
   - AUTO: can fire automatically when all deterministic and risk gates pass.
4. Audit every green dot and money number in the Command Shell using `docs/ui-fidelity-audit.md` methodology.

**Acceptance criteria:**
- No hardcoded green health indicator remains.
- No example stop/contract number appears as current risk.
- Manual, suggest, and auto copy exactly match the execution path.

**Suggested commit:** `fix(app): remove misleading operational literals`

## Task C3: Make Live a broker/engine reconciliation timeline

**Objective:** Let the user see exactly where a trade is between deterministic decision and confirmed protection.

**Files:**
- Modify: `app/renderer/src/LivePopover.jsx`
- Modify: `app/renderer/src/shell/pages/LivePage.jsx`
- Modify: `app/renderer/src/hooks/useExecutionState.js`
- Create: `app/renderer/src/hooks/useOrderIntent.js`
- Tests: `tests/live-order-lifecycle-helpers.test.js`

**Timeline:**

```text
SETUP CONFIRMED -> RISK PASSED -> ORDER SENT -> FILL CONFIRMED -> STOP WORKING -> MANAGED -> CLOSED
```

**Steps:**
1. Render lifecycle state from the durable order-intent record, not local button state.
2. Show broker vs journal quantity and stop coverage side by side when in trade.
3. Add source-age chips for price, position, orders, and engine inputs.
4. When a flatten/BE/trail/cancel call returns unknown or fails, keep the position visible and show a persistent recovery action.
5. Never calculate unrealized P&L for `pending_entry`; show PENDING until fill confirmation.

**Acceptance criteria:**
- A user can distinguish submitted, filled, protected, and reconciled states.
- A failed exit cannot look flat.
- Stale feed state is visually different from a live position.

**Suggested commit:** `feat(live): show the verified order lifecycle`

## Task C4: Separate simulated, journal, and executed performance in Review

**Objective:** Prevent backtest/journal R from being mistaken for broker-executed performance.

**Files:**
- Modify: `app/renderer/src/shell/pages/ReviewPage.jsx`
- Modify: `app/renderer/src/Review.helpers.js`
- Modify: `app/main/review.js`
- Tests: `tests/review-helpers.test.js`

**Views:**
- `EXECUTED`: broker fills, fees/slippage when available.
- `JOURNAL`: intended packet levels and deterministic outcome.
- `BACKTEST`: corpus/fold analytics.

**Steps:**
1. Tag every aggregate with its data domain.
2. Show slippage/difference only when both planned and executed values exist.
3. Add per-trade evidence links: packet, order intent, fill, stop verification, outcome.
4. Keep the existing concise ledger, but make discrepancies first-class rather than hiding them in prose.

**Acceptance criteria:**
- No “REAL FILLS” label can be backed by simulated ticker R.
- The user can trace any live result from packet to broker close.

**Suggested commit:** `feat(review): separate planned and executed truth`

## Task C5: Add page-level failure containment and stale-state behavior

**Objective:** Keep emergency controls available when one renderer surface crashes or a feed goes stale.

**Files:**
- Modify: `app/renderer/src/App.jsx`
- Modify: `app/renderer/src/ErrorBoundary.jsx`
- Modify: `app/renderer/src/hooks/useExecutionState.js`
- Modify: `app/renderer/src/hooks/useHealth.js`
- Tests: new renderer contract tests in Task D1

**Steps:**
1. Wrap Live, Orders, Settings, System, Backtest, Agent, and status line in independent error boundaries.
2. Give Live/Orders a minimal fallback with `RETRY`, `OPEN SYSTEM`, and broker-confirmed `FLATTEN` where possible.
3. Add `updated_at` and stale/error state to polling hooks; do not keep old green state indefinitely after failed reads.
4. Test that crashing Agent or Review does not remove Live/Orders controls.

**Acceptance criteria:**
- A non-trading page crash cannot blank trade-management controls.
- Frozen broker/position data changes to STALE/UNKNOWN after the allowed age.

**Suggested commit:** `fix(app): contain page crashes and stale feeds`

---

# Phase D — Add renderer workflow, keyboard, and degraded-state tests

## Task D1: Build a deterministic Command Shell integration harness

**Objective:** Test the real user workflow rather than only pure helpers and CSS tokens.

**Files:**
- Create: `design-harness/command-shell-smoke.mjs`
- Create: `design-harness/fixtures/command-shell-state.json`
- Create: `tests/command-shell-contract.test.js`
- Modify: `package.json`
- Modify only if required: `app/renderer/src/main.jsx` to support a test-only fixture adapter guarded by an explicit test environment flag

**Scenarios:**
1. Briefing loaded, deterministic grade/draw/quality visible.
2. Setup surfaced in MANUAL; accept/reject buttons operate.
3. AUTO mode copy and readiness blockers render correctly.
4. Pending order does not show P&L.
5. Filled position with stop shows protected.
6. Filled position with missing stop shows critical recovery.
7. Feed goes stale while position exists.
8. Review distinguishes journal vs executed values.
9. Backtest certification fails one gate.
10. One page throws and Live remains usable.

**Steps:**
1. Create a preload-compatible, test-only state adapter; production builds must not load fixture state.
2. Launch the renderer at fixed dimensions with Playwright.
3. Exercise `⌘1`–`⌘7`, `⌘K`, `Esc`, and the global flatten confirmation path.
4. Assert semantic state and key text; use screenshots only for visual regression evidence.
5. Add `npm run test:ui` and include it in the broad CI gate once stable.

**Acceptance criteria:**
- The workflow suite runs without a live broker, TradingView session, or LLM.
- It verifies interactions, degraded states, keyboard navigation, and emergency-control persistence.
- Production code cannot accidentally enable the fixture adapter.

**Suggested commit:** `test(app): add Command Shell workflow harness`

## Task D2: Complete accessibility and keyboard behavior

**Objective:** Make all Command Shell controls keyboard-operable and semantically testable.

**Files:**
- Modify: `app/renderer/src/a11y.js`
- Modify: `app/renderer/src/shell/pages/*.jsx`
- Modify: `app/renderer/src/BacktestPopover.jsx`
- Modify: `app/renderer/src/app.css`
- Tests: `tests/command-shell-a11y-contract.test.js`

**Steps:**
1. Replace clickable spans that act as buttons/tabs with real buttons where layout permits; otherwise enforce role, tabindex, Enter, and Space consistently through `clickable`.
2. Add tablist/tab semantics to segmented controls.
3. Add focus trapping/restoration for Page and command palette.
4. Add visible focus styles using DESIGN.md tokens.
5. Run the Impeccable detector and `node design-harness/shoot.mjs`; resolve only findings that improve the active Raycast design system.

**Acceptance criteria:**
- Every action can be reached without a mouse.
- Focus returns to the opener when a page closes.
- No UI control relies only on color or a glyph for its meaning.

**Suggested commit:** `fix(app): complete Command Shell keyboard semantics`

---

# Phase E — Improve strategy faithfulness through controlled experiments

## Task E1: Reconcile strategy documentation with current code before changing behavior

**Objective:** Remove stale “implemented/missing” statements so future work starts from one accurate target.

**Files:**
- Modify: `docs/strategy/daily-bias.md`
- Modify: `docs/strategy/price-action.md`
- Modify: `docs/strategy/entry-models.md`
- Modify: `docs/strategy/confirmation.md`
- Modify: `docs/strategy/risk-and-management.md`
- Modify: `docs/strategy/lanto-source-of-truth.md`
- Create: `docs/audits/2026-07-09-current-strategy-gap-matrix.md`

**Steps:**
1. Trace each implementation-status statement to current code and tests.
2. Mark each item `MATCH`, `PARTIAL`, `MISSING`, or `INTENTIONAL DIVERGENCE` with exact file/test evidence.
3. Resolve the runner-management contradiction explicitly: current production does not import `deriveRunnerStructure`; decide whether faithful behavior is structural trail or fixed BE→TP2 before coding either.
4. Record current known entry-model gaps from `entry-models.md`: MSS significance/reversal-speed, multi-alignment entry, and 5m-gap preference.
5. Do not use retired callout-derived files as authority.

**Acceptance criteria:**
- Docs describe current behavior accurately.
- Every proposed strategy lever has a transcript/spec citation and a measurable expected effect.

**Suggested commit:** `docs(strategy): reconcile implementation status with current engine`

## Task E2: Add a reusable lever evaluation report

**Objective:** Make every strategy experiment attributable and reviewable.

**Files:**
- Create: `scripts/evaluate-strategy-lever.mjs`
- Create: `tests/strategy-lever-report.test.js`
- Modify: `app/main/backtest-baseline.js` only if a shared fold hook is needed
- Output: `state/backtest/tests/<lever-id>.json`

**Report requirements:**
- baseline manifest id and code SHA;
- treatment code SHA and exact effective lever set;
- MNQ and MES total delta;
- every moved date/session;
- packet/model/side/entry/stop/target/grade changes;
- no-trade ↔ trade changes;
- user decision per moved session;
- final `approved | rejected | needs_review`.

**Acceptance criteria:**
- No lever can be enabled merely because aggregate R improved.
- A moved session stays pending until chart/transcript evidence and user review resolve it.
- Lever evaluation is repeatable from the certified corpus without new chart capture when evidence fields already exist.

**Suggested commit:** `feat(strategy): standardize full-corpus lever evaluation`

## Task E3: Evaluate strategy gaps individually, in this order

### E3a — 5-minute gap preference

**Rationale:** Canonical `docs/strategy/entry-models.md:181-188` explicitly prefers 5m gaps when choosing among valid arrays; current entries hunt primarily on 1m.

**Likely files:**
- `app/main/strategy/context/build-strategy-context.js`
- `app/main/strategy/walkers/*-lifecycle.js`
- `app/main/strategy/walkers/execution-packet.js`
- new focused tests under `tests/`

**Gate:** Default off → full certified fold → review every moved session → user approval → only then default on.

### E3b — MSS significance and reversal-speed comparison

**Rationale:** `docs/strategy/entry-models.md:192-198` says a valid MSS needs significant swept liquidity and reversal speed matching/exceeding the prior leg; current evidence does not fully encode that comparison.

**Likely files:**
- `pine/ict-engine.pine`
- `cli/lib/ict-engine-parser.js`
- `app/main/strategy/walkers/mss-lifecycle.js`
- `tests/ict-engine-parser.test.js`
- new MSS significance tape tests

**Gate:** Additive Pine fields first, deploy and stamp new `code_rev`, record parity evidence, then fold a new certified corpus revision or dual-emitted evidence. Never reinterpret old bars as if they contained the new evidence.

### E3c — Multi-alignment entry

**Rationale:** The strategy permits a 5m gap rebalance plus a 1m inversion as a special A+ elevator on an already-aligned day; this is currently incomplete.

**Likely files:**
- `app/main/strategy/walkers/deterministic-strategy.js`
- `app/main/strategy/walkers/execution-packet.js`
- `app/main/strategy/context/*`
- focused oracle/tape tests

**Gate:** Must prove alignment first; must not let a multi-alignment entry override a divergent/no-trade day.

### E3d — Runner management truth

**Rationale:** `docs/strategy/risk-and-management.md:56-72` describes structural trailing, while current production behavior appears to remain stop-to-BE then fixed target. This is a correctness decision, not a cleanup.

**Gate:** User chooses the intended style after a side-by-side fold. Implement live and backtest together in one PR; parity test must cover every transition.

**Acceptance criteria for all E3 work:**
- One behavioral lever per PR.
- Default off until corpus and user approval.
- Exact moved-session report for MNQ and MES.
- `npm run test`, `npm run smoke:fixtures`, tape/replay gates, certification, and determinism checks green.

---

# Phase F — Extend the trusted operating domain

## Task F1: Implement and certify deterministic SMT leader selection

**Objective:** Fulfill the end goal’s MNQ/MES daily selection without letting UI or LLM choose the traded symbol.

**Files likely to change:**
- `app/main/pair-decision.js`
- `app/main/live-ltf-resolver.js`
- `app/main/strategy/context/*`
- `app/main/bar-close.js`
- `tests/*smt*`
- `docs/strategy/daily-bias.md`

**Steps:**
1. Derive exact leader evidence from canonical SMT rules and transcripts.
2. Record both symbols’ packet-time evidence before selecting one.
3. Make selection deterministic, persisted, and identical in live/backtest.
4. Fold both “trade each symbol independently” and “trade selected leader only”; compare without hindsight.
5. Require user review of every day where leader selection changes the executed trade.

**Acceptance criteria:**
- One deterministic leader decision per day/session with cited evidence.
- No LLM or UI state can alter the leader.
- Backtest and live select the same symbol from the same inputs.

## Task F2: Add London corpus and parity certification

**Objective:** Extend trust from NY to the first intended autonomous live session.

**Files likely to change:**
- `scripts/record-corpus.mjs`
- `docs/gate-corpus-manifest.md` or a new versioned London manifest
- `cli/lib/corpus-certification.js`
- `app/main/session-supervisor.js`
- strategy/session tests

**Steps:**
1. Confirm the exact London window from canonical docs/transcripts and reconcile current runtime window differences.
2. Prove live-vs-replay parity on recent London sessions using the same Pine `code_rev`.
3. Record a representative London corpus including no-trade days.
4. Fold, inspect moved/failed sessions, and obtain user approval.
5. Only then allow London AUTO eligibility.

**Acceptance criteria:**
- London has its own certified manifest and parity artifact.
- NY certification remains unchanged.
- Session-specific readiness blocks AUTO outside a certified domain.

---

# 3. Verification matrix

Every implementation PR must run the smallest focused test first, then the full relevant gate.

## Always

```bash
npm run test
```

Expected: zero failures.

## Strategy, analyze, Pine, gates, or packet changes

```bash
npm run smoke:fixtures
npm run tapes
npm run replay
./bin/tv backtest certify
./bin/tv backtest verdict --symbol 'MNQ1!'
./bin/tv backtest verdict --symbol 'MES1!'
```

Expected:
- deterministic gates green;
- certification stays green or intentionally produces a new manifest requiring review;
- every changed session listed in the treatment report;
- no approval carried across a changed SHA/manifest/lever set.

## Execution changes

```bash
node --test tests/order-intent.test.js
node --test tests/execution-reconciler.test.js
node --test tests/protection-watchdog.test.js
node --test tests/tranche-manager.test.js tests/tranche-runtime.test.js tests/tranche-bracket-safety.test.js
npm run test
```

Add fault injection for:
- broker timeout after acceptance;
- clean socket close;
- authentication expiry;
- two consecutive flat reads vs one transient failure;
- missing stop;
- duplicate packet;
- process restart at each lifecycle transition;
- EOD while detector is down;
- torn JSONL tail.

## Renderer/UI changes

```bash
npm run test:ui
node design-harness/shoot.mjs
node ~/.claude/skills/impeccable/scripts/detect.mjs --json app/renderer/src
npm run test
```

Verify at minimum:
- 760×1200 harness;
- full Command Shell desktop viewport;
- dark and light themes;
- keyboard-only navigation;
- stale feed and error states;
- open-position emergency controls survive sibling-page failure.

---

# 4. Recommended PR/worktree sequence

Do not open all workstreams at once. Money-path and evidence PRs change the contracts later UI work should consume.

1. **PR 1 — Baseline + corpus certification**: Tasks A1–A2.
2. **PR 2 — Honest readiness verdict**: Task A3.
3. **PR 3 — Order intent + boot reconciliation**: Tasks B1–B2.
4. **PR 4 — Protection watchdog + independent exits**: Tasks B3–B4.
5. **PR 5 — Readiness UI + misleading-literal cleanup**: Tasks C1–C2.
6. **PR 6 — Live lifecycle + Review truth domains**: Tasks C3–C4.
7. **PR 7 — Renderer failure containment + workflow harness**: Tasks C5, D1–D2.
8. **PR 8 — Current strategy gap matrix + lever report infrastructure**: Tasks E1–E2.
9. **PR 9+ — One strategy lever per PR**: E3a, E3b, E3c, E3d.
10. **Later — SMT leader and London certification**: F1–F2.

For each PR:
1. Hermes and the user confirm the narrow objective.
2. Hermes dispatches Claude Code in an isolated worktree/tmux session.
3. Implementer writes failing tests first.
4. Independent reviewer checks spec/strategy compliance.
5. Second reviewer checks code quality, failure handling, and test adequacy.
6. Run the complete gates required by the verification matrix.
7. Present the diff, test evidence, corpus impact, and unresolved risks to the user.
8. Merge only after explicit user approval; never auto-enable a strategy lever.

---

# 5. Go-live ladder

This is a sequence of evidence, not a date or fixed number of sessions.

1. **Development clean:** full suite green; running SHA matches reviewed code.
2. **Data trusted:** corpus certification green for the exact manifest/code revision.
3. **Decision parity trusted:** live/replay/tape deterministic parity green.
4. **Strategy trusted:** every enabled lever has user-approved moved-session review.
5. **Execution trusted:** order-intent, reconciliation, stop watchdog, EOD, and chaos tests green.
6. **Paper/manual bring-up:** app demonstrates accurate readiness, fills, stops, stale/error states, and review records.
7. **Paper/auto bring-up:** unattended paper execution over a user-approved representative window, with no unresolved reconciliation event.
8. **Live/manual or suggest:** real routing deliberately armed at the lowest user-approved risk; auto remains paused after restart.
9. **Live/auto:** only after the user approves the certified backtest window and the paper execution evidence. Always retain immediate revert-to-SIM and independent position protection.

A positive fold alone must never skip steps 2–7.

---

# 6. Main risks and tradeoffs

- **Overfitting the corpus:** Never choose strategy behavior from aggregate R alone. Review every changed session against packet-time evidence and the canonical strategy.
- **Stale docs driving wrong work:** Complete E1 before strategy changes; several implementation-status paragraphs predate current fixes.
- **Broker ambiguity:** A timeout is unknown, not failed. Reconcile before retrying.
- **UI confidence theater:** A green dot without timestamp/source is worse than no dot. Remove or ground it.
- **Paper/live differences:** Use broker-specific adapters but a shared intent/reconciliation contract.
- **Pine evidence changes:** New signal evidence requires a new `code_rev` and parity/corpus certification; do not silently fold old tapes under new semantics.
- **Scope growth:** Keep the existing Command Shell design. Prioritize truth, recovery, and workflow testing over another visual redesign.

---

# 7. Decisions needed from the user at defined checkpoints

Do not block Phase A–D on these; ask only when the relevant evidence is ready.

1. **Corpus approval:** After certification shows the exact 242-session MNQ and MES selections, approve or reject that window as the real-money evidence set.
2. **Runner style:** Choose structural no-trim trail vs current BE/fixed-target behavior after a side-by-side fold and parity design.
3. **Strategy lever decisions:** Approve each lever only after seeing every changed session, not only total R.
4. **First live-risk cap:** Set the temporary bring-up risk below or equal to the normal strategy/account limit; do not hardcode it in strategy logic.
5. **London window:** Confirm the runtime session window after the canonical transcript comparison and before recording London.

---

## Recommended immediate starting slice

Start with **PR 1: A1 + A2**. It is small, non-trading, and unlocks every later claim:

- restore the suite to green;
- remove the mutable-corpus unit-test trap;
- certify exactly which sessions the current `+17.65R MNQ / +12.03R MES` numbers represent;
- expose missing, duplicate, wrong-revision, and data-gap sessions explicitly.

Do not change strategy behavior or real-money routing in that first PR.
