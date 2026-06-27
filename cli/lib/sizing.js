// Prescribed sizing: grade × day-of-week.
//
// Day-of-week is transcript-confirmed (Lanto, 10/2/2025 risk class): Mon & Fri
// = HALF risk (~$250 = 0.5R), Tue/Wed/Thu = FULL risk (~$500 = 1R). Grade
// modulates size (A+ full, B reduced) per the daily-bias 3-component grade.
// Source of truth: docs/strategy/transcripts/ (risk class + daily-bias class) —
// NOT the derived strategy docs. (B = 0.5R and the 1c/2c contract counts are a
// system interpretation; Lanto states half/full *risk*, not contract counts.)
//
// Conventions:
//   - grade ∈ {"A+", "B", "no-trade"}
//   - dow   ∈ {"Mon", "Tue", "Wed", "Thu", "Fri"}
//   - return: { contracts, dollar_risk, r_unit, label }

// Contract count + R per strategy: Tue-Thu core days, Mon/Fri reduced.
// Mon/Fri B is NOT no-trade; it's the same 0.5R as Mon/Fri A+ and Tue-Thu B.
// Updated 2026-05-26 per user clarification on actual sizing rules.
const TABLE = {
  "A+": { Mon: 1, Tue: 2, Wed: 2, Thu: 2, Fri: 1 },
  "B":  { Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 1 },
};

// Risk-unit (R) fraction. Mon/Fri half (0.5R) · Tue-Thu A+ full (1R) — per the
// transcript risk class (docs/strategy/transcripts/).
const R_UNIT = {
  "A+": { Mon: 0.5, Tue: 1.0, Wed: 1.0, Thu: 1.0, Fri: 0.5 },
  "B":  { Mon: 0.5, Tue: 0.5, Wed: 0.5, Thu: 0.5, Fri: 0.5 },
};

export function sizeFor({ grade, dow }) {
  if (grade === "no-trade") {
    return { contracts: 0, dollar_risk: null, r_unit: 0, label: "no-trade" };
  }
  const contracts = TABLE[grade]?.[dow] ?? 0;
  const r_unit = R_UNIT[grade]?.[dow] ?? 0;
  return {
    contracts,
    // Dollar risk is symbol-specific (tick value × stop distance × contracts);
    // computed at accept-time in the trades subsystem, not here.
    dollar_risk: null,
    r_unit,
    label: contracts === 0
      ? "no-trade"
      : `${contracts}c · ${r_unit} R${grade === "B" ? " (B)" : ""}${dow === "Mon" || dow === "Fri" ? " · reduced" : ""}`,
  };
}

export function dayOfWeek(date = new Date()) {
  // Use ET to align with the trading session, not the local clock.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  });
  return fmt.format(date);
}

// ---------- computeSize — R-based sizing for the strategy chain ----------
//
// Distinct from sizeFor above (contract-based, used by trade execution in
// trades.js). computeSize returns an R value the brief embeds in
// sizing_note and entry-hunt embeds in the setup payload. No LLM
// arithmetic (CLAUDE.md #7); the model just copies r_size and the cites.
//
// Lookup (not multiplication — Mon/Fri B and Tue-Thu B both land at 0.5R,
// which doesn't factor cleanly). Authority: Lanto's risk class transcript
// (docs/strategy/transcripts/) — Mon/Fri half, Tue-Thu full, A+ bigger than B.

const SIZING_TABLE = {
  Mon: { "A+": 0.5, B: 0.5, "no-trade": 0 },
  Tue: { "A+": 1.0, B: 0.5, "no-trade": 0 },
  Wed: { "A+": 1.0, B: 0.5, "no-trade": 0 },
  Thu: { "A+": 1.0, B: 0.5, "no-trade": 0 },
  Fri: { "A+": 0.5, B: 0.5, "no-trade": 0 },
};

function findSkipRule(memoryText, day) {
  if (typeof memoryText !== "string" || !memoryText) return null;
  const dayLong = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" }[day];
  // Match the day token as a word-start PREFIX (no trailing \b) so "Wed"
  // matches "Wed", "Wednesday", AND "Wednesdays" (plural form is common
  // in skip rules — "skips PCE Wednesdays").
  for (const raw of memoryText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!/skip/i.test(line)) continue;
    if (new RegExp(`\\b${day}`, "i").test(line)) return line;
    if (dayLong && new RegExp(`\\b${dayLong}`, "i").test(line)) return line;
  }
  return null;
}

export function computeSize({ day_of_week, grade, memory_overrides } = {}) {
  // Unknown day defaults to Tue-Thu (core day) row.
  const row = SIZING_TABLE[day_of_week] || SIZING_TABLE.Tue;
  const r_size_lookup = row[grade] ?? 0;
  const cites = ["strategy.sizing-table"];
  if (memory_overrides !== undefined) cites.push("memory.USER");
  const override = findSkipRule(memory_overrides, day_of_week);
  if (override) {
    return {
      r_size: 0,
      day_of_week,
      grade,
      cites,
      override_reason: override,
    };
  }
  return {
    r_size: r_size_lookup,
    day_of_week,
    grade,
    cites,
    override_reason: null,
  };
}
