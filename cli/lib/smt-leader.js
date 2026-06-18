// smt-leader.js — pure SMT (Smart Money Technique) relative-strength leader
// selection for the MNQ/MES pair. Strategy authority: trading-strategy-2026.md
// §2.3.1 — short the laggard, long the leader, decided in the NY open-reaction
// window. Selection only; never the entry trigger.
//
// Hard rules:
//   - constraint #7 (no LLM arithmetic): all comparison done here.
//   - constraint #6 (cite-or-reject): evidence carries engine JSON paths.
//
// Inputs are the parsed `engine` objects (the same shape compute-leader got:
// engine.levels[], engine.swings[], engine.quality). Price scales differ
// across symbols, so strength is normalized by each symbol's own ATR — never
// a raw cross-symbol price comparison.

export const SMT_GAP_BAND = 0.25; // ATR units — the single tunable; "measurably similar" below this.

const OVERNIGHT_HIGH = /^(AS|LO)\.H$/; // Asia / London highs
const OVERNIGHT_LOW = /^(AS|LO)\.L$/;

function atrOf(engine) {
  const a = Number(engine?.quality?.atr_14);
  return Number.isFinite(a) && a > 0 ? a : null;
}

// The confirmed swing-tier pivot (decision #2: engine swing-tier = confirmed)
// of the requested side, within the window, at its extreme value.
function windowPivot(engine, side, ws, we) {
  const swings = Array.isArray(engine?.swings) ? engine.swings : [];
  let best = null, bestIdx = -1;
  swings.forEach((s, i) => {
    if (s.tier !== "swing") return;
    if (side === "high" ? !s.is_high : s.is_high) return;
    const ms = Number(s.bar_ms);
    if (Number.isFinite(ms) && (ms < ws || ms > we)) return; // outside the open-reaction window
    const p = Number(s.price);
    if (!Number.isFinite(p)) return;
    if (best == null || (side === "high" ? p > best : p < best)) { best = p; bestIdx = i; }
  });
  return best == null ? null : { price: best, idx: bestIdx };
}

// Nearest overnight reference level (decision #1: nearest untaken overnight
// level being reacted to) to the pivot.
function nearestRef(engine, side, extreme) {
  const levels = Array.isArray(engine?.levels) ? engine.levels : [];
  const re = side === "high" ? OVERNIGHT_HIGH : OVERNIGHT_LOW;
  let best = null, bestIdx = -1, bestDist = Infinity;
  levels.forEach((l, i) => {
    if (!re.test(String(l.name || ""))) return;
    const p = Number(l.price);
    if (!Number.isFinite(p)) return;
    const d = Math.abs(p - extreme);
    if (d < bestDist) { bestDist = d; best = p; bestIdx = i; }
  });
  return best == null ? null : { price: best, idx: bestIdx };
}

// Per-symbol read for one side. strength: + = strong (high: exceeded its high;
// low: held above its low), − = weak (failed to make the higher high / swept
// the low).
function readSide(engine, side, ws, we) {
  if (!engine) return { hasData: false, hasPivot: false };
  const atr = atrOf(engine);
  if (atr == null) return { hasData: false, hasPivot: false };
  const pivot = windowPivot(engine, side, ws, we);
  if (!pivot) return { hasData: true, hasPivot: false, atr };
  const ref = nearestRef(engine, side, pivot.price);
  if (!ref) return { hasData: true, hasPivot: false, atr };
  const strength = (pivot.price - ref.price) / atr; // sign convention holds for both sides
  return {
    hasData: true, hasPivot: true, atr, strength,
    reference: ref.price, reference_cite: `engine.levels[${ref.idx}]`,
    window_extreme: pivot.price, pivot_cite: `engine.swings[${pivot.idx}]`,
    atr_cite: "engine.quality.atr_14",
  };
}

function evidenceOf(r) {
  if (!r || !r.hasPivot) {
    return { reference: null, reference_cite: null, window_extreme: null, pivot_cite: null, atr: r?.atr ?? null, atr_cite: "engine.quality.atr_14", strength: null };
  }
  return {
    reference: r.reference, reference_cite: r.reference_cite,
    window_extreme: r.window_extreme, pivot_cite: r.pivot_cite,
    atr: r.atr, atr_cite: r.atr_cite, strength: r.strength,
  };
}

export function computeSmtLeader({
  primary, secondary, primaryEngine, secondaryEngine,
  context = "auto", band = SMT_GAP_BAND, windowStartMs, windowEndMs,
} = {}) {
  const ws = Number.isFinite(windowStartMs) ? windowStartMs : -Infinity;
  const we = Number.isFinite(windowEndMs) ? windowEndMs : Infinity;

  const evalSide = (side) => {
    const p = readSide(primaryEngine, side, ws, we);
    const s = readSide(secondaryEngine, side, ws, we);
    const data_present = !!primaryEngine && !!secondaryEngine && p.hasData && s.hasData;
    const pivots_confirmed = !!(p.hasPivot && s.hasPivot);
    const ok = data_present && pivots_confirmed;
    return { side, p, s, data_present, pivots_confirmed, ok, gap: ok ? Math.abs(p.strength - s.strength) : null };
  };

  let pick;
  if (context === "short") pick = evalSide("high");
  else if (context === "long") pick = evalSide("low");
  else {
    const hi = evalSide("high"), lo = evalSide("low");
    const ready = [hi, lo].filter((x) => x.ok).sort((a, b) => b.gap - a.gap);
    pick = ready[0] || (hi.data_present || hi.pivots_confirmed ? hi : lo);
  }

  const side = pick.side;
  const strengths = { [primary]: pick.p?.strength ?? null, [secondary]: pick.s?.strength ?? null };
  const evidence = { [primary]: evidenceOf(pick.p), [secondary]: evidenceOf(pick.s) };
  const criteria = {
    data_present: pick.data_present,
    pivots_confirmed: pick.pivots_confirmed,
    gap_cleared: pick.ok ? pick.gap >= band : false,
  };
  const done = criteria.data_present && criteria.pivots_confirmed && criteria.gap_cleared;

  if (!criteria.data_present || !criteria.pivots_confirmed) {
    return { divergence: false, bias_dir: null, leader: null, gap: pick.gap, strengths, reason: "smt_unreadable_data", criteria, done: false, context: side, band, evidence };
  }
  if (!criteria.gap_cleared) {
    return { divergence: false, bias_dir: null, leader: null, gap: pick.gap, strengths, reason: "no_divergence_measured", criteria, done: false, context: side, band, evidence };
  }
  const bias_dir = side === "high" ? "short" : "long";
  const leader = side === "high"
    ? (pick.p.strength <= pick.s.strength ? primary : secondary)   // short the weaker (min strength)
    : (pick.p.strength >= pick.s.strength ? primary : secondary);  // long the stronger (max strength)
  return { divergence: true, bias_dir, leader, gap: pick.gap, strengths, reason: "smt_divergence", criteria, done: true, context: side, band, evidence };
}
