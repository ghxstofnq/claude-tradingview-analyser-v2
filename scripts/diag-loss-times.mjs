// Read-only: fold the MNQ corpus, record every LOSING trade's entry time (ET),
// date, session, model, side, and R. Prints them sorted by clock time so any
// time-of-day clustering is visible. No live-state writes (tmpdir stateDir).
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
const etTime = (iso) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)); } catch { return "??:??"; } };

async function foldTrades(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return [];
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return [];
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const trades = []; const bus = new EventEmitter(); const sf = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop);
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0;
      trades.push({ date: entry.date, session: entry.session, model: s.model, side: s.side, grade: s.grade, entry_et: etTime(s.event_ts), R });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "diag-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return trades;
}

const all = [];
for (const e of idx.runs) { if (e.symbol !== SYM) continue; all.push(...await foldTrades(e)); }
const losses = all.filter((t) => t.R < 0);

console.log(`\nALL LOSING TRADES (${losses.length}), sorted by entry time (ET):\n`);
for (const t of losses.sort((a, b) => a.entry_et.localeCompare(b.entry_et))) {
  console.log(`  ${t.entry_et}  ${t.date} ${t.session.replace("ny-", "").padEnd(2)}  ${String(t.model).padEnd(9)} ${String(t.side).padEnd(5)} ${String(t.grade).padEnd(2)}  ${t.R}R`);
}

// histogram by 15-min bucket
const bucket = new Map();
for (const t of losses) { const [h, m] = t.entry_et.split(":").map(Number); const b = `${String(h).padStart(2, "0")}:${String(Math.floor(m / 15) * 15).padStart(2, "0")}`; bucket.set(b, (bucket.get(b) || 0) + 1); }
console.log(`\nLOSS COUNT by 15-min entry bucket (ET):\n`);
for (const k of [...bucket.keys()].sort()) console.log(`  ${k}  ${"#".repeat(bucket.get(k))} ${bucket.get(k)}`);

// W/L per 15-min bucket, split by session
const buck = (iso) => { const [h, m] = iso.split(":").map(Number); return `${String(h).padStart(2, "0")}:${String(Math.floor(m / 15) * 15).padStart(2, "0")}`; };
function sessionTable(sess, label) {
  const rows = all.filter((t) => t.session === sess);
  const m = new Map(); // bucket -> {aw,al,bw,bl,be}
  const blank = () => ({ aw: 0, al: 0, bw: 0, bl: 0, be: 0 });
  for (const t of rows) {
    const b = buck(t.entry_et); const o = m.get(b) || blank();
    const isAplus = t.grade === "A+";
    if (t.R > 0) { isAplus ? o.aw++ : o.bw++; } else if (t.R < 0) { isAplus ? o.al++ : o.bl++; } else o.be++;
    m.set(b, o);
  }
  console.log(`\n${label} — A+ vs B by 15-min entry bucket (ET):\n`);
  console.log(`  bucket   A+W A+L   BW  BL   BE`);
  const tot = blank();
  for (const k of [...m.keys()].sort()) {
    const o = m.get(k); tot.aw += o.aw; tot.al += o.al; tot.bw += o.bw; tot.bl += o.bl; tot.be += o.be;
    console.log(`  ${k}  ${String(o.aw).padStart(3)} ${String(o.al).padStart(3)}  ${String(o.bw).padStart(3)} ${String(o.bl).padStart(3)}  ${String(o.be).padStart(3)}`);
  }
  console.log(`  ------  --- ---  --- ---  ---`);
  console.log(`  TOTAL  ${String(tot.aw).padStart(3)} ${String(tot.al).padStart(3)}  ${String(tot.bw).padStart(3)} ${String(tot.bl).padStart(3)}  ${String(tot.be).padStart(3)}`);
}
sessionTable("ny-am", "NY-AM");
sessionTable("ny-pm", "NY-PM");

// what-if: remove specific (bucket, weekday) combos and recompute overall totals
{
  const dow = (d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(d + "T12:00:00Z").getUTCDay()];
  const ALL = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const rules = [
    { bucket: "09:45", days: ["Thu", "Fri"] },
    { bucket: "10:30", days: ["Thu"] },
    { bucket: "14:45", days: ALL },
    { bucket: "15:15", days: ALL },
  ];
  const blocked = (t) => rules.some((r) => buck(t.entry_et) === r.bucket && r.days.includes(dow(t.date)));
  const kept = all.filter((t) => !blocked(t));
  const removed = all.filter(blocked);
  const stat = (arr) => { let w = 0, l = 0, be = 0, r = 0; for (const t of arr) { if (t.R > 0) w++; else if (t.R < 0) l++; else be++; r = r2(r + t.R); } const wr = w + l > 0 ? Math.round(1000 * w / (w + l)) / 10 : 0; return { w, l, be, r: r2(r), wr }; };
  const before = stat(all), after = stat(kept), rem = stat(removed);
  console.log(`\n=== WHAT-IF: ${rules.map((r) => `${r.bucket}/${r.days.join("+")}`).join(", ")} ===\n`);
  console.log(`  REMOVED   W${rem.w}/L${rem.l}/BE${rem.be}  R=${rem.r}`);
  console.log(`  BEFORE    W${before.w}/L${before.l}/BE${before.be}  win%=${before.wr}  R=${before.r}`);
  console.log(`  AFTER     W${after.w}/L${after.l}/BE${after.be}  win%=${after.wr}  R=${after.r}   (STATIC — needs fold)`);
}

// detail any single bucket via env: DETAIL=09:45
if (process.env.DETAIL) {
  const dow = (d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(d + "T12:00:00Z").getUTCDay()];
  console.log(`\nDETAIL — all trades entering in the ${process.env.DETAIL} bucket:\n`);
  for (const t of all.filter((x) => buck(x.entry_et) === process.env.DETAIL).sort((a, b) => a.date.localeCompare(b.date))) {
    console.log(`  ${t.date} ${dow(t.date)}  ${t.entry_et}  ${t.session.replace("ny-", "").padEnd(2)}  ${String(t.model).padEnd(9)} ${String(t.side).padEnd(5)} ${String(t.grade).padEnd(2)}  ${t.R > 0 ? "WIN " : t.R < 0 ? "LOSS" : "BE  "} ${t.R}R`);
  }
}
