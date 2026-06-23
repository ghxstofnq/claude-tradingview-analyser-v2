// scripts/calib-pillar2.mjs — Stage-B pillar2 calibration probe.
// Steps a session at one TF and logs the schema-4 quality row + rowVerdict per
// bar, so the good/marginal/poor boundary can be checked against the oracle.
// usage: node scripts/calib-pillar2.mjs <date> <tf> [start=09:00] [bars=30] [leader=MNQ1!]
import * as chart from "../packages/core/chart.js";
import * as data from "../packages/core/data.js";
import * as replay from "../packages/core/replay.js";
import { disconnect } from "../packages/core/connection.js";
import { freshChartForReplay } from "../cli/lib/replay-recovery.js";
import { findIctEngineRows, parseIctEngineTable } from "../cli/lib/ict-engine-parser.js";
import { rowVerdict, pillar2Verdict } from "../cli/lib/pillar2-verdict.js";

const [date, tf = "5", start = "09:00", barsN = "30", leader = "MNQ1!"] = process.argv.slice(2);
const watchdog = setTimeout(() => { console.error("WATCHDOG_TIMEOUT"); process.exit(1); }, 240000);
watchdog.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etOf = (s) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s * 1000));
const readEng = async () => parseIctEngineTable(findIctEngineRows(await data.getPineTables()));

try {
  // NOTE: reads coherence only once the coherence Pine is SAVED on the chart
  // (a page reload here reverts a CDP-only deploy — deploy-pine-persistence-
  // gotcha; the on-chart study must be persisted via a manual "Save and add to
  // chart" first, else `coherence` reads null/undefined post-reload).
  console.log(`fresh ${leader} ${tf}m, replay ${date} ${start}...`);
  await freshChartForReplay({ leader, timeframe: tf });
  await replay.start({ date, time: start }); await sleep(1500);
  await chart.setExtendedHours(true); await sleep(1200);
  const out = { date, tf, leader, rows: [] };
  const N = parseInt(barsN, 10);
  for (let i = 0; i < N; i++) {
    const q = await data.getQuote(); const e = await readEng();
    const qr = e?.quality || null;
    const v = rowVerdict(qr);
    // The real session verdict the gate would produce from THIS TF's row: the
    // coherence gate reads the 15m row, so feed it as m15 on a 15m run.
    const sv = pillar2Verdict(tf === "15" ? { m15: qr } : { m5: qr }).verdict;
    out.rows.push({
      et: etOf(q.time), c: q.last, metaTf: e?.meta?.tf ?? null,
      range_quality: qr?.range_quality ?? null, displacement: qr?.displacement ?? null,
      candle: qr?.candle ?? null, regime: qr?.regime ?? null, coherence: qr?.coherence ?? null,
      rvn: qr?.range_vs_normal ?? null, range_3h: qr?.range_3h ?? null, v, sv,
    });
    if (i % 6 === 0) console.log("bar", i, etOf(q.time), q.last, "sv=", sv, "coh=", qr?.coherence, "|", qr?.displacement, qr?.candle, "| metaTf", e?.meta?.tf);
    await replay.step(); await sleep(450);
  }
  const win = out.rows.filter((r) => r.et >= "09:30" && r.et <= "11:30");
  const tally = (rows, key) => rows.reduce((m, r) => { m[r[key]] = (m[r[key]] || 0) + 1; return m; }, {});
  const cohs = win.map((r) => r.coherence).filter((c) => typeof c === "number").sort((a, b) => a - b);
  const med = cohs.length ? cohs[Math.floor(cohs.length / 2)] : null;
  console.log("TALLY 0930-1130 sv:", JSON.stringify(tally(win, "sv")), "| coherence med:", med, "range:", cohs[0], "-", cohs[cohs.length - 1]);
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(new URL("./calib-out/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`./calib-out/${date}-${tf}m.json`, import.meta.url), JSON.stringify(out));
  console.log("CALIBJSON_WRITTEN", `scripts/calib-out/${date}-${tf}m.json`);
  await replay.stop(); await sleep(800);
} catch (err) { console.error("ERR:", err.message); try { await replay.stop(); } catch {} }
finally { clearTimeout(watchdog); await disconnect(); process.exit(0); }
