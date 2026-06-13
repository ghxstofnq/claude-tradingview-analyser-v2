import { isTerminalStage, normalizeEvidenceRef, stageIndex } from './walker-state.js';

function blockedWalker(walker, eventTimeUtc, reason) {
  return {
    ...walker,
    stage: 'blocked',
    lastUpdatedAtUtc: eventTimeUtc ?? walker?.lastUpdatedAtUtc ?? null,
    blockers: [...new Set([...(Array.isArray(walker?.blockers) ? walker.blockers : []), reason])],
  };
}

export function advanceWalker(walker, { eventTimeUtc, stage, evidenceRef = null, evidenceKey = null, rawPayload = null } = {}) {
  if (!walker || isTerminalStage(walker.stage)) return walker;
  const currentIndex = stageIndex(walker.stage);
  const nextIndex = stageIndex(stage);
  if (nextIndex < 0) return blockedWalker(walker, eventTimeUtc, 'unknown_stage');
  if (nextIndex <= currentIndex) return blockedWalker(walker, eventTimeUtc, 'invalid_stage_regression');

  const next = {
    ...walker,
    stage,
    lastUpdatedAtUtc: eventTimeUtc ?? walker.lastUpdatedAtUtc ?? null,
    evidence: { ...(walker.evidence ?? {}) },
  };

  const ref = normalizeEvidenceRef(evidenceRef);
  if (stage === 'tap_seen') {
    if (ref) next.tapRef = ref;
    // Stamp the tap so the 10–15 min confirmation window can be enforced
    // (TS §7 Step 6 / EM MSS §5). Set once on the first tap; never reset.
    if (!next.tappedAtUtc) next.tappedAtUtc = next.lastUpdatedAtUtc ?? null;
  }
  if (stage === 'confirmed' && ref) next.confirmationRef = ref;

  if (evidenceKey) {
    next.evidence[evidenceKey] = {
      evidenceRef: ref,
      rawPayload,
    };
  }

  return next;
}
