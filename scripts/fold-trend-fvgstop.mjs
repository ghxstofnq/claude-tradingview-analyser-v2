// Test the Trend FVG-candle stop: reconstruct the full session 1m history from
// the tape, inject it as bundle.full1m (cumulative per bar, no lookahead) so the
// GOFNQ_P3_TREND_STOP=fvgcandle override can find the FVG-creating candle. Reports
// total R + the Trend trades' stop kinds & R. Inversion/Trend-pullback untouched.
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
const INJECT = process.env.INJECT_FULL1M === "1";
const leaderOf = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, "tape.json"), "utf8")).entries?.[0]?.inputs?.leader ?? null; } catch { return null; } };
const findRun = (date, s) => { const tag = `-${s.replace("ny-", "")}-${date}`; for (const d of fs.readdirSync(BT).filter((x) => x.includes(tag)).sort().reverse()) if (leaderOf(path.join(BT, d, s)) === SYM) return d; return null; };
function regen(rd, s) { const bp = path.join(rd, "brief-bundle.json"); let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(rd, "brief-payloads.json"), "utf8")); } catch {} if (!fs.existsSync(bp)) return null; const b = JSON.parse(fs.readFileSync(bp, "utf8")); const ld = rec?.[0]?.symbol || SYM; return buildDirectSessionBriefPayloads({ session: s, bundle: { ...b, brief_digest: buildBriefDigest({ pair: { symbols: { [ld]: b } } }) }, symbols: [ld] }); }
const pmCarry = (date) => { const run = findRun(date, "ny-pm"); if (!run) return []; try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; } };

// full session 1m series from the tape (each entry's just-closed bar), sorted/deduped
function buildFull1m(entries) {
  const m = new Map();
  for (const e of entries) { const b = e.inputs?.bundle?.bars?.last_5_bars?.slice(-1)?.[0]; if (b && Number.isFinite(Number(b.time))) m.set(Number(b.time), b); }
  return [...m.values()].sort((a, b) => Number(a.time) - Number(b.time));
}

async function fold(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return [];
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return [];
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const full = buildFull1m(tape.entries);
  // inject cumulative full1m (bars at or before each entry's bar — no lookahead)
  const entries = INJECT ? tape.entries.map((e) => {
    const t = Number(e.inputs?.bundle?.bars?.last_5_bars?.slice(-1)?.[0]?.time ?? Infinity);
    const hist = full.filter((b) => Number(b.time) <= t);
    return { ...e, inputs: { ...e.inputs, bundle: { ...e.inputs.bundle, full1m: hist } } };
  }) : tape.entries;
  const byId = new Map(); const out = []; const bus = new EventEmitter(); const sf = new Map();
  const wrapped = async (args) => { const t = await bc.buildDeterministicPacketTruthFromInputs(args); const p = t.surfacePayload; const pk = t.bestPacket; if (p?.id && pk) byId.set(p.id, { model: pk.model, stopKind: pk.stop?.kind ?? "?" }); return t; };
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop);
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0;
      const meta = byId.get(e.setupId) || {};
      out.push({ model: meta.model ?? String(s.model), R, stopKind: meta.stopKind ?? "?", risk: r2(risk) });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: wrapped, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "tfvg-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return out;
}

const all = [];
for (const e of idx.runs) { if (e.symbol !== SYM) continue; if (SINCE && e.date < SINCE) continue; if (UNTIL && e.date > UNTIL) continue; all.push(...await fold(e)); }
const R = r2(all.reduce((s, t) => s + t.R, 0));
const w = all.filter((t) => t.R > 0).length, l = all.filter((t) => t.R < 0).length;
console.log(`[${process.env.GOFNQ_P3_TREND_STOP || "baseline"}${INJECT ? "+full1m" : ""}] total R=${R}  W${w}/L${l}  (${all.length} trades)`);
const tr = all.filter((t) => t.model === "Trend");
console.log(`  Trend: ${tr.length} trades, R=${r2(tr.reduce((s, t) => s + t.R, 0))}`);
const kinds = new Map(); for (const t of tr) kinds.set(t.stopKind, (kinds.get(t.stopKind) || 0) + 1);
console.log(`  Trend stop kinds: ${[...kinds.entries()].map(([k, v]) => `${k}:${v}`).join("  ")}`);
for (const t of tr) console.log(`    ${t.stopKind.padEnd(22)} risk=${t.risk}pt  R=${t.R}`);
