import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PROTECTION_STATES,
  checkFreshness, checkRouteMatch, checkStopCoverage, checkStopSide,
  checkExitsCannotReverse, checkAuth, checkQtyAgree,
  evaluateProtection, planWatchdogAction, interventionRecord,
  createProtectionWatchdog, protectionReadiness,
} from "../app/main/execution/protection-watchdog.js";

const P = PROTECTION_STATES;
const okRead = (position, extra = {}) => ({ ok: true, position, account_id: "A1", ...extra });
const flatRead = { ok: true, position: null, account_id: "A1" };
const unreadable = { ok: false, position: null };
const LONG = { symbol: "MNQ1!", side: "buy", qty: 2, account_id: "A1" };
const SHORT = { symbol: "MNQ1!", side: "sell", qty: 2, account_id: "A1" };
// A full protective bracket for a 2-lot long: sell-stop below price, covering qty.
const goodStops = (price = 21000) => [
  { id: "s1", kind: "stop", side: "sell", qty: 2, price: price - 30 },
];

// ── Pure checks ─────────────────────────────────────────────────────────────
describe("pure checks", () => {
  it("checkFreshness: unreadable broker is never fresh", () => {
    assert.equal(checkFreshness({ brokerOk: false }).ok, false);
    assert.equal(checkFreshness({ brokerOk: false }).blocker, "stale_broker_read");
    assert.equal(checkFreshness({ brokerOk: true, evidenceAgeMs: null }).ok, true);
    assert.equal(checkFreshness({ brokerOk: true, evidenceAgeMs: 5000, maxAgeMs: 120000 }).ok, true);
    assert.equal(checkFreshness({ brokerOk: true, evidenceAgeMs: 200000, maxAgeMs: 120000 }).ok, false);
  });

  it("checkRouteMatch: same account+root ok; different root is a mismatch", () => {
    assert.equal(checkRouteMatch({ position: LONG, armedRoute: { account_id: "A1", root: "MNQ" } }).ok, true);
    const m = checkRouteMatch({ position: { symbol: "MES1!", side: "buy", qty: 1, account_id: "A2" }, armedRoute: { account_id: "A1", root: "MNQ" } });
    assert.equal(m.ok, false);
    assert.equal(m.blocker, "route_mismatch");
    // No armed route to compare → cannot be a mismatch.
    assert.equal(checkRouteMatch({ position: LONG, armedRoute: null }).ok, true);
    assert.equal(checkRouteMatch({ position: null, armedRoute: { account_id: "A1", root: "MNQ" } }).ok, true);
  });

  it("checkStopCoverage: full cover ok; undercover flagged; none → no_protective_stop", () => {
    assert.equal(checkStopCoverage({ position: LONG, orders: goodStops() }).ok, true);
    const under = checkStopCoverage({ position: LONG, orders: [{ kind: "stop", side: "sell", qty: 1, price: 20970 }] });
    assert.equal(under.blocker, "stop_undercovers");
    const none = checkStopCoverage({ position: LONG, orders: [{ kind: "limit", side: "sell", qty: 2, price: 21100 }] });
    assert.equal(none.blocker, "no_protective_stop");
    // PAPER: a stop with unknown qty still counts as protection (the feed omits
    // order qty), and an unknown-side stop counts as closing — fail-open is scoped
    // to paper.
    assert.equal(checkStopCoverage({ position: LONG, orders: [{ kind: "stop", side: "sell", qty: null, price: 20970 }], broker: "paper" }).ok, true);
    assert.equal(checkStopCoverage({ position: LONG, orders: [{ kind: "stop", side: null, qty: 2, price: 20970 }], broker: "paper" }).ok, true);
  });

  it("checkStopCoverage TRADOVATE-STRICT: unreadable fields never count as protection", () => {
    // An unreadable qty must NOT silently read as full cover (tradovate-adapter
    // returns qty:null on a shape it can't parse) → breach.
    assert.equal(checkStopCoverage({ position: LONG, orders: [{ kind: "stop", side: "sell", qty: null, price: 20970 }], broker: "tradovate" }).blocker, "stop_undercovers");
    // A null-side stop does not count as a closing stop on tradovate → no cover.
    assert.equal(checkStopCoverage({ position: LONG, orders: [{ kind: "stop", side: null, qty: 2, price: 20970 }], broker: "tradovate" }).blocker, "no_protective_stop");
    // A fully-readable covering stop still passes.
    assert.equal(checkStopCoverage({ position: LONG, orders: goodStops(), broker: "tradovate" }).ok, true);
  });

  it("checkStopSide: long sell-stop must sit below price; above → wrong side", () => {
    assert.equal(checkStopSide({ position: LONG, orders: goodStops(21000), price: 21000 }).ok, true);
    const wrong = checkStopSide({ position: LONG, orders: [{ kind: "stop", side: "sell", qty: 2, price: 21050 }], price: 21000 });
    assert.equal(wrong.blocker, "stop_wrong_side");
    // Short: buy-stop must sit above price.
    assert.equal(checkStopSide({ position: SHORT, orders: [{ kind: "stop", side: "buy", qty: 2, price: 21050 }], price: 21000 }).ok, true);
    assert.equal(checkStopSide({ position: SHORT, orders: [{ kind: "stop", side: "buy", qty: 2, price: 20950 }], price: 21000 }).blocker, "stop_wrong_side");
  });

  it("checkExitsCannotReverse: a single oversized exit could flip the position", () => {
    assert.equal(checkExitsCannotReverse({ position: LONG, orders: goodStops() }).ok, true);
    const rev = checkExitsCannotReverse({ position: LONG, orders: [{ kind: "stop", side: "sell", qty: 3, price: 20970 }] });
    assert.equal(rev.blocker, "exit_can_reverse");
    // OCO siblings (stop + tp) both at full size must NOT read as reversal.
    assert.equal(checkExitsCannotReverse({ position: LONG, orders: [
      { kind: "stop", side: "sell", qty: 2, price: 20970 },
      { kind: "limit", side: "sell", qty: 2, price: 21100 },
    ] }).ok, true);
  });

  it("checkAuth: 401 / null token / stale last-seen all expire", () => {
    assert.equal(checkAuth({ token: "t", lastReadStatus: "http_401" }).blocker, "auth_expired");
    assert.equal(checkAuth({ token: null, lastReadStatus: "ok" }).blocker, "auth_expired");
    assert.equal(checkAuth({ token: "t", lastReadStatus: "ok", lastSeenMs: 0, now: 500000, maxStaleMs: 120000 }).blocker, "auth_expired");
    assert.equal(checkAuth({ token: "t", lastReadStatus: "ok", lastSeenMs: 490000, now: 500000, maxStaleMs: 120000 }).ok, true);
  });

  it("checkQtyAgree: journal vs broker size mismatch flagged; null journal skips", () => {
    assert.equal(checkQtyAgree({ journalQty: 2, position: LONG }).ok, true);
    assert.equal(checkQtyAgree({ journalQty: 3, position: LONG }).blocker, "qty_mismatch");
    assert.equal(checkQtyAgree({ journalQty: null, position: LONG }).ok, true);
  });
});

// ── evaluateProtection ──────────────────────────────────────────────────────
describe("evaluateProtection", () => {
  const base = { brokerRead: okRead(LONG), orders: goodStops(21000), journalQty: 2, armedRoute: { account_id: "A1", root: "MNQ" }, price: 21000 };

  it("(1) all pass → PROTECTED", () => {
    const r = evaluateProtection(base);
    assert.equal(r.state, P.PROTECTED);
    assert.equal(r.ok, true);
    assert.deepEqual(r.blockers, []);
  });

  it("(2) no position → NO_POSITION, entries allowed", () => {
    const r = evaluateProtection({ ...base, brokerRead: flatRead });
    assert.equal(r.state, P.NO_POSITION);
    assert.equal(r.ok, true);
  });

  it("(3) stale read → UNKNOWN, ok:false (fail-closed, never flat)", () => {
    const r = evaluateProtection({ ...base, brokerRead: unreadable });
    assert.equal(r.state, P.UNKNOWN);
    assert.equal(r.ok, false);
    assert.deepEqual(r.blockers, ["stale_broker_read"]);
  });

  it("(4) route mismatch → RECOVERY_REQUIRED breach", () => {
    const r = evaluateProtection({ ...base, brokerRead: okRead({ symbol: "MES1!", side: "buy", qty: 2, account_id: "A9" }), orders: [{ kind: "stop", side: "sell", qty: 2, price: 20970 }], armedRoute: { account_id: "A1", root: "MNQ" } });
    assert.equal(r.state, P.RECOVERY_REQUIRED);
    assert.ok(r.blockers.includes("route_mismatch"));
  });

  it("(5) stop qty undercovers → RECOVERY_REQUIRED with stop_undercovers", () => {
    const r = evaluateProtection({ ...base, orders: [{ kind: "stop", side: "sell", qty: 1, price: 20970 }] });
    assert.equal(r.state, P.RECOVERY_REQUIRED);
    assert.ok(r.blockers.includes("stop_undercovers"));
  });

  it("(6) missing stop → CRITICAL_NO_STOP (outranks side/coverage/qty)", () => {
    const r = evaluateProtection({ ...base, orders: [], journalQty: 3 });
    assert.equal(r.state, "CRITICAL_NO_STOP");
    assert.deepEqual(r.blockers, ["no_protective_stop"]);
  });

  it("(7) stop wrong side → RECOVERY_REQUIRED", () => {
    const r = evaluateProtection({ ...base, orders: [{ kind: "stop", side: "sell", qty: 2, price: 21050 }] });
    assert.equal(r.state, P.RECOVERY_REQUIRED);
    assert.ok(r.blockers.includes("stop_wrong_side"));
  });

  it("(8) exit can reverse → RECOVERY_REQUIRED", () => {
    const r = evaluateProtection({ ...base, orders: [{ kind: "stop", side: "sell", qty: 3, price: 20970 }] });
    assert.equal(r.state, P.RECOVERY_REQUIRED);
    assert.ok(r.blockers.includes("exit_can_reverse"));
  });

  it("(9) http_401 → AUTH_EXPIRED, ok:false (auth outranks everything)", () => {
    const r = evaluateProtection({ ...base, auth: { token: "t", lastReadStatus: "http_401" } });
    assert.equal(r.state, P.AUTH_EXPIRED);
    assert.equal(r.ok, false);
    assert.deepEqual(r.blockers, ["auth_expired"]);
  });

  it("(10) token null → AUTH_EXPIRED", () => {
    const r = evaluateProtection({ ...base, auth: { token: null, lastReadStatus: "ok" } });
    assert.equal(r.state, P.AUTH_EXPIRED);
  });

  it("(11) journal vs broker qty → CRITICAL_QTY_MISMATCH", () => {
    const r = evaluateProtection({ ...base, journalQty: 1 });
    assert.equal(r.state, "CRITICAL_QTY_MISMATCH");
    assert.deepEqual(r.blockers, ["qty_mismatch"]);
  });

  it("Tradovate-strict: a malformed order (null qty) breaches, never counts as protection", () => {
    const r = evaluateProtection({
      brokerRead: { ok: true, position: LONG, account_id: "A1", broker: "tradovate" },
      orders: [{ kind: "stop", side: "sell", qty: null, price: 20970 }],
      journalQty: 2, armedRoute: { account_id: "A1", root: "MNQ" }, price: 21000,
    });
    assert.equal(r.state, P.RECOVERY_REQUIRED);
    assert.ok(r.blockers.includes("stop_undercovers"));
  });

  it("paper with the SAME malformed-qty order reads PROTECTED (fail-open scoped to paper)", () => {
    const r = evaluateProtection({
      brokerRead: { ok: true, position: LONG, account_id: "A1", broker: "paper" },
      orders: [{ kind: "stop", side: "sell", qty: null, price: 20970 }],
      journalQty: 2, armedRoute: { account_id: "A1", root: "MNQ" }, price: 21000,
    });
    assert.equal(r.state, P.PROTECTED);
  });
});

// ── planWatchdogAction (confirm-then-act debounce) ──────────────────────────
describe("planWatchdogAction", () => {
  it("(12) single ambiguous read → pause only, no intervention, no confirmation", () => {
    const p = planWatchdogAction({ prev: { state: P.PROTECTED, consecutive: 0 }, current: { state: P.UNKNOWN } });
    assert.equal(p.action, "pause_entries");
    assert.equal(p.confirmed, false);
    assert.equal(p.consecutive, 0);
  });

  it("(13) two consecutive breaches → recovery_required + confirmed", () => {
    const first = planWatchdogAction({ prev: { state: P.PROTECTED, consecutive: 0 }, current: { state: "CRITICAL_NO_STOP" } });
    assert.equal(first.action, "pause_entries");
    assert.equal(first.confirmed, false);
    assert.equal(first.consecutive, 1);
    const second = planWatchdogAction({ prev: { state: "CRITICAL_NO_STOP", consecutive: 1 }, current: { state: "CRITICAL_NO_STOP" } });
    assert.equal(second.action, "recovery_required");
    assert.equal(second.confirmed, true);
    assert.equal(second.consecutive, 2);
  });

  it("(14) transient failure between healthy reads never confirms", () => {
    // healthy → breach(1) → ambiguous(reset) → breach(1 again) — never reaches 2.
    let p = planWatchdogAction({ prev: { state: P.PROTECTED, consecutive: 0 }, current: { state: "CRITICAL_NO_STOP" } });
    assert.equal(p.consecutive, 1);
    p = planWatchdogAction({ prev: { state: "CRITICAL_NO_STOP", consecutive: 1 }, current: { state: P.UNKNOWN } });
    assert.equal(p.action, "pause_entries");
    assert.equal(p.consecutive, 0);
    p = planWatchdogAction({ prev: { state: P.UNKNOWN, consecutive: 0 }, current: { state: "CRITICAL_NO_STOP" } });
    assert.equal(p.consecutive, 1, "counter restarted after the transient");
    assert.notEqual(p.action, "recovery_required");
  });

  it("clear on PROTECTED / NO_POSITION resets the counter", () => {
    assert.equal(planWatchdogAction({ prev: { state: "CRITICAL_NO_STOP", consecutive: 1 }, current: { state: P.PROTECTED } }).action, "clear");
    assert.equal(planWatchdogAction({ prev: { state: "CRITICAL_NO_STOP", consecutive: 1 }, current: { state: P.NO_POSITION } }).action, "clear");
  });

  it("oscillating breach ENUMS still confirm (breach-class, not exact equality)", () => {
    let p = planWatchdogAction({ prev: { state: null, consecutive: 0 }, current: { state: "CRITICAL_QTY_MISMATCH" } });
    assert.equal(p.consecutive, 1);
    // Different breach enum on the next read — must still confirm (was a reset bug).
    p = planWatchdogAction({ prev: { state: "CRITICAL_QTY_MISMATCH", consecutive: 1 }, current: { state: P.RECOVERY_REQUIRED } });
    assert.equal(p.action, "recovery_required");
    assert.equal(p.confirmed, true);
    assert.equal(p.consecutive, 2);
  });
});

// ── INVARIANT: no watchdog path ever yields a flatten ───────────────────────
describe("(15) INVARIANT — no flatten anywhere", () => {
  it("a confirmed breach never invokes any flatten dep", async () => {
    const calls = { flat: 0, interventions: [], intents: [], errors: [], gate: [] };
    const readBreach = async () => okRead(LONG); // long, no stops → CRITICAL_NO_STOP
    const wd = createProtectionWatchdog({
      readBroker: readBreach,
      readOrders: async () => [],
      getJournalOpen: async () => null,
      getArmedRoute: async () => null,
      getPrice: async () => 21000,
      getAuth: async () => null,
      now: () => 1000,
      setProtectionOk: (v) => calls.gate.push(v),
      emitError: (o) => calls.errors.push(o),
      recordIntervention: (r) => calls.interventions.push(r),
      recordIntentTransition: (t) => calls.intents.push(t),
      // A flatten spy the runtime must NEVER touch.
      flatten: () => { calls.flat += 1; },
      confirmThreshold: 2,
    });
    await wd.tick();
    await wd.tick();
    assert.equal(calls.flat, 0, "flatten was never called");
    assert.ok(calls.intents.some((t) => t.state === "RECOVERY_REQUIRED"));
  });
});

// ── createProtectionWatchdog runtime ────────────────────────────────────────
describe("createProtectionWatchdog runtime", () => {
  function harness(readSeq, over = {}) {
    const calls = { gate: [], errors: [], interventions: [], intents: [], orders: 0 };
    let i = 0;
    const wd = createProtectionWatchdog({
      readBroker: async () => (typeof readSeq === "function" ? readSeq(i++) : readSeq),
      readOrders: async () => { calls.orders += 1; return over.orders ? over.orders() : []; },
      getJournalOpen: async () => (over.journal ? over.journal() : null),
      getArmedRoute: async () => (over.armedRoute ? over.armedRoute() : null),
      getPrice: async () => 21000,
      getAuth: async () => (over.auth ? over.auth() : null),
      now: () => (over.now ? over.now() : 1000),
      setProtectionOk: (v) => calls.gate.push(v),
      emitError: (o) => calls.errors.push(o),
      recordIntervention: (r) => calls.interventions.push(r),
      recordIntentTransition: (t) => calls.intents.push(t),
      confirmThreshold: 2,
      ...over.deps,
    });
    return { wd, calls };
  }

  it("(16) confirmed breach tick → JSONL intervention + setProtectionOk(false) + app:error", async () => {
    const { wd, calls } = harness(() => okRead(LONG), { orders: () => [] }); // long, no stop
    await wd.tick(); // detect (pause)
    await wd.tick(); // confirm
    assert.deepEqual(calls.gate.slice(-1), [false]);
    assert.equal(calls.interventions.length, 1);
    assert.equal(calls.interventions[0].state, "CRITICAL_NO_STOP");
    assert.ok(calls.errors.some((e) => e.level === "error"));
  });

  it("(17) tick throws → fail-closed setProtectionOk(false) + app:error, never throws out", async () => {
    const { wd, calls } = harness(() => { throw new Error("boom"); });
    const res = await wd.tick();
    assert.ok(res.error);
    assert.deepEqual(calls.gate, [false]);
    assert.ok(calls.errors.length >= 1);
  });

  it("(18) dead-detector independence — breach detected without any bar events", async () => {
    // The watchdog has no bar-event input at all; two ticks confirm purely from
    // its own reads.
    const { wd, calls } = harness(() => okRead(LONG), { orders: () => [] });
    await wd.tick();
    await wd.tick();
    assert.equal(calls.interventions.length, 1);
  });

  it("(19) repeated same-breach ticks dedupe to one intervention", async () => {
    const { wd, calls } = harness(() => okRead(LONG), { orders: () => [] });
    await wd.tick();
    await wd.tick(); // confirm → 1 intervention
    await wd.tick(); // same breach again → deduped
    await wd.tick();
    assert.equal(calls.interventions.length, 1);
  });

  it("(20) after operator protect → next tick PROTECTED, gate reopens", async () => {
    let protectedNow = false;
    const { wd, calls } = harness(() => okRead(LONG), { orders: () => (protectedNow ? [{ kind: "stop", side: "sell", qty: 2, price: 20970 }] : []) });
    await wd.tick();
    await wd.tick();
    assert.deepEqual(calls.gate.slice(-1), [false]);
    protectedNow = true; // operator attached a stop
    await wd.tick();
    assert.deepEqual(calls.gate.slice(-1), [true], "gate reopened on PROTECTED");
    assert.equal(wd.getState().state, "PROTECTED");
  });

  it("(2b) no position → gate open, entries allowed", async () => {
    const { wd, calls } = harness(() => flatRead);
    await wd.tick();
    assert.deepEqual(calls.gate.slice(-1), [true]);
    assert.equal(wd.getState().state, "NO_POSITION");
  });

  it("(9b) http_401 → AUTH_EXPIRED pause + guidance, NEVER a flatten/intervention", async () => {
    const { wd, calls } = harness(() => unreadable, { auth: () => ({ token: "t", lastReadStatus: "http_401" }) });
    await wd.tick();
    await wd.tick();
    assert.deepEqual(calls.gate.slice(-1), [false]);
    assert.equal(calls.interventions.length, 0, "auth loss never triggers a recovery intervention");
    assert.ok(calls.errors.some((e) => /re-sniff|Tradovate panel/i.test(e.message)));
  });

  it("(5) AUTH_EXPIRED dedupes — one loud error per episode, re-emitted after recovery", async () => {
    let authLost = true;
    const { wd, calls } = harness(
      () => (authLost ? unreadable : flatRead),
      { auth: () => (authLost ? { token: "t", lastReadStatus: "http_401" } : null) },
    );
    await wd.tick();
    await wd.tick();
    await wd.tick();
    const authErrors = () => calls.errors.filter((e) => /re-sniff|Tradovate panel/i.test(e.message)).length;
    assert.equal(authErrors(), 1, "one auth error across a sustained auth-loss episode");
    authLost = false; // token re-sniffed → NO_POSITION clear resets the latch
    await wd.tick();
    authLost = true;  // lost again → a fresh episode re-emits
    await wd.tick();
    assert.equal(authErrors(), 2, "re-emitted only after a clear read + re-loss");
  });
});

// ── interventionRecord + protectionReadiness ────────────────────────────────
describe("interventionRecord + protectionReadiness", () => {
  it("interventionRecord captures state/blockers/position/account", () => {
    const r = interventionRecord({
      result: { state: "CRITICAL_NO_STOP", blockers: ["no_protective_stop"], evidence: { evidence_age_ms: 42, account_id: "A1" } },
      position: LONG, action: "recovery_required", now: 0,
    });
    assert.equal(r.state, "CRITICAL_NO_STOP");
    assert.deepEqual(r.blockers, ["no_protective_stop"]);
    assert.deepEqual(r.position, { symbol: "MNQ1!", side: "buy", qty: 2 });
    assert.equal(r.action, "recovery_required");
    assert.equal(r.account_id, "A1");
    assert.equal(r.evidence_age_ms, 42);
  });

  it("protectionReadiness: protectionOk false blocks; stale watchdog while a position exists blocks", () => {
    assert.equal(protectionReadiness({ protectionOk: false, state: "PROTECTED" }).blocker, "protection_unhealthy");
    assert.equal(protectionReadiness({ protectionOk: true, state: "PROTECTED", tickAgeMs: 40000, intervalMs: 15000 }).blocker, "watchdog_stale");
    assert.equal(protectionReadiness({ protectionOk: true, state: "NO_POSITION", tickAgeMs: 40000, intervalMs: 15000 }).blocked, false);
    assert.equal(protectionReadiness({ protectionOk: true, state: "PROTECTED", tickAgeMs: 5000, intervalMs: 15000 }).blocked, false);
  });

  it("protectionReadiness: the boot pre-first-tick (state null) window blocks when a position is open", () => {
    // No tick yet (state null) AND a position open → blocked (staleness can't fire
    // with a null tick time).
    assert.equal(protectionReadiness({ protectionOk: true, state: null, tickAgeMs: null, journalOpen: true }).blocker, "watchdog_not_ready");
    // No position → not blocked even before the first tick.
    assert.equal(protectionReadiness({ protectionOk: true, state: null, tickAgeMs: null, journalOpen: false }).blocked, false);
  });
});
