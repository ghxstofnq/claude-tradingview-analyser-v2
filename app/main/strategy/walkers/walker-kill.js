import { isTerminalStage, normalizeEvidenceRef } from './walker-state.js';

export function killWalker(walker, { eventTimeUtc, stage = 'blocked', reason = 'walker_killed', evidenceRef = null } = {}) {
  if (!walker) return walker;
  const terminalStage = stage === 'expired' ? 'expired' : 'blocked';
  if (isTerminalStage(walker.stage)) return walker;
  return {
    ...walker,
    stage: terminalStage,
    lastUpdatedAtUtc: eventTimeUtc ?? walker.lastUpdatedAtUtc ?? null,
    blockers: [...new Set([...(Array.isArray(walker.blockers) ? walker.blockers : []), reason])],
    evidence: {
      ...(walker.evidence ?? {}),
      kill: {
        reason,
        evidenceRef: normalizeEvidenceRef(evidenceRef),
      },
    },
  };
}
