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

export function isValidConfirmationForSide(row, side) {
  const wanted = directionForSide(side);
  return row?.entry_state === 'confirmed'
    && isTruthyFlag(row?.confirm_close)
    && isTruthyFlag(row?.ce_held)
    && isFalseFlag(row?.chop_15m)
    && wanted.confirm.includes(row?.confirm_dir ?? row?.direction ?? row?.dir);
}

export function matchesTrackedPd(walker, row) {
  const rowRef = refOf(row, null);
  return rowRef != null && rowRef === walker?.pdArrayRef;
}

// A confirmation/inversion stamp is fresh if it falls within the current bar's
// window WIDENED by a small lookback. The old strict single-bar window
// (stamp ∈ [last_bar.time, +60s]) never matched LIVE: the engine surfaces the
// confirm/flip 1-2 captures after the triggering bar AND live's last_bar is the
// FORMING bar, so the stamp always sat 1-2 bars below the window (live fired 0
// confirmations; the backtest, which captures each bar synchronously, fired).
// The lookback absorbs that capture lag while still rejecting a genuinely-stale
// stamp — a flip/confirm from many bars ago is not THIS bar's entry (GXNQ June
// ruling: "the entry is the inverting candle," not a later retest). Anchored to
// the current bar (last_bar.time), so it can't drift with the walker's tap. No
// stamp / no bar identity -> legacy true (hand-built fixtures keep their
// close-through behavior). The tap-confirmation timeout bounds the wait.
export const CONFIRMATION_LOOKBACK_MS = 3 * 60_000; // ~3 bars; covers the 1-2 bar surfacing lag
export function stampWithinConfirmationWindow(stampMs, lastBarTimeSec) {
  const ms = Number(stampMs);
  if (!Number.isFinite(ms) || ms <= 0) return true;
  const barMs = Number(lastBarTimeSec) * 1000;
  if (!Number.isFinite(barMs) || barMs <= 0) return true;
  return ms >= barMs - CONFIRMATION_LOOKBACK_MS && ms <= barMs + 60_000;
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
