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
 * @returns {object|null} null when the engine is not on the chart
 *
 * The last-bar facts are bar-derived (OHLCV), not engine-derived; they are
 * passed in pre-computed so the LLM never does candle arithmetic (constraint
 * #7) and so analyze.md can read confirmation discipline entirely from
 * gates.engine.* without reaching into raw bars.
 */
export function computeEngineGates({
  engine, engineByTf, last, lastBar, lastBarAgeSeconds, m5LastBar, m15LastBar,
}) {
  if (!engine) return null;
  const px = typeof last === 'number' ? last : null;

  // -- Pillar 1: session levels, untaken draws, sweeps --
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

  // -- Pillar 2: price-action quality, sourced from the engine quality row --
  const pillar2 = {
    current_tf: engine.quality,
    m5: engineByTf?.m5?.quality ?? null,
    m15: engineByTf?.m15?.quality ?? null,
  };

  // -- Pillar 3: FVGs, BPRs, swings, structure events --
  const fvgs = engine.fvgs || [];
  const structures = engine.structures || [];
  const most_recent_structure = structures.length
    ? structures.slice().sort((a, b) => (b.confirmed_ms || 0) - (a.confirmed_ms || 0))[0]
    : null;
  const swings = engine.swings || [];

  // -- price context: which current-TF engine zones contain price --
  const inZone = (z) => px != null && px >= z.bottom && px <= z.top;

  return {
    meta: {
      schema: engine.schema,
      schema_supported: engine.schema_supported,
      tf: engine.meta?.tf ?? null,
      emit_ny: engine.meta?.emit_ny ?? null,
      symbol: engine.meta?.symbol ?? null,
    },
    price_context: {
      last: px,
      inside_fvgs: fvgs.filter(inZone),
      inside_bprs: (engine.bprs || []).filter(inZone),
    },
    pillar1: {
      session_levels,
      untaken_sell_side_below,
      untaken_buy_side_above,
      sweeps: engine.sweeps || [],
    },
    pillar2,
    pillar3: {
      fvgs,
      bprs: engine.bprs || [],
      swings: {
        internal: swings.filter((s) => s.tier === 'internal'),
        swing: swings.filter((s) => s.tier === 'swing'),
      },
      structure_events: structures,
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
