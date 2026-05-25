// tv-process — the one place that spawns `./bin/tv` subprocesses.
//
// Why a module: every `tv` call ultimately drives the same TradingView desktop
// instance over CDP. Concurrent calls can each open their own CDP connection,
// but the *chart state* (current symbol, current TF) is shared. When a brief
// runs `tv analyze --pair` (which switches the chart symbol mid-capture) and
// a bar-close tick runs `tv analyze --pillar3-only` in parallel, they fight
// over the chart and the bundle whose capture overlaps reads from the wrong
// symbol.
//
// The fix is the queue here: every `tv` call serializes through one mutex.
// All callers (analyze, alerts, future tools) go through runTv / runTvCapture.
//
// Per-call timeout: a hung subprocess shouldn't freeze the queue. Default
// 60s; analyze callers override to 30s/120s as appropriate.

import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const TV_BIN = path.join(REPO_ROOT, "bin", "tv");

const DEFAULT_TIMEOUT_MS = 60_000;

// Global mutex serializing all tv subprocess invocations. Chained on a
// Promise — each call awaits the previous one's release before running.
let _inFlight = Promise.resolve();

// Counters surfaced via getStats() — useful for debugging "is the queue
// backed up?" and exposable to the health monitor later.
let _running = 0;
let _queued = 0;
let _totalCompleted = 0;
let _totalTimedOut = 0;
let _totalFailed = 0;

export function getStats() {
  return { running: _running, queued: _queued, completed: _totalCompleted, timed_out: _totalTimedOut, failed: _totalFailed };
}

/**
 * runTv — spawn `tv <args>`, ignore stdout, resolve on exit code 0.
 * Pre-existing callers used this for fire-and-forget invocations whose
 * output went to a file (via --out).
 *
 * @param {string[]} args
 * @param {object} opts - { spawn?, timeoutMs?, label? }
 */
export function runTv(args, opts = {}) {
  return enqueue(args, opts, /* capture */ false);
}

/**
 * runTvCapture — spawn `tv <args>`, buffer stdout, resolve with the string.
 * Used by tv alert list (parses JSON from stdout) and tv alert create.
 *
 * @param {string[]} args
 * @param {object} opts - { spawn?, timeoutMs?, label? }
 */
export function runTvCapture(args, opts = {}) {
  return enqueue(args, opts, /* capture */ true);
}

function enqueue(args, opts, capture) {
  _queued += 1;
  // Chain onto the in-flight call. Like userTurn's mutex pattern: capture
  // the release function, slot the new lock into the chain, then await the
  // previous lock so we don't start until the queue is ready for us.
  let release;
  const lock = new Promise((r) => (release = r));
  const prev = _inFlight;
  _inFlight = lock;

  return (async () => {
    try {
      await prev;
      _queued -= 1;
      _running += 1;
      try {
        return await runOnce(args, opts, capture);
      } finally {
        _running -= 1;
      }
    } finally {
      release();
    }
  })();
}

function runOnce(args, opts, capture) {
  const spawn = opts.spawn || nodeSpawn;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const label = opts.label || args.slice(0, 2).join(" ");

  return new Promise((resolve, reject) => {
    let settled = false;
    const proc = spawn(TV_BIN, args, { cwd: REPO_ROOT });
    let stdout = capture ? "" : null;
    let stderr = "";
    if (capture) proc.stdout?.on("data", (c) => { stdout += c.toString(); });
    proc.stderr?.on("data", (c) => { stderr += c.toString(); });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      _totalTimedOut += 1;
      try { proc.kill("SIGTERM"); } catch {}
      // Forceful kill if SIGTERM is ignored — the queue can't hang waiting
      // for a misbehaving child.
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 2000);
      reject(new Error(`tv ${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        _totalCompleted += 1;
        resolve(capture ? stdout : undefined);
      } else {
        _totalFailed += 1;
        reject(new Error(`tv ${args.join(" ")} exited ${code}: ${stderr.slice(0, 400)}`));
      }
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _totalFailed += 1;
      reject(err);
    });
  });
}
