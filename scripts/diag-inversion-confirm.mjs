// Read-only: for every INVERSION trade (win + loss) in the pinned corpus,
// measure the CONFIRMATION candle (the bar the packet formed on — entry-models.md
// "the violating close IS the confirmation"): body ratio, range, range/ATR, and
// which way the wick sits. Then compare winners vs losers — does a stricter
// confirmation (bigger body / bigger candle / less wick) separate them?
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as bc } from "../app/main/bar-close.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";

const SYM = "MNQ1!";
const BT = "/Users/anasqatanani/Documents/claude-tradingview-analyser-v2/state/backtest";
const r2 = (n) => Math.round(n * 100) / 100;
const idx = JSON.parse(fs.readFileSync(path.join(BT, "index.json"), "utf8"));
const SINCE = process.env.FOLD_SINCE, UNTIL = process.env.FOLD_UNTIL;
const leaderOf = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, "tape.json"), "utf8")).entries?.[0]?.inputs?.leader ?? null; } catch { return null; } };
const findRun = (date, s) => { const tag = `-${s.replace("ny-", "")}-${date}`; for (const d of fs.readdirSync(BT).filter((x) => x.includes(tag)).sort().reverse()) if (leaderOf(path.join(BT, d, s)) === SYM) return d; return null; };
function regen(rd, s) { const bp = path.join(rd, "brief-bundle.json"); let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(rd, "brief-payloads.json"), "utf8")); } catch {} if (!fs.existsSync(bp)) return null; const b = JSON.parse(fs.readFileSync(bp, "utf8")); const ld = rec?.[0]?.symbol || SYM; return buildDirectSessionBriefPayloads({ session: s, bundle: { ...b, brief_digest: buildBriefDigest({ pair: { symbols: { [ld]: b } } }) }, symbols: [ld] }); }
const pmCarry = (date) => { const run = findRun(date, "ny-pm"); if (!run) return []; try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; } };

// map event.ts -> {confirmation candle, atr} for a session's tape
function confMap(rd) {
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const m = new Map();
  for (const e of tape.entries) {
    const b = e.inputs?.bundle?.bars?.last_5_bars?.slice(-1)?.[0]; if (!b) continue;
    const bun = e.inputs?.bundle ?? {};
    const atr = Number(bun.gates?.engine?.pillar2?.current_tf?.atr_14 ?? bun.engine?.quality?.atr_14 ?? NaN);
    m.set(e.event?.ts, { o: +b.open, h: +b.high, l: +b.low, c: +b.close, atr });
  }
  return m;
}

async function foldInv(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return [];
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return [];
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const cm = confMap(rd);
  const out = []; const bus = new EventEmitter(); const sf = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop);
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0;
      if (String(s.model) !== "Inversion") return;
      const cd = cm.get(s.event_ts); if (!cd) return;
      const range = cd.h - cd.l; if (!(range > 0)) return;
      const body = Math.abs(cd.c - cd.o);
      const upWick = cd.h - Math.max(cd.o, cd.c), dnWick = Math.min(cd.o, cd.c) - cd.l;
      // wick AGAINST the trade = the side price would push through (short: upper wick; long: lower wick)
      const wickAgainst = s.side === "short" ? upWick : dnWick;
      out.push({ R, win: R > 0, bodyRatio: r2(body / range), range: r2(range), rangeAtr: Number.isFinite(cd.atr) && cd.atr > 0 ? r2(range / cd.atr) : null, wickAgainstRatio: r2(wickAgainst / range) });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "inv-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return out;
}

const inv = [];
for (const e of idx.runs) { if (e.symbol !== SYM) continue; if (SINCE && e.date < SINCE) continue; if (UNTIL && e.date > UNTIL) continue; inv.push(...await foldInv(e)); }

const wins = inv.filter((t) => t.win), losses = inv.filter((t) => t.R < 0);
const med = (arr) => { const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
console.log(`\nINVERSION trades: ${inv.length}  (wins ${wins.length}, losses ${losses.length})\n`);
const row = (label, key) => console.log(`  ${label.padEnd(22)} winners ${String(med(wins.map((t) => t[key]))).padStart(7)}   losers ${String(med(losses.map((t) => t[key]))).padStart(7)}`);
console.log(`  MEDIANS (winners vs losers):`);
row("body ratio", "bodyRatio");
row("range (pts)", "range");
row("range / ATR", "rangeAtr");
row("wick-against ratio", "wickAgainstRatio");

// separation test: if we required body ratio >= T (and range/atr >= U), what happens?
console.log(`\n  THRESHOLD SWEEP — keep trades meeting the bar, show win-rate kept vs cut:\n`);
function sweep(label, key, thresholds, dir = ">=") {
  for (const T of thresholds) {
    const keep = inv.filter((t) => Number.isFinite(t[key]) && (dir === ">=" ? t[key] >= T : t[key] <= T));
    const cut = inv.filter((t) => Number.isFinite(t[key]) && (dir === ">=" ? t[key] < T : t[key] > T));
    const wr = (a) => { const w = a.filter((t) => t.win).length, l = a.filter((t) => t.R < 0).length; return w + l ? `${w}W/${l}L ${Math.round(1000 * w / (w + l)) / 10}%` : "—"; };
    const rsum = (a) => r2(a.reduce((s, t) => s + t.R, 0));
    console.log(`    ${label} ${dir} ${T}:  KEEP ${wr(keep)} R=${rsum(keep)}   |  CUT ${wr(cut)} R=${rsum(cut)}`);
  }
}
sweep("body ratio", "bodyRatio", [0.4, 0.5, 0.6, 0.7]);
sweep("range/ATR ", "rangeAtr", [1.0, 1.25, 1.5, 2.0]);
sweep("wick-against", "wickAgainstRatio", [0.4, 0.3, 0.25], "<=");
