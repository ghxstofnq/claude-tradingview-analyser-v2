// Read-only: for every BOOKED trade, capture which stop RULE fired (packet
// stop.kind), the risk distance (|entry-stop| pts), and the outcome R. Wraps the
// truth fn to read executionPacket.stop.kind, joins to the booked outcome by id.
// Reports per model: stop-kind mix, median risk, stop-out rate.
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

async function fold(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return [];
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return [];
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const byId = new Map(); const out = []; const bus = new EventEmitter(); const sf = new Map();
  const wrapped = async (args) => {
    const t = await bc.buildDeterministicPacketTruthFromInputs(args);
    const p = t.surfacePayload; const pk = t.bestPacket;
    if (p?.id && pk) byId.set(p.id, { model: pk.model, side: pk.side, stopKind: pk.stop?.kind ?? "?", entry: pk.entry?.price, stop: pk.stop?.price });
    return t;
  };
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop);
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0;
      const meta = byId.get(e.setupId) || {};
      out.push({ model: meta.model ?? String(s.model), side: s.side, R, stopKind: meta.stopKind ?? "?", risk: r2(risk), stopHit: e.outcome === "stop_hit" });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: wrapped, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "stp-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return out;
}

const all = [];
for (const e of idx.runs) { if (e.symbol !== SYM) continue; if (SINCE && e.date < SINCE) continue; if (UNTIL && e.date > UNTIL) continue; all.push(...await fold(e)); }
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

for (const m of ["Inversion", "Trend", "MSS"]) {
  const g = all.filter((t) => t.model === m); if (!g.length) continue;
  console.log(`\n=== ${m} (${g.length} trades) ===`);
  console.log(`  median risk = ${med(g.map((t) => t.risk))}pt   stop-out rate = ${Math.round(1000 * g.filter((t) => t.stopHit).length / g.length) / 10}%`);
  const kinds = new Map();
  for (const t of g) { const o = kinds.get(t.stopKind) || { n: 0, w: 0, l: 0, R: 0, risk: [] }; o.n++; if (t.R > 0) o.w++; else if (t.R < 0) o.l++; o.R = r2(o.R + t.R); o.risk.push(t.risk); kinds.set(t.stopKind, o); }
  console.log(`  stop rule              trades  W/L   win%     R     medRisk`);
  for (const [k, o] of [...kinds.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const wr = o.w + o.l ? Math.round(1000 * o.w / (o.w + o.l)) / 10 : 0;
    console.log(`    ${k.padEnd(20)} ${String(o.n).padStart(4)}  ${o.w}/${o.l}  ${String(wr).padStart(5)}%  ${String(o.R).padStart(7)}  ${med(o.risk)}pt`);
  }
}
