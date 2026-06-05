export function normalizeNoTradePayload(payload = {}, receivedAtMs = Date.now()) {
  const reason = payload?.reason || 'no-trade';
  return {
    reason,
    ...(payload?.evaluationStatus ? { evaluationStatus: payload.evaluationStatus } : {}),
    ...(Array.isArray(payload?.blockers) ? { blockers: payload.blockers } : {}),
    ...(payload?.sourceHealth ? { sourceHealth: payload.sourceHealth } : {}),
    ...(payload?.strategyChainStatus ? { strategyChainStatus: payload.strategyChainStatus } : {}),
    ...(Array.isArray(payload?.evidenceRefs) ? { evidenceRefs: payload.evidenceRefs } : {}),
    ...(payload?.eventTimeUtc ? { eventTimeUtc: payload.eventTimeUtc } : {}),
    receivedAtMs,
  };
}

export function noTradeStatusLabel(noTrade) {
  const status = noTrade?.evaluationStatus;
  if (typeof status === 'string' && status.startsWith('cannot_evaluate')) return 'cannot evaluate';
  return 'no-trade';
}
