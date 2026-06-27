// Read-only: for every INVERSION trade, find the inverted FVG the confirmation
// violated (nearest inverted zone to the entry whose inversion stamped at/just
// before the confirmation bar) and measure its HEIGHT (top-bottom), height/ATR,
// and the engine's own size_quality. Compare winners vs losers + threshold sweep.
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

function bundleAt(rd) {
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const m = new Map();
  for (const e of tape.entries) {
    const bun = e.inputs?.bundle ?? {};
    const fvgs = bun.gates?.engine?.pillar3?.fvgs ?? bun.engine?.fvgs ?? [];
    const atr = Number(bun.gates?.engine?.pillar2?.current_tf?.atr_14 ?? bun.engine?.quality?.atr_14 ?? NaN);
    const cand = bun.bars?.last_5_bars?.slice(-1)?.[0] ?? null;
    m.set(e.event?.ts, { fvgs, atr, cand });
  }
  return m;
}

// inverted zone the confirmation violated: among inverted FVGs present, take the
// one whose midpoint is nearest the entry (the trade is built on this zone),
// preferring zones inverted at/just before the confirmation bar.
function violatedZone(fvgs, barMs, entry) {
  const inv = fvgs.filter((f) => Number.isFinite(f.inverted_ms) && Number.isFinite(f.top) && Number.isFinite(f.bottom) && f.inverted_ms <= barMs + 60000);
  if (!inv.length) return null;
  let best = null, bestScore = Infinity;
  for (const f of inv) {
    const mid = (f.top + f.bottom) / 2;
    const recency = Math.max(0, barMs - f.inverted_ms) / 60000; // minutes since inversion
    const score = Math.abs(mid - entry) + recency * 0.5; // price-anchored, recency tiebreak
    if (score < bestScore) { bestScore = score; best = f; }
  }
  return best;
}

async function foldInv(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return [];
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return [];
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const bm = bundleAt(rd);
  const out = []; const bus = new EventEmitter(); const sf = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop);
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0;
      if (String(s.model) !== "Inversion") return;
      const at = bm.get(s.event_ts); if (!at) return;
      const z = violatedZone(at.fvgs, Date.parse(s.event_ts), s.entry);
      const height = z ? r2(z.top - z.bottom) : null;
      const cRange = at.cand ? r2(+at.cand.high - +at.cand.low) : null;
      const cRangeAtr = cRange != null && Number.isFinite(at.atr) && at.atr > 0 ? r2(cRange / at.atr) : null;
      out.push({ R, win: R > 0, height, heightAtr: height != null && Number.isFinite(at.atr) && at.atr > 0 ? r2(height / at.atr) : null, sq: z?.size_quality ?? "no_match", risk: r2(risk), cRange, cRangeAtr });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "ivf-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return out;
}

const inv = [];
for (const e of idx.runs) { if (e.symbol !== SYM) continue; if (SINCE && e.date < SINCE) continue; if (UNTIL && e.date > UNTIL) continue; inv.push(...await foldInv(e)); }
const wins = inv.filter((t) => t.win), losses = inv.filter((t) => t.R < 0);
const matched = inv.filter((t) => t.height != null);
const med = (arr) => { const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
console.log(`\nINVERSION trades: ${inv.length} (W${wins.length}/L${losses.length}); zone matched: ${matched.length}, no_match: ${inv.length - matched.length}\n`);
console.log(`  MEDIAN violated-FVG height  winners ${med(wins.map((t) => t.height))}   losers ${med(losses.map((t) => t.height))}`);
console.log(`  MEDIAN height / ATR         winners ${med(wins.map((t) => t.heightAtr))}   losers ${med(losses.map((t) => t.heightAtr))}`);
console.log(`  MEDIAN risk (|entry-stop|)  winners ${med(wins.map((t) => t.risk))}   losers ${med(losses.map((t) => t.risk))}`);

console.log(`\n  size_quality split (engine's own classification):`);
for (const q of ["tiny", "normal", "large", "no_match"]) { const g = inv.filter((t) => t.sq === q); const w = g.filter((t) => t.win).length, l = g.filter((t) => t.R < 0).length; const rr = r2(g.reduce((s, t) => s + t.R, 0)); if (g.length) console.log(`    ${q.padEnd(8)} ${g.length} trades  ${w}W/${l}L ${w + l ? Math.round(1000 * w / (w + l)) / 10 : 0}%  R=${rr}`); }

console.log(`\n  THRESHOLD SWEEP — require violated FVG height >= T:\n`);
for (const T of [5, 8, 10, 15, 20]) {
  const keep = matched.filter((t) => t.height >= T), cut = matched.filter((t) => t.height < T);
  const wr = (a) => { const w = a.filter((t) => t.win).length, l = a.filter((t) => t.R < 0).length; return w + l ? `${w}W/${l}L ${Math.round(1000 * w / (w + l)) / 10}%` : "—"; };
  const rs = (a) => r2(a.reduce((s, t) => s + t.R, 0));
  console.log(`    height >= ${String(T).padStart(2)}:  KEEP ${wr(keep)} R=${rs(keep)}  |  CUT ${wr(cut)} R=${rs(cut)}`);
}

// COMBINED "violent inversion" = big zone AND big confirmation candle. The SKIP
// group is what the gate would remove — we want it clearly net-negative.
console.log(`\n  VIOLENT (skip if height>=H AND candle range/ATR>=C) — SKIP group is removed:\n`);
const wr = (a) => { const w = a.filter((t) => t.win).length, l = a.filter((t) => t.R < 0).length; return w + l ? `${w}W/${l}L ${Math.round(1000 * w / (w + l)) / 10}%` : "0"; };
const rs = (a) => r2(a.reduce((s, t) => s + t.R, 0));
const usable = inv.filter((t) => t.height != null && Number.isFinite(t.cRangeAtr));
for (const [H, C] of [[10, 1.25], [10, 1.5], [12, 1.5], [15, 1.5], [8, 1.5], [10, 1.75]]) {
  const skip = usable.filter((t) => t.height >= H && t.cRangeAtr >= C);
  const keep = usable.filter((t) => !(t.height >= H && t.cRangeAtr >= C));
  console.log(`    H>=${H} & C>=${C}:  SKIP ${wr(skip)} R=${rs(skip)}  (removing → keep ${wr(keep)} R=${rs(keep)})`);
}
