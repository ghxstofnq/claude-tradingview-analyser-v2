#!/usr/bin/env node
// Build a committed live≡backtest PARITY fixture for one same-code session.
//
// Usage: node scripts/make-parity-fixture.mjs <date> [session]   (default ny-am)
//
// A parity fixture proves the KEYSTONE: folding the shared brain over the LIVE
// walker-inputs and over the BACKTEST tape yields IDENTICAL packets. It is a
// mechanical agreement check (live == backtest) — NOT a Lanto-faithfulness claim
// (that's the day-tape gate vs the oracle). So no hand-grading is needed.
//
// ONLY run on a session recorded under the CURRENT code (post the deploy-parity
// arming guard, commit 3434ce9) — older recordings bake stale context and will
// (correctly) refuse here when the two sides disagree.
//
// The fixture stores BOTH sides slimmed (brief-time blocks the per-bar brain
// never reads are stripped, verified lossless by re-fold) so it stays committable.
//
// foldLive / foldBacktest are exported (no side effects on import) so the CI gate
// tests/parity-gate.test.js can re-fold the committed fixtures.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";

const truthFn = barCloseTruth.buildDeterministicPacketTruthFromInputs;
const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = "/Users/anasqatanani/Documents/claude-tradingview-analyser-v2";
const STRIP = ["engine_by_tf", "bars_by_tf", "brief_digest", "pine", "pine_by_tf", "pair", "indicators", "engine"];

function liveFile(d, session) {
  for (const base of [MAIN, WT]) {
    const p = path.join(base, "state", "session", d, session, "walker-inputs.jsonl");
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function runDir(d, session) {
  const bt = path.join(WT, "state", "backtest");
  const dir = fs.existsSync(bt) ? fs.readdirSync(bt).find((x) => x.endsWith(d) && /am-/.test(x)) : null;
  return dir ? path.join(bt, dir, session) : null;
}
export const sig = (p) => p ? `${p.model}|${p.side}|${p.grade}|${p.entry}|${p.stop}|${p.tp1}` : null;
const slimEntry = (e) => {
  const c = structuredClone(e);
  if (c.inputs?.bundle) for (const k of STRIP) delete c.inputs.bundle[k];
  return c;
};

export async function foldLive(entries, session = "ny-am") {
  let walkers = []; const ids = new Map();
  for (const e of entries) {
    const inp = e.inputs; if (!inp) continue;
    let t; try { t = await truthFn({ inputs: inp, previousWalkers: walkers, event: e.event, session }); } catch { continue; }
    walkers = t?.walkers ?? walkers;
    const sp = t?.surfacePayload;
    if (t?.bestPacket && sp) { const id = sp.id ?? sig(sp); if (!ids.has(id)) ids.set(id, sig(sp)); }
  }
  return [...ids.values()];
}
export async function foldBacktest(tapeEntries, payloads, d, session = "ny-am") {
  const bus = new EventEmitter(); const ids = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") { const id = e.setup.id ?? e.setupId ?? sig(e.setup); if (!ids.has(id)) ids.set(id, sig(e.setup)); }
  });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-fx-"));
  try {
    await runBacktest({ date: d, session, mode: "auto", bus, stateDir, deps: {
      recordEntries: async () => ({ entries: tapeEntries, warnings: [] }),
      loadDayContext: async () => null,
      runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
      truthFn, gradeFn: gradeOpenTrade,
    } });
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
  return [...ids.values()];
}
const eq = (a, b) => a.length === b.length && a.every((s) => b.includes(s));

async function main(date, session) {
  const lf = liveFile(date, session), rd = runDir(date, session);
  if (!lf || !rd) { console.error(`missing ${!lf ? "live walker-inputs" : "backtest run"} for ${date} ${session}`); process.exit(1); }
  const liveFull = fs.readFileSync(lf, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  let payloads = []; try { payloads = JSON.parse(fs.readFileSync(path.join(rd, "brief-payloads.json"), "utf8")); } catch { /* none */ }

  const liveP = await foldLive(liveFull, session);
  const btP = await foldBacktest(tape.entries, payloads, tape.date ?? date, session);
  if (!eq(liveP, btP)) {
    console.error(`REFUSED — live and backtest DISAGREE for ${date} (not a clean same-code session):`);
    console.error("  live:", liveP); console.error("  bt:  ", btP);
    process.exit(1);
  }
  const liveSlim = liveFull.map(slimEntry);
  const tapeSlim = { ...tape, entries: tape.entries.map(slimEntry) };
  const liveSlimP = await foldLive(liveSlim, session);
  const btSlimP = await foldBacktest(tapeSlim.entries, payloads, tape.date ?? date, session);
  if (!eq(liveSlimP, liveP) || !eq(btSlimP, btP)) {
    console.error("REFUSED — slimming changed the fold (a stripped field is load-bearing). Aborting.");
    console.error("  liveSlim:", liveSlimP, "btSlim:", btSlimP); process.exit(1);
  }
  const outDir = path.join(WT, "tests", "parity");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${date}-${session}.parity.json`);
  fs.writeFileSync(out, JSON.stringify({
    date, session, recorded_under: "current-code (post 3434ce9)",
    expected_packets: liveP,
    live_entries: liveSlim, tape: tapeSlim, brief_payloads: payloads,
  }));
  const mb = (fs.statSync(out).size / 1e6).toFixed(1);
  console.log(`OK — ${date} ${session}: live==backtest (${liveP.length} packets), slim lossless. Wrote ${out} (${mb} MB)`);
  liveP.forEach((s) => console.log("   ", s));
}

// Only build when run directly (not when the test imports foldLive/foldBacktest).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [date, session = "ny-am"] = process.argv.slice(2);
  if (!date) { console.error("usage: make-parity-fixture.mjs <date> [session]"); process.exit(2); }
  main(date, session);
}
