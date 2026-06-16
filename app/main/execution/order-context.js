// app/main/execution/order-context.js
// Structure + price for the ORDERS ticket, read from the IN-APP webview chart
// (CDP 9223) — the chart the trader sees and trades — so the symbol + structure
// always follow what's on screen. Runs `analyze --pillar3-only` with
// TV_CDP_PORT=9223; the live loop's 9225 analysis backend is left untouched.
// Caches the last good context in memory for the pure preview path.
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { REPO_ROOT } from "./config.js";
import { structuralStopCandidates, untakenDraws } from "./manual-order.js";

const execFileAsync = promisify(execFile);
const ORDERS_SCAN = path.join(REPO_ROOT, "state", "orders-scan.json");
const WEBVIEW_CDP_PORT = "9223";
// Spawn the CLI via the bin/tv shell wrapper (runs system `node`), not
// process.execPath — from the Electron main process the latter is the Electron
// binary, which doesn't run the script as node when given a custom env. This is
// the same proven pattern as app/main/tools/tv-process.js.
const TV_BIN = path.join(REPO_ROOT, "bin", "tv");

let _cache = null;

export function parseBundle(bundle, source) {
  const symbol = bundle?.chart?.symbol ?? null;
  const price = Number.isFinite(Number(bundle?.quote?.last)) ? Number(bundle.quote.last) : null;
  return {
    symbol, price,
    candidates: structuralStopCandidates(bundle),
    draws: untakenDraws(bundle),
    ts: Date.now(),
    source,
    stale: !bundle?.gates?.engine,
  };
}

function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }

export async function getOrderContext() {
  // Always read the webview chart fresh — pillar3-only is ~0.5s and doesn't flash
  // the chart (no symbol/TF switch), so the ticket mirrors exactly what's on screen.
  //
  // ASYNC spawn is mandatory. This runs in the Electron main process, and the
  // analyze child drives the in-app webview's CDP (9223) — a connection the main
  // process itself must service. spawnSync would BLOCK the main event loop, so the
  // webview CDP never gets serviced, the child hangs, and it times out (ETIMEDOUT).
  try {
    await execFileAsync(TV_BIN, ["analyze", "--pillar3-only", "--out", ORDERS_SCAN],
      { cwd: REPO_ROOT, timeout: 20_000, env: { ...process.env, TV_CDP_PORT: WEBVIEW_CDP_PORT } });
    const b = readJson(ORDERS_SCAN);
    if (b) { _cache = parseBundle(b, "webview"); return _cache; }
  } catch { /* fall through */ }
  if (_cache) return { ..._cache, stale: true };
  return { symbol: null, price: null, candidates: [], draws: { above: [], below: [] }, ts: Date.now(), source: "none", stale: true };
}

export function cachedOrderContext() { return _cache; }
