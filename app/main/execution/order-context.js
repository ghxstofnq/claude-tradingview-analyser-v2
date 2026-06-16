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

// Strip the exchange prefix ("CME_MINI:MES1!" → "MES1!").
const bareSym = (s) => String(s || "").replace(/^[A-Z_]+:/, "");
// Does a captured bundle's symbol satisfy the requested one? No request → any.
export function scanMatchesSymbol(scanSymbol, want) {
  if (!want) return true;
  return bareSym(scanSymbol) === bareSym(want);
}

export async function getOrderContext({ maxAgeMs = 30_000, symbol = null, refresh = false } = {}) {
  // 1) recent last-scan from the live loop — only if it's the requested symbol
  //    (the live loop may be on a different instrument than the trader's ticket).
  try {
    if (!refresh && existsSync(LAST_SCAN) && Date.now() - statSync(LAST_SCAN).mtimeMs < maxAgeMs) {
      const b = readJson(LAST_SCAN);
      if (b?.gates?.engine && scanMatchesSymbol(b?.chart?.symbol, symbol)) { _cache = parseBundle(b, "last-scan"); return _cache; }
    }
  } catch { /* fall through */ }
  // 2) on-demand pillar3-only analyze, pinned to the requested symbol so the
  //    bundle reflects the trader's chart (not whatever 9225 was last on).
  try {
    const args = [path.join(REPO_ROOT, "cli", "index.js"), "analyze", "--pillar3-only", "--out", ORDERS_SCAN];
    if (symbol) args.push("--symbol", symbol);
    const r = spawnSync(process.execPath, args, { cwd: REPO_ROOT, timeout: 20_000, encoding: "utf8" });
    if (r.status === 0) {
      const b = readJson(ORDERS_SCAN);
      if (b) { _cache = parseBundle(b, "fresh-analyze"); return _cache; }
    }
  } catch { /* fall through */ }
  // 3) last good cache, marked stale — only if it matches the requested symbol
  if (_cache && scanMatchesSymbol(_cache.symbol, symbol)) return { ..._cache, stale: true };
  return { symbol: null, price: null, candidates: [], draws: { above: [], below: [] }, ts: Date.now(), source: "none", stale: true };
}

export function cachedOrderContext() { return _cache; }
