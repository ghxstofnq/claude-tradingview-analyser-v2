// Per-instrument psychological round-level grid. NQ family steps 50/100; ES
// family 5/10 (≈1/10th, scaling with price). Uncalibrated symbols → null
// (mirrors pillar2-thresholds' "don't guess" posture). These are the targets
// in price discovery — at/near/above all-time highs, where there is no
// overhead swing/level/FVG liquidity left to aim at. User ruling 2026-06-15
// (the strategy docs are silent on price discovery — see the design spec).
const GRIDS = {
  "MNQ1!": { minor: 50, major: 100 },
  "NQ1!": { minor: 50, major: 100 },
  "MES1!": { minor: 5, major: 10 },
  "ES1!": { minor: 5, major: 10 },
};

export function psychGridFor(symbol) {
  return GRIDS[String(symbol ?? "").toUpperCase()] ?? null;
}

// A level that lands on the major grid (100 / 10) is the stronger draw and
// feeds TP2; the in-between minor levels (50 / 5) feed TP1.
function tag(price, grid) {
  return { price, source: "psych", grid: price % grid.major === 0 ? "major" : "minor" };
}

export function psychLevelsAbove(symbol, price, count = 4) {
  const grid = psychGridFor(symbol);
  if (!grid || !Number.isFinite(price)) return [];
  const out = [];
  let lvl = Math.floor(price / grid.minor) * grid.minor;
  while (out.length < count) {
    lvl += grid.minor;
    if (lvl > price) out.push(tag(lvl, grid));
  }
  return out;
}

export function psychLevelsBelow(symbol, price, count = 4) {
  const grid = psychGridFor(symbol);
  if (!grid || !Number.isFinite(price)) return [];
  const out = [];
  let lvl = Math.ceil(price / grid.minor) * grid.minor;
  while (out.length < count) {
    lvl -= grid.minor;
    if (lvl < price) out.push(tag(lvl, grid));
  }
  return out;
}
