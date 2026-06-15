// cli/lib/scale-in-rules.js
// Pure scale-in detection rules — the single source of truth for live and
// (eventually) the backtest. Ported verbatim from app/main/backtest-engine.js
// (do NOT edit that file). Numbers match the 2026-06-13 user rulings.
export const SCALE_IN_MAX = 5;                  // up to 5 concurrent adds
export const DEDUP_WINDOW_MS = 10 * 60 * 1000;  // same-side 10-min dedup
export const SCALE_IN_STOP_STREAK = 2;          // 2 add stop-outs in a row → adds off

// Anchor is "green-lit" once price has travelled >=50% from entry to TP1.
export function greenLightReached(anchor, price) {
  const e = Number(anchor?.entry), t = Number(anchor?.tp1), p = Number(price);
  if (![e, t, p].every(Number.isFinite) || e === t) return false;
  const half = anchor.side === "long" ? e + 0.5 * (t - e) : e - 0.5 * (e - t);
  return anchor.side === "long" ? p >= half : p <= half;
}

// Same SIDE within the window of an already-taken position = "basically the
// same trade" — collapse to the first.
export function isNearDuplicate(setup, takenLog) {
  const ms = Date.parse(setup?.event_ts);
  if (!Number.isFinite(ms)) return false;
  return (takenLog || []).some((t) => t.side === setup.side && ms - t.ms < DEDUP_WINDOW_MS && ms - t.ms >= 0);
}

export function canScaleInto({ anchor, setup, openCount, takenLog, maxAdds = SCALE_IN_MAX }) {
  if (!anchor?.greenLight) return false;
  if (openCount >= 1 + maxAdds) return false;
  if (setup.side !== anchor.side) return false;
  return !isNearDuplicate(setup, takenLog);
}

// 2-add-stops-in-a-row breaker. Only add tranche outcomes count; a winning
// add (TP1/TP2) resets. Anchor outcomes never count.
export function addsDisabledFromOutcomes(events) {
  const adds = (events || [])
    .filter((e) => e.type === "outcome" && e.tranche_role === "add" &&
      ["STOPPED", "TP1_HIT", "TP2_HIT"].includes(e.status))
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  let streak = 0;
  for (const e of adds) streak = e.status === "STOPPED" ? streak + 1 : 0;
  return streak >= SCALE_IN_STOP_STREAK;
}
