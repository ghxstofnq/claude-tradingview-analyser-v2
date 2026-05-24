// Tool wrappers around ./bin/tv alert.
//
// tvAlertCreate({ price, label, condition? }) → tv alert create --price <p> --message <label>
// tvAlertList() → tv alert list (returns parsed JSON from stdout)

import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const TV_BIN = path.join(REPO_ROOT, "bin", "tv");

function runTvCapture(args, { spawn = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(TV_BIN, args, { cwd: REPO_ROOT });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`tv ${args.join(" ")} exited ${code}: ${stderr.slice(0, 400)}`));
    });
    proc.on("error", (err) => reject(err));
  });
}

// Create a TradingView price alert. Parses the CLI's JSON output so caller
// (renderer) sees real failures + drift warnings — the old wrapper always
// returned {ok:true}, hiding silent breakage when TV's DOM changed.
export async function tvAlertCreate({ price, label, condition }, opts = {}) {
  const args = [
    "alert", "create",
    "--price", String(price),
    "--message", String(label),
  ];
  if (condition) args.push("--condition", condition);
  const stdout = await runTvCapture(args, opts);
  let result;
  try { result = JSON.parse(stdout); }
  catch {
    throw new Error(`alert create returned unparseable output: ${stdout.slice(0, 200)}`);
  }
  if (result.success === false) {
    const detail = result.reason || result.err?.message || "unknown failure";
    const err = new Error(`alert create failed: ${detail}`);
    err.detail = result;
    throw err;
  }
  return {
    ok: true,
    alert_id: result.alert_id ?? null,
    requested_price: result.requested_price ?? Number(price),
    created_price: result.created_price ?? null,
    drift: result.drift ?? null,
    drift_warning: result.drift_warning ?? null,
  };
}

export async function tvAlertList(_input, opts = {}) {
  const out = await runTvCapture(["alert", "list"], opts);
  // The CLI prints JSON-able output; try to parse, fall back to raw string.
  try {
    return JSON.parse(out);
  } catch {
    return { raw: out };
  }
}

// Per-alert delete by alert_id. Returns {ok, deleted_id} on success, throws
// on failure (caller — IPC handler — turns the throw into {ok:false, error}).
export async function tvAlertDeleteOne({ id }, opts = {}) {
  if (id == null) throw new Error('tvAlertDeleteOne requires id');
  const stdout = await runTvCapture(["alert", "delete", "--id", String(id)], opts);
  let result;
  try { result = JSON.parse(stdout); }
  catch { throw new Error(`alert delete returned unparseable output: ${stdout.slice(0, 200)}`); }
  if (result.success === false) {
    const err = new Error(`alert delete failed: ${result.reason || 'unknown'}`);
    err.detail = result;
    throw err;
  }
  return { ok: true, deleted_id: result.deleted_id, elapsed_ms: result.elapsed_ms };
}
