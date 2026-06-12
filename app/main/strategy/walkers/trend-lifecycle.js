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

// entry-models.md Trend: on the retrace into the in-trend FVG, "a quick tap
// and then a full-body candle closes away from the zone" is the entry. The
// strategy's tap is WICK-based (verified 2026-05-18) but the engine's
// entry-state tracker is close-based — June 9 trade 7's 11:53 candle wicked
// 6.75pts into the bear FVG, closed bearish away with a 0.68 body, and the
// engine never stamped it. Derived deterministically from the bar instead.
function wickTapConfirm(walker, context) {
  const bar = (context?.pillar3?.confirmationRows ?? [])
    .map((row) => row?.last_bar)
    .find((b) => b && Number.isFinite(Number(b.close)));
  if (!bar) return null;
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const top = Number(pd.top);
  const bottom = Number(pd.bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  // The zone must still be ALIVE as an in-trend fvg right now — the walker
  // holds its spawn-time snapshot, but a zone that has since inverted or
  // invalidated is dead (June 9: a flipped 0.25-pt zone wick-"confirmed" at
  // 11:11 and front-ran the real 11:12 inversion). No current row → dead.
  const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 0.26;
  const current = allPdArrays(context)
    .map((row) => row?.rawPayload ?? row)
    .find((row) => near(Number(row?.top), top) && near(Number(row?.bottom), bottom));
  if (!current || kindOf(current) !== 'fvg' || !stateIsTradable(current)) return null;
  // The zone-creating displacement candle touches the boundary by
  // construction — only bars AFTER creation can be the retrace tap.
  const createdMs = Number(pd.created_ms);
  const barMs = Number(bar.time) * 1000;
  if (Number.isFinite(createdMs) && Number.isFinite(barMs) && barMs <= createdMs) return null;
  const body = Number(bar.body_ratio);
  if (!Number.isFinite(body) || body < 0.6) return null; // §3 "good" body, not a doji
  const close = Number(bar.close);
  // "A quick tap" stays inside the zone — a wick through the far edge is a
  // violation (the engine inverts those), not a retrace entry.
  if (walker.side === 'short') {
    const wickIn = Number(bar.high) > bottom && Number(bar.high) <= top;
    return wickIn && bar.direction === 'bearish' && close < bottom ? bar : null;
  }
  if (walker.side === 'long') {
    const wickIn = Number(bar.low) < top && Number(bar.low) >= bottom;
    return wickIn && bar.direction === 'bullish' && close > top ? bar : null;
  }
  return null;
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
      continue;
    }

    const wickBar = wickTapConfirm(walker, context);
    if ((walker.stage === 'pd_identified' || walker.stage === 'tap_seen' || walker.stage === 'confirmation_pending') && wickBar) {
      requests.push({
        id: walker.id,
        eventTimeUtc: context?.eventTimeUtc,
        stage: 'confirmed',
        evidenceRef: refOf(walker?.evidence?.pdArray, walker.pdArrayRef),
        evidenceKey: 'confirmation',
        rawPayload: { source: 'trend_wick_tap_confirm', last_bar: wickBar, close: Number(wickBar.close) },
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
