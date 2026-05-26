// usage — extract cost + token usage from SDK result messages and
// aggregate into per-day insights.
//
// The Claude Agent SDK ships `total_cost_usd`, `usage`, and `modelUsage`
// directly on the SDKResultSuccess message (see @anthropic-ai/claude-agent-sdk
// sdk.d.ts: SDKResultMessage / ModelUsage / NonNullableUsage). We don't
// need our own pricing table — the SDK already computed the cost using
// Anthropic's live pricing. We just pull it through.
//
// Two surfaces:
//   1. extractUsageFromResult(msg) — pulls cost + tokens out of one
//      result message; returns null if the message isn't a usable result.
//   2. summarizeUsage(metricsRows, opts) — aggregates a metrics.jsonl
//      slice into per-day / per-purpose / per-model breakdowns. Used by
//      the dashboard's "today's spend" panel.

/**
 * Pull cost + usage out of an SDKResultSuccess message. Returns a tight
 * object suitable for stuffing into a metrics row, or null when the
 * message isn't a result-success.
 *
 * Shape returned:
 *   {
 *     cost_usd:         number,   // total_cost_usd from SDK
 *     input_tokens:     number,
 *     output_tokens:    number,
 *     cache_read:       number,
 *     cache_creation:   number,
 *     models:           [{ model, cost_usd, input_tokens, output_tokens,
 *                          cache_read, cache_creation }]
 *   }
 *
 * Robust to missing fields — older SDK versions or fallback paths may
 * omit individual counters. Anything we can't read becomes 0.
 */
export function extractUsageFromResult(msg) {
  if (!msg || msg.type !== "result" || msg.subtype !== "success") return null;
  const usage = msg.usage || {};
  const modelUsage = msg.modelUsage || {};
  return {
    cost_usd: numeric(msg.total_cost_usd),
    input_tokens: numeric(usage.input_tokens),
    output_tokens: numeric(usage.output_tokens),
    cache_read: numeric(usage.cache_read_input_tokens),
    cache_creation: numeric(usage.cache_creation_input_tokens),
    models: Object.entries(modelUsage).map(([model, m]) => ({
      model,
      cost_usd: numeric(m?.costUSD),
      input_tokens: numeric(m?.inputTokens),
      output_tokens: numeric(m?.outputTokens),
      cache_read: numeric(m?.cacheReadInputTokens),
      cache_creation: numeric(m?.cacheCreationInputTokens),
    })),
  };
}

function numeric(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Aggregate a list of metrics rows into per-day / per-purpose / per-model
 * breakdowns. Rows without usage are counted toward turn totals but not
 * cost; cost is summed from rows that carry it.
 *
 * @param {Array} rows — metrics rows (parsed from metrics.jsonl); each
 *   row has shape { ts, kind, event, session?, durationMs?, usage? }.
 *   Only rows with event === "succeeded" carry usage.
 * @param {object} [opts]
 * @param {string} [opts.day] — restrict to a single YYYY-MM-DD (ET).
 *   Defaults to all rows.
 *
 * @returns {object} {
 *   total_cost_usd, total_turns, total_input, total_output,
 *   total_cache_read, total_cache_creation,
 *   by_purpose: { [purpose]: { turns, cost_usd, input_tokens, output_tokens, ... } },
 *   by_model:   { [model]:   { turns, cost_usd, input_tokens, output_tokens, ... } }
 * }
 */
export function summarizeUsage(rows, { day } = {}) {
  const out = {
    total_cost_usd: 0,
    total_turns: 0,
    total_input: 0,
    total_output: 0,
    total_cache_read: 0,
    total_cache_creation: 0,
    by_purpose: {},
    by_model: {},
  };
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (row.event !== "succeeded") continue;
    if (day && !rowInDay(row, day)) continue;
    out.total_turns += 1;
    const usage = row.usage || {};
    out.total_cost_usd += numeric(usage.cost_usd);
    out.total_input += numeric(usage.input_tokens);
    out.total_output += numeric(usage.output_tokens);
    out.total_cache_read += numeric(usage.cache_read);
    out.total_cache_creation += numeric(usage.cache_creation);

    const purposeSlot = (out.by_purpose[row.kind] ||= newSlot());
    purposeSlot.turns += 1;
    purposeSlot.cost_usd += numeric(usage.cost_usd);
    purposeSlot.input_tokens += numeric(usage.input_tokens);
    purposeSlot.output_tokens += numeric(usage.output_tokens);
    purposeSlot.cache_read += numeric(usage.cache_read);
    purposeSlot.cache_creation += numeric(usage.cache_creation);

    for (const m of usage.models || []) {
      const slot = (out.by_model[m.model] ||= newSlot());
      slot.turns += 1;
      slot.cost_usd += numeric(m.cost_usd);
      slot.input_tokens += numeric(m.input_tokens);
      slot.output_tokens += numeric(m.output_tokens);
      slot.cache_read += numeric(m.cache_read);
      slot.cache_creation += numeric(m.cache_creation);
    }
  }
  // Round costs to cents-ish so the dashboard doesn't show $0.04127583.
  out.total_cost_usd = round4(out.total_cost_usd);
  for (const slot of Object.values(out.by_purpose)) {
    slot.cost_usd = round4(slot.cost_usd);
  }
  for (const slot of Object.values(out.by_model)) {
    slot.cost_usd = round4(slot.cost_usd);
  }
  return out;
}

function newSlot() {
  return {
    turns: 0,
    cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read: 0,
    cache_creation: 0,
  };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * Format an ET-local YYYY-MM-DD from a timestamp string (or Date).
 * Used by rowInDay to filter rows to a specific trading day.
 */
function etDate(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function rowInDay(row, day) {
  return etDate(row.ts) === day;
}

/**
 * Compute today's ET date in YYYY-MM-DD. Convenience for the dashboard
 * "today's spend" call.
 */
export function todayET() {
  return etDate(new Date());
}
