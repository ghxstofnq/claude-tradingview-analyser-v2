import { isActiveWalker } from './walker-state.js';

export function directionForSide(side) {
  if (side === 'long') return { pd: ['bull', 'bullish'], opposingPd: ['bear', 'bearish'], confirm: ['bull', 'bullish'] };
  if (side === 'short') return { pd: ['bear', 'bearish'], opposingPd: ['bull', 'bullish'], confirm: ['bear', 'bearish'] };
  return { pd: [], opposingPd: [], confirm: [] };
}

export function oppositeSideForPdDirection(row) {
  const direction = rowDirection(row);
  if (['bear', 'bearish'].includes(direction)) return 'long';
  if (['bull', 'bullish'].includes(direction)) return 'short';
  return null;
}

export function sideForPdDirection(row) {
  const direction = rowDirection(row);
  if (['bull', 'bullish'].includes(direction)) return 'long';
  if (['bear', 'bearish'].includes(direction)) return 'short';
  return null;
}

export function refOf(item, fallback = null) {
  if (typeof item?.evidenceRef === 'string' && item.evidenceRef.trim()) return item.evidenceRef;
  if (typeof item?.cite === 'string' && item.cite.trim()) return item.cite;
  if (typeof item?.id === 'string' && item.id.trim()) return item.id;
  return fallback;
}

export function rowDirection(row) {
  return row?.direction ?? row?.dir ?? 'unknown';
}

export function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function isFalseFlag(value) {
  return value === false || value === 0 || value === '0' || value === 'false';
}

export function hasCleanDisplacement(context) {
  const displacement = context?.pillar2?.displacement ?? context?.pillar2?.current_tf?.displacement;
  return displacement === 'clean' || displacement === 'acceptable';
}

// Continuation = the entry RIDES the current leg (leg direction matches the
// trade side); a counter-leg entry is a Reversal. Leg direction = the engine's
// most-recent leg extreme (leg_high_ms vs leg_low_ms) — the same stamps
// execution-packet.classifySetupModel reads. Fail CLOSED (false) when the
// stamps are unreadable: the Trend reclaim subtype must not spawn without leg
// evidence, and it keeps the verified Reversal inversions (02-09/06-09, whose
// leg runs counter to the trade) out of the continuation path entirely.
export function isContinuationSetup(context, side) {
  const lhMs = Number(context?.pillar2?.legHighMs);
  const llMs = Number(context?.pillar2?.legLowMs);
  if (!Number.isFinite(lhMs) || !Number.isFinite(llMs) || lhMs === llMs) return false;
  const legUp = lhMs > llMs;
  return (side === 'long' && legUp) || (side === 'short' && !legUp);
}

export function kindOf(row) {
  return String(row?.kind ?? row?.type ?? '').toLowerCase();
}

export function stateIsTradable(row) {
  const state = String(row?.state ?? 'fresh').toLowerCase();
  return !['invalidated', 'taken', 'filled'].includes(state);
}

export function allPdArrays(context) {
  return context?.pillar3?.pdArrays ?? context?.pillar3?.fvgs ?? [];
}

// Confirmation §: "it always has to be deliberate. If I see a wick, if I see
// sloppy delivery, I do not take" (TRADE24 09:02); a strong body, minimal wicks
// (PRICE 19:55). body_ratio >= 0.6 = the §3 "good body" (the same bar Lanto would
// take, not a doji/wicky close) — already the bar on the Trend wick-tap path.
export const CONFIRM_BODY_MIN = 0.6;

// Filter-only-when-present: real confirmation rows carry last_bar.body_ratio
// (cli/lib/last-bar.js); field-less hand-built rows keep the legacy behavior.
export function hasDeliberateBody(row) {
  const body = Number(row?.last_bar?.body_ratio ?? row?.body_ratio);
  if (!Number.isFinite(body)) return true;
  return body >= CONFIRM_BODY_MIN;
}

// `requireBody` gates the deliberate-body discipline. ON for the FVG-RETRACE
// confirmation (MSS / Trend: "a candle closes back above/below the zone,
// respecting it — that respect is the confirmation", confirmation.md). OFF for
// the inversion VIOLATION close, which is judged by closing THROUGH the opposing
// FVG with displacement (its own `fullCloseThrough` gate) — a violating candle
// legitimately carries a wick (it spikes through and closes through), so a body
// ratio is the wrong measure there (confirmation.md per-model breakdown).
export function isValidConfirmationForSide(row, side, { requireBody = true } = {}) {
  const wanted = directionForSide(side);
  return row?.entry_state === 'confirmed'
    && isTruthyFlag(row?.confirm_close)
    && isTruthyFlag(row?.ce_held)
    && isFalseFlag(row?.chop_15m)
    && (!requireBody || hasDeliberateBody(row))
    && wanted.confirm.includes(row?.confirm_dir ?? row?.direction ?? row?.dir);
}

export function matchesTrackedPd(walker, row) {
  const rowRef = refOf(row, null);
  return rowRef != null && rowRef === walker?.pdArrayRef;
}

export function activeModelWalkers(walkers, model) {
  return walkers.filter((walker) => isActiveWalker(walker) && walker.model === model);
}

export function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function rowTop(row) {
  return numberOrNull(row?.top ?? row?.high);
}

export function rowBottom(row) {
  return numberOrNull(row?.bottom ?? row?.low);
}

// FVG-retrace confirmation from the bar itself (shared by Trend continuation
// and MSS reversal — both enter on "a quick tap and then a full-body candle
// closes away from the zone", entry-models.md). The strategy's tap is WICK-
// based (verified 2026-05-18) but the engine's entry-state tracker is close-
// based, so a candle that wicks into a held FVG and closes away with a good
// body is never stamped (June 9 trade 7: a 6.75pt wick, 0.68 body, no engine
// confirm). Derived deterministically from the confirmation bar instead.
export function wickTapConfirm(walker, context) {
  const bar = (context?.pillar3?.confirmationRows ?? [])
    .map((row) => row?.last_bar)
    .find((b) => b && Number.isFinite(Number(b.close)));
  if (!bar) return null;
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const top = Number(pd.top);
  const bottom = Number(pd.bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  // The zone must still be ALIVE as an in-direction fvg right now — the walker
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
  // (GXNQ June 9 re-grade: the 0.51-body 11:01 candle was NOT the entry; the
  // 0.89-body 11:04 candle was).
  const body = Number(bar.body_ratio);
  if (!Number.isFinite(body) || body < CONFIRM_BODY_MIN) return null;
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
