// app/main/execution/order-context.js
// Fresh structure + price for the ORDERS ticket. Prefers a recent
// state/last-scan.json (the live loop writes it during sessions); else runs an
// on-demand `analyze --pillar3-only` against the analysis chart (TV Desktop
// 9225). Caches the last good context in memory for the pure preview path.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./config.js";
import { structuralStopCandidates, untakenDraws } from "./manual-order.js";

const LAST_SCAN = path.join(REPO_ROOT, "state", "last-scan.json");
const ORDERS_SCAN = path.join(REPO_ROOT, "state", "orders-scan.json");

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

export async function getOrderContext({ maxAgeMs = 30_000 } = {}) {
  // 1) recent last-scan from the live loop
  try {
    if (existsSync(LAST_SCAN) && Date.now() - statSync(LAST_SCAN).mtimeMs < maxAgeMs) {
      const b = readJson(LAST_SCAN);
      if (b?.gates?.engine) { _cache = parseBundle(b, "last-scan"); return _cache; }
    }
  } catch { /* fall through */ }
  // 2) on-demand pillar3-only analyze against the analysis chart
  try {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, "cli", "index.js"), "analyze", "--pillar3-only", "--out", ORDERS_SCAN], { cwd: REPO_ROOT, timeout: 15_000, encoding: "utf8" });
    if (r.status === 0) {
      const b = readJson(ORDERS_SCAN);
      if (b) { _cache = parseBundle(b, "fresh-analyze"); return _cache; }
    }
  } catch { /* fall through */ }
  // 3) last good cache, marked stale
  if (_cache) return { ..._cache, stale: true };
  return { symbol: null, price: null, candidates: [], draws: { above: [], below: [] }, ts: Date.now(), source: "none", stale: true };
}

export function cachedOrderContext() { return _cache; }
