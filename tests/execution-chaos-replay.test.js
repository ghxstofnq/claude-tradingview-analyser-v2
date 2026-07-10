// tests/execution-chaos-replay.test.js
// Chaos scenarios across the durable order-intent (B1) + boot reconciler (B2) +
// continuous protection watchdog (B3) + broker-clock EOD (B4) layers. Every case
// asserts the ONE invariant that matters on the money path: we NEVER phantom-
// flatten, and we NEVER infer "flat" from an unreadable / ambiguous read.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifySubmitResult, reconcileIntent, planIntentAction, createIntentStore,
  CORRUPT_INTENT, INTENT_STATES,
} from "../app/main/execution/order-intent.js";
import {
  evaluateProtection, planWatchdogAction, createProtectionWatchdog, PROTECTION_STATES,
} from "../app/main/execution/protection-watchdog.js";
import { eodFlattenNow, lastEodDateFrom, eodDue } from "../app/main/execution/reconciler.js";

const P = PROTECTION_STATES;
const okOpen = (position) => ({ ok: true, position, account_id: "A1" });
const okFlat = { ok: true, position: null, account_id: "A1" };
const unreadable = { ok: false, position: null };
const LONG = { symbol: "MNQ1!", side: "buy", qty: 2, account_id: "A1" };
const goodStops = [{ kind: "stop", side: "sell", qty: 2, price: 20970 }];

// (28) broker timeout after acceptance → ambiguous → RECOVERY_REQUIRED held, no flat
describe("(28) timeout after acceptance", () => {
  it("timeout classifies ambiguous; reconcileIntent holds RECOVERY_REQUIRED, no flat", () => {
    assert.equal(classifySubmitResult({ timeout: true }), "ambiguous");
    // The order may have landed — an unreadable broker read must NOT invalidate.
    const resolved = reconcileIntent({ intent: { symbol: "MNQ1!", side: "buy" }, brokerRead: unreadable });
    assert.equal(resolved, INTENT_STATES.RECOVERY_REQUIRED);
    assert.equal(planIntentAction({ existing: { state: resolved } }).action, "blocked_recovery");
  });
});

// (29) flatten acked but reconcile still shows open → NOT flat, retry, error, paused
describe("(29) flatten acked but position still open", () => {
  it("eodFlattenNow does not report flat when the re-read still shows a position", async () => {
    const errors = [];
    const records = [];
    // Broker stays OPEN even after the flatten acks (fill not yet reflected).
    const deps = {
      readBroker: async () => okOpen(LONG),
      readStop: async () => true,
      getJournalOpen: async () => null,
      flatten: async () => ({ ok: true }),        // broker "acked" the close…
      cancelWorkingOrders: async () => ({ ok: true }),
      recordReconciliation: async (r) => { records.push(r); },
      setReconciliationHealthy: () => {},
      emitError: (o) => errors.push(o),
      accountId: () => "A1",
    };
    const res = await eodFlattenNow({ deps, now: 0, tradingDay: "2026-07-10" });
    assert.equal(res.confirmedFlat, false, "never reports flat off an unconfirmed re-read");
    assert.equal(res.state, "UNKNOWN");
    assert.ok(errors.some((e) => e.level === "error"), "loud app:error");
    assert.equal(records.at(-1).confirmed_flat, false);
  });
});

// (30) clean socket close (markDisconnected) → read ok:false → UNKNOWN, never flat
describe("(30) disconnected feed", () => {
  it("an ok:false read evaluates UNKNOWN and eodFlattenNow never assumes flat", async () => {
    const r = evaluateProtection({ brokerRead: unreadable, orders: [] });
    assert.equal(r.state, P.UNKNOWN);
    const records = [];
    const res = await eodFlattenNow({
      deps: {
        readBroker: async () => unreadable,
        recordReconciliation: async (x) => { records.push(x); },
        emitError: () => {},
      }, now: 0, tradingDay: "2026-07-10",
    });
    assert.equal(res.confirmedFlat, false);
    assert.equal(records.at(-1).confirmed_flat, false);
  });
});

// (31) auth expiry mid-trade → fail-closed reads, position preserved, paused, never flat
describe("(31) auth expiry mid-trade", () => {
  it("http_401 → AUTH_EXPIRED, entries paused, never a flatten/intervention", async () => {
    const calls = { flat: 0, interventions: 0, gate: [], errors: [] };
    const wd = createProtectionWatchdog({
      readBroker: async () => unreadable,
      readOrders: async () => [],
      getJournalOpen: async () => null,
      getArmedRoute: async () => null,
      getPrice: async () => null,
      getAuth: async () => ({ token: "t", lastReadStatus: "http_401" }),
      now: () => 1000,
      setProtectionOk: (v) => calls.gate.push(v),
      emitError: (o) => calls.errors.push(o),
      recordIntervention: () => { calls.interventions += 1; },
      recordIntentTransition: () => {},
      flatten: () => { calls.flat += 1; },
    });
    await wd.tick();
    await wd.tick();
    assert.equal(wd.getState().state, P.AUTH_EXPIRED);
    assert.deepEqual(calls.gate.slice(-1), [false], "entries paused");
    assert.equal(calls.interventions, 0, "auth loss never triggers recovery intervention");
    assert.equal(calls.flat, 0, "position preserved — never flattened on auth loss");
  });
});

// (32) two consecutive flat reads vs one transient failure
describe("(32) consecutive vs transient", () => {
  it("two consecutive breaches confirm; a transient between them does not", () => {
    // confirm path
    let p = planWatchdogAction({ prev: { state: null, consecutive: 0 }, current: { state: "CRITICAL_NO_STOP" } });
    p = planWatchdogAction({ prev: { state: "CRITICAL_NO_STOP", consecutive: p.consecutive }, current: { state: "CRITICAL_NO_STOP" } });
    assert.equal(p.action, "recovery_required");
    // transient path — ambiguous read resets, never confirms
    let q = planWatchdogAction({ prev: { state: null, consecutive: 0 }, current: { state: "CRITICAL_NO_STOP" } });
    q = planWatchdogAction({ prev: { state: "CRITICAL_NO_STOP", consecutive: q.consecutive }, current: { state: P.UNKNOWN } });
    q = planWatchdogAction({ prev: { state: P.UNKNOWN, consecutive: q.consecutive }, current: { state: "CRITICAL_NO_STOP" } });
    assert.notEqual(q.action, "recovery_required");
  });
});

// (33) missing stop surfaced within one interval
describe("(33) missing stop", () => {
  it("a naked position reads CRITICAL_NO_STOP on the FIRST evaluate (one interval)", () => {
    const r = evaluateProtection({ brokerRead: okOpen(LONG), orders: [] });
    assert.equal(r.state, "CRITICAL_NO_STOP");
    // First tick pauses immediately (surfaced within one interval); second confirms.
    assert.equal(planWatchdogAction({ prev: { state: null, consecutive: 0 }, current: r }).action, "pause_entries");
  });
});

// (34) duplicate packet → skip_duplicate (B1)
describe("(34) duplicate packet", () => {
  it("a live intent → skip_duplicate", () => {
    for (const s of [INTENT_STATES.BROKER_ACKNOWLEDGED, INTENT_STATES.POSITION_CONFIRMED, INTENT_STATES.STOP_CONFIRMED]) {
      assert.equal(planIntentAction({ existing: { state: s } }).action, "skip_duplicate");
    }
  });
});

// (35) restart at each lifecycle transition → deterministic planIntentAction
describe("(35) restart at each lifecycle transition", () => {
  it("every state maps to a deterministic decision", () => {
    const map = {
      [INTENT_STATES.INTENT_CREATED]: "reconcile",
      [INTENT_STATES.SUBMITTING]: "reconcile",
      [INTENT_STATES.BROKER_ACKNOWLEDGED]: "skip_duplicate",
      [INTENT_STATES.POSITION_CONFIRMED]: "skip_duplicate",
      [INTENT_STATES.STOP_CONFIRMED]: "skip_duplicate",
      [INTENT_STATES.REJECTED]: "skip_rejected",
      [INTENT_STATES.RECOVERY_REQUIRED]: "blocked_recovery",
      [INTENT_STATES.UNKNOWN]: "blocked_recovery",
    };
    for (const [state, action] of Object.entries(map)) {
      assert.equal(planIntentAction({ existing: { state } }).action, action, `state ${state}`);
    }
    // No prior intent at all → create.
    assert.equal(planIntentAction({ existing: null }).action, "create");
  });
});

// (36) torn JSONL tail → corrupt marker → never HEALTHY, watchdog fail-closed UNKNOWN
describe("(36) torn JSONL tail", () => {
  it("a corrupt intent read blocks; an ok:false broker read evaluates UNKNOWN", async () => {
    const store = createIntentStore({
      readRecords: async () => ({ records: [{ decision_id: "OI-1", state: "SUBMITTING" }], dropped: 1 }),
      appendRecord: async () => {},
      onCorrupt: () => {},
    });
    const read = await store.readIntent("OI-1");
    assert.equal(read.__corrupt, true);
    assert.equal(read.state, CORRUPT_INTENT.state);
    assert.equal(planIntentAction({ existing: read }).action, "blocked_recovery");
    // The watchdog on an unreadable broker is UNKNOWN (never flat/HEALTHY).
    assert.equal(evaluateProtection({ brokerRead: unreadable, orders: [] }).state, P.UNKNOWN);
  });
});

// (37) EOD retry after unknown flatten result across restart
describe("(37) EOD retry across restart", () => {
  it("an unconfirmed prior eod_flatten leaves lastEodDate unset → re-attempts", () => {
    const records = [
      { action: "eod_flatten", confirmed_flat: false, trading_day: "2026-07-10" }, // the unknown result
    ];
    const seed = lastEodDateFrom(records);
    assert.equal(seed, null, "no CONFIRMED eod → latch stays open across restart");
    assert.equal(eodDue({ nowEtMinutes: 16 * 60 + 5, lastEodDate: seed, todayEt: "2026-07-10" }), true, "re-attempts");
    // Once a CONFIRMED row exists, the latch is set and it stops re-attempting.
    records.push({ action: "eod_flatten", confirmed_flat: true, trading_day: "2026-07-10" });
    assert.equal(lastEodDateFrom(records), "2026-07-10");
    assert.equal(eodDue({ nowEtMinutes: 16 * 60 + 5, lastEodDate: "2026-07-10", todayEt: "2026-07-10" }), false);
  });
});
