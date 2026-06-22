// 1m entry-pin probe. usage: node scripts/grade-1m.mjs <date> <start HH:MM> <leader> <bars>
import * as chart from "../packages/core/chart.js";
import * as data from "../packages/core/data.js";
import * as replay from "../packages/core/replay.js";
import { disconnect } from "../packages/core/connection.js";
import { freshChartForReplay } from "../cli/lib/replay-recovery.js";
import { findIctEngineRows, parseIctEngineTable } from "../cli/lib/ict-engine-parser.js";

const [date, start = "09:45", leader = "MNQ1!", barsN = "80"] = process.argv.slice(2);
const watchdog = setTimeout(() => { console.error("WATCHDOG_TIMEOUT"); process.exit(1); }, 150000);
watchdog.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const etOf = (s) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s * 1000));
const readEng = async () => parseIctEngineTable(findIctEngineRows(await data.getPineTables()));
const nearBear = (e, last) => !e?.fvgs || last == null ? [] : e.fvgs.filter((f) => (f.dir || f.kind) === "bear" && Math.min(Math.abs(last - f.top), Math.abs(last - f.bottom)) < 30).map((f) => ({ st: f.state, top: f.top, bot: f.bottom, ce: f.ce, inv: f.inverted_ms ? 1 : 0, tl: f.took_liq, ds: f.disp_score })).slice(0, 2);

try {
  log(`fresh ${leader} 1m...`);
  await freshChartForReplay({ leader, timeframe: "1" });
  await replay.start({ date, time: start }); await sleep(1500);
  await chart.setExtendedHours(true); await sleep(1200);
  const out = { date, leader, tf: "1m", bars: [], structs: [] };
  let prev = 0; const N = parseInt(barsN, 10);
  for (let i = 0; i < N; i++) {
    const q = await data.getQuote(); const e = await readEng();
    out.bars.push({ et: etOf(q.time), c: q.last, bear: nearBear(e, q.last) });
    const ss = (e?.structures || []).slice().sort((a, b) => (a.confirmed_ms || 0) - (b.confirmed_ms || 0)); const lt = ss[ss.length - 1];
    if (lt && (lt.confirmed_ms || 0) > prev) { prev = lt.confirmed_ms || 0; out.structs.push({ at: etOf(q.time), ev: lt.event, dir: lt.dir, tier: lt.tier, lvl: lt.level, val: lt.validation, dp: lt.disp_pts }); }
    if (i % 10 === 0) log("bar", i, etOf(q.time), q.last);
    await replay.step(); await sleep(650);
  }
  const o = await data.getOhlcv({ count: N + 10, summary: false }); const bars = o.bars || o.candles || o;
  out.ohlc = bars.map((b) => ({ et: etOf(b.time), o: b.open, h: b.high, l: b.low, c: b.close }));
  const e = await readEng(); const last = (await data.getQuote())?.last;
  out.untaken_below = (e?.levels || []).filter((l) => !l.swept && l.price < last).map((l) => ({ n: l.name, p: l.price })).sort((a, b) => b.p - a.p);
  log("ONEJSON:" + JSON.stringify(out));
  await replay.stop(); await sleep(800);
} catch (err) { console.error("ERR:", err.message); try { await replay.stop(); } catch {} }
finally { clearTimeout(watchdog); await disconnect(); process.exit(0); }
