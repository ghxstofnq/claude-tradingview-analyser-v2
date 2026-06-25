import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planSupervisorAction,
  upcomingSession,
  createSessionSupervisor,
  RESTART_CAP_PER_SESSION,
} from "../app/main/session-supervisor.js";

// ------------------------------------------------------ planSupervisorAction

test("plan: arms the live loop when a session window opens and mode is not live", () => {
  const plan = planSupervisorAction({ session: "ny-am", mode: "prep", heartbeatAgeS: null });
  assert.equal(plan.action, "arm");
});

test("plan: stands down while a backtest holds the chart, even in a session window", () => {
  const plan = planSupervisorAction({
    session: "ny-am", mode: "prep", heartbeatAgeS: null, backtestActive: true,
  });
  assert.equal(plan.action, "none");
  assert.equal(plan.reason, "backtest_active");
});

test("plan: a manual stop during the session suppresses re-arming for that session", () => {
  const plan = planSupervisorAction({
    session: "ny-am", mode: "prep", heartbeatAgeS: null, manualStopSession: "ny-am",
  });
  assert.equal(plan.action, "none");
  assert.equal(plan.reason, "manual_stop");
});

test("plan: a manual stop from a previous session does not block the next one", () => {
  const plan = planSupervisorAction({
    session: "ny-pm", mode: "prep", heartbeatAgeS: null, manualStopSession: "ny-am",
  });
  assert.equal(plan.action, "arm");
});

test("plan: fresh heartbeat in live mode needs no action", () => {
  const plan = planSupervisorAction({ session: "ny-am", mode: "live", heartbeatAgeS: 5 });
  assert.equal(plan.action, "none");
});

test("plan: stale heartbeat in live mode restarts the detector (hung-but-alive case)", () => {
  const plan = planSupervisorAction({
    session: "ny-am", mode: "live", heartbeatAgeS: 600, restartsThisSession: 0,
  });
  assert.equal(plan.action, "restart_detector");
});

test("plan: missing heartbeat file in live mode also restarts", () => {
  const plan = planSupervisorAction({
    session: "ny-am", mode: "live", heartbeatAgeS: null, restartsThisSession: 1,
  });
  assert.equal(plan.action, "restart_detector");
});

test("plan: no restart inside the post-intervention grace window (just-started detector)", () => {
  const plan = planSupervisorAction({
    session: "ny-am", mode: "live", heartbeatAgeS: null, secondsSinceIntervention: 10,
  });
  assert.equal(plan.action, "none");
  assert.equal(plan.reason, "intervention_grace");
});

test("plan: hitting the restart cap gives up loudly exactly once", () => {
  const atCap = planSupervisorAction({
    session: "ny-am", mode: "live", heartbeatAgeS: 600,
    restartsThisSession: RESTART_CAP_PER_SESSION,
  });
  assert.equal(atCap.action, "give_up");
  const pastCap = planSupervisorAction({
    session: "ny-am", mode: "live", heartbeatAgeS: 600,
    restartsThisSession: RESTART_CAP_PER_SESSION + 1,
  });
  assert.equal(pastCap.action, "none");
  assert.equal(pastCap.reason, "gave_up");
});

test("plan: disarms back to prep when the session ends and no trade is open", () => {
  const plan = planSupervisorAction({ session: "idle", mode: "live", hasOpenTrades: false });
  assert.equal(plan.action, "disarm");
});

test("plan: never disarms while a trade is open", () => {
  const plan = planSupervisorAction({ session: "idle", mode: "live", hasOpenTrades: true });
  assert.equal(plan.action, "none");
});

test("plan: idle outside live mode needs nothing", () => {
  const plan = planSupervisorAction({ session: "idle", mode: "prep" });
  assert.equal(plan.action, "none");
});

// ----------------------------------------------------------- upcomingSession

test("upcomingSession: inside the 10-minute lead before NY AM open", () => {
  // 09:25 ET on a weekday → ny-am opens 09:30
  assert.equal(upcomingSession({ weekday: "Wed", etMinutes: 9 * 60 + 25, leadMinutes: 10 }), "ny-am");
});

test("upcomingSession: lead windows for london and ny-pm", () => {
  assert.equal(upcomingSession({ weekday: "Tue", etMinutes: 2 * 60 + 55, leadMinutes: 10 }), "london");
  assert.equal(upcomingSession({ weekday: "Tue", etMinutes: 12 * 60 + 55, leadMinutes: 10 }), "ny-pm");
});

test("upcomingSession: nothing upcoming mid-session, mid-day, or on weekends", () => {
  assert.equal(upcomingSession({ weekday: "Wed", etMinutes: 10 * 60, leadMinutes: 10 }), null);
  assert.equal(upcomingSession({ weekday: "Wed", etMinutes: 7 * 60, leadMinutes: 10 }), null);
  assert.equal(upcomingSession({ weekday: "Sat", etMinutes: 9 * 60 + 25, leadMinutes: 10 }), null);
});

// ----------------------------------------------- createSessionSupervisor tick

function makeDeps(overrides = {}) {
  const calls = { setMode: [], startDetector: 0, stopDetector: 0, notify: [], events: [], readiness: [] };
  const deps = {
    getSession: () => ({ session: "ny-am", date: "2026-06-11", weekday: "Thu", etMinutes: 10 * 60 }),
    getMode: () => "prep",
    setMode: (m) => calls.setMode.push(m),
    heartbeatAgeS: async () => 5,
    startDetector: () => { calls.startDetector += 1; },
    stopDetector: () => { calls.stopDetector += 1; },
    resetDetectorRestarts: () => {},
    hasOpenTrades: async () => false,
    runReadinessCheck: async (session) => { calls.readiness.push(session); return { ok: true, blockers: [] }; },
    notify: (n) => calls.notify.push(n),
    send: (channel, payload) => calls.events.push({ channel, payload }),
    recordMetric: () => {},
    ...overrides,
  };
  return { deps, calls };
}

test("tick: arms on session open — sets mode live, starts detector, notifies", async () => {
  const { deps, calls } = makeDeps();
  const sup = createSessionSupervisor(deps);
  await sup.tick();
  assert.deepEqual(calls.setMode, ["live"]);
  assert.equal(calls.startDetector, 1);
  assert.equal(calls.notify.length, 1);
  assert.match(calls.notify[0].body, /ny-am/);
});

test("tick: stale heartbeat restarts the detector and counts toward the cap", async () => {
  const { deps, calls } = makeDeps({
    getMode: () => "live",
    heartbeatAgeS: async () => 999,
  });
  const sup = createSessionSupervisor(deps);
  await sup.tick();
  assert.equal(calls.stopDetector, 1);
  assert.equal(calls.startDetector, 1);
  assert.equal(sup.getState().restartsThisSession, 1);
});

test("tick: repeated staleness past the cap notifies give-up once, then stays quiet", async () => {
  let now = 0;
  const { deps, calls } = makeDeps({
    getMode: () => "live",
    heartbeatAgeS: async () => 999,
    nowMs: () => { now += 10 * 60 * 1000; return now; }, // each tick 10min later — outside grace
  });
  const sup = createSessionSupervisor(deps);
  for (let i = 0; i < RESTART_CAP_PER_SESSION + 3; i += 1) await sup.tick();
  const giveUps = calls.notify.filter((n) => /giving up/i.test(n.body));
  assert.equal(giveUps.length, 1);
  assert.equal(calls.stopDetector, RESTART_CAP_PER_SESSION);
});

test("tick: manual stop suppresses re-arm until the next session", async () => {
  const { deps, calls } = makeDeps();
  const sup = createSessionSupervisor(deps);
  sup.noteManualStop();
  await sup.tick();
  assert.deepEqual(calls.setMode, []);
  assert.equal(calls.startDetector, 0);
});

test("tick: disarms after the session ends when no trade is open", async () => {
  const { deps, calls } = makeDeps({
    getSession: () => ({ session: "idle", date: "2026-06-11", weekday: "Thu", etMinutes: 12 * 60 + 30 }),
    getMode: () => "live",
  });
  const sup = createSessionSupervisor(deps);
  await sup.tick();
  assert.deepEqual(calls.setMode, ["prep"]);
});

test("tick: runs the readiness check once in the pre-open lead window and notifies blockers", async () => {
  const { deps, calls } = makeDeps({
    getSession: () => ({ session: "idle", date: "2026-06-11", weekday: "Thu", etMinutes: 9 * 60 + 25 }),
    runReadinessCheck: async (session) => {
      calls.readiness.push(session);
      return { ok: false, blockers: ["unsupported_ict_schema", "stale_source"] };
    },
  });
  const sup = createSessionSupervisor(deps);
  await sup.tick();
  await sup.tick(); // second tick in the same lead window must not re-run
  assert.deepEqual(calls.readiness, ["ny-am"]);
  const blocked = calls.notify.filter((n) => /unsupported_ict_schema/.test(n.body));
  assert.equal(blocked.length, 1);
});

test("tick: a passing readiness check stays quiet (status event only, no notification)", async () => {
  const { deps, calls } = makeDeps({
    getSession: () => ({ session: "idle", date: "2026-06-11", weekday: "Thu", etMinutes: 9 * 60 + 25 }),
  });
  const sup = createSessionSupervisor(deps);
  await sup.tick();
  assert.deepEqual(calls.readiness, ["ny-am"]);
  assert.equal(calls.notify.length, 0);
  assert.ok(calls.events.some((e) => e.channel === "supervisor:readiness"));
});

test("tick: session change resets restart counter and manual-stop suppression", async () => {
  let session = "ny-am";
  const { deps } = makeDeps({
    getSession: () => ({ session, date: "2026-06-11", weekday: "Thu", etMinutes: 10 * 60 }),
    getMode: () => "live",
    heartbeatAgeS: async () => 999,
    nowMs: (() => { let t = 0; return () => { t += 10 * 60 * 1000; return t; }; })(),
  });
  const sup = createSessionSupervisor(deps);
  await sup.tick();
  assert.equal(sup.getState().restartsThisSession, 1);
  session = "ny-pm";
  await sup.tick();
  assert.equal(sup.getState().restartsThisSession, 1); // 1 from the fresh ny-pm tick, not 2
  assert.equal(sup.getState().sessionKey, "2026-06-11:ny-pm");
});
