// scheduled-turn — one factory used by both session-brief and session-wrap.
//
// Before: two near-identical 160-line modules. Same scheduler math, same
// _running mutex, same bootstrap pattern, same IPC status emissions, same
// hardcoded retry policy (none). Every fix had to be made twice.
//
// After: a single makeScheduledTurn(config) call returns { bootstrap,
// runManual, run, stop }. Callers pass the parts that differ — clock
// triggers, completion check, prompt builder, IPC channel name.
//
// Bug fixes that fall out of consolidation:
//   - 72h trigger walk (was 26h) — Friday afternoon used to find no
//     weekday in the window and silently die. Now reaches Monday.
//   - Retry-on-error after 60s — was none. Single retry; if that also
//     fails, give up and wait for the next scheduled trigger or a manual.
//   - "skipped" status now reports a reason, surfaced in onStatus events.

import { userTurn, resetSession } from "./sdk.js";
import { record as recordMetric } from "./metrics.js";

const TRIGGER_LOOKAHEAD_MIN = 72 * 60; // walk up to 72 hours for next trigger
const RETRY_AFTER_MS = 60_000;          // one retry on failure

function nyParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, weekday: "short",
  }).formatToParts(date);
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

// dateMsFromNyHM — the next weekday HH:MM ET as a Date.now()-comparable
// timestamp. Walks minute-by-minute (DST-correct: we ask the formatter for
// the ET hour/minute on each probe). Cap 72h so Friday afternoon finds
// Monday's first trigger — the prior 26h cap died on Friday.
function dateMsFromNyHM(hour, minute) {
  const now = Date.now();
  for (let off = 0; off < TRIGGER_LOOKAHEAD_MIN; off += 1) {
    const probe = now + off * 60_000;
    const p = nyParts(new Date(probe));
    if (p.hour === hour && p.minute === minute && p.weekday !== "Sat" && p.weekday !== "Sun") {
      return Math.floor(probe / 60_000) * 60_000;
    }
  }
  return null;
}

function nextTrigger(triggers) {
  const candidates = triggers
    .map((t) => ({ session: t.session, at: dateMsFromNyHM(t.hour, t.minute) }))
    .filter((c) => c.at != null && c.at > Date.now())
    .sort((a, b) => a.at - b.at);
  return candidates[0] || null;
}

/**
 * makeScheduledTurn — build a scheduled-turn driver.
 *
 * Note on mode coupling: schedulers always fire, even during LIVE. The
 * userTurn mutex (sdk.js) prevents corruption when a brief lands while a
 * bar-close turn is running; the loser just queues. A 13:00 NY PM brief
 * during active LIVE trading is *desirable* — the trader is transitioning
 * between sessions. So no onModeChange subscription here.
 *
 * @param {object} config
 * @param {string} config.name             "brief" | "wrap" — used for logs
 * @param {string} config.purpose          userTurn purpose tag
 * @param {string} config.statusChannel    IPC channel for state updates
 * @param {object[]} config.triggers       [{ session, hour, minute }, ...]
 * @param {function} config.activeSessionFn  () => session | null — what
 *   session should fire right now (used by bootstrap + manual refresh)
 * @param {function} config.isAlreadyDoneFn  (session) => Promise<boolean>
 *   true means skip (today's brief/wrap is already on disk)
 * @param {function} config.buildPromptFn    (session) => Promise<string>
 * @param {function?} config.preflightFn     (session) => Promise<{ok, reason?}>
 *   optional precondition check; falsy ok → skip with that reason
 * @param {function?} config.postValidateFn  (toolCalls, session) => string|null
 *   optional post-turn validator; non-null return is an error message
 *   that gets surfaced via app:error + status:error. toolCalls is the
 *   array of tool-call names emitted during the turn.
 * @param {function?} config.onSuccessFn  (session) => Promise<void>
 *   optional fire-and-forget hook called after a successful turn (no
 *   error, postValidate clean). Used by session-wrap to spawn the
 *   post-wrap memory-review turn. Errors are caught + logged; they
 *   never bubble back to fail the parent turn.
 * @param {number?} config.timeoutMs  per-turn wall-clock budget. Omit to
 *   inherit userTurn's default (5 min). Briefs override to 10 min because
 *   tv_analyze_full + dual-symbol Opus 4.7 xhigh reasoning + two surface
 *   calls regularly run 3–7 min.
 */
export function makeScheduledTurn(config) {
  let _send = null;
  let _timer = null;
  let _retryTimer = null;
  let _running = false;

  async function run(session, { isRetry = false } = {}) {
    if (!session) return;
    if (_running) {
      _send?.(config.statusChannel, { state: "skipped", session, reason: "another turn already in flight" });
      recordMetric({ kind: config.purpose, event: "skipped", session, reason: "concurrent" });
      return;
    }
    if (await config.isAlreadyDoneFn(session)) {
      _send?.(config.statusChannel, { state: "skipped", session, reason: "already complete" });
      recordMetric({ kind: config.purpose, event: "skipped", session, reason: "already complete" });
      return;
    }

    // Optional precondition (market closed, replay active, chart on wrong
    // symbol, etc.). If preflight reports !ok, skip with the reason.
    if (config.preflightFn) {
      const preflight = await config.preflightFn(session).catch((err) => ({
        ok: false, reason: `preflight threw: ${err?.message || err}`,
      }));
      if (!preflight?.ok) {
        _send?.(config.statusChannel, {
          state: "skipped", session, reason: preflight?.reason || "preflight failed",
        });
        recordMetric({ kind: config.purpose, event: "skipped", session, reason: preflight?.reason || "preflight failed" });
        return;
      }
    }

    _running = true;
    _send?.(config.statusChannel, { state: "running", session });
    recordMetric({ kind: config.purpose, event: "started", session });
    const startedAt = Date.now();
    const toolCalls = [];
    let errored = false;
    let lastErrorMsg = null;   // captured from any "error" event so we can record it
    let metricRecorded = false; // guard against double-recording succeed/fail
    let usage = null;     // populated by the "usage" event when the turn succeeds
    try {
      const text = await config.buildPromptFn(session);
      await userTurn({
        text,
        purpose: config.purpose,
        timeoutMs: config.timeoutMs,   // undefined → userTurn default (5 min)
        onEvent: (e) => {
          if (e.type === "chunk") _send?.("chat:chunk", e);
          else if (e.type === "tool_call") {
            if (e.name) toolCalls.push(e.name);
            _send?.("chat:tool_call", e);
          }
          else if (e.type === "turn_complete") _send?.("chat:turn_complete", e);
          else if (e.type === "usage") { usage = e.usage; }
          else if (e.type === "error") {
            errored = true;
            lastErrorMsg = e.message || lastErrorMsg;
            _send?.("app:error", { source: config.name, message: e.message });
          }
        },
      });
      // Post-validate the tool calls the turn made. Lets us detect
      // "completed but produced no brief" / "only 1 of 2 dual-symbol
      // briefs landed" — both silent failures before this.
      if (!errored && config.postValidateFn) {
        const problem = config.postValidateFn(toolCalls, session);
        if (problem) {
          errored = true;
          lastErrorMsg = problem;
          _send?.("app:error", { source: config.name, message: problem });
          _send?.(config.statusChannel, { state: "error", session, message: problem });
          recordMetric({ kind: config.purpose, event: "post_validate_failed", session, reason: problem, durationMs: Date.now() - startedAt });
          metricRecorded = true;
        }
      }
      if (!errored) {
        _send?.(config.statusChannel, { state: "idle", session });
        recordMetric({
          kind: config.purpose,
          event: "succeeded",
          session,
          durationMs: Date.now() - startedAt,
          usage,
        });
        metricRecorded = true;
        // Optional onSuccess hook — fire-and-forget. Used by session-wrap
        // to spawn the post-wrap memory-review turn. Errors here must
        // never bubble back into the parent turn's status.
        if (config.onSuccessFn) {
          Promise.resolve(config.onSuccessFn(session)).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn(`[${config.name}] onSuccessFn threw`, err?.message || err);
          });
        }
      } else if (!metricRecorded) {
        // Errored without a thrown exception (e.g. userTurn timeout emits
        // "error" + "turn_complete" and returns normally). Previously this
        // produced a started→nothing pair in metrics.jsonl with no failure
        // record. Now we explicitly record it so the dashboard / spend
        // roll-up sees the run.
        const msg = lastErrorMsg || "errored without thrown exception";
        _send?.(config.statusChannel, { state: "error", session, message: msg });
        recordMetric({ kind: config.purpose, event: "failed", session, reason: msg, durationMs: Date.now() - startedAt });
        metricRecorded = true;
      }
    } catch (err) {
      errored = true;
      // eslint-disable-next-line no-console
      console.error(`[${config.name}] run failed`, err);
      const msg = String(err?.message || err);
      _send?.(config.statusChannel, { state: "error", session, message: msg });
      if (!metricRecorded) {
        recordMetric({ kind: config.purpose, event: "failed", session, reason: msg, durationMs: Date.now() - startedAt });
        metricRecorded = true;
      }
    } finally {
      _running = false;
    }

    // One retry on error. Guarded by isRetry so a failed retry doesn't loop.
    if (errored && !isRetry) {
      // Drop the cached session_id for this purpose so the retry starts a
      // fresh conversation. If the first attempt died mid-tool-call (e.g.
      // userTurn timeout), the SDK still has a confused partial state on
      // that session_id — resuming makes the model see its own truncated
      // output and try to "continue", often timing out again. A clean
      // session forces it to re-read the user prompt from scratch.
      resetSession(config.purpose);
      if (_retryTimer) clearTimeout(_retryTimer);
      _retryTimer = setTimeout(() => {
        _retryTimer = null;
        run(session, { isRetry: true }).catch(() => {});
      }, RETRY_AFTER_MS);
      // eslint-disable-next-line no-console
      console.log(`[${config.name}] scheduling one retry in ${RETRY_AFTER_MS / 1000}s (session cleared)`);
    }
  }

  async function runManual() {
    const session = config.activeSessionFn();
    if (!session) {
      _send?.(config.statusChannel, { state: "skipped", reason: "no eligible session right now" });
      return;
    }
    await run(session);
  }

  function scheduleNext() {
    if (_timer) clearTimeout(_timer);
    const next = nextTrigger(config.triggers);
    if (!next) return;
    const ms = next.at - Date.now();
    _timer = setTimeout(async () => {
      await run(next.session);
      scheduleNext();
    }, ms);
    // eslint-disable-next-line no-console
    console.log(`[${config.name}] next trigger`, next.session, "in", Math.round(ms / 1000), "s");
  }

  async function bootstrap({ send }) {
    _send = send;
    const session = config.activeSessionFn();
    if (session && !(await config.isAlreadyDoneFn(session))) {
      run(session).catch(() => {});
    }
    scheduleNext();
  }

  function stop() {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
  }

  // rearm — re-pick the next trigger and reschedule. Call this from the
  // power-monitor "resume" handler: setTimeout doesn't fire while the
  // laptop is asleep, so on wake the scheduler is silent until we re-arm.
  // Also fires a catch-up run if today's session brief is missing (we
  // slept through the trigger), so the user wakes to a fresh brief.
  async function rearm() {
    if (_timer) clearTimeout(_timer);
    const session = config.activeSessionFn();
    if (session && !(await config.isAlreadyDoneFn(session))) {
      run(session).catch(() => {});
    }
    scheduleNext();
  }

  return { bootstrap, run, runManual, stop, rearm };
}
