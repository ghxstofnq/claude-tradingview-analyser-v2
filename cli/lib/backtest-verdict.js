// The go-live verdict — the single source of truth shared by `tv backtest
// verdict` (CLI, for agents) and the Backtest GUI headline. Pure, no deps, so
// both the Node CLI and the Vite renderer import it and render the SAME answer.
//
// Rule (from the end-goal: "real-money gate = backtest net-positive over a
// trusted window"): green-light ONLY when cum R > 0 AND the corpus covers at
// least a trusted-window floor of sessions.

export const DEFAULT_MIN_SESSIONS = 20;

export function computeVerdict({ cum_r, sessions, minSessions = DEFAULT_MIN_SESSIONS }) {
  if (!sessions) return { verdict: "NO_CORPUS", ready: false, reason: "no recorded runs — record a session first" };
  if (sessions < minSessions) return { verdict: "NEEDS_MORE_DATA", ready: false, reason: `${sessions}/${minSessions} sessions in the trusted window` };
  if (cum_r <= 0) return { verdict: "NOT_READY", ready: false, reason: `${cum_r >= 0 ? "+" : ""}${cum_r}R — not net-positive` };
  return { verdict: "NET_POSITIVE", ready: true, reason: `${cum_r >= 0 ? "+" : ""}${cum_r}R over ${sessions} sessions` };
}

// Map a fold/baseline object (foldSymbol's shape, or the GUI's useBaseline) to a
// verdict. Accepts either { total_r, corpus:{n_sessions} } (baseline file) or
// { cum_r, sessions } (already-normalized). Returns null when there's no data.
export function verdictFromBaseline(baseline, minSessions = DEFAULT_MIN_SESSIONS) {
  if (!baseline) return null;
  const cum_r = baseline.cum_r ?? baseline.total_r ?? 0;
  const sessions = baseline.sessions ?? baseline.corpus?.n_sessions ?? 0;
  return { cum_r, sessions, min_sessions: minSessions, ...computeVerdict({ cum_r, sessions, minSessions }) };
}

// Presentation helper: verdict → { dot tone, label } for the GUI status line.
export function verdictTone(verdict) {
  switch (verdict) {
    case "NET_POSITIVE": return "green";
    case "NOT_READY": return "red";
    case "NEEDS_MORE_DATA": return "amber";
    default: return "dim"; // NO_CORPUS
  }
}
