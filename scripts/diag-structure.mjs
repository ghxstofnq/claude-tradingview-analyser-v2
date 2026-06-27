// Read-only: fold the full MNQ corpus; per trade, read the HTF structure
// direction (most_recent_structure.dir) on daily/4H/1H from the session bundle,
// and test win%/R when the trade is ALIGNED with that structure vs AGAINST it.
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
const leaderOf = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, "tape.json"), "utf8")).entries?.[0]?.inputs?.leader ?? null; } catch { return null; } };
const findRun = (date, s) => { const tag = `-${s.replace("ny-", "")}-${date}`; for (const d of fs.readdirSync(BT).filter((x) => x.includes(tag)).sort().reverse()) if (leaderOf(path.join(BT, d, s)) === SYM) return d; return null; };
function regen(rd, s) { const bp = path.join(rd, "brief-bundle.json"); let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(rd, "brief-payloads.json"), "utf8")); } catch {} if (!fs.existsSync(bp)) return null; const b = JSON.parse(fs.readFileSync(bp, "utf8")); const ld = rec?.[0]?.symbol || SYM; return buildDirectSessionBriefPayloads({ session: s, bundle: { ...b, brief_digest: buildBriefDigest({ pair: { symbols: { [ld]: b } } }) }, symbols: [ld] }); }
const pmCarry = (date) => { const run = findRun(date, "ny-pm"); if (!run) return []; try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; } };
const structDir = (e) => { const ms = e?.most_recent_structure ?? (e?.structures || [])[(e?.structures || []).length - 1]; const d = String(ms?.dir || "").toLowerCase(); return d === "bull" || d === "bear" ? d : null; };

async function foldTrades(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return [];
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return [];
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const bb = JSON.parse(fs.readFileSync(path.join(rd, "brief-bundle.json"), "utf8"));
  const dir = { daily: structDir(bb.engine_by_tf?.daily), h4: structDir(bb.engine_by_tf?.h4), h1: structDir(bb.engine_by_tf?.h1) };
  const out = []; const bus = new EventEmitter(); const sf = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop);
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0;
      out.push({ R, side: s.side, dir });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "struct-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return out;
}

const all = [];
for (const e of idx.runs) { if (e.symbol !== SYM) continue; all.push(...await foldTrades(e)); }
const aligned = (t, tf) => { const d = t.dir[tf]; if (!d || !t.side) return null; return (t.side === "long" && d === "bull") || (t.side === "short" && d === "bear"); };
function row(label, set) {
  const w = set.filter((t) => t.R > 0).length, l = set.filter((t) => t.R < 0).length;
  const tot = r2(set.reduce((a, t) => a + t.R, 0)); const wr = w + l ? Math.round(1000 * w / (w + l)) / 10 : 0;
  return `${label.padEnd(20)} n=${String(set.length).padStart(3)}  W${String(w).padStart(3)} L${String(l).padStart(3)}  win%=${String(wr).padStart(5)}  R=${String(tot).padStart(7)}  avgR=${set.length ? r2(tot / set.length) : 0}`;
}
console.log(`\ntotal trades=${all.length}\n`);
for (const tf of ["daily", "h4", "h1"]) {
  console.log(`=== HTF structure = ${tf} ===`);
  console.log(row(`  aligned (with ${tf})`, all.filter((t) => aligned(t, tf) === true)));
  console.log(row(`  against (vs ${tf})`, all.filter((t) => aligned(t, tf) === false)));
  console.log(row(`  no ${tf} structure`, all.filter((t) => aligned(t, tf) === null)));
}
