import { runWalkerEngine } from './walker-engine.js';
import { isActiveWalker } from './walker-state.js';

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

function isFalseFlag(value) {
  return value === false || value === 0 || value === '0' || value === 'false';
}

function hasCleanDisplacement(context) {
  const displacement = context?.pillar2?.displacement ?? context?.pillar2?.current_tf?.displacement;
  return displacement === 'clean' || displacement === 'acceptable';
}

// The MOST RECENT rejected sweep of opposing liquidity anchors the model —
// the shift must follow the latest grab, not any grab on record (June 10
// 10:06: NYPM.H from the prior afternoon + an overnight bear MSS would have
// paired under an any-sweep rule).
function findRejectedSweep(context, side) {
  const wanted = directionForSide(side);
  return (context?.pillar3?.sweeps ?? context?.pillar1?.sweeps ?? [])
    .filter((sweep) => sweep?.side === wanted.sweepSide && sweep?.rejected === true)
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
    const shiftMs = Number(failureSwing?.confirmed_ms ?? failureSwing?.created_ms);
    return Number.isFinite(shiftMs) && shiftMs > sweptMs;
  });
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

function isValidConfirmationForSide(row, side) {
  const wanted = directionForSide(side);
  return row?.entry_state === 'confirmed'
    && isTruthyFlag(row?.confirm_close)
    && isTruthyFlag(row?.ce_held)
    && isFalseFlag(row?.chop_15m)
    && wanted.confirm.includes(row?.confirm_dir ?? row?.direction ?? row?.dir);
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
    const sweep = findRejectedSweep(context, side);
    const displacement = findMssDisplacement(context, side, sweep);
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
  const lifecycleAdvanceRequests = buildMssWalkerAdvanceRequests(context, pdAdvanced.walkers);
  const advanced = runWalkerEngine({ context, walkers: pdAdvanced.walkers, advanceRequests: lifecycleAdvanceRequests });

  return {
    walkers: advanced.walkers,
    events: [...spawned.events, ...pdAdvanced.events, ...advanced.events],
  };
}
