// scripts/grade-snapshot.mjs <date> [leader=MNQ1!] [endTime=12:00] [tf=1]
// One-shot session snapshot for hand-grading: replays to endTime and dumps the
// full engine evidence (quality / levels / structures / fvgs / sweeps) + the
// 08:00-12:00 OHLC, so a Lanto-style grade (bias / price quality / entry) can be
// reconstructed without stepping bar-by-bar. Note: quality.coherence here is at
// the CAPTURE TF (1m by default, lower-scale); the price-quality verdict uses
// the 15m coherence from validate-coherence.mjs.
import * as chart from "../packages/core/chart.js";
import * as data from "../packages/core/data.js";
import * as replay from "../packages/core/replay.js";
import { disconnect } from "../packages/core/connection.js";
import { freshChartForReplay } from "../cli/lib/replay-recovery.js";
import { findIctEngineRows, parseIctEngineTable } from "../cli/lib/ict-engine-parser.js";
import { writeFileSync, mkdirSync } from "node:fs";

const [date, leader = "MNQ1!", endTime = "12:00", tf = "1"] = process.argv.slice(2);
const wd = setTimeout(() => { console.error("WD_TIMEOUT"); process.exit(1); }, 160000);
wd.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etOf = (s) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s * 1000));
const etMs = (ms) => (ms ? etOf(ms / 1000) : null);
try {
  await freshChartForReplay({ leader, timeframe: tf });
  await replay.start({ date, time: endTime }); await sleep(1500);
  await chart.setExtendedHours(true); await sleep(1200);
  const e = parseIctEngineTable(findIctEngineRows(await data.getPineTables()));
  const o = await data.getOhlcv({ count: 320, summary: false });
  const bars = (o.bars || o.candles || o).map((b) => ({ et: etOf(b.time), o: b.open, h: b.high, l: b.low, c: b.close })).filter((b) => b.et >= "08:00" && b.et <= "12:00");
  const out = {
    date, leader, tf,
    quality: e?.quality ? { coherence: e.quality.coherence, displacement: e.quality.displacement, candle: e.quality.candle, regime: e.quality.regime } : null,
    levels: (e?.levels || []).filter((l) => /AS|LO|NYAM|PD|PW/.test(l.name)).map((l) => ({ n: l.name, p: l.price, sw: l.swept })),
    sweeps: (e?.sweeps || []).map((s) => ({ at: etMs(s.swept_ms || s.ms), dir: s.dir, lvl: s.level, name: s.name })),
    structures: (e?.structures || []).slice().sort((a, b) => (a.confirmed_ms || 0) - (b.confirmed_ms || 0)).map((s) => ({ at: etMs(s.confirmed_ms), ev: s.event, dir: s.dir, tier: s.tier, lvl: s.level, val: s.validation, disp: s.displacement, dp: s.disp_pts })),
    fvgs: (e?.fvgs || []).slice().sort((a, b) => (a.created_ms || 0) - (b.created_ms || 0)).map((f) => ({ born: etMs(f.created_ms), dir: f.dir || f.kind, state: f.state, tl: f.took_liq, ds: f.disp_score, sq: f.size_quality, bot: f.bottom, top: f.top, ce: f.ce, inv: etMs(f.inverted_ms) })),
    ohlc: bars,
  };
  mkdirSync(new URL("./calib-out/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`./calib-out/snap-${date}.json`, import.meta.url), JSON.stringify(out));
  console.log("SNAP_WRITTEN", `scripts/calib-out/snap-${date}.json`, "| structures", out.structures.length, "fvgs", out.fvgs.length, "sweeps", out.sweeps.length, "| capture-tf coherence", out.quality?.coherence);
  await replay.stop();
} catch (e) { console.error("ERR", e.message); try { await replay.stop(); } catch {} }
finally { clearTimeout(wd); await disconnect(); process.exit(0); }
