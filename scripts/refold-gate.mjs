#!/usr/bin/env node
// Refold-gate — the immutability harness for the strategy-full-spec campaign.
//
// Refolds the recorded graded sessions through the REAL production truth fn
// (same chain refold-run.js uses) and emits a canonical, diffable record of
// the BOOKED trades + total R per session. Frozen days (June 9, June 10,
// June 11 AM) must reproduce byte-identically after every code change; June
// 11 PM is the open question (its 13:30 stop is being resolved) so it is
// tracked but not gated.
//
//   node scripts/refold-gate.mjs            # compare to frozen baseline, exit 1 on drift
//   node scripts/refold-gate.mjs --freeze   # (re)write the baseline from current fold
//   node scripts/refold-gate.mjs --json      # print the canonical record, no compare
//
// Baseline lives in-repo (committed) at docs/audits/refold-baseline.json so
// the gate survives a state/ wipe.

import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(REPO_ROOT, "docs", "audits", "refold-baseline.json");

// The recorded runs that hold the graded sessions. frozen=true means any drift
// is a hard failure; frozen=false (June 11 PM) is tracked-only.
const GRADED = [
  { label: "JUN9-AM",   runId: "20260612-212913-am-2026-06-09", session: "ny-am", frozen: true },
  { label: "JUN10-AM",  runId: "20260612-213101-am-2026-06-10", session: "ny-am", frozen: true },
  { label: "JUN11-AM",  runId: "20260612-213401-am-2026-06-11", session: "ny-am", frozen: true },
  { label: "JUN11-PM",  runId: "20260612-213639-pm-2026-06-11", session: "ny-pm", frozen: false },
];

function round2(n) { return Math.round(n * 100) / 100; }

async function foldOne({ runId, session }) {
  const runDir = path.join(REPO_ROOT, "state", "backtest", runId, session);
  const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
  const payloads = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8"));

  const surfaced = new Map();   // id -> setup
  const booked = [];            // in outcome order
  const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") surfaced.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = surfaced.get(e.setupId) || {};
      const risk = Math.abs(Number(s.entry) - Number(s.stop));
      const r = e.outcome === "tp1_hit" && risk > 0
        ? round2(Math.abs(Number(e.exit) - Number(s.entry)) / risk)
        : e.outcome === "stop_hit" ? -1 : 0;
      booked.push({
        model: s.model, side: s.side, event_ts: s.event_ts,
        entry: s.entry, stop: s.stop, tp1: s.tp1,
        outcome: e.outcome, exit: e.exit, r,
      });
    }
  });

  const deps = {
    recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
    truthFn: barCloseTruth.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };

  const { summary } = await runBacktest({
    date: tape.date, session, mode: "auto", bus,
    stateDir: path.join(REPO_ROOT, "state", "backtest-refold"), deps,
  });

  return { total_r: summary.total_r, trades: booked };
}

async function foldAll() {
  const out = {};
  for (const g of GRADED) out[g.label] = await foldOne(g);
  return out;
}

function tradeKey(t) {
  return `${t.model}|${t.side}|${t.entry}|${t.stop}|${t.tp1}|${t.outcome}|${t.exit}`;
}

function diffSession(label, base, cur) {
  const probs = [];
  if (base.total_r !== cur.total_r) probs.push(`total_r ${base.total_r} -> ${cur.total_r}`);
  if (base.trades.length !== cur.trades.length) probs.push(`trade count ${base.trades.length} -> ${cur.trades.length}`);
  const n = Math.max(base.trades.length, cur.trades.length);
  for (let i = 0; i < n; i++) {
    const b = base.trades[i], c = cur.trades[i];
    if (!b) { probs.push(`+ extra trade ${tradeKey(c)}`); continue; }
    if (!c) { probs.push(`- missing trade ${tradeKey(b)}`); continue; }
    if (tradeKey(b) !== tradeKey(c)) probs.push(`trade ${i}: ${tradeKey(b)} -> ${tradeKey(c)}`);
  }
  return probs;
}

const mode = process.argv.includes("--freeze") ? "freeze"
  : process.argv.includes("--json") ? "json" : "compare";

const current = await foldAll();

if (mode === "json") {
  console.log(JSON.stringify(current, null, 2));
  process.exit(0);
}

if (mode === "freeze") {
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
  console.log(`Froze baseline -> ${path.relative(REPO_ROOT, BASELINE)}`);
  for (const g of GRADED) {
    const s = current[g.label];
    console.log(`  ${g.label.padEnd(9)} total_r ${String(s.total_r).padStart(7)}  trades ${s.trades.length}  ${g.frozen ? "[FROZEN]" : "[open]"}`);
  }
  process.exit(0);
}

// compare
if (!fs.existsSync(BASELINE)) {
  console.error("No baseline. Run with --freeze first.");
  process.exit(2);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
let drift = false;
for (const g of GRADED) {
  const base = baseline[g.label], cur = current[g.label];
  const probs = base ? diffSession(g.label, base, cur) : ["no baseline entry"];
  if (probs.length === 0) {
    console.log(`  OK   ${g.label.padEnd(9)} total_r ${String(cur.total_r).padStart(7)}  trades ${cur.trades.length}  ${g.frozen ? "[FROZEN]" : "[open]"}`);
  } else {
    const tag = g.frozen ? "DRIFT" : "moved";
    console.log(`  ${tag} ${g.label.padEnd(9)} ${g.frozen ? "[FROZEN]" : "[open]"}`);
    for (const p of probs) console.log(`         ${p}`);
    if (g.frozen) drift = true;
  }
}
if (drift) { console.error("\nFROZEN-DAY DRIFT — change must not ship as-is."); process.exit(1); }
console.log("\nFrozen days intact.");
process.exit(0);
