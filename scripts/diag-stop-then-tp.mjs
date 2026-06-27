// Read-only: fold the MNQ corpus (baseline, flag OFF), collect every LOSING
// trade, then walk that session's bars forward from the stop bar to session end
// and check whether the trade's TP1 / TP2 was reached after it stopped out.
// Forward-scan model (diagnostic, not the chain): trade live from its entry
// (confirmation) bar; stop bar = first bar at/after that crosses the stop;
// "reached TP" = any later bar in the session touches the target. No live writes.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as bc } from "../app/main/bar-close.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";

const SYM = "MNQ1!";
const BT = "/Users/anasqatanani/Documents/claude-tradingview-analyser-v2/state/backtest";
const r2 = (n) => Math.round(n * 100) / 100;
const idx = JSON.parse(fs.readFileSync(path.join(BT, "index.json"), "utf8"));
const leaderOf = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, "tape.json"), "utf8")).entries?.[0]?.inputs?.leader ?? null; } catch { return null; } };
const findRun = (date, s) => { const tag = `-${s.replace("ny-", "")}-${date}`; for (const d of fs.readdirSync(BT).filter((x) => x.includes(tag)).sort().reverse()) if (leaderOf(path.join(BT, d, s)) === SYM) return d; return null; };
function regen(rd, s) { const bp = path.join(rd, "brief-bundle.json"); let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(rd, "brief-payloads.json"), "utf8")); } catch {} if (!fs.existsSync(bp)) return null; const b = JSON.parse(fs.readFileSync(bp, "utf8")); const ld = rec?.[0]?.symbol || SYM; return buildDirectSessionBriefPayloads({ session: s, bundle: { ...b, brief_digest: buildBriefDigest({ pair: { symbols: { [ld]: b } } }) }, symbols: [ld] }); }
const pmCarry = (date) => { const run = findRun(date, "ny-pm"); if (!run) return []; try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; } };
const etTime = (iso) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)); } catch { return "??:??"; } };
const bucketOf = (et) => { const [h, m] = et.split(":").map(Number); return `${String(h).padStart(2, "0")}:${String(Math.floor(m / 15) * 15).padStart(2, "0")}`; };

// session bar sequence (1m) from the tape: {ts, high, low}
function sessionBars(rd) {
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const out = []; const seen = new Set();
  for (const e of tape.entries) {
    const ts = Date.parse(e.event?.ts); if (!Number.isFinite(ts) || seen.has(ts)) continue;
    const b = e.inputs?.bundle?.bars?.last_5_bars?.slice(-1)?.[0]; if (!b) continue;
    out.push({ ts, high: +b.high, low: +b.low }); seen.add(ts);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// from entry bar forward: find stop bar, then whether target reached AFTER it
function stopThenReached(bars, entryTs, side, stop, target) {
  if (!Number.isFinite(target)) return null;
  let i = 0; while (i < bars.length && bars[i].ts < entryTs) i++;
  let stopIdx = -1;
  for (; i < bars.length; i++) { if (side === "long" ? bars[i].low <= stop : bars[i].high >= stop) { stopIdx = i; break; } }
  if (stopIdx < 0) return null; // never crossed stop in recorded window
  for (let j = stopIdx + 1; j < bars.length; j++) { if (side === "long" ? bars[j].high >= target : bars[j].low <= target) return true; }
  return false;
}

async function foldLosses(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return [];
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return [];
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const losses = []; const bus = new EventEmitter(); const sf = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop);
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0;
      if (R < 0) losses.push({ date: entry.date, session: entry.session, rd, side: s.side, grade: s.grade, entry: s.entry, stop: s.stop, tp1: s.tp1, tp2: s.tp2, ts: s.event_ts, et: etTime(s.event_ts), htf: ctx?.session_state?.pillar1?.htfBias ?? null, model: s.model });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "stp-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return losses;
}

const SINCE = process.env.FOLD_SINCE, UNTIL = process.env.FOLD_UNTIL;
const losses = [];
for (const e of idx.runs) {
  if (e.symbol !== SYM) continue;
  if (SINCE && e.date < SINCE) continue;
  if (UNTIL && e.date > UNTIL) continue;
  losses.push(...await foldLosses(e));
}

// max continuation run beyond entry (R multiples), from entry bar to session end
function maxRunR(bars, entryTs, side, entry, stop) {
  const risk = Math.abs(entry - stop); if (!(risk > 0)) return null;
  let i = 0; while (i < bars.length && bars[i].ts < entryTs) i++;
  let ext = 0;
  for (; i < bars.length; i++) { const adv = side === "long" ? entry - bars[i].low : bars[i].high - entry; if (adv > ext) ext = adv; }
  return r2(ext / risk);
}

const norm = (b) => { const s = String(b ?? "").toLowerCase(); if (s.includes("bull") || s === "long") return "long"; if (s.includes("bear") || s === "short") return "short"; return null; };
const barsCache = new Map();
let tp1Hit = 0, tp2Hit = 0, neither = 0, noStop = 0;
const detail = [];
for (const L of losses) {
  if (!barsCache.has(L.rd)) barsCache.set(L.rd, sessionBars(L.rd));
  const bars = barsCache.get(L.rd);
  const entryTs = Date.parse(L.ts);
  const r1 = stopThenReached(bars, entryTs, L.side, L.stop, L.tp1);
  const r2hit = stopThenReached(bars, entryTs, L.side, L.stop, L.tp2);
  if (r1 === null) { noStop++; continue; }
  if (r1) tp1Hit++; else neither++;
  if (r2hit) tp2Hit++;
  const runDir = L.side === "long" ? "short" : "long"; // price kept going opposite the trade
  const htfN = norm(L.htf);
  detail.push({ ...L, bucket: bucketOf(L.et), tp1_after: r1, tp2_after: !!r2hit, runDir, htfN, vsHtf: htfN == null ? "htf_null" : (L.side === htfN ? "with_htf" : "counter_htf"), htfRight: htfN == null ? null : htfN === runDir, runR: maxRunR(bars, entryTs, L.side, L.entry, L.stop) });
}

// the 47 that never came back — what were they?
const kept = detail.filter((d) => !d.tp1_after);
console.log(`\n=== the ${kept.length} losses that NEVER came back ===\n`);
const tally = (key) => { const m = new Map(); for (const d of kept) { const k = String(d[key]); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  "); };
console.log(`  by model      : ${tally("model")}`);
console.log(`  by grade      : ${tally("grade")}`);
console.log(`  vs HTF bias   : ${tally("vsHtf")}`);
const htfRightCt = kept.filter((d) => d.htfRight === true).length;
const htfWrongCt = kept.filter((d) => d.htfRight === false).length;
const htfNullCt = kept.filter((d) => d.htfRight === null).length;
console.log(`  HTF bias predicted the continuation direction: ${htfRightCt} yes / ${htfWrongCt} no / ${htfNullCt} no-htf`);
const runs = kept.map((d) => d.runR).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
const med = runs.length ? runs[Math.floor(runs.length / 2)] : 0;
console.log(`  continuation run size (R beyond entry): median ${med}, max ${runs[runs.length - 1]}, min ${runs[0]}`);
console.log(`  runs >= 3R: ${runs.filter((x) => x >= 3).length} / ${runs.length}   (big obvious continuations)`);

console.log(`\nLOSSES that STOPPED then later reached TP (within the same session):\n`);
console.log(`  total losses analysed : ${losses.length}  (${noStop} had no clean stop-cross in record, skipped)`);
console.log(`  reached TP1 after stop : ${tp1Hit}  (${Math.round(1000 * tp1Hit / (losses.length - noStop)) / 10}%)`);
console.log(`  reached TP2 after stop : ${tp2Hit}  (${Math.round(1000 * tp2Hit / (losses.length - noStop)) / 10}%)`);
console.log(`  reached neither        : ${neither}`);

// breakdown by entry bucket
const byB = new Map();
for (const d of detail) { const o = byB.get(d.bucket) || { n: 0, t1: 0 }; o.n++; if (d.tp1_after) o.t1++; byB.set(d.bucket, o); }
console.log(`\n  by entry bucket (losses that would've hit TP1 / total losses):\n`);
for (const k of [...byB.keys()].sort()) { const o = byB.get(k); console.log(`    ${k}  ${o.t1}/${o.n}`); }

if (process.env.LIST) {
  console.log(`\n  STOP-THEN-TP1 trades:\n`);
  for (const d of detail.filter((x) => x.tp1_after).sort((a, b) => a.date.localeCompare(b.date))) console.log(`    ${d.date} ${d.session.replace("ny-", "")} ${d.et} ${String(d.side).padEnd(5)} ${d.grade}  entry ${d.entry} stop ${d.stop} tp1 ${d.tp1}${d.tp2_after ? "  (+tp2)" : ""}`);
}
