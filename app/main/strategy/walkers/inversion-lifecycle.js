import { runWalkerEngine } from './walker-engine.js';
import {
  activeModelWalkers,
  allPdArrays,
  hasCleanDisplacement,
  isValidConfirmationForSide,
  kindOf,
  oppositeSideForPdDirection,
  refOf,
  rowBottom,
  rowTop,
  stateIsTradable,
} from './lifecycle-utils.js';

function findOpposingPdArrays(context) {
  return allPdArrays(context).filter((pdArray) => {
    const kind = kindOf(pdArray);
    return ['fvg', 'ifvg'].includes(kind) && stateIsTradable(pdArray) && oppositeSideForPdDirection(pdArray);
  });
}

function fullCloseThrough(row, walker) {
  const close = Number(row?.close ?? row?.price ?? row?.confirm_close_price);
  if (!Number.isFinite(close)) return false;
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const top = rowTop(pd);
  const bottom = rowBottom(pd);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return false;
  if (walker.side === 'long') return close > top;
  if (walker.side === 'short') return close < bottom;
  return false;
}

export function buildInversionWalkerSpawnRequests(context) {
  if (context?.sourceHealth?.status && context.sourceHealth.status !== 'fresh') return [];
  if (context?.pillar1?.status && context.pillar1.status !== 'pass') return [];
  if (context?.pillar2?.status && context.pillar2.status !== 'pass') return [];
  if (!hasCleanDisplacement(context)) return [];

  return findOpposingPdArrays(context).map((pdArray) => ({
    model: 'Inversion',
    side: oppositeSideForPdDirection(pdArray),
    pdArray,
    setupEvidence: {
      opposingPdArray: { evidenceRef: refOf(pdArray, 'pillar3.pdArrays.inversion'), rawPayload: pdArray },
    },
  }));
}

export function buildInversionWalkerAdvanceRequests(context, walkers = []) {
  const requests = [];
  const confirmationRows = context?.pillar3?.confirmationRows ?? [];

  for (const walker of activeModelWalkers(walkers, 'Inversion')) {
    const confirmed = confirmationRows.find((row) => isValidConfirmationForSide(row, walker.side) && fullCloseThrough(row, walker));
    if ((walker.stage === 'watching' || walker.stage === 'pd_identified' || walker.stage === 'tap_seen' || walker.stage === 'confirmation_pending') && confirmed) {
      requests.push({
        id: walker.id,
        eventTimeUtc: context?.eventTimeUtc,
        stage: 'confirmed',
        evidenceRef: refOf(confirmed, 'pillar3.confirmationRows.inversionConfirmed'),
        evidenceKey: 'confirmation',
        rawPayload: confirmed,
      });
    }
  }
  return requests;
}

export function runInversionWalkerLifecycle({ context, walkers = [] } = {}) {
  const spawned = runWalkerEngine({ context, walkers, spawnRequests: buildInversionWalkerSpawnRequests(context) });
  const pdAdvanceRequests = spawned.events
    .filter((event) => event.type === 'spawn' && event.spawned && event.walker?.model === 'Inversion')
    .map((event) => ({
      id: event.walker.id,
      eventTimeUtc: context?.eventTimeUtc,
      stage: 'pd_identified',
      evidenceRef: event.walker.pdArrayRef,
      evidenceKey: 'pdArray',
      rawPayload: event.walker.evidence?.pdArray?.rawPayload ?? null,
    }));
  const pdAdvanced = runWalkerEngine({ context, walkers: spawned.walkers, advanceRequests: pdAdvanceRequests });
  const advanced = runWalkerEngine({ context, walkers: pdAdvanced.walkers, advanceRequests: buildInversionWalkerAdvanceRequests(context, pdAdvanced.walkers) });
  return { walkers: advanced.walkers, events: [...spawned.events, ...pdAdvanced.events, ...advanced.events] };
}
