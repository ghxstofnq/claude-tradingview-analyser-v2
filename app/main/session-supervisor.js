// Session supervisor — keeps the live loop alive during trading windows and
// tells the trader when it can't.
//
// Why this exists (June 2026 post-mortem): the detector heartbeat died on
// June 8 and nothing restarted it; live mode only flips via a manual
// detector:start click since the mode tabs were removed, so most days the
// entire live chain (open reaction → entry hunt → setups) never ran while
// briefs and wraps kept writing. Three gaps, three behaviors here:
//
//   1. Auto-arm: during a session window (london / ny-am / ny-pm, ET), if
//      mode isn't live, set it and start the detector. A manual stop is
//      respected for the remainder of that session only.
//   2. Heartbeat watchdog: the detector writes a heartbeat file every poll
//      iteration. Stale (> HEARTBEAT_STALE_S) or missing during a session →
//      kill + restart, capped per session, then one loud give-up.
//      Exit-based restart in bar-close.js can't catch hung-but-alive.
//   3. Pre-session readiness: in the lead window before each open, run the
//      CLI's fail-closed `live-check` once and notify with the blocker list
//      if blocked (CDP down / wrong symbol / engine stale / replay on).
//
// The decision core is pure (planSupervisorAction / upcomingSession) and the
// runtime is dependency-injected (createSessionSupervisor) so all of it unit
// tests without electron or CDP. startSessionSupervisor wires production deps.

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const HEARTBEAT = path.join(REPO_ROOT, "state", "session", "detector-heartbeat.json");

export const TICK_INTERVAL_MS = 30_000;
export const HEARTBEAT_STALE_S = 120;
export const INTERVENTION_GRACE_S = 90;
export const RESTART_CAP_PER_SESSION = 3;
export const READINESS_LEAD_MINUTES = 10;
const READINESS_TIMEOUT_MS = 30_000;

// Session opens in ET minutes — must match app/main/sessions.js#currentSession.
const SESSION_OPENS_ET = { london: 3 * 60, "ny-am": 9 * 60 + 30, "ny-pm": 13 * 60 };

/**
 * Which session opens within the next `leadMinutes`? Null when none (mid-day,
 * mid-session, weekends). Drives the pre-open readiness check.
 */
export function upcomingSession({ weekday, etMinutes, leadMinutes = READINESS_LEAD_MINUTES }) {
  if (weekday === "Sat" || weekday === "Sun") return null;
  for (const [session, open] of Object.entries(SESSION_OPENS_ET)) {
    if (etMinutes >= open - leadMinutes && etMinutes < open) return session;
  }
  return null;
}

/**
 * Pure decision: given the observed state, what should the supervisor do?
 * Returns { action: 'arm'|'restart_detector'|'give_up'|'disarm'|'none', reason }.
 */
export function planSupervisorAction({
  session,
  mode,
  heartbeatAgeS = null,
  hasOpenTrades = false,
  manualStopSession = null,
  restartsThisSession = 0,
  secondsSinceIntervention = Infinity,
  backtestActive = false,
  staleCode = false,
}) {
  // A backtest holds the chart (TV 9225 is shared). Stand down completely —
  // never arm, restart, or disarm — until it releases. The detector was already
  // paused imperatively at backtest start; live re-arms on the first tick after.
  if (backtestActive) return { action: "none", reason: "backtest_active" };
  if (session === "idle") {
    if (mode === "live" && !hasOpenTrades) return { action: "disarm", reason: "session_over" };
    return { action: "none", reason: mode === "live" ? "open_trades" : "idle" };
  }
  if (manualStopSession === session) return { action: "none", reason: "manual_stop" };
  if (mode !== "live") {
    // Parity keystone: never cold-arm a live session on stale code. When the
    // running process is behind the on-disk code (version-status restart_needed),
    // the live chain would fold a DIFFERENT brain than the backtest does — the
    // exact divergence behind backtest≠live. Refuse to arm until the app restarts.
    if (staleCode) return { action: "block_arm_stale", reason: "stale_code" };
    return { action: "arm", reason: `session_${session}_open` };
  }
  if (heartbeatAgeS != null && heartbeatAgeS <= HEARTBEAT_STALE_S) return { action: "none", reason: "healthy" };
  if (secondsSinceIntervention < INTERVENTION_GRACE_S) return { action: "none", reason: "intervention_grace" };
  if (restartsThisSession < RESTART_CAP_PER_SESSION) return { action: "restart_detector", reason: "heartbeat_stale" };
  if (restartsThisSession === RESTART_CAP_PER_SESSION) return { action: "give_up", reason: "restart_cap" };
  return { action: "none", reason: "gave_up" };
}

/**
 * DI runtime. deps:
 *   getSession() → { session, date, weekday, etMinutes }
 *   getMode() / setMode(mode)
 *   heartbeatAgeS() → seconds | null         (async)
 *   startDetector() / stopDetector() / resetDetectorRestarts()
 *   hasOpenTrades() → bool                   (async)
 *   isStaleCode() → bool                     (running process behind on-disk code)
 *   runReadinessCheck(session) → readiness   (async; the CLI live-check verdict)
 *   notify({ level, title, body })           (system + in-app)
 *   send(channel, payload)                   (renderer event stream)
 *   recordMetric(event)
 *   nowMs() → epoch ms                       (optional; tests)
 */
export function createSessionSupervisor(deps) {
  const nowMs = deps.nowMs || Date.now;
  const state = {
    sessionKey: null,
    restartsThisSession: 0,
    manualStopKey: null,
    lastInterventionMs: null,
    readinessCheckedKey: null,
    readinessInFlight: false,
    staleNotifiedKey: null,
  };

  function keyFor(date, session) {
    return `${date}:${session}`;
  }

  async function maybeRunReadiness({ session, date, weekday, etMinutes }) {
    const target = session !== "idle"
      ? session
      : upcomingSession({ weekday, etMinutes, leadMinutes: READINESS_LEAD_MINUTES });
    if (!target) return;
    const key = keyFor(date, target);
    if (state.readinessCheckedKey === key || state.readinessInFlight) return;
    state.readinessCheckedKey = key;
    state.readinessInFlight = true;
    try {
      const readiness = await deps.runReadinessCheck(target);
      const ok = readiness?.ok === true;
      deps.send?.("supervisor:readiness", { session: target, ok, blockers: readiness?.blockers || [] });
      deps.recordMetric?.({ kind: "supervisor", event: "readiness", session: target, ok, blockers: readiness?.blockers || [] });
      if (!ok) {
        deps.notify?.({
          level: "error",
          title: "Pre-session readiness BLOCKED",
          body: `${target}: ${(readiness?.blockers || ["readiness_unknown"]).join(", ")} — live loop will not produce setups until fixed.`,
        });
      }
    } catch (err) {
      deps.send?.("supervisor:readiness", { session: target, ok: false, blockers: ["readiness_check_failed"] });
      deps.notify?.({
        level: "error",
        title: "Pre-session readiness check FAILED",
        body: `${target}: ${err?.message || err}`,
      });
    } finally {
      state.readinessInFlight = false;
    }
  }

  async function tick() {
    const now = nowMs();
    const snap = deps.getSession();
    const { session, date } = snap;

    // Session-window edge: reset per-session counters + manual-stop latch.
    if (session !== "idle") {
      const key = keyFor(date, session);
      if (state.sessionKey !== key) {
        state.sessionKey = key;
        state.restartsThisSession = 0;
        state.lastInterventionMs = null;
      }
    }

    await maybeRunReadiness(snap);

    const plan = planSupervisorAction({
      session,
      mode: deps.getMode(),
      heartbeatAgeS: await deps.heartbeatAgeS(),
      hasOpenTrades: await deps.hasOpenTrades(),
      manualStopSession: state.manualStopKey === state.sessionKey && session !== "idle" ? session : null,
      restartsThisSession: state.restartsThisSession,
      secondsSinceIntervention: state.lastInterventionMs == null ? Infinity : (now - state.lastInterventionMs) / 1000,
      backtestActive: deps.isBacktestActive?.() ?? false,
      staleCode: deps.isStaleCode?.() ?? false,
    });

    if (plan.action === "arm") {
      deps.setMode("live");
      deps.resetDetectorRestarts?.();
      deps.startDetector();
      state.lastInterventionMs = now;
      deps.notify?.({
        level: "info",
        title: "Live loop armed",
        body: `${session} window open — detector started, bar-close analysis active.`,
      });
      deps.send?.("supervisor:state", { action: "arm", session });
      deps.recordMetric?.({ kind: "supervisor", event: "arm", session });
    } else if (plan.action === "block_arm_stale") {
      // Loud, once per session: the window is open but we won't arm on stale code.
      if (state.staleNotifiedKey !== state.sessionKey) {
        state.staleNotifiedKey = state.sessionKey;
        deps.notify?.({
          level: "error",
          title: "Live arming BLOCKED — stale code",
          body: `${session}: the running app is behind its on-disk code. Restart the app so live runs the same code the backtest does (parity). NOT arming.`,
        });
        deps.send?.("supervisor:state", { action: "block_arm_stale", session });
        deps.recordMetric?.({ kind: "supervisor", event: "block_arm_stale", session });
      }
    } else if (plan.action === "restart_detector") {
      deps.stopDetector();
      deps.resetDetectorRestarts?.();
      deps.startDetector();
      state.restartsThisSession += 1;
      state.lastInterventionMs = now;
      deps.notify?.({
        level: "warn",
        title: "Detector restarted by watchdog",
        body: `${session}: heartbeat stale — restart ${state.restartsThisSession}/${RESTART_CAP_PER_SESSION}.`,
      });
      deps.send?.("supervisor:state", { action: "restart", session, restarts: state.restartsThisSession });
      deps.recordMetric?.({ kind: "supervisor", event: "restart_detector", session, restarts: state.restartsThisSession });
    } else if (plan.action === "give_up") {
      state.restartsThisSession += 1; // past the cap — plan returns none from now on
      deps.notify?.({
        level: "error",
        title: "Detector supervision giving up",
        body: `${session}: heartbeat still stale after ${RESTART_CAP_PER_SESSION} restarts — giving up until the next session. Check TradingView/CDP.`,
      });
      deps.send?.("supervisor:state", { action: "give_up", session });
      deps.recordMetric?.({ kind: "supervisor", event: "give_up", session });
    } else if (plan.action === "disarm") {
      deps.setMode("prep");
      deps.send?.("supervisor:state", { action: "disarm", session: "idle" });
      deps.recordMetric?.({ kind: "supervisor", event: "disarm" });
    }
    return plan;
  }

  return {
    tick,
    noteManualStop() {
      const { session, date } = deps.getSession();
      state.manualStopKey = keyFor(date, session);
    },
    noteManualStart() {
      state.manualStopKey = null;
    },
    getState() {
      return { ...state };
    },
  };
}

// ───────────────────────────── production wiring ─────────────────────────────

async function heartbeatAgeSeconds() {
  try {
    const stat = await fs.stat(HEARTBEAT);
    return (Date.now() - stat.mtimeMs) / 1000;
  } catch {
    return null;
  }
}

/** Run the CLI's fail-closed readiness checklist (constraint #2: CLI surface). */
function runLiveCheckCli(session) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(REPO_ROOT, "cli", "index.js"), "live-check", "--session", session],
      { cwd: REPO_ROOT, env: process.env },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      reject(new Error(`live-check timed out after ${READINESS_TIMEOUT_MS / 1000}s`));
    }, READINESS_TIMEOUT_MS);
    child.stdout?.on("data", (c) => { stdout += c.toString(); });
    child.stderr?.on("data", (c) => { stderr += c.toString(); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("exit", () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error(`live-check output unparseable: ${(stderr || stdout).slice(0, 300)}`)); }
    });
  });
}

let _supervisor = null;
let _timer = null;

export function startSessionSupervisor({ send, isStaleCode }) {
  return Promise.all([
    import("./sessions.js"),
    import("./mode.js"),
    import("./bar-close.js"),
    import("./metrics.js"),
    import("./notify.js"),
    import("./backtest-lock.js"),
  ]).then(([sessions, mode, barClose, metrics, notifyMod, backtestLock]) => {
    _supervisor = createSessionSupervisor({
      getSession: () => {
        const s = sessions.currentSession();
        return { session: s.session, date: s.date, weekday: s.weekday, etMinutes: s.et_hour * 60 + s.et_minute };
      },
      getMode: mode.getMode,
      setMode: mode.setMode,
      heartbeatAgeS: heartbeatAgeSeconds,
      startDetector: () => barClose.startDetector({ send }),
      stopDetector: barClose.stopDetector,
      resetDetectorRestarts: barClose.resetDetectorRestarts,
      hasOpenTrades: barClose.hasOpenTrades,
      isStaleCode,
      runReadinessCheck: runLiveCheckCli,
      isBacktestActive: backtestLock.isBacktestActive,
      notify: ({ level, title, body }) => {
        notifyMod.notifySystem({ title, body });
        send?.("app:error", { source: "supervisor", level, message: `${title}: ${body}` });
      },
      send,
      recordMetric: metrics.record,
    });
    if (_timer) clearInterval(_timer);
    _timer = setInterval(() => {
      _supervisor.tick().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[supervisor] tick threw", err?.message || err);
      });
    }, TICK_INTERVAL_MS);
    _supervisor.tick().catch(() => {});
    return _supervisor;
  });
}

export function stopSessionSupervisor() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _supervisor = null;
}

export function noteManualStop() { _supervisor?.noteManualStop(); }
export function noteManualStart() { _supervisor?.noteManualStart(); }

// Run one supervisor tick now (out of band). Used to re-arm live promptly when
// a backtest releases the chart instead of waiting for the next interval tick.
export function nudgeSupervisor() { return _supervisor?.tick?.().catch(() => {}); }
