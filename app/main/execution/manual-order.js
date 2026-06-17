// app/main/execution/manual-order.js
// Pure logic for the ORDERS manual ticket. No IO. Gathers structural stop
// candidates + untaken draws from a tv analyze bundle's engine gates, then
// computes the auto-stop, the TP draw list, sizing (sizing-core), and R:R.
import { sizeFromStop, tickSize } from "./sizing-core.js";

export const STOP_BUFFER_TICKS = 2; // place the stop this many ticks beyond the level
const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const isLong = (side) => side === "buy" || side === "long";
function roundToTick(v, tick) { const t = tick || 0.25; return Math.round(v / t) * t; }
// A long's stop sits below a swing/leg/session LOW; a short's above a HIGH
// (entry-models.md stop placement). Generic session levels (no H/L suffix) are
// eligible either side. This is why a short's auto stop is a swing HIGH, not
// just the nearest structure above price (which could be a low sitting above).
const isHighKind = (k) => String(k || "").endsWith("_high");
const isLowKind = (k) => String(k || "").endsWith("_low");
const stopKindOk = (k, long) => (long ? isLowKind(k) : isHighKind(k)) || k === "session_level";

export function structuralStopCandidates(bundle) {
  const eng = bundle?.gates?.engine;
  if (!eng) return [];
  const out = [];
  const swings = eng.pillar3?.swings ?? {};
  for (const tier of ["swing", "internal"]) {
    const arr = swings[tier] ?? [];
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i]; const price = num(s?.price);
      if (price == null) continue;
      out.push({ kind: s.is_high ? "swing_high" : "swing_low", price, name: s.is_high ? "swing high" : "swing low", swept: s.swept === true, ref: `gates.engine.pillar3.swings.${tier}[${i}]` });
    }
  }
  const levels = eng.pillar1?.session_levels ?? {};
  for (const [key, lv] of Object.entries(levels)) {
    const price = num(lv?.price); if (price == null) continue;
    const name = String(lv?.name ?? key);
    out.push({ kind: name.endsWith("H") ? "session_level_high" : name.endsWith("L") ? "session_level_low" : "session_level", price, name, swept: lv?.swept === true, ref: `gates.engine.pillar1.session_levels.${key}` });
  }
  const q = eng.pillar2?.current_tf ?? {};
  if (num(q.leg_high) != null) out.push({ kind: "leg_high", price: num(q.leg_high), name: "leg high", ref: "gates.engine.pillar2.current_tf.leg_high" });
  if (num(q.leg_low) != null) out.push({ kind: "leg_low", price: num(q.leg_low), name: "leg low", ref: "gates.engine.pillar2.current_tf.leg_low" });
  return out;
}

export function untakenDraws(bundle) {
  const p1 = bundle?.gates?.engine?.pillar1 ?? {};
  const above = [], below = [];
  const pushUniq = (arr, item) => { if (item.price != null && !arr.some((x) => x.price === item.price)) arr.push(item); };
  (p1.untaken_buy_side_above ?? []).forEach((l, i) => pushUniq(above, { name: String(l?.name ?? "level"), price: num(l?.price), kind: "session_level", ref: `gates.engine.pillar1.untaken_buy_side_above[${i}]` }));
  (p1.untaken_pools_above ?? []).forEach((p, i) => pushUniq(above, { name: "EQH pool", price: num(p?.price), kind: "pool", ref: `gates.engine.pillar1.untaken_pools_above[${i}]` }));
  (p1.untaken_sell_side_below ?? []).forEach((l, i) => pushUniq(below, { name: String(l?.name ?? "level"), price: num(l?.price), kind: "session_level", ref: `gates.engine.pillar1.untaken_sell_side_below[${i}]` }));
  (p1.untaken_pools_below ?? []).forEach((p, i) => pushUniq(below, { name: "EQL pool", price: num(p?.price), kind: "pool", ref: `gates.engine.pillar1.untaken_pools_below[${i}]` }));
  above.sort((a, b) => a.price - b.price);
  below.sort((a, b) => b.price - a.price);
  return { above, below };
}

// structural levels on the stop side (below for long, above for short),
// nearest-first, each with the buffered stopPrice the picker would use.
export function stopSideOptions({ side, entry, candidates, symbol }) {
  const e = num(entry); if (e == null || !Array.isArray(candidates)) return [];
  const tick = tickSize(symbol); const buf = STOP_BUFFER_TICKS * tick; const long = isLong(side);
  const beyond = candidates.filter((c) => stopKindOk(c.kind, long) && (long ? c.price < e : c.price > e));
  beyond.sort((a, b) => (long ? b.price - a.price : a.price - b.price));
  return beyond.map((c) => ({ kind: c.kind, name: c.name, levelPrice: c.price, stopPrice: roundToTick(long ? c.price - buf : c.price + buf, tick), ref: c.ref }));
}

export function pickAutoStop({ side, entry, candidates, symbol }) {
  const opts = stopSideOptions({ side, entry, candidates, symbol });
  if (!opts.length) return null;
  const o = opts[0];
  return { price: o.stopPrice, levelPrice: o.levelPrice, kind: o.kind, name: o.name, ref: o.ref };
}

export function tpDrawsForSide({ side, entry, draws }) {
  const e = num(entry); if (e == null || !draws) return [];
  return isLong(side) ? (draws.above ?? []).filter((d) => d.price > e) : (draws.below ?? []).filter((d) => d.price < e);
}

export function rr({ side, entry, stop, tp }) {
  const e = num(entry), s = num(stop), t = num(tp);
  if (e == null || s == null || t == null) return null;
  const risk = Math.abs(e - s); if (!(risk > 0)) return null;
  return Math.round((Math.abs(t - e) / risk) * 10) / 10;
}

export function buildOrderPreview({ side, entry, symbol, candidates, draws, typedStop, typedTp, riskUsd, maxRiskUsd }) {
  const e = num(entry); const long = isLong(side);
  const auto = pickAutoStop({ side, entry: e, candidates, symbol });
  const typed = num(typedStop);
  const stop = typed != null ? typed : (auto?.price ?? null);
  const stopSource = typed != null ? "typed" : (auto ? auto.kind : null);
  const stopOptions = stopSideOptions({ side, entry: e, candidates, symbol });
  const tp = num(typedTp);
  const tpDraws = tpDrawsForSide({ side, entry: e, draws }).map((d) => ({ ...d, rr: rr({ side, entry: e, stop, tp: d.price }) }));

  let block = null;
  if (e == null) block = "no_price";
  else if (stop == null) block = "no_stop";
  else if (long ? stop >= e : stop <= e) block = "stop_wrong_side";

  let sizing = { contracts: 0, stopPts: 0, actualRiskUsd: 0, withinTolerance: false };
  if (!block) {
    sizing = sizeFromStop({ symbol, entry: e, stop, riskUsd });
    const cap = num(maxRiskUsd);
    // With a cap known (production), allow a rounded-down off-target size and
    // block only when it can't be sized or busts the cap. Without a cap (unit
    // tests / callers that don't pass one) keep the conservative tolerance block.
    if (sizing.contracts < 1) block = "no_size";
    else if (cap != null) { if (sizing.actualRiskUsd > cap) block = "over_max"; }
    else if (!sizing.withinTolerance) block = "no_size";
  }

  return {
    symbol, side, entry: e,
    stop, stopSource, stopAuto: auto, stopOptions,
    tp: tp ?? null, tpDraws,
    riskUsd: num(riskUsd),
    contracts: sizing.contracts, stopPts: sizing.stopPts, actualRiskUsd: sizing.actualRiskUsd, withinTolerance: sizing.withinTolerance,
    rr: rr({ side, entry: e, stop, tp }),
    block,
  };
}
