export const WALKER_STAGES = Object.freeze([
  'watching',
  'pd_identified',
  'tap_seen',
  'confirmation_pending',
  'confirmed',
  'packet_ready',
  'blocked',
  'expired',
]);

export const TERMINAL_WALKER_STAGES = Object.freeze(['packet_ready', 'blocked', 'expired']);
export const WALKER_MODELS = Object.freeze(['MSS', 'Trend', 'Inversion']);
export const WALKER_SIDES = Object.freeze(['long', 'short']);

export function isTerminalStage(stage) {
  return TERMINAL_WALKER_STAGES.includes(stage);
}

export function isActiveWalker(walker) {
  return Boolean(walker?.stage) && !isTerminalStage(walker.stage);
}

export function stageIndex(stage) {
  return WALKER_STAGES.indexOf(stage);
}

export function normalizeEvidenceRef(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
}

export function createWalkerId({ context, model, side, pdArray }) {
  const parts = [
    'walker',
    context?.market,
    context?.session,
    model,
    side,
    pdArray?.evidenceRef ?? pdArray?.cite ?? pdArray?.id ?? 'no_pd_ref',
    context?.eventTimeUtc,
  ];
  return parts
    .map((part) => String(part ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_'))
    .join('_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function createWalker({ context, model, side, pdArray = null, setupEvidence = {} }) {
  const eventTimeUtc = context?.eventTimeUtc;
  const pdArrayRef = normalizeEvidenceRef(pdArray?.evidenceRef ?? pdArray?.cite ?? pdArray?.id);
  return {
    id: createWalkerId({ context, model, side, pdArray }),
    market: context?.market ?? 'unknown',
    session: context?.session ?? 'unknown',
    model,
    side,
    stage: 'watching',
    createdAtUtc: eventTimeUtc ?? null,
    lastUpdatedAtUtc: eventTimeUtc ?? null,
    sourceEventTimeUtc: eventTimeUtc ?? null,
    pdArrayRef,
    tapRef: null,
    confirmationRef: null,
    blockers: [],
    evidence: {
      ...(pdArrayRef
        ? {
            pdArray: {
              evidenceRef: pdArrayRef,
              rawPayload: pdArray,
            },
          }
        : {}),
      ...setupEvidence,
    },
  };
}

export function sameWalkerKey(a, b) {
  return Boolean(a && b)
    && a.market === b.market
    && a.session === b.session
    && a.model === b.model
    && a.side === b.side
    && a.pdArrayRef === b.pdArrayRef;
}
