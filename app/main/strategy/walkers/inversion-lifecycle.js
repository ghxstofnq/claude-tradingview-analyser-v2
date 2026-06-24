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
function invertedOnThisBar(context, walker, row) {
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
  const barMs = Number(row?.last_bar?.time) * 1000;
  if (!Number.isFinite(barMs)) return true; // no bar identity → legacy
  return invMs >= barMs && invMs < barMs + 60_000;
}

// Stage-G deterministic inversion gate (web ICT iFVG + transcript ENTRY 08:26/11:15
// + 5-tape calibration, 2026-06-23). Classify the entry by DEPTH-IN-LEG (leg_high/
// leg_low — already emitted, no Pine change), then require the right context:
//   REVERSAL (deep >= INV_DEPTH): a RECENT (<= INV_GRAB_RECENCY min) session-tier
//     (AS/NYAM/LO) OPPOSING-side grab must precede the inversion — ICT "sweep THEN
//     iFVG" / Lanto "major liquidity taken first" (ENTRY 08:26). Blocks the pre-grab
//     shorts (06-09 09:34/09:39 on a stale overnight sweep; 06-17 chop) while keeping
//     the real reversal (06-09 10:27, 02-09 10:40).
//   CONTINUATION (shallow < INV_DEPTH): a swing-tier structure break in the trade
//     direction — an established trend (ENTRY 11:15 "clear strong trend"). Keeps the
//     06-16/06-18 retraces.
// Fail-open when the leg extremes are unreadable (cannot classify -> do not block).
// Off via GOFNQ_INV_GATE=0. Depth/recency tunable via GOFNQ_INV_DEPTH / _GRAB_RECENCY.
const SESSION_HIGH_RE = /^(AS|NYAM|LO)\.H$/;
const SESSION_LOW_RE = /^(AS|NYAM|LO)\.L$/;
function invDepth() { const v = Number(process.env.GOFNQ_INV_DEPTH); return v > 0 && v < 1 ? v : 0.5; }
function invGrabRecencyMin() { const v = Number(process.env.GOFNQ_INV_GRAB_RECENCY); return v > 0 ? v : 90; }
function invCoherenceMin() { const v = Number(process.env.GOFNQ_INV_COHERENCE); return v >= 0 && v <= 1 ? v : 0.4; }
function confirmedCloseOf(row) {
  return Number(row?.close ?? row?.price ?? row?.confirm_close_price ?? row?.last_bar?.close);
}
function confirmedBarMs(row, context) {
  const t = Date.parse(context?.eventTimeUtc);
  if (Number.isFinite(t)) return t;
  const sec = Number(row?.last_bar?.time ?? row?.timeMs);
  if (Number.isFinite(sec)) return sec > 1e12 ? sec : sec * 1000; // sec or ms
  return Number(row?.confirm_ms) || NaN;
}

export function inversionEntryValid({ context, side, entryPrice, nowMs } = {}) {
  if (process.env.GOFNQ_INV_GATE === '0') return { valid: true, kind: 'disabled', reason: null };
  const p2 = context?.pillar2 ?? {};
  const legHigh = Number(p2.legHigh);
  const legLow = Number(p2.legLow);
  const entry = Number(entryPrice);
  const range = legHigh - legLow;
  if (!Number.isFinite(range) || range <= 0 || !Number.isFinite(entry)) {
    return { valid: true, kind: 'unclassified', reason: null };
  }
  // Fail-open for minimal/hand-built fixtures with no liquidity OR structure
  // evidence — the gate needs real engine context to judge; absent it, don't
  // block (mirrors the lifecycle's bound-less-fixture fallbacks). Real sessions
  // always carry sweeps + swing structure, so this never opens a live gate.
  const hasContext = (context?.pillar3?.sweeps?.length ?? 0) > 0
    || (context?.pillar3?.structuresSwing?.length ?? 0) > 0;
  if (!hasContext) return { valid: true, kind: 'no_context', reason: null };
  const depth = side === 'short' ? (legHigh - entry) / range : (entry - legLow) / range;
  if (depth >= invDepth()) {
    const re = side === 'short' ? SESSION_HIGH_RE : SESSION_LOW_RE;
    const wantSide = side === 'short' ? 'buy' : 'sell';
    const t = Number(nowMs);
    const grab = (context?.pillar3?.sweeps ?? []).some((s) => {
      if (s?.side !== wantSide || !re.test(String(s?.target ?? ''))) return false;
      const ms = Number(s?.swept_ms);
      return Number.isFinite(ms) && Number.isFinite(t) && ms <= t && (t - ms) / 60000 <= invGrabRecencyMin();
    });
    return { valid: grab, kind: 'reversal', reason: grab ? null : 'reversal_no_recent_grab', depth };
  }
  const dir = side === 'short' ? 'bear' : 'bull';
  const swing = (context?.pillar3?.structuresSwing ?? []).some((s) =>
    String(s?.dir ?? s?.direction ?? '').startsWith(dir) && (s?.event === 'mss' || s?.event === 'bos'));
  if (!swing) return { valid: false, kind: 'continuation', reason: 'continuation_no_swing_trend', depth };
  // Chop veto (Stage-G G3): a continuation needs a CLEAN trend, not two-sided
  // chop. m15 directional coherence < INV_COHERENCE_MIN = chop -> stand aside
  // (06-17 no-trade: coherence 0.03-0.3). Null (no m15 bars) -> fail-open.
  // NB: coherence may be null; Number(null)===0 would falsely read as chop, so
  // guard the null BEFORE coercing.
  const cohRaw = context?.pillar2?.coherence;
  const coh = cohRaw == null ? NaN : Number(cohRaw);
  if (Number.isFinite(coh) && coh < invCoherenceMin()) {
    return { valid: false, kind: 'continuation', reason: 'chop_low_coherence', depth, coherence: coh };
  }
  return { valid: true, kind: 'continuation', reason: null, depth, coherence: Number.isFinite(coh) ? coh : null };
}

export function buildInversionWalkerAdvanceRequests(context, walkers = []) {
  const requests = [];
  const confirmationRows = context?.pillar3?.confirmationRows ?? [];

  for (const walker of activeModelWalkers(walkers, 'Inversion')) {
    const confirmed = confirmationRows.find((row) => isValidConfirmationForSide(row, walker.side, { requireBody: false })
      && fullCloseThrough(row, walker)
      && invertedOnThisBar(context, walker, row));
    // Stage-G deterministic gate: an inversion only confirms when its entry has the
    // right context for its depth class (reversal=recent grab / continuation=trend).
    const gate = confirmed
      ? inversionEntryValid({ context, side: walker.side, entryPrice: confirmedCloseOf(confirmed), nowMs: confirmedBarMs(confirmed, context) })
      : { valid: false };
    if ((walker.stage === 'watching' || walker.stage === 'pd_identified' || walker.stage === 'tap_seen' || walker.stage === 'confirmation_pending') && confirmed && gate.valid) {
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
