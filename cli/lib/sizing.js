// Prescribed sizing per the strategy's Step 7 (grade × day-of-week).
//
// Numbers below are placeholders documented for v1; replace with the actual
// table from docs/strategy/trading-strategy-2026.md §7 step 7 once confirmed.
//
// Conventions:
//   - grade ∈ {"A+", "B", "no-trade"}
//   - dow   ∈ {"Mon", "Tue", "Wed", "Thu", "Fri"}
//   - return: { contracts, dollar_risk, r_unit, label }

const TABLE = {
  // Tue/Wed/Thu = "core" days; Mon/Fri reduced per strategy.
  "A+": { Mon: 1, Tue: 2, Wed: 2, Thu: 2, Fri: 1 },
  "B":  { Mon: 0, Tue: 1, Wed: 1, Thu: 1, Fri: 0 },
};

// Risk-unit (R) fraction relative to a full A+/Tue allocation.
const R_UNIT = {
  "A+": { Mon: 0.5,  Tue: 1.0, Wed: 1.0, Thu: 1.0, Fri: 0.5  },
  "B":  { Mon: 0,    Tue: 0.5, Wed: 0.5, Thu: 0.5, Fri: 0    },
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
