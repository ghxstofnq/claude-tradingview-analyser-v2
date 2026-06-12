const TICK_SIZE = 0.25;

function roundTick(value) {
  return Math.round(value / TICK_SIZE) * TICK_SIZE;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function refOf(item, fallback = null) {
  if (typeof item?.evidenceRef === 'string' && item.evidenceRef.trim()) return item.evidenceRef;
  if (typeof item?.cite === 'string' && item.cite.trim()) return item.cite;
  if (typeof item?.id === 'string' && item.id.trim()) return item.id;
  return fallback;
}

function targetPool(context, side) {
  const targets = context?.pillar1?.untakenTargets ?? {};
  return side === 'long' ? (targets.above ?? []) : (targets.below ?? []);
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

// Inversion stops are model-specific. Precedence per GXNQ's 2026-06-12
// ruling on the June 9 tape, grounded in the strategy docs:
//   1. The structural swing beyond the violated zone — trading-strategy-
//      2026.md §6: "stops at structural invalidation (low/high of PD array
//      or swing)". Pivots BETWEEN entry and the zone sit inside the violated
//      structure and are noise (June 9: a 2.75-point micro-pivot stop).
//   2. The violating candle's extreme — entry-models.md Inversion §5:
//      "below the candle that closed through it".
//   3. The zone edge itself — entry-models.md Inversion §5: "below the
//      inversion FVG low" (mirrored for shorts).
function inversionStructuralStop(walker, side, entry, context) {
  if (normalizeModelName(walker?.model) !== 'inversion') return null;
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const zoneTop = numberOrNull(pd.top);
  const zoneBottom = numberOrNull(pd.bottom);
  const correctSide = (price) => (side === 'long' ? price < entry : price > entry);

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

  const candle = walker?.evidence?.confirmation?.rawPayload?.last_bar ?? {};
  const candleExtreme = side === 'short' ? numberOrNull(candle.high) : numberOrNull(candle.low);
  if (candleExtreme != null && correctSide(candleExtreme)) {
    return { kind: 'inversion_violating_candle', price: candleExtreme, evidenceRef: 'gates.engine.confirmation.last_bar' };
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

function selectTp1(context, side, entry, stop) {
  const candidates = targetPool(context, side)
    .map((target) => ({ ...target, price: numberOrNull(target?.price ?? target?.level) }))
    .filter((target) => target.price != null && targetIsCorrectSide(target, entry, side))
    .map((target) => ({ ...target, rMultiple: computeRMultiple({ entry, stop, target: target.price }) }))
    .filter((target) => target.rMultiple != null)
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
  return candidates[0] ?? null;
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
  const stopCandidate = (entryPrice == null ? null : inversionStructuralStop(walker, side, entryPrice, context)) ?? stopAudit.selected;
  if (!stopCandidate) blockers.push('missing_structural_stop');

  const tp1Candidate = entryPrice == null || !stopCandidate ? null : selectTp1(context, side, entryPrice, stopCandidate.price);
  if (!tp1Candidate) blockers.push('missing_side_consistent_tp1');
  if (tp1Candidate && tp1Candidate.rMultiple < 1.5) blockers.push('tp1_below_1_5r');

  const grade = deriveGrade({ context, walker });
  if (grade === 'no-trade') blockers.push('grade_blocked');

  // entry_model_priority is a SELECTION preference (resolver spec §3.4:
  // "which model to walk first"), applied in deterministic-strategy's
  // packet sort — never a hard gate. §7 Step 5 keeps all three models
  // playable; June 9 replay proved the hard block discards valid setups.
  const walkerModel = normalizeModelName(walker?.model);
  if (context?.sessionChain?.htfLtfAlignment === 'divergent' && walkerModel && walkerModel !== 'mss') {
    blockers.push('divergent_day_requires_mss');
  }
  // §7 Step 5 + §2.3: models are chosen in the bias direction — a packet
  // whose side contradicts a non-null LTF bias is not in the playbook.
  // Null bias (pre-open / unclear) leaves both sides walkable at B cap.
  const ltfBias = context?.sessionChain?.ltfBias;
  if (ltfBias && side &&
      !((side === 'long' && ltfBias === 'bullish') || (side === 'short' && ltfBias === 'bearish'))) {
    blockers.push('side_contradicts_ltf_bias');
  }

  const status = blockers.length === 0 ? 'executable' : 'blocked';
  const packet = {
    status,
    finalVerdict: status === 'executable' ? 'manual_candidate' : 'no_trade',
    model: walker?.model ?? 'unknown',
    side: side ?? 'unknown',
    grade: status === 'executable' ? grade : 'no-trade',
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
