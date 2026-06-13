import { sizeFor, dayOfWeek } from '../../../../cli/lib/sizing.js';

const TICK_SIZE = 0.25;

function roundTick(value) {
  return Math.round(value / TICK_SIZE) * TICK_SIZE;
}

function numberOrNull(value) {
  if (value == null || value === '') return null; // Number(null) is 0 — not a price
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function refOf(item, fallback = null) {
  if (typeof item?.evidenceRef === 'string' && item.evidenceRef.trim()) return item.evidenceRef;
  if (typeof item?.cite === 'string' && item.cite.trim()) return item.cite;
  if (typeof item?.id === 'string' && item.id.trim()) return item.id;
  return fallback;
}

// §6 / §7 Step 7: "Take profits first at intraday liquidity (internal
// swings, session highs/lows), second at or toward the HTF draw." The pool
// merges the brief's untaken levels with intraday pivots from the bridge's
// structural pool — swing highs + the running leg high for longs (mirror
// for shorts). Before 2026-06-12 only session LEVELS were in the pool: the
// first live setup got the weekly high as TP1 at 9.2R.
const INTRADAY_TARGET_KINDS = {
  long: new Set(['swing_high']),
  short: new Set(['swing_low']),
};

function targetPool(context, side) {
  const targets = context?.pillar1?.untakenTargets ?? {};
  const levels = (side === 'long' ? (targets.above ?? []) : (targets.below ?? []))
    .map((t) => ({ ...t, target_class: 'level' }));
  const kinds = INTRADAY_TARGET_KINDS[side] ?? new Set();
  // UNSWEPT swings only — a swept swing holds no resting liquidity and is
  // not a target (user ruling 2026-06-12; same rule the untaken-levels
  // injection already enforces for session levels). Leg extremes carry no
  // swept flag, so they stay out of the target pool entirely.
  const pivots = (context?.pillar3?.structuralStops ?? context?.pillar3?.structural_stops ?? [])
    .filter((s) => kinds.has(String(s?.kind ?? '')) && s?.swept !== true)
    .map((s) => ({ ...s, name: s.name ?? s.kind, target_class: 'intraday' }));
  return [...levels, ...pivots];
}

// No new entries after the late-session cutoff (user ruling 2026-06-13): a
// trade confirmed too close to the 16:00 ET forced close has no runway to
// reach its target before it. The last 1m candle that may confirm a NEW
// entry is the 15:30 ET candle (which closes at 15:31); confirmations whose
// bar closes at 15:32 ET or later are blocked. Wall-clock (the 16:00 close is
// session-agnostic); inert for AM trades, which confirm before noon.
const ENTRY_CUTOFF_ET_MIN = 15 * 60 + 32; // 15:32 ET (15:31-candle close onward)
function etMinutesOfUtc(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return hh * 60 + mm;
}

function normalizeModelName(model) {
  const value = String(model ?? '').trim().toLowerCase();
  if (value === 'mss') return 'mss';
  if (value === 'trend') return 'trend';
  if (value === 'inversion') return 'inversion';
  if (value === 'undecided' || value === 'unknown' || value === 'none') return value;
  return value;
}

function capGrade(grade, cap) {
  const rank = { 'no-trade': 0, B: 1, 'A+': 2 };
  const normalizedCap = cap === 'A+' || cap === 'B' || cap === 'no-trade' ? cap : 'A+';
  if ((rank[grade] ?? 0) <= (rank[normalizedCap] ?? 2)) return grade;
  return normalizedCap;
}

function targetIsCorrectSide(target, entry, side) {
  return side === 'long' ? target.price > entry : target.price < entry;
}

function computeRMultiple({ entry, stop, target }) {
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk <= 0) return null;
  return Number((Math.abs(target - entry) / risk).toFixed(2));
}

function stopCandidatesWithAudit(context, side, entry) {
  const stops = context?.pillar3?.structuralStops ?? context?.pillar3?.structural_stops ?? [];
  const valid = [];
  const rejected = [];
  for (const stop of stops) {
    const price = numberOrNull(stop?.price ?? stop?.level);
    const normalized = { ...stop, price };
    const evidenceRef = refOf(stop);
    // Session-level candidates exist for the Inversion structural-stop rule
    // only — in the generic nearest-stop pool they would silently change
    // MSS/Trend stop selection.
    if (String(stop?.kind ?? '').startsWith('session_level_')) {
      rejected.push({ evidenceRef, reason: 'session_level_not_generic_stop', price, rawPayload: stop });
      continue;
    }
    if (price == null) {
      rejected.push({ evidenceRef, reason: 'invalid_price', rawPayload: stop });
      continue;
    }
    const correctSide = side === 'long' ? price < entry : price > entry;
    if (!correctSide) {
      rejected.push({ evidenceRef, reason: 'wrong_side_of_entry', price, rawPayload: stop });
      continue;
    }
    valid.push(normalized);
  }
  const selected = side === 'long'
    ? valid.sort((a, b) => b.price - a.price)[0] ?? null
    : valid.sort((a, b) => a.price - b.price)[0] ?? null;
  return { selected, rejected };
}

function selectStructuralStop(context, side, entry) {
  return stopCandidatesWithAudit(context, side, entry).selected;
}

// Inversion stops are model-specific. Precedence per the user's hand-grade
// 2026-06-13 (June 9, all three shorts: 29847 / 29714.25 / 29526.25):
//   0. The FAILED LEG's extreme — the high (short) / low (long) of the move
//      that created the violated zone, read as the extreme of the visible
//      1m bars at packet time. §6 structural invalidation: reclaiming that
//      swing unwinds the inversion itself.
//   1. The violating candle's extreme — entry-models.md Inversion §5:
//      "below the candle that closed through it" (above, for shorts).
//   2. The structural swing beyond the violated zone — trading-strategy-
//      2026.md §6. Pivots BETWEEN entry and the zone are noise (June 9: a
//      2.75-point micro-pivot).
//   3. The zone edge itself — entry-models.md Inversion §5: "below the
//      inversion FVG low" (mirrored for shorts).
// Trend stops are model-specific — entry-models.md Trend §6: "Stop: Below
// the swing low that touches the FVG or below the FVG low itself" (mirrored
// for shorts). The tap candle IS the swing that touches; the generic pivot
// pool would reach past it to an older, wider swing (June 9 trade 7: 29046
// vs the 28971.75 tap wick).
function trendStructuralStop(walker, side, entry) {
  if (normalizeModelName(walker?.model) !== 'trend') return null;
  const correctSide = (price) => (side === 'long' ? price < entry : price > entry);

  const bar = walker?.evidence?.confirmation?.rawPayload?.last_bar
    ?? walker?.evidence?.tap?.rawPayload?.last_bar ?? {};
  const tapExtreme = side === 'short' ? numberOrNull(bar.high) : numberOrNull(bar.low);
  if (tapExtreme != null && correctSide(tapExtreme)) {
    return { kind: 'trend_tap_candle', price: tapExtreme, evidenceRef: 'gates.engine.confirmation.last_bar' };
  }

  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const edge = side === 'short' ? numberOrNull(pd.top) : numberOrNull(pd.bottom);
  if (edge != null && correctSide(edge)) {
    return { kind: 'trend_zone_edge', price: edge, evidenceRef: refOf(walker?.evidence?.pdArray, 'walker.pdArray') };
  }
  return null;
}

// MSS stops — entry-models.md MSS §6: "Stop: Below the MSS low or below the
// FVG low (structural invalidation)"; A+ example: "a few ticks below the
// MSS low." Precedence:
//   1. An explicit MSS pivot in the pool (kind mss_swing_low/high).
//   2. The structural swing beyond the reversal FVG — the displacement leg
//      launched from the grab extreme, so the first pivot past the zone IS
//      the MSS low/high. Pivots BETWEEN entry and the zone are noise
//      (June 11 10:18: a 1.5-pt micro-pivot stop).
//   3. The zone edge itself (the FVG low/high).
function mssStructuralStop(walker, side, entry, context) {
  if (normalizeModelName(walker?.model) !== 'mss') return null;
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const zoneTop = numberOrNull(pd.top);
  const zoneBottom = numberOrNull(pd.bottom);
  const correctSide = (price) => (side === 'long' ? price < entry : price > entry);
  const pool = (context?.pillar3?.structuralStops ?? context?.pillar3?.structural_stops ?? [])
    .map((s) => ({ ...s, price: numberOrNull(s?.price ?? s?.level) }))
    .filter((s) => s.price != null && correctSide(s.price));

  const explicit = pool.find((s) => String(s.kind ?? '') === (side === 'long' ? 'mss_swing_low' : 'mss_swing_high'));
  if (explicit) {
    return { kind: 'mss_structural_swing', price: explicit.price, evidenceRef: refOf(explicit) };
  }

  const beyondZone = pool
    .filter((s) => (side === 'long'
      ? String(s.kind ?? '').endsWith('_low') && zoneBottom != null && s.price < zoneBottom
      : String(s.kind ?? '').endsWith('_high') && zoneTop != null && s.price > zoneTop))
    .sort((a, b) => (side === 'long' ? b.price - a.price : a.price - b.price))[0] ?? null;
  if (beyondZone) {
    return { kind: 'mss_structural_swing', price: beyondZone.price, evidenceRef: refOf(beyondZone) };
  }

  const edge = side === 'long' ? zoneBottom : zoneTop;
  if (edge != null && correctSide(edge)) {
    return { kind: 'mss_zone_edge', price: edge, evidenceRef: refOf(walker?.evidence?.pdArray, 'walker.pdArray') };
  }
  return null;
}

function inversionStructuralStop(walker, side, entry, context) {
  if (normalizeModelName(walker?.model) !== 'inversion') return null;
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const zoneTop = numberOrNull(pd.top);
  const zoneBottom = numberOrNull(pd.bottom);
  const correctSide = (price) => (side === 'long' ? price < entry : price > entry);

  // 0. The FAILED LEG's extreme — the swing the violated zone hangs from.
  // User hand-grade 2026-06-13 (June 9, all three Inversion shorts): stops
  // 29847 / 29714.25 / 29526.25 are the highs of the legs that created the
  // violated FVGs = the max high of the visible 1m bars at packet time.
  // §6 structural invalidation: reclaiming that extreme unwinds the
  // inversion itself; the violating candle's own high is inside the leg.
  const legBars = context?.pillar3?.ohlcv1m ?? [];
  const legExtreme = legBars.reduce((acc, b) => {
    const px = side === 'short' ? numberOrNull(b?.high) : numberOrNull(b?.low);
    if (px == null) return acc;
    if (acc == null) return px;
    return side === 'short' ? Math.max(acc, px) : Math.min(acc, px);
  }, null);
  if (legExtreme != null && correctSide(legExtreme)) {
    return { kind: 'inversion_failed_leg_extreme', price: legExtreme, evidenceRef: 'bars.last_5_bars[extreme]' };
  }

  const candle = walker?.evidence?.confirmation?.rawPayload?.last_bar ?? {};
  const candleExtreme = side === 'short' ? numberOrNull(candle.high) : numberOrNull(candle.low);
  if (candleExtreme != null && correctSide(candleExtreme)) {
    return { kind: 'inversion_violating_candle', price: candleExtreme, evidenceRef: 'gates.engine.confirmation.last_bar' };
  }

  const beyondZone = (context?.pillar3?.structuralStops ?? context?.pillar3?.structural_stops ?? [])
    .map((s) => ({ ...s, price: numberOrNull(s?.price ?? s?.level) }))
    .filter((s) => s.price != null && correctSide(s.price) && (side === 'short'
      ? String(s.kind ?? '').endsWith('_high') && zoneTop != null && s.price > zoneTop
      : String(s.kind ?? '').endsWith('_low') && zoneBottom != null && s.price < zoneBottom));
  const structural = side === 'short'
    ? beyondZone.sort((a, b) => a.price - b.price)[0]
    : beyondZone.sort((a, b) => b.price - a.price)[0];
  if (structural) {
    return { kind: 'inversion_structural_swing', price: structural.price, evidenceRef: refOf(structural) };
  }

  const edge = side === 'short' ? zoneTop : zoneBottom;
  if (edge != null && correctSide(edge)) {
    return {
      kind: side === 'short' ? 'inversion_zone_top' : 'inversion_zone_bottom',
      price: edge,
      evidenceRef: refOf(walker?.evidence?.pdArray, walker?.pdArrayRef ?? null),
    };
  }
  return null;
}

function validTargets(context, side, entry, stop) {
  return targetPool(context, side)
    .map((target) => ({ ...target, price: numberOrNull(target?.price ?? target?.level) }))
    .filter((target) => target.price != null && targetIsCorrectSide(target, entry, side))
    .map((target) => ({ ...target, rMultiple: computeRMultiple({ entry, stop, target: target.price }) }))
    .filter((target) => target.rMultiple != null)
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
}

// The WEEKLY draw (PWH/PWL) is the §7 Step 7 TP2/runner — "second toward the
// HTF draw" — never intraday TP1 liquidity. A wide stop deflates every NEAR
// target below the R-floors, leaving the far weekly high as the only level
// clearing 1.5R; selecting it as TP1 sets an unreachable intraday target
// (June 12 AM + June 11 PM 13:30: PWH ~1300 pts away, trade open all session).
// Excluded from the TP1 pool so the wide-stop trade flags tp1_below_1_5r
// instead. Matches both live (`name`) and fixture (`label`) shapes.
function isWeeklyDraw(target) {
  return /^PW_?[HL]$/i.test(String(target?.name ?? target?.label ?? ''));
}

// TP1 class priority (§6 + user ruling 2026-06-12): the nearest UNSWEPT
// internal swing is the default TP1 — but only when it pays at least 2R.
// Otherwise the nearest session level clearing the 1.5R floor takes it.
// When nothing qualifies, return the nearest candidate so the packet
// still reports tp1_below_1_5r (rather than missing_side_consistent_tp1).
function selectTp1(context, side, entry, stop) {
  const all = validTargets(context, side, entry, stop);
  // §7 Step 7: TP1 = nearest INTRADAY liquidity; the weekly draw is the
  // runner. Falls back to the full pool only if there is no other target.
  const intraday = all.filter((t) => !isWeeklyDraw(t));
  const candidates = intraday.length ? intraday : all;
  const swing = candidates.find((t) => t.target_class === 'intraday' && t.rMultiple >= 2.0);
  if (swing) return swing;
  const level = candidates.find((t) => t.target_class === 'level' && t.rMultiple >= 1.5);
  if (level) return level;
  return candidates[0] ?? null;
}

// TP2 = the next target beyond TP1 toward the HTF draw (§6: "second at or
// toward the HTF draw") — session levels preferred over further pivots.
function selectTp2(context, side, entry, stop, tp1Price) {
  if (tp1Price == null) return null;
  const beyond = validTargets(context, side, entry, stop)
    .filter((t) => Math.abs(t.price - entry) > Math.abs(tp1Price - entry));
  return beyond.find((t) => t.target_class === 'level') ?? beyond[0] ?? null;
}

// Grade per constraint #9 / trading-strategy-2026.md §7 step 7 — A+ only
// when ALL six elements align: HTF bias + draw (pillar1 pass), overnight
// context (inside pillar1), NY reaction confirming the read (ltf-bias
// handoff present AND htf_ltf_alignment aligned), price quality good
// (pillar2 pass), entry model identified, confirmation confirmed. The last
// two are structural givens at packet time — only confirmed walkers with a
// known model reach here — so the live differentiators are the pillars and
// the open-reaction handoff. Zone size_quality is deliberately NOT a
// grading element: the 2026-06-09 hand-graded A+ Inversion rode a medium
// zone (GXNQ ruling 2026-06-12); the strategy grades alignment, not zone
// size.
function deriveGrade({ context, walker }) {
  const chain = context?.sessionChain ?? {};
  const pillarsPass = context?.pillar1?.status === 'pass' && context?.pillar2?.status === 'pass';
  if (!pillarsPass) return capGrade('no-trade', chain.gradeCap);
  const modelKnown = ['mss', 'trend', 'inversion'].includes(normalizeModelName(walker?.model));
  // A+ requires the packet to BE the aligned trade: bias present, HTF/LTF
  // aligned, and the side in the bias direction (§2.4 / constraint #9).
  const sideAligned =
    (walker?.side === 'long' && chain.ltfBias === 'bullish') ||
    (walker?.side === 'short' && chain.ltfBias === 'bearish');
  const reactionConfirmed = Boolean(chain.ltfBias) && chain.htfLtfAlignment === 'aligned' && sideAligned;
  // Constraint #9: A+ needs price quality GOOD at confirmation time. The
  // engine's displacement enum draws the line at weak — clean/acceptable
  // keep A+; weak/na is the one-weaker-element → B (June 9 'acceptable'
  // hand-graded A+; June 10 'weak' was the documented tradable-B day).
  const qualityOk = ['clean', 'acceptable'].includes(context?.pillar2?.displacement);
  return capGrade(modelKnown && reactionConfirmed && qualityOk ? 'A+' : 'B', chain.gradeCap);
}

function packetEntryAudit(confirmationPayload, confirmation) {
  return {
    evidenceRef: refOf(confirmation),
    timestampMs: confirmationPayload?.confirm_ms ?? confirmationPayload?.timestampMs ?? null,
    open: confirmationPayload?.open ?? null,
    high: confirmationPayload?.high ?? null,
    low: confirmationPayload?.low ?? null,
    close: confirmationPayload?.close ?? confirmationPayload?.price ?? confirmationPayload?.confirm_close_price ?? null,
    rawPayload: confirmationPayload ?? {},
  };
}

function packetStopAudit(stopCandidate, rejectedAlternatives = []) {
  if (!stopCandidate) {
    return { selected: null, rejectedAlternatives };
  }
  return {
    selected: refOf(stopCandidate),
    evidenceRef: refOf(stopCandidate),
    rule: stopCandidate.kind ?? 'structural_stop',
    anchorPrice: stopCandidate.price,
    anchorTimeMs: stopCandidate.timeMs ?? stopCandidate.time_ms ?? null,
    anchorOhlc: stopCandidate.ohlc ?? null,
    rejectedAlternatives,
    rawPayload: stopCandidate,
  };
}

function packetTp1Audit(tp1Candidate) {
  if (!tp1Candidate) return null;
  return {
    evidenceRef: refOf(tp1Candidate),
    label: tp1Candidate.label ?? tp1Candidate.name ?? null,
    targetPrice: tp1Candidate.price,
    rMultiple: tp1Candidate.rMultiple,
    rawPayload: tp1Candidate,
  };
}

export function buildExecutionPacketForWalker({ context, walker } = {}) {
  const blockers = [];
  if (!walker || walker.stage !== 'confirmed') blockers.push('walker_not_confirmed');

  const confirmation = walker?.evidence?.confirmation ?? {};
  const confirmationPayload = confirmation.rawPayload ?? {};
  const entryPrice = numberOrNull(confirmationPayload.close ?? confirmationPayload.price ?? confirmationPayload.confirm_close_price);
  if (entryPrice == null) blockers.push('missing_confirmation_close_price');

  const side = walker?.side;
  const stopAudit = entryPrice == null ? { selected: null, rejected: [] } : stopCandidatesWithAudit(context, side, entryPrice);
  const stopCandidate = (entryPrice == null ? null : (
    inversionStructuralStop(walker, side, entryPrice, context)
    ?? trendStructuralStop(walker, side, entryPrice)
    ?? mssStructuralStop(walker, side, entryPrice, context)
  )) ?? stopAudit.selected;
  if (!stopCandidate) blockers.push('missing_structural_stop');

  const tp1Candidate = entryPrice == null || !stopCandidate ? null : selectTp1(context, side, entryPrice, stopCandidate.price);
  if (!tp1Candidate) blockers.push('missing_side_consistent_tp1');
  if (tp1Candidate && tp1Candidate.rMultiple < 1.5) blockers.push('tp1_below_1_5r');
  const tp2Candidate = tp1Candidate == null || entryPrice == null || !stopCandidate
    ? null
    : selectTp2(context, side, entryPrice, stopCandidate.price, tp1Candidate.price);

  // Late-session cutoff: no NEW entry once the confirming bar closes at 15:32
  // ET or later (user ruling 2026-06-13) — too little runway to the 16:00
  // forced close. Uses the bar being evaluated (eventTimeUtc); inert for AM.
  const entryEtMin = etMinutesOfUtc(context?.eventTimeUtc);
  if (entryEtMin != null && entryEtMin >= ENTRY_CUTOFF_ET_MIN) blockers.push('entry_after_session_cutoff');

  const grade = deriveGrade({ context, walker });
  if (grade === 'no-trade') blockers.push('grade_blocked');

  // entry_model_priority is a SELECTION preference (resolver spec §3.4:
  // "which model to walk first"), applied in deterministic-strategy's
  // packet sort — never a hard gate. §7 Step 5 keeps all three models
  // playable; June 9 replay proved the hard block discards valid setups.
  // The old divergent_day_requires_mss blocker was the same defect: §2.4
  // says divergent days still trade the LTF direction at lower conviction
  // — that's the B cap + side gate below, not a model ban (live 2026-06-12
  // it auto-blocked every Trend continuation on a confirmed-turn rally).
  // §7 Step 5 + §2.3: models are chosen in the bias direction — a packet
  // whose side contradicts a non-null LTF bias is not in the playbook.
  // Null bias (pre-open / unclear) leaves both sides walkable at B cap.
  const ltfBias = context?.sessionChain?.ltfBias;
  if (ltfBias && side &&
      !((side === 'long' && ltfBias === 'bullish') || (side === 'short' && ltfBias === 'bearish'))) {
    blockers.push('side_contradicts_ltf_bias');
  }

  const status = blockers.length === 0 ? 'executable' : 'blocked';
  const packetGrade = status === 'executable' ? grade : 'no-trade';
  // TS §6 / §7 Step 7: size = grade × day-of-week (Mon/Fri reduced). Attached
  // for display only — never feeds the R accounting (refold-safe; the gate
  // checks entry/stop/tp1/outcome/R, none of which this touches).
  const size = sizeFor({ grade: packetGrade, dow: dayOfWeek(new Date(context?.eventTimeUtc ?? Date.now())) });
  const packet = {
    status,
    finalVerdict: status === 'executable' ? 'manual_candidate' : 'no_trade',
    model: walker?.model ?? 'unknown',
    side: side ?? 'unknown',
    grade: packetGrade,
    size,
    blockers: [...new Set(blockers)],
    entry: entryPrice == null ? null : {
      price: roundTick(entryPrice),
      timeMs: confirmationPayload.confirm_ms ?? null,
      evidenceRef: refOf(confirmation, walker?.confirmationRef ?? null),
      rawPayload: confirmationPayload,
    },
    stop: stopCandidate ? {
      price: roundTick(stopCandidate.price),
      kind: stopCandidate.kind ?? 'structural_stop',
      evidenceRef: refOf(stopCandidate),
      rawPayload: stopCandidate,
    } : null,
    tp1: tp1Candidate ? {
      price: roundTick(tp1Candidate.price),
      label: tp1Candidate.label ?? tp1Candidate.name ?? null,
      evidenceRef: refOf(tp1Candidate),
      rMultiple: tp1Candidate.rMultiple,
      rawPayload: tp1Candidate,
    } : null,
    tp2: tp2Candidate ? {
      price: roundTick(tp2Candidate.price),
      label: tp2Candidate.label ?? tp2Candidate.name ?? null,
      evidenceRef: refOf(tp2Candidate),
      rMultiple: tp2Candidate.rMultiple,
      rawPayload: tp2Candidate,
    } : null,
    evidence: {
      pdArray: walker?.evidence?.pdArray ?? null,
      confirmation: confirmation ?? null,
      stop: stopCandidate ?? null,
      tp1: tp1Candidate ?? null,
    },
    evidenceAudit: {
      entry: packetEntryAudit(confirmationPayload, confirmation),
      stop: packetStopAudit(stopCandidate, stopAudit.rejected),
      tp1: packetTp1Audit(tp1Candidate),
      gradeBlockers: blockers.filter((blocker) => blocker === 'grade_blocked' || blocker === 'tp1_below_1_5r'),
    },
  };

  return packet;
}
