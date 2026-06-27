# Faithful PREP grade — implementation plan

> Execute task-by-task with TDD (RED → GREEN → regression → commit). No task
> ships without a passing test. Checkboxes track progress.

**Goal:** Make the PREP draw-bias grade faithful to Lanto's 3-component count,
on significant + cited arrays only, with one shared bias/significance definition
both lanes consume — closing the three seams from the wiring map.

**Spec:** [docs/strategy/lanto-prep-rubric.md](../../strategy/lanto-prep-rubric.md) (approved 2026-06-24).
**Map:** [docs/strategy/prep-live-pipeline-wiring.md](../../strategy/prep-live-pipeline-wiring.md).

**Architecture:** three new pure modules become the single source of truth —
`lanto-significance.js` (the §6 gate), `lanto-bias.js` (the §1 count), and a draw
selector. `direct-session-brief.js` (PREP grade) and the live resolver both call
them, so PREP and LIVE cannot diverge. `brief-digest.js` ranking uses the same
significance gate, so the grade can only anchor on a ranked + cited array.

**Tech:** Node ESM, `node --test`, run in the worktree with `GOFNQ_STATE_DIR`
guard. All math in code (constraint #7); grade enum `A+ | B | no-trade` (#9);
every anchor cited (#6). No LLM in this path.

**Re-read gate:** before each coding task touching the grade, re-read
`docs/research/ai-trading-analysis.md` + the rubric section it implements
(project rule). Confirm no LLM arithmetic, grade enum only, cite-or-reject.

---

## Phase 1 — Backend faithfulness (the grade)

### Task 1 — Significance gate (rubric §6)
**Files:** create `cli/lib/lanto-significance.js`; test `tests/lanto-significance.test.js`.
- `isSignificantArray(array, { price, atr })` → `{ significant: bool, reasons: string[] }`.
  Requires: `displacive` (disp_score ≥ threshold / clean) AND `took_liq` AND
  `near` (|distance| ≤ N·atr) AND `size_quality !== "tiny"` — unless
  (`disp_score` very high AND took **major** liquidity).
**Acceptance:** a `tiny` zone fails; a normal displacive+took-liq+near zone
passes; a far zone fails on `near`; the exceptional-tiny carve-out passes only
with both conditions.
**Verify:** `node --test tests/lanto-significance.test.js`. Tests: tiny-fails,
normal-passes, far-fails, no-disp-fails, no-liq-fails, exceptional-tiny-passes.

### Task 2 — HTF vote (rubric §2)
**Files:** create `cli/lib/lanto-htf-vote.js`; test `tests/lanto-htf-vote.test.js`.
- `htfVote({ daily, h4, h1 }, { array, reaction })` → `"bull" | "bear" | "none"`.
  Vote from clearly-directional momentum (consecutive same-sign daily/4H/1H) OR an
  observed array reaction (reject→continuation, invert→flip). **Conflicting
  momentum + no reaction → `none`.** A lone `tiny`/insignificant array against a
  strong opposite direction → does not set the vote (price overrides).
**Acceptance:** the 2026-06-24 MES case (daily bull, h4+h1 bear, no reaction) →
`none`; aligned momentum → that direction; invert reaction → flip.
**Verify:** tests: conflicting→none, aligned→dir, reject→continuation,
invert→flip, tiny-array-against-trend→none(overridden).

### Task 3 — Overnight vote (rubric §3)
**Files:** modify `app/main/direct-session-brief.js` `computeOvernightVerdict`
(or extract to `cli/lib/lanto-overnight-vote.js` if cleaner); tests alongside.
- `overnightVote(sweeps, momentum)` → `bull | bear | none`. **Chop/consolidation
  → `none`.**
**Acceptance:** chop → none; clear directional overnight → direction.
**Verify:** tests: chop→none, bear→bear, bull→bull.

### Task 4 — The count (rubric §1) — the one bias function
**Files:** create `cli/lib/lanto-bias.js`; test `tests/lanto-bias.test.js`.
- `computeDrawBias({ htfVote, overnightVote, openVote = null })` →
  `{ grade: "A+"|"B"|"no-trade", count, direction, votes, no_trade_reason }`.
  Pick the direction with the most confirming votes; `<2` agreeing → no-trade.
  **Pre-session (`openVote === null`) ceiling = B** (2 agreeing → B; ≤1 →
  no-trade). 3 agreeing (live) → A+.
**Acceptance:** (bull, bull, null)→B; (bull, none, null)→no-trade; (bull, bull,
bull)→A+; (bull, bear, null)→no-trade(conflict); the MES-PM worked check
(none,none,null)→no-trade with reason.
**Verify:** tests cover the full count matrix + pre-session ceiling.

### Task 5 — Draw selector + cite-or-reject (rubric §5, §7)
**Files:** create `cli/lib/lanto-draw.js`; test `tests/lanto-draw.test.js`.
- `selectDraw(digestSymbol, { price, atr })` → the significant, **untaken**
  liquidity target with a **resolvable cite**, or `null`. Uses Task 1. Distinct
  from the vote. No resolvable cite → not eligible.
**Acceptance:** picks the nearest significant untaken pool with a cite; rejects a
`tiny` zone; rejects an array with `cite: null` (the MES draw).
**Verify:** tests: picks-cited-significant, rejects-tiny, rejects-null-cite,
none-eligible→null.

### Task 6 — Wire the PREP grade (replace the default-B)
**Files:** modify `app/main/direct-session-brief.js`
(`buildDirectSessionBriefPayloads`, the `:382` block); update fixtures under
`tests/fixtures/` + `tests/migration/` as the grades change.
- Replace the default-B logic with: `htfVote` (Task 2) + `overnightVote` (Task 3)
  → `computeDrawBias` (Task 4); `primary_draw` from `selectDraw` (Task 5);
  `no_trade_reason` from the count.
**Acceptance:** `pre_session_grade ∈ {no-trade, B}`; MES-PM bundle now grades
no-trade; a genuine 2/3 day still grades B. Smoke fixtures pass (citations).
**Verify:** `npm run smoke:fixtures`; `node --test` brief tests; re-run the live
NY-PM MES bundle through the builder → no-trade.

### Task 7 — Significance into the digest ranking (close seam ❷)
**Files:** modify `cli/lib/brief-digest.js` ranking to use
`lanto-significance.isSignificantArray`; tests in `tests/brief-digest.test.js`.
- `top_fvgs` / `top_bprs` rank by significance first; the grade (Task 6) may only
  anchor on a digest-ranked array.
**Acceptance:** the MES h1 `top_fvgs` no longer surfaces the tiny zone as a draw
anchor; a significant zone ranks.
**Verify:** `node --test tests/brief-digest.test.js`; smoke fixtures.

**◇ CHECKPOINT 1** — full suite green, smoke 22/22, MES-PM grades no-trade end to
end. Review before Phase 2.

---

## Phase 2 — One bias fn both lanes (seam ❸) + contract test (seam ❶)

### Task 8 — Live resolver calls the same `computeDrawBias`
**Files:** modify `app/main/live-ltf-resolver.js` (`deriveLtfBiasContext`) +/or
`live-open-reaction-finalizer.js` to derive its bias via `computeDrawBias`
(open reaction = 3rd vote); tests in `tests/live-ltf-resolver*.test.js`.
**Acceptance:** PREP grade and live ltf-bias agree on the same inputs (no
divergence like today's B-bullish vs stand-aside). Replay/tape parity holds.
**Verify:** `node --test` resolver tests; `npm run tapes`; replay corpus gate.

### Task 9 — Field-contract test (seam ❶)
**Files:** create `tests/prep-live-contract.test.js`.
- Assert each PREP/LIVE record reader (`openReactionVerdict`, brief readers, the
  LTF strip) only keys on fields the writer actually emits (drive a real writer
  payload through the reader; fail if a read field is absent from the writer
  schema).
**Acceptance:** fails if a reader keys on a non-emitted field (the open-reaction
bug class); passes on the current fixed code.
**Verify:** `node --test tests/prep-live-contract.test.js`.

**◇ CHECKPOINT 2** — seams ❶/❸ closed by tests; suite green. Review.

---

## Phase 3 — UI surfacing

### Task 10 — PREP shows the count + cited draw
**Files:** modify `app/renderer/src/Prep.helpers.js` + `PrepPopover.jsx`; tests
in `tests/prep-helpers.test.js`.
- Render per symbol: the **component count** (which of HTF/Overnight voted, each
  direction), the cited **significant draw**, and a faithful grade pill
  (no-trade/B). A `no_trade_reason` shows when count `<2`.
**Acceptance:** a no-trade symbol shows the reason + count, not a silent B; the
draw shows its cite tooltip; helper unit tests pass.
**Verify:** `node --test tests/prep-helpers.test.js`; vite build clean; HMR into
the running app, confirm via the app log (no console errors).

---

## Phase 4 — Validate

### Task 11 — Re-grade oracle + fold + Discord spot-check
**Files:** the oracle tapes/fixtures; `docs/strategy/lanto-oracle.md`.
- Re-grade the locked oracle sessions under the faithful grade; fold the corpus;
  spot-check vs Discord bias labels (Long/Short/Mixed/Unclear → count). Any oracle
  expectation the faithful grade changes needs **user sign-off** before the tape
  is re-promoted (oracle process).
**Acceptance:** no unexplained regressions; grade changes match Lanto's actual
calls on the checked sessions.
**Verify:** `npm test` (replay + tape gates); `npm run smoke:fixtures`; the fold
report.

**◇ CHECKPOINT 3** — validated against Lanto. Done.

---

## Out of scope
SMT leader selection (corpus-first, tracked separately in
[[smt-leader-selection]]); Pillar 2 / Pillar 3 entry logic (the multi-alignment
A+ lives in the entry chain, not this grade).
