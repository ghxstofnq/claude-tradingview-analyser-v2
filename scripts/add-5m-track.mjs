// add-5m-track.mjs — add a 5m structure track to every MNQ corpus tape.
//
// We already have the 1m tapes; re-recording 1m would shift the baseline. So we
// run a 5m-ONLY replay pass per session and MERGE the 5m engine into the
// existing 1m entries (mergeFiveMinuteTrack) — same 1m data, 5m added, so the
// only fold variable is the structure timeframe. The walker reads 1m by default
// and 5m only when STRUCTURE_TF=5 (Phase 2), so one merged tape serves both folds.
//
// Resumable: skips tapes that already carry a 5m track.
// Wedge-safe: freshChartForReplay (raw page reload + pin) before EACH session.
// Per-session retry once. Writes tape.json in place (additive — 1m preserved).
//
// Usage:
//   node scripts/add-5m-track.mjs [--bt <abs state/backtest>] [--limit N] [--date YYYY-MM-DD] [--session ny-am|ny-pm]
//
// IMPORTANT: run from the worktree that has the 5m recorder code. --bt points at
// the MAIN checkout's state/backtest (default below).

import fs from "node:fs";
import path from "node:path";
import * as replay from "../packages/core/replay.js";
import * as data from "../packages/core/data.js";
import { parseIctEngineTable, findIctEngineRows } from "../cli/lib/ict-engine-parser.js";
import { recordEntries, mergeFiveMinuteTrack } from "../cli/lib/tape-recorder.js";
import { freshChartForReplay } from "../cli/lib/replay-recovery.js";

const SYM = "MNQ1!";
const VALID = new Set(["ny-am", "ny-pm"]);

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const BT = arg("bt", "/Users/anasqatanani/Documents/claude-tradingview-analyser-v2/state/backtest");
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const ONLY_DATE = arg("date");
const ONLY_SESSION = arg("session");

const deps = {
  startReplay: (a) => replay.start(a),
  stepReplay: () => replay.step(),
  stopReplay: () => replay.stop(),
  readBars: () => data.getOhlcv({ summary: true }),
  readEngine: async () => parseIctEngineTable(findIctEngineRows(await data.getPineTables())),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
const ctx = { leader: SYM, brief_digest: {}, ltf_bias_context: {}, session_state: {}, untaken_targets: {} };

const etHHMM = (ms) => new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
const hasFiveM = (tape) => (tape.entries || []).some((e) => e.inputs?.bundle?.engine_by_tf?.m5);

async function addFiveM(tapePath, date, session) {
  const tape = JSON.parse(fs.readFileSync(tapePath, "utf8"));
  if (!tape.entries?.length) return { skipped: "no-entries" };
  if (hasFiveM(tape)) return { skipped: "already-5m" };

  // Span the 5m pass to the tape's own window so every 1m bar has a prior 5m bar.
  const firstClose = Date.parse(tape.entries[0].event.ts);
  const lastClose = Date.parse(tape.entries[tape.entries.length - 1].event.ts);
  const fromEt = etHHMM(firstClose - 60_000);
  const toEt = etHHMM(lastClose);

  await freshChartForReplay({ leader: SYM, timeframe: "5" });
  const rec5 = await recordEntries({ context: ctx, date, fromEt, toEt, deps, tf: "5" });
  const merged = mergeFiveMinuteTrack(tape.entries, rec5.entries);
  const attached = merged.filter((e) => e.inputs?.bundle?.engine_by_tf?.m5).length;

  tape.entries = merged;
  tape.five_m_track = {
    added_at: new Date().toISOString(),
    source: "5m-replay-merge",
    from_et: fromEt, to_et: toEt,
    five_m_bars: rec5.entries.length,
    entries_with_5m: attached,
    warnings: rec5.warnings.length,
  };
  fs.writeFileSync(tapePath, `${JSON.stringify(tape, null, 2)}\n`);
  return { ok: true, oneM: tape.entries.length, fiveM: rec5.entries.length, attached, warnings: rec5.warnings.length };
}

const idx = JSON.parse(fs.readFileSync(path.join(BT, "index.json"), "utf8"));
let runs = (idx.runs || []).filter((r) => r.symbol === SYM && VALID.has(r.session));
if (ONLY_DATE) runs = runs.filter((r) => r.date === ONLY_DATE);
if (ONLY_SESSION) runs = runs.filter((r) => r.session === ONLY_SESSION);
runs.sort((a, b) => (a.date + a.session).localeCompare(b.date + b.session));

console.log(`[5m] corpus=${BT}`);
console.log(`[5m] ${runs.length} MNQ sessions (limit ${LIMIT})`);
let done = 0, skipped = 0, failed = 0, processed = 0;
for (const r of runs) {
  if (processed >= LIMIT) break;
  const tapePath = path.join(BT, r.run_id, r.session, "tape.json");
  if (!fs.existsSync(tapePath)) { console.log(`  ↷ ${r.date} ${r.session}: no tape`); skipped++; continue; }
  // resumable peek
  try { if (hasFiveM(JSON.parse(fs.readFileSync(tapePath, "utf8")))) { console.log(`  ↷ ${r.date} ${r.session}: already-5m`); skipped++; continue; } } catch {}
  processed++;
  let res = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { res = await addFiveM(tapePath, r.date, r.session); break; }
    catch (e) {
      console.warn(`  ! ${r.date} ${r.session} attempt ${attempt}: ${e.message}`);
      if (attempt === 2) { failed++; res = { error: e.message }; }
      else { try { await freshChartForReplay({ leader: SYM, timeframe: "5" }); } catch {} }
    }
  }
  if (res?.ok) { done++; console.log(`  ✓ ${r.date} ${r.session}: 1m=${res.oneM} 5m=${res.fiveM} attached=${res.attached} warn=${res.warnings}  [${done} done]`); }
  else if (res?.skipped) { skipped++; console.log(`  ↷ ${r.date} ${r.session}: ${res.skipped}`); }
}
console.log(`[5m] DONE — added=${done} skipped=${skipped} failed=${failed}`);
try { await freshChartForReplay({ leader: SYM, timeframe: "1" }); } catch {}
process.exit(failed > 0 ? 1 : 0);
