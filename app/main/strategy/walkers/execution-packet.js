import { sizeFor, dayOfWeek } from '../../../../cli/lib/sizing.js';
import { psychLevelsAbove, psychLevelsBelow } from './psych-levels.js';

const TICK_SIZE = 0.25;

function roundTick(value) {
  return Math.round(value / TICK_SIZE) * TICK_SIZE;
}

function numberOrNull(value) {
  if (value == null || value === '') return null; // Number(null) is 0 — not a price
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function refOf(item, fallback = null) {
  if (typeof item?.evidenceRef === 'string' && item.evidenceRef.trim()) return item.evidenceRef;
  if (typeof item?.cite === 'string' && item.cite.trim()) return item.cite;
  if (typeof item?.id === 'string' && item.id.trim()) return item.id;
  return fallback;
}

// §6 / §7 Step 7: "Take profits first at intraday liquidity (internal
// swings, session highs/lows), second at or toward the HTF draw." The pool
// merges the brief's untaken levels with intraday pivots from the bridge's
// structural pool — swing highs + the running leg high for longs (mirror
// for shorts). Before 2026-06-12 only session LEVELS were in the pool: the
// first live setup got the weekly high as TP1 at 9.2R.
const INTRADAY_TARGET_KINDS = {
  long: new Set(['swing_high']),
  short: new Set(['swing_low']),
};

function targetPool(context, side) {
  const dirKey = side === 'long' ? 'above' : 'below';
  const targets = context?.pillar1?.untakenTargets ?? {};
  // Persistent session-history draws (multi-day-old session highs/lows that
  // never traded through — source 'session_draw') are HTF runners: preferred
  // for TP2, never promoted over a nearer intraday swing for TP1. Recent
  // session levels (from the brief) stay TP1-eligible 'level' class.
  const levels = (targets[dirKey] ?? [])
    .map((t) => ({ ...t, target_class: t.source === 'session_draw' ? 'htf' : 'level' }));
  const kinds = INTRADAY_TARGET_KINDS[side] ?? new Set();
  // UNSWEPT swings only — a swept swing holds no resting liquidity and is
  // not a target (user ruling 2026-06-12; same rule the untaken-levels
  // injection already enforces for session levels). Leg extremes carry no
  // swept flag, so they stay out of the target pool entirely.
  const pivots = (context?.pillar3?.structuralStops ?? context?.pillar3?.structural_stops ?? [])
    .filter((s) => kinds.has(String(s?.kind ?? '')) && s?.swept !== true)
    .map((s) => ({ ...s, name: s.name ?? s.kind, target_class: 'intraday' }));
  return [...levels, ...pivots];
}

// Price-discovery fallback (§ user ruling 2026-06-15): when the pool above/below
// is empty — at/near/above all-time highs, no overhead liquidity left — target
// the per-instrument psychological round-level grid (MNQ 50/100, MES 5/10).
function psychFallback(context, side, entry) {
  const sym = context?.market;
  const lvls = side === 'long' ? psychLevelsAbove(sym, entry, 4) : psychLevelsBelow(sym, entry, 4);
  return lvls.map((l) => ({ ...l, name: `psych_${l.grid}`, target_class: 'psych', cite: 'psych_grid' }));
}

function normalizeModelName(model) {
  const value = String(model ?? '').trim().toLowerCase();
  if (value === 'mss') return 'mss';
  if (value === 'trend') return 'trend';
  if (value === 'inversion') return 'inversion';
  if (value === 'undecided' || value === 'unknown' || value === 'none') return value;
  return value;
}

// Lanto's MODEL (Reversal vs Continuation) is whether the entry TURNS the
// current leg or RIDES it — distinct from the walker LIFECYCLE name (MSS/Trend/
// Inversion), which is the entry MECHANISM. Leg direction = the engine's most
// recent leg extreme (leg_high_ms vs leg_low_ms); a short on an up-leg / a long
// on a down-leg is counter-to-leg = Reversal, else Continuation. Validated on
// the 5 oracle sessions (06-09/06-16/02-09 Reversal, 06-18 Continuation).
// Null when the leg stamps are unreadable (cannot classify).
function classifySetupModel(context, side) {
  const lhMs = Number(context?.pillar2?.legHighMs);
  const llMs = Number(context?.pillar2?.legLowMs);
  if (!Number.isFinite(lhMs) || !Number.isFinite(llMs) || lhMs === llMs) return null;
  const legUp = lhMs > llMs;
  const counter = (side === 'short' && legUp) || (side === 'long' && !legUp);
  return counter ? 'Reversal' : 'Continuation';
}

// Entry MECHANISM from the walker lifecycle: the Inversion lifecycle violates an
// opposing FVG; MSS/Trend retrace into and respect one.
function mechanismOf(walkerModel) {
  return normalizeModelName(walkerModel) === 'inversion' ? 'inversion' : 'fvg_retrace';
}

function capGrade(grade, cap) {
  const rank = { 'no-trade': 0, B: 1, 'A+': 2 };
  const normalizedCap = cap === 'A+' || cap === 'B' || cap === 'no-trade' ? cap : 'A+';
  if ((rank[grade] ?? 0) <= (rank[normalizedCap] ?? 2)) return grade;
  return normalizedCap;
}

function targetIsCorrectSide(target, entry, side) {
  return side === 'long' ? target.price > entry : target.price < entry;
}

function computeRMultiple({ entry, stop, target }) {
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk <= 0) return null;
  return Number((Math.abs(target - entry) / risk).toFixed(2));
}

function stopCandidatesWithAudit(context, side, entry) {
  const stops = context?.pillar3?.structuralStops ?? context?.pillar3?.structural_stops ?? [];
  const valid = [];
  const rejected = [];
  for (const stop of stops) {
    const price = numberOrNull(stop?.price ?? stop?.level);
    const normalized = { ...stop, price };
    const evidenceRef = refOf(stop);
    // Session-level candidates exist for the Inversion structural-stop rule
    // only — in the generic nearest-stop pool they would silently change
    // MSS/Trend stop selection.
    if (String(stop?.kind ?? '').startsWith('session_level_')) {
      rejected.push({ evidenceRef, reason: 'session_level_not_generic_stop', price, rawPayload: stop });
      continue;
    }
    if (price == null) {
      rejected.push({ evidenceRef, reason: 'invalid_price', rawPayload: stop });
      continue;
    }
    const correctSide = side === 'long' ? price < entry : price > entry;
    if (!correctSide) {
      rejected.push({ evidenceRef, reason: 'wrong_side_of_entry', price, rawPayload: stop });
      continue;
    }
    valid.push(normalized);
  }
  const selected = side === 'long'
    ? valid.sort((a, b) => b.price - a.price)[0] ?? null
    : valid.sort((a, b) => a.price - b.price)[0] ?? null;
  return { selected, rejected };
}

function selectStructuralStop(context, side, entry) {
  return stopCandidatesWithAudit(context, side, entry).selected;
}

// Inversion stops are model-specific. Precedence per the user's hand-grade
// 2026-06-13 (June 9, all three shorts: 29847 / 29714.25 / 29526.25):
//   0. The FAILED LEG's extreme — the high (short) / low (long) of the move
//      that created the violated zone, read as the extreme of the visible
//      1m bars at packet time. §6 structural invalidation: reclaiming that
//      swing unwinds the inversion itself.
//   1. The violating candle's extreme — entry-models.md Inversion §5:
//      "below the candle that closed through it" (above, for shorts).
//   2. The structural swing beyond the violated zone — trading-strategy-
//      2026.md §6. Pivots BETWEEN entry and the zone are noise (June 9: a
//      2.75-point micro-pivot).
//   3. The zone edge itself — entry-models.md Inversion §5: "below the
//      inversion FVG low" (mirrored for shorts).
// Trend stops are model-specific — entry-models.md Trend §5: "Stop: Below the
// swing low that touches the FVG or below the FVG low itself" (mirrored for
// shorts). The "swing low that touches the FVG" is the DEEPEST point of the
// recent pullback into the zone — NOT just the confirmation candle's own wick.
// May 13 11:29: the confirmation candle bottomed at 29287.5, but the prior
// pullback bar made the real swing low at 29281.5; the tighter confirmation-wick
// stop got clipped by a 29284 dip the swing-low stop would have survived
// (−1 → +2.89). So take the extreme of the recent 1m window (same source the
// Inversion leg-extreme uses) — it subsumes the confirmation candle. Fall back
// to the confirmation candle, then the FVG edge, for bound-less fixtures.
function trendStructuralStop(walker, side, entry, context) {
  if (normalizeModelName(walker?.model) !== 'trend') return null;
  const correctSide = (price) => (side === 'long' ? price < entry : price > entry);

  // Trend FVG-candle stop (2026-06-21, SHIPPED default-on; opt out
  // GOFNQ_P3_TREND_STOP=0): anchor the stop on the candle that CREATED the FVG
  // (its wick — low for long, high for short), found by the FVG's created_ms in
  // the full 1m history (entry-models.md Trend §5 "below the FVG low itself" —
  // the impulse origin, ~100min back). Needs pillar3.full1m: live carries it via
  // bundle.full1m from the capture; the backtest reconstructs it from the tape.
  // Falls through to the pullback-swing default when the history/candle is
  // unreachable (no full1m, or no bar within 90s of created_ms).
  if (process.env.GOFNQ_P3_TREND_STOP !== '0') {
    const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
    const createdMs = Number(pd.created_ms);
    const full = context?.pillar3?.full1m ?? [];
    if (Number.isFinite(createdMs) && full.length) {
      let best = null, bestD = Infinity;
      for (const b of full) { const tt = Number(b?.time) * 1000; if (!Number.isFinite(tt)) continue; const d = Math.abs(tt - createdMs); if (d < bestD) { bestD = d; best = b; } }
      if (best && bestD <= 90_000) {
        const px = side === 'short' ? numberOrNull(best.high) : numberOrNull(best.low);
        if (px != null && correctSide(px)) return { kind: 'trend_fvg_candle', price: px, evidenceRef: 'full1m[fvg_created_ms]' };
      }
    }
    // not found / wrong side → fall through to the default precedence
  }

  const recent = context?.pillar3?.ohlcv1m ?? [];
  const pullbackExtreme = recent.reduce((acc, b) => {
    const px = side === 'short' ? numberOrNull(b?.high) : numberOrNull(b?.low);
    if (px == null || !correctSide(px)) return acc;
    if (acc == null) return px;
    return side === 'short' ? Math.max(acc, px) : Math.min(acc, px);
  }, null);
  if (pullbackExtreme != null) {
    return { kind: 'trend_pullback_swing', price: pullbackExtreme, evidenceRef: 'bars.last_5_bars[pullback_extreme]' };
  }

  const bar = walker?.evidence?.confirmation?.rawPayload?.last_bar
    ?? walker?.evidence?.tap?.rawPayload?.last_bar ?? {};
  const tapExtreme = side === 'short' ? numberOrNull(bar.high) : numberOrNull(bar.low);
  if (tapExtreme != null && correctSide(tapExtreme)) {
    return { kind: 'trend_tap_candle', price: tapExtreme, evidenceRef: 'gates.engine.confirmation.last_bar' };
  }

  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const edge = side === 'short' ? numberOrNull(pd.top) : numberOrNull(pd.bottom);
  if (edge != null && correctSide(edge)) {
    return { kind: 'trend_zone_edge', price: edge, evidenceRef: refOf(walker?.evidence?.pdArray, 'walker.pdArray') };
  }
  return null;
}

// MSS stops — entry-models.md MSS §6: "Stop: Below the MSS low or below the
// FVG low (structural invalidation)"; A+ example: "a few ticks below the
// MSS low." Precedence:
//   1. An explicit MSS pivot in the pool (kind mss_swing_low/high).
//   2. The structural swing beyond the reversal FVG — the displacement leg
//      launched from the grab extreme, so the first pivot past the zone IS
//      the MSS low/high. Pivots BETWEEN entry and the zone are noise
//      (June 11 10:18: a 1.5-pt micro-pivot stop).
//   3. The zone edge itself (the FVG low/high).
function mssStructuralStop(walker, side, entry, context) {
  if (normalizeModelName(walker?.model) !== 'mss') return null;
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const zoneTop = numberOrNull(pd.top);
  const zoneBottom = numberOrNull(pd.bottom);
  const correctSide = (price) => (side === 'long' ? price < entry : price > entry);
  const pool = (context?.pillar3?.structuralStops ?? context?.pillar3?.structural_stops ?? [])
    .map((s) => ({ ...s, price: numberOrNull(s?.price ?? s?.level) }))
    .filter((s) => s.price != null && correctSide(s.price));

  const explicit = pool.find((s) => String(s.kind ?? '') === (side === 'long' ? 'mss_swing_low' : 'mss_swing_high'));
  if (explicit) {
    return { kind: 'mss_structural_swing', price: explicit.price, evidenceRef: refOf(explicit) };
  }

  const beyondZone = pool
    .filter((s) => (side === 'long'
      ? String(s.kind ?? '').endsWith('_low') && zoneBottom != null && s.price < zoneBottom
      : String(s.kind ?? '').endsWith('_high') && zoneTop != null && s.price > zoneTop))
    .sort((a, b) => (side === 'long' ? b.price - a.price : a.price - b.price))[0] ?? null;
  if (beyondZone) {
    return { kind: 'mss_structural_swing', price: beyondZone.price, evidenceRef: refOf(beyondZone) };
  }

  const edge = side === 'long' ? zoneBottom : zoneTop;
  if (edge != null && correctSide(edge)) {
    return { kind: 'mss_zone_edge', price: edge, evidenceRef: refOf(walker?.evidence?.pdArray, 'walker.pdArray') };
  }
  return null;
}

function inversionStructuralStop(walker, side, entry, context) {
  if (normalizeModelName(walker?.model) !== 'inversion') return null;
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const zoneTop = numberOrNull(pd.top);
  const zoneBottom = numberOrNull(pd.bottom);
  const correctSide = (price) => (side === 'long' ? price < entry : price > entry);

  // 0. The FAILED LEG's extreme — the swing the violated zone hangs from.
  // User hand-grade 2026-06-13 (June 9, all three Inversion shorts): stops
  // 29847 / 29714.25 / 29526.25 are the highs of the legs that created the
  // violated FVGs = the max high of the visible 1m bars at packet time.
  // §6 structural invalidation: reclaiming that extreme unwinds the
  // inversion itself; the violating candle's own high is inside the leg.
  const legBars = context?.pillar3?.ohlcv1m ?? [];
  const legExtreme = legBars.reduce((acc, b) => {
    const px = side === 'short' ? numberOrNull(b?.high) : numberOrNull(b?.low);
    if (px == null) return acc;
    if (acc == null) return px;
    return side === 'short' ? Math.max(acc, px) : Math.min(acc, px);
  }, null);
  const candle = walker?.evidence?.confirmation?.rawPayload?.last_bar ?? {};
  const candleExtreme = side === 'short' ? numberOrNull(candle.high) : numberOrNull(candle.low);
  // VOLATILITY-RELATIVE wide-leg cap — the stop is sized to current conditions,
  // not a fixed number. PRICE 10:34: "in normal conditions our typical stop loss
  // is 20 points" — the stop scales with the prevailing delivery (a 20-pt 4H
  // candle → a 20-pt stop; a 130-pt one → far wider). TRADE24 15:59: "we're not
  // going to have as wide of a stop." The failed-leg extreme is the default
  // structural anchor, but when its distance is disproportionate to the current
  // delivery size — wider than WIDE_LEG_ATR_MULT × the Wilder ATR — tighten to
  // the violating-candle (entry-array) stop (entry-models.md Inversion §5 "below
  // the candle that closed through it"). Dynamic: the budget expands in a fast
  // morning (June 9: atr 13.25 → budget 66 keeps the 55-pt leg) and contracts in
  // chop, replacing the old fixed 95-pt cap (which equalled ~5×ATR at a normal
  // ~19-pt ATR). atr_14 unavailable → the leg anchor stands (no volatility read →
  // cannot judge "too wide"). The 5× multiple is the lone calibration knob,
  // refined in the verification pass against the Discord-call stops.
  const atr14 = numberOrNull(context?.pillar2?.atr14);
  const WIDE_LEG_ATR_MULT = 5;
  const wideLegBudget = atr14 != null && atr14 > 0 ? WIDE_LEG_ATR_MULT * atr14 : Infinity;
  if (legExtreme != null && correctSide(legExtreme) && Math.abs(legExtreme - entry) > wideLegBudget
      && candleExtreme != null && correctSide(candleExtreme)) {
    return { kind: 'inversion_violating_candle', price: candleExtreme, evidenceRef: 'gates.engine.confirmation.last_bar' };
  }
  if (legExtreme != null && correctSide(legExtreme)) {
    return { kind: 'inversion_failed_leg_extreme', price: legExtreme, evidenceRef: 'bars.last_5_bars[extreme]' };
  }
  if (candleExtreme != null && correctSide(candleExtreme)) {
    return { kind: 'inversion_violating_candle', price: candleExtreme, evidenceRef: 'gates.engine.confirmation.last_bar' };
  }

  const beyondZone = (context?.pillar3?.structuralStops ?? context?.pillar3?.structural_stops ?? [])
    .map((s) => ({ ...s, price: numberOrNull(s?.price ?? s?.level) }))
    .filter((s) => s.price != null && correctSide(s.price) && (side === 'short'
      ? String(s.kind ?? '').endsWith('_high') && zoneTop != null && s.price > zoneTop
      : String(s.kind ?? '').endsWith('_low') && zoneBottom != null && s.price < zoneBottom));
  const structural = side === 'short'
    ? beyondZone.sort((a, b) => a.price - b.price)[0]
    : beyondZone.sort((a, b) => b.price - a.price)[0];
  if (structural) {
    return { kind: 'inversion_structural_swing', price: structural.price, evidenceRef: refOf(structural) };
  }

  const edge = side === 'short' ? zoneTop : zoneBottom;
  if (edge != null && correctSide(edge)) {
    return {
      kind: side === 'short' ? 'inversion_zone_top' : 'inversion_zone_bottom',
      price: edge,
      evidenceRef: refOf(walker?.evidence?.pdArray, walker?.pdArrayRef ?? null),
    };
  }
  return null;
}

function validTargets(context, side, entry, stop) {
  const score = (rows) => rows
    .map((target) => ({ ...target, price: numberOrNull(target?.price ?? target?.level) }))
    .filter((target) => target.price != null && targetIsCorrectSide(target, entry, side))
    .map((target) => ({ ...target, rMultiple: computeRMultiple({ entry, stop, target: target.price }) }))
    .filter((target) => target.rMultiple != null);
  let valid = score(targetPool(context, side));
  // Empty overhead = price discovery → fall back to the psych grid.
  if (valid.length === 0) valid = score(psychFallback(context, side, entry));
  return valid.sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
}

// The WEEKLY draw (PWH/PWL) is the §7 Step 7 TP2/runner — "second toward the
// HTF draw" — never intraday TP1 liquidity. A wide stop deflates every NEAR
// target below the R-floors, leaving the far weekly high as the only level
// clearing 1.5R; selecting it as TP1 sets an unreachable intraday target
// (June 12 AM + June 11 PM 13:30: PWH ~1300 pts away, trade open all session).
// Excluded from the TP1 pool so the wide-stop trade flags tp1_below_1_5r
// instead. Matches both live (`name`) and fixture (`label`) shapes.
function isWeeklyDraw(target) {
  return /^PW_?[HL]$/i.test(String(target?.name ?? target?.label ?? ''));
}

// TP1 class priority (§6 + user ruling 2026-06-12): the nearest UNSWEPT
// internal swing is the default TP1 — but only when it pays at least 2R.
// Otherwise the nearest session level clearing the 1.5R floor takes it.
// When nothing qualifies, return the nearest candidate so the packet
// still reports tp1_below_1_5r (rather than missing_side_consistent_tp1).
function selectTp1(context, side, entry, stop) {
  const all = validTargets(context, side, entry, stop);
  // §7 Step 7: TP1 = nearest INTRADAY liquidity; the weekly draw is the
  // runner. Falls back to the full pool only if there is no other target.
  const intraday = all.filter((t) => !isWeeklyDraw(t));
  const candidates = intraday.length ? intraday : all;
  // The nearest unswept INTERNAL swing is the default TP1 when it pays ≥2R.
  const swing = candidates.find((t) => t.target_class === 'intraday' && t.rMultiple >= 2.0);
  if (swing) return swing;
  // A 1.5–2R intraday swing yields to the nearest qualifying SESSION LEVEL.
  const level = candidates.find((t) => t.target_class === 'level' && t.rMultiple >= 1.5);
  if (level) return level;
  // Otherwise the nearest target of ANY remaining draw class clearing the 1.5R
  // floor — HTF/session draw, opposing-FVG edge, or psych level. For an FVG the
  // near/CE/far edges are distinct candidates, so "nearest clearing the floor"
  // naturally deepens the edge (near → CE → far) as price closes on the gap.
  // §7 Step 7 ("TP1 = nearest intraday liquidity"): an intraday swing may be
  // this fallback TP1 only when it is the NEAREST target — never skip nearer
  // resting liquidity to reach a farther swing of the same intraday kind. That
  // skip surfaced two stop-out re-entries into the June-11 PM chop (longs into
  // the top of a 29070-29265 range). Reaching past a too-close target to a
  // farther HTF/session draw IS allowed — that is the runner logic the model
  // exists for (June 15: reach past the 30800 swing to the 30896 session draw).
  const floored = candidates.find((t, i) => t.rMultiple >= 1.5 && (t.target_class !== 'intraday' || i === 0));
  if (floored) return floored;
  // Nothing clears the floor → nearest, so the packet reports tp1_below_1_5r
  // rather than missing_side_consistent_tp1.
  return candidates[0] ?? null;
}

// TP2 = the next target beyond TP1 toward the HTF draw (§6/§7 Step 7: "second
// at or toward the HTF draw"). Tie-break = nearest clearing the runner R (user
// ruling 2026-06-15). `tp1` may be the TP1 row (preferred — carries zone) or a
// bare price.
function selectTp2(context, side, entry, stop, tp1) {
  const tp1Price = tp1?.price ?? tp1;
  if (tp1Price == null) return null;
  const beyond = validTargets(context, side, entry, stop)
    .filter((t) => Math.abs(t.price - entry) > Math.abs(tp1Price - entry));
  // Same-gap full fill: if TP1 is an opposing-FVG edge, TP2 = that gap's far
  // edge (partial fill → full fill off one gap).
  if (tp1?.target_class === 'fvg' && tp1?.zone) {
    const farSame = beyond.find((t) => t.target_class === 'fvg' && t.zone === tp1.zone && t.edge === 'far');
    if (farSame) return farSame;
  }
  // The runner aims at the REAL terminal draw — an engine session level, FVG
  // fill, or major psych level. A persistent session-history draw (class 'htf',
  // a multi-day-old session high/low) is a FALLBACK only: used when no real
  // runner sits beyond TP1, never as a NEARER cap on one. On a trend day the
  // stale old-session levels sit between price and the real draw (June-9: PDL
  // 28821), and letting them be TP2 chopped 11R runners down to 6R (corpus
  // −16R). Session draws extend the picture; they don't truncate it.
  const isRealRunner = (t) =>
    t.target_class === 'fvg' || t.target_class === 'level'
    || (t.target_class === 'psych' && t.grid === 'major');
  const realRunner = beyond.find(isRealRunner);
  const sessionDraw = beyond.find((t) => t.target_class === 'htf');
  return realRunner ?? sessionDraw ?? beyond[0] ?? null;
}

// The nearest INTRADAY objective (1m swing / session level, never an HTF/
// session draw or psych grid). This is the trade's first objective — the
// price the move tags first — and equals what TP1 was before the target model
// reached past it to the HTF draw. The backtest's scale-in "green light" can
// key off this instead of TP1 so add-timing stays decoupled from how far the
// final draw sits (TV_GREENLIGHT_INTRADAY). Nearest clearing 1.5R, else the
// nearest intraday/level, else null (no intraday objective → caller falls back
// to TP1).
function nearestIntradayTarget(context, side, entry, stop) {
  const all = validTargets(context, side, entry, stop)
    .filter((t) => !isWeeklyDraw(t) && (t.target_class === 'intraday' || t.target_class === 'level'));
  return all.find((t) => t.rMultiple >= 1.5) ?? all[0] ?? null;
}

// Grade per constraint #9 / strategy/README.md (the grade) — A+ only
// when ALL six elements align: HTF bias + draw (pillar1 pass), overnight
// context (inside pillar1), NY reaction confirming the read (ltf-bias
// handoff present AND htf_ltf_alignment aligned), price quality good
// (pillar2 pass), entry model identified, confirmation confirmed. The last
// two are structural givens at packet time — only confirmed walkers with a
// known model reach here — so the live differentiators are the pillars and
// the open-reaction handoff. Zone size_quality is deliberately NOT a
// grading element: the 2026-06-09 hand-graded A+ Inversion rode a medium
// zone (GXNQ ruling 2026-06-12); the strategy grades alignment, not zone
// size.
// D5 multi-alignment (the "two-and-one", entry-models.md / ENTRY 25:13-27:05):
// "two imbalances making one move — a 5m FVG rebalance paired with a 1m iFVG
// go-invert in one spot." Detected as a DISTINCT same-direction 5m FVG
// overlapping the walker's 1m entry zone. Elevates an otherwise-aligned 2/3
// (b_elevatable) day to A+; never creates a trade on its own. Absent 5m data →
// false (no elevation, the day stays B).
function hasMultiAlignment(context, walker) {
  // The real "two-and-one" (ENTRY 27:05) is a 5m FVG REBALANCE that took
  // liquidity, paired with a 1m iFVG go-invert IN ONE spot. So it requires
  // (a) the entry be an INVERSION (a plain FVG-retrace is a single mechanism,
  // never a two-and-one — excludes 06-16), and (b) a DISTINCT same-dir 5m FVG
  // that TOOK LIQUIDITY overlapping the entry (incidental non-liquidity 5m
  // overlap is not the pairing — excludes 06-18). Calibrated on the 5 oracle
  // sessions: 02-09 multi (A+); 06-16/06-18 NOT (B).
  if (normalizeModelName(walker?.model) !== 'inversion') return false;
  const pd = walker?.evidence?.pdArray?.rawPayload
    ?? walker?.evidence?.confirmation?.rawPayload ?? {};
  const top = Number(pd.top ?? pd.zone_top);
  const bottom = Number(pd.bottom ?? pd.zone_bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return false;
  const wantDir = walker?.side === 'long' ? ['bull', 'bullish']
    : walker?.side === 'short' ? ['bear', 'bearish'] : [];
  const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 0.26;
  return (context?.pillar3?.fvgs5m ?? []).some((z) => {
    const zt = Number(z?.top), zb = Number(z?.bottom);
    if (!Number.isFinite(zt) || !Number.isFinite(zb)) return false;
    // a DISTINCT 5m zone (not the entry zone itself) that overlaps it, same dir.
    if (near(zt, top) && near(zb, bottom)) return false;
    const overlaps = bottom <= zt && zb <= top;
    return overlaps && z?.took_liq === true
      && wantDir.includes(String(z?.dir ?? z?.direction ?? '').toLowerCase());
  });
}

function deriveGrade({ context, walker }) {
  const chain = context?.sessionChain ?? {};
  const pillarsPass = context?.pillar1?.status === 'pass' && context?.pillar2?.status === 'pass';
  if (!pillarsPass) return capGrade('no-trade', chain.gradeCap);
  const modelKnown = ['mss', 'trend', 'inversion'].includes(normalizeModelName(walker?.model));
  // A+ requires the packet to BE the aligned trade: a known model in the bias
  // direction (§2.4 / constraint #9).
  const sideAligned =
    (walker?.side === 'long' && chain.ltfBias === 'bullish') ||
    (walker?.side === 'short' && chain.ltfBias === 'bearish');

  // Stage-C 3-vote NESTED grade (daily-bias §1) when the live resolver supplied
  // it (chain.drawBiasPillar present): a_plus_eligible = 3/3 + good price → A+;
  // 2/3 → B (D5 multi-alignment elevation is added in the next slice). The grade
  // is the COUNT of HTF + overnight + NY-open votes, not the old alignment
  // heuristic. Field-less old tapes/fixtures fall back to the legacy logic below.
  if (chain.drawBiasPillar != null) {
    if (!modelKnown || !sideAligned) return capGrade('B', chain.gradeCap);
    if (chain.aPlusEligible) return capGrade('A+', chain.gradeCap);
    // D5: a 2/3 (b_elevatable) day elevates to A+ via a multi-alignment entry —
    // the "two-and-one". This LIFTS the B cap (the elevation IS the A+ path).
    if (chain.bElevatable && chain.gradeCap !== 'no-trade' && hasMultiAlignment(context, walker)) return 'A+';
    return capGrade('B', chain.gradeCap);
  }

  // Legacy fallback (no nested grade in the inputs): alignment + displacement.
  const reactionConfirmed = Boolean(chain.ltfBias) && chain.htfLtfAlignment === 'aligned' && sideAligned;
  const htfDisp = context?.pillar2?.htfDisplacement;
  const dispSource = process.env.GOFNQ_P2_DISP_HTF !== '0' && htfDisp != null && htfDisp !== ''
    ? htfDisp
    : context?.pillar2?.displacement;
  const qualityOk = ['clean', 'acceptable'].includes(String(dispSource ?? '').toLowerCase());
  return capGrade(modelKnown && reactionConfirmed && qualityOk ? 'A+' : 'B', chain.gradeCap);
}

function packetEntryAudit(confirmationPayload, confirmation) {
  return {
    evidenceRef: refOf(confirmation),
    timestampMs: confirmationPayload?.confirm_ms ?? confirmationPayload?.timestampMs ?? null,
    open: confirmationPayload?.open ?? null,
    high: confirmationPayload?.high ?? null,
    low: confirmationPayload?.low ?? null,
    close: confirmationPayload?.close ?? confirmationPayload?.price ?? confirmationPayload?.confirm_close_price ?? null,
    rawPayload: confirmationPayload ?? {},
  };
}

function packetStopAudit(stopCandidate, rejectedAlternatives = []) {
  if (!stopCandidate) {
    return { selected: null, rejectedAlternatives };
  }
  return {
    selected: refOf(stopCandidate),
    evidenceRef: refOf(stopCandidate),
    rule: stopCandidate.kind ?? 'structural_stop',
    anchorPrice: stopCandidate.price,
    anchorTimeMs: stopCandidate.timeMs ?? stopCandidate.time_ms ?? null,
    anchorOhlc: stopCandidate.ohlc ?? null,
    rejectedAlternatives,
    rawPayload: stopCandidate,
  };
}

function packetTp1Audit(tp1Candidate) {
  if (!tp1Candidate) return null;
  return {
    evidenceRef: refOf(tp1Candidate),
    label: tp1Candidate.label ?? tp1Candidate.name ?? null,
    targetPrice: tp1Candidate.price,
    rMultiple: tp1Candidate.rMultiple,
    rawPayload: tp1Candidate,
  };
}

export function buildExecutionPacketForWalker({ context, walker } = {}) {
  const blockers = [];
  if (!walker || walker.stage !== 'confirmed') blockers.push('walker_not_confirmed');

  const confirmation = walker?.evidence?.confirmation ?? {};
  const confirmationPayload = confirmation.rawPayload ?? {};
  const entryPrice = numberOrNull(confirmationPayload.close ?? confirmationPayload.price ?? confirmationPayload.confirm_close_price);
  if (entryPrice == null) blockers.push('missing_confirmation_close_price');

  const side = walker?.side;
  const stopAudit = entryPrice == null ? { selected: null, rejected: [] } : stopCandidatesWithAudit(context, side, entryPrice);
  const stopCandidate = (entryPrice == null ? null : (
    inversionStructuralStop(walker, side, entryPrice, context)
    ?? trendStructuralStop(walker, side, entryPrice, context)
    ?? mssStructuralStop(walker, side, entryPrice, context)
  )) ?? stopAudit.selected;
  if (!stopCandidate) blockers.push('missing_structural_stop');

  const tp1Candidate = entryPrice == null || !stopCandidate ? null : selectTp1(context, side, entryPrice, stopCandidate.price);
  if (!tp1Candidate) blockers.push('missing_side_consistent_tp1');
  // (D6: the 1.5R TP1 floor blocker is removed — Lanto takes TP1 at 1–1.5R,
  // risk-and-management §4.2 / RISK 01:54; the floor blocked the low end.)
  const tp2Candidate = tp1Candidate == null || entryPrice == null || !stopCandidate
    ? null
    : selectTp2(context, side, entryPrice, stopCandidate.price, tp1Candidate);
  // First intraday objective — the scale-in green-light reference (opt-in via
  // TV_GREENLIGHT_INTRADAY in the backtest). Decouples add-timing from how far
  // the HTF draw sits. Null when there's no intraday objective.
  const greenlightTarget = entryPrice == null || !stopCandidate
    ? null
    : nearestIntradayTarget(context, side, entryPrice, stopCandidate.price);

  // (D6: the bot-specific late-session overlays with no transcript basis are
  // removed — the 15:32 ET entry cutoff, the 11:00 ET exhaustion-runner A+→B cap,
  // and the 11:40 ET NY-AM B cutoff, per lanto-source-of-truth.md §5. Lanto
  // grades by the three components + the entry, not the clock.)
  let grade = deriveGrade({ context, walker });
  if (grade === 'no-trade') blockers.push('grade_blocked');

  // entry_model_priority is a SELECTION preference (resolver spec §3.4:
  // "which model to walk first"), applied in deterministic-strategy's
  // packet sort — never a hard gate. §7 Step 5 keeps all three models
  // playable; June 9 replay proved the hard block discards valid setups.
  // The old divergent_day_requires_mss blocker was the same defect: §2.4
  // says divergent days still trade the LTF direction at lower conviction
  // — that's the B cap + side gate below, not a model ban (live 2026-06-12
  // it auto-blocked every Trend continuation on a confirmed-turn rally).
  // §7 Step 5 + §2.3: models are chosen in the bias direction — a packet
  // whose side contradicts a non-null LTF bias is not in the playbook.
  // Null bias (pre-open / unclear) leaves both sides walkable at B cap.
  const ltfBias = context?.sessionChain?.ltfBias;
  if (ltfBias && side &&
      !((side === 'long' && ltfBias === 'bullish') || (side === 'short' && ltfBias === 'bearish'))) {
    blockers.push('side_contradicts_ltf_bias');
  }

  const status = blockers.length === 0 ? 'executable' : 'blocked';
  const packetGrade = status === 'executable' ? grade : 'no-trade';
  // TS §6 / §7 Step 7: size = grade × day-of-week (Mon/Fri reduced). Attached
  // for display only — never feeds the R accounting (refold-safe; the gate
  // checks entry/stop/tp1/outcome/R, none of which this touches).
  const size = sizeFor({ grade: packetGrade, dow: dayOfWeek(new Date(context?.eventTimeUtc ?? Date.now())) });
  const packet = {
    status,
    finalVerdict: status === 'executable' ? 'manual_candidate' : 'no_trade',
    model: walker?.model ?? 'unknown',
    // Lanto's model (Reversal/Continuation) + entry mechanism (fvg_retrace/
    // inversion), distinct from the lifecycle name in `model`. model_class is
    // what the oracle pass-bar compares; `model` stays the lifecycle (stops).
    model_class: classifySetupModel(context, side),
    mechanism: mechanismOf(walker?.model),
    side: side ?? 'unknown',
    grade: packetGrade,
    size,
    blockers: [...new Set(blockers)],
    entry: entryPrice == null ? null : {
      price: roundTick(entryPrice),
      timeMs: confirmationPayload.confirm_ms ?? null,
      evidenceRef: refOf(confirmation, walker?.confirmationRef ?? null),
      rawPayload: confirmationPayload,
    },
    stop: stopCandidate ? {
      price: roundTick(stopCandidate.price),
      kind: stopCandidate.kind ?? 'structural_stop',
      evidenceRef: refOf(stopCandidate),
      rawPayload: stopCandidate,
    } : null,
    tp1: tp1Candidate ? {
      price: roundTick(tp1Candidate.price),
      label: tp1Candidate.label ?? tp1Candidate.name ?? null,
      evidenceRef: refOf(tp1Candidate),
      rMultiple: tp1Candidate.rMultiple,
      rawPayload: tp1Candidate,
    } : null,
    tp2: tp2Candidate ? {
      price: roundTick(tp2Candidate.price),
      label: tp2Candidate.label ?? tp2Candidate.name ?? null,
      evidenceRef: refOf(tp2Candidate),
      rMultiple: tp2Candidate.rMultiple,
      rawPayload: tp2Candidate,
    } : null,
    greenlightRef: greenlightTarget ? roundTick(greenlightTarget.price) : null,
    evidence: {
      pdArray: walker?.evidence?.pdArray ?? null,
      confirmation: confirmation ?? null,
      stop: stopCandidate ?? null,
      tp1: tp1Candidate ?? null,
    },
    evidenceAudit: {
      entry: packetEntryAudit(confirmationPayload, confirmation),
      stop: packetStopAudit(stopCandidate, stopAudit.rejected),
      tp1: packetTp1Audit(tp1Candidate),
      gradeBlockers: blockers.filter((blocker) => blocker === 'grade_blocked' || blocker === 'tp1_below_1_5r'),
    },
  };

  return packet;
}

// Test surface for the pure target-selection helpers.
export const __test = { targetPool, validTargets, selectTp1, selectTp2, psychFallback, nearestIntradayTarget, deriveGrade, classifySetupModel, mechanismOf };
