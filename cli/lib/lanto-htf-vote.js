// cli/lib/lanto-htf-vote.js
// HTF component vote (rubric §2, docs/strategy/lanto-prep-rubric.md).
//
// Marking arrays is NOT a vote ("we haven't even had a bias yet" — Daily Bias
// 09:21). HTF votes a direction only from EITHER:
//   (a) clearly-directional momentum — consecutive same-sign daily/4H/1H, or
//   (b) an observed REACTION to a SIGNIFICANT near-price array — reject →
//       continue the gap's direction; invert → flip (Daily Bias 10:18).
// Conflicting momentum + no reaction → `none` (Daily Bias 22:25). A lone
// insignificant array against strong momentum is overridden by price (35:34) —
// the caller passes `arraySignificant: false` and momentum wins.
//
// Pure. Returns "bull" | "bear" | "none".

function dir(x) {
  const s = String(x ?? "").toLowerCase();
  if (s.startsWith("bull")) return "bull";
  if (s.startsWith("bear")) return "bear";
  return "none";
}
const opposite = (d) => (d === "bull" ? "bear" : d === "bear" ? "bull" : "none");

function momentumDir({ daily, h4, h1 } = {}) {
  const signs = [daily, h4, h1].map(dir).filter((d) => d !== "none");
  if (signs.length === 0) return "none";
  const allBull = signs.every((d) => d === "bull");
  const allBear = signs.every((d) => d === "bear");
  if (allBull) return "bull";
  if (allBear) return "bear";
  return "none"; // conflict
}

export function htfVote(momentum = {}, { array, reaction, arraySignificant } = {}) {
  // (b) The reaction to a significant array dictates the narrative.
  if (array && arraySignificant === true && (reaction === "reject" || reaction === "invert")) {
    const gap = dir(array.dir ?? array.direction);
    if (gap !== "none") return reaction === "reject" ? gap : opposite(gap);
  }
  // (a) Else clearly-directional momentum, else none.
  return momentumDir(momentum);
}
