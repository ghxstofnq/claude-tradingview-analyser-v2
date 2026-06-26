#!/usr/bin/env node
// Corpus-wide live-vs-backtest parity measurement (keystone diagnostic).
// For each session that ran BOTH live and backtest, fold the SHARED brain two ways:
//   A) LIVE  — truthFn over the recorded live walker-inputs.jsonl (exact live inputs).
//   B) BACKTEST — the real runBacktest over the tape + contextFromBriefPayloads
//                 (= production backtest behavior, incl. per-bar context injection).
// Compare the distinct surfaced packets (model·side·grade·entry·stop·tp1). MATCH ⇒
// backtest ≡ live on that session; DIVERGE ⇒ a parity gap to close. Read-only
// (backtest folds to a tmp stateDir). Fills are excluded by construction.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";

const truthFn = barCloseTruth.buildDeterministicPacketTruthFromInputs;
const WT = "/Users/anasqatanani/Documents/ctv-rebuild";
const MAIN = "/Users/anasqatanani/Documents/claude-tradingview-analyser-v2";
const BT = path.join(WT, "state", "backtest");
const SESSION = "ny-am";
const DATES = ["2026-06-12", "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18",
  "2026-06-19", "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25"];

function liveFile(date) {
  for (const base of [MAIN, WT]) {
    const p = path.join(base, "state", "session", date, SESSION, "walker-inputs.jsonl");
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function runDirFor(date) {
  const d = fs.existsSync(BT) ? fs.readdirSync(BT).find((x) => x.endsWith(date) && /am-/.test(x)) : null;
  return d ? path.join(BT, d, SESSION) : null;
}
const sig = (p) => p ? `${p.model}|${p.side}|${p.grade}|e${p.entry}|s${p.stop}|t1${p.tp1}` : null;

async function foldLive(file) {
  const entries = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let walkers = [];
  const byId = new Map();
  for (const e of entries) {
    const inputs = e.inputs; if (!inputs) continue;
    let truth;
    try { truth = await truthFn({ inputs, previousWalkers: walkers, event: e.event, session: SESSION }); }
    catch { continue; }
    walkers = truth?.walkers ?? walkers;
    const sp = truth?.surfacePayload;
    if (truth?.bestPacket && sp) {
      const id = sp.id ?? sig(sp);
      if (!byId.has(id)) byId.set(id, sig(sp));
    }
  }
  return [...byId.values()];
}

async function foldBacktest(runDir, date) {
  const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
  let payloads = [];
  try { payloads = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8")); } catch { /* none */ }
  const bus = new EventEmitter();
  const byId = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") {
      const id = e.setup.id ?? e.setupId ?? sig(e.setup);
      if (!byId.has(id)) byId.set(id, sig(e.setup));
    }
  });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-bt-"));
  try {
    await runBacktest({ date: tape.date ?? date, session: SESSION, mode: "auto", bus, stateDir, deps: {
      recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
      loadDayContext: async () => null,
      runDirectBrief: async () => contextFromBriefPayloads({ session: SESSION, payloads }),
      truthFn, gradeFn: gradeOpenTrade,
    } });
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
  return [...byId.values()];
}

let clean = 0, diverge = 0, skipped = 0;
for (const date of DATES) {
  const lf = liveFile(date), rd = runDirFor(date);
  if (!lf || !rd) { console.log(`${date}  SKIP (missing ${!lf ? "live" : "backtest"})`); skipped++; continue; }
  let A, B;
  try { A = await foldLive(lf); } catch (e) { console.log(`${date}  ERR live: ${e.message}`); continue; }
  try { B = await foldBacktest(rd, date); } catch (e) { console.log(`${date}  ERR bt: ${e.message}`); continue; }
  const aSet = new Set(A), bSet = new Set(B);
  const same = A.length === B.length && A.every((s) => bSet.has(s));
  console.log(`${date}  live=${A.length}  bt=${B.length}  ${same ? "MATCH" : "DIVERGE"}`);
  if (!same) {
    const onlyLive = A.filter((s) => !bSet.has(s));
    const onlyBt = B.filter((s) => !aSet.has(s));
    if (onlyLive.length) console.log("     only-live:", onlyLive.join("  ;  "));
    if (onlyBt.length) console.log("     only-bt:  ", onlyBt.join("  ;  "));
    diverge++;
  } else clean++;
}
console.log(`\nclean=${clean}  diverge=${diverge}  skipped=${skipped}  (of ${DATES.length})`);
