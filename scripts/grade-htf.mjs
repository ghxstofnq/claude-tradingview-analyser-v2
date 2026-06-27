// HTF-vote audit probe: re-derive HTF from arrays+reaction (NOT structure).
// usage: node scripts/grade-htf.mjs <date> [time=09:30] [leader=MNQ1!] [bars=18]
import * as chart from "../packages/core/chart.js";
import * as data from "../packages/core/data.js";
import * as replay from "../packages/core/replay.js";
import { disconnect } from "../packages/core/connection.js";
import { freshChartForReplay } from "../cli/lib/replay-recovery.js";
import { findIctEngineRows, parseIctEngineTable } from "../cli/lib/ict-engine-parser.js";

const [date, time = "09:30", leader = "MNQ1!", barsN = "18"] = process.argv.slice(2);
if (!date) { console.error("need a date"); process.exit(1); }

const watchdog = setTimeout(() => { console.error("WATCHDOG_TIMEOUT"); process.exit(1); }, 150000);
watchdog.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const etOf = (s) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s * 1000));
const readEng = async () => parseIctEngineTable(findIctEngineRows(await data.getPineTables()));
async function verified(tv) {
  for (let i = 0; i < 14; i++) { const e = await readEng(); if (e?.schema_supported && (String(e.meta?.tf) === String(tv) || (tv === "D" && e.meta?.tf === "1D"))) return e; await sleep(350); }
  return await readEng();
}
// near-price arrays (FVG/iFVG): the ONLY HTF primitive that votes
const arr = (e, last) => !e?.fvgs || last == null ? [] : e.fvgs.map((f) => ({ dir: f.dir || f.kind, st: f.state, ds: f.disp_score, sz: f.size_quality, tl: f.took_liq, inv: f.inverted_ms ? 1 : 0, top: f.top, bot: f.bottom, dist: Math.round(Math.min(Math.abs(last - f.top), Math.abs(last - f.bottom)) * 100) / 100 })).filter((f) => f.dist < 250).sort((a, b) => a.dist - b.dist).slice(0, 4);
// most-recent structure (what the OLD read leaned on — for contrast only)
const lastStruct = (e) => { const s = e?.structures || []; if (!s.length) return null; const x = s[s.length - 1]; return { ev: x.event, dir: x.dir, tier: x.tier, lvl: x.level, dp: x.disp_pts, val: x.validation, recl: x.is_reclaimed }; };

try {
  log(`step: fresh chart ${leader}...`);
  await freshChartForReplay({ leader, timeframe: "5" });
  log(`step: replay.start ${date} ${time}...`);
  await replay.start({ date, time }); await sleep(1500);
  await chart.setExtendedHours(true); await sleep(1200);
  const last = (await data.getQuote())?.last; const e0 = await readEng();
  log("open:", last, "schema:", e0?.schema);
  const out = { date, leader, schema: e0?.schema, open: last, htf_arrays: {}, htf_struct: {}, overnight: {}, levels: [], open_reaction: [], structs: [] };
  for (const [tv, k] of [["D", "daily"], ["240", "h4"], ["60", "h1"]]) {
    await chart.setTimeframe({ timeframe: tv }); await sleep(500); const e = await verified(tv);
    out.htf_arrays[k] = arr(e, last); out.htf_struct[k] = lastStruct(e);
    log("htf", k, "arrays:", JSON.stringify(out.htf_arrays[k]), "| struct:", JSON.stringify(out.htf_struct[k]));
  }
  await chart.setTimeframe({ timeframe: "5" }); await sleep(500); let e = await verified("5");
  out.overnight = { dir: e?.quality?.overnight_dir, net: e?.quality?.overnight_net };
  out.levels = (e?.levels || []).filter((l) => /AS|LO|NYAM|PD|PW/.test(l.name)).map((l) => ({ n: l.name, p: l.price, sw: l.swept }));
  log("overnight:", JSON.stringify(out.overnight), "levels:", out.levels.length);
  const N = parseInt(barsN, 10); let prev = 0;
  for (let i = 0; i < N; i++) {
    const q = await data.getQuote(); e = await readEng();
    if (i < 12) out.open_reaction.push({ et: etOf(q.time), c: q.last, fvg: arr(e, q.last).slice(0, 2) });
    const ss = (e?.structures || []).slice().sort((a, b) => (a.confirmed_ms || 0) - (b.confirmed_ms || 0)); const lt = ss[ss.length - 1];
    if (lt && (lt.confirmed_ms || 0) > prev) { prev = lt.confirmed_ms || 0; out.structs.push({ at: etOf(q.time), ev: lt.event, dir: lt.dir, tier: lt.tier, lvl: lt.level, val: lt.validation, dp: lt.disp_pts }); }
    if (i % 5 === 0) log("bar", i, etOf(q.time), q.last);
    await replay.step(); await sleep(700);
  }
  e = await readEng(); out.final_arrays = arr(e, (await data.getQuote())?.last);
  log("HTFJSON:" + JSON.stringify(out));
  await replay.stop(); await sleep(800);
} catch (err) { console.error("ERR:", err.message); try { await replay.stop(); } catch {} }
finally { clearTimeout(watchdog); await disconnect(); process.exit(0); }
