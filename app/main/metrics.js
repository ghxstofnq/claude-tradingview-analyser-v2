// metrics — append-only event log for brief/wrap/turn outcomes.
//
// Two consumers in mind:
//   1. The human, who can `tail -f state/metrics.jsonl` to see what's
//      happening right now.
//   2. Future scripts that compute success rates, durations, post-validate
//      failure %, etc. The file is line-delimited JSON — `jq` works.
//
// We also keep an in-memory tally that emits a one-line summary every
// hour so the running terminal shows aggregates without grepping the
// file. The audit's "no metrics" gap was that NO ONE knew if briefs were
// succeeding 100% or 60% — now it's countable.
//
// Event shape:
//   { ts: <ISO>, kind: "brief" | "wrap" | "bar-close" | "chat" | "catch-up",
//     event: "started" | "succeeded" | "failed" | "skipped" |
//            "post_validate_failed" | "timeout",
//     session?, reason?, durationMs? }

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const METRICS_FILE = path.join(REPO_ROOT, "state", "metrics.jsonl");
// Hourly summary cadence. Console-only; doesn't write to the jsonl.
const SUMMARY_INTERVAL_MS = 60 * 60 * 1000;

// In-memory tally for the hourly summary. Reset on each summary so the
// log shows "in the last hour" rather than ever-growing totals.
let _tally = freshTally();
let _summaryTimer = null;

function freshTally() {
  return {
    brief: { started: 0, succeeded: 0, failed: 0, skipped: 0, post_validate_failed: 0, timeout: 0 },
    wrap:  { started: 0, succeeded: 0, failed: 0, skipped: 0, post_validate_failed: 0, timeout: 0 },
    "bar-close": { started: 0, succeeded: 0, failed: 0, timeout: 0 },
    chat: { started: 0, succeeded: 0, failed: 0 },
    "catch-up": { started: 0, succeeded: 0, failed: 0 },
  };
}

/**
 * record — log one event. Appends to state/metrics.jsonl AND bumps the
 * in-memory tally. Best-effort: a failed disk write doesn't throw (we
 * don't want metrics to kill the path that's trying to log them).
 */
export async function record(event) {
  if (!event?.kind || !event?.event) return;
  const row = { ts: new Date().toISOString(), ...event };
  // Update tally first so the summary stays accurate even if disk write fails.
  const slot = _tally[event.kind];
  if (slot && Object.prototype.hasOwnProperty.call(slot, event.event)) {
    slot[event.event] += 1;
  }
  // eslint-disable-next-line no-console
  console.log(`[metric] ${event.kind}.${event.event}`,
    event.session ? `session=${event.session}` : "",
    event.durationMs != null ? `duration=${(event.durationMs / 1000).toFixed(1)}s` : "",
    event.reason ? `reason="${String(event.reason).slice(0, 80)}"` : "",
  );
  try {
    await fs.mkdir(path.dirname(METRICS_FILE), { recursive: true });
    await fs.appendFile(METRICS_FILE, JSON.stringify(row) + "\n", "utf8");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[metrics] append failed", err?.message || err);
  }
}

/**
 * startMetricsSummary — log a one-line hourly digest to the console.
 * Called once from electron-main on boot.
 */
export function startMetricsSummary() {
  if (_summaryTimer) return;
  _summaryTimer = setInterval(() => {
    const lines = [];
    for (const kind of Object.keys(_tally)) {
      const t = _tally[kind];
      const total = Object.values(t).reduce((a, b) => a + b, 0);
      if (total === 0) continue;
      const parts = Object.entries(t).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`);
      lines.push(`${kind}: ${parts.join(" ")}`);
    }
    if (lines.length) {
      // eslint-disable-next-line no-console
      console.log("[metrics] last hour —", lines.join(" · "));
    }
    _tally = freshTally();
  }, SUMMARY_INTERVAL_MS);
}

export function stopMetricsSummary() {
  if (_summaryTimer) { clearInterval(_summaryTimer); _summaryTimer = null; }
}
