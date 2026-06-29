import { runWalkerEngine } from './walker-engine.js';
import {
  activeModelWalkers,
  allPdArrays,
  CONFIRM_BODY_MIN,
  hasCleanDisplacement,
  isContinuationSetup,
  isValidConfirmationForSide,
  kindOf,
  matchesTrackedPd,
  refOf,
  sideForPdDirection,
  stateIsTradable,
  wickTapConfirm,
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

// Trend reclaim-continuation subtype (entry-models.md intro: Trend is "also
// enterable by retrace or invert"; §3 "pullback within the structure into an
// internal FVG in the trend direction"). The textbook Trend retrace (above)
// rides a FRESH in-direction FVG; this variant rides a gap that FLIPPED in the
// trade direction — a bear FVG that inverted to bull support (an iFVG) — and
// enters on the RECLAIM back into it, NOT the aggressive violation break the
// Inversion mechanism takes (TRADE24 18:57: "the difference between MSS and
// inversion is you take off the break instead of a retracement"). On a Trend-
// priority continuation day Lanto waits for that retrace, so this defers the
// premature break-inversion on the same zone (see inversion-lifecycle.js).
// Tightly gated — Trend is the chosen model, the gap flipped to the bias side,
// it took liquidity with real displacement, and the leg confirms a continuation
// (keeps the verified Reversal inversions 02-09/06-09 out: their leg runs
// counter to the trade, so isContinuationSetup is false there).
// Calibrated to the user-approved 2026-06-18 oracle (CE of the dip-reclaim bull
// FVG 30448.25–30457.25, took-liq, ds 0.82).
const RECLAIM_DISP_MIN = 0.8;

function findReclaimContinuationPdArrays(context) {
  const chain = context?.sessionChain ?? {};
  if (String(chain.entryModelPriority ?? '').toLowerCase() !== 'trend') return [];
  const bias = chain.ltfBias;
  return allPdArrays(context)
    .filter((pdArray) => kindOf(pdArray) === 'ifvg' && stateIsTradable(pdArray))
    .map((pdArray) => ({ pdArray, side: sideForPdDirection(pdArray) }))
    .filter(({ side }) => side
      && ((side === 'long' && bias === 'bullish') || (side === 'short' && bias === 'bearish'))
      && isContinuationSetup(context, side))
    .filter(({ pdArray }) => (pdArray.took_liq === true || pdArray.took_liq === 1)
      && Number(pdArray.disp_score) >= RECLAIM_DISP_MIN
      && Number.isFinite(Number(pdArray.ce)));
}

export function buildTrendReclaimSpawnRequests(context) {
  if (context?.sourceHealth?.status && context.sourceHealth.status !== 'fresh') return [];
  if (context?.pillar1?.status && context.pillar1.status !== 'pass') return [];
  if (context?.pillar2?.status && context.pillar2.status !== 'pass') return [];
  if (!hasCleanDisplacement(context)) return [];

  return findReclaimContinuationPdArrays(context).map(({ pdArray, side }) => ({
    model: 'Trend',
    side,
    pdArray,
    setupEvidence: {
      continuationPdArray: { evidenceRef: refOf(pdArray, 'pillar3.pdArrays.trend_reclaim'), rawPayload: pdArray },
      // Marker the lifecycle + execution-packet branch on: this walker confirms
      // on the reclaim (CE entry, dip-invalidation stop), not the normal retrace.
      reclaimContinuation: { evidenceRef: refOf(pdArray, 'pillar3.pdArrays.trend_reclaim'), rawPayload: pdArray },
    },
  }));
}

function isReclaimWalker(walker) {
  return Boolean(walker?.evidence?.reclaimContinuation);
}

// EM Trend §4 reclaim confirmation: price dips back through the flipped gap's CE
// and a deliberate 1m candle closes back beyond the CE in the trade direction —
// "respecting" the zone (confirmation.md). Reads the closed confirmation bar
// directly (the same source wickTapConfirm uses) because the engine's close-based
// entry-state tracker never stamps a violated/invalidated iFVG. Requires the zone
// to currently HOLD price (in insidePdArrays) so a stale flip cannot confirm, a
// §3 "good body" (>=0.6, excludes the 09:42 doji), and a reclaim FROM the dip
// (low/high crossed the CE — excludes the 09:43 aggressive break that never
// retraced). Entry is the CE, not the bar close (set on the request payload).
function reclaimConfirmBar(walker, context) {
  const inside = (context?.pillar3?.insidePdArrays ?? context?.pillar3?.inside_pd_arrays ?? [])
    .some((row) => matchesTrackedPd(walker, row));
  if (!inside) return null;
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const ce = Number(pd.ce);
  if (!Number.isFinite(ce)) return null;
  const bar = (context?.pillar3?.confirmationRows ?? [])
    .map((row) => row?.last_bar)
    .find((b) => b && Number.isFinite(Number(b.close)));
  if (!bar) return null;
  const body = Number(bar.body_ratio);
  if (!Number.isFinite(body) || body < CONFIRM_BODY_MIN) return null;
  const close = Number(bar.close);
  if (walker.side === 'long') {
    return bar.direction === 'bullish' && Number(bar.low) < ce && close > ce ? bar : null;
  }
  if (walker.side === 'short') {
    return bar.direction === 'bearish' && Number(bar.high) > ce && close < ce ? bar : null;
  }
  return null;
}

const RECLAIM_PRE_CONFIRM_STAGES = new Set(['watching', 'pd_identified', 'tap_seen', 'confirmation_pending']);

export function buildTrendReclaimAdvanceRequests(context, walkers = []) {
  const requests = [];
  for (const walker of activeModelWalkers(walkers, 'Trend')) {
    if (!isReclaimWalker(walker) || !RECLAIM_PRE_CONFIRM_STAGES.has(walker.stage)) continue;
    const bar = reclaimConfirmBar(walker, context);
    if (!bar) continue;
    const ce = Number(walker?.evidence?.pdArray?.rawPayload?.ce);
    requests.push({
      id: walker.id,
      eventTimeUtc: context?.eventTimeUtc,
      stage: 'confirmed',
      evidenceRef: refOf(walker?.evidence?.pdArray, walker.pdArrayRef),
      evidenceKey: 'confirmation',
      rawPayload: {
        source: 'trend_reclaim_confirm',
        entry_price: ce,
        dip_low: Number(bar.low),
        dip_high: Number(bar.high),
        last_bar: bar,
        close: Number(bar.close),
        confirm_ms: Date.parse(context?.eventTimeUtc) || null,
      },
    });
  }
  return requests;
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
    // Reclaim-subtype walkers use their own confirm path (buildTrendReclaim-
    // AdvanceRequests) — the normal retrace tap/confirm must not touch them.
    if (isReclaimWalker(walker)) continue;
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
  const spawnRequests = [...buildTrendWalkerSpawnRequests(context), ...buildTrendReclaimSpawnRequests(context)];
  const spawned = runWalkerEngine({ context, walkers, spawnRequests });
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
  const advanceRequests = [
    ...buildTrendWalkerAdvanceRequests(context, killed.walkers),
    ...buildTrendReclaimAdvanceRequests(context, killed.walkers),
  ];
  const advanced = runWalkerEngine({ context, walkers: killed.walkers, advanceRequests });
  return { walkers: advanced.walkers, events: [...spawned.events, ...pdAdvanced.events, ...killed.events, ...advanced.events] };
}
