// Tool wrappers around ./bin/tv analyze.
//
// tvAnalyzeFull — full multi-TF sweep (~13s). Writes to state/last-analyze.json.
// tvAnalyzeFast — fast pillar-3 poll with optional baseline reuse (~0.2s).
//                 Writes to state/last-scan.json.
//
// The functions are exported so they can be unit-tested with a stub spawn.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateFromBundle } from "../symbol-cache.js";
import { runTv } from "./tv-process.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

// Timeouts: full multi-TF capture is ~15s nominal, ~25s worst case.
// Fast pillar3 with cached baseline is sub-second to a few seconds.
const ANALYZE_FULL_TIMEOUT_MS = 60_000;
const ANALYZE_FAST_TIMEOUT_MS = 30_000;

async function readBundle(outPath, opts) {
  if (opts.skipRead) return { path: outPath };
  const txt = await fs.readFile(outPath, "utf8");
  try {
    const bundle = JSON.parse(txt);
    // Fire-and-forget — symbol-cache write must not block the analyze return.
    updateFromBundle(bundle).catch(() => {});
    return { path: outPath, bundle };
  } catch {
    return { path: outPath, bundle_raw: txt };
  }
}

export async function tvAnalyzeFull({ pair, baselineSecondary } = {}, opts = {}) {
  const outPath = opts.outPath || path.join(REPO_ROOT, "state", "last-analyze.json");
  const args = ["analyze", "--out", outPath];
  if (pair) args.push("--pair", pair);
  if (baselineSecondary) args.push("--baseline-secondary", baselineSecondary);
  await runTv(args, { ...opts, timeoutMs: opts.timeoutMs ?? ANALYZE_FULL_TIMEOUT_MS, label: "analyze full" });
  return readBundle(outPath, opts);
}

export async function tvAnalyzeFast({ baseline, pair, baselineSecondary, scanTf } = {}, opts = {}) {
  const outPath = opts.outPath || path.join(REPO_ROOT, "state", "last-scan.json");
  const args = ["analyze", "--pillar3-only", "--out", outPath];
  if (baseline) args.push("--baseline", baseline);
  if (pair) args.push("--pair", pair);
  if (baselineSecondary) args.push("--baseline-secondary", baselineSecondary);
  // scanTf briefly switches the chart to this TF, captures, and restores —
  // used to grab a FRESH 5m engine on 5m closes (live fresh-5m capture).
  if (scanTf) args.push("--scan-tf", String(scanTf));
  await runTv(args, { ...opts, timeoutMs: opts.timeoutMs ?? ANALYZE_FAST_TIMEOUT_MS, label: "analyze fast" });
  return readBundle(outPath, opts);
}
