// Read-only: fold the full MNQ corpus, and for each surfaced trade match its
// entry price to the FVG it tapped (from that bar's engine evidence) to read the
// zone's disp_score. Aggregate outcome (R, win/loss) by disp_score. Shows whether
// displacement of the entry zone relates to the result at all.
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

// HTF disp_score: among daily/4H/1H FVGs in the trade's direction that contain
// the entry price, take the strongest displacement (max disp_score). null = no
// same-direction HTF zone holds the entry.
function htfDisp(htfFvgs, entry, side) {
  const want = side === "long" ? "bull" : side === "short" ? "bear" : null;
  let best = null;
  for (const f of htfFvgs) {
    if (String(f.kind).toLowerCase() !== "fvg") continue;
    if (want && String(f.dir).toLowerCase() !== want) continue;
    const top = Number(f.top), bot = Number(f.bottom); if (!Number.isFinite(top) || !Number.isFinite(bot)) continue;
    if (entry >= bot - 0.5 && entry <= top + 0.5) { const d = Number(f.disp_score); if (Number.isFinite(d) && (best == null || d > best)) best = d; }
  }
  return best;
}

async function foldTrades(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return [];
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return [];
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  // HTF FVGs from the session brief bundle (daily + 4H + 1H), reused all session.
  const bb = JSON.parse(fs.readFileSync(path.join(rd, "brief-bundle.json"), "utf8"));
  const htfFvgs = [...(bb.engine_by_tf?.daily?.fvgs || []), ...(bb.engine_by_tf?.h4?.fvgs || []), ...(bb.engine_by_tf?.h1?.fvgs || [])];
  const out = []; const bus = new EventEmitter(); const sf = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop);
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0;
      out.push({ R, disp: htfDisp(htfFvgs, Number(s.entry), s.side) });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "disp-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return out;
}

const all = [];
for (const e of idx.runs) { if (e.symbol !== SYM) continue; all.push(...await foldTrades(e)); }
const matched = all.filter((t) => t.disp != null);
const wins = matched.filter((t) => t.R > 0), losses = matched.filter((t) => t.R < 0);
const mean = (a) => a.length ? r2(a.reduce((x, y) => x + y, 0) / a.length) : 0;
const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return r2(s[Math.floor(s.length / 2)]); };

console.log(`\ntrades=${all.length}  matched-to-FVG=${matched.length} (${Math.round(100 * matched.length / all.length)}%)\n`);
console.log(`WINNERS  disp_score: mean=${mean(wins.map((t) => t.disp))} median=${med(wins.map((t) => t.disp))}  (n=${wins.length})`);
console.log(`LOSERS   disp_score: mean=${mean(losses.map((t) => t.disp))} median=${med(losses.map((t) => t.disp))}  (n=${losses.length})`);

console.log(`\nBY disp_score BUCKET:\n`);
console.log(`  bucket       n    W    L   win%    totalR   avgR`);
const buckets = [[0, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.01]];
for (const [lo, hi] of buckets) {
  const g = matched.filter((t) => t.disp >= lo && t.disp < hi);
  const w = g.filter((t) => t.R > 0).length, l = g.filter((t) => t.R < 0).length;
  const tot = r2(g.reduce((a, t) => a + t.R, 0));
  const wr = w + l ? Math.round(1000 * w / (w + l)) / 10 : 0;
  console.log(`  ${lo}-${hi.toFixed(2).replace("1.01", "1.0")}   ${String(g.length).padStart(3)}  ${String(w).padStart(3)}  ${String(l).padStart(3)}  ${String(wr).padStart(5)}  ${String(tot).padStart(7)}  ${String(g.length ? r2(tot / g.length) : 0).padStart(6)}`);
}
