/**
 * compute-engine-gates.js — build deterministic gates from the ICT Engine.
 *
 * Phase 3 of the migration in docs/plans/2026-05-21-ict-engine-migration.md.
 * Takes the parsed engine table (ict-engine-parser.js) for the current TF plus
 * the per-TF map, and distils the 3-pillar gate object the /analyze slash
 * command reads. Pure — no CDP, no I/O.
 *
 * The clock/session gate stays in analyze.js computeGates (indicator-
 * independent); this module only covers the indicator-derived pillars.
 */

/** "AS.H" -> "AS_H": dots are illegal in citation paths. */
function levelKey(name) {
  return typeof name === 'string' ? name.replace(/\./g, '_') : name;
}

/** Session levels ending in H are buy-side (highs); L are sell-side (lows). */
function isHighSideLevel(name) {
  return typeof name === 'string' && name.endsWith('H');
}

/** "bull" -> "bullish"; "bear" -> "bearish". */
function dirWord(dir) {
  return dir === 'bull' ? 'bullish' : dir === 'bear' ? 'bearish' : 'unknown';
}

/** Count FVGs by `<dir>_<kind>` (bullish_fvg, bearish_ifvg, ...) and by state. */
function summarizeFvgs(fvgs) {
  const by_type = { bullish_fvg: 0, bearish_fvg: 0, bullish_ifvg: 0, bearish_ifvg: 0 };
  const by_state = { fresh: 0, ce_tapped: 0, filled: 0, inverted: 0, invalidated: 0 };
  for (const f of fvgs) {
    const typeKey = `${dirWord(f.dir)}_${f.kind}`;
    if (typeKey in by_type) by_type[typeKey]++;
    if (f.state in by_state) by_state[f.state]++;
  }
  return { total: fvgs.length, by_type, by_state };
}

// FVG lifecycle ranking — fresh first (most actionable), invalidated last
// (no signal). Used by fvgs_ranked so consumers can read fvgs_ranked[0]
// and get the freshest, liquidity-aware, highest-displacement FVG.
const FVG_STATE_ORDER = { fresh: 0, inverted: 1, ce_tapped: 2, filled: 3, invalidated: 4 };

/**
 * Rank FVGs by ICT priority: fresh > inverted > tapped > filled > invalidated,
 * then by took_liq (true beats false — strategy §2.1 weights this), then by
 * disp_score (higher first). Returns a NEW array — does not mutate fvgs[].
 *
 * Why additive (instead of reordering fvgs[]): existing citations like
 * `gates.engine.pillar3.fvgs[0].ce` would silently point at a different zone
 * if we reordered. fvgs_ranked is the new path; fvgs stays Pine order.
 */
function rankFvgs(fvgs) {
  return fvgs.slice().sort((a, b) => {
    const stateDelta = (FVG_STATE_ORDER[a.state] ?? 99) - (FVG_STATE_ORDER[b.state] ?? 99);
    if (stateDelta !== 0) return stateDelta;
    const liqDelta = (b.took_liq ? 1 : 0) - (a.took_liq ? 1 : 0);
    if (liqDelta !== 0) return liqDelta;
    return (b.disp_score || 0) - (a.disp_score || 0);
  });
}

/**
 * Annotate a zone with signed distances to its edges and centre relative to
 * the current price (positive = price above that edge). Strategy needs
 * "how far is the CE" without making the LLM subtract — constraint #7.
 */
function withProximity(zone, last) {
  if (last == null || zone == null) return zone;
  const ce = zone.ce != null ? zone.ce : (zone.top + zone.bottom) / 2;
  return {
    ...zone,
    distance_to_top: last - zone.top,
    distance_to_bottom: last - zone.bottom,
    distance_to_ce: last - ce,
  };
}

/**
 * Build the engine-derived gate object.
 *
 * @param {object|null} engine     parsed engine table at the chart's current TF
 * @param {object|null} engineByTf { daily, h4, h1, m15, m5, m1 } parsed tables
 * @param {number|null} last       quote.last — for above/below classification
 * @param {object|null} lastBar    current-TF last-bar facts (body_ratio, direction, ...)
 * @param {number|null} lastBarAgeSeconds  quote.time - lastBar.time
 * @param {object|null} m5LastBar  5m last-bar facts (confirmation closes, §5)
 * @param {object|null} m15LastBar 15m last-bar facts
 * @param {number|null} quoteTimeMs  quote.time * 1000, for engine staleness math
 * @returns {object|null} null when the engine is not on the chart
 *
 * The last-bar facts are bar-derived (OHLCV), not engine-derived; they are
 * passed in pre-computed so the LLM never does candle arithmetic (constraint
 * #7) and so analyze.md can read confirmation discipline entirely from
 * gates.engine.* without reaching into raw bars.
 */
export function computeEngineGates({
  engine, engineByTf, last, lastBar, lastBarAgeSeconds, m5LastBar, m15LastBar,
  quoteTimeMs,
}) {
  if (!engine) return null;
  const px = typeof last === 'number' ? last : null;

  // -- Pillar 1: session levels, untaken draws, sweeps, liquidity pools --
  const session_levels = {};
  for (const lvl of engine.levels || []) {
    session_levels[levelKey(lvl.name)] = {
      name: lvl.name,
      price: lvl.price,
      state: lvl.state,
      swept: lvl.swept,
      formed_ms: lvl.formed_ms,
      position_vs_price:
        px == null || lvl.price == null ? null
          : lvl.price > px ? 'above' : lvl.price < px ? 'below' : 'at',
    };
  }
  const levelsArr = Object.values(session_levels);
  const untaken_sell_side_below = levelsArr
    .filter((l) => !isHighSideLevel(l.name) && l.position_vs_price === 'below' && l.swept === false)
    .sort((a, b) => b.price - a.price);
  const untaken_buy_side_above = levelsArr
    .filter((l) => isHighSideLevel(l.name) && l.position_vs_price === 'above' && l.swept === false)
    .sort((a, b) => a.price - b.price);

  // Liquidity pools — equal-high/low draw targets the engine maintains
  // (strategy §2.1). Pre-partition into "untaken above" / "untaken below"
  // sorted by proximity to current price so the LLM cites the closest pool
  // without arithmetic.
  const pools = engine.pools || [];
  const untaken_pools_above = px == null
    ? []
    : pools
        .filter((p) => p.kind === 'eqh' && p.swept === false && p.price > px)
        .sort((a, b) => a.price - b.price);
  const untaken_pools_below = px == null
    ? []
    : pools
        .filter((p) => p.kind === 'eql' && p.swept === false && p.price < px)
        .sort((a, b) => b.price - a.price);

  // -- Pillar 2: price-action quality, sourced from the engine quality row --
  const pillar2 = {
    current_tf: engine.quality,
    m5: engineByTf?.m5?.quality ?? null,
    m15: engineByTf?.m15?.quality ?? null,
  };

  // -- Pillar 3: FVGs, BPRs, swings, structure events --
  const fvgs = engine.fvgs || [];
  const bprs = engine.bprs || [];
  // Augment each structure event with `is_reclaimed`: has price moved back
  // through the BoS/MSS level? A bullish BoS at 29804.75 is "reclaimed" when
  // price drops below 29804.75 — the breakout failed back into the prior
  // range. Same logic for MSS. is_reclaimed: null when either level or
  // quote.last is unavailable.
  //
  // Observed 2026-05-26: London brief surfaced a bullish bos at 29804.75 as
  // a continuation cue with last price 29801.25 — the bos was already
  // reclaimed. With this flag in the bundle, the brief / entry phase can
  // gate continuation calls on `is_reclaimed: false`.
  const augmentReclaim = (s) => {
    if (s == null) return s;
    let is_reclaimed = null;
    if (px != null && typeof s.level === 'number') {
      if (s.dir === 'bull') is_reclaimed = px < s.level;
      else if (s.dir === 'bear') is_reclaimed = px > s.level;
    }
    return { ...s, is_reclaimed };
  };
  const structures = (engine.structures || []).map(augmentReclaim);
  const most_recent_structure = structures.length
    ? structures.slice().sort((a, b) => (b.confirmed_ms || 0) - (a.confirmed_ms || 0))[0]
    : null;
  const swings = engine.swings || [];

  // Engine emits structure events in two tiers (Pine caps each at 12 so
  // internal pivots can't crowd out external "real" swings). Mirror that
  // split here so consumers can target external structure only.
  const structures_by_tier = {
    swing: structures.filter((s) => s.tier === 'swing'),
    internal: structures.filter((s) => s.tier === 'internal'),
  };

  // Failure-swing MSS events — Pine flags `validation: "sweep"` when a close
  // broke a level by less than the ATR band. Combined with `event=mss`,
  // that is one of ICT's strongest reversal cues. Pre-filtered here so the
  // prompt can read it as a discrete pool instead of scanning structures.
  const failure_swings = structures.filter(
    (s) => s.event === 'mss' && s.validation === 'sweep',
  );

  // -- price context: which current-TF engine zones contain price --
  const inZone = (z) => px != null && px >= z.bottom && px <= z.top;
  const inside_fvgs = fvgs.filter(inZone).map((f) => withProximity(f, px));
  const inside_bprs = bprs.filter(inZone).map((b) => withProximity(b, px));

  // Nearest unfilled opposing FVG above/below — the "untapped imbalance
  // closest in the direction we might reach" question, computed in code so
  // the LLM doesn't loop through fvgs comparing prices.
  const liveFvg = (f) => f.state !== 'invalidated' && f.state !== 'filled';
  const above = px == null ? [] : fvgs.filter((f) => liveFvg(f) && f.bottom > px)
    .sort((a, b) => a.bottom - b.bottom);
  const below = px == null ? [] : fvgs.filter((f) => liveFvg(f) && f.top < px)
    .sort((a, b) => b.top - a.top);
  const nearest_opposing_fvg_above = above.length
    ? withProximity(above[0], px)
    : null;
  const nearest_opposing_fvg_below = below.length
    ? withProximity(below[0], px)
    : null;

  // -- Meta: provenance + staleness + engine-derived session --
  const emit_ms = engine.meta?.emit_ms ?? null;
  const emit_age_seconds = quoteTimeMs != null && emit_ms != null
    ? Math.floor((quoteTimeMs - emit_ms) / 1000)
    : null;
  // 90s threshold = one minute past a 1m close + a 30s render-lag grace.
  // Matches the bar-watchdog stale threshold in trade-ticker-watchdog.js.
  const stale = emit_age_seconds != null && emit_age_seconds > 90;

  return {
    meta: {
      schema: engine.schema,
      schema_supported: engine.schema_supported,
      tf: engine.meta?.tf ?? null,
      emit_ny: engine.meta?.emit_ny ?? null,
      symbol: engine.meta?.symbol ?? null,
      emit_ms,
      emit_age_seconds,
      stale,
      engine_session: engine.quality?.session ?? null,
    },
    price_context: {
      last: px,
      inside_fvgs,
      inside_bprs,
      nearest_opposing_fvg_above,
      nearest_opposing_fvg_below,
    },
    pillar1: {
      session_levels,
      untaken_sell_side_below,
      untaken_buy_side_above,
      sweeps: engine.sweeps || [],
      liquidity_pools: pools,
      untaken_pools_above,
      untaken_pools_below,
    },
    pillar2,
    pillar3: {
      fvgs,
      fvgs_ranked: rankFvgs(fvgs),
      bprs,
      swings: {
        internal: swings.filter((s) => s.tier === 'internal'),
        swing: swings.filter((s) => s.tier === 'swing'),
      },
      structure_events: structures,
      structures_by_tier,
      failure_swings,
      most_recent_structure,
      fvg_summary: summarizeFvgs(fvgs),
    },
    confirmation: {
      last_bar: lastBar ?? null,
      last_bar_age_seconds: typeof lastBarAgeSeconds === 'number' ? lastBarAgeSeconds : null,
      m5_last_bar: m5LastBar ?? null,
      m15_last_bar: m15LastBar ?? null,
    },
  };
}
