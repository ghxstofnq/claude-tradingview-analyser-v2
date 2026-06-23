// scripts/validate-pillar1.mjs <date> [leader=MNQ1!] [openTime=09:50] [reactTime=11:00]
// Stage-C validation: run the REAL Stage-C bias+grade module on REAL engine
// evidence captured from the deployed schema-4 engine over replay — not the
// synthetic shapes the unit tests use. Proves the engine actually EMITS the
// dir/state/took_liq/disp_score/overnight_dir/sweeps the module assumes (the
// Stage B "engine didn't emit what I assumed" trap).
//
// TWO-PHASE, mirroring how the live system builds the bias (and the only way a
// single read can't): HTF arrays + overnight LATCH at the open (the brief; the
// arrays are fresh and near the open price there), while the open-reaction's
// "later displacement" (BIAS 38:23) and price quality confirm intraday. A
// big-trend day (D1) fills its open-area HTF arrays by 11:00 — so HTF must be
// read at the open; 06-09's reversal confirms at 10:40 — so the reaction must be
// read later. Oracle: docs/strategy/lanto-oracle.md Part D.
import * as chart from "../packages/core/chart.js";
import * as data from "../packages/core/data.js";
import * as replay from "../packages/core/replay.js";
import { disconnect } from "../packages/core/connection.js";
import { freshChartForReplay } from "../cli/lib/replay-recovery.js";
import { captureMultiTfWithHealth } from "../cli/lib/tf-capture.js";
import { findIctEngineRows, parseIctEngineTable } from "../cli/lib/ict-engine-parser.js";
import { pillar2Verdict } from "../cli/lib/pillar2-verdict.js";
import { htfVote, overnightVote, nyOpenReaction, combineBias } from "../cli/lib/pillar1-bias.js";

const [date, leader = "MNQ1!", openTime = "09:50", reactTime = "11:00"] = process.argv.slice(2);
const wd = setTimeout(() => { console.error("WD_TIMEOUT"); process.exit(1); }, 320000);
wd.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// oracle expectations (Part D). Pillar-1 produces bias + grade_cap (A+ elevation
// is Pillar 3); `clean` = requires_clean_entry (poor price → P3 makes the no-trade).
const ORACLE = {
  "2026-06-09": { bias: "bearish", grade_cap: "B", note: "D2 — B, entry→A+" },
  "2026-06-16": { bias: "bearish", grade_cap: "B", note: "B short" },
  "2026-06-17": { bias: "bearish", grade_cap: "B", note: "bearish B; no-trade via price + P3" },
  "2026-06-18": { bias: "bullish", grade_cap: "B", note: "B long; poor price + marginal entry → P3" },
  "2026-02-09": { bias: "bullish", grade_cap: "B", note: "D1 — B, multi-align→A+" },
};

// UTC ms for HH:MM America/New_York on `date` (handles EDT/EST).
function etMs(d, hh, mm) {
  const probe = new Date(`${d}T12:00:00Z`);
  const etHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(probe));
  const off = 12 - etHour; // 4 = EDT, 5 = EST
  return Date.parse(`${d}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${off === 5 ? "-05:00" : "-04:00"}`);
}
const hhmm = (t) => t.split(":").map(Number);

const J = (o) => JSON.stringify(o);
const fmt = (n) => (Number.isFinite(n) ? Number(n.toFixed(2)) : n);

// Engine-equivalent coherence from CLOSES (replay table emits na — Stage B):
// the MEDIAN trailing-6-bar 15m coherence over the open→read window.
function coh6(w) {
  let g = 0;
  for (let k = 1; k < w.length; k++) g += Math.abs(w[k] - w[k - 1]);
  return g > 0 ? Math.abs(w[w.length - 1] - w[0]) / g : null;
}
function medianCoherence(bars, { startMs, endMs }, n = 6) {
  const c = (bars || []).filter((b) => Number.isFinite(b?.close) && Number.isFinite(b?.t));
  const vals = [];
  for (let i = n; i < c.length; i++) {
    if (c[i].t < startMs || c[i].t > endMs) continue;
    const v = coh6(c.slice(i - n, i + 1).map((b) => b.close));
    if (v != null) vals.push(v);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  return Number(vals[Math.floor(vals.length / 2)].toFixed(2));
}

const deps = {
  setTimeframe: ({ timeframe }) => chart.setTimeframe({ timeframe }),
  readEngine: async () => parseIctEngineTable(findIctEngineRows(await data.getPineTables())),
  readBars: () => data.getOhlcv({ count: 5, summary: true }),
  sleep,
};

// One replay snapshot: fresh chart → anchor at `time` → capture the requested TFs
// + the quote + the 15m close series. Fresh-reload per phase avoids the 2nd-
// replay-on-same-chart wedge.
async function snapshot(time, tfs) {
  await freshChartForReplay({ leader, timeframe: "5" });
  await replay.start({ date, time }); await sleep(1500);
  await chart.setExtendedHours(true); await sleep(1200);
  const cap = await captureMultiTfWithHealth({ tfs, originalTf: "5", deps, deadlineMs: 5000 });
  let price = null;
  try { price = Number((await data.getQuote()).last); } catch { /* below */ }
  let bars15 = [];
  try {
    await chart.setTimeframe({ timeframe: "15" }); await sleep(900);
    const o = await data.getOhlcv({ count: 60, summary: false });
    bars15 = (o.bars || o.candles || o || []).map((b) => ({ close: Number(b.close), t: Number(b.time) * 1000 }));
  } catch { /* keep [] */ }
  await replay.stop();
  return { eng: cap.engine_by_tf, price, health: cap.capture_health, bars15 };
}

try {
  // Phase A — at the open: HTF arrays (fresh, near the open price) + overnight.
  const A = await snapshot(openTime, [
    { tv: "D", key: "daily" }, { tv: "240", key: "h4" }, { tv: "60", key: "h1" }, { tv: "5", key: "m5" },
  ]);
  // Phase B — later: the open-reaction (swing displacement) + price quality.
  const B = await snapshot(reactTime, [{ tv: "5", key: "m5" }, { tv: "15", key: "m15" }]);

  const openPrice = A.price;
  const htfByTf = {};
  for (const k of ["daily", "h4", "h1"]) htfByTf[k] = { top_fvgs: A.eng[k]?.fvgs ?? [], top_bprs: A.eng[k]?.bprs ?? [] };

  const qualityM5 = B.eng.m5?.quality ?? null;
  const qualityM15 = B.eng.m15?.quality ?? null;
  const [rH, rM] = hhmm(reactTime);
  const window = { startMs: etMs(date, 9, 30), endMs: etMs(date, rH, rM || 0) };
  const coh = medianCoherence(B.bars15, window);
  if (coh != null && qualityM15) qualityM15.coherence = coh;
  if (coh != null && qualityM5) qualityM5.coherence = coh;

  const hv = htfVote(htfByTf, { price: openPrice });
  const ov = overnightVote(A.eng.m5?.quality ?? null);
  const orx = nyOpenReaction({ sweeps: B.eng.m5?.sweeps ?? [], structures: B.eng.m5?.structures ?? [], window, session: "ny-am" });
  const p2 = pillar2Verdict({ m5: qualityM5, m15: qualityM15, current_tf: qualityM5 });
  const grade = combineBias({ htf: hv, overnight: ov, nyopen: orx, pillar2: p2.verdict });

  if (process.env.DUMP === "1") {
    const etOf = (ms) => (Number.isFinite(Number(ms)) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(Number(ms))) : "-");
    const zline = (z) => `${z.dir} ${z.kind} st=${z.state} tl=${z.took_liq} ds=${z.disp_score} sz=${z.size_quality} ce=${fmt(z.ce)} dist=${fmt(Number.isFinite(openPrice) ? openPrice - (z.ce ?? (z.top + z.bottom) / 2) : null)}`;
    console.log(`\n--- DUMP ${date} openPrice=${fmt(openPrice)} ---`);
    for (const k of ["daily", "h4", "h1"]) {
      console.log(` ${k} fvgs:`);
      for (const z of A.eng[k]?.fvgs ?? []) console.log(`   ${zline(z)}`);
    }
    console.log(` m5 structures (phase B):`);
    for (const s of (B.eng.m5?.structures ?? []).filter((x) => Number(x.confirmed_ms) >= window.startMs - 36e5 && Number(x.confirmed_ms) <= window.endMs)) {
      console.log(`   ${s.event} ${s.dir} ${s.tier} val=${s.validation} disp=${s.displacement} lvl=${fmt(s.level)} @${etOf(s.confirmed_ms)}`);
    }
    console.log("---\n");
  }

  const exp = ORACLE[date] || {};
  const biasOk = !exp.bias || grade.bias === exp.bias;
  const gradeOk = !exp.grade_cap || grade.grade_cap === exp.grade_cap;
  const cleanOk = exp.clean == null || grade.requires_clean_entry === exp.clean;
  const verdict = biasOk && gradeOk && cleanOk ? "PASS" : "FAIL";

  console.log("================================================================");
  console.log(`PILLAR-1 VALIDATE ${date} ${leader} openA@${openTime} reactB@${reactTime}  openPrice=${fmt(openPrice)}`);
  console.log(`  health A=${J(A.health.by_tf)} B=${J(B.health.by_tf)}`);
  console.log(`  ENGINE: overnight_dir=${A.eng.m5?.quality?.overnight_dir} net=${fmt(Number(A.eng.m5?.quality?.overnight_net))} | coherence(closes)=${coh} | range_q m5=${qualityM5?.range_quality}`);
  console.log(`  HTF draw: ${hv.draw ? `${hv.draw.tf} ${hv.draw.dir} ${hv.draw.kind} state=${hv.draw.state} tl=${hv.draw.took_liq} ds=${hv.draw.disp_score} ce=${fmt(hv.draw.ce)} dist=${fmt(hv.draw.distance_to_ce)}` : "none"} → HTF vote ${hv.vote} (${hv.reason})`);
  console.log(`  Overnight vote: ${ov.vote} (${ov.reason})`);
  console.log(`  Open reaction: ${orx.vote} via ${orx.interaction} ${orx.level ?? ""} tier=${orx.tier ?? "-"} (structs=${(B.eng.m5?.structures ?? []).length})`);
  console.log(`  Pillar 2: ${p2.verdict} (${p2.status})`);
  console.log(`  --> votes ${J(grade.votes)} | bias=${grade.bias} | ${grade.draw_bias_pillar} | grade_cap=${grade.grade_cap} | b_elevatable=${grade.b_elevatable} | requires_clean_entry=${grade.requires_clean_entry}`);
  console.log(`  ORACLE: bias=${exp.bias ?? "moot"} grade_cap=${exp.grade_cap} clean=${exp.clean ?? "-"} (${exp.note ?? ""})`);
  console.log(`  ${verdict}  (bias ${biasOk ? "ok" : "MISS"}, grade ${gradeOk ? "ok" : "MISS"}, clean ${cleanOk ? "ok" : "MISS"})`);
  console.log("================================================================");
} catch (e) {
  console.error("ERR", e?.stack || e?.message || e);
  try { await replay.stop(); } catch { /* ignore */ }
} finally {
  clearTimeout(wd);
  await disconnect();
  process.exit(0);
}
