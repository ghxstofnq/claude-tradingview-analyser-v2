// shutdown-flush — fire one final memory-review turn before the app
// exits, so lessons from a half-day session aren't lost.
//
// Hermes Agent calls commit_memory_session() at every session boundary
// (compression rotation, /reset, /new). Our equivalent is the wrap turn
// → review turn pair, but those only fire if a session actually wraps
// (12:05 / 16:05 ET). If the user quits the app mid-day, no review
// happens and any session-side observations are lost.
//
// This module hooks Electron's before-quit:
//   - Find the most recent session folder for today
//   - If it has a summary.md, the session already wrapped — nothing to do
//   - Otherwise fire one review turn (purpose="review") with a tight
//     timeout and a synthetic prompt that asks the agent to extract
//     anything worth keeping
//
// Bounded at FINAL_REVIEW_TIMEOUT_MS (60s) so app exit isn't held up
// indefinitely. Best-effort: errors are logged but never blocked.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { userTurn } from "./sdk.js";
import { record as recordMetric } from "./metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SESSION_ROOT = path.join(REPO_ROOT, "state", "session");

const FINAL_REVIEW_TIMEOUT_MS = 60_000;
const SESSION_ORDER = ["ny-pm", "ny-am", "london"]; // newest-first

// Shared completion latch so the before-quit handler doesn't loop forever
// if app.quit() fires multiple times.
export const flushPendingReview = { completed: false };

function todayET() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * findUnwrappedSession — locate the most recent session folder from today
 * that has activity but no summary.md (i.e. didn't wrap before shutdown).
 * Returns { session, dir } or null.
 *
 * "Activity" = at least one of pillar1.md / open-reaction.md / setups.jsonl
 * present. Empty folders (created but never written to) are skipped.
 */
async function findUnwrappedSession() {
  const today = todayET();
  const dayDir = path.join(SESSION_ROOT, today);
  let sessionDirs;
  try {
    const entries = await fs.readdir(dayDir, { withFileTypes: true });
    sessionDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  // Newest-first preference: ny-pm > ny-am > london (matches the typical
  // workflow — quit mid-day usually leaves ny-pm or ny-am unwrapped).
  for (const sess of SESSION_ORDER) {
    if (!sessionDirs.includes(sess)) continue;
    const dir = path.join(dayDir, sess);
    const wrapped = await fileExists(path.join(dir, "summary.md"));
    if (wrapped) continue;
    const hasActivity =
      (await fileExists(path.join(dir, "pillar1.md"))) ||
      (await fileExists(path.join(dir, "open-reaction.md"))) ||
      (await fileExists(path.join(dir, "setups.jsonl")));
    if (hasActivity) return { session: sess, dir };
  }
  return null;
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * fireFinalReview — main entry point. Called from electron-main's
 * before-quit handler. Returns a promise that resolves either on
 * review completion or on timeout.
 */
export async function fireFinalReview() {
  const candidate = await findUnwrappedSession().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[shutdown] findUnwrappedSession threw", err?.message || err);
    return null;
  });

  if (!candidate) {
    // Nothing to flush — either no session today, or the active session
    // already wrapped. Cheap exit.
    // eslint-disable-next-line no-console
    console.log("[shutdown] no unwrapped session — nothing to flush");
    return;
  }

  const { session } = candidate;
  // eslint-disable-next-line no-console
  console.log(`[shutdown] flushing unwrapped session ${session} via review turn`);

  recordMetric({ kind: "review", event: "started", session, reason: "shutdown-flush" });
  const startedAt = Date.now();

  // Synthetic prompt — narrower than the post-wrap review because there
  // is no summary.md to read. Ask the agent to inspect setups.jsonl and
  // any pillar files directly.
  const text =
    `The app is shutting down and the ${session.toUpperCase()} session did NOT wrap normally. ` +
    `Read whatever exists in state/session/<today>/${session}/ (setups.jsonl, pillar1.md, ` +
    `open-reaction.md if present) and decide whether anything is worth saving to persistent ` +
    `memory per your system prompt guidance. ` +
    `This is a graceful-exit pass — be brief. "Nothing to save" is fine if the session was light.`;

  let errored = false;
  try {
    await userTurn({
      text,
      purpose: "review",
      timeoutMs: FINAL_REVIEW_TIMEOUT_MS,
      onEvent: (e) => {
        if (e.type === "error") {
          errored = true;
          // eslint-disable-next-line no-console
          console.warn(`[shutdown] review error`, e.message);
        }
      },
    });
    recordMetric({
      kind: "review",
      event: errored ? "failed" : "succeeded",
      session,
      durationMs: Date.now() - startedAt,
      reason: "shutdown-flush",
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[shutdown] review turn threw", err?.message || err);
    recordMetric({
      kind: "review",
      event: "failed",
      session,
      reason: String(err?.message || err),
      durationMs: Date.now() - startedAt,
    });
  }
}
