# LLM Strategy Fidelity — Why Misses Keep Surfacing

**Date:** 2026-05-26
**Status:** Research, not yet implemented
**Driver:** A single session produced 8+ distinct strategy-fidelity bugs, each fixed reactively in prompt or schema. The pattern is the actual problem.

## Today's catalog of misses

| # | Miss | Surface | Root category |
|---|---|---|---|
| 1 | Brief cited `bars_by_tf.daily.change_pct` (deep, unreachable) instead of `brief_digest.symbols.MNQ1!.htf.daily.change_pct` | Data-access shape | Bundle structure |
| 2 | Brief wrote `"1.0 R · Tuesday standard"` without calling `computeSize()` helper | Fabrication | Helper not wired |
| 3 | Brief left `chain_status: null` — optional in Zod, model just omitted | Soft contract | Auto-derive needed |
| 4 | Model cited swept AS.H 29990 as a "bull continuation" target (R:R 0.22) | Strategy semantics | "Target" vs "level" |
| 5 | Locked LTF bias prevented entry when current structure flipped opposite | Stale state | Bias never re-evaluated |
| 6 | `open-reaction.md` tagged `phase: open_reaction_ny_pm` at 13:09 ET (21 min before NY PM open) | Clock vs session | Phase derivation |
| 7 | "15pt stop below FVG bottom" when 6pt stop below pullback swing low was valid | Strategy semantics | "Below the FVG low" read too literally |
| 8 | "Pullback to FVG 29998.5-29992.5 already played" when the 14:02-14:04 candles CREATED the FVG | Engine semantics | `reacted: true` ≠ "retested" |

**Eight bugs in one session, one trader.** Each fix has been a reactive prose patch. The model keeps finding new ways to misread the same spec.

## Pattern analysis

Group the misses by what's actually going wrong:

### Pattern A — Engine field name overloading (3 misses)

`reacted: true` could mean "reacted at creation" OR "reacted to a later retest." Same with `state: fresh` (model assumed it meant "fresh setup ready" — actually means "not yet retested"). And `taken: true` on a session level (model treated taken levels as still-valid targets).

**Cause:** the engine emits booleans whose names are ambiguous when read out of context.

### Pattern B — Prose strategy rules with multiple valid readings (3 misses)

Strategy says *"Stop: Below the swing low that touches the FVG or below the FVG low itself."* Model can read this as:
- A → tighter swing-low stop when available
- B → wider FVG-bottom stop as the safe default

Both are "valid" readings. The model picks B (wider, safer) when the trader wanted A (tighter, better R:R).

Same shape: *"Lanto never marries a bias"* — but our chain locks the LTF bias at minute 14. Same spec, contradictory implementations.

**Cause:** strategy documented as prose. Prose has multiple plausible interpretations. Even small reasoning models pick different ones.

### Pattern C — Missing pre-computation (2 misses)

`sizing_note` fabricated because helper output wasn't injected. Target picked from "what's closest on the chart" because untaken-targets list wasn't surfaced. The model defaulted to fabrication/heuristic when structured data was available but not injected.

**Cause:** Helpers exist (`computeSize`, `untaken_above`) but the per-turn prompt didn't pre-stage their output.

### Pattern D — Soft contracts the model can skip (2 misses)

`chain_status` was optional in Zod → model omitted. `phase` was a string the renderer trusted → model wrote the wrong value. The schema didn't force the model's hand.

**Cause:** Optional fields and free strings give the model an out.

## The deeper diagnosis

All four patterns share one root: **the model is doing too much interpretation**. We hand it strategy rules in prose, engine state in JSON, and ask it to package a setup. Every layer is interpretive.

Each layer is also a failure surface:
1. Read the engine field names correctly (`reacted`, `state`, `taken` — pattern A)
2. Apply strategy rules to the engine state (pattern B)
3. Use pre-computed helpers when present, otherwise compute (pattern C)
4. Fill schema fields meaningfully even when optional (pattern D)

That's four interpretive layers per turn. With ~30-60 bar-close turns per session, the expected number of misses is the per-turn miss rate × 4 × 30 = high.

## What the strategy actually is, structurally

Lanto's 3-pillar ICT framework, when decomposed, is a finite decision tree:

```
Pillar 1 (Draw & Bias):
  HTF direction = f(per-TF momentum, per-TF structure, primary PD array)
  Overnight verdict = f(session levels, sweeps, untaken pools)
  Primary draw = highest-priority HTF PD array (ranked)

Pillar 2 (Quality):
  Verdict = f(range_quality, displacement, candle, h4/h1 quality, FVG size)

Pillar 3 (Entry Model + Confirmation):
  MSS components (6): each is a boolean over engine state
  Trend components (5): each is a boolean over engine state
  Inversion components (5): each is a boolean over engine state
  Confirmation = boolean over last_bar
  Grade = f(component_presence_count, weakness_count, grade_cap)

Risk & Target:
  Stop = lookup by (model_type, FVG_or_swing_present, candle anchors)
  TP1 = nearest untaken internal swing in direction
  TP2 = next untaken HTF level (from a pre-filtered list)
  Sizing = lookup by (day_of_week, grade, memory_overrides)
```

**Every node in that tree is a deterministic predicate over engine state.** Not interpretation. Boolean logic on numbers.

The current system asks the model to evaluate all of these in prose. The model is good at prose but bad at boolean precision over numeric thresholds.

## Approaches surveyed

| Approach | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| **A. Status quo + reactive patches** | Keep prose strategy, fix specific misreads in prompt | Cheap per-fix | Cumulative complexity; new misses faster than patches | ongoing |
| **B. Anti-pattern few-shot in prompts** | Add "❌ DO NOT cite swept level as TP" examples | Targeted; model learns boundaries | Cold start; doesn't cover unseen misses | medium |
| **C. Engine field name disambiguation** | Rename `reacted` → `reacted_at_creation`, etc., AND inject explicit "this means X, not Y" mini-doc per turn | Eliminates pattern A | Requires Pine indicator changes; partial | medium |
| **D. Pre-computed candidate setups** | Code module evaluates MSS/Trend/Inversion components per bar; emits structured candidate list; model picks from list | Eliminates patterns A, B, C; model becomes packager | Code becomes strategy authority — requires rigor + tests + change control | large |
| **E. Post-hoc validator** | After model calls `surface_setup`, code audits cites against engine state; rejects/warns on mismatch | Cheap safety net; catches what slips through | Reactive (rejects after model burns tokens); doesn't help surfacing | small |
| **F. DSL for strategy rules** | Express strategy as YAML/JSON predicates; generate prompts + validators from one source | Single source of truth; testable | Heavy upfront; team has to learn DSL | very large |

## Recommended architecture

**D + E + B, in that order.** Convert strategy from prose-the-model-interprets to code-the-model-packages.

### Phase 1 — Pre-computed candidate setups (`cli/lib/setup-detector.js`)

A pure function `detectSetups(bundle, leader, ltf_bias_context, untaken_targets)` returns:

```js
{
  candidates: [
    {
      model: "MSS",
      side: "long",
      components: {
        context_draw:        { present: true,  cite: "pillar1.mnq.htf_destination", value: "above 30119 buy-side" },
        liquidity_grab:      { present: true,  cite: "engine.swings[7]",            value: { low: 29982.25, swept: true } },
        mss_displacement:    { present: true,  cite: "engine.structures[8]",        value: { event: "bos", dir: "bull", level: 30002.25, displacement: true, validation: "sweep" } },
        retrace_to_fvg:      { present: false, cite: "engine.fvgs[3]",              value: { state: "fresh", created_ms: <ts>, retested: false }, missing_reason: "fvg just created, no retest yet" },
        confirmation:        { present: false, cite: "engine.confirmation.last_bar", value: { body_ratio: 0.485, direction: "bearish" }, missing_reason: "bearish bar, no bull-side confirmation" },
        risk_target: {
          stop_options: [
            { kind: "fvg_candle1_low",  value: 29981.25, cite: "bars_by_tf.m1.last_5_bars[N].low",  rationale: "FVG candle 1 low (first formation candle)" },
            { kind: "swing_low",        value: 29982.25, cite: "engine.swings.internal[7].price", rationale: "closest swing low below entry" },
            { kind: "fvg_bottom",       value: 29992.5,  cite: "engine.fvgs[3].bottom",            rationale: "FVG bottom (fallback)" },
          ],
          tp1: { value: <internal_high>, cite: ... },
          tp2: { value: <untaken_above[0].price>, cite: "pillar1.mnq.overnight.untaken_above[0]" },
        },
      },
      components_present: 3,
      components_missing: 2,
      grade_proposed: "no-trade",  // 2 missing → no-trade per rule
      grade_cap: "B",              // from ltf-bias
      tradable: false,             // grade_proposed != no-trade && all-components-present
    },
    {
      model: "Trend",
      side: "long",
      components: { ... },
      ...
    },
    { model: "Inversion", side: "long", ... },
  ],
  best_candidate: null,            // or one of the above when grade_proposed in {A+, B}
  rejection_summary: "All 3 models missing 2+ components. Awaiting retest into fresh FVG (29992.5-29998.5) OR re-sweep of 29982.25 with bull confirmation."
}
```

The model gets this object pre-injected into the per-bar prompt. Its job is:
1. Read `best_candidate` and decide whether to surface it.
2. If `tradable: true` → call `surface_setup` with the structured payload (just copy fields from the candidate).
3. If `tradable: false` → call `surface_no_trade` with `rejection_summary` verbatim.

**Model can no longer**:
- Misread `state: fresh` (component "retrace_to_fvg.present" is the boolean it reads)
- Pick a swept level as TP (candidate's `tp2.cite` is constrained to `untaken_*`)
- Use the wrong stop reference (candidate's `stop_options` are pre-ranked)
- Marry a stale bias (candidate's `tradable` already accounts for divergent/overrides)

### Phase 2 — Post-hoc validator (`app/main/tools/surface.js`)

When `surface_setup` is called:

```js
function validateSetupPayload(payload, bundle) {
  const errors = [];
  // 1. Every cite resolves
  for (const cite of [payload.entry_cite, payload.stop_cite, payload.tp1_cite, payload.tp2_cite]) {
    if (!resolveCite(cite, bundle)) errors.push(`cite ${cite} does not resolve`);
  }
  // 2. TP cites point at untaken_targets, not swept levels
  if (!isUntakenTarget(payload.tp1_cite, bundle) || !isUntakenTarget(payload.tp2_cite, bundle)) {
    errors.push(`tp_cite points at a swept level`);
  }
  // 3. Stop is one of the priority options
  const expectedStops = computeStopOptions(payload, bundle);
  if (!expectedStops.some((s) => s.value === payload.stop)) {
    errors.push(`stop value not in computed stop_options: ${JSON.stringify(expectedStops)}`);
  }
  // 4. Grade ≤ grade_cap
  if (gradeRank(payload.grade) > gradeRank(payload.grade_cap)) {
    errors.push(`grade ${payload.grade} exceeds grade_cap ${payload.grade_cap}`);
  }
  // 5. State of cited primary_draw is valid for the model claimed
  ...
  if (errors.length) throw new Error(...);
}
```

This is the safety net. Setup-detector should produce valid candidates; validator catches anything that slips through.

### Phase 3 — Anti-pattern examples in prompt

Add a short `<anti_patterns>` block to `<phase name="entry_hunt">` with the exact misreads from today:

```
❌ CITING SWEPT LEVELS AS TARGETS:
   gates.engine.pillar1.session_levels.AS_H.swept: true → AS_H is NOT a valid target.
   ✓ Use brief.overnight_block.untaken_above[].price instead.

❌ "FRESH FVG" MEANS "NOT YET RETESTED":
   engine.fvgs[N].state: "fresh" + created_ms in the last 1-3 bars →
   The pullback HAS NOT happened yet. The 3 candles around created_ms CREATED the FVG.
   "Retrace to FVG" component is MISSING until price returns and inside_fvgs[] contains it.

❌ "REACTED" DOES NOT MEAN "RETESTED":
   reacted: true = displacement reacted off the prior candle AT FVG CREATION.
   It does NOT mean a later pullback tested the zone.

❌ FVG-BOTTOM STOP IS A FALLBACK:
   Strategy says "Below the swing low that touches the FVG OR below the FVG low itself."
   Read as priority: prefer swing-low stop (tighter, better R:R). FVG-low only when no clean pullback swing low.
```

These get re-injected on every turn until the patterns die out.

## What this buys us

**Today's eight misses, mapped to the proposed architecture:**

| # | Today's miss | Caught by |
|---|---|---|
| 1 | bars_by_tf cite | Already fixed (digest sidecar) |
| 2 | Fabricated sizing | Already fixed (helper injection) |
| 3 | chain_status null | Already fixed (auto-derive) |
| 4 | Swept-level TP | **Validator** (Phase 2) + setup detector's tp2.cite constraint (Phase 1) |
| 5 | Locked LTF bias | **Setup detector** uses live engine signals, not locked bias (Phase 1) |
| 6 | Phase tag premature | Already fixed (clock-derived) |
| 7 | Wrong stop reference | **Setup detector** pre-ranks stop_options; validator enforces (Phases 1+2) |
| 8 | "Pullback played" misread | **Setup detector**'s `retrace_to_fvg.present` is a boolean over engine state (Phase 1) |

Of the eight, **four** would be caught structurally by the new architecture vs reactive prompt patches. The other four are already fixed.

## Cost estimate

- Setup detector (Phase 1): ~500-800 LOC, ~30 unit tests covering each component evaluation. Mostly pure functions of engine state.
- Validator (Phase 2): ~200 LOC, ~15 unit tests.
- Anti-pattern prompt block (Phase 3): ~50 lines of prompt text.

Total: ~1000 LOC + tests + prompt. Comparable to one of today's PRs.

## Risks

1. **Strategy ossification.** Once strategy is code, updating it requires PRs not prose edits. Mitigation: keep `docs/strategy/*.md` as the source of truth; detector + validator are derivations. Updates start in the spec.

2. **False positives (validator rejects valid setups).** A too-strict validator blocks legitimate trades. Mitigation: start with warnings (log + chain_status: degraded) for 1-2 weeks before throwing.

3. **Coverage gaps.** Detector might miss a setup pattern. Mitigation: model still has surface_setup access; if model surfaces a setup not matched by detector, the validator audits cites + grades it as B-capped.

## Recommendation

Build Phase 1 (setup detector) first. It's the highest leverage and forces us to write down the strategy literally. Phase 2 (validator) is the safety net. Phase 3 (anti-patterns) is a quick win that should land alongside Phase 1 to prevent regressions during the transition.

After Phase 1 ships, the per-bar entry_hunt prompt collapses from "walk all three models from scratch" to "read pre-computed candidates, pick best, surface." That's ~5x less prompt text, ~3x less cost per turn, and zero category-A/B/C/D misreads structurally possible.

## Literature support (added 2026-05-26, second research pass)

After the initial diagnosis and architecture proposal, a second research pass surveyed the academic and industry literature directly. Findings:

### The pattern has a name: neurosymbolic agent design

What we called "setup detector + validator" is the **planner / executor / validator** pattern in the agent-systems literature, also called **neurosymbolic agent architecture** when the planner/validator parts are deterministic code rather than additional LLM calls. Empirical lift in role-separated multi-agent systems is **+2.86% to +21.88%** on biomedical QA depending on task complexity ([Polarix](https://polarixdata.com/en/blog/designing-a-state-of-the-art-multi-agent-system/)). The pattern is mature; we are not inventing.

### Constitutional / hard-rule literature — the strongest signal

The most aligned source: **"If an agentic system relies on prompt engineering to follow rules, it is legally unsafe; governance must be deterministic (code-based guardrails), not probabilistic."** ([Acceldata](https://www.acceldata.io/blog/approving-agentic-ai-tools-a-governance-risk-and-compliance-framework-for-legal-teams)). Written about legal compliance, but the argument generalizes: when rules are precise and verifiable, code is the contract, not prose. Our 4-pattern diagnosis is just the trading-domain manifestation of that principle.

### Pattern A (field overloading) — confirmed as a real research area

The PARSE / ARCHITECT line of work ([arXiv 2510.08623](https://arxiv.org/abs/2510.08623)) directly addresses what we called "engine field name overloading." Their finding: **schemas often contain ambiguous descriptions, incomplete validation rules, and structural choices optimized for human readability rather than machine comprehension.** ARCHITECT iteratively rewrites field names + descriptions to be unambiguous; reported as **up to 40% accuracy lift on complex extraction tasks** ([Jasmine Directory survey](https://www.jasminedirectory.com/blog/structuring-data-for-llms-why-your-schema-matters-more-than-ever/)).

**Direct implication for us:** the detector should not just expose `value: {state: "fresh", reacted: true}` from the engine. It should rewrite into semantic form: `value: {state_semantic: "created_not_yet_retested", displacement_at_creation: true, retested_since_creation: false}`. The renames are cheap and structural — they prevent the model from re-interpreting the original ambiguous flag. Add this as part of Phase 1.

### Pattern B (prose ambiguity) — DSL approach validated

**AgentSpec** ([arXiv 2503.18666](https://arxiv.org/abs/2503.18666)) is a DSL with exactly three primitives: **triggers, predicates, enforcements**. Use cases tested include **financial transactions with amount + recipient constraints**. The runtime sits as middleware that intercepts agent actions before execution. This is structurally the same shape as our Phase 1 + Phase 2 split:
- Trigger = bar close
- Predicate = component evaluation in the detector (boolean over engine state)
- Enforcement = validator rejects/warns on the model's surfaced setup

A trading-specific result: a recent Springer paper on DSL-driven strategy specification reports **95.3% match rate translating natural-language trading rules into a formal DSL** via in-context learning ([Springer chapter](https://link.springer.com/chapter/10.1007/978-981-96-9891-2_24)). Translating Lanto's prose into a strategy DSL is plausible at high fidelity if we go further than Phase 1.

### Pattern C (missing pre-computation) — process-reward / planner-executor literature

Process Reward Models (PRMs) score each intermediate step ([arXiv 2511.08325 AgentPRM](https://arxiv.org/abs/2511.08325), [arXiv 2502.10325](https://arxiv.org/html/2502.10325v1)). The architectural insight: **"actions in agent tasks do not have a clear-cut correctness, and instead should be evaluated based on their proximity to the goal and the progress they have made."** Our pre-computed helpers (computeSize, untaken_above) are step-level structured outputs the model can lean on instead of fabricating — which is the planner half of planner-executor. PRMs are the more ambitious version (score every step), but our minimum needed is just: pre-stage the helper outputs and the model uses them. ToolPRMBench is the relevant evaluation benchmark for tool-using agents.

### Pattern D (soft contracts) — confirmed by trading benchmarks

StockBench, FinTradeBench, and TradeTrap all report that **"practical operational issues are prevalent: arithmetic errors, schema formatting mistakes, and occasional misalignment with reward optimization signal that agent output reliability remains a challenge, independent of model scale or sophistication"** ([emergentmind/stockbench](https://www.emergentmind.com/topics/stockbench), [arXiv 2603.19225](https://arxiv.org/abs/2603.19225), [TradeTrap arXiv 2512.02261](https://arxiv.org/abs/2512.02261)). Confirms: bigger model does not fix this. Schema enforcement does. Optional fields → omitted regardless of model. Required + cross-validated → filled.

### Self-verification (CoVe) is a complement, not a replacement

Chain-of-Verification ([arXiv 2309.11495](https://arxiv.org/abs/2309.11495)) achieves **+23% F1** by having the model verify its own draft. Real lift but **"CoVe reduces but doesn't fully eliminate hallucinations, especially in reasoning steps"** ([learnprompting summary](https://learnprompting.org/docs/advanced/self_criticism/chain_of_verification)). Same conclusion as the hard-rule lit: self-critique is useful, but cannot be the only line of defense for predicates that have a single correct answer. We could add a CoVe-style self-check inside `<phase name="entry_hunt">` as a small additional gain, but it does not substitute for Phase 1 or 2.

### What no one else seems to be doing publicly

ICT/SMC + LLM integration: zero published academic work, several open-source generic trading-agent frameworks ([TradingAgents](https://github.com/tauricresearch/tradingagents), [FinMem](https://github.com/pipiku915/FinMem-LLM-StockTrading), [LLM-TradeBot](https://github.com/EthanAlgoX/LLM-TradeBot)), none combining a dedicated ICT engine indicator with structured LLM execution. Existing SMC Python libs detect FVGs/order blocks/BOS/CHoCH but don't feed an LLM agent. Our system architecture is novel; the LLM-fidelity problem is well-mapped.

## Updated recommendation (revised after literature pass)

Build Phase 1 + Phase 2 in the same PR, with one addition to Phase 1: **schema-rewrite step inside the detector** to disambiguate engine fields (PARSE/ARCHITECT pattern). Specifically:

In `cli/lib/setup-detector.js`, before placing engine objects into candidate `value` blocks, rewrite ambiguous fields:

```js
function disambiguateFvg(fvg) {
  return {
    fvg_top: fvg.top,
    fvg_bottom: fvg.bottom,
    state_semantic: ({
      fresh: "created_never_retested",
      ce_tapped: "midpoint_tapped_at_least_once",
      taken: "fully_traded_through",
    })[fvg.state],
    displacement_at_creation: fvg.reacted,    // was: reacted (ambiguous)
    retested_since_creation: fvg.state !== "fresh",   // derived
    created_at: fvg.created_ms,
    candle1_low: deriveCandle1Low(fvg, bars),  // pre-computed structural stop
    candle3_low: deriveCandle3Low(fvg, bars),
    is_inverted: fvg.kind === "ifvg",
  };
}
```

Same treatment for swept levels (`taken: true` → `swept: true, valid_as_target: false`), structure events (clarify `reclaimed`), etc. This is ~50 LOC inside the detector and structurally prevents Pattern A misreads even if the model peeks under the candidate summary.

**Hard-rule literature** strengthens the case that risk-critical computations (sizing, stops, R:R) MUST be code-side, not LLM-side. The TradingAgents framework and TradeTrap paper specifically call out position sizing and stop placement as non-negotiably deterministic. We already have computeSize; Phase 1 extends to stop placement via `stop_options[]`.

## Answers to the open questions (literature-backed where possible)

1. **Detector caching:** Cache by bar timestamp. The detector is pure of `(bundle, leader, ltf_bias_context, untaken_targets)`. Same inputs → same output. Per-bar memoization gives the lighter cost without sacrificing freshness. (Literature is silent on this; standard pure-function memoization applies.)

2. **Auto-surface tradable candidates:** No. **The planner/executor pattern in the literature consistently keeps the executor (LLM) responsible for the final action.** AgentSpec is post-action enforcement, not pre-action auto-execute. Reason: the model still owns narration (chain_status reasoning, contextual notes) and the human-readable surface; auto-firing strips that. Recommendation: pre-stage candidates, model picks + narrates, validator audits.

3. **Validator rejects or warns:** Phase in. AgentSpec's enforcement is configurable per-rule (block or log). Standard rollout: **warn-only for 1-2 weeks** (record mismatches in `chain_status: degraded:<reason>` + metrics), then **promote to reject** once the false-positive rate from the warn-mode data is < 1%. Reject path should still tag the mismatch in chain_status so it's visible in `summary.md` audits.

## Sources

Architecture / DSL:
- [AgentSpec: Customizable Runtime Enforcement for Safe and Reliable LLM Agents (arXiv 2503.18666)](https://arxiv.org/abs/2503.18666)
- [AgentSpec ICSE 2026 preprint](https://cposkitt.github.io/files/publications/agentspec_llm_enforcement_icse26.pdf)
- [Designing Trading Strategies with LLMs: A DSL-Driven Framework (Springer 2025)](https://link.springer.com/chapter/10.1007/978-981-96-9891-2_24)
- [A Declarative Language for LLM-Powered Agent Workflows (arXiv 2512.19769)](https://arxiv.org/abs/2512.19769)
- [AI Agent Guardrails: Rules LLMs Cannot Bypass (AWS DEV)](https://dev.to/aws/ai-agent-guardrails-rules-llms-cannot-bypass-1eo3) *(cited in initial pass)*
- [Pre-LLM & Post-LLM Guardrails (Arthur AI)](https://www.arthur.ai/blog/ai-agent-guardrails-pre-llm-post-llm-best-practices) *(cited in initial pass)*

Schema design:
- [PARSE: LLM-Driven Schema Optimization for Reliable Entity Extraction (arXiv 2510.08623)](https://arxiv.org/abs/2510.08623)
- [Structuring Data for LLMs: Why Schema Matters (Jasmine Directory)](https://www.jasminedirectory.com/blog/structuring-data-for-llms-why-your-schema-matters-more-than-ever/)
- [Mastering LLM Output: JSON Schema for Data Validation (PenBrief)](https://www.penbrief.com/json-schema-llm-output-validation/)

Self-verification / process supervision:
- [Chain-of-Verification Reduces Hallucination in LLMs (arXiv 2309.11495)](https://arxiv.org/abs/2309.11495)
- [CoVe: structured metacognitive verification (learnprompting)](https://learnprompting.org/docs/advanced/self_criticism/chain_of_verification)
- [AgentPRM: Process Reward Models for LLM Agents via Step-Wise Promise and Progress (arXiv 2511.08325)](https://arxiv.org/abs/2511.08325)
- [Process Reward Models: Practical Framework and Directions (arXiv 2502.10325)](https://arxiv.org/html/2502.10325v1)

Multi-agent role separation:
- [Designing a State-of-the-Art Multi-Agent System (Polarix)](https://polarixdata.com/en/blog/designing-a-state-of-the-art-multi-agent-system/)
- [Multi-Agent LLMs: How Specialized AI Agents Collaborate (Deepchecks)](https://www.deepchecks.com/how-multi-agent-llms-differ-from-traditional-llms/)
- [Traceability and Accountability in Role-Specialized Multi-Agent Pipelines (arXiv 2510.07614)](https://arxiv.org/abs/2510.07614)

Trading-specific reliability:
- [TradingAgents: Multi-Agents LLM Financial Trading Framework](https://tradingagents-ai.github.io/) *(cited in initial pass)*
- [TradeTrap: Are LLM-based Trading Agents Truly Reliable and Faithful? (arXiv 2512.02261)](https://arxiv.org/abs/2512.02261) *(cited in initial pass)*
- [StockBench: LLM Trading Benchmark](https://www.emergentmind.com/topics/stockbench)
- [FinTradeBench: A Financial Reasoning Benchmark for LLMs (arXiv 2603.19225)](https://arxiv.org/abs/2603.19225)
- [ReliabilityBench: Evaluating LLM Agent Reliability (arXiv 2601.06112)](https://arxiv.org/abs/2601.06112)

Governance / hard-rule reasoning:
- [Agentic AI Governance Compliance: Legal & Risk Guide (Acceldata)](https://www.acceldata.io/blog/approving-agentic-ai-tools-a-governance-risk-and-compliance-framework-for-legal-teams)
- [Law-Following AI: Designing AI Agents to Obey Human Laws (Institute for Law & AI)](https://law-ai.org/law-following-ai/)
- [Law-Following AI Framework (arXiv 2509.08009)](https://arxiv.org/abs/2509.08009)
- [Rule Encoding and Compliance in LLMs (arXiv 2510.05106)](https://arxiv.org/abs/2510.05106) *(cited in initial pass)*

## Open questions for the user (revised)

The three questions from the initial pass now have literature-backed defaults:

1. ~~**Setup detector run every bar or cached?**~~ → **Cache by bar timestamp.** Same inputs → same outputs; standard pure-function memoization.
2. ~~**Auto-surface tradable candidates?**~~ → **No, require model narration.** Matches AgentSpec post-action pattern + planner/executor lit.
3. ~~**Validator rejects or warns?**~~ → **Phase in: warn 1-2 weeks → reject when false-positive rate < 1%.** Standard rollout for runtime enforcement systems.

Remaining live decisions:
- Build Phase 1 + Phase 2 in one PR (recommended) or sequence them?
- Land the schema-disambiguation step inside Phase 1 (recommended, +50 LOC, addresses Pattern A structurally) or skip it for v1?
- Pursue a full strategy DSL (option F in surveyed approaches) as a v2 follow-up, or stop at Phase 1+2+3?
