// cli/lib/lanto-draw.js
// Draw selector (rubric §5 + §7, docs/strategy/lanto-prep-rubric.md).
//
// The draw is WHERE PRICE IS BEING PULLED TO — the nearest SIGNIFICANT, UNTAKEN,
// CITED liquidity target in the bias direction (Daily Bias 03:45 / 17:46). It is
// distinct from the vote: a level/array is the draw; an array + its reaction is a
// vote. Cite-or-reject (constraint #6): no resolvable cite → ineligible (this is
// what the 2026-06-24 MES `primary_draw.cite: null` violated).
//
// Input is a NORMALIZED candidate list the caller builds from the digest:
//   { kind: "level"|"array", name, price, cite, dir?, ...arrayFields }
// Levels are significant-by-type (the caller passes only untaken session/PD/
// overnight pools); arrays must clear the significance gate. Pure.

import { isSignificantArray, __thresholds } from "./lanto-significance.js";

const hasCite = (c) => typeof c === "string" && c.trim() !== "";

export function selectDraw(candidates = [], { price, atr, direction = null } = {}) {
  const p = Number(price);
  const atrN = Number(atr);
  const near = Number.isFinite(atrN) && atrN > 0 ? __thresholds.NEAR_ATR * atrN : Infinity;

  const eligible = [];
  for (const c of candidates || []) {
    if (!hasCite(c?.cite)) continue; // cite-or-reject
    const cp = Number(c?.price);
    if (!Number.isFinite(cp)) continue;
    const distance = Math.abs(cp - p);

    // Direction: a bull draw sits above price, a bear draw below.
    if (direction === "bull" && !(cp > p)) continue;
    if (direction === "bear" && !(cp < p)) continue;

    if (c.kind === "array") {
      if (!isSignificantArray(c, { price: p, atr: atrN }).significant) continue;
    } else {
      // level — significant-by-type, but still must be near price
      if (distance > near) continue;
    }
    eligible.push({ ...c, distance });
  }

  if (eligible.length === 0) return null;
  eligible.sort((a, b) => a.distance - b.distance);
  return eligible[0];
}
