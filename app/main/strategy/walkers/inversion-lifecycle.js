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
  sideForPdDirection,
  stampWithinConfirmationWindow,
  stateIsTradable,
} from './lifecycle-utils.js';

// The engine FLIPS dir when a zone inverts (pine/ict-engine.pine: "kind
// flips fvg -> ifvg, dir flips"). A fresh fvg fails AGAINST its dir; an
// ifvg's dir already IS the post-failure trade direction. June 9 trades
// 4-6 shorted bull iFVGs (support) because both kinds used the opposite map.
function inversionSideFor(pdArray) {
  return kindOf(pdArray) === 'ifvg' ? sideForPdDirection(pdArray) : oppositeSideForPdDirection(pdArray);
}

function findOpposingPdArrays(context) {
  return allPdArrays(context).filter((pdArray) => {
    const kind = kindOf(pdArray);
    return ['fvg', 'ifvg'].includes(kind) && stateIsTradable(pdArray) && inversionSideFor(pdArray);
  });
}

function fullCloseThrough(row, walker) {
  const close = Number(row?.close ?? row?.price ?? row?.confirm_close_price);
  if (!Number.isFinite(close)) return false;
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const top = rowTop(pd);
  const bottom = rowBottom(pd);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return false;
  // Zone identity: a confirmation carrying another zone's bounds is not
  // this walker's violation (June 9 trade 4: zone A's flip confirmed a
  // walker holding zone B because the close sat below both). Bound-less
  // rows (hand-built fixtures) keep the legacy close-beyond behavior.
  const rTop = Number(row?.zone_top ?? row?.top);
  const rBottom = Number(row?.zone_bottom ?? row?.bottom);
  if (Number.isFinite(rTop) && Number.isFinite(rBottom)) {
    const near = (a, b) => Math.abs(a - b) < 0.26;
    if (!near(rTop, top) || !near(rBottom, bottom)) return false;
  }
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
    side: inversionSideFor(pdArray),
    pdArray,
    setupEvidence: {
      opposingPdArray: { evidenceRef: refOf(pdArray, 'pillar3.pdArrays.inversion'), rawPayload: pdArray },
    },
  }));
}

// GXNQ ruling 2026-06-13 (June 11 11:22): "not an inversion confirmation
// candle — it doesn't invert the bullish fvg." Every validated Inversion
// across June 9/10 entered on the candle that FLIPPED the zone (June 10's
// 10:53: inverted_ms in the entry bar). When the walker's current zone row
// carries inverted_ms and the confirmation carries its bar, the flip must
// stamp THAT bar; stale flips are retests, not entries. Rows without the
// stamps (hand-built fixtures) keep the legacy close-through behavior.
function invertedFreshForWalker(context, walker, row) {
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const top = Number(pd.top);
  const bottom = Number(pd.bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return true;
  const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 0.26;
  const current = allPdArrays(context)
    .map((r) => r?.rawPayload ?? r)
    .find((r) => near(Number(r?.top), top) && near(Number(r?.bottom), bottom));
  const invMs = Number(current?.inverted_ms);
  if (!Number.isFinite(invMs) || invMs <= 0) return true; // no stamp → legacy
  // Fresh iff the flip falls within the current bar widened by the surfacing
  // lookback — NOT a stale flip from many bars ago (GXNQ: "entry is the
  // inverting candle"). Old code used a strict 1-bar window which live never
  // hit (flip surfaces 1-2 captures late; last_bar is the forming bar).
  return stampWithinConfirmationWindow(invMs, row?.last_bar?.time);
}

export function buildInversionWalkerAdvanceRequests(context, walkers = []) {
  const requests = [];
  const confirmationRows = context?.pillar3?.confirmationRows ?? [];

  for (const walker of activeModelWalkers(walkers, 'Inversion')) {
    const confirmed = confirmationRows.find((row) => isValidConfirmationForSide(row, walker.side)
      && fullCloseThrough(row, walker)
      && invertedFreshForWalker(context, walker, row));
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
