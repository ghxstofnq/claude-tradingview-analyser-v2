#!/usr/bin/env node
// Refold June 1-5 AM+PM through the production engine (honors TV_SCALEIN).
// Run once normally and once with TV_SCALEIN=1 to compare.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as bc } from "../app/main/bar-close.js";

const DATES = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];
const SESS = ["ny-am", "ny-pm"];
const et = (ts) => { const d = new Date(ts); return String((d.getUTCHours() + 20) % 24).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };

function findRun(date, session) {
  const tag = `-${session.replace("ny-", "")}-${date}`;
  return fs.readdirSync("state/backtest").filter((d) => d.includes(tag)).sort().pop();
}
// PM tape entries for the same day — an AM trade still open at noon carries
// against these to 16:00 (user ruling 2026-06-13). Empty if no PM run.
function loadCarry(date, session) {
  if (session !== "ny-am") return [];
  const run = findRun(date, "ny-pm"); if (!run) return [];
  try { return JSON.parse(fs.readFileSync(path.join("state", "backtest", run, "ny-pm", "tape.json"), "utf8")).entries ?? []; }
  catch { return []; }
}
async function fold(date, session) {
  const run = findRun(date, session); if (!run) return null;
  const dir = path.join("state", "backtest", run, session);
  const tape = JSON.parse(fs.readFileSync(path.join(dir, "tape.json"), "utf8"));
  const payloads = JSON.parse(fs.readFileSync(path.join(dir, "brief-payloads.json"), "utf8"));
  const surfaced = new Map(); const booked = [];
  const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") surfaced.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") { const s = surfaced.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop); const r = e.outcome === "tp1_hit" ? Math.abs(e.exit - s.entry) / risk : e.outcome === "stop_hit" ? -1 : e.outcome === "closed_1600" ? (s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk : 0; booked.push({ t: et(s.event_ts), side: (s.side || "?")[0], add: !!s.scale_in_add, r: Number(r.toFixed(2)), outcome: e.outcome }); }
    else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }), truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const { summary } = await runBacktest({ date: tape.date, session, mode: "auto", bus, stateDir: "state/backtest-refold", deps, carryEntries: loadCarry(date, session) });
  return { total_r: summary.total_r, booked };
}

let week = 0;
const mode = process.env.TV_SCALEIN === "1" ? "SCALE-IN" : "current";
console.log(`\n===== WEEK REFOLD (${mode}) =====`);
for (const date of DATES) {
  for (const session of SESS) {
    const r = await fold(date, session); if (!r) continue;
    week += Number(r.total_r) || 0;
    const adds = r.booked.filter((b) => b.add).length;
    const detail = r.booked.map((b) => `${b.t}${b.add ? "+" : "*"}${b.side}${b.r >= 0 ? "+" : ""}${b.r}`).join(" ");
    console.log(`${date} ${session.padEnd(5)}  ${String(r.total_r).padStart(7)}R   ${r.booked.length} trades${adds ? ` (${adds} adds)` : ""}  ${detail}`);
  }
}
console.log(`---------------------------------------------------`);
console.log(`WEEK TOTAL (${mode}): ${week.toFixed(2)}R`);
process.exit(0);
