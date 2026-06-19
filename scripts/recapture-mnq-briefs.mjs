// Re-capture ONLY the missing brief layer for the tape-only MNQ backtest runs.
// For each MNQ run it calls the tested PROD_DEPS.runDirectBrief — replay to the
// session anchor + multi-TF capture — which writes brief-bundle.json +
// brief-payloads.json into the EXISTING run dir, next to the existing tape.
// fold-week then folds them faithfully (self-healing regen off the new bundle).
//
// DRIVES TV DESKTOP (CDP 9225) via replay — run only when no live session is
// active (mode=prep, detector idle). Optional date args limit the batch.
//   node scripts/recapture-mnq-briefs.mjs                 # all MNQ runs
//   node scripts/recapture-mnq-briefs.mjs 2026-05-13      # one date (validate first)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROD_DEPS, STATE_DIR } from "../app/main/backtest-deps.js";

const BT = path.join(STATE_DIR, "backtest");
const onlyDates = process.argv.slice(2);
const runs = JSON.parse(fs.readFileSync(path.join(BT, "index.json"), "utf8")).runs;
const mnq = runs.filter((r) => r.symbol === "MNQ1!" && (!onlyDates.length || onlyDates.includes(r.date)));
console.log(`re-capturing brief for ${mnq.length} MNQ runs${onlyDates.length ? " (dates: " + onlyDates.join(",") + ")" : ""}...`);

let ok = 0, skip = 0, fail = 0;
for (const r of mnq) {
  const runDir = path.join(BT, r.run_id, r.session);
  if (fs.existsSync(path.join(runDir, "brief-bundle.json"))) { console.log(`SKIP (has brief) ${r.run_id}`); skip += 1; continue; }
  try {
    await PROD_DEPS.runDirectBrief({ runId: r.run_id, session: r.session, date: r.date, symbol: "mnq" });
    const got = fs.existsSync(path.join(runDir, "brief-bundle.json")) && fs.existsSync(path.join(runDir, "brief-payloads.json"));
    console.log(`${got ? "OK  " : "NULL"} ${r.date} ${r.session}`);
    got ? (ok += 1) : (fail += 1);
  } catch (e) { console.log(`ERR ${r.date} ${r.session}: ${e.message}`); fail += 1; }
}
console.log(`\ndone: ${ok} captured, ${skip} already-had, ${fail} failed`);
process.exit(0);
