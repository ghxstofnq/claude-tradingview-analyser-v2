// app/main/execution/manual-order.js
// Pure logic for the ORDERS manual ticket. No IO. Gathers structural stop
// candidates + untaken draws from a tv analyze bundle's engine gates, then
// computes the auto-stop, the TP draw list, sizing (sizing-core), and R:R.
import { bufferedStopPrice, sizeFromStop, STOP_BUFFER_TICKS, roundToTick, tickSize } from "./sizing-core.js";

const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const isLong = (side) => side === "buy" || side === "long";
// A long's stop sits below a swing/leg/session LOW; a short's above a HIGH
// (entry-models.md stop placement). Generic session levels (no H/L suffix) are
// eligible either side. This is why a short's auto stop is a swing HIGH, not
// just the nearest structure above price (which could be a low sitting above).

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

// FVG candle stop anchors (manual BUY/SELL ticket, plan 2026-07-10). Each
// alive FVG yields two anchors from its forming candles (V3+ emit: c1 oldest,
// c2 displacement): a long stops below the bull FVG's candle lows, a short
// above the bear FVG's candle highs. "1/3 FVG" = first candle (default,
// wider), "2/3 FVG" = displacement candle (tighter). Dead zones
// (filled/inverted/invalidated) are spent — no stop protection there. Candle
// fields are NaN on zones formed before the V5 reload — those anchors are
// dropped, never guessed.
const DEAD_FVG_STATES = new Set(["filled", "inverted", "invalidated"]);

export function fvgStopCandidates(bundle) {
  const fvgs = bundle?.gates?.engine?.pillar3?.fvgs ?? [];
  const out = [];
  for (let i = 0; i < fvgs.length; i++) {
    const f = fvgs[i];
    const dir = String(f?.dir ?? "");
    if (dir !== "bull" && dir !== "bear") continue;
    if (DEAD_FVG_STATES.has(String(f?.state ?? ""))) continue;
    const top = num(f?.top), bottom = num(f?.bottom);
    if (top == null || bottom == null) continue;
    const long = dir === "bull";
    const c1 = num(long ? f?.c1l : f?.c1h);
    const c2 = num(long ? f?.c2l : f?.c2h);
    const zoneName = `${bottom}–${top}`;
    const anchors = [];
    if (c1 != null) anchors.push({ kind: "fvg_c1", price: c1, name: `1/3 FVG ${zoneName}` });
    if (c2 != null) anchors.push({ kind: "fvg_c2", price: c2, name: `2/3 FVG ${zoneName}` });
    if (!anchors.length) continue;
    out.push({
      forSide: long ? "buy" : "sell",
      top, bottom, state: String(f?.state ?? ""),
      anchors: anchors.map((a) => ({ ...a, ref: `gates.engine.pillar3.fvgs[${i}]` })),
    });
  }
  return out;
}

// The FVG the trade is entering off: nearest zone in the trade direction —
// for a BUY the nearest bull FVG at/below entry (in-zone counts as distance
// 0), mirrored for a SELL.
export function nearestEntryFvg({ side, entry, fvgs }) {
  const e = num(entry);
  if (e == null || !Array.isArray(fvgs)) return null;
  const long = isLong(side);
  const eligible = fvgs.filter((z) => z.forSide === (long ? "buy" : "sell")
    && (long ? z.bottom < e : z.top > e));
  if (!eligible.length) return null;
  const dist = (z) => (long
    ? (e > z.top ? e - z.top : 0)
    : (e < z.bottom ? z.bottom - e : 0));
  eligible.sort((a, b) => dist(a) - dist(b) || (long ? b.bottom - a.bottom : a.top - b.top));
  return eligible[0];
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

// Stop options for the ticket, default-first:
//   1. the nearest entry-direction FVG's candle anchors — 1/3 FVG (DEFAULT),
//      then 2/3 FVG (manual BUY/SELL ticket decision, plan 2026-07-10)
//   2. structural levels on the stop side (swing/session/leg), nearest-first
// Every option carries the 2-tick-buffered stopPrice the picker would use.
export function stopSideOptions({ side, entry, candidates, fvgs, symbol }) {
  const e = num(entry); if (e == null) return [];
  const long = isLong(side);
  const mk = (kind, name, levelPrice, ref) => ({
    kind, name, levelPrice,
    stopPrice: bufferedStopPrice({ symbol, side, levelPrice, bufferTicks: STOP_BUFFER_TICKS }),
    ref,
  });

  const out = [];
  const zone = nearestEntryFvg({ side, entry: e, fvgs });
  if (zone) {
    for (const a of zone.anchors) {
      // anchor must still sit on the stop side of entry (a shallow c2 low can
      // sit above a deep in-zone entry — dropped, never a wrong-side stop)
      if (long ? a.price < e : a.price > e) out.push(mk(a.kind, a.name, a.price, a.ref));
    }
  }

  // Only the CLOSEST swing follows the FVG anchors — the trader's spec
  // (2026-07-10) is exactly three stop kinds: 1/3 FVG · 2/3 FVG · closest
  // SL/SH. Leg extremes and session levels are NOT offered as stops (session
  // levels remain TP draws).
  const swings = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c.kind === (long ? "swing_low" : "swing_high") && (long ? c.price < e : c.price > e));
  swings.sort((a, b) => (long ? b.price - a.price : a.price - b.price));
  if (swings.length) out.push(mk(swings[0].kind, swings[0].name, swings[0].price, swings[0].ref));
  return out;
}

export function pickAutoStop({ side, entry, candidates, fvgs, symbol }) {
  const opts = stopSideOptions({ side, entry, candidates, fvgs, symbol });
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

export function buildOrderPreview({ side, entry, symbol, candidates, draws, fvgs, typedStop, typedTp, riskUsd, maxRiskUsd }) {
  const e = num(entry); const long = isLong(side);
  const auto = pickAutoStop({ side, entry: e, candidates, fvgs, symbol });
  const typed = num(typedStop);
  const stop = typed != null ? typed : (auto?.price ?? null);
  const stopSource = typed != null ? "typed" : (auto ? auto.kind : null);
  const stopOptions = stopSideOptions({ side, entry: e, candidates, fvgs, symbol });
  // TP defaults to 1:2 from the working stop (manual ticket decision,
  // plan 2026-07-10) — an untouched ticket confirms to entry ± 2×risk. A typed
  // or draw-picked TP overrides.
  const tpDefault = (e != null && stop != null && (long ? stop < e : stop > e))
    ? roundToTick(long ? e + 2 * (e - stop) : e - 2 * (stop - e), tickSize(symbol))
    : null;
  const typedTpNum = num(typedTp);
  const tp = typedTpNum ?? tpDefault;
  const tpSource = typedTpNum != null ? "typed" : (tpDefault != null ? "rr_default" : null);
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
    tp: tp ?? null, tpSource, tpDefault, tpDraws,
    riskUsd: num(riskUsd),
    contracts: sizing.contracts, stopPts: sizing.stopPts, actualRiskUsd: sizing.actualRiskUsd, withinTolerance: sizing.withinTolerance,
    rr: rr({ side, entry: e, stop, tp }),
    block,
  };
}
