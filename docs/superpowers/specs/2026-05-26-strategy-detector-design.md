# Strategy Detector — Design Spec

**Date:** 2026-05-26
**Status:** Spec, not yet implemented
**Branch:** `feat/setup-detector` (to be cut from `main`)
**Driver research:** [docs/research/2026-05-26-llm-strategy-fidelity.md](../../research/2026-05-26-llm-strategy-fidelity.md)
**Strategy authority:** [docs/strategy/trading-strategy-2026.md](../../strategy/trading-strategy-2026.md), [docs/strategy/entry-models.md](../../strategy/entry-models.md)

## Summary

Move strategy interpretation from the LLM prompt into deterministic code. A pure-function "setup detector" runs every bar close, evaluates MSS / Trend / Inversion components mechanically against engine state, and emits one structured candidate object. The model copies values + writes a narration. A post-hoc validator audits the model's surfaced setup. No model override. Tests-only trust path — full reject mode from day one.

## Problem

Eight strategy-fidelity misses in one session, each fixed reactively in prompt or schema (see research doc § "Today's catalog of misses"). The shared root cause is that strategy rules live in prose and engine state has ambiguous field names, so the LLM does interpretation on every bar — every interpretation step is a failure surface. With ~30-60 bars per session × 4 interpretive layers per bar, expected miss count is high. The literature ([AgentSpec arXiv 2503.18666](https://arxiv.org/abs/2503.18666), [Acceldata governance guide](https://www.acceldata.io/blog/approving-agentic-ai-tools-a-governance-risk-and-compliance-framework-for-legal-teams)) is uniform: rule-driven systems need deterministic guardrails, not prompt engineering.

## Locked decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Coverage in v1 | All 3 entry models (MSS + Trend + Inversion) |
| Trust path | Tests only, no shadow mode |
| Validator strictness | Reject from day one |
| Model's job during entry hunt | Copy values + write 2-3 sentence narration |
| Override path if code says no trade | None. Code is the boss. |
| Schema disambiguation | Included in v1 (~50 LOC inside detector) |
| Anti-pattern prompt block | Included in v1 (Phase 3) |
| Cross-model conflict resolution | Use existing `cli/lib/entry-model-priority.js` order |
| PR shape | Single PR, all three phases together |
| Pair handling | Detector runs on the leader only (post-open_reaction) |

## Architecture

Three pieces:

1. **Detector** (`cli/lib/setup-detector.js`) — pure function. Input: bundle + chain context. Output: one candidate object. Called from `cli/commands/analyze.js` (output written into bundle) and indirectly from `app/main/bar-close.js` (which reads it from the bundle and injects into the per-bar prompt).

2. **Validator** (`app/main/tools/surface.js`, extends existing `surfaceSetup`) — audits model's surfaced setup against the detector's output before persisting. Rejects on mismatch.

3. **Prompt** (`app/main/prompts/analyze.md` + `.claude/commands/analyze.md` mirror) — `<phase name="entry_hunt">` shrinks from full strategy walk to "read candidate, copy or narrate no-trade." New `<anti_patterns>` block lists the 8 specific misreads from this week as ❌ examples.

## Detector module

### File layout

```
cli/lib/setup-detector.js          (~600 LOC) — orchestrator + per-model component evaluators
cli/lib/setup-detector-stops.js    (~150 LOC) — stop placement rules
cli/lib/setup-detector-schema.js   (~50 LOC)  — engine field disambiguation
```

### Public API

```js
// cli/lib/setup-detector.js
export function detectSetups({ bundle, leader, ltf_bias_context, untaken_targets }) {
  // returns CandidateObject (see schema below)
}
```

Pure function. Same inputs → same outputs. Cache by bar timestamp upstream if perf becomes a concern; no internal caching in v1.

### Inputs

- `bundle` — the full `tv analyze` output, with `gates.engine.*` + `engine_by_tf.*` + `quote` + `bars_by_tf` + `brief_digest`.
- `leader` — `"mnq" | "mes"`, decided in open_reaction phase.
- `ltf_bias_context` — `{ bias, htf_ltf_alignment, is_retrace_day, entry_model_priority, grade_cap }` from `ltf-bias.md` frontmatter.
- `untaken_targets` — `{ untaken_above: [...], untaken_below: [...] }` from brief `pillar1.<leader>.overnight_block`.

### Component evaluation

For each entry model, the detector evaluates each component as a boolean over engine state, with a cite path. Components per the strategy doc (`docs/strategy/entry-models.md`):

**MSS (6 components):**
1. `context_draw` — HTF destination defined + side aligns with model.
2. `liquidity_grab` — recent sweep event in `gates.engine.pillar1.sweeps[]` matching side.
3. `mss_displacement` — `gates.engine.pillar3.failure_swings[]` entry with `event=mss + validation=sweep + dir` matching.
4. `retrace_to_fvg` — currently or recently in `gates.engine.price_context.inside_fvgs[]` for a fresh FVG in the correct direction.
5. `confirmation` — `gates.engine.confirmation.last_bar` with body_ratio ≥ 0.6 + direction matching side.
6. `displacement_quality` — both must hold: `gates.engine.pillar3.fvg_summary.size_quality !== "weak"` AND `gates.engine.pillar2.current_tf.displacement` is in `{"clean", "acceptable"}`.

**Trend (5 components):**
1. `context_draw` — HTF destination + side aligned.
2. `bos_in_direction` — most_recent_structure event is BOS with side matching.
3. `pullback_to_pd_array` — `inside_fvgs[]` or `inside_bprs[]` currently, OR recent (within last N bars), state not `taken`.
4. `confirmation` — last_bar body_ratio ≥ 0.6 + direction matching.
5. `displacement_quality` — same as MSS.

**Inversion (5 components):**
1. `context_draw` — HTF destination + side aligned.
2. `inverted_pd_array` — fresh inverted FVG (`fvg.kind === "ifvg"` + state fresh) in correct direction.
3. `tap_into_ifvg` — `inside_fvgs[]` currently contains the inverted FVG.
4. `confirmation` — last_bar body_ratio ≥ 0.6 + direction matching.
5. `displacement_quality` — same as MSS.

Each component returns `{ present: bool, cite: string, value: object | null, missing_reason?: string }`.

### Stop placement (`setup-detector-stops.js`)

Pre-ranked options per the user's documented rules:

| Model | Priority 1 | Priority 2 | Priority 3 |
|---|---|---|---|
| MSS (FVG-based) | `candle1_low/high` of the 3-candle FVG formation (bar at `created_ms - 2*tf_ms`) | Closest swing pivot by absolute price distance from entry (`pillar3.structures_by_tier.swing` or `internal`, any tier) | FVG bottom/top (fallback) |
| MSS (no FVG, structure entry) | Closest swing pivot by absolute price distance from entry | — | — |
| Trend | `candle1_low/high` of the pulled-back-into FVG | Closest swing pivot by absolute price distance from entry | FVG bottom/top |
| Inversion | `candle3_low/high` of the ORIGINAL FVG (bar at `created_ms`) — defines invalidation of the polarity flip | Closest swing pivot | — |

Each option is `{ value, cite, kind, rationale }`. Model must pick one of these in its surface_setup payload.

### Schema disambiguation (`setup-detector-schema.js`)

Before exposing engine objects inside candidate.components.*.value, rewrite ambiguous fields per [PARSE/ARCHITECT pattern](https://arxiv.org/abs/2510.08623):

| Engine field | Rewritten as | Reason |
|---|---|---|
| `fvg.reacted: true` | `displacement_at_creation: true` | "reacted" means displacement at FVG creation, NOT later retest |
| `fvg.state: "fresh"` | `state_semantic: "created_never_retested"` + `retested_since_creation: false` | "fresh" was misread as "fresh setup ready" |
| `fvg.state: "ce_tapped"` | `state_semantic: "midpoint_tapped_at_least_once"` + `retested_since_creation: true` | derived |
| `fvg.state: "taken"` | `state_semantic: "fully_traded_through"` + `valid_as_zone: false` | clarifies it's expired |
| `level.taken: true` | `swept: true, valid_as_target: false` | "taken" was treated as still-valid |
| `structure_event.reclaimed` | `is_reclaimed: bool` | already exists; surface explicitly |

Plus derived fields:
- `fvg.candle1_low` / `candle1_high` — derived from `created_ms - 2*tf_ms` + bars
- `fvg.candle3_low` / `candle3_high` — derived from `created_ms` + bars

~50 LOC pure transform. Prevents Pattern A misreads structurally even if the model peeks under the candidate summary.

### Tradable rule

A candidate is `tradable: true` iff:
- All required components for the entry model are `present: true`
- `grade_proposed` in `{ "A+", "B" }` (not `"no-trade"`)
- At least one stop_option is valid (cite resolves)
- At least one tp1 and tp2 cite to an unswept level

`grade_proposed` rule (mirrors strategy §7 step 7):
- All components present + all marked "clean" → `A+`
- All components present + at least one marked "weak" → `B`
- Any component missing → `no-trade`

`grade_capped` rule:
- `grade_capped = min(grade_proposed, ltf_bias_context.grade_cap)`
- If `ltf_bias_context.htf_ltf_alignment === "divergent"` and model isn't MSS → cap at `no-trade`
- If `ltf_bias_context.is_retrace_day` and `gates.engine.pillar2.current_tf.range_quality === "poor"` → cap at `B`

### Conflict resolution

If multiple models return `tradable: true` (e.g., MSS-bull AND Trend-bull):
- Use `cli/lib/entry-model-priority.js` resolver order.
- `entry_model_priority` field on ltf-bias frontmatter sets the preferred order for this session; resolver returns that.
- Tiebreaker if still tied: highest `grade_proposed`.

## Candidate object schema

```typescript
type Candidate = {
  best_candidate: {
    model: "MSS" | "Trend" | "Inversion",
    side: "long" | "short",
    entry: { value: number, cite: string },
    stop: { value: number, cite: string, kind: "fvg_candle1_low" | "fvg_candle3_low" | "swing_pivot" | "fvg_bottom" | "fvg_top" },
    stop_options: Array<{ value: number, cite: string, kind: string, rationale: string }>,
    tp1: { value: number, cite: string },
    tp2: { value: number, cite: string },
    grade_proposed: "A+" | "B",
    grade_capped: "A+" | "B" | "no-trade",
    components: {
      [componentName: string]: {
        present: boolean,
        cite: string,
        value: object | null,
        missing_reason?: string
      }
    },
    rationale: string  // 1-2 sentence summary, written by detector
  } | null,

  rejections: Array<{
    model: "MSS" | "Trend" | "Inversion",
    side: "long" | "short",
    reason: string  // single sentence
  }>,

  rejection_summary: string,  // 1-2 sentences, used when best_candidate is null

  meta: {
    detector_version: "1.0",
    leader: "mnq" | "mes",
    timestamp_ms: number,
    bar_close_ms: number  // bar this detection corresponds to
  }
}
```

Where the candidate lives in the bundle:

```
bundle.candidates = Candidate
```

Top level, parallel to `gates`, `brief_digest`. `bar-close.js` reads from here and injects into the per-bar prompt as `<candidate_object>...</candidate_object>`.

## Validator

`app/main/tools/surface.js` — extends existing `surfaceSetup` tool with an audit step before persisting.

```js
function validateSetupAgainstCandidate(payload, candidate, bundle) {
  const errors = [];

  // 1. All cites resolve
  for (const cite of [payload.entry_cite, payload.stop_cite, payload.tp1_cite, payload.tp2_cite]) {
    if (!resolveCite(cite, bundle)) errors.push(`cite ${cite} does not resolve`);
  }

  // 2. TP cites are untaken
  if (!isUntakenTarget(payload.tp1_cite, bundle)) errors.push(`tp1_cite points at a swept/taken level`);
  if (!isUntakenTarget(payload.tp2_cite, bundle)) errors.push(`tp2_cite points at a swept/taken level`);

  // 3. Stop is one of the detector's priority options
  const matchedStop = candidate.best_candidate?.stop_options?.find(opt => Math.abs(opt.value - payload.stop) < 0.01);
  if (!matchedStop) {
    errors.push(`stop value ${payload.stop} not in detector's stop_options: ${JSON.stringify(candidate.best_candidate?.stop_options)}`);
  }

  // 4. Grade <= grade_capped
  if (gradeRank(payload.grade) > gradeRank(candidate.best_candidate?.grade_capped)) {
    errors.push(`grade ${payload.grade} exceeds grade_capped ${candidate.best_candidate?.grade_capped}`);
  }

  // 5. No override: payload.model must match candidate.best_candidate.model + side
  if (payload.model !== candidate.best_candidate?.model || payload.side !== candidate.best_candidate?.side) {
    errors.push(`payload model/side ${payload.model}/${payload.side} does not match detector's pick ${candidate.best_candidate?.model}/${candidate.best_candidate?.side}`);
  }

  if (errors.length) throw new Error(`Setup validation failed: ${errors.join('; ')}`);
}
```

Mode: strict (reject on any error). Matches tests-only trust path. The Zod schema for `surface_setup` payload remains, this is an additional cross-validation step.

## Prompt changes

### `<phase name="entry_hunt">` rewrite

**Before** (~2000 tokens): full strategy walk — read engine, check MSS components, check Trend components, check Inversion components, decide grade, pick stop/tp.

**After** (~400 tokens):
- "Read the `<candidate_object>` block. If `best_candidate` is non-null, call `surface_setup` with these exact values: model, side, entry, stop (one of stop_options), tp1, tp2, grade (≤ grade_capped). Then write 2-3 sentences for `narration` explaining the chain (what set up, what triggered, what's at risk)."
- "If `best_candidate` is null, call `surface_no_trade` with `rejection_summary` verbatim as the reason. Add a short context note about what to watch (price level, time window) for the next bar."
- "You may NOT override the detector's pick or surface a setup it didn't find. If you disagree, surface no_trade and set `chain_status: degraded:disagreement` with a one-sentence reason in the no_trade `note` field. This persists to `ltf-bias.md` frontmatter and bubbles to `summary.md` chain_audit at session end for human review. The detector keeps its decision; you cannot trade."

### `<anti_patterns>` block (Phase 3)

New block referenced from `<phase name="entry_hunt">`, listing the 8 misses from this week:

```
❌ "FRESH FVG" DOES NOT MEAN "RETESTED"
   engine.fvgs[N].state: "fresh" + created_ms in the last 1-3 bars → the pullback HAS NOT happened yet.
   The 3 candles around created_ms CREATED the FVG, they did not retest it.

❌ "REACTED" DOES NOT MEAN "RETESTED"
   reacted: true / displacement_at_creation: true = the impulse that CREATED the FVG was clean.
   It does NOT mean a later pullback tested the zone.

❌ SWEPT LEVELS ARE NOT VALID TARGETS
   gates.engine.pillar1.session_levels.<LEVEL>.swept: true → never cite as TP.
   Use brief.overnight_block.untaken_above[] / untaken_below[] only.

❌ FVG-BOTTOM STOP IS A LAST-RESORT FALLBACK
   Strategy priority for FVG entries: candle 1 low of the 3-candle FVG formation > pullback swing low > FVG bottom.
   Detector emits stop_options[] pre-ranked. Pick priority 1 unless its cite fails to resolve.

❌ LOCKED LTF BIAS DOES NOT FORCE DIRECTION
   ltf_bias.bias is a snapshot, not a lock. If HTF + current structure both point opposite, direction resolution
   may flip the side. The detector handles this — trust its side pick.

❌ PHASE TAG IS DERIVED FROM ET CLOCK, NOT WRITTEN BY MODEL
   Do not author "phase: open_reaction_ny_pm" if current ET is before NY PM open at 13:30.

❌ SIZING IS PRE-COMPUTED, NEVER FABRICATED
   sizing_note must come from the <sizing_pre_computed> block in the brief prompt, cite memory.USER or strategy.sizing-table.

❌ NEVER PROMOTE GRADE PAST grade_capped
   If detector emits grade_capped: B, surfacing A+ will be rejected by the validator.
```

### Mirror to `.claude/commands/analyze.md`

Same changes mirrored to the CLI slash command body. CLAUDE.md hard constraint #2 — CLI is the canonical surface for non-Electron sessions.

## Pair handling

Detector runs on the leader symbol only. Brief and open_reaction phases don't call the detector. Once `ltf-bias.md` frontmatter has a defined `leader`, every subsequent entry_hunt bar uses that leader's engine state.

If `leader` is undefined (early in session, before minute-14 leader decision in open_reaction), detector returns:

```js
{ best_candidate: null, rejections: [], rejection_summary: "Awaiting leader decision in open_reaction", meta: {...} }
```

Bar-close routes to a wait state, not entry_hunt.

## File layout

```
cli/lib/
  setup-detector.js          (NEW, ~600 LOC) — orchestrator + per-model evaluators
  setup-detector-stops.js    (NEW, ~150 LOC) — stop placement rules
  setup-detector-schema.js   (NEW, ~50 LOC)  — engine field disambiguation
cli/commands/
  analyze.js                 (extend, ~+30 LOC) — call detectSetups, write to bundle.candidates
app/main/
  bar-close.js               (extend, ~+40 LOC) — read bundle.candidates, inject into per-bar prompt
  tools/surface.js           (extend, ~+200 LOC) — validator audit step in surface_setup
  prompts/analyze.md         (rewrite entry_hunt phase, add anti_patterns block)
.claude/commands/
  analyze.md                 (mirror prompt changes)
tests/
  setup-detector.test.js         (NEW, ~35 unit tests)
  setup-detector-stops.test.js   (NEW, ~10 unit tests)
  setup-detector-schema.test.js  (NEW, ~6 unit tests)
  surface-validator.test.js      (NEW, ~10 unit tests)
tests/fixtures/
  006-mss-bull-tradable.bundle.json + .expected.md      (NEW)
  007-trend-bull-tradable.bundle.json + .expected.md    (NEW)
  008-inversion-short-tradable.bundle.json + .expected.md (NEW)
  miss-regressions/                                      (NEW directory)
    miss-01-bars-by-tf-cite.bundle.json + .expected.md
    miss-02-fabricated-sizing.bundle.json + .expected.md
    miss-03-chain-status-null.bundle.json + .expected.md
    miss-04-swept-tp.bundle.json + .expected.md
    miss-05-locked-ltf-bias.bundle.json + .expected.md
    miss-06-premature-phase.bundle.json + .expected.md
    miss-07-wrong-stop.bundle.json + .expected.md
    miss-08-pullback-already-played.bundle.json + .expected.md
```

Total: ~1100 LOC new, ~290 LOC extending existing, ~70 new tests, 11 new fixtures.

## Test plan

### Unit tests

- **`setup-detector.test.js`** (~35 tests)
  - For each model (MSS/Trend/Inversion) × each component: positive case (present), negative case (absent). 16 components × 2 = ~32 tests.
  - Tradable rule: A+ / B / no-trade boundary cases.
  - Conflict resolution: tied tradable candidates → priority resolver picks.
  - Grade cap: grade_proposed > grade_cap → capped.
  - Pair handling: leader undefined → returns wait state.

- **`setup-detector-stops.test.js`** (~10 tests)
  - Candle 1 derivation: bar at `created_ms - 2*tf_ms` → correct low/high.
  - Candle 3 derivation: bar at `created_ms` → correct low/high.
  - Closest swing pivot: walks `structures_by_tier`, picks nearest.
  - Priority order: candle 1 invalid → falls to swing pivot → falls to FVG bottom.

- **`setup-detector-schema.test.js`** (~6 tests)
  - Each disambiguation rule: input engine field → expected rewritten field.

- **`surface-validator.test.js`** (~10 tests)
  - Cite that doesn't resolve → reject.
  - TP cite at swept level → reject.
  - Stop value not in stop_options → reject.
  - Grade > grade_capped → reject.
  - Model/side mismatch with detector → reject.
  - Valid payload → pass.

### Fixture tests (end-to-end)

Run detector on every paired bundle in `tests/fixtures/` and compare its output to expected:
- 001-current (existing) — Inter-session, expected `no-trade`.
- 002-paired-mnq-mes (existing) — expected per fixture grade.
- 003-engine-utilization (existing) — expected per fixture grade.
- 004-brief-digest (existing) — expected per fixture grade.
- 005-divergent-ny-open (existing) — divergent, MSS expected.
- 006-mss-bull-tradable (NEW) — A+ MSS-bull, full component coverage.
- 007-trend-bull-tradable (NEW) — A+ Trend-bull.
- 008-inversion-short-tradable (NEW) — A+ Inversion-short.

### Regression tests (the 8 misses)

Each miss from the research doc becomes a bundle snapshot where the detector MUST NOT replicate the original misread:

- miss-01: detector must cite `brief_digest.symbols.MNQ1!.htf.daily.change_pct`, not `bars_by_tf.daily.change_pct`.
- miss-02: detector emits stop/tp values; sizing is from helper, not fabricated by detector or model.
- miss-03: detector always emits chain_status (defined string), not null.
- miss-04: detector's TP cites must be in `untaken_above[]` (swept-level fixture must NOT produce a TP citing AS_H).
- miss-05: detector's `side` is decoupled from locked LTF bias; with HTF bull + locked bear LTF, detector returns MSS-bull when conditions met.
- miss-06: detector doesn't author phase tag (clock-derived in surface.js).
- miss-07: detector's stop_options have candle1_low first; FVG bottom is option 3.
- miss-08: detector's `retrace_to_fvg.present` is false when FVG is fresh and `inside_fvgs[]` doesn't contain it (despite `reacted: true`).

### Smoke fixtures

`npm run smoke:fixtures` continues to run schema + citation checks. New fixtures (006/007/008/miss-*) added to the smoke suite.

### Coverage target

All tests must pass before merge. No flaky tests. New regression test added for any future miss before fix lands.

## Edge cases handled

| Case | Behavior |
|---|---|
| Engine data stale (`meta.stale: true`) | Detector returns `{ best_candidate: null, rejection_summary: "Engine stale (age N min). Awaiting fresh data." }` |
| Leader undefined | Wait state (see Pair handling) |
| Brief frontmatter missing | Detector returns `{ best_candidate: null, rejection_summary: "Awaiting brief. Run brief phase first." }` |
| `chain_status: divergent` | Inversion + Trend capped at `no-trade`, MSS allowed (matches strategy: divergent + MSS = retrace day) |
| Bundle missing `engine_by_tf` (polling mode) | Detector errors loudly — bar-close must use full bundle, not polling-only |
| No untaken targets for direction | Tradable: false. rejection_summary: "Direction is bull but no untaken_above[] from brief. Re-run brief." |

## Risks

1. **Strategy ossification.** Once strategy is code, updates require PRs. Mitigation: `docs/strategy/*.md` remains the source of truth; detector cites strategy sections per predicate; strategy changes start in the spec, then propagate to code.

2. **Detector predicates wrong.** Tests are the safety net (per locked decision). Mitigation: every predicate has positive + negative unit test on real engine snippets; every miss from this week becomes a regression test; new misses (if any) get a regression test before fix lands.

3. **Coverage gap (detector misses a real setup).** No override path per locked decision — coverage gaps become trades-not-taken. Mitigation: model can write `chain_status: degraded:disagreement` to flag for human review, but cannot surface a trade. Gaps get fixed by adding predicates in a follow-up PR.

4. **Slow detector.** Detector runs on every bar close. Mitigation: pure function, no I/O; cite resolution is array lookups; expected runtime <50ms. Profile in tests.

5. **Cite resolution fragility.** If engine schema changes, cites break. Mitigation: `bundle.engine.schema_supported` check in detector; reject if schema unsupported.

## Open questions

None — all closed in brainstorm. Listed locked decisions table at top.

## References

- Research doc: [docs/research/2026-05-26-llm-strategy-fidelity.md](../../research/2026-05-26-llm-strategy-fidelity.md)
- Prior chain spec: [docs/superpowers/specs/2026-05-26-strategy-chain-design.md](./2026-05-26-strategy-chain-design.md)
- Strategy spec: [docs/strategy/trading-strategy-2026.md](../../strategy/trading-strategy-2026.md), [docs/strategy/entry-models.md](../../strategy/entry-models.md)
- AgentSpec DSL (architectural twin): [arXiv 2503.18666](https://arxiv.org/abs/2503.18666)
- PARSE/ARCHITECT schema optimization (Pattern A precedent): [arXiv 2510.08623](https://arxiv.org/abs/2510.08623)
- Governance precedent: ["prompt engineering for rules is legally unsafe"](https://www.acceldata.io/blog/approving-agentic-ai-tools-a-governance-risk-and-compliance-framework-for-legal-teams)
