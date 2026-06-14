#!/usr/bin/env node
// Faithful 5m-confirmation simulation.
//
// The strategy (§5) confirms entries on the 1m/5m close. The live chain confirms
// on the 1m close. This sim asks: if a setup must hold through the 5m close to
// be taken — entering at that 5m close — does it filter the 1m whipsaw losers?
//
// FAITHFUL BY CONSTRUCTION: the real walker chain (the single brain) still
// identifies the setup, its PD zone, its structural stop and its targets. We
// only intercept the moment of entry. A confirmed packet is BUFFERED, not
// booked; at the next 5m boundary (event.ts ET-minute % 5 === 0) we check
// whether that 5m candle's CLOSE still sits beyond the original confirmation
// level in the trade direction:
//   short -> 5m close <= entry   (price stayed below the violated zone)
//   long  -> 5m close >= entry   (price stayed above)
// If it holds, the packet is released with entry REPRICED to the 5m close (the
// real fill of a 5m-close entry) — stop and targets are structural/level-anchored
// so they don't move; R recomputes from the new entry. If it doesn't hold, the
// setup is dropped (the 1m confirmation was a fakeout). The production engine
// then books / manages / grades the released packets exactly as in the baseline,
// so position management, scale-ins, cutoffs and the 3-loss halt are unchanged.
//
// FIVE_M_MAX_WAIT (default 1): how many 5m boundaries a pending packet may wait
// for a holding close before it is dropped. 1 = strict (only the immediate 5m
// candle counts).
//
//   node scripts/five-m-confirm-sim.mjs            # 5m-confirmation fold
//   FIVE_M_OFF=1 node scripts/five-m-confirm-sim.mjs   # passthrough (baseline check)
//
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
const OFF = process.env.FIVE_M_OFF === "1";
const MAX_WAIT = Number(process.env.FIVE_M_MAX_WAIT || 1);

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

// 5m-confirmation buffer wrapped around the real truth fn (see header).
// The chain offers a packet as `executable` only for the bar(s) price sits at
// the entry, then withdraws it. So we CAPTURE the full trade spec the first time
// it is offered, suppress it, and re-INJECT it ourselves at the 5m boundary
// (repriced) — we cannot rely on the chain re-offering it later.
function makeFiveMTruth() {
  const pending = new Map();   // id -> { payload, packet, side, entry, seen }
  const decided = new Map();   // id -> 'released' | 'dropped'
  const stats = { released: 0, dropped: 0, repriced_worse: 0, captured: 0 };
  return {
    stats,
    fn: async (args) => {
      const truth = await bc.buildDeterministicPacketTruthFromInputs(args);
      if (OFF) return truth;

      // 1. Capture any freshly-offered packet (suppress it from the engine).
      let suppress = false;
      if (truth?.bestPacket && truth?.surfacePayload) {
        const id = truth.surfacePayload.id;
        if (decided.get(id) === "released") return truth;          // already booked; engine dedupes
        if (decided.get(id) !== "dropped" && !pending.has(id)) {
          pending.set(id, {
            payload: truth.surfacePayload,
            packet: truth.bestPacket,
            side: truth.bestPacket.side,
            entry: Number(truth.surfacePayload.entry),
            seen: 0,
          });
          stats.captured++;
        }
        suppress = true;       // never surface on the raw chain bar
      }

      // 2. At a 5m boundary, decide each pending packet against the 5m close.
      const minute = new Date(Date.parse(args.event?.ts)).getUTCMinutes();
      const isBoundary = Number.isFinite(minute) && minute % 5 === 0;
      const bars = args.inputs?.bundle?.bars?.last_5_bars;
      const close = Array.isArray(bars) && bars.length ? Number(bars[bars.length - 1].close) : NaN;
      let release = null;      // one packet may be released per bar (FIFO)
      if (isBoundary && Number.isFinite(close)) {
        for (const [id, p] of pending) {
          p.seen++;
          const holds = p.side === "short" ? close <= p.entry : close >= p.entry;
          if (holds) {
            decided.set(id, "released"); stats.released++;
            if (p.side === "short" ? close < p.entry : close > p.entry) stats.repriced_worse++;
            release = { id, p, close };
            break;             // surface one; others get the next boundary
          }
          if (p.seen >= MAX_WAIT) { decided.set(id, "dropped"); stats.dropped++; pending.delete(id); }
        }
      }
      for (const id of [...pending.keys()]) if (decided.get(id) === "released") pending.delete(id);

      // 3. Inject the released packet (entry repriced to the 5m close).
      if (release) {
        return {
          ...truth,
          bestPacket: { ...release.p.packet, entry: release.close },
          surfacePayload: { ...release.p.payload, entry: release.close },
        };
      }
      if (suppress) return { ...truth, bestPacket: null, surfacePayload: null };
      return truth;
    },
  };
}

async function fold(date, session) {
  const run = findRun(date, session); if (!run) return null;
  const runDir = path.join(BT, run, session);
  if (!fs.existsSync(path.join(runDir, "tape.json"))) return null;
  const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
  const payloads = regen(runDir, session);

  const surfaced = new Map(); const booked = []; const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") surfaced.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = surfaced.get(e.setupId) || {};
      const risk = Math.abs(Number(s.entry) - Number(s.stop));
      const signed = round2((s.side === "long" ? Number(e.exit) - Number(s.entry) : Number(s.entry) - Number(e.exit)) / (risk || 1));
      const r = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? signed : 0;
      booked.push({ t: et(s.event_ts), side: (s.side || "?")[0], add: !!s.scale_in_add, r, outcome: e.outcome });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });

  const five = makeFiveMTruth();
  const deps = {
    recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
    truthFn: five.fn,
    gradeFn: gradeOpenTrade,
  };
  const { summary } = await runBacktest({
    date: tape.date, session, mode: "auto", bus,
    stateDir: path.join(REPO_ROOT, "state", "backtest-5m"), deps,
    carryEntries: session === "ny-am" ? pmCarry(date) : [],
  });
  return { total_r: summary.total_r, booked, stats: five.stats };
}

console.log(`\n===== 5m-CONFIRMATION SIM ${OFF ? "(OFF — baseline passthrough)" : `(max_wait=${MAX_WAIT} boundaries)`} =====`);
let grand = 0, rel = 0, drop = 0, worse = 0;
const weekTotals = {};
for (const [wk, dates] of Object.entries(WEEKS)) {
  let week = 0;
  for (const date of dates) {
    for (const session of ["ny-am", "ny-pm"]) {
      const r = await fold(date, session); if (!r) continue;
      week += Number(r.total_r) || 0; rel += r.stats.released; drop += r.stats.dropped; worse += r.stats.repriced_worse;
      const detail = r.booked.map((b) => `${b.t}${b.add ? "+" : ""}${b.side}${b.r >= 0 ? "+" : ""}${b.r}`).join(" ");
      const flag = r.stats.dropped ? `  [${r.stats.dropped} dropped]` : "";
      if (r.booked.length || r.stats.dropped) console.log(`  ${date} ${session.padEnd(5)} ${String(round2(r.total_r)).padStart(7)}R  ${detail}${flag}`);
    }
  }
  weekTotals[wk] = round2(week); grand += week;
  console.log(`  ${wk.padEnd(9)} ${String(round2(week)).padStart(8)}R`);
  console.log("  " + "-".repeat(48));
}
console.log(`\n  4-WEEK TOTAL: ${round2(grand)}R   (released ${rel}, dropped ${drop}, repriced-to-worse-entry ${worse})`);
console.log(`  weeks: ${Object.entries(weekTotals).map(([k, v]) => `${k} ${v}`).join("  |  ")}`);
process.exit(0);
