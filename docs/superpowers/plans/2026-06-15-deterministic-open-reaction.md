# Deterministic Open-Reaction — Implementation Plan

> Execute task-by-task. Spec: `docs/superpowers/specs/2026-06-15-deterministic-open-reaction-design.md`.

**Goal:** Replace the LLM open-reaction phase (leader + LTF bias + open verdict) with the backtest's deterministic resolvers, so the live chain has no Claude on the load path.

**Architecture:** New pure-ish finalizer module reuses existing `tvAnalyzeFast` (paired capture), `computeLeader` (via `pair.leader_evidence`), `deriveLtfBiasContext`, and the `surface*` writers. `handleBar` calls it instead of firing LLM open-reaction / catch-up turns.

---

### Task 1: Finalizer module + unit tests

**Files:**
- Create: `app/main/live-open-reaction-finalizer.js`
- Test: `tests/live-open-reaction-finalizer.test.js`

`finalizeOpenReactionDeterministic({ session, eventTs, deps })`:
- `deps` (injectable, defaults to real): `{ capture, readPairDecisionLeader, readBrief, writeLeaderDecision, writeLtfBias, writeOpenReaction, activeSessionDir, fileHasFinalBias }`.
- Idempotency: if pair-decision leader present AND persisted bias non-empty → `{ wrote:false, reason:"already_final" }`.
- Capture via `deps.capture()` → paired bundle. On null/throw → `{ wrote:false, reason:"capture_failed" }`.
- Leader: existing leader (from pair-decision) else `bundle.pair.leader_evidence.leader` else `PAIR_PRIMARY`. If no existing pair-decision, `writeLeaderDecision`.
- Leader bundle: `bundle.pair.symbols[leader]` (paired) else `bundle` (single-symbol short-circuit).
- `deriveLtfBiasContext({ bundle: leaderBundle, brief, session, eventTs })` → `ctx` (may be null pre-resolve/quiet).
- `writeOpenReaction({ session, minutes_into_phase, latest_read, bias_direction: ctx?.bias ?? "pending", watching })`.
- `writeLtfBias({ session, ltf_bias: ctx?.bias ?? null, htf_ltf_alignment: ctx?.htf_ltf_alignment ?? "unclear", is_retrace_day: ctx?.is_retrace_day ?? false, entry_model_priority: ctx?.entry_model_priority ?? "undecided", grade_cap: ctx?.grade_cap ?? "B", reasoning, source: ctx?.source ?? "deterministic-finalizer" })`.
- Return `{ wrote:true, leader, bias: ctx?.bias ?? null, alignment: ctx?.htf_ltf_alignment ?? null }`.

Tests (stub deps): leader from evidence; leader inconclusive → PAIR_PRIMARY; existing pair-decision skips writeLeaderDecision; bias derived vs pending(null); idempotent skip when final; capture_failed; single-symbol bundle path.

- [ ] Write tests → run (fail) → implement → run (pass) → commit.

### Task 2: Wire into `handleBar` (`app/main/bar-close.js`)

**Files:** Modify: `app/main/bar-close.js`

- Compute `mip` before the open-reaction branch.
- `open_reaction`, `mip < 14`: `return` (defer — record metric `open_reaction_deferred`). No LLM.
- `open_reaction`, `mip >= 14`: `await finalizeOpenReactionDeterministic({ session, eventTs })`; `return`. No LLM.
- `entry_hunt` & (`!pairDecisionExists()` || `!ltfBiasMdExists()`): replace `runLeaderCatchupTurn` with `await finalizeOpenReactionDeterministic({ session, eventTs })` (runs before `preflightChartState`). Then continue entry-hunt normally.
- Remove `runLeaderCatchupTurn`, the `isCatchUp` LLM text branch, and the now-unused open-reaction hint. Keep the in-memory `deriveLtfBiasContext` fallback in `buildDetectorInputs`.
- `eventTs` = `new Date(ev.ts)` (detector emits UTC ISO).

- [ ] Edit → `npm run test:unit` (or targeted) → commit.

### Task 3: Full suite + smoke + manual sanity

- [ ] `npm test` (in this worktree — never the main checkout, PR #79 guard).
- [ ] `npm run smoke:fixtures`.
- [ ] Grep metrics shape / confirm no `surface_*` LLM calls expected during open-reaction.
- [ ] Commit any fixups.

### Task 4: PR

- [ ] Push branch, open PR referencing the spec + plan, body per CLAUDE.md.
