import { runWalkerEngine } from './walker-engine.js';
import {
  activeModelWalkers,
  allPdArrays,
  hasCleanDisplacement,
  isValidConfirmationForSide,
  kindOf,
  matchesTrackedPd,
  refOf,
  sideForPdDirection,
  stateIsTradable,
} from './lifecycle-utils.js';

function findContinuationPdArrays(context) {
  return allPdArrays(context).filter((pdArray) => {
    const kind = kindOf(pdArray);
    return ['fvg', 'bpr'].includes(kind) && stateIsTradable(pdArray) && sideForPdDirection(pdArray);
  });
}

function laterThanTap(row) {
  const confirmMs = Number(row?.confirm_ms);
  const enteredMs = Number(row?.entered_ms ?? row?.tap_ms);
  if (!Number.isFinite(confirmMs) || !Number.isFinite(enteredMs)) return false;
  return confirmMs > enteredMs;
}

export function buildTrendWalkerSpawnRequests(context) {
  if (context?.sourceHealth?.status && context.sourceHealth.status !== 'fresh') return [];
  if (context?.pillar1?.status && context.pillar1.status !== 'pass') return [];
  if (context?.pillar2?.status && context.pillar2.status !== 'pass') return [];
  if (!hasCleanDisplacement(context)) return [];

  return findContinuationPdArrays(context).map((pdArray) => ({
    model: 'Trend',
    side: sideForPdDirection(pdArray),
    pdArray,
    setupEvidence: {
      continuationPdArray: { evidenceRef: refOf(pdArray, 'pillar3.pdArrays.trend'), rawPayload: pdArray },
    },
  }));
}

export function buildTrendWalkerAdvanceRequests(context, walkers = []) {
  const requests = [];
  const insidePdArrays = context?.pillar3?.insidePdArrays ?? context?.pillar3?.inside_pd_arrays ?? [];
  const confirmationRows = context?.pillar3?.confirmationRows ?? [];

  for (const walker of activeModelWalkers(walkers, 'Trend')) {
    const tapped = insidePdArrays.find((row) => matchesTrackedPd(walker, row));
    if ((walker.stage === 'watching' || walker.stage === 'pd_identified' || walker.stage === 'confirmation_pending') && tapped) {
      requests.push({
        id: walker.id,
        eventTimeUtc: context?.eventTimeUtc,
        stage: 'tap_seen',
        evidenceRef: refOf(tapped, walker.pdArrayRef),
        evidenceKey: 'tap',
        rawPayload: tapped,
      });
      continue;
    }

    const confirmed = confirmationRows.find((row) => isValidConfirmationForSide(row, walker.side) && laterThanTap(row));
    if ((walker.stage === 'tap_seen' || walker.stage === 'confirmation_pending') && confirmed) {
      requests.push({
        id: walker.id,
        eventTimeUtc: context?.eventTimeUtc,
        stage: 'confirmed',
        evidenceRef: refOf(confirmed, 'pillar3.confirmationRows.trendConfirmed'),
        evidenceKey: 'confirmation',
        rawPayload: confirmed,
      });
    }
  }
  return requests;
}

export function runTrendWalkerLifecycle({ context, walkers = [] } = {}) {
  const spawned = runWalkerEngine({ context, walkers, spawnRequests: buildTrendWalkerSpawnRequests(context) });
  const pdAdvanceRequests = spawned.events
    .filter((event) => event.type === 'spawn' && event.spawned && event.walker?.model === 'Trend')
    .map((event) => ({
      id: event.walker.id,
      eventTimeUtc: context?.eventTimeUtc,
      stage: 'pd_identified',
      evidenceRef: event.walker.pdArrayRef,
      evidenceKey: 'pdArray',
      rawPayload: event.walker.evidence?.pdArray?.rawPayload ?? null,
    }));
  const pdAdvanced = runWalkerEngine({ context, walkers: spawned.walkers, advanceRequests: pdAdvanceRequests });
  const advanced = runWalkerEngine({ context, walkers: pdAdvanced.walkers, advanceRequests: buildTrendWalkerAdvanceRequests(context, pdAdvanced.walkers) });
  return { walkers: advanced.walkers, events: [...spawned.events, ...pdAdvanced.events, ...advanced.events] };
}
