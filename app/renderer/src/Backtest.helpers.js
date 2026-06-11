// app/renderer/src/Backtest.helpers.js
// Pure helpers consumed by BacktestPopover.jsx — extracted so they're
// testable via `node --test` (renderer has no Vitest in this project).

const SESSION_BARS = { "ny-am": 150, "ny-pm": 180, london: 180 };
const SESSION_SHORT = { "ny-am": "AM", "ny-pm": "PM", london: "LON" };

export function nextState(state, event) {
  switch (state) {
    case "IDLE":
      if (event.type === "START") return "AUTO_RUNNING";
      if (event.type === "VIEW_ALL") return "LIBRARY";
      return state;
    case "AUTO_RUNNING":
      if (event.type === "SETUP_SURFACED" && event.mode === "pause") return "PAUSE_AWAITING";
      if (event.type === "COMPLETE") return "DONE";
      if (event.type === "VIEW_ALL") return "LIBRARY";
      return state;
    case "PAUSE_AWAITING":
      if (event.type === "DECISION") return "AUTO_RUNNING";
      if (event.type === "COMPLETE") return "DONE";
      return state;
    case "DONE":
      if (event.type === "DISMISS") return "IDLE";
      if (event.type === "VIEW_ALL") return "LIBRARY";
      if (event.type === "OPEN_DETAIL") return "DETAIL";
      if (event.type === "RUN_ANOTHER") return "IDLE";
      return state;
    case "LIBRARY":
      if (event.type === "ROW_CLICK") return "DETAIL";
      if (event.type === "DISMISS") return "IDLE";
      return state;
    case "DETAIL":
      if (event.type === "BACK") return "LIBRARY";
      if (event.type === "DISMISS") return "IDLE";
      return state;
    default:
      return state;
  }
}

export function aggregateRuns(runs) {
  const total_runs = runs.length;
  const cum_r = runs.reduce((s, r) => s + (r.total_r ?? 0), 0);
  const aplus_setups = runs.reduce((s, r) => s + (r.setups_by_grade?.["A+"] ?? 0), 0);
  const aplus_wins   = runs.reduce((s, r) => s + (r.wins_by_grade?.["A+"]   ?? 0), 0);
  const b_setups     = runs.reduce((s, r) => s + (r.setups_by_grade?.B      ?? 0), 0);
  const b_wins       = runs.reduce((s, r) => s + (r.wins_by_grade?.B        ?? 0), 0);
  const agreed       = runs.reduce((s, r) => s + (r.your_agreement?.agreed     ?? 0), 0);
  const disagreed    = runs.reduce((s, r) => s + (r.your_agreement?.disagreed  ?? 0), 0);
  const ungraded     = runs.reduce((s, r) => s + (r.your_agreement?.ungraded   ?? 0), 0);
  return {
    total_runs,
    cum_r,
    aplus_hit_rate: { numerator: aplus_wins, denominator: aplus_setups },
    b_hit_rate:     { numerator: b_wins,     denominator: b_setups },
    agreement:      { agreed, disagreed, ungraded },
  };
}

export function filterRuns(runs, { session = null, mode = null, grade = null } = {}) {
  return runs.filter((r) => {
    if (session && r.session !== session) return false;
    if (mode && r.mode !== mode) return false;
    if (grade && !runMatchesGrade(r, grade)) return false;
    return true;
  });
}

function runMatchesGrade(run, grade) {
  if (grade === "NO") return (run.setups ?? 0) === 0;
  return ((run.setups_by_grade ?? {})[grade] ?? 0) > 0;
}

export function formatRunForRow(run) {
  return {
    ...run,
    session_short: SESSION_SHORT[run.session] ?? run.session,
    session_short_for: run.session,
  };
}

// Deterministic engine (2026-06-12): no LLM in the loop, so cost is $0.
// The estimate that matters is wall time — replay stepping runs ~4s/bar.
export function estimateRun({ session }) {
  const bars = SESSION_BARS[session] ?? 180;
  return { bars, cost: 0, minutes: Math.round((bars * 4) / 60) };
}
