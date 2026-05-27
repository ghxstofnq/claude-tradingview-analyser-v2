import { disambiguateFvg, disambiguateSessionLevel, disambiguateStructureEvent } from './setup-detector-schema.js';
import { stopOptionsForFvgEntry, stopOptionsForInversionEntry, stopOptionsForStructureEntry } from './setup-detector-stops.js';

const TF_MS = { m1: 60_000, m5: 300_000, m15: 900_000, h1: 3_600_000, h4: 14_400_000, daily: 86_400_000 };

// ============================================================================
// MSS — 6 components, evaluated against engine state.
// Strategy reference: docs/strategy/entry-models.md §MSS.
// ============================================================================

const MIN_CONFIRMATION_BODY_RATIO = 0.6;

export function evaluateMssComponents(bundle, ctx, tf) {
  const eng = bundle?.gates?.engine ?? {};
  const tfEng = bundle?.engine_by_tf?.[tf] ?? {};
  const side = ctx.side;
  const isLong = side === 'long';

  // 1. context_draw — side aligns with htf_destination dir.
  const htfDir = ctx.htf_destination?.dir;
  const context_draw_aligned = (isLong && htfDir === 'above') || (!isLong && htfDir === 'below');
  const context_draw = {
    present: context_draw_aligned,
    cite: ctx.htf_destination?.cite ?? null,
    value: ctx.htf_destination ?? null,
    ...(context_draw_aligned ? {} : { missing_reason: `htf_destination dir=${htfDir}, side=${side} not aligned` }),
  };

  // 2. liquidity_grab — recent sweep matching side.
  const sweeps = eng.pillar1?.sweeps ?? [];
  const matchingSweep = sweeps.find((s) =>
    isLong ? s.side === 'sell' && s.rejected : s.side === 'buy' && s.rejected
  );
  const liquidity_grab = {
    present: !!matchingSweep,
    cite: matchingSweep ? `gates.engine.pillar1.sweeps[${sweeps.indexOf(matchingSweep)}]` : null,
    value: matchingSweep ?? null,
    ...(matchingSweep ? {} : { missing_reason: `no rejected ${isLong ? 'sell-side' : 'buy-side'} sweep in pillar1.sweeps` }),
  };

  // 3. mss_displacement — engine's pre-filtered failure_swings (mss + validation=sweep).
  const failureSwings = eng.pillar3?.failure_swings ?? [];
  const matchingFs = failureSwings.find((fs) => fs.dir === (isLong ? 'bull' : 'bear'));
  const mss_displacement = {
    present: !!matchingFs,
    cite: matchingFs ? `gates.engine.pillar3.failure_swings[${failureSwings.indexOf(matchingFs)}]` : null,
    value: matchingFs ?? null,
    ...(matchingFs ? {} : { missing_reason: `no failure_swing with dir=${isLong ? 'bull' : 'bear'} in pillar3.failure_swings` }),
  };

  // 4. retrace_to_fvg — currently inside a fresh FVG of correct direction.
  // CRITICAL: "fresh" means never-retested. inside_fvgs[] currently containing the FVG = real retrace.
  const insideFvgs = eng.price_context?.inside_fvgs ?? [];
  const insideMatch = insideFvgs.find((f) => f.dir === (isLong ? 'bull' : 'bear') && f.state === 'fresh');
  const retrace_to_fvg = {
    present: !!insideMatch,
    cite: insideMatch ? `gates.engine.price_context.inside_fvgs[${insideFvgs.indexOf(insideMatch)}]` : null,
    value: insideMatch ? disambiguateFvg(insideMatch) : null,
    ...(insideMatch ? {} : { missing_reason: 'price not currently inside a fresh same-direction FVG — fresh FVG just created is not yet retested' }),
  };

  // 5. confirmation — last_bar body_ratio + direction.
  const lb = eng.confirmation?.last_bar ?? {};
  const lbEmpty = lb.direction == null && lb.body_ratio == null;
  const confirmedDir = (isLong && lb.direction === 'bullish') || (!isLong && lb.direction === 'bearish');
  const bodyOk = (lb.body_ratio ?? 0) >= MIN_CONFIRMATION_BODY_RATIO;
  const confirmation = {
    present: confirmedDir && bodyOk,
    cite: 'gates.engine.confirmation.last_bar',
    value: lb,
    ...(confirmedDir && bodyOk ? {} : {
      missing_reason: lbEmpty
        ? 'no last_bar emitted yet (engine has not closed a bar this TF)'
        : !bodyOk
          ? `last_bar.body_ratio ${lb.body_ratio} below ${MIN_CONFIRMATION_BODY_RATIO}`
          : `last_bar.direction ${lb.direction} not matching side ${side}`,
    }),
  };

  // 6. displacement_quality — pillar3 size_quality AND pillar2 displacement.
  const sizeQ = eng.pillar3?.fvg_summary?.size_quality;
  const dispQ = eng.pillar2?.current_tf?.displacement;
  const sizeOk = !!sizeQ && sizeQ !== 'weak';
  const dispOk = dispQ === 'clean' || dispQ === 'acceptable';
  const displacement_quality = {
    present: sizeOk && dispOk,
    cite: 'gates.engine.pillar3.fvg_summary.size_quality + gates.engine.pillar2.current_tf.displacement',
    value: { size_quality: sizeQ, displacement: dispQ },
    ...(sizeOk && dispOk ? {} : {
      missing_reason: !sizeOk
        ? (sizeQ == null ? 'size_quality missing in pillar3.fvg_summary' : `size_quality=${sizeQ} is weak`)
        : (dispQ == null ? 'pillar2 displacement missing in current_tf' : `pillar2 displacement=${dispQ} not in {clean, acceptable}`),
    }),
  };

  return { context_draw, liquidity_grab, mss_displacement, retrace_to_fvg, confirmation, displacement_quality };
}

// ============================================================================
// Trend — 5 components. Strategy ref: docs/strategy/entry-models.md §Trend.
// ============================================================================

export function evaluateTrendComponents(bundle, ctx, tf) {
  const eng = bundle?.gates?.engine ?? {};
  const side = ctx.side;
  const isLong = side === 'long';

  // 1. context_draw — same as MSS.
  const htfDir = ctx.htf_destination?.dir;
  const aligned = (isLong && htfDir === 'above') || (!isLong && htfDir === 'below');
  const context_draw = {
    present: aligned,
    cite: ctx.htf_destination?.cite ?? null,
    value: ctx.htf_destination ?? null,
    ...(aligned ? {} : { missing_reason: `htf_destination dir=${htfDir}, side=${side} not aligned` }),
  };

  // 2. bos_in_direction — most_recent_structure is BoS in correct dir.
  const mrs = eng.pillar3?.most_recent_structure;
  const bosOk = mrs?.event === 'bos' && mrs?.dir === (isLong ? 'bull' : 'bear');
  const bos_in_direction = {
    present: bosOk,
    cite: 'gates.engine.pillar3.most_recent_structure',
    value: mrs ?? null,
    ...(bosOk ? {} : {
      missing_reason: mrs
        ? `most_recent_structure event=${mrs.event} dir=${mrs.dir} not BoS in side ${side}`
        : `no structure event in pillar3.most_recent_structure (side ${side} needs BoS)`,
    }),
  };

  // 3. pullback_to_pd_array — inside any FVG or BPR of correct dir.
  const insideFvgs = eng.price_context?.inside_fvgs ?? [];
  const insideBprs = eng.price_context?.inside_bprs ?? [];
  const dirMatch = (z) => z.dir === (isLong ? 'bull' : 'bear');
  const fvg = insideFvgs.find((f) => dirMatch(f) && f.state !== 'taken');
  const bpr = insideBprs.find((b) => dirMatch(b) && b.state !== 'taken');
  const match = fvg ?? bpr;
  const pullback_to_pd_array = {
    present: !!match,
    cite: fvg
      ? `gates.engine.price_context.inside_fvgs[${insideFvgs.indexOf(fvg)}]`
      : bpr
        ? `gates.engine.price_context.inside_bprs[${insideBprs.indexOf(bpr)}]`
        : null,
    value: match ? disambiguateFvg(match) : null,
    ...(match ? {} : { missing_reason: `no inside FVG or BPR matching dir=${isLong ? 'bull' : 'bear'}` }),
  };

  // 4. confirmation — same as MSS.
  const lb = eng.confirmation?.last_bar ?? {};
  const lbEmpty = lb.direction == null && lb.body_ratio == null;
  const confirmedDir = (isLong && lb.direction === 'bullish') || (!isLong && lb.direction === 'bearish');
  const bodyOk = (lb.body_ratio ?? 0) >= MIN_CONFIRMATION_BODY_RATIO;
  const confirmation = {
    present: confirmedDir && bodyOk,
    cite: 'gates.engine.confirmation.last_bar',
    value: lb,
    ...(confirmedDir && bodyOk ? {} : {
      missing_reason: lbEmpty
        ? 'no last_bar emitted yet (engine has not closed a bar this TF)'
        : !bodyOk
          ? `body_ratio ${lb.body_ratio} below ${MIN_CONFIRMATION_BODY_RATIO}`
          : `direction ${lb.direction} not matching side ${side}`,
    }),
  };

  // 5. displacement_quality — same as MSS.
  const sizeQ = eng.pillar3?.fvg_summary?.size_quality;
  const dispQ = eng.pillar2?.current_tf?.displacement;
  const sizeOk = !!sizeQ && sizeQ !== 'weak';
  const dispOk = dispQ === 'clean' || dispQ === 'acceptable';
  const displacement_quality = {
    present: sizeOk && dispOk,
    cite: 'gates.engine.pillar3.fvg_summary.size_quality + gates.engine.pillar2.current_tf.displacement',
    value: { size_quality: sizeQ, displacement: dispQ },
    ...(sizeOk && dispOk ? {} : {
      missing_reason: !sizeOk
        ? (sizeQ == null ? 'size_quality missing in pillar3.fvg_summary' : `size_quality=${sizeQ} is weak`)
        : (dispQ == null ? 'displacement missing in pillar2.current_tf' : `displacement=${dispQ} not in {clean, acceptable}`),
    }),
  };

  return { context_draw, bos_in_direction, pullback_to_pd_array, confirmation, displacement_quality };
}

// ============================================================================
// Inversion — 5 components. Strategy ref: docs/strategy/entry-models.md §Inversion.
// ============================================================================

export function evaluateInversionComponents(bundle, ctx, tf) {
  const eng = bundle?.gates?.engine ?? {};
  const tfEng = bundle?.engine_by_tf?.[tf] ?? {};
  const side = ctx.side;
  const isLong = side === 'long';

  // 1. context_draw — same as MSS/Trend.
  const htfDir = ctx.htf_destination?.dir;
  const aligned = (isLong && htfDir === 'above') || (!isLong && htfDir === 'below');
  const context_draw = {
    present: aligned,
    cite: ctx.htf_destination?.cite ?? null,
    value: ctx.htf_destination ?? null,
    ...(aligned ? {} : { missing_reason: `htf_destination dir=${htfDir}, side=${side} not aligned` }),
  };

  // 2. inverted_pd_array — fresh ifvg in correct direction in the TF's FVG list.
  const tfFvgs = tfEng.fvgs ?? [];
  const ifvg = tfFvgs.find((f) => f.kind === 'ifvg' && f.state === 'fresh' && f.dir === (isLong ? 'bull' : 'bear'));
  const inverted_pd_array = {
    present: !!ifvg,
    cite: ifvg ? `engine_by_tf.${tf}.fvgs[${tfFvgs.indexOf(ifvg)}]` : null,
    value: ifvg ? disambiguateFvg(ifvg) : null,
    ...(ifvg ? {} : { missing_reason: `no fresh ifvg with dir=${isLong ? 'bull' : 'bear'} at TF ${tf}` }),
  };

  // 3. tap_into_ifvg — currently inside an ifvg of correct dir.
  const insideFvgs = eng.price_context?.inside_fvgs ?? [];
  const insideIfvg = insideFvgs.find((f) => f.kind === 'ifvg' && f.dir === (isLong ? 'bull' : 'bear'));
  const tap_into_ifvg = {
    present: !!insideIfvg,
    cite: insideIfvg ? `gates.engine.price_context.inside_fvgs[${insideFvgs.indexOf(insideIfvg)}]` : null,
    value: insideIfvg ? disambiguateFvg(insideIfvg) : null,
    ...(insideIfvg ? {} : { missing_reason: `price not currently inside an inverted FVG of dir=${isLong ? 'bull' : 'bear'}` }),
  };

  // 4. confirmation — same as MSS/Trend.
  const lb = eng.confirmation?.last_bar ?? {};
  const lbEmpty = lb.direction == null && lb.body_ratio == null;
  const confirmedDir = (isLong && lb.direction === 'bullish') || (!isLong && lb.direction === 'bearish');
  const bodyOk = (lb.body_ratio ?? 0) >= MIN_CONFIRMATION_BODY_RATIO;
  const confirmation = {
    present: confirmedDir && bodyOk,
    cite: 'gates.engine.confirmation.last_bar',
    value: lb,
    ...(confirmedDir && bodyOk ? {} : {
      missing_reason: lbEmpty
        ? 'no last_bar emitted yet (engine has not closed a bar this TF)'
        : !bodyOk
          ? `body_ratio ${lb.body_ratio} below ${MIN_CONFIRMATION_BODY_RATIO}`
          : `direction ${lb.direction} not matching side ${side}`,
    }),
  };

  // 5. displacement_quality — same as MSS/Trend.
  const sizeQ = eng.pillar3?.fvg_summary?.size_quality;
  const dispQ = eng.pillar2?.current_tf?.displacement;
  const sizeOk = !!sizeQ && sizeQ !== 'weak';
  const dispOk = dispQ === 'clean' || dispQ === 'acceptable';
  const displacement_quality = {
    present: sizeOk && dispOk,
    cite: 'gates.engine.pillar3.fvg_summary.size_quality + gates.engine.pillar2.current_tf.displacement',
    value: { size_quality: sizeQ, displacement: dispQ },
    ...(sizeOk && dispOk ? {} : {
      missing_reason: !sizeOk
        ? (sizeQ == null ? 'size_quality missing in pillar3.fvg_summary' : `size_quality=${sizeQ} is weak`)
        : (dispQ == null ? 'displacement missing in pillar2.current_tf' : `displacement=${dispQ} not in {clean, acceptable}`),
    }),
  };

  return { context_draw, inverted_pd_array, tap_into_ifvg, confirmation, displacement_quality };
}

// ============================================================================
// Tradable rule + grade logic.
// Strategy ref: docs/strategy/trading-strategy-2026.md §7 step 7.
// ============================================================================

const GRADE_RANK = { 'no-trade': 0, B: 1, 'A+': 2 };
const RANK_GRADE = { 0: 'no-trade', 1: 'B', 2: 'A+' };
const gradeRank = (g) => GRADE_RANK[g] ?? 0;

// A+ when all components present AND pillar2.displacement is "clean"
// B   when all components present AND displacement is "acceptable"
// no-trade when any component is missing.
export function computeGradeProposed(components, { displacement }) {
  const allPresent = Object.values(components).every((c) => c.present === true);
  if (!allPresent) return 'no-trade';
  if (displacement === 'clean') return 'A+';
  if (displacement === 'acceptable') return 'B';
  return 'no-trade';
}

// Cap proposed grade by grade_cap from ltf-bias-context + strategy modifiers.
export function computeGradeCapped(proposed, {
  grade_cap = 'A+',
  htf_ltf_alignment,
  model,
  is_retrace_day,
  pillar2_range_quality,
} = {}) {
  let capped = RANK_GRADE[Math.min(gradeRank(proposed), gradeRank(grade_cap))];
  // Divergent + non-MSS = no-trade (matches strategy: divergent = retrace day = MSS only).
  if (htf_ltf_alignment === 'divergent' && model !== 'MSS') capped = 'no-trade';
  // Retrace day + poor pillar2 = cap at B.
  if (is_retrace_day && pillar2_range_quality === 'poor' && gradeRank(capped) > gradeRank('B')) capped = 'B';
  return capped;
}

export function isTradable({ components, grade_proposed, grade_capped, stop_options, tp1, tp2 }) {
  const allPresent = Object.values(components).every((c) => c.present === true);
  if (!allPresent) return false;
  if (grade_proposed === 'no-trade') return false;
  if (grade_capped === 'no-trade') return false;
  if (!Array.isArray(stop_options) || stop_options.length === 0) return false;
  if (!tp1?.value || !tp2?.value) return false;
  return true;
}

// ============================================================================
// TP picker + entry helper.
// ============================================================================

// Picks the (rank+1)-th nearest untaken target in the trade's direction.
// rank=0 → nearest (tp1). rank=1 → next-nearest (tp2).
export function pickTpFromUntakenTargets(untaken, { side, entry, rank }) {
  const pool = side === 'long' ? untaken?.untaken_above ?? [] : untaken?.untaken_below ?? [];
  if (pool.length === 0) return null;
  // Filter and sort by absolute distance from entry; correct side already enforced.
  const sorted = [...pool]
    .filter((t) => side === 'long' ? t.price > entry : t.price < entry)
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
  if (rank >= sorted.length) return null;
  const picked = sorted[rank];
  return { value: picked.price, cite: picked.cite };
}

// Derives entry price + cite based on entry kind (FVG / BPR) and side.
// Long entries at the upper edge (top); short entries at the lower edge (bottom).
export function deriveEntry({ kind, fvg, bpr, side, tf, fvgIdx, bprIdx }) {
  if (kind === 'fvg') {
    const value = side === 'long' ? fvg.top : fvg.bottom;
    const path = side === 'long' ? 'top' : 'bottom';
    return { value, cite: `engine_by_tf.${tf}.fvgs[${fvgIdx}].${path}` };
  }
  if (kind === 'bpr') {
    const value = side === 'long' ? bpr.top : bpr.bottom;
    const path = side === 'long' ? 'top' : 'bottom';
    return { value, cite: `engine_by_tf.${tf}.bprs[${bprIdx}].${path}` };
  }
  return null;
}

// ============================================================================
// Orchestrator — detectSetups, candidate builders, conflict resolution.
// ============================================================================

export function detectSetups({ bundle, leader, ltf_bias_context, untaken_targets }) {
  const meta = {
    detector_version: '1.0',
    leader,
    timestamp_ms: Date.now(),
    bar_close_ms: bundle?.quote?.time ? bundle.quote.time * 1000 : null,
  };

  // Early returns: leader undefined, engine stale, missing brief digest.
  if (!leader) return waitState({ reason: 'Awaiting leader decision in open_reaction', meta });
  if (bundle?.gates?.engine?.meta?.stale === true) {
    const age = bundle.gates.engine.meta.emit_age_seconds;
    return waitState({ reason: `Engine stale (age ${age}s). Awaiting fresh data.`, meta });
  }
  if (!bundle?.brief_digest?.symbols) {
    return waitState({ reason: 'Awaiting brief. Run brief phase first.', meta });
  }

  const symKey = Object.keys(bundle.brief_digest.symbols).find((k) => k.toLowerCase().includes(leader)) ?? Object.keys(bundle.brief_digest.symbols)[0];
  const briefSym = bundle.brief_digest.symbols[symKey] ?? {};
  const htf_destination = briefSym.pillar1?.htf_destination;
  const primary_draw = briefSym.pillar1?.primary_draw;

  // Determine side(s) to evaluate based on ltf_bias_context + htf_destination.
  const candidates = [];
  for (const side of resolveSidesToEvaluate({ htf_destination, ltf_bias_context })) {
    const ctx = { side, htf_destination, primary_draw, ltf_bias_context };
    candidates.push(buildMssCandidate(bundle, ctx, 'm5', untaken_targets));
    candidates.push(buildTrendCandidate(bundle, ctx, 'm5', untaken_targets));
    candidates.push(buildInversionCandidate(bundle, ctx, 'm5', untaken_targets));
  }

  const tradables = candidates.filter((c) => c?.tradable === true);
  const nonTradables = candidates.filter((c) => c && !c.tradable);

  if (tradables.length === 0) {
    return {
      best_candidate: null,
      rejections: nonTradables.map((c) => ({ model: c.model, side: c.side, reason: firstMissingReason(c.components) || c.grade_capped })),
      rejection_summary: buildRejectionSummary(
        nonTradables.map((c) => ({ model: c.model, side: c.side, reason: firstMissingReason(c.components) })),
        { side: nonTradables[0]?.side, ...untaken_targets }
      ),
      meta,
    };
  }

  const { best_candidate, rejections } = pickBestCandidate(tradables, ltf_bias_context);
  // Add non-tradable models to rejections for full visibility.
  const allRejections = [
    ...rejections,
    ...nonTradables.map((c) => ({ model: c.model, side: c.side, reason: firstMissingReason(c.components) || `grade ${c.grade_capped}` })),
  ];
  return {
    best_candidate,
    rejections: allRejections,
    rejection_summary: null,
    meta,
  };
}

function waitState({ reason, meta }) {
  return { best_candidate: null, rejections: [], rejection_summary: reason, meta };
}

function resolveSidesToEvaluate({ htf_destination, ltf_bias_context }) {
  if (htf_destination?.dir === 'above') return ['long'];
  if (htf_destination?.dir === 'below') return ['short'];
  return ['long', 'short'];
}

function firstMissingReason(components) {
  if (!components) return null;
  const missing = Object.values(components).find((c) => !c?.present);
  return missing?.missing_reason ?? null;
}

function buildPivots(bundle) {
  const swingTier = bundle?.gates?.engine?.pillar3?.structures_by_tier?.swing ?? [];
  const internalTier = bundle?.gates?.engine?.pillar3?.structures_by_tier?.internal ?? [];
  return [
    ...swingTier.map((s, idx) => ({ price: s.level, tier: 'swing', is_high: s.is_high, cite: `gates.engine.pillar3.structures_by_tier.swing[${idx}].level` })),
    ...internalTier.map((s, idx) => ({ price: s.level, tier: 'internal', is_high: s.is_high, cite: `gates.engine.pillar3.structures_by_tier.internal[${idx}].level` })),
  ];
}

function buildMssCandidate(bundle, ctx, tf, untaken_targets) {
  const components = evaluateMssComponents(bundle, ctx, tf);
  const { side } = ctx;
  const insideFvgs = bundle?.gates?.engine?.price_context?.inside_fvgs ?? [];
  const tfFvgs = bundle?.engine_by_tf?.[tf]?.fvgs ?? [];
  const fvg = insideFvgs.find((f) => f.dir === (side === 'long' ? 'bull' : 'bear') && f.state === 'fresh');
  const fvgIdx = fvg ? tfFvgs.findIndex((f) => f.top === fvg.top && f.bottom === fvg.bottom) : -1;

  const bars = bundle?.bars_by_tf?.[tf]?.last_5_bars ?? [];
  const pivots = buildPivots(bundle);
  const entry = fvg
    ? deriveEntry({ kind: 'fvg', fvg, side, tf, fvgIdx })
    : { value: bundle?.quote?.last, cite: 'quote.last' };
  const stop_options = fvg
    ? stopOptionsForFvgEntry({ fvg, side, barsAtTf: bars, tf, tfMs: TF_MS[tf], fvgIdx, pivots, entry: entry.value })
    : stopOptionsForStructureEntry({ side, pivots, entry: entry.value });

  const tp1 = pickTpFromUntakenTargets(untaken_targets, { side, entry: entry.value, rank: 0 });
  const tp2 = pickTpFromUntakenTargets(untaken_targets, { side, entry: entry.value, rank: 1 });

  const grade_proposed = computeGradeProposed(components, { displacement: bundle?.gates?.engine?.pillar2?.current_tf?.displacement });
  const grade_capped = computeGradeCapped(grade_proposed, {
    grade_cap: ctx.ltf_bias_context?.grade_cap,
    htf_ltf_alignment: ctx.ltf_bias_context?.htf_ltf_alignment,
    model: 'MSS',
    is_retrace_day: ctx.ltf_bias_context?.is_retrace_day,
    pillar2_range_quality: bundle?.gates?.engine?.pillar2?.current_tf?.range_quality,
  });
  const tradable = isTradable({ components, grade_proposed, grade_capped, stop_options, tp1, tp2 });

  return {
    model: 'MSS',
    side,
    entry,
    stop: stop_options[0] ? { value: stop_options[0].value, cite: stop_options[0].cite, kind: stop_options[0].kind } : null,
    stop_options,
    tp1, tp2,
    grade_proposed, grade_capped,
    components,
    rationale: buildRationale('MSS', side, components),
    tradable,
  };
}

function buildTrendCandidate(bundle, ctx, tf, untaken_targets) {
  const components = evaluateTrendComponents(bundle, ctx, tf);
  const { side } = ctx;
  const insideFvgs = bundle?.gates?.engine?.price_context?.inside_fvgs ?? [];
  const tfFvgs = bundle?.engine_by_tf?.[tf]?.fvgs ?? [];
  const fvg = insideFvgs.find((f) => f.dir === (side === 'long' ? 'bull' : 'bear') && f.state !== 'taken');
  const fvgIdx = fvg ? tfFvgs.findIndex((f) => f.top === fvg.top && f.bottom === fvg.bottom) : -1;

  const bars = bundle?.bars_by_tf?.[tf]?.last_5_bars ?? [];
  const pivots = buildPivots(bundle);
  const entry = fvg
    ? deriveEntry({ kind: 'fvg', fvg, side, tf, fvgIdx })
    : { value: bundle?.quote?.last, cite: 'quote.last' };
  const stop_options = fvg
    ? stopOptionsForFvgEntry({ fvg, side, barsAtTf: bars, tf, tfMs: TF_MS[tf], fvgIdx, pivots, entry: entry.value })
    : stopOptionsForStructureEntry({ side, pivots, entry: entry.value });

  const tp1 = pickTpFromUntakenTargets(untaken_targets, { side, entry: entry.value, rank: 0 });
  const tp2 = pickTpFromUntakenTargets(untaken_targets, { side, entry: entry.value, rank: 1 });
  const grade_proposed = computeGradeProposed(components, { displacement: bundle?.gates?.engine?.pillar2?.current_tf?.displacement });
  const grade_capped = computeGradeCapped(grade_proposed, {
    grade_cap: ctx.ltf_bias_context?.grade_cap,
    htf_ltf_alignment: ctx.ltf_bias_context?.htf_ltf_alignment,
    model: 'Trend',
    is_retrace_day: ctx.ltf_bias_context?.is_retrace_day,
    pillar2_range_quality: bundle?.gates?.engine?.pillar2?.current_tf?.range_quality,
  });
  const tradable = isTradable({ components, grade_proposed, grade_capped, stop_options, tp1, tp2 });

  return {
    model: 'Trend',
    side,
    entry,
    stop: stop_options[0] ? { value: stop_options[0].value, cite: stop_options[0].cite, kind: stop_options[0].kind } : null,
    stop_options,
    tp1, tp2,
    grade_proposed, grade_capped,
    components,
    rationale: buildRationale('Trend', side, components),
    tradable,
  };
}

function buildInversionCandidate(bundle, ctx, tf, untaken_targets) {
  const components = evaluateInversionComponents(bundle, ctx, tf);
  const { side } = ctx;
  const tfFvgs = bundle?.engine_by_tf?.[tf]?.fvgs ?? [];
  const ifvg = tfFvgs.find((f) => f.kind === 'ifvg' && f.state === 'fresh' && f.dir === (side === 'long' ? 'bull' : 'bear'));
  const fvgIdx = ifvg ? tfFvgs.indexOf(ifvg) : -1;

  const bars = bundle?.bars_by_tf?.[tf]?.last_5_bars ?? [];
  const pivots = buildPivots(bundle);
  const entry = ifvg
    ? deriveEntry({ kind: 'fvg', fvg: ifvg, side, tf, fvgIdx })
    : { value: bundle?.quote?.last, cite: 'quote.last' };
  const stop_options = ifvg
    ? stopOptionsForInversionEntry({ fvg: ifvg, side, barsAtTf: bars, tf, tfMs: TF_MS[tf], fvgIdx, pivots, entry: entry.value })
    : stopOptionsForStructureEntry({ side, pivots, entry: entry.value });

  const tp1 = pickTpFromUntakenTargets(untaken_targets, { side, entry: entry.value, rank: 0 });
  const tp2 = pickTpFromUntakenTargets(untaken_targets, { side, entry: entry.value, rank: 1 });
  const grade_proposed = computeGradeProposed(components, { displacement: bundle?.gates?.engine?.pillar2?.current_tf?.displacement });
  const grade_capped = computeGradeCapped(grade_proposed, {
    grade_cap: ctx.ltf_bias_context?.grade_cap,
    htf_ltf_alignment: ctx.ltf_bias_context?.htf_ltf_alignment,
    model: 'Inversion',
    is_retrace_day: ctx.ltf_bias_context?.is_retrace_day,
    pillar2_range_quality: bundle?.gates?.engine?.pillar2?.current_tf?.range_quality,
  });
  const tradable = isTradable({ components, grade_proposed, grade_capped, stop_options, tp1, tp2 });

  return {
    model: 'Inversion',
    side,
    entry,
    stop: stop_options[0] ? { value: stop_options[0].value, cite: stop_options[0].cite, kind: stop_options[0].kind } : null,
    stop_options,
    tp1, tp2,
    grade_proposed, grade_capped,
    components,
    rationale: buildRationale('Inversion', side, components),
    tradable,
  };
}

function buildRationale(model, side, components) {
  const present = Object.entries(components).filter(([, v]) => v?.present).map(([k]) => k);
  return `${model}-${side === 'long' ? 'bull' : 'bear'}: ${present.join(', ')} all present.`;
}

export function pickBestCandidate(candidates, ltf_bias_context) {
  if (candidates.length === 0) return { best_candidate: null, rejections: [] };
  if (candidates.length === 1) return { best_candidate: candidates[0], rejections: [] };

  // Use entry_model_priority resolver. Priority order: MSS > Trend > Inversion default;
  // can be overridden by ltf_bias_context.entry_model_priority (e.g., "mss", "trend").
  const preferred = (ltf_bias_context?.entry_model_priority ?? 'mss').toLowerCase();
  const order = preferred === 'trend'     ? ['Trend', 'MSS', 'Inversion']
              : preferred === 'inversion' ? ['Inversion', 'MSS', 'Trend']
              :                              ['MSS', 'Trend', 'Inversion'];
  const sorted = [...candidates].sort((a, b) => {
    const ai = order.indexOf(a.model), bi = order.indexOf(b.model);
    if (ai !== bi) return ai - bi;
    // Tiebreak: higher grade_proposed wins.
    return gradeRank(b.grade_proposed) - gradeRank(a.grade_proposed);
  });
  return {
    best_candidate: sorted[0],
    rejections: sorted.slice(1).map((c) => ({ model: c.model, side: c.side, reason: `lower priority than ${sorted[0].model}` })),
  };
}

export function buildRejectionSummary(rejections, { side, untaken_above, untaken_below }) {
  if (!rejections || rejections.length === 0) return 'No tradable setup. Awaiting fresh signals.';
  const reasonsList = rejections.map((r) => `${r.model}: ${r.reason}`).join('; ');
  const watch = side === 'long' && untaken_above?.length
    ? ` Watching: untaken target ${untaken_above[0].price} above.`
    : side === 'short' && untaken_below?.length
      ? ` Watching: untaken target ${untaken_below[0].price} below.`
      : '';
  return `No tradable setup. ${reasonsList}.${watch}`;
}
