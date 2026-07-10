/**
 * ict-engine-parser.js — parse the ICT Engine indicator's evidence table.
 *
 * The ICT Engine emits its entire output as one TradingView table: rows of
 * "<type> | k=v|k=v|...". This module turns those strings into structured,
 * numerically-typed objects so analyze.js can build gates whose every price
 * resolves at a real JSON path (cite-or-reject, CLAUDE.md constraint #6).
 *
 * Pure functions — no CDP, no I/O. Source of the table format: the ICT Engine
 * Pine v6 indicator (emitMeta/emitLevelAndSweep/emitFvg/... emitters).
 */

/** Engine table schemas this parser understands. Guard on meta.schema. */
export const ENGINE_SCHEMA = 1;
export const SUPPORTED_SCHEMAS = new Set([1, 2, 3, 4]);
// The schema the CURRENTLY-DEPLOYED indicator should emit. Older schemas still
// PARSE (fixtures/replay/back-compat depend on it — audit C19 kept additive so
// it doesn't break the V1/V2/V3 regression baselines), but a LIVE capture
// reading below this is a stale-deploy signal the live/health path surfaces via
// the schema_current flag rather than a silent accept.
export const CURRENT_SCHEMA = 4;

// Deploy-drift guard: the Pine's CODE_REV const must equal this. Bumped in
// lockstep with every pine/ict-engine.pine change; live-check blocks with
// pine_code_rev_mismatch when the deployed indicator drifts from the repo.
export const EXPECTED_CODE_REV = 4;

// Per-row-type field coercion. Keys not listed default to 'str', so unknown
// future fields survive as strings rather than being dropped or mis-coerced.
// `displacement` is intentionally per-type: a bool on structure rows, a string
// enum (na|clean|acceptable|weak) on the quality row.
//
// `liquidity` rows = equal-high / equal-low pools the engine maintains
// (strategy §2.1 draw-target liquidity). Without an entry here, parseRow
// returned null for every liquidity row and the pools array was silently
// empty. atr_14 / atr_17 in the quality row used to arrive as strings
// because the parser didn't know to coerce them — Pine ships these so the
// backend can re-use Wilder ATR instead of running its own proxy.
const ROW_FIELD_TYPES = {
  // SMT read vs the sibling micro (Phase 3, 2026-07-10) — display-only.
  smt: { state: 'str', sibling: 'str', ms: 'num' },
  // V3 adds bar_ms (open time of the bar the emit reflects) + bar_closed.
  meta: { schema: 'num', count: 'num', emit_ms: 'num', bar_ms: 'num', bar_closed: 'bool', code_rev: 'num' },
  level: { price: 'num', swept: 'bool', formed_ms: 'num' },
  // Dual-emit (gate corpus): rejected_rw = the reaction-window variant of the
  // rejection read, always emitted alongside the lever-selected `rejected`.
  sweep: { price: 'num', swept_ms: 'num', rejected: 'bool', rejected_rw: 'bool' },
  // V2 (schema=2) added per-zone lifecycle fields (entered_ms..entry_state) on
  // both fvg and bpr. They're additive — V1 emits leave them absent and the
  // parser drops absent keys. String-typed enums (size_quality, confirm_dir,
  // entry_state) default to 'str' so they survive without an explicit entry.
  fvg: {
    top: 'num', bottom: 'num', ce: 'num', created_ms: 'num',
    took_liq: 'bool', disp_score: 'num', reacted: 'bool',
    entered_ms: 'num', bars_in_zone: 'num', minutes_in_zone: 'num',
    ce_held: 'bool', confirm_close: 'bool', confirm_ms: 'num', chop_15m: 'bool',
    // Lanto-strict confirmation (additive): tap on a PRIOR bar + engulfing
    // close. confirm_close keeps the old semantics; the walker may adopt
    // strict later behind a flag + full-corpus fold.
    confirm_strict: 'bool',
    wick_tapped: 'bool', // schema 4: a wick has entered the zone (Lanto's tap)
    inverted_ms: 'num', // V3: when the FVG flipped to iFVG (violating close)
    // V3: the 3 forming candles' OHLC (c1 oldest [2], c2 displacement [1], c3 newest [0])
    c1o: 'num', c1h: 'num', c1l: 'num', c1c: 'num',
    c2o: 'num', c2h: 'num', c2l: 'num', c2c: 'num',
    c3o: 'num', c3h: 'num', c3l: 'num', c3c: 'num',
  },
  bpr: {
    top: 'num', bottom: 'num', ce: 'num', created_ms: 'num',
    took_liq: 'bool', reacted: 'bool',
    entered_ms: 'num', bars_in_zone: 'num', minutes_in_zone: 'num',
    ce_held: 'bool', confirm_close: 'bool', confirm_ms: 'num', chop_15m: 'bool', wick_tapped: 'bool',
    confirm_strict: 'bool',
  },
  // schema 4: swept_ms = WHEN the swing was swept (the internal-swing sweep is
  // the stop-anchoring liquidity grab that precedes a valid inversion).
  swing: { price: 'num', bar_ms: 'num', swept: 'bool', swept_ms: 'num', significant: 'bool' },
  structure: {
    level: 'num', broken_swing_ms: 'num', confirmed_ms: 'num', displacement: 'bool', disp_pts: 'num',
    disp_atr: 'num', // I27: reversal-leg magnitude in ATRs (for the MSS speed-match gate)
  },
  liquidity: { price: 'num', swept: 'bool' },
  // V2 dropped has_chop, added session (str default). atr_14/17 stay num.
  // V3 adds the current leg's running extremes (stop-anchor evidence).
  quality: { range_3h: 'num', has_chop: 'bool', atr_14: 'num', atr_17: 'num', leg_high: 'num', leg_low: 'num', leg_high_ms: 'num', leg_low_ms: 'num', leg_high_org: 'num', leg_low_org: 'num', leg_high_org_ms: 'num', leg_low_org_ms: 'num', range_vs_normal: 'num', coherence: 'num', overnight_net: 'num', or_high: 'num', or_low: 'num' },
};

// U1: the indicator rounds ce (FVG/BPR midpoint) to mintick before emitting, so
// the emitted ce drifts from the true midpoint by up to half a tick. Recompute
// it exactly from the zone edges so CE-based logic isn't tick-biased.
function withExactCe(zone) {
  if (Number.isFinite(zone.top) && Number.isFinite(zone.bottom)) {
    return { ...zone, ce: (zone.top + zone.bottom) / 2 };
  }
  return zone;
}

/** Coerce one payload value. 'num' → finite Number or null; 'bool' → v==='1'. */
function coerceValue(v, kind) {
  if (kind === 'bool') return v === '1';
  if (kind === 'num') {
    // I28: a blank / truncated cell is MISSING, not 0. Number('') === 0 would
    // otherwise inject a phantom price of 0 — a real level the bot could cite.
    if (v == null || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return v;
}

/**
 * Parse one table row "<type> | k=v|k=v|...".
 * Returns { type, fields } or null when the string is not a known engine row.
 */
export function parseRow(row) {
  if (typeof row !== 'string') return null;
  const sep = row.indexOf(' | ');
  if (sep === -1) return null;
  const type = row.slice(0, sep).trim();
  const typeMap = ROW_FIELD_TYPES[type];
  if (!typeMap) return null;
  const fields = {};
  for (const pair of row.slice(sep + 3).split('|')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    if (!key) continue;
    fields[key] = coerceValue(pair.slice(eq + 1), typeMap[key] || 'str');
  }
  return { type, fields };
}

/** A swing pivot's type is its kind's SECOND letter: H→high pivot, L→low. */
function withIsHigh(swing) {
  return { ...swing, is_high: typeof swing.kind === 'string' && swing.kind[1] === 'H' };
}

/**
 * Parse the full engine table (array of row strings) into a structured object.
 * Returns null when there is no meta row (not an ICT Engine table).
 */
export function parseIctEngineTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out = {
    schema: null, schema_supported: false, schema_current: false, meta: null,
    levels: [], sweeps: [], fvgs: [], bprs: [], swings: [], structures: [],
    pools: [], quality: null, smt: null,
  };
  for (const raw of rows) {
    const parsed = parseRow(raw);
    if (!parsed) continue;
    const { type, fields } = parsed;
    if (type === 'meta') {
      out.meta = fields;
      out.schema = fields.schema ?? null;
      out.schema_supported = SUPPORTED_SCHEMAS.has(out.schema);
      // Below-current = parses but signals a stale deployed indicator (C19).
      out.schema_current = out.schema === CURRENT_SCHEMA;
    } else if (type === 'level') out.levels.push(fields);
    else if (type === 'sweep') out.sweeps.push(fields);
    else if (type === 'fvg') out.fvgs.push(withExactCe(fields));
    else if (type === 'bpr') out.bprs.push(withExactCe(fields));
    else if (type === 'swing') out.swings.push(withIsHigh(fields));
    else if (type === 'structure') out.structures.push(fields);
    else if (type === 'liquidity') out.pools.push(fields);
    else if (type === 'quality') out.quality = fields;
    else if (type === 'smt') out.smt = fields;
  }
  return out.meta == null ? null : out;
}

/**
 * Locate the ICT Engine's rows inside a `tv data tables` (getPineTables) result.
 * Returns the rows array, or null when the indicator is not on the chart.
 */
export function findIctEngineRows(pineTablesResult) {
  // Match V1 ('ICT Engine') and V2 ('ICT Engine V2') by prefix — substring is
  // intentionally loose so future minor versions don't break discovery.
  const matches = (pineTablesResult?.studies || []).filter(
    (s) => typeof s?.name === 'string' && /^ICT Engine\b/i.test(s.name),
  );
  if (matches.length <= 1) {
    const rows = matches[0]?.tables?.[0]?.rows;
    return Array.isArray(rows) ? rows : null;
  }
  // I29: a stale duplicate deploy can leave two ICT Engine instances on one
  // chart. Never silently read whichever comes first — pick the one with the
  // freshest emit (meta.emit_ms), tie-broken by the more-populated table.
  let best = null, bestEmit = -Infinity, bestLen = -1;
  for (const s of matches) {
    const rows = s?.tables?.[0]?.rows;
    if (!Array.isArray(rows)) continue;
    const meta = rows.map(parseRow).find((r) => r?.type === 'meta');
    const emit = meta?.fields?.emit_ms ?? -1;
    if (emit > bestEmit || (emit === bestEmit && rows.length > bestLen)) {
      bestEmit = emit; bestLen = rows.length; best = rows;
    }
  }
  return best;
}
