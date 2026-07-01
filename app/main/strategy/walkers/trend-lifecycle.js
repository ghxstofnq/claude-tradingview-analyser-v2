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
  numberOrNull,
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
    .filter((pdArray) => kindOf(pdArray) === 'ifvg')
    .map((pdArray) => ({ pdArray, side: sideForPdDirection(pdArray) }))
    .filter(({ side }) => side
      && ((side === 'long' && bias === 'bullish') || (side === 'short' && bias === 'bearish'))
      && isContinuationSetup(context, side))
    .filter(({ pdArray, side }) => stateIsTradable(pdArray) || Boolean(currentReclaimConfirmBar(pdArray, side, context)))
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

function samePdZone(a, b) {
  const aRef = refOf(a, null);
  const bRef = refOf(b, null);
  if (aRef && bRef) return aRef === bRef;
  return ['top', 'bottom', 'ce'].every((k) => Number.isFinite(Number(a?.[k]))
    && Number.isFinite(Number(b?.[k]))
    && Math.abs(Number(a[k]) - Number(b[k])) < 1e-9);
}

function currentReclaimConfirmBar(pdArray, side, context) {
  const inside = (context?.pillar3?.insidePdArrays ?? context?.pillar3?.inside_pd_arrays ?? [])
    .some((row) => samePdZone(pdArray, row));
  if (!inside) return null;
  const ce = Number(pdArray?.ce);
  if (!Number.isFinite(ce)) return null;
  const bar = (context?.pillar3?.confirmationRows ?? [])
    .map((row) => row?.last_bar)
    .find((b) => b && Number.isFinite(Number(b.close)));
  if (!bar) return null;
  const body = Number(bar.body_ratio);
  if (!Number.isFinite(body) || body < CONFIRM_BODY_MIN) return null;
  const close = Number(bar.close);
  if (side === 'long') {
    return bar.direction === 'bullish' && Number(bar.low) < ce && close > ce ? bar : null;
  }
  if (side === 'short') {
    return bar.direction === 'bearish' && Number(bar.high) > ce && close < ce ? bar : null;
  }
  return null;
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
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  return currentReclaimConfirmBar(pd, walker.side, context);
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

function isMultiAlignmentTrendWalker(walker) {
  return Boolean(walker?.evidence?.multiAlignmentTrendEntry);
}

function latestBar(context) {
  return (context?.pillar3?.ohlcv1m ?? []).at(-1) ?? null;
}

function bounds(row) {
  const top = numberOrNull(row?.top);
  const bottom = numberOrNull(row?.bottom);
  return Number.isFinite(top) && Number.isFinite(bottom) ? { top, bottom } : null;
}

function sameSide(row, side) {
  const rowSide = sideForPdDirection(row);
  return rowSide === side;
}

function findTappedFiveMinuteRebalance(context, side) {
  const nowMs = Date.parse(context?.eventTimeUtc);
  const bar = latestBar(context);
  const low = numberOrNull(bar?.low);
  const high = numberOrNull(bar?.high);
  const close = numberOrNull(bar?.close);
  return (context?.pillar3?.fvgs5m ?? [])
    .filter((row) => ['fvg', 'bpr', 'ifvg'].includes(kindOf(row)) && sameSide(row, side))
    // The two-and-one elevator needs a clear 5m rebalance partner. Tiny or
    // liquidity-taking 5m impulse gaps are a single MSS/reversal leg, not the
    // 5m-rebalance + 1m-iFVG pairing (06-16 fresh-context false A+ guard).
    .filter((row) => String(row?.size_quality ?? '').toLowerCase() !== 'tiny')
    .filter((row) => row?.took_liq !== true && row?.took_liq !== 1)
    .filter((row) => bounds(row))
    .filter((row) => {
      const state = String(row?.state ?? '').toLowerCase();
      const entered = Number(row?.entered_ms ?? row?.tap_ms);
      if (!['tapped', 'ce_tapped', 'filled'].includes(state) || !Number.isFinite(entered) || entered <= 0) return false;
      // The 5m rebalance must be the current/recent pullback, not a stale
      // morning imbalance that merely exists in the m5 overlay. This blocks the
      // 09:45 false-positive and waits for the 09:52–09:54 25611 CE tap.
      if (Number.isFinite(nowMs) && (entered > nowMs || nowMs - entered > 10 * 60_000)) return false;
      const b = bounds(row);
      const touched = low != null && high != null && low <= b.top && high >= b.bottom;
      const closedAway = close != null && (side === 'long' ? close > b.top : close < b.bottom);
      return touched && closedAway;
    })
    .sort((a, b) => (Number(b.entered_ms ?? b.tap_ms) || 0) - (Number(a.entered_ms ?? a.tap_ms) || 0))[0] ?? null;
}

function findHistoricalIfvgAlignment(context, side) {
  const nowMs = Date.parse(context?.eventTimeUtc);
  const bar = latestBar(context);
  const close = numberOrNull(bar?.close);
  return allPdArrays(context)
    .filter((row) => kindOf(row) === 'ifvg' && sameSide(row, side))
    .filter((row) => row?.took_liq !== true && row?.took_liq !== 1)
    .filter((row) => bounds(row))
    .filter((row) => {
      const confirmed = Number(row?.confirm_ms);
      return Number.isFinite(confirmed) && confirmed > 0 && (!Number.isFinite(nowMs) || confirmed < nowMs);
    })
    .map((row) => {
      const b = bounds(row);
      const anchor = side === 'long' ? b.bottom : b.top;
      const distance = close == null ? 0 : Math.abs(close - anchor);
      return { row, anchor, distance };
    })
    .filter((c) => c.distance <= 35)
    .sort((a, b) => a.distance - b.distance)[0]?.row ?? null;
}

function findEntryIfvgAnchor(context, side, alignment) {
  const align = bounds(alignment);
  if (!align) return alignment;
  const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 3;
  const candidates = [
    ...(context?.pillar3?.fvgs5m ?? []),
    ...allPdArrays(context),
  ].filter((row) => kindOf(row) === 'ifvg' && sameSide(row, side) && bounds(row));
  return candidates.find((row) => {
    const b = bounds(row);
    return near(b.bottom, align.bottom) || near(b.top, align.top);
  }) ?? alignment;
}

function fivePointBufferedStop(rebalance, side) {
  const b = bounds(rebalance);
  if (!b) return null;
  if (side === 'long') return Math.floor((b.bottom - 5) / 5) * 5;
  if (side === 'short') return Math.ceil((b.top + 5) / 5) * 5;
  return null;
}

function openPriceTargetFromHistoricalRows(context, side, entry, stop) {
  const risk = Math.abs(Number(entry) - Number(stop));
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const minMove = risk * 2.5;
  const fields = ['c1o', 'c2o', 'c3o'];
  const prices = [];
  for (const row of allPdArrays(context)) {
    for (const field of fields) {
      const px = numberOrNull(row?.[field]);
      if (px != null) prices.push({ price: px, evidenceRef: refOf(row, 'pillar3.pdArrays') + `[${field}]` });
    }
  }
  const filtered = prices.filter((p) => side === 'long'
    ? p.price > entry && p.price - entry >= minMove
    : p.price < entry && entry - p.price >= minMove);
  return filtered.sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry))[0] ?? null;
}

function sessionTargetByName(context, side, name) {
  const key = side === 'long' ? 'above' : 'below';
  return (context?.pillar1?.untakenTargets?.[key] ?? [])
    .find((t) => String(t?.name ?? t?.label ?? '').replace('_', '.').toUpperCase() === name);
}

function buildMultiAlignmentTrendCandidate(context) {
  const bias = context?.sessionChain?.ltfBias;
  const side = bias === 'bullish' ? 'long' : bias === 'bearish' ? 'short' : null;
  if (!side) return null;
  if (context?.sessionChain?.drawBiasPillar !== 'clear-2of3') return null;
  if (context?.sessionChain?.bElevatable !== true) return null;
  const primaryDraw = context?.sessionChain?.pillar1?.primaryDraw;
  if (!primaryDraw || typeof primaryDraw !== 'object') return null;
  if (!hasCleanDisplacement(context)) return null;
  const rebalance = findTappedFiveMinuteRebalance(context, side);
  const alignment = findHistoricalIfvgAlignment(context, side);
  if (!rebalance || !alignment) return null;
  const entryZone = findEntryIfvgAnchor(context, side, alignment);
  const eb = bounds(entryZone);
  if (!eb) return null;
  const entry = side === 'long' ? eb.bottom : eb.top;
  const stop = fivePointBufferedStop(rebalance, side);
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || (side === 'long' ? stop >= entry : stop <= entry)) return null;
  const bar = latestBar(context);
  const close = numberOrNull(bar?.close);
  if (close == null || (side === 'long' ? close < entry - 1 : close > entry + 1)) return null;
  const tp1 = openPriceTargetFromHistoricalRows(context, side, entry, stop);
  const tp2 = sessionTargetByName(context, side, side === 'long' ? 'AS.H' : 'AS.L');
  return { side, entryZone, alignment, rebalance, entry, stop, tp1, tp2, bar };
}

export function buildTrendMultiAlignmentSpawnRequests(context) {
  if (context?.sourceHealth?.status && context.sourceHealth.status !== 'fresh') return [];
  if (context?.pillar1?.status && context.pillar1.status !== 'pass') return [];
  if (context?.pillar2?.status && context.pillar2.status !== 'pass') return [];
  const candidate = buildMultiAlignmentTrendCandidate(context);
  if (!candidate) return [];
  return [{
    model: 'Trend',
    side: candidate.side,
    pdArray: { ...candidate.entryZone, kind: 'ifvg' },
    setupEvidence: {
      multiAlignmentTrendEntry: {
        evidenceRef: refOf(candidate.entryZone, 'pillar3.ifvg.multi_alignment_entry'),
        rawPayload: {
          source: 'trend_multi_alignment_ifvg_entry',
          ifvg_alignment: candidate.alignment,
          five_minute_rebalance: candidate.rebalance,
          entry_price: candidate.entry,
          stop_price: candidate.stop,
          tp1_price: candidate.tp1?.price ?? null,
          tp1_evidence_ref: candidate.tp1?.evidenceRef ?? null,
          tp2_price: candidate.tp2?.price ?? null,
          tp2_evidence_ref: refOf(candidate.tp2, null),
        },
      },
    },
  }];
}

export function buildTrendMultiAlignmentAdvanceRequests(context, walkers = []) {
  const candidate = buildMultiAlignmentTrendCandidate(context);
  if (!candidate) return [];
  const requests = [];
  for (const walker of activeModelWalkers(walkers, 'Trend')) {
    if (!isMultiAlignmentTrendWalker(walker) || !RECLAIM_PRE_CONFIRM_STAGES.has(walker.stage)) continue;
    requests.push({
      id: walker.id,
      eventTimeUtc: context?.eventTimeUtc,
      stage: 'confirmed',
      evidenceRef: refOf(walker?.evidence?.multiAlignmentTrendEntry, walker.pdArrayRef),
      evidenceKey: 'confirmation',
      rawPayload: {
        ...walker.evidence.multiAlignmentTrendEntry.rawPayload,
        last_bar: candidate.bar,
        close: Number(candidate.bar?.close),
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
    // Reclaim/multi-alignment subtype walkers use their own confirm paths — the
    // normal retrace tap/confirm must not touch them.
    if (isReclaimWalker(walker) || isMultiAlignmentTrendWalker(walker)) continue;
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
  const spawnRequests = [
    ...buildTrendWalkerSpawnRequests(context),
    ...buildTrendReclaimSpawnRequests(context),
    ...buildTrendMultiAlignmentSpawnRequests(context),
  ];
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
    ...buildTrendMultiAlignmentAdvanceRequests(context, killed.walkers),
  ];
  const advanced = runWalkerEngine({ context, walkers: killed.walkers, advanceRequests });
  return { walkers: advanced.walkers, events: [...spawned.events, ...pdAdvanced.events, ...killed.events, ...advanced.events] };
}
