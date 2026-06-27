import * as chart from "../packages/core/chart.js";
import * as data from "../packages/core/data.js";
import * as replay from "../packages/core/replay.js";
import { disconnect } from "../packages/core/connection.js";
import { freshChartForReplay } from "../cli/lib/replay-recovery.js";
import { findIctEngineRows, parseIctEngineTable } from "../cli/lib/ict-engine-parser.js";

// watchdog: never hang again
const watchdog = setTimeout(() => { console.error("WATCHDOG_TIMEOUT"); process.exit(1); }, 150000);
watchdog.unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { console.log(...a); };
const etOf = (s) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s * 1000));
const readEng = async () => parseIctEngineTable(findIctEngineRows(await data.getPineTables()));
async function verified(tv) {
  for (let i = 0; i < 14; i++) { const e = await readEng(); if (e?.schema_supported && (String(e.meta?.tf) === String(tv) || (tv === "D" && e.meta?.tf === "1D"))) return e; await sleep(350); }
  return await readEng();
}
const arr = (e, last) => !e?.fvgs || last == null ? [] : e.fvgs.map((f) => ({ dir: f.dir || f.kind, st: f.state, ds: f.disp_score, sz: f.size_quality, tl: f.took_liq, inv: f.inverted_ms ? 1 : 0, top: f.top, bot: f.bottom, dist: Math.min(Math.abs(last - f.top), Math.abs(last - f.bottom)) })).filter((f) => f.dist < 150).sort((a, b) => a.dist - b.dist).slice(0, 3);

try {
  log("step: fresh chart...");
  await freshChartForReplay({ leader: "MNQ1!", timeframe: "5" });
  log("step: replay.start 09:30...");
  await replay.start({ date: "2025-10-02", time: "09:30" }); await sleep(1500);
  await chart.setExtendedHours(true); await sleep(1200);
  const last = (await data.getQuote())?.last; let e0 = await readEng();
  log("open:", last, "schema:", e0?.schema);
  const out = { date: "2025-10-02", schema: e0?.schema, open: last, htf_arrays: {}, overnight: {}, levels: [], path: [], structs: [] };
  for (const [tv, k] of [["D", "daily"], ["240", "h4"], ["60", "h1"]]) {
    await chart.setTimeframe({ timeframe: tv }); await sleep(500); const e = await verified(tv); out.htf_arrays[k] = arr(e, last);
    log("htf", k, JSON.stringify(out.htf_arrays[k]));
  }
  await chart.setTimeframe({ timeframe: "5" }); await sleep(500); let e = await verified("5");
  out.overnight = { dir: e?.quality?.overnight_dir, net: e?.quality?.overnight_net };
  out.levels = (e?.levels || []).filter((l) => /AS|LO|NYAM|PD|PW/.test(l.name)).map((l) => ({ n: l.name, p: l.price, sw: l.swept }));
  log("overnight:", JSON.stringify(out.overnight), "levels:", out.levels.length);
  let prev = 0;
  for (let i = 0; i < 30; i++) {
    const q = await data.getQuote(); e = await readEng();
    out.path.push(`${etOf(q.time)}:${q.last}`);
    const ss = (e?.structures || []).slice().sort((a, b) => (a.confirmed_ms || 0) - (b.confirmed_ms || 0)); const lt = ss[ss.length - 1];
    if (lt && (lt.confirmed_ms || 0) > prev) { prev = lt.confirmed_ms || 0; out.structs.push({ at: etOf(q.time), ev: lt.event, dir: lt.dir, tier: lt.tier, lvl: lt.level, val: lt.validation, dp: lt.disp_pts }); }
    if (i % 5 === 0) log("bar", i, etOf(q.time), q.last);
    await replay.step(); await sleep(700);
  }
  e = await readEng(); out.final_arrays = arr(e, (await data.getQuote())?.last);
  log("GRADEJSON:" + JSON.stringify(out));
  await replay.stop(); await sleep(800);
} catch (err) { console.error("ERR:", err.message); try { await replay.stop(); } catch {} }
finally { clearTimeout(watchdog); await disconnect(); process.exit(0); }
