import { evaluateSourceHealth, getIctEngineRows, isTradableSourceHealth } from './source-health.js';

const VALID_MARKETS = new Set(['MNQ1!', 'MES1!', 'CME_MINI:MNQ1!', 'CME_MINI:MES1!']);
const VALID_SESSIONS = new Set(['ny-am', 'ny-pm', 'london']);

function normalizeDirection(dir) {
  if (dir === 'bull' || dir === 'bullish' || dir === 'up') return 'bullish';
  if (dir === 'bear' || dir === 'bearish' || dir === 'down') return 'bearish';
  return dir ?? 'unknown';
}

function normalizePdRow(row, index) {
  return {
    ...row,
    index,
    evidenceRef: row.evidenceRef ?? row.ref ?? `gates.engine.rows[${index}]`,
    direction: normalizeDirection(row.dir ?? row.direction),
  };
}

function normalizeEvidenceList(rows = [], baseRef) {
  return rows.map((row, index) => ({
    ...row,
    index,
    evidenceRef: row.evidenceRef ?? row.ref ?? row.cite ?? `${baseRef}[${index}]`,
    direction: normalizeDirection(row.dir ?? row.direction),
  }));
}

function kindOf(row) {
  return String(row?.kind ?? row?.type ?? '').toLowerCase();
}

function buildPillar1(engine, blocked, sessionChain = {}) {
  const p1 = engine?.pillar1 ?? {};
  const lockedP1 = sessionChain?.pillar1 ?? {};
  const blockers = [...blocked];
  const htfBias = p1.htfBias ?? lockedP1.htfBias ?? lockedP1.htf_bias;
  const htfDraw = p1.htfDraw ?? lockedP1.htfDraw ?? lockedP1.htf_draw;
  const primaryDraw = p1.primaryDraw ?? lockedP1.primaryDraw ?? lockedP1.primary_draw;
  if (!htfBias) blockers.push('missing_htf_bias');
  if (!htfDraw) blockers.push('missing_htf_draw');
  if (!primaryDraw) blockers.push('missing_primary_draw');
  return {
    status: blockers.length === 0 && (lockedP1.status == null || lockedP1.status === 'pass') ? 'pass' : 'blocked',
    htfBias: htfBias ?? 'unknown',
    htfDraw: htfDraw ?? null,
    primaryDraw: primaryDraw ?? null,
    untakenTargets: p1.untakenTargets ?? lockedP1.untakenTargets ?? { above: [], below: [] },
    blockers,
  };
}

function buildPillar2(engine, blocked, sessionChain = {}) {
  const p2 = engine?.pillar2 ?? {};
  const lockedP2 = sessionChain?.pillar2 ?? {};
  const current = p2.current_tf ?? {};
  const chop15m = p2.chop_15m === true || p2.chop15m === true || p2.chop_15m === 1 || current.chop_15m === true;
  const blockers = [...blocked];
  if (!current.candle) blockers.push('missing_candle_quality');
  if (!current.displacement) blockers.push('missing_displacement');
  if (chop15m) blockers.push('chop_15m');
  if (['blocked', 'block', 'poor', 'no-trade', 'no_trade'].includes(String(lockedP2.status ?? lockedP2.verdict ?? '').toLowerCase())) {
    blockers.push('pillar2_prep_blocked');
  }
  return {
    status: blockers.length === 0 ? 'pass' : 'blocked',
    candleQuality: current.candle ?? 'unknown',
    displacement: current.displacement ?? 'unknown',
    // Current delivery size (Wilder ATR) — PRICE 10:34 sizes the stop to the
    // current candle/gap ("4H candle trades 20 points → stop 20 points"), which
    // is what scales the inversion wide-leg stop cap dynamically.
    atr14: Number.isFinite(Number(current.atr_14)) ? Number(current.atr_14) : null,
    // §7 Step 3: displacement is a 4H/1H judgment. Carried from the session brief
    // (sessionChain.pillar2.htf_displacement) — the per-bar engine is on the LTF
    // chart, so the HTF displacement can only come from the brief snapshot.
    htfDisplacement: lockedP2.htf_displacement ?? null,
    chop15m,
    prepVerdict: lockedP2.verdict ?? lockedP2.status ?? null,
    blockers,
  };
}

function buildPillar3(engine) {
  const rows = getIctEngineRows(engine).map(normalizePdRow);
  const sweeps = normalizeEvidenceList(engine?.pillar1?.sweeps ?? [], 'gates.engine.pillar1.sweeps');
  const failureSwings = normalizeEvidenceList(engine?.pillar3?.failure_swings ?? engine?.pillar3?.failureSwings ?? [], 'gates.engine.pillar3.failure_swings');
  // Swing-tier market structure (HH/HL/LH/LL + MSS/BoS) — the established-trend
  // evidence the Trend model gates on (EM Trend §1 "a clear MSS ... you are now
  // in the continuation phase"; §3/§4 structure-break invalidation).
  const structuresSwing = normalizeEvidenceList(engine?.pillar3?.structures_by_tier?.swing ?? engine?.pillar3?.structuresSwing ?? [], 'gates.engine.pillar3.structures_by_tier.swing');
  const structuralStops = normalizeEvidenceList(engine?.pillar3?.structural_stops ?? engine?.pillar3?.structuralStops ?? engine?.risk?.structural_stops ?? [], 'gates.engine.pillar3.structural_stops');
  const insideFvgs = normalizeEvidenceList(engine?.price_context?.inside_fvgs ?? [], 'gates.engine.price_context.inside_fvgs');
  const insideBprs = normalizeEvidenceList(engine?.price_context?.inside_bprs ?? [], 'gates.engine.price_context.inside_bprs');
  const confirmationRows = engine?.confirmation ? [{ ...engine.confirmation, evidenceRef: engine.confirmation.evidenceRef ?? 'gates.engine.confirmation' }] : [];
  return {
    pdArrays: rows.filter((row) => ['fvg', 'ifvg', 'bpr'].includes(kindOf(row))),
    fvgs: rows.filter((row) => kindOf(row) === 'fvg'),
    ifvgs: rows.filter((row) => kindOf(row) === 'ifvg'),
    bprs: rows.filter((row) => kindOf(row) === 'bpr'),
    sweeps,
    failureSwings,
    structuresSwing,
    structuralStops,
    insidePdArrays: [...insideFvgs, ...insideBprs],
    confirmationRows,
    ohlcv1m: [],
    ohlcv5m: [],
  };
}

export function buildStrategyContext(bundle = {}) {
  const engine = bundle?.gates?.engine;
  const sourceHealth = evaluateSourceHealth(bundle);
  const blockers = [...sourceHealth.blockers];

  if (!VALID_MARKETS.has(bundle.market)) blockers.push('unknown_market');
  if (!VALID_SESSIONS.has(bundle.session)) blockers.push('unknown_session');

  const effectiveSourceHealth = blockers.length === sourceHealth.blockers.length
    ? sourceHealth
    : { ...sourceHealth, status: 'blocked', blockers: [...new Set(blockers)] };
  const hardBlockers = isTradableSourceHealth(effectiveSourceHealth) ? [] : effectiveSourceHealth.blockers;
  const sessionChain = bundle.sessionChain ?? {};
  const pillar3 = buildPillar3(engine);
  pillar3.ohlcv1m = bundle.ohlcv1m ?? bundle.bars?.m1 ?? [];
  pillar3.ohlcv5m = bundle.ohlcv5m ?? bundle.bars?.m5 ?? [];
  pillar3.full1m = bundle.full1m ?? [];
  // 5m FVG zones — the partner imbalance for the multi-alignment "two-and-one"
  // elevator (entry-models.md: a 5m FVG rebalance lined up with a 1m iFVG in one
  // spot). Read from the per-bar m5 overlay; absent → [] (no elevation, safe).
  pillar3.fvgs5m = bundle.engine_by_tf?.m5?.fvgs ?? [];

  return {
    market: bundle.market ?? 'unknown',
    session: bundle.session ?? 'unknown',
    eventTimeUtc: bundle.eventTimeUtc ?? null,
    eventTimeEt: bundle.eventTimeEt ?? null,
    sourceHealth: effectiveSourceHealth,
    sessionChain,
    pillar1: buildPillar1(engine, hardBlockers, sessionChain),
    pillar2: buildPillar2(engine, hardBlockers, sessionChain),
    pillar3,
    blockers: [...new Set(blockers)],
  };
}
