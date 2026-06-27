// Read-only: Inversion short-vs-long asymmetry. Capture every Inversion trade
// with side, R, HTF bias, and session. Report per-side stats, per-session
// concentration (is the short edge broad or a few big days?), and HTF split.
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
const norm = (b) => { const s = String(b ?? "").toLowerCase(); if (s.includes("bull") || s === "long" || s === "above") return "long"; if (s.includes("bear") || s === "short" || s === "below") return "short"; return null; };

async function fold(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return [];
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return [];
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const htf = norm(ctx?.session_state?.pillar1?.htfBias);
  const out = []; const bus = new EventEmitter(); const sf = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop);
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0;
      if (String(s.model) !== "Inversion") return;
      out.push({ ses: `${entry.date} ${entry.session.replace("ny-", "")}`, side: s.side, R, htf, vsHtf: htf == null ? "null" : (s.side === htf ? "with" : "counter") });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "side-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return out;
}

const inv = [];
for (const e of idx.runs) { if (e.symbol !== SYM) continue; if (SINCE && e.date < SINCE) continue; if (UNTIL && e.date > UNTIL) continue; inv.push(...await fold(e)); }
function stat(a) { const w = a.filter((t) => t.R > 0), l = a.filter((t) => t.R < 0); const R = r2(a.reduce((s, t) => s + t.R, 0)); return { n: a.length, w: w.length, l: l.length, R, wr: w.length + l.length ? Math.round(1000 * w.length / (w.length + l.length)) / 10 : 0, avgW: w.length ? r2(w.reduce((s, t) => s + t.R, 0) / w.length) : 0 }; }

console.log(`\nINVERSION by side (${inv.length} trades):\n`);
for (const sd of ["long", "short"]) { const s = stat(inv.filter((t) => t.side === sd)); console.log(`  ${sd.padEnd(6)} ${s.n}tr  ${s.w}W/${s.l}L  ${s.wr}%  R=${s.R}  avgWin=${s.avgW}`); }

console.log(`\n  HTF split per side (with = trade agrees with HTF bias):`);
for (const sd of ["long", "short"]) for (const v of ["with", "counter", "null"]) { const g = inv.filter((t) => t.side === sd && t.vsHtf === v); if (g.length) { const s = stat(g); console.log(`    ${sd} ${v.padEnd(8)} ${s.n}tr ${s.w}W/${s.l}L R=${s.R}`); } }

console.log(`\n  per-session R by side (concentration check — is short edge broad?):`);
const bySes = new Map();
for (const t of inv) { const k = t.ses; const o = bySes.get(k) || { long: 0, short: 0 }; o[t.side] = r2(o[t.side] + t.R); bySes.set(k, o); }
const shortSes = [...bySes.entries()].filter(([, o]) => o.short !== 0).sort((a, b) => b[1].short - a[1].short);
console.log(`    sessions with short trades: ${shortSes.length}`);
console.log(`    top 5 short sessions: ${shortSes.slice(0, 5).map(([k, o]) => `${k} ${o.short}`).join(" | ")}`);
const shortPos = shortSes.filter(([, o]) => o.short > 0).length, shortNeg = shortSes.filter(([, o]) => o.short < 0).length;
console.log(`    short-session R sign: ${shortPos} positive / ${shortNeg} negative`);
const top3 = r2(shortSes.slice(0, 3).reduce((s, [, o]) => s + o.short, 0)), allShort = r2(shortSes.reduce((s, [, o]) => s + o.short, 0));
console.log(`    top-3 short sessions = ${top3}R of ${allShort}R total short (${Math.round(100 * top3 / allShort)}% concentration)`);
