// cli/lib/lanto-significance.js
// The ONE significance definition (rubric §6, docs/strategy/lanto-prep-rubric.md).
// Both lanes consume this — the brief grade/draw AND the digest ranking — so the
// grade can only ever anchor on an array Lanto would actually mark.
//
// An array is significant only if ALL of: displacive AND it took liquidity AND
// it is near price AND it is not a `tiny` zone — UNLESS it is exceptionally
// displacive AND it took MAJOR liquidity (the only carve-out for a tiny zone).
// Grounded in: How I Develop Daily Bias 00:56 / 04:42 / 06:33 (displacive + took
// liquidity + near + aggressive/large, not tiny) and Entry Models 05:38 / 06:35.
//
// Pure. Returns { significant, reasons } — `reasons` lists every failed gate so
// the caller can surface an honest no_trade_reason. Tunable thresholds below.

const DISP_MIN = 0.5; // displacive: disp_score floor (clean/acceptable)
const STRONG_DISP = 0.85; // "exceptionally displacive" for the tiny carve-out
const NEAR_ATR = 2.0; // near price: within NEAR_ATR × ATR of current price

export function isSignificantArray(array = {}, { price, atr } = {}) {
  const reasons = [];
  const disp = Number(array?.disp_score);
  const tookLiq = array?.took_liq === true;
  const sizeTiny = String(array?.size_quality) === "tiny";

  if (!(disp >= DISP_MIN)) reasons.push("weak_displacement");
  if (!tookLiq) reasons.push("no_liquidity");

  // Near price. Prefer the engine's signed distance_to_ce; else derive from the
  // zone's CE (or midpoint) vs price. Fail-open when ATR is unreadable — never
  // reject on `far` without a usable scale.
  let distance = Number(array?.distance_to_ce);
  if (!Number.isFinite(distance)) {
    const ce = Number.isFinite(Number(array?.ce))
      ? Number(array.ce)
      : (Number(array?.top) + Number(array?.bottom)) / 2;
    distance = Math.abs(Number(price) - ce);
  } else {
    distance = Math.abs(distance);
  }
  const atrN = Number(atr);
  if (Number.isFinite(atrN) && atrN > 0 && Number.isFinite(distance)) {
    if (distance > NEAR_ATR * atrN) reasons.push("far");
  }

  // Tiny gate, with the exceptional carve-out (very-high displacement AND it took
  // MAJOR liquidity — a session/external level, flagged by the caller).
  if (sizeTiny) {
    const exceptional = disp >= STRONG_DISP && array?.took_major_liq === true;
    if (!exceptional) reasons.push("tiny");
  }

  return { significant: reasons.length === 0, reasons };
}

export const __thresholds = { DISP_MIN, STRONG_DISP, NEAR_ATR };
