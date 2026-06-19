// backtag-run-symbols — one-time, idempotent migration that stamps each existing
// backtest run with the instrument it traded (MNQ1!/MES1!), so per-symbol
// analytics works on historical runs too. The symbol is RECOVERED from the run's
// own recorded data (never guessed): a run is single-instrument by construction,
// so the first MNQ1!/MES1! in its recorded files is its symbol. Runs already
// tagged are skipped. Unrecoverable runs are left untagged + reported (honest —
// they show under neither instrument rather than a fabricated one).
//
// Usage: node scripts/backtag-run-symbols.mjs [stateDir]   (default: <repo>/state)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSymbol, parseRunSymbol } from "../cli/lib/run-symbol.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = process.argv[2] || path.join(REPO_ROOT, "state");
const btDir = path.join(stateDir, "backtest");
const indexPath = path.join(btDir, "index.json");

// Recover the traded symbol from a run's recorded files (cheapest/smallest first;
// the multi-MB tape is the last resort).
function recoverSymbol(runDir, session) {
  const files = [
    path.join(runDir, session, "brief-bundle.digest.json"),
    path.join(runDir, session, "summary.md"),
    path.join(runDir, session, "brief-bundle.json"),
    path.join(runDir, session, "tape.json"),
  ];
  for (const f of files) {
    try {
      const sym = parseRunSymbol(fs.readFileSync(f, "utf8"));
      if (sym) return sym;
    } catch { /* missing/unreadable — try the next */ }
  }
  return null;
}

if (!fs.existsSync(indexPath)) {
  console.error(`no index at ${indexPath}`);
  process.exit(1);
}
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const runs = index.runs ?? [];
let tagged = 0, already = 0, failed = 0;
const bySym = {};

for (const run of runs) {
  if (canonicalSymbol(run.symbol)) { already += 1; continue; }
  const runDir = path.join(btDir, run.run_id);
  const sym = recoverSymbol(runDir, run.session);
  if (!sym) { failed += 1; console.warn(`  ✗ ${run.run_id} — symbol unrecoverable`); continue; }
  run.symbol = sym;
  bySym[sym] = (bySym[sym] ?? 0) + 1;
  tagged += 1;
  // Mirror the tag into the run's on-disk summary.json so DETAIL + future reads agree.
  const summaryPath = path.join(runDir, run.session, "summary.json");
  try {
    const s = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    s.symbol = sym;
    fs.writeFileSync(summaryPath, JSON.stringify(s, null, 2));
  } catch { /* summary missing — index tag still stands */ }
}

fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(`backtag complete: ${tagged} tagged ${JSON.stringify(bySym)}, ${already} already tagged, ${failed} unrecoverable (${runs.length} total)`);
