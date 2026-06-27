#!/usr/bin/env node
// Batch-record the deterministic backtest corpus over a date range by shelling
// out to run-backtest-headless.js once per (date, session). Each session runs in
// its own process, so a TV wedge or crash in one session can't kill the batch.
// Resumable: a (date, session) already recorded with a healthy tape is skipped,
// so Ctrl-C + re-run picks up where it left off. Writes to the MAIN checkout's
// state/backtest (the headless runner's STATE_DIR), regardless of this file's cwd.
//
// Usage:
//   node scripts/record-corpus.mjs                          # 2026-01-01 .. today
//   node scripts/record-corpus.mjs --from 2026-01-01 --to 2026-06-20
//   node scripts/record-corpus.mjs --sessions ny-am         # AM only
//   node scripts/record-corpus.mjs --force                  # bypass market-hours guard
//
// Requires: TV Desktop on CDP 9225, markets CLOSED (drives the chart for hours),
//           the app NOT mid-backtest (one chart, one driver). Deterministic fold —
//           no LLM in the loop — so recording historical data is memorization-safe
//           (CLAUDE.md constraint #10 is about LLM grading, not this).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = "/Users/anasqatanani/Documents/claude-tradingview-analyser-v2";
const HEADLESS = path.join(REPO, "scripts", "run-backtest-headless.js");
const INDEX = path.join(REPO, "state", "backtest", "index.json");
const LOG = path.join(REPO, "state", "backtest", "record-corpus.log");

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);
const FROM = arg("from", "2026-01-01");
const TO = arg("to", new Date().toISOString().slice(0, 10));
const SESSIONS = arg("sessions", "ny-am,ny-pm").split(",").map((s) => s.trim()).filter(Boolean);
const SYMBOL = arg("symbol", "MNQ1!");
const MIN_BARS = Number(arg("min-bars", 20));

// US index-futures holidays Jan–Jun 2026 (closed / no RTH replay) — skip to save
// ~2 min each. Extend if you record past June.
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
]);

function weekdays(from, to) {
  const out = [];
  const d = new Date(from + "T12:00:00Z");
  const end = new Date(to + "T12:00:00Z");
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue; // Sun / Sat
    const iso = d.toISOString().slice(0, 10);
    if (HOLIDAYS.has(iso)) continue;
    out.push(iso);
  }
  return out;
}

function readIndex() { try { return JSON.parse(fs.readFileSync(INDEX, "utf8")); } catch { return { runs: [] }; } }

// Headless runs record only the leader (MNQ), so a null-symbol index entry is
// ours; popover MES runs carry an explicit "MES1!". Treat MNQ-or-null as a match.
const isOurs = (r) => r.symbol === SYMBOL || r.symbol == null;

// A (date|session) is "done" if any recorded run for it has a healthy tape.
function alreadyDone() {
  const done = new Set();
  for (const r of readIndex().runs ?? []) {
    if (!isOurs(r)) continue;
    if ((r.bars ?? 0) >= MIN_BARS) done.add(`${r.date}|${r.session}`);
  }
  return done;
}

// Authoritative bar count: re-read the index after the run and find the freshest
// matching entry (robust to whatever the headless stdout format is).
function latestRunBars(date, session, sinceMs) {
  const cands = (readIndex().runs ?? []).filter(
    (r) => isOurs(r) && r.date === date && r.session === session && Date.parse(r.created_at) >= sinceMs - 2000,
  );
  if (!cands.length) return null;
  cands.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return cands[0].bars ?? null;
}

function log(line) { const s = `${new Date().toISOString()} ${line}`; console.log(s); fs.appendFileSync(LOG, s + "\n"); }

function runOne(date, session) {
  return new Promise((resolve) => {
    // BACKTEST_LEADER makes the engine stamp the index entry's symbol (headless
    // passes no symbol arg); without it the entry is symbol:null and the fold,
    // which filters symbol===MNQ1!, would silently skip the run.
    const p = spawn("node", [HEADLESS, date, session, "auto"], { cwd: REPO, env: { ...process.env, BACKTEST_LEADER: SYMBOL } });
    let err = "";
    p.stdout.on("data", () => {}); // drain
    p.stderr.on("data", (b) => { err += b.toString(); });
    p.on("close", (code) => resolve({ code, err: err.slice(-300).replace(/\s+/g, " ").trim() }));
    p.on("error", (e) => resolve({ code: -1, err: String(e.message) }));
  });
}

// Market-hours guard: refuse to drive TV during a live session unless --force.
function marketHoursGuard() {
  if (has("force")) return;
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const g = (t) => parts.find((p) => p.type === t)?.value;
  const wd = g("weekday");
  const mins = Number(g("hour")) * 60 + Number(g("minute"));
  const weekday = !["Sat", "Sun"].includes(wd);
  if (weekday && mins >= 9 * 60 + 25 && mins <= 16 * 60 + 5) {
    log(`REFUSING: it is ${wd} ${g("hour")}:${g("minute")} ET — market hours. This drives TV Desktop for hours and would hijack a live session. Re-run with --force only if you are sure no live session is active.`);
    process.exit(3);
  }
}

marketHoursGuard();

const days = weekdays(FROM, TO);
const done = alreadyDone();
const todo = [];
for (const d of days) for (const s of SESSIONS) if (!done.has(`${d}|${s}`)) todo.push([d, s]);

log(`record-corpus ${FROM}..${TO} ${SYMBOL} sessions=${SESSIONS.join("+")} | ${days.length} weekdays | already-done ${done.size} | to-record ${todo.length}`);

let ok = 0, fail = 0;
for (let i = 0; i < todo.length; i++) {
  const [date, session] = todo[i];
  const t0 = Date.now();
  const { code, err } = await runOne(date, session);
  const bars = latestRunBars(date, session, t0);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (code === 0 && (bars ?? 0) >= MIN_BARS) { ok++; log(`  [${i + 1}/${todo.length}] OK   ${date} ${session} bars=${bars} ${secs}s`); }
  else { fail++; log(`  [${i + 1}/${todo.length}] FAIL ${date} ${session} code=${code} bars=${bars} ${secs}s${err ? " | " + err : ""}`); }
}
log(`DONE recorded=${ok} failed=${fail} skipped=${done.size}  (re-run to retry failures)`);
