// Tool wrappers around ./bin/tv analyze.
//
// tvAnalyzeFull — full multi-TF sweep (~13s). Writes to state/last-analyze.json.
// tvAnalyzeFast — fast pillar-3 poll with optional baseline reuse (~0.2s).
//                 Writes to state/last-scan.json.
//
// The functions are exported so they can be unit-tested with a stub spawn.

import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const TV_BIN = path.join(REPO_ROOT, "bin", "tv");

function runTv(args, { spawn = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(TV_BIN, args, { cwd: REPO_ROOT });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tv ${args.join(" ")} exited ${code}: ${stderr.slice(0, 400)}`));
    });
    proc.on("error", (err) => reject(err));
  });
}

async function readBundle(outPath, opts) {
  if (opts.skipRead) return { path: outPath };
  const txt = await fs.readFile(outPath, "utf8");
  try {
    return { path: outPath, bundle: JSON.parse(txt) };
  } catch {
    return { path: outPath, bundle_raw: txt };
  }
}

export async function tvAnalyzeFull(_input, opts = {}) {
  const outPath = opts.outPath || path.join(REPO_ROOT, "state", "last-analyze.json");
  await runTv(["analyze", "--out", outPath], opts);
  return readBundle(outPath, opts);
}

export async function tvAnalyzeFast({ baseline } = {}, opts = {}) {
  const outPath = opts.outPath || path.join(REPO_ROOT, "state", "last-scan.json");
  const args = ["analyze", "--pillar3-only", "--out", outPath];
  if (baseline) args.push("--baseline", baseline);
  await runTv(args, opts);
  return readBundle(outPath, opts);
}
