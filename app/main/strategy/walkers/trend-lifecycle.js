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

// EM Trend §1: the model is a CONTINUATION — it requires an established trend
// in the zone direction ("a clear MSS to the upside; you are now in the
// continuation phase"). The latest SWING-tier structure is that evidence.
function latestSwingStructure(context) {
  const swing = context?.pillar3?.structuresSwing ?? context?.pillar3?.structures_swing ?? [];
  return swing.reduce(
    (acc, s) => ((Number(s?.confirmed_ms) || 0) >= (Number(acc?.confirmed_ms) || 0) ? s : acc),
    null,
  );
}

function structureDirMatchesSide(structure, side) {
  if (!structure) return false;
  const dir = String(structure?.dir ?? structure?.direction ?? '').toLowerCase();
  if (side === 'long') return dir === 'bull' || dir === 'bullish';
  if (side === 'short') return dir === 'bear' || dir === 'bearish';
  return false;
}

const TREND_PRE_CONFIRM_STAGES = new Set(['watching', 'pd_identified', 'tap_seen', 'confirmation_pending']);

function findContinuationPdArrays(context) {
  return allPdArrays(context).filter((pdArray) => {
    const kind = kindOf(pdArray);
    // GXNQ June 9 trade-5 ruling: "the fvg it tapped into was too small."
    // Tiny zones (engine size grading) are noise for the Trend retrace —
    // Inversion is NOT size-filtered (the validated June 9 inversions all
    // violated tiny zones; the displacement, not the zone, carries those).
    if (String(pdArray?.size_quality ?? '') === 'tiny') return false;
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
  // Body discipline: the confirming candle must carry a §3 "good" body
  // (>= 0.6) regardless of zone state — GXNQ's June 9 re-grade withdrew the
  // post-CE-tap relaxation (the 0.51-body 11:01 candle was NOT the entry;
  // the 0.89-body 11:04 candle was the one correct trade).
  const body = Number(bar.body_ratio);
  if (!Number.isFinite(body) || body < 0.6) return null;
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

  // EM Trend §1: only spawn a continuation when the latest swing-tier structure
  // is established in the zone direction. No structure = no established trend
  // (fail closed); opposing structure = not a continuation.
  const latest = latestSwingStructure(context);
  return findContinuationPdArrays(context)
    .map((pdArray) => ({ pdArray, side: sideForPdDirection(pdArray) }))
    .filter(({ side }) => structureDirMatchesSide(latest, side))
    .map(({ pdArray, side }) => ({
      model: 'Trend',
      side,
      pdArray,
      setupEvidence: {
        continuationPdArray: { evidenceRef: refOf(pdArray, 'pillar3.pdArrays.trend'), rawPayload: pdArray },
        trendStructure: { evidenceRef: refOf(latest, 'pillar3.structures_by_tier.swing'), rawPayload: latest },
      },
    }));
}

// EM Trend §3/§4: kill a pre-confirmation continuation walker when market
// structure breaks against it — the latest swing-tier structure flips to the
// opposing direction AFTER the walker spawned ("no trade if price breaks
// market structure down / no longer higher lows").
export function buildTrendWalkerKillRequests(context, walkers = []) {
  const latest = latestSwingStructure(context);
  if (!latest) return [];
  const confirmedMs = Number(latest?.confirmed_ms);
  const requests = [];
  for (const walker of walkers) {
    if (walker?.model !== 'Trend' || !TREND_PRE_CONFIRM_STAGES.has(walker?.stage)) continue;
    if (structureDirMatchesSide(latest, walker.side)) continue; // still aligned
    const spawnMs = Date.parse(walker?.createdAtUtc);
    if (!Number.isFinite(spawnMs) || !Number.isFinite(confirmedMs) || confirmedMs <= spawnMs) continue;
    requests.push({
      id: walker.id,
      eventTimeUtc: context?.eventTimeUtc,
      stage: 'blocked',
      reason: 'trend_structure_broken',
      evidenceRef: refOf(latest, 'pillar3.structures_by_tier.swing'),
    });
  }
  return requests;
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
  // EM Trend §3/§4: kill structure-broken walkers BEFORE they can confirm.
  const killed = runWalkerEngine({ context, walkers: pdAdvanced.walkers, killRequests: buildTrendWalkerKillRequests(context, pdAdvanced.walkers) });
  const advanced = runWalkerEngine({ context, walkers: killed.walkers, advanceRequests: buildTrendWalkerAdvanceRequests(context, killed.walkers) });
  return { walkers: advanced.walkers, events: [...spawned.events, ...pdAdvanced.events, ...killed.events, ...advanced.events] };
}
