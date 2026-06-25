// tune-leader-metric.mjs — A/B candidate leader metrics against the 9-session
// paired corpus (no TV). For each session it computes, per symbol, the open
// (first 30 min) window stats and four candidate "who is leading" metrics, then
// sweeps a relative margin and reports which (metric, threshold) best matches
// Lanto's actual instrument pick WITHOUT flipping the 4 MNQ-led days to MES.
//
// Metrics (per symbol, open window):
//   disp(current) = max fresh-FVG disp_score in window (compute-leader.js today)
//   range/ATR     = (window high − window low) / ATR_14
//   net/ATR       = |window close − window open| / ATR_14   (directional displacement)
//   leg/ATR       = (engine leg_high − leg_low) / ATR_14    (V3 leg extremes)
//
// Leader = symbol with the higher metric; INCONCLUSIVE → MNQ fallback when the
// two are within `relMargin` of each other (relative, so it's comparable across
// metrics of different scale). 9 sessions / 4 MES days is a TINY sample — read
// this as direction, not proof; do NOT curve-fit a threshold to one day.
//
// Usage: node scripts/tune-leader-metric.mjs

import fs from "node:fs";
import { computeLeader } from "../cli/lib/compute-leader.js";

const PRIMARY = "MNQ1!";
const SECONDARY = "MES1!";
const T = "tests/tapes";
const SESSIONS = [
  { date: "2026-06-16", mnq: `${T}/2026-06-16-ny-am-replay.tape.json`, mes: `${T}/2026-06-16-mes-ny-am-replay.tape.json`, lanto: "MNQ short" },
  { date: "2026-06-09", mnq: `${T}/2026-06-09-ny-am-replay.tape.json`, mes: `${T}/2026-06-09-mes-ny-am-replay.tape.json`, lanto: "MNQ short" },
  { date: "2026-06-17", mnq: `${T}/2026-06-17-ny-am-replay.tape.json`, mes: `${T}/2026-06-17-mes-ny-am-replay.tape.json`, lanto: "no-trade" },
  { date: "2026-06-18", mnq: `${T}/2026-06-18-ny-am-replay.tape.json`, mes: `${T}/2026-06-18-mes-ny-am-replay.tape.json`, lanto: "MNQ long" },
  { date: "2026-02-09", mnq: `${T}/2026-02-09-ny-am-replay.tape.json`, mes: `${T}/2026-02-09-mes-ny-am-replay.tape.json`, lanto: "MNQ long" },
  { date: "2026-01-29", mnq: `${T}/2026-01-29-ny-am-replay.tape.json`, mes: `${T}/2026-01-29-mes-ny-am-replay.tape.json`, lanto: "MES short" },
  { date: "2026-06-15", mnq: `${T}/2026-06-15-ny-am-replay.tape.json`, mes: `${T}/2026-06-15-mes-ny-am-replay.tape.json`, lanto: "MES long" },
  { date: "2026-04-06", mnq: `${T}/2026-04-06-ny-am-replay.tape.json`, mes: `${T}/2026-04-06-mes-ny-am-replay.tape.json`, lanto: "MES long" },
  { date: "2026-06-22", mnq: `${T}/2026-06-22-ny-am-replay.tape.json`, mes: `${T}/2026-06-22-mes-ny-am-replay.tape.json`, lanto: "MES long" },
];

const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const n2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const want = (lp) => (lp.startsWith("MES") ? "MES" : lp.startsWith("MNQ") ? "MNQ" : null);

function windowStats(tape) {
  const windowStart = Date.parse(tape.entries[0].event.ts);
  const windowEnd = windowStart + 30 * 60 * 1000;
  let hi = -Infinity, lo = Infinity, openP = null, closeP = null, eng = null;
  for (const e of tape.entries) {
    const ms = Date.parse(e.event.ts);
    if (ms < windowStart || ms > windowEnd) continue;
    const lb = e.inputs?.bundle?.bars?.last_5_bars;
    const bar = lb && lb[lb.length - 1];
    if (!bar) continue;
    if (openP == null) openP = bar.open;
    closeP = bar.close;
    hi = Math.max(hi, bar.high);
    lo = Math.min(lo, bar.low);
    eng = e.inputs?.bundle?.engine;
  }
  const atr = Number(eng?.quality?.atr_14);
  const legHi = Number(eng?.quality?.leg_high);
  const legLo = Number(eng?.quality?.leg_low);
  const ok = Number.isFinite(atr) && atr > 0;
  return {
    windowStart, windowEnd, eng,
    rangeATR: ok && Number.isFinite(hi) && Number.isFinite(lo) ? (hi - lo) / atr : null,
    netATR: ok && openP != null && closeP != null ? Math.abs(closeP - openP) / atr : null,
    legATR: ok && Number.isFinite(legHi) && Number.isFinite(legLo) ? (legHi - legLo) / atr : null,
  };
}

// Relative pick: leader = higher value, but MNQ fallback when within relMargin.
function pickRel(mnqVal, mesVal, relMargin) {
  if (mnqVal == null || mesVal == null) return PRIMARY;
  const hi = Math.max(mnqVal, mesVal), lo = Math.min(mnqVal, mesVal);
  if (hi <= 0) return PRIMARY;
  if ((hi - lo) / hi < relMargin) return PRIMARY;
  return mnqVal > mesVal ? PRIMARY : SECONDARY;
}

const rows = [];
for (const s of SESSIONS) {
  const mnq = load(s.mnq), mes = load(s.mes);
  const wm = windowStats(mnq), we = windowStats(mes);
  const cl = computeLeader({
    primary: PRIMARY, secondary: SECONDARY,
    primaryEngine: wm.eng, secondaryEngine: we.eng,
    windowStartMs: wm.windowStart, windowEndMs: wm.windowEnd,
  });
  rows.push({
    date: s.date, lanto: s.lanto, want: want(s.lanto),
    disp: [cl.primary_disp_score, cl.secondary_disp_score],
    range: [wm.rangeATR, we.rangeATR],
    net: [wm.netATR, we.netATR],
    leg: [wm.legATR, we.legATR],
  });
}

const METRICS = [["disp(cur)", "disp"], ["range/ATR", "range"], ["net/ATR", "net"], ["leg/ATR", "leg"]];

console.log("=== PER-SESSION METRIC VALUES (MNQ vs MES, open 30-min window) ===\n");
console.log(["date", "Lanto", ...METRICS.map((m) => m[0])].map((s) => String(s).padEnd(13)).join(""));
for (const r of rows) {
  const cells = METRICS.map(([, k]) => `${n2(r[k][0])}/${n2(r[k][1])}`);
  console.log([r.date, r.want ?? "no-tr", ...cells].map((s) => String(s).padEnd(13)).join(""));
}

console.log("\n=== MATCH vs LANTO by metric × relative margin (8 decision days; MNQ-flips = MNQ days wrongly sent to MES) ===\n");
const decision = rows.filter((r) => r.want != null);
const mnqDays = decision.filter((r) => r.want === "MNQ");
const THRESH = [0, 0.05, 0.1, 0.15, 0.2, 0.3];
for (const [label, key] of METRICS) {
  console.log(label);
  for (const t of THRESH) {
    let match = 0;
    let flips = 0;
    const picks = [];
    for (const r of decision) {
      const pick = pickRel(r[key][0], r[key][1], t);
      const got = pick === SECONDARY ? "MES" : "MNQ";
      if (got === r.want) match += 1;
      if (r.want === "MNQ" && got === "MES") flips += 1;
      picks.push(`${r.date.slice(5)}:${got}${got === r.want ? "✓" : "✗"}`);
    }
    console.log(`  margin ${t.toFixed(2)} → ${match}/8 match · ${flips} MNQ-flip${flips === 1 ? "" : "s"}   [${picks.join(" ")}]`);
  }
  console.log("");
}
console.log(`MNQ-led days (must stay MNQ): ${mnqDays.map((r) => r.date.slice(5)).join(", ")}`);
console.log("MES-led days (the switch test): 01-29, 06-15, 04-06, 06-22");
console.log("\n⚠ 9 sessions / 4 MES days is tiny — read direction, not proof. Don't curve-fit one day.");
