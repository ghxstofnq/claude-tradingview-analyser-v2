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
export const SUPPORTED_SCHEMAS = new Set([1, 2]);

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
  meta: { schema: 'num', count: 'num', emit_ms: 'num' },
  level: { price: 'num', swept: 'bool', formed_ms: 'num' },
  sweep: { price: 'num', swept_ms: 'num', rejected: 'bool' },
  // V2 (schema=2) added per-zone lifecycle fields (entered_ms..entry_state) on
  // both fvg and bpr. They're additive — V1 emits leave them absent and the
  // parser drops absent keys. String-typed enums (size_quality, confirm_dir,
  // entry_state) default to 'str' so they survive without an explicit entry.
  fvg: {
    top: 'num', bottom: 'num', ce: 'num', created_ms: 'num',
    took_liq: 'bool', disp_score: 'num', reacted: 'bool',
    entered_ms: 'num', bars_in_zone: 'num', minutes_in_zone: 'num',
    ce_held: 'bool', confirm_close: 'bool', confirm_ms: 'num', chop_15m: 'bool',
  },
  bpr: {
    top: 'num', bottom: 'num', ce: 'num', created_ms: 'num',
    took_liq: 'bool', reacted: 'bool',
    entered_ms: 'num', bars_in_zone: 'num', minutes_in_zone: 'num',
    ce_held: 'bool', confirm_close: 'bool', confirm_ms: 'num', chop_15m: 'bool',
  },
  swing: { price: 'num', bar_ms: 'num', swept: 'bool' },
  structure: {
    level: 'num', broken_swing_ms: 'num', confirmed_ms: 'num', displacement: 'bool',
  },
  liquidity: { price: 'num', swept: 'bool' },
  // V2 dropped has_chop, added session (str default). atr_14/17 stay num.
  quality: { range_3h: 'num', has_chop: 'bool', atr_14: 'num', atr_17: 'num' },
};

/** Coerce one payload value. 'num' → finite Number or null; 'bool' → v==='1'. */
function coerceValue(v, kind) {
  if (kind === 'bool') return v === '1';
  if (kind === 'num') {
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
    schema: null, schema_supported: false, meta: null,
    levels: [], sweeps: [], fvgs: [], bprs: [], swings: [], structures: [],
    pools: [], quality: null,
  };
  for (const raw of rows) {
    const parsed = parseRow(raw);
    if (!parsed) continue;
    const { type, fields } = parsed;
    if (type === 'meta') {
      out.meta = fields;
      out.schema = fields.schema ?? null;
      out.schema_supported = SUPPORTED_SCHEMAS.has(out.schema);
    } else if (type === 'level') out.levels.push(fields);
    else if (type === 'sweep') out.sweeps.push(fields);
    else if (type === 'fvg') out.fvgs.push(fields);
    else if (type === 'bpr') out.bprs.push(fields);
    else if (type === 'swing') out.swings.push(withIsHigh(fields));
    else if (type === 'structure') out.structures.push(fields);
    else if (type === 'liquidity') out.pools.push(fields);
    else if (type === 'quality') out.quality = fields;
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
  const study = (pineTablesResult?.studies || []).find(
    (s) => typeof s?.name === 'string' && /^ICT Engine\b/i.test(s.name),
  );
  const rows = study?.tables?.[0]?.rows;
  return Array.isArray(rows) ? rows : null;
}
