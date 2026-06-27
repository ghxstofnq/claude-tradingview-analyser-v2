// Read-only: fold the full MNQ corpus through the real chain (current shipped
// defaults — HTF-struct align + Trend FVG stop on) and tally wins/losses by
// month and week-of-month. Week-of-month = ceil(dayOfMonth/7), so weeks never
// straddle a month. No live-state writes (tmpdir stateDir).
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

async function foldSession(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return null;
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return null;
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const booked = []; const bus = new EventEmitter(); const sf = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") { const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop); booked.push(e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0); }
    else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "mw-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return booked; // per-trade R list for this session
}

// gather every session
const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const rows = []; // {date, mo, wk, trades:[R], R}
for (const e of idx.runs) {
  if (e.symbol !== SYM) continue;
  const trades = await foldSession(e); if (trades == null) continue;
  const [y, mo, d] = e.date.split("-").map(Number);
  const wk = Math.min(5, Math.ceil(d / 7));
  rows.push({ date: e.date, session: e.session, mo, wk, day: d, trades, R: r2(trades.reduce((a, b) => a + b, 0)) });
}
rows.sort((a, b) => a.date.localeCompare(b.date) || a.session.localeCompare(b.session));

const blank = () => ({ sessions: 0, w: 0, l: 0, be: 0, R: 0, win_days: 0, loss_days: 0 });
const fold = (acc, row) => {
  acc.sessions++; acc.R = r2(acc.R + row.R);
  if (row.R > 0) acc.win_days++; else if (row.R < 0) acc.loss_days++;
  for (const t of row.trades) { if (t > 0) acc.w++; else if (t < 0) acc.l++; else acc.be++; }
  return acc;
};
const wr = (o) => (o.w + o.l > 0 ? (Math.round(1000 * o.w / (o.w + o.l)) / 10).toFixed(1) : "  - ");
const line = (label, o) => `  ${label.padEnd(22)} ${String(o.sessions).padStart(4)} ${String(o.w).padStart(4)} ${String(o.l).padStart(4)} ${String(o.be).padStart(4)}  ${String(wr(o)).padStart(5)}%  ${String(r2(o.R)).padStart(9)}`;

// ---- MONTHLY SUMMARY ----
console.log(`\n=== MONTHLY SUMMARY (MNQ, full corpus, current shipped system) ===\n`);
console.log(`  ${"month".padEnd(22)} ${"sess".padStart(4)} ${" W".padStart(4)} ${" L".padStart(4)} ${"BE".padStart(4)}   ${"win%"}    ${"R".padStart(7)}`);
console.log(`  ${"-".repeat(22)} ${"-".repeat(4)} ${"-".repeat(4)} ${"-".repeat(4)} ${"-".repeat(4)}  ${"-".repeat(6)}  ${"-".repeat(9)}`);
const grand = blank();
const byMonth = new Map();
for (const row of rows) { const o = byMonth.get(row.mo) || blank(); fold(o, row); byMonth.set(row.mo, o); fold(grand, row); }
for (const mo of [...byMonth.keys()].sort((a, b) => a - b)) console.log(line(MONTHS[mo], byMonth.get(mo)));
console.log(`  ${"-".repeat(22)} ${"-".repeat(4)} ${"-".repeat(4)} ${"-".repeat(4)} ${"-".repeat(4)}  ${"-".repeat(6)}  ${"-".repeat(9)}`);
console.log(line("TOTAL", grand));

// ---- MONTH x WEEK BREAKDOWN ----
console.log(`\n=== BY WEEK OF MONTH (week N = days ${"["}N*7-6 .. N*7]${"]"}) ===\n`);
console.log(`  ${"month / week".padEnd(22)} ${"sess".padStart(4)} ${" W".padStart(4)} ${" L".padStart(4)} ${"BE".padStart(4)}   ${"win%"}    ${"R".padStart(7)}`);
console.log(`  ${"-".repeat(22)} ${"-".repeat(4)} ${"-".repeat(4)} ${"-".repeat(4)} ${"-".repeat(4)}  ${"-".repeat(6)}  ${"-".repeat(9)}`);
for (const mo of [...byMonth.keys()].sort((a, b) => a - b)) {
  const wks = new Map();
  for (const row of rows.filter((r) => r.mo === mo)) { const o = wks.get(row.wk) || blank(); fold(o, row); wks.set(row.wk, o); }
  for (const wk of [...wks.keys()].sort((a, b) => a - b)) console.log(line(`${MONTHS[mo]}  wk${wk}`, wks.get(wk)));
  console.log(line(`${MONTHS[mo]}  ── month`, byMonth.get(mo)));
  console.log(`  ${"-".repeat(22)} ${"-".repeat(4)} ${"-".repeat(4)} ${"-".repeat(4)} ${"-".repeat(4)}  ${"-".repeat(6)}  ${"-".repeat(9)}`);
}
console.log(`\nCorpus: ${rows.length} sessions, ${rows[0]?.date} .. ${rows[rows.length - 1]?.date}.  win%=W/(W+L) trade-level; R=sum booked R.\n`);
