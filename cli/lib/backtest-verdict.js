// The fail-closed go-live verdict — the single source of truth shared by
// `tv backtest verdict`, Electron main, and the Backtest GUI. Pure, no deps.

export const DEFAULT_MIN_SESSIONS = 20;

// ── Fail-closed real-money readiness composition ────────────────────────────
// The single, table-driven gate shared by `tv backtest verdict` and the GUI.
// Positive R must NEVER override a failed/missing mechanical gate. Every input
// is treated fail-closed: anything not strictly proven true counts as not-met.
//
// Verdict hierarchy (highest precedence first):
//   1. any failed/missing mechanical gate (tests, session floor, corpus, parity) -> BLOCKED
//   2. explicit strategy rejection                                               -> BLOCKED
//   3. mechanical green but cum R <= 0                                            -> NOT_READY
//   4. mechanical green + positive R but review/approval pending                 -> REVIEW_REQUIRED
//   5. mechanical green + positive R + approved review + approved window         -> NET_POSITIVE_APPROVED (ready)

function gate(id, status, evidence, reason) {
  return { id, status, evidence, reason };
}

export function composeReadiness(input = {}) {
  const {
    tests_green,
    tests_reason,
    tests_evidence,
    baseline_current,
    baseline_reason,
    baseline_evidence,
    corpus_certified,
    corpus_reason,
    corpus_evidence,
    parity_certified,
    parity_reason,
    parity_evidence,
    strategy_review_state,
    strategy_review_reason,
    cum_r,
    sessions,
    performance_evidence,
    minSessions = DEFAULT_MIN_SESSIONS,
    user_approved_window,
    user_approval_reason,
    user_approval_evidence,
  } = input;

  const sess = Number.isFinite(sessions) ? sessions : 0;
  const r = Number.isFinite(cum_r) ? cum_r : 0;
  const rTxt = `${r >= 0 ? "+" : ""}${r}R`;
  const minValid = Number.isInteger(minSessions) && minSessions > 0;
  const review = strategy_review_state === "approved" || strategy_review_state === "rejected"
    ? strategy_review_state : "pending";

  // Ordered, deterministic gate table. Mechanical hard gates first.
  const gates = [
    gate("tests", tests_green === true ? "pass" : "fail",
      tests_evidence ?? { tests_green: tests_green === true },
      tests_reason ?? (tests_green === true ? "test evidence green for current code" : "no green test evidence for current code")),
    gate("baseline", baseline_current === true ? "pass" : "fail",
      baseline_evidence ?? { baseline_current: baseline_current === true },
      baseline_reason ?? (baseline_current === true ? "baseline matches current code" : "baseline missing or stale for current code")),
    gate("sessions", minValid && sess >= minSessions ? "pass" : "fail",
      { sessions: sess, min_sessions: minValid ? minSessions : null },
      !minValid
        ? "trusted-window session floor is invalid"
        : sess >= minSessions
          ? `${sess}/${minSessions} sessions in the trusted window`
          : `${sess}/${minSessions} sessions — below the trusted-window floor`),
    gate("corpus", corpus_certified === true ? "pass" : "fail",
      corpus_evidence ?? { corpus_certified: corpus_certified === true },
      corpus_reason ?? (corpus_certified === true ? "gate corpus certified" : "gate corpus not certified")),
    gate("parity", parity_certified === true ? "pass" : "fail",
      parity_evidence ?? { parity_certified: parity_certified === true },
      parity_reason ?? (parity_certified === true ? "backtest-live parity certified" : "backtest-live parity not certified")),
    gate("net_positive", r > 0 ? "pass" : "fail",
      performance_evidence ?? { cum_r: r },
      r > 0 ? `${rTxt} over ${sess} sessions` : `${rTxt} — not net-positive`),
    gate("strategy_review", review === "approved" ? "pass" : review === "rejected" ? "fail" : "pending",
      { strategy_review_state: review },
      strategy_review_reason ?? (review === "approved" ? "strategy review approved" : review === "rejected" ? "strategy review rejected" : "strategy review pending")),
    gate("user_approval", user_approved_window === true ? "pass" : "pending",
      user_approval_evidence ?? { user_approved_window: user_approved_window === true },
      user_approval_reason ?? (user_approved_window === true ? "user-approved trading window on record" : "user-approved trading window pending")),
  ];

  const byId = (id) => gates.find((g) => g.id === id);
  const mechanical = ["tests", "baseline", "sessions", "corpus", "parity"];
  const mechFail = mechanical.map(byId).find((g) => g.status !== "pass");

  let verdict, ready, reason;
  if (mechFail) {
    verdict = "BLOCKED"; ready = false; reason = mechFail.reason;
  } else if (byId("strategy_review").status === "fail") {
    verdict = "BLOCKED"; ready = false; reason = byId("strategy_review").reason;
  } else if (byId("net_positive").status !== "pass") {
    verdict = "NOT_READY"; ready = false; reason = byId("net_positive").reason;
  } else if (byId("strategy_review").status === "pending" || byId("user_approval").status === "pending") {
    verdict = "REVIEW_REQUIRED"; ready = false;
    reason = byId("strategy_review").status === "pending" ? byId("strategy_review").reason : byId("user_approval").reason;
  } else {
    verdict = "NET_POSITIVE_APPROVED"; ready = true; reason = `${rTxt} over ${sess} sessions — approved`;
  }

  return { verdict, ready, reason, gates };
}
