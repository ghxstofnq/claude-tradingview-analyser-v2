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

function selectTp1(context, side, entry, stop) {
  const candidates = targetPool(context, side)
    .map((target) => ({ ...target, price: numberOrNull(target?.price ?? target?.level) }))
    .filter((target) => target.price != null && targetIsCorrectSide(target, entry, side))
    .map((target) => ({ ...target, rMultiple: computeRMultiple({ entry, stop, target: target.price }) }))
    .filter((target) => target.rMultiple != null)
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
  return candidates[0] ?? null;
}

function deriveGrade({ context, walker }) {
  const pdQuality = walker?.evidence?.pdArray?.rawPayload?.size_quality
    ?? walker?.evidence?.pdArray?.rawPayload?.sizeQuality
    ?? walker?.evidence?.pdArray?.rawPayload?.quality;
  if (context?.pillar1?.status === 'pass' && context?.pillar2?.status === 'pass' && pdQuality === 'large') return 'A+';
  if (context?.pillar1?.status === 'pass' && context?.pillar2?.status === 'pass') return 'B';
  return 'no-trade';
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
  const stopCandidate = stopAudit.selected;
  if (!stopCandidate) blockers.push('missing_structural_stop');

  const tp1Candidate = entryPrice == null || !stopCandidate ? null : selectTp1(context, side, entryPrice, stopCandidate.price);
  if (!tp1Candidate) blockers.push('missing_side_consistent_tp1');
  if (tp1Candidate && tp1Candidate.rMultiple < 1.5) blockers.push('tp1_below_1_5r');

  const grade = deriveGrade({ context, walker });
  if (grade === 'no-trade') blockers.push('grade_blocked');

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
