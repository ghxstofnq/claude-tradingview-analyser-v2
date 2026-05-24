// Opportunistic cache of per-symbol last prices.
//
// Every time tv_analyze_full / tv_analyze_fast runs, we capture
// {chart.symbol, quote.last, quote.time} into state/symbol-cache.json so the
// symbol-switcher dropdown can show a recent price for symbols the user has
// visited at least once. Never-visited symbols stay blank.
//
// No background sweeps — pure cache-on-write. The trader sees `last_known_px ·
// 14m old` rather than fake values or empty cells.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CACHE_FILE = path.join(REPO_ROOT, "state", "symbol-cache.json");

async function readCache() {
  try { return JSON.parse(await fs.readFile(CACHE_FILE, "utf8")); }
  catch { return {}; }
}

async function writeCache(c) {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(c, null, 2), "utf8");
}

// Pull a price out of a tv_analyze bundle. Handles both full and fast.
function extractFromBundle(bundle) {
  if (!bundle) return null;
  const sym = bundle?.chart?.symbol;
  const px = bundle?.quote?.last;
  const t = bundle?.quote?.time || bundle?.timestamp;
  if (!sym || typeof px !== "number") return null;
  return { sym, px, ts: t || new Date().toISOString() };
}

// Public — called fire-and-forget after every tv analyze run.
export async function updateFromBundle(bundle) {
  const hit = extractFromBundle(bundle);
  if (!hit) return;
  const c = await readCache();
  c[hit.sym] = { px: hit.px, ts: hit.ts };
  await writeCache(c);
}

export async function getCache() {
  return readCache();
}
