// Tool wrappers around ./bin/tv alert.
//
// tvAlertCreate({ price, label, condition? }) → tv alert create --price <p> --message <label>
// tvAlertList() → tv alert list (returns parsed JSON from stdout)
//
// All subprocess spawns go through ./tv-process (one global queue +
// per-call timeout) so a hung CLI call can't freeze the queue and
// concurrent chart-touching calls can't collide.

import { runTvCapture } from "./tv-process.js";

// Alert ops are fast (~200ms typical) when the alert list is small. With
// large lists (36+ alerts observed live 2026-05-26), `alert list` takes
// ~20s deterministically — the in-page fetch to pricealerts.tradingview.com
// scales linearly with row count and the CDP evaluateAsync round-trip
// amplifies it. 30s timeout absorbs that worst-case while still being
// short enough to surface a genuinely hung TV. Should probably profile +
// reduce the underlying 20s separately, but that's a follow-up.
const ALERT_TIMEOUT_MS = 30_000;

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
  const stdout = await runTvCapture(args, { ...opts, timeoutMs: opts.timeoutMs ?? ALERT_TIMEOUT_MS, label: args.slice(0, 2).join(" ") });
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
  const out = await runTvCapture(["alert", "list"], { ...opts, timeoutMs: opts.timeoutMs ?? ALERT_TIMEOUT_MS, label: "alert list" });
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
  const stdout = await runTvCapture(["alert", "delete", "--id", String(id)], { ...opts, timeoutMs: opts.timeoutMs ?? ALERT_TIMEOUT_MS, label: "alert delete" });
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
