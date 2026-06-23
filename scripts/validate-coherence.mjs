// scripts/validate-coherence.mjs <date> [leader=MNQ1!] [endTime=12:00]
// Validate the Pillar-2 coherence field on a session WITHOUT depending on the
// engine table (which wedges on some replay dates). Pulls 15m CLOSES via
// getOhlcv (wedge-robust — closes tick even when the indicator pane freezes) and
// computes the engine-equivalent coherence = net move / gross path over a 6-bar
// (1.5h) 15m window — the same formula pine/ict-engine.pine emits, confirmed to
// match the live engine on 06-16/06-17 to the decimal. Reports the median
// verdict over the 09:30-11:30 NY-AM window.
import * as chart from "../packages/core/chart.js";
import * as data from "../packages/core/data.js";
import * as replay from "../packages/core/replay.js";
import { disconnect } from "../packages/core/connection.js";
import { freshChartForReplay } from "../cli/lib/replay-recovery.js";

const [date, leader = "MNQ1!", endTime = "12:00"] = process.argv.slice(2);
const wd = setTimeout(() => { console.error("WD_TIMEOUT"); process.exit(1); }, 160000);
wd.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etOf = (s) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s * 1000));
const COH_GOOD = 0.55, COH_POOR = 0.30, N = 6;
const V = (c) => (c == null ? null : c <= COH_POOR ? "poor" : c >= COH_GOOD ? "good" : "marginal");

try {
  await freshChartForReplay({ leader, timeframe: "15" });
  await replay.start({ date, time: endTime }); await sleep(1500);
  await chart.setExtendedHours(true); await sleep(1200);
  const o = await data.getOhlcv({ count: 80, summary: false });
  const raw = o.bars || o.candles || o;
  const bars = raw.map((b) => ({ c: b.close, et: etOf(b.time) }));
  const rows = [];
  for (let i = N; i < bars.length; i++) {
    const w = bars.slice(i - N, i + 1).map((b) => b.c);
    let g = 0; for (let k = 1; k < w.length; k++) g += Math.abs(w[k] - w[k - 1]);
    const coh = g > 0 ? Math.abs(w[w.length - 1] - w[0]) / g : null;
    rows.push({ et: bars[i].et, coh, v: V(coh) });
  }
  const win = rows.filter((r) => r.et >= "09:30" && r.et <= "11:30" && r.coh != null);
  const cohs = win.map((r) => r.coh).sort((a, b) => a - b);
  const med = cohs.length ? cohs[Math.floor(cohs.length / 2)] : null;
  const tally = win.reduce((m, r) => { m[r.v] = (m[r.v] || 0) + 1; return m; }, {});
  console.log(`VALIDATE ${date} ${leader} | median coh=${med == null ? "n/a" : med.toFixed(2)} verdict=${V(med)} | bars=${win.length} tally=${JSON.stringify(tally)} | range ${cohs[0]?.toFixed(2)}-${cohs[cohs.length - 1]?.toFixed(2)}`);
  await replay.stop();
} catch (e) { console.error("ERR", e.message); try { await replay.stop(); } catch {} }
finally { clearTimeout(wd); await disconnect(); process.exit(0); }
