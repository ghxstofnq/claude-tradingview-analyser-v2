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
      if (event.type === "START") return "AUTO_RUNNING";   // RE-RUN
      if (event.type === "DISMISS") return "IDLE";
      if (event.type === "VIEW_ALL") return "LIBRARY";
      if (event.type === "OPEN_DETAIL") return "DETAIL";
      if (event.type === "RUN_ANOTHER") return "IDLE";
      return state;
    case "LIBRARY":
      if (event.type === "ROW_CLICK") return "DETAIL";
      if (event.type === "DISMISS") return "IDLE";
      // The header's NEW tab dispatches RUN_ANOTHER; without this, NEW was a
      // no-op from ANALYTICS (the user was stuck in the library).
      if (event.type === "RUN_ANOTHER") return "IDLE";
      return state;
    case "DETAIL":
      if (event.type === "START") return "AUTO_RUNNING";   // RE-RUN from detail
      if (event.type === "BACK") return "LIBRARY";
      if (event.type === "DISMISS") return "IDLE";
      if (event.type === "RUN_ANOTHER") return "IDLE";
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

export function filterRuns(runs, { session = null, mode = null, grade = null, query = null } = {}) {
  const q = query ? String(query).trim().toLowerCase() : "";
  return runs.filter((r) => {
    if (session && r.session !== session) return false;
    if (mode && r.mode !== mode) return false;
    if (grade && !runMatchesGrade(r, grade)) return false;
    if (q && !`${r.date ?? ""} ${r.run_id ?? ""} ${r.session ?? ""}`.toLowerCase().includes(q)) return false;
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

// ── Detail / setup display helpers ─────────────────────────────────────
// Backtest records carry TWO timestamps: `ts` is the wall-clock moment the row
// was folded (≈ when the backtest was *run* — i.e. today), and `event_ts` is
// the real historical bar time. Display must prefer event_ts, else every setup
// in a replayed day shows the run time. And the clock is the trader's session
// clock — New York (ET), not UTC (the old slice(11,16) showed UTC labelled "ET").
export function formatClockEt(ts) {
  if (ts == null || ts === "") return "";
  const d = new Date(typeof ts === "number" ? ts : String(ts));
  if (Number.isNaN(d.getTime())) return String(ts);
  return (
    d.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " ET"
  );
}

// Display time for a setup/outcome record — historical bar time when present.
export function recordClockEt(rec) {
  return formatClockEt(rec?.event_ts ?? rec?.ts);
}

// Map a deterministic trade outcome to a display class + label. BOTH targets
// are wins (TP1 and TP2); only a stop is a loss. Was: the card hard-coded
// `tp1_hit → win, everything else → STOPPED`, so a TP2 winner rendered as a
// red "STOPPED". Returns { cls: 'win'|'loss'|'live', label }; label is null
// while the trade is still open.
export function outcomeMeta(outcome) {
  switch (outcome) {
    case "tp1_hit": return { cls: "win", label: "HIT TP1" };
    case "tp2_hit": return { cls: "win", label: "HIT TP2" };
    case "stop_hit": return { cls: "loss", label: "STOPPED" };
    case "eod_close":
    case "closed_eod": return { cls: "live", label: "CLOSED EOD" };
    default:
      return outcome
        ? { cls: "live", label: String(outcome).replace(/_/g, " ").toUpperCase() }
        : { cls: "live", label: null };
  }
}

// A run's headline GRADE for the library = the strategy grade of the setups it
// produced (best grade present), NOT a win-rate heuristic. Result/R has its own
// column, and this matches the grade FILTER (runMatchesGrade also reads
// setups_by_grade). Was: derivedGrade returned "A+" when ≥50% of trades won —
// conflating outcome with grade.
export function runGrade(run) {
  if ((run?.setups ?? 0) === 0) return "NO";
  const byGrade = run?.setups_by_grade ?? {};
  if (byGrade["A+"]) return "A+";
  if (byGrade["B"]) return "B";
  return "NO";
}

// Show a grade without inventing one. Missing → em dash, never a default "A+".
export function displayGrade(grade) {
  return grade ?? "—";
}
