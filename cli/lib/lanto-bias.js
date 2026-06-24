// cli/lib/lanto-bias.js
// The ONE draw-bias function (rubric §1, docs/strategy/lanto-prep-rubric.md).
// Both lanes call this — the PREP grade AND the live resolver — so they cannot
// diverge (closes seam ❸).
//
// Count the components (HTF, overnight, NY-open) confirming a single direction
// (Daily Bias 22:25): 1 → no-trade, 2 → B, 3 → A+. Pre-session (openVote null)
// only HTF + overnight are available, so the ceiling is B — the live open
// reaction is what earns A+.
//
// Pure. Returns { grade, count, direction, votes, no_trade_reason? }.

function norm(x) {
  const s = String(x ?? "").toLowerCase();
  if (s.startsWith("bull")) return "bull";
  if (s.startsWith("bear")) return "bear";
  return "none";
}

function reasonFor({ bull, bear }) {
  if (bull > 0 && bear > 0) return "components_conflict";
  const n = bull + bear;
  if (n === 0) return "no_directional_component";
  return "single_component"; // exactly one directional component (1/3)
}

export function computeDrawBias({ htfVote, overnightVote, openVote = null } = {}) {
  const preSession = openVote === null || openVote === undefined;
  const votes = {
    htf: norm(htfVote),
    overnight: norm(overnightVote),
    open: preSession ? null : norm(openVote),
  };

  const present = [votes.htf, votes.overnight, ...(preSession ? [] : [votes.open])];
  const bull = present.filter((v) => v === "bull").length;
  const bear = present.filter((v) => v === "bear").length;
  const count = Math.max(bull, bear);
  const direction = bull > bear ? "bull" : bear > bull ? "bear" : null;

  let grade;
  let no_trade_reason;
  if (!direction || count < 2) {
    grade = "no-trade";
    no_trade_reason = reasonFor({ bull, bear });
  } else if (!preSession && count >= 3) {
    grade = "A+";
  } else {
    grade = "B"; // 2 agreeing — pre-session ceiling, or live 2/3
  }

  return { grade, count, direction, votes, ...(no_trade_reason ? { no_trade_reason } : {}) };
}
