# Unified goal — 2026-07-10

> Confirmed with the user on 2026-07-10. The north star is unchanged:
> [2026-06-27-end-goal.md](2026-06-27-end-goal.md) — an autonomous bot trading
> Lanto's 3-pillar ICT method on the user's real Tradovate micro account,
> unattended, faithful to Lanto first, trusted through backtest≡live parity.
> This document absorbs the 2026-07-09 improvement plan (committed at
> [docs/plans/2026-07-09-app-and-bot-improvement-plan.md](../plans/2026-07-09-app-and-bot-improvement-plan.md))
> as the execution backbone, corrects it against a fresh 2026-07-10 code audit,
> and adds the two chapters it lacked: the app experience (UI design, motion,
> manual-trading cockpit) and LLM integration.

## Decisions locked 2026-07-10

1. **One umbrella, two tracks.** The improvement plan is absorbed as Track 1
   (money path). A parallel Track 2 (experience) covers UI polish, motion, and
   LLM expansion. Track 2 must never touch trade-path code and never blocks
   Track 1.
2. **LLM hard boundary reconfirmed.** Zero LLM in the trade path stays
   absolute — the bot must place correct trades with every LLM down. LLMs
   expand everywhere *around* the path: review, coaching, journaling,
   lever-evaluation analysis, anomaly explanation.
3. **Priority mix.** Money-path sequence stays P0 exactly as the plan orders
   it; the experience track ships continuously alongside it.

## One sentence

Arm real money on a certified, parity-proven, Lanto-faithful bot via the
money-path track, while a parallel experience track makes the app the best
possible manual-trading cockpit — with LLMs useful everywhere except the
trade path.

## Verified state (2026-07-10 audit)

### Done since the plan's 2026-07-09 baseline

- **A1 done** — the mutable-corpus precondition is out of
  `tests/backtest-baseline.test.js`; the refold test runs on a test-owned
  fixture.
- **A2 done** — `cli/lib/corpus-certification.js` + `./bin/tv backtest
  certify` merged (#215); fails closed on missing/duplicate/wrong-revision
  sessions and requires the parity certificate artifact.
- **Guard work landed** — enforced maxTrades/maxConsec/maxContracts +
  SUGGEST mode (`8ce006d`) and guarded revert-to-SIM (`1a14488`) are on main
  (PR #204 itself closed unmerged; its content shipped via those commits).
- **Manual-trading aids Phase 1+2 shipped** — #214 CDP relaunch/blind-backend
  detection, #216 walker chimes, #217 hunt view, #218 day chip, #219–#222
  one-click/chooser/instant-SL tickets, #223 auto-journal on close + one-key
  ticket from the packet.
- **E3b (MSS significance / reversal speed) is implemented** —
  `app/main/strategy/walkers/mss-lifecycle.js:42-72`: significant-sweep-target
  set + `disp_atr >= MSS_MIN_REVERSAL_ATR` behind default-on
  `GOFNQ_MSS_SPEED_MATCH`. The plan listed this as a gap; it no longer is.
- **E3c (multi-alignment A+ elevator) is implemented** —
  `app/main/strategy/walkers/trend-lifecycle.js:213-245`: 5m rebalance partner
  + 1m iFVG anchor, gated on `evidence.multiAlignmentTrendEntry`.
- **SMT leader selection logic exists in production** —
  `cli/lib/smt-leader.js` (`computeSmtLeader`, relative-strength divergence,
  ported from PR #134), wired through `app/main/tools/surface.js` and the
  open-reaction finalizer. Uncertified: no fold comparing leader-only vs
  both-symbols trading (plan F1's certification steps remain).
- **Pine at `CODE_REV = 2`** — batch-1 audit fixes deployed; PR #208 shipped
  two of the six deferred items behind default-off Pine levers
  (`useReactionWindowRejection`, `useOriginLegAnchor`), enablement gated on a
  full-corpus fold.

### Open — Track 1 blockers, confirmed by audit

- ~~**Test suite is red again: 1893/1899, 6 failures**~~ — *resolved same
  day by PR #226; see the status update below.*
- ~~**A3 not done**~~ — *shipped same day as PR #226; see the status update
  below.*
- **B1–B3 confirmed absent** — no durable order-intent/idempotency layer
  (only in-memory dedup maps), no boot-time broker↔journal reconciler (a
  pre-existing live position is re-discovered by polling but never reconciled
  against the journal, and `openedMs` resets to restart time), no continuous
  stop-protection watchdog (nothing verifies a protective stop is actually
  resting at the broker, at boot or after).
- **B4 confirmed: EOD flatten is bar-detector-driven, not broker-clock-driven**
  (`trade-ticker.js:150` keys off bar-event timestamps), and it broker-flattens
  only tranche/auto trades — a manual/position-bracket trade held to 16:00 has
  its journal marked closed while the broker bracket keeps resting.
- **Tradovate token has no refresh path** — auth is sniffed off webview
  traffic; mid-trade expiry is fail-closed (no phantom flats) but auto-entries
  keep failing until the user manually re-auths. Needs loud surfacing + a
  guided re-auth flow.
- **The three misleading UI literals are all still present** —
  `SystemPage.jsx:109` hardcoded `IPC bridge = ok`, `SettingsPage.jsx:105`
  fixed `24.25` stop feeding the contract example, `LivePage.jsx:37` "fires
  only after your accept" (false in AUTO mode).
- **Error containment is chart-only** — `ErrorBoundary` wraps exactly one
  thing (`CommandShell.jsx:456`, the chart); a render crash in any ⌘-page is
  not isolated.
- **No renderer workflow tests** — renderer coverage is pure-helper unit
  tests; `design-harness/` is screenshots + computed-style probes only. No
  click-through workflow, keyboard, or degraded-state assertions.
- **Strategy docs are stale where it matters** —
  `docs/strategy/entry-models.md:192-198` still lists MSS-significance and
  multi-alignment as divergent (both now implemented); the plan's E1 gap
  matrix (`docs/audits/...-strategy-gap-matrix.md`) was never produced.
- **E3a (5m gap preference) is still a real gap** — base models hunt on 1m;
  5m arrays are consumed only inside the multi-alignment elevator.
- **E3d (runner truth) is still undecided** — live behavior is stop-to-BE at
  TP1 + fixed TP2 for A+ runners; `deriveRunnerStructure` exists but is
  imported only by its test. User decision checkpoint.
- **Pine deferred items still open** — merged-label price and disp_atr ATR
  snapshot remain in the "derive from transcripts" bucket; the two #208
  levers await the corpus fold (which itself awaits re-record passes).
- **London does not exist in the trusted domain** — zero recorded London
  sessions; the certification manifest is NY-only.

## Status update — later on 2026-07-10 (post PR #226)

Phases 1–2 of the readiness program are done, executed in a parallel session
and verified here by re-running the evidence commands against origin/main:

- **A3 shipped** — PR #226 (`ec5e4b1`, merged 04:01Z) replaced the
  positive-R verdict with the fail-closed composition: four states
  (`BLOCKED / REVIEW_REQUIRED / NOT_READY / NET_POSITIVE_APPROVED`), eight
  ordered gates (tests, baseline identity, sessions, corpus, parity,
  net-positive, strategy review, user approval), approval records under
  `state/backtest/approvals/` invalidated on any code/corpus/scope/lever
  drift, test evidence bound to an exact clean SHA, and a renderer that
  fails closed on malformed payloads. The morning audit's 6 test failures
  were fixed in the same PR; suite reported 1905 pass / 0 fail + CI +
  post-merge evidence verification.
- **Certification runs and correctly refuses** — verified directly:
  `certified: false`. MNQ1! 233/239 selected, 6 missing
  (`2026-01-13 am`, `01-14 pm`, `02-02 pm`, `02-04 am`, `02-05 pm`,
  `07-01 am`); MES1! 235/239, 4 missing (`02-03 pm`, `02-27 pm`,
  `05-06 am`, `07-01 am`); parity blocker: "no parity certificate artifact
  (prose-only parity proof does not certify)". Net-positive gate passes
  (+15.72R MNQ / +10.03R MES after certified selection) but cannot override
  the failed gates — final verdict **BLOCKED** for both symbols, which is
  the intended behavior.
- **Identity binding demonstrably works** — running the verdict from a
  scratch worktree flips the tests/baseline gates to fail because the
  evidence is bound to the exact merge SHA and a clean tree.

**Immediate next steps, two lanes in parallel:**

1. **Code lane → step 3 below (B1–B2):** durable order intents + boot-time
   broker/journal reconciliation.
2. **Evidence lane:** re-record the 10 missing sessions (first checking each
   against holiday/early-close reality — a legitimately unrecordable day
   belongs in the manifest exceptions, not in a re-record chase; recording
   requires the app stopped) and generate the machine-readable parity
   certificate via `scripts/gate-corpus/parity-diff.py`. Corpus certification
   green + user window sign-off then unblock ladder steps 2–3.

## Track 1 — money path (P0, plan order preserved)

The phases, tasks, file lists, acceptance criteria, verification matrix, and
go-live ladder live in the absorbed plan. Remaining sequence, updated:

1. ~~**Green the suite**~~ — **done in PR #226** (the 6 failures fixed;
   suite green, evidence-bound).
2. ~~**A3**~~ — **done in PR #226** (see status update above).
3. **B1–B2** — durable order-intent lifecycle + boot-time broker/journal
   reconciliation (the reconciliation matrix in the plan, incl.
   adopt/protect/flatten operator actions).
4. **B3–B4** — continuous stop-protection + broker-auth watchdog, and
   broker-clock EOD/emergency management independent of the bar pipeline —
   including flattening manual trades at the broker and a guided
   token-re-auth flow when 401s appear mid-session.
5. **C1–C2** — one readiness truth object rendered identically in System,
   Backtest, Settings; kill the three misleading literals (safety copy is
   Track 1, not polish).
6. **C3–C5** — Live page becomes the order-lifecycle/reconciliation timeline;
   Review separates EXECUTED / JOURNAL / BACKTEST domains; per-page error
   boundaries + stale-feed states.
7. **D1–D2** — deterministic Command Shell workflow harness (fixture-driven
   Playwright, the plan's 10 scenarios) + keyboard/a11y completion.
8. **E1 (updated) + E2** — reconcile strategy docs with code (mark E3b/E3c
   implemented, produce the gap matrix) + the reusable lever-evaluation
   report.
9. **E3a + E3d** — 5m-gap-preference lever (default-off, full-corpus fold,
   per-moved-session review); runner-style decision after a side-by-side
   fold, then implement live+backtest together in one PR.
10. **Pine closure** — fold the two #208 levers on the re-recorded corpus;
    derive merged-label price + disp_atr semantics from transcripts; every
    Pine evidence change bumps `code_rev` and re-certifies.
11. **F1** — certify SMT leader selection (fold leader-only vs both-symbols,
    review every day the leader changes the trade). **F2 (London) moves
    post-arming** per the 2026-07-10 ruling: real money arms on NY;
    London window derivation, recording, and certification start only after
    NY live is stable.

**Real-money arming** follows the plan's go-live ladder (§5) exactly — a
sequence of evidence, not a date. A positive fold alone never skips steps.

### Go-live ladder position (as of 2026-07-10, post PR #226)

| Step | Status |
|---|---|
| 1. Development clean | Done — suite green, evidence bound to SHA |
| 2. Corpus/data trusted | Blocked — 6 MNQ + 4 MES sessions missing |
| 3. Deterministic parity trusted | Blocked — parity certificate artifact absent |
| 4. Strategy/user approval | Pending (window pre-approved as defined; final sign-off gated on green certification) |
| 5. Execution lifecycle trusted | Not built — B1–B4 |
| 6. Paper/manual bring-up | Not started |
| 7. Paper/AUTO bring-up | Not started |
| 8. Live manual/suggest | Not started |
| 9. Live/AUTO | Not started |

## Track 2 — experience (parallel, never touches the trade path)

**Containment rule for every Track 2 PR:** renderer / prompts / docs / CSS
only. Files under `app/main/strategy/`, `app/main/execution/`,
`app/main/bar-close.js`, and the walker/gate libraries in `cli/lib/` are
off-limits. LLM features are read-only over deterministic state: new purposes
get their own `TOOLS_BY_PURPOSE` allow-list, and none may author surface or
trade tools. UI work follows DESIGN.md + PRODUCT.md and the Impeccable skill,
verified through the design harness.

### 2a — UI: motion system + polish

Current state: 11 keyframes, all entrance-only; one value-change flash; three
`prefers-reduced-motion` blocks; large duplicated rule blocks in `app.css`.

- **Motion v1:** exit animations for pages and toasts (today they unmount
  instantly); a page-to-page transition for ⌘1–⌘7 switches; value-change
  ticks on live numbers (generalize the `.trade-card.flash` pattern to P&L,
  day chip, readiness rows); consistent duration/easing tokens; complete
  `prefers-reduced-motion` coverage.
- **CSS hygiene:** dedupe the duplicated blocks in `app.css` (e.g.
  `claudePulse`/`claudeTyping`/`.trade-card.flash` each defined twice).
- **Token lint:** a design-harness check that flags hardcoded colors/fonts
  that bypass the DESIGN.md variables.

### 2b — LLM: expand around the hard boundary

Each is a small standalone PR. Ordered by expected value:

1. **Review critique card** — the `review` purpose already reasons over the
   session but writes to memory only; surface a session-critique card on the
   Review page (what the chain did well/poorly vs the checklist, cited).
2. **Weekly coach / STATS narrator** — LLM prose over the equity curve,
   journal rows, and faithfulness data (numbers stay deterministic,
   cite-or-reject applies).
3. **Dedicated deep-analysis purpose** — move on-demand PREP/LIVE analysis
   off the shared chat channel (`useAiAnalysis` is explicitly a "cheap v1")
   into its own purpose with its own prompt and allow-list.
4. **Lever-evaluation narrator** — E2's moved-session reports explained
   against transcript citations, to speed the user's per-session review
   (feeds Track 1 checkpoints; still read-only).
5. **Anomaly explainer** — when readiness goes red or an `app:error` fires,
   one narration turn that explains the blocker and the recovery action in
   plain language.
6. **Journal vision assist** — post-close LLM pass over the auto-journal
   screenshot proposing the trade note the user currently types by hand.
   *Approved 2026-07-10 as a full vision carve-out:* the shipping PR updates
   constraint #5 with an explicit, named exception scoped to post-close
   journaling only — screenshots stay banned from analysis input.
7. **Delete the catch-up purpose** — the phase prompt, tool map, metrics
   bucket, and BRAIN routing all exist with no caller. *Decided 2026-07-10:*
   remove the dead scaffolding; git history keeps it.

## User decision checkpoints — ruled 2026-07-10

All seven were put to the user one by one on 2026-07-10:

1. **Corpus window — approved as defined.** `gate-corpus-2026-h1-v1`
   (2026-01-10 → 2026-07-03, MNQ1!+MES1!, NY AM/PM) is the real-money
   evidence set. Final sign-off remains gated on certification running green.
2. **Runner style — derive from transcripts first.** Re-derive Lanto's actual
   runner management from the transcripts + Discord PDF with citations, then
   run the side-by-side fold on the certified corpus, then the user rules.
   No implementation before that ruling.
3. **Fold queue — Pine levers first.** When corpus passes finish: fold the
   two #208 levers (reaction-window rejection, origin-leg anchor) first to
   close the Pine audit and stabilize `code_rev`, then the strategy folds
   (E3a 5m-gap preference, runner side-by-side).
4. **First live-risk cap — normal size from day one.** Full strategy sizing
   and the standard caps from the first armed session; the backtest evidence
   is the gate, so live matches it exactly.
5. **London — NY first, London after.** London is deprioritized entirely
   until real money is armed and stable on NY. No London recording or window
   derivation until then (F2 moves post-arming).
6. **Journal assist — full vision carve-out.** The LLM may read the
   auto-journal screenshot when drafting the post-close trade note. When the
   feature ships, constraint #5 gains an explicit, named exception scoped to
   post-close journaling only; screenshots stay banned from analysis input.
7. **catch-up purpose — delete.** Remove the dormant prompt, tool map,
   metrics bucket, and routing; git history keeps it.

Still evidence-gated (asked when the evidence exists): final corpus sign-off
after green certification; each lever's approval from its moved-session
report (never from aggregate R); the runner ruling after the transcript
derivation + fold.

## Definition of done

- **Track 1 is done** at go-live ladder step 9: live/auto armed on the
  user-approved certified window, with reconciliation, protection watchdog,
  EOD independence, and parity all green — then "done" means hands-off during
  sessions, review after.
- **Track 2 has no terminal state** — it ships continuously and must never
  block, destabilize, or reach into Track 1's trade path.
