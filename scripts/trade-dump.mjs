#!/usr/bin/env node
// Dump every booked trade across the 4-week clean pool with its reward-room and
// outcome, so we can see where losses cluster (by TP1 R, grade, model, time).
// Self-healing brief regen (same as refold-gate). No gate — pure baseline.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as bc } from "../app/main/bar-close.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BT = path.join(REPO_ROOT, "state", "backtest");
const WEEKS = {
  "May18-22": ["2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21", "2026-05-22"],
  "May25-29": ["2026-05-25", "2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29"],
  "Jun1-5":   ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"],
  "Jun8-12":  ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12"],
};
const PIN = {
  "2026-06-09:ny-am": "20260612-212913-am-2026-06-09",
  "2026-06-10:ny-am": "20260612-213101-am-2026-06-10",
  "2026-06-11:ny-am": "20260612-213401-am-2026-06-11",
  "2026-06-11:ny-pm": "20260612-213639-pm-2026-06-11",
};
function findRun(date, session) {
  const k = `${date}:${session}`; if (PIN[k]) return PIN[k];
  const tag = `-${session.replace("ny-", "")}-${date}`;
  return fs.readdirSync(BT).filter((d) => d.includes(tag)).sort().pop();
}
function round2(n) { return Math.round(n * 100) / 100; }
const et = (ts) => { const d = new Date(ts); return String((d.getUTCHours() + 20) % 24).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };

// Standing opposite-side structure at entry: for a SHORT, a bullish MSS/BoS
// confirmed within `windowMin`, still standing (recl=false). For a LONG, bearish.
function counterStruct(tapeEntry, side, { tier = "swing", windowMin = 60, dispOnly = false } = {}) {
  if (!tapeEntry) return false;
  const evs = tapeEntry.inputs?.bundle?.gates?.engine?.pillar3?.structure_events ?? [];
  const bar = tapeEntry.inputs?.bundle?.bars?.last_5_bars?.slice(-1)[0];
  const nowMs = bar ? Number(bar.time) * 1000 : Date.parse(tapeEntry.event?.ts);
  const want = side === "short" ? "bull" : "bear";
  return evs.some((e) => {
    if (e.dir !== want) return false;
    if (tier === "swing" && e.tier !== "swing") return false;
    if (dispOnly && e.displacement !== true) return false;
    if (e.is_reclaimed === true) return false;
    const cms = Number(e.confirmed_ms);
    return Number.isFinite(cms) && cms <= nowMs && cms >= nowMs - windowMin * 60_000;
  });
}
function regen(runDir, session) {
  const rec = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8"));
  const bp = path.join(runDir, "brief-bundle.json"); if (!fs.existsSync(bp)) return rec;
  const leader = rec[0]?.symbol || "MNQ1!";
  const bundle = JSON.parse(fs.readFileSync(bp, "utf8"));
  const digest = buildBriefDigest({ pair: { symbols: { [leader]: bundle } } });
  return buildDirectSessionBriefPayloads({ session, bundle: { ...bundle, brief_digest: digest }, symbols: [leader] });
}
function pmCarry(date) {
  const run = findRun(date, "ny-pm"); if (!run) return [];
  try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; }
}
async function fold(date, session) {
  const run = findRun(date, session); if (!run) return [];
  const runDir = path.join(BT, run, session);
  if (!fs.existsSync(path.join(runDir, "tape.json"))) return [];
  const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
  const payloads = regen(runDir, session);
  // Price-at-minute lookup: event.ts(ms) -> the bar's close (= price at that
  // close time). Used to reconstruct the 5m-candle close for the 5m filter.
  const closeAt = new Map();
  for (const e of tape.entries) {
    if (!e.inputs) continue;
    const bars = e.inputs.bundle?.bars?.last_5_bars;
    const lb = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null;
    if (lb) closeAt.set(Date.parse(e.event.ts), Number(lb.close));
  }
  // First 5m-boundary close at/after a confirmation time, and whether price was
  // still on the trade's side of entry there (the 5m close "held" the entry).
  function fiveMHeld(eventTs, side, entry) {
    let ms = Date.parse(eventTs);
    if (!Number.isFinite(ms) || !Number.isFinite(entry)) return null;
    for (let i = 0; i < 6; i++) {                 // walk up to the next boundary
      if (new Date(ms).getUTCMinutes() % 5 === 0 && closeAt.has(ms)) {
        const c = closeAt.get(ms);
        return side === "short" ? c <= entry : c >= entry;
      }
      ms += 60_000;
    }
    return null;                                   // boundary fell off the tape
  }
  const sm = new Map(); const rows = []; const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sm.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sm.get(e.setupId) || {};
      const risk = Math.abs(Number(s.entry) - Number(s.stop));
      const rr1 = risk ? Math.abs(Number(s.tp1) - Number(s.entry)) / risk : null;
      const rr2 = (risk && s.tp2 != null) ? Math.abs(Number(s.tp2) - Number(s.entry)) / risk : null;
      const signed = round2((s.side === "long" ? Number(e.exit) - Number(s.entry) : Number(s.entry) - Number(e.exit)) / (risk || 1));
      const r = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? signed : 0;
      const te = tape.entries.find((x) => x.event?.ts === s.event_ts);
      const atr = Number(te?.inputs?.bundle?.gates?.engine?.pillar2?.current_tf?.atr_14);
      const hh = Number(et(s.event_ts).slice(0, 2));
      rows.push({ date, session, t: et(s.event_ts), hh, grade: s.grade, model: s.model, side: s.side,
        rr1: rr1 == null ? null : round2(rr1), rr2: rr2 == null ? null : round2(rr2),
        risk: round2(risk), atr: Number.isFinite(atr) ? round2(atr) : null,
        riskAtr: Number.isFinite(atr) && atr > 0 ? round2(risk / atr) : null,
        outcome: e.outcome, r, add: !!s.scale_in_add,
        held5m: fiveMHeld(s.event_ts, s.side, Number(s.entry)),
        csSwing: counterStruct(te, s.side, { tier: "swing" }) });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
    truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  await runBacktest({ date: tape.date, session, mode: "auto", bus, stateDir: path.join(REPO_ROOT, "state", "backtest-dump"),
    deps, carryEntries: session === "ny-am" ? pmCarry(date) : [] });
  return rows;
}

const all = [];
for (const dates of Object.values(WEEKS)) for (const date of dates) for (const s of ["ny-am", "ny-pm"]) all.push(...await fold(date, s));

// Per-trade table.
console.log("date        sess   time  grade model      side rr1   rr2    risk  outcome       r     add");
for (const x of all) {
  console.log(`${x.date} ${x.session.padEnd(5)} ${x.t} ${String(x.grade).padEnd(5)} ${String(x.model).padEnd(10)} ${x.side.padEnd(4)} ${String(x.rr1).padStart(5)} ${String(x.rr2).padStart(5)} ${String(x.risk).padStart(6)} ${x.outcome.padEnd(12)} ${String(x.r).padStart(6)} ${x.add ? "add" : ""}`);
}
// Aggregate by TP1-R bucket.
const sum = (a) => round2(a.reduce((s, v) => s + v, 0));
function bucket(rows, lo, hi) {
  const b = rows.filter((x) => x.rr1 != null && x.rr1 >= lo && x.rr1 < hi);
  const r = sum(b.map((x) => x.r));
  const wins = b.filter((x) => x.r > 0).length, losses = b.filter((x) => x.r < 0).length, scratch = b.filter((x) => x.r === 0).length;
  return { n: b.length, wins, losses, scratch, r };
}
console.log("\n=== by TP1-R bucket (entry-trades; adds counted separately below) ===");
const anchors = all.filter((x) => !x.add);
for (const [lo, hi, lbl] of [[0, 1.5, "<1.5R"], [1.5, 2.0, "1.5-2R"], [2.0, 3.0, "2-3R"], [3.0, 99, "3R+"]]) {
  const b = bucket(anchors, lo, hi);
  console.log(`  TP1 ${lbl.padEnd(7)} n=${String(b.n).padStart(2)}  W${b.wins}/L${b.losses}/S${b.scratch}  net ${String(b.r).padStart(7)}R`);
}
console.log("\n=== adds (scale-in) by TP1-R bucket ===");
const adds = all.filter((x) => x.add);
for (const [lo, hi, lbl] of [[0, 1.5, "<1.5R"], [1.5, 2.0, "1.5-2R"], [2.0, 3.0, "2-3R"], [3.0, 99, "3R+"]]) {
  const b = bucket(adds, lo, hi);
  console.log(`  TP1 ${lbl.padEnd(7)} n=${String(b.n).padStart(2)}  W${b.wins}/L${b.losses}/S${b.scratch}  net ${String(b.r).padStart(7)}R`);
}
function band(rows, key, lo, hi) {
  const b = rows.filter((x) => x[key] != null && x[key] >= lo && x[key] < hi);
  return { n: b.length, w: b.filter((x) => x.r > 0).length, l: b.filter((x) => x.r < 0).length, r: sum(b.map((x) => x.r)) };
}
const entries = all.filter((x) => !x.add);
console.log("\n=== ENTRIES by stop/ATR (riskAtr) ===");
for (const [lo, hi, lbl] of [[0, 3, "<3 ATR"], [3, 5, "3-5"], [5, 7, "5-7"], [7, 99, "7+ ATR"]]) {
  const b = band(entries, "riskAtr", lo, hi);
  console.log(`  ${lbl.padEnd(7)} n=${String(b.n).padStart(2)} W${b.w}/L${b.l}  net ${String(b.r).padStart(7)}R`);
}
console.log("=== ALL (entries+adds) by stop/ATR ===");
for (const [lo, hi, lbl] of [[0, 3, "<3 ATR"], [3, 5, "3-5"], [5, 7, "5-7"], [7, 99, "7+ ATR"]]) {
  const b = band(all, "riskAtr", lo, hi);
  console.log(`  ${lbl.padEnd(7)} n=${String(b.n).padStart(2)} W${b.w}/L${b.l}  net ${String(b.r).padStart(7)}R`);
}
console.log("\n=== ENTRIES by hour (ET) ===");
for (const h of [9, 10, 11, 13, 14, 15]) {
  const b = band(entries, "hh", h, h + 1);
  if (b.n) console.log(`  ${h}:00  n=${String(b.n).padStart(2)} W${b.w}/L${b.l}  net ${String(b.r).padStart(7)}R`);
}
const grp = (rows, pred) => { const b = rows.filter(pred); return `n=${String(b.length).padStart(2)} W${b.filter(x=>x.r>0).length}/L${b.filter(x=>x.r<0).length}/S${b.filter(x=>x.r===0).length}  net ${String(sum(b.map(x=>x.r))).padStart(7)}R`; };
console.log("\n=== by GRADE (all trades) ===");
console.log(`  A+   ${grp(all, x => x.grade === "A+")}`);
console.log(`  B    ${grp(all, x => x.grade === "B")}`);
console.log("=== by GRADE (anchors only) ===");
console.log(`  A+   ${grp(entries, x => x.grade === "A+")}`);
console.log(`  B    ${grp(entries, x => x.grade === "B")}`);
console.log("=== by MODEL (all trades) ===");
console.log(`  Inversion ${grp(all, x => x.model === "Inversion")}`);
console.log(`  Trend     ${grp(all, x => x.model === "Trend")}`);
console.log("=== by SIDE (all trades) ===");
console.log(`  short ${grp(all, x => x.side === "short")}`);
console.log(`  long  ${grp(all, x => x.side === "long")}`);

// 5m-confirmation filter (post-hoc): would requiring the 5m close to still be
// on the trade's side of entry have kept the winners and dropped the losers?
console.log("\n=== 5m-confirmation filter (price still beyond entry at the 5m close) ===");
const held = all.filter((x) => x.held5m === true);
const snapped = all.filter((x) => x.held5m === false);
const nullh = all.filter((x) => x.held5m == null);
const grp5 = (b) => `n=${String(b.length).padStart(2)} W${b.filter(x=>x.r>0).length}/L${b.filter(x=>x.r<0).length}/S${b.filter(x=>x.r===0).length}  net ${String(sum(b.map(x=>x.r))).padStart(7)}R`;
console.log(`  HELD (kept)     ${grp5(held)}`);
console.log(`  SNAPPED (dropped) ${grp5(snapped)}`);
if (nullh.length) console.log(`  (no-boundary, kept) ${grp5(nullh)}`);
console.log(`  --> 5m-filtered total (HELD + null): ${sum([...held, ...nullh].map(x=>x.r))}R   vs baseline ${sum(all.map(x=>x.r))}R`);
console.log("  dropped trades:");
for (const x of snapped) console.log(`    ${x.date} ${x.session} ${x.t} ${x.grade} ${x.model} ${x.side} ${x.outcome} ${x.r}R${x.add ? " add" : ""}`);

// Counter-structure diagnostic: do trades with a standing opposite structure
// at entry lose more than those without?
console.log("\n=== counter-structure at entry (standing opposite-side flip) ===");
for (const [key, lbl] of [["csSwing", "swing-tier"], ["csSwingDisp", "swing+disp"], ["csAny", "any-tier"]]) {
  const hit = all.filter((x) => x[key]); const clean = all.filter((x) => !x[key]);
  const hr = sum(hit.map((x) => x.r)), cr = sum(clean.map((x) => x.r));
  const hw = hit.filter((x) => x.r > 0).length, hl = hit.filter((x) => x.r < 0).length;
  const cw = clean.filter((x) => x.r > 0).length, cl = clean.filter((x) => x.r < 0).length;
  console.log(`  ${lbl.padEnd(11)} COUNTER n=${String(hit.length).padStart(2)} W${hw}/L${hl} net ${String(hr).padStart(7)}R   |   CLEAN n=${String(clean.length).padStart(2)} W${cw}/L${cl} net ${String(cr).padStart(7)}R`);
}
// List the counter-structure (swing) trades explicitly.
console.log("\n  swing-tier counter-structure trades (candidates to block):");
for (const x of all.filter((x) => x.csSwing)) console.log(`    ${x.date} ${x.session} ${x.t} ${x.grade} ${x.model} ${x.side} ${x.outcome} ${x.r}R${x.add ? " add" : ""}`);

console.log(`\n  total trades ${all.length}  net ${sum(all.map((x) => x.r))}R`);
process.exit(0);
