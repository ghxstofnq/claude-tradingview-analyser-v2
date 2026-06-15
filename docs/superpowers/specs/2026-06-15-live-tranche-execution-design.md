# Live tranche execution engine — design

**Date:** 2026-06-15
**Status:** Spec for review (no code yet)
**Goal:** Make live execution reproduce what the backtest proved — the anchor + concurrent scale-in adds that account for ~64% of the corpus result — instead of the anchor-only line live caps out at today.

---

## Why

A read-only audit (2026-06-15) traced both paths. Signal parity is high (live and the backtest share the same deterministic brain, `buildDeterministicPacketTruthFromInputs`). But the result diverges structurally:

| Trade type | Trades | R | Share |
|---|---|---|---|
| Anchors | 60 | +47.23R | 36% |
| Scale-in adds | 42 | +83.86R | **64%** |
| **Net** | **102** | **131.09R** | |

Verified by summing `state/backtest/**/setups.jsonl` split on `scale_in_add`. Today live cannot take the adds: there is **no anchor/green-light/add logic live at all** (it lives only in the backtest's open-trades loop, `backtest-engine.js`), the journal enforces a single open trade (`trades.js:53-66`), and adds average into one netted bracket rather than running as independent tranches.

## The structural constraint (proven by two paper spikes)

A futures account **nets** same-symbol positions. The backtest models each scale-in as an *independent position with its own stop/target/runner*; the broker cannot hold that via its auto-bracket:

- Spike A: add with **no** bracket → position averages (qty grows, avg recomputes), the existing bracket auto-resizes to cover the combined qty.
- Spike B: add **with its own** bracket → the new bracket **overwrites** the anchor's and resizes to the full net qty (one stop, one target).

So independent tranches must be **recreated** by the engine — they don't exist at the broker for free.

## What the backtest actually does (the model to reproduce)

Per `backtest-engine.js` + `backtest-grader.js` + `cli/lib/trade-outcomes.js` (shared):

1. **Anchor** opens on a confirmed packet, keeps its **original stop**, rides to TP1.
2. **Green light:** once the anchor travels **50% of the way to its TP1**, concurrent same-direction adds become allowed (the anchor's stop is *not* moved to BE by the green light).
3. **Adds:** each subsequent same-side confirmed packet opens as a concurrent tranche — up to **5** (`SCALE_IN_MAX`), with a **10-min same-side dedup** so near-identical entries collapse to one. Each add carries its **own −1R risk** off its **own stop**.
4. **Exit per tranche, by grade:** **A+** → at TP1 move that tranche's stop to break-even and run the full tranche to **TP2**; **B** (or A+ with no TP2 room) → bank the full tranche at **TP1**. Stop = −1R. 16:00 ET = forced close at market (signed R).
5. **Circuit breaker:** 2 add stop-outs in a row → adds off for the session (a winning add resets).
6. **Session halt:** 3 losing closes in a row → no new entries for the session (already live, `consecutiveLossStreak`).

## What is already shared / reusable

- **Detection grading + green-light math** — pure, in `backtest-engine.js` (must be extracted to a shared module; see below — we must NOT edit `backtest-engine.js`, owned by another workstream).
- **Per-tranche exit grader** — `cli/lib/trade-outcomes.js` (`tickTrades`, `runnerEligible`, `closeTradesAtEod`, `foldOpenTrades`) already mirrors the backtest exactly, grade-aware, with the same-bar TP1/stop tie-break. The tranche engine runs this **per tranche**.
- **Broker layer** — `app/main/execution/*` (place / flatten / modify / cancel / fills / WS feed) from PR #73-#76.

---

## Decisions (from Q&A, 2026-06-15)

1. **Three selectable automation modes**, default **Manual** on boot (like PAPER), set in the ACCOUNT & EXECUTION settings:
   - **Manual** — you accept each setup (anchor + any adds you choose); orders placed with a normal broker bracket; **you manage exits** (FLATTEN/BE/PANIC); engine does not auto-close. Single-trade lock lifted so adds can stack (they average on a netting account; manual management).
   - **Manual-anchor / auto-adds** — you take the anchor; once green-lit the engine auto-opens adds and **engine manages all exits** per the rules.
   - **Full-auto** — engine fires the anchor + adds and manages all exits, per the rules. Reproduces the backtest.
2. **Risk model adjustable, defaults = backtest-exact:** each add = the configured per-trade **$ risk** against **its own stop**; **max adds = 5**; **no combined cap**; backstops = 2-add-stop breaker + 3-loss halt. Adjustable settings: automation mode, max concurrent adds, optional combined-position $ cap.
3. **Exits:** engine-managed in the two auto modes; human-managed in full-manual mode (per decision above).
4. **Paper-only.** LIVE arming stays a separate, deliberate, gated step (unchanged). Auto modes fire **paper** orders only until LIVE is armed.

**Open for your sign-off at spec review:** in the auto modes, take **every** surfaced grade (A+ and B, backtest-exact) vs **A+ only**. Proposed default: take-all (adjustable), to match the backtest.

---

## Architecture

The **journal is the brain**; the **execution layer mirrors it to the broker**. Both reuse the existing deterministic grader.

```
per closed bar (bar-close.js)
  └─ walker chain → bestPacket  (one candidate/bar, today)
        │
        ▼
   TrancheManager (NEW, app/main/execution/tranche-manager.js)
     • reads open tranches (journal) + anchor green-light state
     • classifies bestPacket: anchor | add(canScaleInto) | dup | skip
     • per automation mode:
         Manual            → surface only (human accepts → existing flow)
         Manual-anchor     → human anchor; auto-open adds; auto-exit
         Full-auto         → auto-open anchor + adds; auto-exit
     • on open  → journal accept (multi-tranche) + broker entry
     • on exit  → grader transition → broker per-tranche close
  └─ tickOpenTrades (existing) grades every open tranche from the bar
```

### New / changed components

**Create:**
- `cli/lib/scale-in-rules.js` — pure port of `anchorGreenLit`, `isNearDuplicate`, `canScaleInto`, green-light test, `SCALE_IN_MAX`, dedup window, circuit-breaker streak. Single source of truth; the backtest can adopt it later (no edit to `backtest-engine.js` now). Unit-tested against the backtest's current numbers.
- `app/main/execution/tranche-manager.js` — orchestrates anchor/add classification + open/exit per mode. Pure decision core (`planTrancheAction({ bestPacket, openTranches, greenLit, mode, risk, breaker })`) + a thin runtime that calls the journal + execution adapter.
- `app/main/execution/tranche-exec.js` — translates a grader transition into the right broker action for a netted position (per-tranche close of N contracts). Mechanism chosen by **M0 spike (Plan task 1):** prefer **standalone resting stop+limit orders per tranche** (independent working orders, not the position auto-bracket — likely supported on a netting account; confirm); fall back to **engine-fired market close on the grader's bar-close transition** + one broker safety-stop on the net position.

**Modify:**
- `app/main/trades.js` — `acceptSetup` gains a tranche path: when an add is allowed (green-lit, same side, under max), permit a concurrent accept instead of rejecting. Anchor accept unchanged. Tag tranche role (`anchor` | `add`, `tranche_seq`) on the event.
- `app/main/bar-close.js` — after `runDeterministicPacketTruthForBar` surfaces `bestPacket`, call the TrancheManager (auto modes only; manual mode unchanged). Carry the green-light update + circuit-breaker streak (ported, computed from the session's outcomes).
- `cli/lib/trade-outcomes.js` — add the **green-light** flag computation + the **2-add-stop circuit breaker** read so the live grader exposes the same state the manager needs (additive; backtest parity preserved).
- `app/main/execution/config.js` + settings IPC — persist automation mode + max-adds + combined-cap (gitignored exec config; defaults backtest-exact).
- Renderer: `SettingsPopover.jsx` (mode + risk controls), `LivePopover.jsx` (show open tranches as a stack in IN-TRADE; replace PR #76's single averaging-ADD with the tranche view), `Live.helpers.js` (tranche-stack helper), `executionAdapter.js`/`useExecutionState` (expose tranche list).

**Do NOT touch:** `backtest-engine.js`, `backtest-grader.js` and the rest of the backtest workstream (another session). The shared rule module is additive; the backtest keeps its own copy until that session adopts it.

### Risk / accounting
- Each tranche is its own journal trade (`T-NNNN`), its own R, exactly like the backtest. The dashboard already sums per-trade R (REVIEW + analytics) — multi-tranche just produces more trade rows.
- The WS feed (`trading-feed.js`) records the netted round-trip; per-tranche R comes from the journal grader (the source of truth), not the averaged broker fill. PR #76's averaging-entry re-anchor is superseded by per-tranche journal accounting.

---

## Honest caveats (live ≠ exactly 131R, even built perfectly)

1. **Fills/slippage** — broker market entries fill at ~packet-close ±a tick; the backtest assumes the exact level. Standalone resting orders (if supported) shrink this.
2. **Data-pipeline fragility** — live builds a fresh scan each bar; the backtest replays clean tapes. Live still occasionally blocks/misses bars (audit item #2). Hardening that is separate work.
3. **Intrabar vs bar-close** — engine-fired exits resolve at bar close; the backtest grades on bar high/low. Resting broker orders close this for the standalone-order path.

The structural 64% becomes **recoverable** (it is impossible today); these shave the edge but don't gate it.

---

## Testing

- **Unit (TDD):** `scale-in-rules` (green-light, dedup, canScaleInto, max-adds, breaker) locked against the backtest's current behavior; `planTrancheAction` decision matrix across the 3 modes (anchor/add/dup/skip/breaker/halt); `tranche-exec` transition→broker-action mapping.
- **Parity:** a re-fold check that the ported `scale-in-rules` produces the same adds as `backtest-engine.js` on the recorded corpus (the 42 adds / +83.86R must reproduce).
- **Live (paper):** M0 spike for the standalone-order mechanism; then an end-to-end paper run — anchor fills, green-light at 50%, add opens, both exit per grade, fills land in REVIEW — verified via CDP 9223, account left flat.
- Full `npm test` green; no edits to the backtest workstream's files.

---

## Build order (for the plan)

1. **M0 spike** — can the broker rest independent per-tranche stop+limit orders on a netted position? Decides `tranche-exec`. (Paper, throwaway.)
2. `scale-in-rules.js` + parity test (port, no behavior change).
3. Multi-tranche journal (`trades.js` + grader green-light/breaker state) + tests.
4. `tranche-manager.js` decision core + tests.
5. `tranche-exec.js` (mechanism from task 1) + tests.
6. Wire into `bar-close.js` (auto modes); settings (mode + risk) + IPC.
7. Renderer: settings controls + IN-TRADE tranche stack.
8. End-to-end paper verification; merge; deploy.
