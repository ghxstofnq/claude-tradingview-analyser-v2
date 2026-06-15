// Extract HTF (1H/4H) draw targets from engine_by_tf: unswept swing highs/lows
// + opposing-FVG fills (bearish gaps above for a long / bullish gaps below for
// a short), each gap expanded to near/CE/far candidate prices. Pure; the packet
// builder filters by entry side and picks the edge by R:R. Strategy §2.1
// ("HTF = FVGs + buy/sell-side liquidity"; a large 4H FVG/BPR is the draw) +
// §7 Step 7 (TP2 toward the HTF draw).
//
// Field shapes (verified against a live engine_by_tf bundle):
//   swings[]: { price, is_high, swept, kind(HH/HL/LH/LL), tier }
//   fvgs[]:   { top, bottom, ce, dir(bull|bear), state(fresh|invalidated|inverted|filled) }
// Only `state === 'fresh'` FVGs are unfilled draws; everything else has been
// filled / negated / flipped and holds no clean opposing target.
const HTF_TFS = ["h1", "h4"];

// Expand one FVG into its three target edges for the approaching side. For a
// long approaching a bearish gap ABOVE, price reaches the near edge (bottom)
// first and the far edge (top) on a full fill; CE is the midpoint. Mirror for
// a short approaching a bullish gap BELOW (near = top, far = bottom).
export function fvgEdges(fvg, side) {
  const top = Number(fvg?.top);
  const bottom = Number(fvg?.bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return [];
  const ce = Number.isFinite(Number(fvg?.ce)) ? Number(fvg.ce) : (top + bottom) / 2;
  const near = side === "above" ? bottom : top;
  const far = side === "above" ? top : bottom;
  const zone = `${bottom}-${top}`;
  return [
    { edge: "near", price: near },
    { edge: "ce", price: ce },
    { edge: "far", price: far },
  ].map((e) => ({ ...e, source: "fvg_fill", zone }));
}

export function extractHtfTargets(engineByTf = {}, { price } = {}) {
  const above = [];
  const below = [];
  if (!engineByTf || !Number.isFinite(price)) return { above, below };
  for (const tf of HTF_TFS) {
    const eng = engineByTf[tf] ?? {};
    for (const s of eng.swings ?? []) {
      if (s?.swept === true) continue;
      const lvl = Number(s?.price);
      if (!Number.isFinite(lvl)) continue;
      const cite = `engine_by_tf.${tf}.swings`;
      if (s.is_high === true && lvl > price) {
        above.push({ price: lvl, source: "htf_swing", tf, name: `${tf}_${s.kind ?? "swing"}_high`, cite });
      } else if (s.is_high === false && lvl < price) {
        below.push({ price: lvl, source: "htf_swing", tf, name: `${tf}_${s.kind ?? "swing"}_low`, cite });
      }
    }
    for (const f of eng.fvgs ?? []) {
      if (String(f?.state ?? "") !== "fresh") continue;       // unfilled draws only
      const dir = String(f?.dir ?? "");
      const cite = `engine_by_tf.${tf}.fvgs`;
      // Opposing gap above for a long = bearish; below for a short = bullish.
      if (dir === "bear" && Number(f.bottom) > price) {
        for (const e of fvgEdges(f, "above")) above.push({ ...e, tf, name: `${tf}_bear_fvg`, cite });
      } else if (dir === "bull" && Number(f.top) < price) {
        for (const e of fvgEdges(f, "below")) below.push({ ...e, tf, name: `${tf}_bull_fvg`, cite });
      }
    }
  }
  return { above, below };
}
