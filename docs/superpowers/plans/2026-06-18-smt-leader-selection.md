# SMT relative-strength leader selection — implementation plan

> **For agentic workers:** implement task-by-task, TDD (RED → GREEN → regression → commit). Steps use `- [ ]` checkboxes.

**Goal:** Replace the direction-agnostic disp-score leader picker with an ICT SMT relative-strength picker read over the NY open-reaction window (15→30 min, lock early when conclusive), emitting today's LTF bias + the SMT leader from one read; never silently default to MNQ.

**Spec:** [docs/superpowers/specs/2026-06-18-smt-leader-selection-design.md](docs/superpowers/specs/2026-06-18-smt-leader-selection-design.md) (approved).
**Branch:** `claude/smt-leader-selection`. **Repo convention:** plans live here, not `tasks/plan.md`.

**Architecture split (decided during planning):**
- `cli/lib/smt-leader.js` (pure) computes the *read* — divergence, ATR-normalized gap, per-symbol strength, criteria flags, and a `done` bool ("we have a confident divergence NOW"). It does **not** own window timing.
- `cli/commands/analyze.js` runs it each analyze call and surfaces it as `pair.leader_evidence` (replacing `computeLeader`).
- `app/main/live-open-reaction-finalizer.js` owns the **timing policy**: re-evaluate each bar from min 15; lock when `done`; at min 30 resolve the fallback (near-tie→MNQ, missing/no-pivot→standaside); never lock before min 15; never silent PAIR_PRIMARY.
- `app/main/bar-close.js` walk gate respects `standaside`.

**Dependency order:** 0 (strategy doc) → 1 (pure fn) → 2 (analyze wiring) → 3 (schema) → 4 (finalizer timing) → 5 (bar-close gate) → 6 (capture) → 7 (calibration + tape). Checkpoints after Task 1, Task 4, Task 7.

---

## Task 0: Strategy rule §2.3.1 (constraint #11 — must land first)

**Files:** Modify `docs/strategy/trading-strategy-2026.md` (add §2.3.1 after §2.3).

- [ ] Add the §2.3.1 text from the spec (pair relative strength / SMT; short the laggard, long the leader; selection-only, not the entry trigger; both-confirm/both-fail-near-tie → MNQ; unreadable → stand aside).
- [ ] Add a one-line pointer in `CLAUDE.md` "Strategy basis" that §2.3.1 governs MNQ/MES leader selection.
- [ ] Commit: `docs(strategy): §2.3.1 pair relative strength (SMT) leader selection`.

**Acceptance:** the rule is in the spec doc and mirrored in strategy doc; no code yet.

---

## Task 1: Pure `computeSmtLeader` + tests

**Files:** Create `cli/lib/smt-leader.js`; Create `tests/smt-leader.test.js`.

Signature:
```
computeSmtLeader({
  primary, secondary,            // symbols, e.g. "MNQ1!","MES1!"
  primaryEngine, secondaryEngine,// parsed engine bundles (gates.engine shape)
  context,                       // "short"|"long"|"auto" — reacted extreme; "auto" picks the tested side
  band = 0.25,                   // SMT_GAP_BAND, ATR units
}) → {
  divergence: bool, bias_dir: "short"|"long"|null,
  leader: "MNQ1!"|"MES1!"|null,           // the trade vehicle (laggard for short / leader for long)
  gap: number|null,                        // |strength_strong − strength_weak| in ATR
  strengths: { [sym]: number|null },       // signed ATR-normalized reach past own reference
  reason: string,                          // "smt_divergence" | "no_divergence_measured" | "smt_unreadable_data"
  criteria: { data_present: bool, pivots_confirmed: bool, gap_cleared: bool },
  done: bool,                              // data_present && pivots_confirmed && gap_cleared
  evidence: { [sym]: { reference, reference_cite, window_high|window_low, pivot_cite, atr, atr_cite, strength } },
}
```

Core (no LLM arithmetic — all in code):
- Reference per symbol = nearest **untaken overnight** level being reacted to (`gates.engine.pillar1.session_levels` Asia/London H or L; nearest above price for short, below for long). Cite the path.
- Confirmed pivot per symbol = the engine swing-tier pivot in reaction (`gates.engine.pillar3.swings.swing[]`, `is_high`), not the forming bar.
- `strength = (window_high − reference) / atr_14` (short) / `(reference − window_low) / atr_14` (long); `atr_14` from `gates.engine.pillar2.*.atr_14`.
- `gap = |strength_a − strength_b|`; `gap_cleared = gap ≥ band`. Leader = lower-strength symbol (short) / higher-strength (long).
- `data_present` false if either engine missing → `reason: smt_unreadable_data`, `done:false`. `pivots_confirmed` false if either lacks a confirmed pivot.

- [ ] **Step 1 (RED):** write `tests/smt-leader.test.js` cases: bearish one-took/one-failed (gap≫band → short laggard); bullish mirror; both-crossed-one-stronger (gap≥band → short weaker); both-crossed near-tie (gap<band → divergence:false, reason no_divergence_measured); both-failed near-tie; **ATR normalization** (identical raw-point gap → divergence on MES scale but not MNQ, proving normalization); secondary engine missing → reason smt_unreadable_data, leader null; no confirmed pivot → criteria.pivots_confirmed false, done false. Run: `node --test tests/smt-leader.test.js` → FAIL (module missing).
- [ ] **Step 2 (GREEN):** implement `computeSmtLeader`. Run the test → PASS.
- [ ] **Step 3:** `npm run test:unit` (regression). Commit: `feat(smt): pure computeSmtLeader — ATR-normalized graded gap`.

**Acceptance:** all `smt-leader.test.js` cases green; pure (no fs/electron imports); evidence carries citeable engine paths.

### ✅ Checkpoint 1 — review the pure read + its cases before wiring anything live.

---

## Task 2: Wire into `analyze.js` `leader_evidence`

**Files:** Modify `cli/commands/analyze.js` (~L827–860, the `computeLeader(...)` block + `leader_evidence`); review `cli/lib/compute-leader.js` (retire as the selector — keep only if still referenced as a tiebreak, else delete with its test); review `cli/lib/brief-digest.js:177` passthrough.

- [ ] **Step 1 (RED):** add/adjust a fixture-or-unit assertion that `pair.leader_evidence` carries the new shape (`divergence`, `gap`, `bias_dir`, `criteria`, `done`, `evidence`, `reason`).
- [ ] **Step 2 (GREEN):** replace the `computeLeader` call with `computeSmtLeader`, passing both engines + band + reacted-side context (from the session gate). Build `leader_evidence` from its output. Remove the dead disp-score selector path.
- [ ] **Step 3:** `npm run smoke:fixtures` — if the paired fixtures (004/005) assert the old `leader_evidence` shape, update fixture + expected together (do **not** weaken the schema). Run full suite. Commit: `feat(smt): analyze surfaces SMT leader_evidence`.

**Acceptance:** `./bin/tv analyze --pair` emits the new `leader_evidence`; smoke fixtures 22/22 (updated if needed); no remaining disp-score selector.

---

## Task 3: `pair-decision.json` schema bump

**Files:** Modify `cli/lib/pair-decision.js`; Modify/extend its test (or add `tests/pair-decision.test.js`).

- [ ] **Step 1 (RED):** round-trip test — write a decision with `method:"smt"`, `bias_dir`, `divergence`, `gap`, `evidence`, `standaside`, richer `reason`; read it back; assert all fields + `date`-mismatch still returns null.
- [ ] **Step 2 (GREEN):** bump `SCHEMA` to 2; accept/echo the new fields in `writePairDecision`; `readPairDecision` returns them. Keep atomic write.
- [ ] **Step 3:** suite green. Commit: `feat(smt): pair-decision schema v2 (smt fields + standaside)`.

**Acceptance:** new fields persist + read back; back-compat read of a v1 file doesn't throw.

---

## Task 4: Finalizer timing policy (the behavior change)

**Files:** Modify `app/main/live-open-reaction-finalizer.js`; extend its unit test (DI-injected deps).

Policy (replaces "lock on first run / `|| PAIR_PRIMARY`"):
- Read `minutesIntoPhase` + `leader_evidence` (from the captured bundle).
- If `existingLeader` && final bias → `already_final` (unchanged).
- If `minutesIntoPhase < 15` → `{wrote:false, reason:"pre_window"}` (don't lock).
- If `evidence.done` → lock the SMT leader + bias; write pair-decision (`method:smt`, `standaside:false`, evidence).
- Else if `minutesIntoPhase >= 30` (hard stop): `criteria.data_present===false || !pivots_confirmed` → lock `standaside:true`, reason `smt_unreadable_data`, **notify** (native), no leader; else (measured near-tie) → lock `leader:MNQ`, `standaside:false`, reason `no_divergence_measured` (carry gap).
- Else (min15–30, not done) → `{wrote:false, reason:"resolving"}`.
- **Remove** the `evidence?.leader || PAIR_PRIMARY` silent default.

- [ ] **Step 1 (RED):** DI tests: lock-early when `done` (min 16); pre-window no-lock (min 12); min-30 near-tie → MNQ lock; min-30 missing-data → standaside + notify called, no leader; already_final no-op.
- [ ] **Step 2 (GREEN):** implement the policy; inject a `notify` dep.
- [ ] **Step 3:** suite green. Commit: `feat(smt): finalizer locks SMT leader on the 15→30 window, stands aside on unreadable data`.

**Acceptance:** the five DI flows pass; no path locks PAIR_PRIMARY on missing data.

### ✅ Checkpoint 2 — review the live timing/lock policy before touching the walk gate.

---

## Task 5: bar-close walk gate respects `standaside`

**Files:** Modify `app/main/bar-close.js` (leader reads ~L1394 + ~L1487); extend the relevant contract test.

- [ ] **Step 1 (RED):** contract test — a pair-decision with `standaside:true` → the per-bar context yields no walkable leader (no setups surfaced / `blocked: smt_standaside`), and does **not** fall through to `PAIR_PRIMARY` for trading.
- [ ] **Step 2 (GREEN):** where the leader gates *walking/surfacing*, honor `standaside` (block, reason `smt_standaside`). The chart-pin read may still pick a symbol to display, but no setup is walked.
- [ ] **Step 3:** suite green. Commit: `fix(smt): bar-close stands aside when the SMT pick is unreadable`.

**Acceptance:** standaside session walks nothing; a real leader session walks the locked symbol.

---

## Task 6: Capture reliability — both symbols across the window

**Files:** Modify the capture path feeding the finalizer (`app/main/tools/tv-analyze.js` / `cli/commands/analyze.js` pair capture); reuse `cli/lib/tf-capture.js` retry.

- [ ] **Step 1 (RED):** test/fixture proving that when the secondary engine is momentarily empty, the capture retries and `leader_evidence.criteria.data_present` reflects truth (true after retry; false only when genuinely absent → standaside, never MNQ).
- [ ] **Step 2 (GREEN):** ensure the dual-symbol window capture polls/retries both symbols (engine-stamp-verified, like `tf-capture`); surface per-symbol presence into `leader_evidence`.
- [ ] **Step 3:** live/`--pair` sanity + suite. Commit: `fix(smt): reliable dual-symbol capture across the open window`.

**Acceptance:** both symbols present on a healthy capture; genuine secondary-missing → standaside (the exact 2026-06-18 failure no longer defaults to MNQ).

---

## Task 7: Band calibration + divergence tape + final gates

**Files:** `tests/smt-leader.test.js` (calibration table-test); `tests/tapes/<date>-divergence.tape.json` (new, `verified:false` until hand-graded).

- [ ] **Step 1:** table-test sweeping `SMT_GAP_BAND` across the fixture/tape corpus; confirm 0.25 ATR separates real divergence days from near-ties; adjust the constant from evidence.
- [ ] **Step 2:** record a paired divergence day (reconstruct the 2026-06-18 NY-AM if MES capture is recoverable, else next clean SMT day) via `tv record-tape`; assert the finalizer locks the laggard end-to-end.
- [ ] **Step 3:** full gates — `npm run test:unit` green, `npm run smoke:fixtures` 22/22, `npm run tapes`, `npm run replay`. Commit: `test(smt): band calibration + paired divergence tape`.

**Acceptance:** corpus separates cleanly at the chosen band; tape proves end-to-end lock; all gates green.

### ✅ Checkpoint 3 — full verification before PR; then open PR, deploy after merge (pull + bounce Electron).

---

## Risks / notes
- **Direction context at decision time:** the reacted extreme (high vs low) sets `context`; resolved from the session's developing read, not a pre-locked bias (chicken-and-egg avoided — the divergence at the tested extreme *is* the signal).
- **Fixture churn:** changing `leader_evidence` shape (Task 2) may touch paired fixtures 004/005 — update fixture+expected together, never weaken the schema.
- **Selection-only invariant:** no task changes the entry models; SMT only picks the instrument + bias. Guard this in review.
- **No live validation until a real SMT day** runs post-deploy; the tape is the deterministic proof until then.
