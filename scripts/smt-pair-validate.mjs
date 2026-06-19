// Paired SMT validation: run computeSmtLeader on a real MNQ tape + MES tape for
// the same session, at the open-reaction window close. Prints the pick so it
// can be compared to a hand-read (correctness) and to each symbol's fold
// outcome (helpfulness).
//
// Usage: node scripts/smt-pair-validate.mjs <mnq-tape.json> <mes-tape.json> <YYYY-MM-DD> [ny-am|ny-pm|london]
import fs from "node:fs";
import { computeSmtLeader } from "../cli/lib/smt-leader.js";
import { openReactionWindowMs } from "../app/main/backtest-engine.js";

const [mnqTapePath, mesTapePath, date, session = "ny-am"] = process.argv.slice(2);
if (!mnqTapePath || !mesTapePath || !date) {
  console.error("usage: node scripts/smt-pair-validate.mjs <mnq-tape.json> <mes-tape.json> <YYYY-MM-DD> [session]");
  process.exit(2);
}
const w = openReactionWindowMs({ date, session });

// The engine as it stood at the window close (last entry at/just past endMs).
function windowEndEngine(tapePath, endMs) {
  const t = JSON.parse(fs.readFileSync(tapePath, "utf8"));
  let best = null, bd = Infinity;
  for (const e of t.entries) {
    const ms = Date.parse(e.event?.ts);
    if (Number.isFinite(ms) && ms <= endMs + 60_000) {
      const d = Math.abs(ms - endMs);
      if (d < bd) { bd = d; best = e; }
    }
  }
  return best?.inputs?.bundle?.engine ?? null;
}

const mnqEng = windowEndEngine(mnqTapePath, w.endMs);
const mesEng = windowEndEngine(mesTapePath, w.endMs);
const r = computeSmtLeader({
  primary: "MNQ1!", secondary: "MES1!",
  primaryEngine: mnqEng, secondaryEngine: mesEng,
  context: "auto", windowStartMs: w.startMs, windowEndMs: w.endMs,
});
console.log(`${date} ${session}`);
console.log("  leader:", r.leader, "| bias:", r.bias_dir, "| divergence:", r.divergence, "| reason:", r.reason);
console.log("  gap:", r.gap, "(band", r.band + ") | strengths:", JSON.stringify(r.strengths));
console.log("  evidence:", JSON.stringify(r.evidence));
