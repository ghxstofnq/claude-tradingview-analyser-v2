#!/usr/bin/env node
// Reclaim-gate re-test on the CLEAN pool.
//
// The reclaim gate was tested + rejected on 2026-06-14 against the STALE
// 71.31R 4-week baseline (targets baked into the June-13 tapes were the old
// malformed overnight_block). This re-runs it on the corrected pool: every
// session regenerates its brief from the recorded bundle with current code
// (self-healing, same as refold-gate.mjs), folds through the production engine,
// and OPTIONALLY suppresses new shorts when a recently-swept sell-side draw has
// just been reclaimed.
//
// Gate (raw price-reclaim + recency window):
//   - sell-side draws = inputs.untaken_targets.untaken_below (the below-price
//     draw targets). Captured into a tracking map (they drop off the list once
//     taken, so we keep our own copy).
//   - SWEPT  when a bar low trades below the level.
//   - RECLAIMED when, after a sweep, a bar closes back above the level → records
//     the reclaim time.
//   - A new SHORT packet surfacing within RECLAIM_WINDOW_MIN of a reclaim is
//     blocked (and stays blocked — a true block, not a delay).
//
//   node scripts/reclaim-gate-test.mjs                  # baseline, no gate
//   RECLAIM_WINDOW_MIN=15 node scripts/reclaim-gate-test.mjs   # 15-min gate
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

const WINDOW_MIN = Number(process.env.RECLAIM_WINDOW_MIN || 0);
const WINDOW_MS = WINDOW_MIN * 60_000;
// STRUCT_CONFIRM=1 → only block when a bullish structure shift confirms the
// reclaim (a swept sell-side draw reclaimed AND a bullish MSS/BoS printed after
// the sweep). Spares trend-pullback reclaims (June 9) that lack a bullish flip.
const STRUCT_CONFIRM = process.env.STRUCT_CONFIRM === "1";
// TWO_SIDED=1 → also block LONGS after a buy-side draw is swept (high pokes
// above) then reclaimed bearishly (close back below) — the mirror of the
// short gate.
const TWO_SIDED = process.env.TWO_SIDED === "1";
// Which bullish events count as confirmation. Default: swing-tier only (real
// reversal; internal-tier fires on every pullback). STRUCT_TIER=any to include
// internal. STRUCT_MSS_ONLY=1 to require MSS (drop BoS continuations).
const STRUCT_TIER = process.env.STRUCT_TIER || "swing";
const STRUCT_MSS_ONLY = process.env.STRUCT_MSS_ONLY === "1";

function hasStructConfirm(inputs, dir, sinceMs, untilMs) {
  const evs = inputs.bundle?.gates?.engine?.pillar3?.structure_events ?? [];
  return evs.some((e) => {
    if (e.dir !== dir) return false;
    if (STRUCT_MSS_ONLY && e.event !== "mss") return false;
    if (STRUCT_TIER === "swing" && e.tier !== "swing") return false;
    const cms = Number(e.confirmed_ms);
    if (!Number.isFinite(cms) || cms < sinceMs || cms > untilMs) return false;
    return e.is_reclaimed !== true; // the flip must still be standing
  });
}
const hasBullConfirm = (inputs, s, u) => hasStructConfirm(inputs, "bull", s, u);
const hasBearConfirm = (inputs, s, u) => hasStructConfirm(inputs, "bear", s, u);

const WEEKS = {
  "May18-22": ["2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21", "2026-05-22"],
  "May25-29": ["2026-05-25", "2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29"],
  "Jun1-5":   ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"],
  "Jun8-12":  ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12"],
};
// Pin the frozen June runs so the baseline matches refold-baseline.json exactly.
const PIN = {
  "2026-06-09:ny-am": "20260612-212913-am-2026-06-09",
  "2026-06-10:ny-am": "20260612-213101-am-2026-06-10",
  "2026-06-11:ny-am": "20260612-213401-am-2026-06-11",
  "2026-06-11:ny-pm": "20260612-213639-pm-2026-06-11",
};

function findRun(date, session) {
  const k = `${date}:${session}`;
  if (PIN[k]) return PIN[k];
  const tag = `-${session.replace("ny-", "")}-${date}`;
  return fs.readdirSync(BT).filter((d) => d.includes(tag)).sort().pop();
}
function round2(n) { return Math.round(n * 100) / 100; }
function round25(n) { return Math.round(n * 4) / 4; }

// Regenerate the full brief from the recorded bundle (clean, end-to-end).
function regenPayloads(runDir, session) {
  const recorded = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8"));
  const bundlePath = path.join(runDir, "brief-bundle.json");
  if (!fs.existsSync(bundlePath)) return recorded;
  const leader = recorded[0]?.symbol || "MNQ1!";
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const digest = buildBriefDigest({ pair: { symbols: { [leader]: bundle } } });
  return buildDirectSessionBriefPayloads({ session, bundle: { ...bundle, brief_digest: digest }, symbols: [leader] });
}

function pmCarry(date) {
  const run = findRun(date, "ny-pm"); if (!run) return [];
  try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; }
  catch { return []; }
}

// Wrap the production truth fn with the reclaim gate. Closure holds per-fold
// sweep/reclaim state. When WINDOW_MS===0 the wrapper is a pure pass-through.
function makeGatedTruth() {
  const below = new Map();      // sell-side draws -> { price, state, sweptMs }
  const above = new Map();      // buy-side draws  -> { price, state, sweptMs }
  let lastReclaimDn = null;     // sell-side reclaim (bullish) -> blocks SHORTS
  let lastReclaimUp = null;     // buy-side reclaim (bearish)  -> blocks LONGS
  const blockedIds = new Set();
  let blockedCount = 0;

  return {
    blockedCount: () => blockedCount,
    fn: async (args) => {
      const truth = await bc.buildDeterministicPacketTruthFromInputs(args);
      if (!WINDOW_MS) return truth;

      const inputs = args.inputs || {};
      const bars = inputs.bundle?.bars?.last_5_bars;
      const bar = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null;
      if (bar) {
        const barMs = Number(bar.time) * 1000;
        const high = Number(bar.high), low = Number(bar.low), close = Number(bar.close);
        // Capture draws into trackers (they vanish from the list once taken).
        for (const lv of inputs.untaken_targets?.untaken_below ?? []) {
          const key = String(round25(Number(lv.price)));
          if (Number.isFinite(Number(lv.price)) && !below.has(key)) below.set(key, { price: Number(lv.price), state: "armed", sweptMs: 0 });
        }
        for (const lv of inputs.untaken_targets?.untaken_above ?? []) {
          const key = String(round25(Number(lv.price)));
          if (Number.isFinite(Number(lv.price)) && !above.has(key)) above.set(key, { price: Number(lv.price), state: "armed", sweptMs: 0 });
        }
        // Sell-side: swept (low<L) then reclaimed (close>L) = bullish rejection.
        for (const lv of below.values()) {
          if (low < lv.price) { lv.state = "swept"; lv.sweptMs = barMs; }
          else if (lv.state === "swept" && close > lv.price) { lv.state = "armed"; lastReclaimDn = { reclaimMs: barMs, sweepMs: lv.sweptMs }; }
        }
        // Buy-side: swept (high>L) then reclaimed (close<L) = bearish rejection.
        for (const lv of above.values()) {
          if (high > lv.price) { lv.state = "swept"; lv.sweptMs = barMs; }
          else if (lv.state === "swept" && close < lv.price) { lv.state = "armed"; lastReclaimUp = { reclaimMs: barMs, sweepMs: lv.sweptMs }; }
        }
        const side = truth?.bestPacket?.side;
        const reclaim = side === "short" ? lastReclaimDn : (side === "long" && TWO_SIDED) ? lastReclaimUp : null;
        if (reclaim) {
          const id = truth.surfacePayload?.id;
          let gateActive = (barMs - reclaim.reclaimMs) <= WINDOW_MS && barMs >= reclaim.reclaimMs;
          if (gateActive && STRUCT_CONFIRM) {
            gateActive = side === "short"
              ? hasBullConfirm(inputs, reclaim.sweepMs, barMs)
              : hasBearConfirm(inputs, reclaim.sweepMs, barMs);
          }
          if (gateActive) blockedIds.add(id);
          if (blockedIds.has(id)) {
            blockedCount++;
            return { ...truth, bestPacket: null, surfacePayload: null };
          }
        }
      }
      return truth;
    },
  };
}

const et = (ts) => { const d = new Date(ts); return String((d.getUTCHours() + 20) % 24).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };

async function fold(date, session) {
  const run = findRun(date, session); if (!run) return null;
  const runDir = path.join(BT, run, session);
  if (!fs.existsSync(path.join(runDir, "tape.json"))) return null;
  const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
  const payloads = regenPayloads(runDir, session);

  const surfaced = new Map(); const booked = [];
  const bus = new EventEmitter();
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

  const gate = makeGatedTruth();
  const deps = {
    recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
    truthFn: gate.fn,
    gradeFn: gradeOpenTrade,
  };
  const { summary } = await runBacktest({
    date: tape.date, session, mode: "auto", bus,
    stateDir: path.join(REPO_ROOT, "state", "backtest-reclaim"), deps,
    carryEntries: session === "ny-am" ? pmCarry(date) : [],
  });
  return { total_r: summary.total_r, booked, blocked: gate.blockedCount() };
}

const modeTag = !WINDOW_MIN ? "BASELINE — no gate"
  : STRUCT_CONFIRM ? `${WINDOW_MIN}-min + STRUCT-CONFIRM (tier=${STRUCT_TIER}${STRUCT_MSS_ONLY ? ",mss-only" : ""})`
  : `${WINDOW_MIN}-min RAW`;
console.log(`\n===== RECLAIM GATE (${modeTag}) =====`);
let grand = 0, totalBlocked = 0;
const weekTotals = {};
for (const [wk, dates] of Object.entries(WEEKS)) {
  let week = 0, wkBlocked = 0;
  for (const date of dates) {
    for (const session of ["ny-am", "ny-pm"]) {
      const r = await fold(date, session); if (!r) continue;
      week += Number(r.total_r) || 0; wkBlocked += r.blocked;
      const detail = r.booked.map((b) => `${b.t}${b.add ? "+" : ""}${b.side}${b.r >= 0 ? "+" : ""}${b.r}`).join(" ");
      const flag = r.blocked ? `  [${r.blocked} blocked]` : "";
      if (r.booked.length || r.blocked) console.log(`  ${date} ${session.padEnd(5)} ${String(round2(r.total_r)).padStart(7)}R  ${detail}${flag}`);
    }
  }
  weekTotals[wk] = round2(week); grand += week; totalBlocked += wkBlocked;
  console.log(`  ${wk.padEnd(9)} ${String(round2(week)).padStart(8)}R${wkBlocked ? `   (${wkBlocked} shorts blocked)` : ""}`);
  console.log("  " + "-".repeat(48));
}
console.log(`\n  4-WEEK TOTAL: ${round2(grand)}R   ${totalBlocked} shorts blocked total`);
console.log(`  weeks: ${Object.entries(weekTotals).map(([k, v]) => `${k} ${v}`).join("  |  ")}`);
process.exit(0);
