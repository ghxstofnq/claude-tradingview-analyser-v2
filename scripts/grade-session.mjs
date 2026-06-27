// Full-session setup-finder. usage: node scripts/grade-session.mjs <date> [start=08:00] [leader=MNQ1!] [bars=220]
import * as chart from "../packages/core/chart.js";
import * as data from "../packages/core/data.js";
import * as replay from "../packages/core/replay.js";
import { disconnect } from "../packages/core/connection.js";
import { freshChartForReplay } from "../cli/lib/replay-recovery.js";
import { findIctEngineRows, parseIctEngineTable } from "../cli/lib/ict-engine-parser.js";

const [date, start = "08:00", leader = "MNQ1!", barsN = "220", tf = "1"] = process.argv.slice(2);
const watchdog = setTimeout(() => { console.error("WATCHDOG_TIMEOUT"); process.exit(1); }, 270000);
watchdog.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const etOf = (s) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s * 1000));
const readEng = async () => parseIctEngineTable(findIctEngineRows(await data.getPineTables()));
// nearest fresh/ce_tapped/tapped FVG of a given dir within band (the entry-relevant arrays)
const near = (e, last, dir) => !e?.fvgs || last == null ? null : e.fvgs.filter((f) => (f.dir || f.kind) === dir && ["fresh", "ce_tapped", "tapped"].includes(f.state) && Math.min(Math.abs(last - f.top), Math.abs(last - f.bottom)) < 45).map((f) => ({ st: f.state, bot: f.bottom, top: f.top, ce: f.ce, tl: f.took_liq, ds: f.disp_score })).sort((a, b) => Math.abs(last - (a.ce ?? a.top)) - Math.abs(last - (b.ce ?? b.top)))[0] || null;

try {
  log(`fresh ${leader} 1m, replay ${date} ${start}...`);
  await freshChartForReplay({ leader, timeframe: tf });
  await replay.start({ date, time: start }); await sleep(1500);
  await chart.setExtendedHours(true); await sleep(1200);
  const out = { date, leader, structs: [], rows: [] };
  let prev = 0; const N = parseInt(barsN, 10);
  for (let i = 0; i < N; i++) {
    const q = await data.getQuote(); const e = await readEng();
    const b = near(e, q.last, "bull"), s = near(e, q.last, "bear");
    out.rows.push({ et: etOf(q.time), c: q.last, bull: b, bear: s });
    const ss = (e?.structures || []).slice().sort((a, b2) => (a.confirmed_ms || 0) - (b2.confirmed_ms || 0)); const lt = ss[ss.length - 1];
    if (lt && (lt.confirmed_ms || 0) > prev) { prev = lt.confirmed_ms || 0; out.structs.push({ at: etOf(q.time), ev: lt.event, dir: lt.dir, tier: lt.tier, lvl: lt.level, val: lt.validation, dp: lt.disp_pts }); }
    if (i % 20 === 0) log("bar", i, etOf(q.time), q.last);
    await replay.step(); await sleep(420);
  }
  const o = await data.getOhlcv({ count: N + 12, summary: false }); const bars = o.bars || o.candles || o;
  out.ohlc = bars.map((b) => ({ et: etOf(b.time), o: b.open, h: b.high, l: b.low, c: b.close }));
  const e = await readEng(); const last = (await data.getQuote())?.last;
  out.levels = (e?.levels || []).filter((l) => /AS|LO|NYAM|PD|PW/.test(l.name)).map((l) => ({ n: l.name, p: l.price, sw: l.swept }));
  log("SESSJSON:" + JSON.stringify(out));
  await replay.stop(); await sleep(800);
} catch (err) { console.error("ERR:", err.message); try { await replay.stop(); } catch {} }
finally { clearTimeout(watchdog); await disconnect(); process.exit(0); }
