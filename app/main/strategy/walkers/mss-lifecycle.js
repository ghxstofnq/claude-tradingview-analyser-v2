import { runWalkerEngine } from './walker-engine.js';
import { isActiveWalker } from './walker-state.js';
import { isValidConfirmationForSide } from './lifecycle-utils.js';

function directionForSide(side) {
  if (side === 'long') return { pd: ['bull', 'bullish'], swing: ['bull', 'bullish'], sweepSide: 'sell', confirm: ['bull', 'bullish'] };
  if (side === 'short') return { pd: ['bear', 'bearish'], swing: ['bear', 'bearish'], sweepSide: 'buy', confirm: ['bear', 'bearish'] };
  return { pd: [], swing: [], sweepSide: null, confirm: [] };
}

function refOf(item, fallback) {
  if (typeof item?.evidenceRef === 'string' && item.evidenceRef.trim()) return item.evidenceRef;
  if (typeof item?.cite === 'string' && item.cite.trim()) return item.cite;
  if (typeof item?.id === 'string' && item.id.trim()) return item.id;
  return fallback;
}

function rowDirection(row) {
  return row?.direction ?? row?.dir ?? 'unknown';
}

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function hasCleanDisplacement(context) {
  const displacement = context?.pillar2?.displacement ?? context?.pillar2?.current_tf?.displacement;
  return displacement === 'clean' || displacement === 'acceptable';
}

// EM MSS §2 (significant grab): "Asia low, London low, prior-day low, or a very
// clear intraday swing low… never an MSS off a 1m equal-low" (BIAS 29:43-31:34).
// Named session / PD draws are significant by definition — the levels Lanto
// names. A sweep of an unnamed internal/equal level is not.
const SIGNIFICANT_SWEEP_TARGETS = new Set([
  'AS.H', 'AS.L', 'LO.H', 'LO.L', 'PDH', 'PDL', 'PWH', 'PWL', 'NYAM.H', 'NYAM.L', 'NYPM.H', 'NYPM.L',
]);

// Filter-only-when-present: real V3/V4 sweeps always stamp `target`; field-less
// hand-built fixtures keep the legacy (ungated) behavior.
function isSignificantSweepTarget(sweep) {
  const target = sweep?.target;
  if (target == null || target === '') return true;
  return SIGNIFICANT_SWEEP_TARGETS.has(String(target));
}

// EM MSS §3 (displaced reversal at matching speed): the shift must break the
// recent lower high WITH displacement — "displace at the same speed it came
// down, if not more" (ENTRY 08:26; BIAS 28:47). The engine's structure
// `displacement` flag marks a large-bodied breaking candle (pine: "displacement
// marks a large-bodied breaking candle") = that speed; and the shift must be
// swing-tier — a real structural turn, not an internal poke (the analog of the
// rejected "1m equal-low" grab). Both gated only when the engine stamped them.
function isSignificantDisplacedShift(fs) {
  if (fs?.tier != null && fs.tier !== 'swing') return false;
  if (fs?.displacement != null && !isTruthyFlag(fs.displacement)) return false;
  return true;
}

// The MOST RECENT rejected sweep of opposing liquidity anchors the model —
// the shift must follow the latest grab, not any grab on record (June 10
// 10:06: NYPM.H from the prior afternoon + an overnight bear MSS would have
// paired under an any-sweep rule).
function findRejectedSweep(context, side) {
  const wanted = directionForSide(side);
  return (context?.pillar3?.sweeps ?? context?.pillar1?.sweeps ?? [])
    .filter((sweep) => sweep?.side === wanted.sweepSide && sweep?.rejected === true && isSignificantSweepTarget(sweep))
    .sort((a, b) => (Number(b?.swept_ms) || 0) - (Number(a?.swept_ms) || 0))[0] ?? null;
}

// GXNQ ruling 2026-06-13 (June 10, 10:06): grab without shift is not an MSS.
// The structure shift must CONFIRM after the anchoring sweep — entry-models.md
// MSS: sweep first, THEN the displacement break of the recent higher low.
// Engine rows stamp confirmed_ms; created_ms is the fixture-era fallback.
// No timestamp on either side → fail closed.
function findMssDisplacement(context, side, sweep) {
  const wanted = directionForSide(side);
  const sweptMs = Number(sweep?.swept_ms);
  if (!Number.isFinite(sweptMs)) return null;
  return (context?.pillar3?.failureSwings ?? context?.pillar3?.failure_swings ?? []).find((failureSwing) => {
    if (!wanted.swing.includes(failureSwing?.dir ?? failureSwing?.direction)) return false;
    if (failureSwing?.event != null && failureSwing.event !== 'mss') return false;
    if (failureSwing?.validation != null && failureSwing.validation !== 'sweep') return false;
    if (!isSignificantDisplacedShift(failureSwing)) return false;
    const shiftMs = Number(failureSwing?.confirmed_ms ?? failureSwing?.created_ms);
    return Number.isFinite(shiftMs) && shiftMs > sweptMs;
  });
}

// EM MSS §2: the grab can be "a very clear intra-day swing low," not only a
// named session level. When no session-level rejected sweep exists, anchor the
// MSS on a swept-swing failure_swing (event=mss, validation=sweep) — the same
// row findMssDisplacement consumes — and synthesize the grab from it so the
// downstream sequence (grab → shift) and the dead-premise kill keep working.
function findSwingGrab(context, side) {
  const wanted = directionForSide(side);
  return (context?.pillar3?.failureSwings ?? context?.pillar3?.failure_swings ?? []).find((fs) => {
    if (!wanted.swing.includes(fs?.dir ?? fs?.direction)) return false;
    if (fs?.event != null && fs.event !== 'mss') return false;
    if (fs?.validation != null && fs.validation !== 'sweep') return false;
    if (!isSignificantDisplacedShift(fs)) return false;
    const brokenMs = Number(fs?.broken_swing_ms);
    const shiftMs = Number(fs?.confirmed_ms ?? fs?.created_ms);
    return Number.isFinite(brokenMs) && Number.isFinite(shiftMs) && shiftMs > brokenMs;
  }) ?? null;
}

function findReversalPdArray(context, side) {
  const wanted = directionForSide(side);
  return (context?.pillar3?.pdArrays ?? context?.pillar3?.fvgs ?? []).find((pdArray) => {
    const kind = String(pdArray?.kind ?? pdArray?.type ?? '').toLowerCase();
    const state = String(pdArray?.state ?? 'fresh').toLowerCase();
    return ['fvg', 'bpr'].includes(kind)
      && wanted.pd.includes(rowDirection(pdArray))
      && !['invalidated', 'taken', 'filled'].includes(state);
  });
}

function matchesTrackedPd(walker, row) {
  const rowRef = refOf(row, null);
  return rowRef != null && rowRef === walker?.pdArrayRef;
}

// GXNQ ruling 2026-06-13 (June 11 10:11): the confirmation close belongs to
// the WALKER's zone — another zone's violation row confirmed a tapped MSS
// walker because nothing compared bounds. Bound-less rows (hand-built
// fixtures) keep the legacy behavior.
function confirmationMatchesZone(walker, row) {
  const rTop = Number(row?.zone_top ?? row?.top);
  const rBottom = Number(row?.zone_bottom ?? row?.bottom);
  if (!Number.isFinite(rTop) || !Number.isFinite(rBottom)) return true;
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const top = Number(pd.top);
  const bottom = Number(pd.bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return true;
  const near = (a, b) => Math.abs(a - b) < 0.26;
  return near(rTop, top) && near(rBottom, bottom);
}

export function buildMssWalkerSpawnRequests(context) {
  if (context?.sourceHealth?.status && context.sourceHealth.status !== 'fresh') return [];
  if (context?.pillar1?.status && context.pillar1.status !== 'pass') return [];
  if (context?.pillar2?.status && context.pillar2.status !== 'pass') return [];
  if (!hasCleanDisplacement(context)) return [];

  const requests = [];
  for (const side of ['long', 'short']) {
    let sweep = findRejectedSweep(context, side);
    let displacement = sweep ? findMssDisplacement(context, side, sweep) : null;
    // EM MSS §2 swing-low grab fallback: no session-level sweep but a swept
    // swing shifted structure. Synthesize the grab from that failure_swing.
    if (!sweep) {
      const swingGrab = findSwingGrab(context, side);
      if (swingGrab) {
        displacement = swingGrab;
        sweep = {
          evidenceRef: refOf(swingGrab, `pillar3.failureSwings.${side}.grab`),
          side: directionForSide(side).sweepSide,
          price: Number(swingGrab.level),
          swept_ms: Number(swingGrab.broken_swing_ms),
          rejected: true,
          source: 'swept_swing',
        };
      }
    }
    const pdArray = findReversalPdArray(context, side);
    if (!sweep || !displacement || !pdArray) continue;
    requests.push({
      model: 'MSS',
      side,
      pdArray,
      setupEvidence: {
        sweep: { evidenceRef: refOf(sweep, `pillar3.sweeps.${side}`), rawPayload: sweep },
        displacement: { evidenceRef: refOf(displacement, `pillar3.failureSwings.${side}`), rawPayload: displacement },
      },
    });
  }
  return requests;
}

// EM MSS §4 ("Retrace to Bullish FVG ... without making a new low"): after the
// sweep + MSS the reversal must hold. If price closes back THROUGH the level
// the anchoring sweep grabbed-and-rejected (below it for a long, above for a
// short), the rejection failed and the reversal premise is dead — kill the
// pre-confirmation walker so it cannot confirm later. Close-based on the swept
// LEVEL, not the wick: §2.2 sweeps print long wicks, and a deeper liquidity
// grab is not itself an invalidation; a CLOSE back through the level is.
const MSS_PRE_CONFIRM_STAGES = new Set(['watching', 'pd_identified', 'tap_seen', 'confirmation_pending']);

function lastBarClose(context) {
  const bars = context?.pillar3?.ohlcv1m ?? context?.pillar3?.ohlcv_1m ?? [];
  const last = bars[bars.length - 1];
  const close = Number(last?.close);
  return Number.isFinite(close) ? close : null;
}

export function buildMssWalkerKillRequests(context, walkers = []) {
  const close = lastBarClose(context);
  if (close == null) return [];
  const requests = [];
  for (const walker of walkers) {
    if (walker?.model !== 'MSS' || !MSS_PRE_CONFIRM_STAGES.has(walker?.stage)) continue;
    const sweepPrice = Number(walker?.evidence?.sweep?.rawPayload?.price);
    if (!Number.isFinite(sweepPrice)) continue;
    const dead = walker.side === 'long' ? close < sweepPrice : close > sweepPrice;
    if (!dead) continue;
    requests.push({
      id: walker.id,
      eventTimeUtc: context?.eventTimeUtc,
      stage: 'blocked',
      reason: walker.side === 'long' ? 'mss_premise_invalidated_new_low' : 'mss_premise_invalidated_new_high',
      evidenceRef: refOf(walker?.evidence?.sweep, walker?.pdArrayRef),
    });
  }
  return requests;
}

export function buildMssWalkerAdvanceRequests(context, walkers = []) {
  const requests = [];
  const insidePdArrays = context?.pillar3?.insidePdArrays ?? context?.pillar3?.inside_pd_arrays ?? [];
  const confirmationRows = context?.pillar3?.confirmationRows ?? [];

  for (const walker of walkers) {
    if (!isActiveWalker(walker) || walker.model !== 'MSS') continue;

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

    const confirmed = confirmationRows.find((row) =>
      isValidConfirmationForSide(row, walker.side) && confirmationMatchesZone(walker, row));
    if ((walker.stage === 'tap_seen' || walker.stage === 'confirmation_pending') && confirmed) {
      requests.push({
        id: walker.id,
        eventTimeUtc: context?.eventTimeUtc,
        stage: 'confirmed',
        evidenceRef: refOf(confirmed, 'pillar3.confirmationRows.confirmed'),
        evidenceKey: 'confirmation',
        rawPayload: confirmed,
      });
    }
  }

  return requests;
}

export function runMssWalkerLifecycle({ context, walkers = [] } = {}) {
  const spawned = runWalkerEngine({
    context,
    walkers,
    spawnRequests: buildMssWalkerSpawnRequests(context),
  });

  const pdAdvanceRequests = spawned.events
    .filter((event) => event.type === 'spawn' && event.spawned && event.walker?.model === 'MSS')
    .map((event) => ({
      id: event.walker.id,
      eventTimeUtc: context?.eventTimeUtc,
      stage: 'pd_identified',
      evidenceRef: event.walker.pdArrayRef,
      evidenceKey: 'pdArray',
      rawPayload: event.walker.evidence?.pdArray?.rawPayload ?? null,
    }));

  const pdAdvanced = runWalkerEngine({ context, walkers: spawned.walkers, advanceRequests: pdAdvanceRequests });
  // EM MSS §4: kill dead-premise walkers BEFORE they can tap/confirm this bar.
  const killed = runWalkerEngine({ context, walkers: pdAdvanced.walkers, killRequests: buildMssWalkerKillRequests(context, pdAdvanced.walkers) });
  const lifecycleAdvanceRequests = buildMssWalkerAdvanceRequests(context, killed.walkers);
  const advanced = runWalkerEngine({ context, walkers: killed.walkers, advanceRequests: lifecycleAdvanceRequests });

  return {
    walkers: advanced.walkers,
    events: [...spawned.events, ...pdAdvanced.events, ...killed.events, ...advanced.events],
  };
}
