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
