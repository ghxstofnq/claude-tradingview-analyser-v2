// app/main/execution/order-context.js
// Structure + price for the ORDERS ticket, read from the IN-APP webview chart
// (CDP 9223) — the chart the trader sees and trades — so the symbol + structure
// always follow what's on screen. Runs `analyze --pillar3-only` with
// TV_CDP_PORT=9223; the live loop's 9225 analysis backend is left untouched.
// Caches the last good context in memory for the pure preview path.
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./config.js";
import { structuralStopCandidates, untakenDraws } from "./manual-order.js";

const ORDERS_SCAN = path.join(REPO_ROOT, "state", "orders-scan.json");
const WEBVIEW_CDP_PORT = "9223";

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
  try {
    const r = spawnSync(process.execPath,
      [path.join(REPO_ROOT, "cli", "index.js"), "analyze", "--pillar3-only", "--out", ORDERS_SCAN],
      { cwd: REPO_ROOT, timeout: 15_000, encoding: "utf8", env: { ...process.env, TV_CDP_PORT: WEBVIEW_CDP_PORT } });
    if (r.status === 0) {
      const b = readJson(ORDERS_SCAN);
      if (b) { _cache = parseBundle(b, "webview"); return _cache; }
    }
  } catch { /* fall through */ }
  if (_cache) return { ..._cache, stale: true };
  return { symbol: null, price: null, candidates: [], draws: { above: [], below: [] }, ts: Date.now(), source: "none", stale: true };
}

export function cachedOrderContext() { return _cache; }
