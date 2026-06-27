#!/usr/bin/env node
// Drive the RUNNING app's backtest function via its renderer IPC (CDP 9223).
// The app's main process is the SINGLE owner of the TV Desktop chart (9225) and
// calls pauseLiveForBacktest() on start — going through it (not a competing
// headless process) is what avoids the replay wedge.
//
// backtest:start is fire-and-forget (returns {started:true}); completion is an
// index write. So: wait-for-idle, skip already-recorded dates (resumable), start,
// poll the index until the run commits. After recording: baseline (fix OFF) +
// fold-test (fix ON: GOFNQ_HTF_FALLBACK_STANDASIDE=1).
//
// Usage: node scripts/drive-app-backtest.mjs <session> <date...>
import fs from "node:fs";
import path from "node:path";

const [session = "ny-am", ...dates] = process.argv.slice(2);
if (!dates.length) { console.error("usage: drive-app-backtest.mjs <session> <date...>"); process.exit(2); }

const SYMBOL_ARG = "mnq";
const SYMBOL = "MNQ1!";
const INDEX = path.resolve("state/backtest/index.json");
const PER_RUN_TIMEOUT_MS = 480_000; // 8 min
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function indexEntries() {
  try { return JSON.parse(fs.readFileSync(INDEX, "utf8")).runs ?? []; } catch { return []; }
}
function hasRun(date) { return indexEntries().some((r) => r.date === date && r.session === session); }
function entryFor(date) { return indexEntries().find((r) => r.date === date && r.session === session); }

// ---- CDP to the app renderer ----
const listResp = await (await fetch("http://127.0.0.1:9223/json")).json();
const pageT = listResp.find((t) => t.type === "page" && /localhost:5173/.test(t.url || ""));
if (!pageT?.webSocketDebuggerUrl) { console.error("app renderer not found on 9223"); process.exit(1); }
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); } };
function cdp(method, params = {}) { const id = nextId++; return new Promise((resolve) => { pending.set(id, { resolve }); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalApp(expr) {
  const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text || JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
async function isRunning() { try { return !!(await evalApp(`return (await window.api.backtest.status()).running;`)); } catch { return false; } }
async function waitIdle(maxMs = 600_000) {
  const t0 = Date.now();
  while (await isRunning()) { if (Date.now() - t0 > maxMs) return false; await sleep(4000); }
  return true;
}

console.log(`driving ${dates.length} ${session} runs through the app (symbol=${SYMBOL_ARG})`);
const results = [];
for (const date of dates) {
  await waitIdle();                       // let any in-flight run finish
  if (hasRun(date)) { console.log(`=== ${date} already recorded, skip`); continue; }
  const t0 = Date.now();
  process.stdout.write(`>>> ${date} ${session} ... `);
  try {
    await evalApp(`await window.api.backtest.start({ date: ${JSON.stringify(date)}, session: ${JSON.stringify(session)}, mode: "auto", symbol: ${JSON.stringify(SYMBOL_ARG)} }); return true;`);
  } catch (e) { console.log(`start FAILED: ${e.message?.slice(0,120)}`); results.push({ date, ok: false, error: e.message }); continue; }
  // poll the index until this run commits
  let committed = false;
  while (Date.now() - t0 < PER_RUN_TIMEOUT_MS) {
    if (hasRun(date)) { committed = true; break; }
    await sleep(4000);
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  if (!committed) {
    console.log(`TIMEOUT (${secs}s) — stopping run`);
    try { await evalApp(`await window.api.backtest.stop(); return true;`); } catch {}
    results.push({ date, ok: false, error: "timeout" });
    await sleep(4000);
    continue;
  }
  const e = entryFor(date) ?? {};
  console.log(`ok bars=${e.bars ?? "?"} setups=${e.setups ?? "?"} R=${e.total_r ?? "?"} chain=${e.chain_status ?? "?"} int=${e.open_reaction?.interaction ?? "-"} (${secs}s)`);
  results.push({ date, ok: true, ...e });
}
const okN = results.filter((r) => r.ok).length + dates.filter(hasRun).length - results.filter((r)=>r.ok).length; // committed count
console.log(`\n=== recorded ${dates.filter(hasRun).length}/${dates.length} on disk ===`);

await waitIdle();
console.log(`\nbuilding baseline (fix OFF) for ${SYMBOL} ...`);
try {
  const b = await evalApp(`const r = await window.api.backtest.baseline.refold({ symbol: ${JSON.stringify(SYMBOL)}, reason: "30d corpus baseline" }); return r?.baseline?.total_r ?? r?.total_r ?? r;`);
  console.log(`baseline total_r = ${typeof b === "object" ? JSON.stringify(b).slice(0,200) : b}`);
} catch (e) { console.log("baseline refold FAILED:", e.message?.slice(0,200)); }

console.log(`\nrunning fold-test (fix ON: GOFNQ_HTF_FALLBACK_STANDASIDE=1) ...`);
try {
  const t = await evalApp(`const r = await window.api.backtest.tests.run({ symbol: ${JSON.stringify(SYMBOL)}, label: "htf-fallback stand-aside (30d)", env: { GOFNQ_HTF_FALLBACK_STANDASIDE: "1" } }); return r;`);
  console.log("fold-test:", JSON.stringify(t)?.slice(0, 600));
} catch (e) { console.log("fold-test FAILED:", e.message?.slice(0,300)); }

ws.close();
console.log("\n=== DONE ===");
process.exit(0);
