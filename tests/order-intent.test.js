import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  INTENT_STATES, deriveDecisionId, nextIntentState, foldIntents,
  planIntentAction, classifySubmitResult, reconcileIntent, createIntentStore,
} from "../app/main/execution/order-intent.js";
import { parseJsonlTolerant } from "../cli/lib/jsonl.js";
import { runTrancheManager } from "../app/main/execution/tranche-manager.js";

const S = INTENT_STATES;

// ── deriveDecisionId ────────────────────────────────────────────────────────
describe("deriveDecisionId", () => {
  const base = { packetId: "D-abc", accountId: "acct-1", session: "ny-am", side: "long", entry: 100, stop: 95 };

  it("is identical for identical inputs (replay-idempotent)", () => {
    assert.equal(deriveDecisionId(base), deriveDecisionId({ ...base }));
    // Called a third time — still the same (pure).
    assert.equal(deriveDecisionId(base), deriveDecisionId(base));
  });

  it("has the OI- prefix + 8 hex chars", () => {
    assert.match(deriveDecisionId(base), /^OI-[0-9a-f]{8}$/);
  });

  it("diverges on side/entry/stop (folds them in — packetId can collide)", () => {
    const id = deriveDecisionId(base);
    assert.notEqual(id, deriveDecisionId({ ...base, side: "short" }));
    assert.notEqual(id, deriveDecisionId({ ...base, entry: 101 }));
    assert.notEqual(id, deriveDecisionId({ ...base, stop: 94 }));
    assert.notEqual(id, deriveDecisionId({ ...base, accountId: "acct-2" }));
  });

  it("treats missing fields as empty rather than throwing", () => {
    assert.match(deriveDecisionId({}), /^OI-[0-9a-f]{8}$/);
  });
});

// ── nextIntentState ─────────────────────────────────────────────────────────
describe("nextIntentState", () => {
  it("allows every legal forward edge", () => {
    assert.equal(nextIntentState(S.INTENT_CREATED, S.SUBMITTING), S.SUBMITTING);
    assert.equal(nextIntentState(S.INTENT_CREATED, S.REJECTED), S.REJECTED);
    assert.equal(nextIntentState(S.SUBMITTING, S.BROKER_ACKNOWLEDGED), S.BROKER_ACKNOWLEDGED);
    assert.equal(nextIntentState(S.SUBMITTING, S.RECOVERY_REQUIRED), S.RECOVERY_REQUIRED);
    assert.equal(nextIntentState(S.BROKER_ACKNOWLEDGED, S.POSITION_CONFIRMED), S.POSITION_CONFIRMED);
    assert.equal(nextIntentState(S.POSITION_CONFIRMED, S.STOP_CONFIRMED), S.STOP_CONFIRMED);
  });

  it("returns null for an illegal edge", () => {
    assert.equal(nextIntentState(S.INTENT_CREATED, S.POSITION_CONFIRMED), null);
    assert.equal(nextIntentState(S.INTENT_CREATED, S.STOP_CONFIRMED), null);
    assert.equal(nextIntentState(S.SUBMITTING, S.STOP_CONFIRMED), null);
  });

  it("keeps terminal states immovable", () => {
    for (const ev of Object.values(S)) {
      assert.equal(nextIntentState(S.STOP_CONFIRMED, ev), null);
      assert.equal(nextIntentState(S.REJECTED, ev), null);
    }
  });

  it("only lets RECOVERY_REQUIRED / UNKNOWN move via an explicit reconcile event", () => {
    // A plain forward event is refused.
    assert.equal(nextIntentState(S.RECOVERY_REQUIRED, S.SUBMITTING), null);
    assert.equal(nextIntentState(S.UNKNOWN, S.SUBMITTING), null);
    // A reconcile event resolves it.
    assert.equal(nextIntentState(S.RECOVERY_REQUIRED, { type: "reconcile", to: S.STOP_CONFIRMED }), S.STOP_CONFIRMED);
    assert.equal(nextIntentState(S.UNKNOWN, { type: "reconcile", to: S.REJECTED }), S.REJECTED);
    // A reconcile event from a non-held state is illegal.
    assert.equal(nextIntentState(S.INTENT_CREATED, { type: "reconcile", to: S.STOP_CONFIRMED }), null);
    // A reconcile to a nonsense target is refused.
    assert.equal(nextIntentState(S.RECOVERY_REQUIRED, { type: "reconcile", to: "NONSENSE" }), null);
  });
});

// ── foldIntents ─────────────────────────────────────────────────────────────
describe("foldIntents", () => {
  it("keeps the last record per decision_id (last-wins)", () => {
    const recs = [
      { decision_id: "OI-1", state: S.INTENT_CREATED },
      { decision_id: "OI-1", state: S.SUBMITTING },
      { decision_id: "OI-1", state: S.BROKER_ACKNOWLEDGED },
    ];
    const m = foldIntents(recs);
    assert.equal(m.size, 1);
    assert.equal(m.get("OI-1").state, S.BROKER_ACKNOWLEDGED);
  });

  it("folds multiple decision_ids independently", () => {
    const m = foldIntents([
      { decision_id: "OI-1", state: S.INTENT_CREATED },
      { decision_id: "OI-2", state: S.STOP_CONFIRMED },
      { decision_id: "OI-1", state: S.REJECTED },
    ]);
    assert.equal(m.get("OI-1").state, S.REJECTED);
    assert.equal(m.get("OI-2").state, S.STOP_CONFIRMED);
  });

  it("survives a torn tail line — good records still fold", () => {
    const txt = [
      JSON.stringify({ decision_id: "OI-1", state: S.INTENT_CREATED }),
      JSON.stringify({ decision_id: "OI-1", state: S.SUBMITTING }),
      '{"decision_id":"OI-1","state":"BROKER_ACK', // torn write
    ].join("\n");
    const { records, dropped } = parseJsonlTolerant(txt);
    assert.equal(dropped, 1);
    const m = foldIntents(records);
    assert.equal(m.get("OI-1").state, S.SUBMITTING); // the last good record wins
  });

  it("ignores records with no decision_id rather than crashing", () => {
    const m = foldIntents([null, {}, { state: S.SUBMITTING }, { decision_id: "OI-1", state: S.SUBMITTING }]);
    assert.equal(m.size, 1);
    assert.equal(m.get("OI-1").state, S.SUBMITTING);
  });
});

// ── classifySubmitResult ────────────────────────────────────────────────────
describe("classifySubmitResult", () => {
  it("ok:true → acknowledged", () => {
    assert.equal(classifySubmitResult({ ok: true, status: 200 }), "acknowledged");
    assert.equal(classifySubmitResult({ ok: true, status: 0 }), "acknowledged"); // ok wins
  });
  it("4xx → rejected", () => {
    assert.equal(classifySubmitResult({ ok: false, status: 400 }), "rejected");
    assert.equal(classifySubmitResult({ ok: false, status: 401 }), "rejected");
    assert.equal(classifySubmitResult({ ok: false, status: 499 }), "rejected");
  });
  it("status 0 (fetch failed / timeout) → ambiguous", () => {
    assert.equal(classifySubmitResult({ ok: false, status: 0 }), "ambiguous");
    assert.equal(classifySubmitResult({ ok: false, timeout: true }), "ambiguous");
    assert.equal(classifySubmitResult({ ok: false }), "ambiguous");
  });
  it("5xx → ambiguous (fail-closed: the order may have landed)", () => {
    assert.equal(classifySubmitResult({ ok: false, status: 500 }), "ambiguous");
    assert.equal(classifySubmitResult({ ok: false, status: 503 }), "ambiguous");
  });
});

// ── planIntentAction ────────────────────────────────────────────────────────
describe("planIntentAction", () => {
  it("no prior record → create", () => {
    assert.equal(planIntentAction({ existing: null }).action, "create");
    assert.equal(planIntentAction({}).action, "create");
  });
  it("maps each lifecycle state to the right resume decision", () => {
    assert.equal(planIntentAction({ existing: { state: S.INTENT_CREATED } }).action, "reconcile");
    assert.equal(planIntentAction({ existing: { state: S.SUBMITTING } }).action, "reconcile");
    assert.equal(planIntentAction({ existing: { state: S.BROKER_ACKNOWLEDGED } }).action, "skip_duplicate");
    assert.equal(planIntentAction({ existing: { state: S.POSITION_CONFIRMED } }).action, "skip_duplicate");
    assert.equal(planIntentAction({ existing: { state: S.STOP_CONFIRMED } }).action, "skip_duplicate");
    assert.equal(planIntentAction({ existing: { state: S.REJECTED } }).action, "skip_rejected");
    assert.equal(planIntentAction({ existing: { state: S.RECOVERY_REQUIRED } }).action, "blocked_recovery");
    assert.equal(planIntentAction({ existing: { state: S.UNKNOWN } }).action, "blocked_recovery");
  });
  it("a corrupt state fails closed to blocked_recovery", () => {
    assert.equal(planIntentAction({ existing: { state: "WAT" } }).action, "blocked_recovery");
  });

  it("restart between EVERY transition folds to the right resume decision", () => {
    // Full happy lifecycle for one decision_id, one record per transition.
    const lifecycle = [
      { decision_id: "OI-x", state: S.INTENT_CREATED },
      { decision_id: "OI-x", state: S.SUBMITTING },
      { decision_id: "OI-x", state: S.BROKER_ACKNOWLEDGED },
      { decision_id: "OI-x", state: S.POSITION_CONFIRMED },
      { decision_id: "OI-x", state: S.STOP_CONFIRMED },
    ];
    const expected = ["reconcile", "reconcile", "skip_duplicate", "skip_duplicate", "skip_duplicate"];
    for (let i = 1; i <= lifecycle.length; i += 1) {
      const existing = foldIntents(lifecycle.slice(0, i)).get("OI-x");
      assert.equal(planIntentAction({ existing }).action, expected[i - 1], `prefix len ${i}`);
    }
  });
});

// ── reconcileIntent ─────────────────────────────────────────────────────────
describe("reconcileIntent", () => {
  const intent = { symbol: "MNQ1!", side: "long" };

  it("broker unavailable stays RECOVERY_REQUIRED (never infers flat)", () => {
    assert.equal(reconcileIntent({ intent, brokerRead: { ok: false } }), S.RECOVERY_REQUIRED);
    assert.equal(reconcileIntent({ intent, brokerRead: null }), S.RECOVERY_REQUIRED);
  });
  it("broker confirmed flat → REJECTED", () => {
    assert.equal(reconcileIntent({ intent, brokerRead: { ok: true, position: null } }), S.REJECTED);
  });
  it("timeout after acceptance (matching position, stop unchecked) → POSITION_CONFIRMED", () => {
    assert.equal(
      reconcileIntent({ intent, brokerRead: { ok: true, position: { symbol: "MNQ1!", side: "buy", qty: 1 } } }),
      S.POSITION_CONFIRMED,
    );
  });
  it("matching position WITH a working stop → STOP_CONFIRMED", () => {
    assert.equal(
      reconcileIntent({ intent, brokerRead: { ok: true, position: { symbol: "MNQ1!", side: "buy" } }, brokerStop: [{ kind: "stop" }] }),
      S.STOP_CONFIRMED,
    );
  });
  it("matching position, NO stop (partial bracket) → RECOVERY_REQUIRED", () => {
    assert.equal(
      reconcileIntent({ intent, brokerRead: { ok: true, position: { symbol: "MNQ1!", side: "buy" } }, brokerStop: [] }),
      S.RECOVERY_REQUIRED,
    );
  });
  it("a non-matching (orphan) position → RECOVERY_REQUIRED, never STOP_CONFIRMED", () => {
    assert.equal(
      reconcileIntent({ intent, brokerRead: { ok: true, position: { symbol: "MES1!", side: "buy" } }, brokerStop: [{ kind: "stop" }] }),
      S.RECOVERY_REQUIRED,
    );
    // Right symbol, wrong side → still a mismatch.
    assert.equal(
      reconcileIntent({ intent, brokerRead: { ok: true, position: { symbol: "MNQ1!", side: "sell" } }, brokerStop: [{ kind: "stop" }] }),
      S.RECOVERY_REQUIRED,
    );
  });
});

// ── createIntentStore (in-memory deps) ──────────────────────────────────────
describe("createIntentStore", () => {
  function memStore() {
    const records = [];
    const store = createIntentStore({
      readRecords: async () => records.slice(),
      appendRecord: async (r) => { records.push(r); },
    });
    return { store, records };
  }

  it("readIntent folds to the latest record; recordTransition appends + stamps ts", async () => {
    const { store, records } = memStore();
    assert.equal(await store.readIntent("OI-1"), null);
    await store.recordTransition({ decision_id: "OI-1", state: S.INTENT_CREATED });
    await store.recordTransition({ decision_id: "OI-1", state: S.SUBMITTING });
    assert.equal(records.length, 2);
    assert.ok(records[0].ts, "ts stamped");
    assert.equal((await store.readIntent("OI-1")).state, S.SUBMITTING);
  });

  it("an explicit ts on the record is preserved", async () => {
    const { store, records } = memStore();
    await store.recordTransition({ decision_id: "OI-1", state: S.INTENT_CREATED, ts: "2026-01-01T00:00:00.000Z" });
    assert.equal(records[0].ts, "2026-01-01T00:00:00.000Z");
  });
});

// ── Runtime integration: intent gate on runTrancheManager ───────────────────
// Deps double mirrors tranche-runtime.test.js + adds an in-memory intent store,
// the broker reads used by the reconcile branch, and account/session ids.
function makeDeps(over = {}) {
  const calls = { accept: [], openTrancheOrders: [], recordSkip: [], invalidate: [], order: [] };
  const intents = [];
  const deps = {
    readExecConfig: () => ({ automationMode: "auto", guards: { perTradeMax: 250, dailyLimit: 600, defaultRisk: 120 } }),
    readJournal: async () => ({ events: [], open: [] }),
    sizePacket: () => ({ contracts: 1, riskUsd: 120, withinTolerance: true }),
    consecutiveLossStreak: () => 0,
    dayRealizedLossUsd: () => 0,
    checkOrder: () => ({ ok: true }),
    accountRoutable: () => ({ route: true }),
    autoAllowed: () => true,
    accountId: () => "acct-1",
    session: () => "ny-am",
    // intent store (in-memory)
    readIntent: async (id) => foldIntents(intents).get(id) ?? null,
    recordIntent: async (rec) => { const r = { ts: new Date().toISOString(), ...rec }; intents.push(r); calls.order.push(["intent", r.state]); return r; },
    // reconcile-branch broker reads (default: nothing at the broker)
    readBrokerPosition: async () => ({ ok: true, position: null }),
    readBrokerStop: async () => [],
    accept: async (payload) => { calls.accept.push(payload); calls.order.push(["accept"]); return { id: "T-0009" }; },
    openTrancheOrders: async (a) => { calls.openTrancheOrders.push(a); calls.order.push(["openTrancheOrders"]); return { stopOrderId: 1, limitOrderId: 2 }; },
    recordSkip: async (r) => { calls.recordSkip.push(r); },
    invalidateTrade: async (id, src) => { calls.invalidate.push([id, src]); },
    ...over,
  };
  return { deps, calls, intents };
}

const anchorPacket = { id: "D-abc", symbol: "MNQ1!", side: "long", grade: "A+", entry: 100, stop: 95, tp1: 110, tp2: 120 };

describe("runTrancheManager — durable intent gate", () => {
  it("records INTENT_CREATED before accept, SUBMITTING before openTrancheOrders", async () => {
    const { deps, calls } = makeDeps();
    const r = await runTrancheManager({ bestPacket: anchorPacket }, deps);
    assert.equal(r.action, "open_anchor");
    // Persist-before-write ordering.
    const seq = calls.order.map((c) => c[0] === "intent" ? `intent:${c[1]}` : c[0]);
    const iCreated = seq.indexOf("intent:INTENT_CREATED");
    const iAccept = seq.indexOf("accept");
    const iSubmitting = seq.indexOf("intent:SUBMITTING");
    const iOpen = seq.indexOf("openTrancheOrders");
    assert.ok(iCreated >= 0 && iAccept >= 0 && iCreated < iAccept, "INTENT_CREATED before accept");
    assert.ok(iSubmitting >= 0 && iOpen >= 0 && iSubmitting < iOpen, "SUBMITTING before openTrancheOrders");
  });

  it("an already-acknowledged intent → skip:intent_dup, NO accept, NO broker write", async () => {
    const { deps, calls, intents } = makeDeps();
    // Seed the store as if a prior bar already got the broker ack.
    const decisionId = deriveDecisionId({ packetId: "D-abc", accountId: "acct-1", session: "ny-am", side: "long", entry: 100, stop: 95 });
    intents.push({ decision_id: decisionId, state: S.BROKER_ACKNOWLEDGED });
    const r = await runTrancheManager({ bestPacket: anchorPacket }, deps);
    assert.equal(r.action, "skip:intent_dup");
    assert.equal(calls.accept.length, 0);
    assert.equal(calls.openTrancheOrders.length, 0);
    assert.deepEqual(calls.recordSkip, ["skip:intent_dup"]);
  });

  it("a REJECTED intent → skip:intent_rejected, not retried in-session", async () => {
    const { deps, calls, intents } = makeDeps();
    const decisionId = deriveDecisionId({ packetId: "D-abc", accountId: "acct-1", session: "ny-am", side: "long", entry: 100, stop: 95 });
    intents.push({ decision_id: decisionId, state: S.REJECTED });
    const r = await runTrancheManager({ bestPacket: anchorPacket }, deps);
    assert.equal(r.action, "skip:intent_rejected");
    assert.equal(calls.accept.length, 0);
  });

  it("ambiguous submit records RECOVERY_REQUIRED, does NOT invalidate, and blocks the next attempt", async () => {
    const { deps, calls, intents } = makeDeps({
      // Fake openTrancheOrders modelling the real ambiguous path: mark recovery,
      // never invalidate.
      openTrancheOrders: async (a) => {
        calls.openTrancheOrders.push(a);
        await deps.recordIntent({ decision_id: a.decisionId, state: S.RECOVERY_REQUIRED, trade_id: a.trancheId, reason: "ambiguous-submit" });
        return { action: "recovery_required" };
      },
    });
    const r1 = await runTrancheManager({ bestPacket: anchorPacket }, deps);
    assert.equal(r1.action, "open_anchor"); // the entry attempt happened
    assert.equal(calls.invalidate.length, 0, "ambiguous must NOT invalidate");
    // Latest intent is RECOVERY_REQUIRED.
    const decisionId = deriveDecisionId({ packetId: "D-abc", accountId: "acct-1", session: "ny-am", side: "long", entry: 100, stop: 95 });
    assert.equal(foldIntents(intents).get(decisionId).state, S.RECOVERY_REQUIRED);
    // Next surfacing of the same setup is blocked (no second accept).
    const acceptsBefore = calls.accept.length;
    const r2 = await runTrancheManager({ bestPacket: anchorPacket }, deps);
    assert.equal(r2.action, "blocked:intent_recovery");
    assert.equal(calls.accept.length, acceptsBefore, "no re-entry while recovery is required");
  });

  it("a 4xx submit → REJECTED intent + invalidated trade", async () => {
    const { deps, calls, intents } = makeDeps({
      openTrancheOrders: async (a) => {
        calls.openTrancheOrders.push(a);
        await deps.recordIntent({ decision_id: a.decisionId, state: S.REJECTED, trade_id: a.trancheId, status: 400 });
        await deps.invalidateTrade(a.trancheId, "order-place-failed");
        return { error: "entry_place_failed" };
      },
    });
    await runTrancheManager({ bestPacket: anchorPacket }, deps);
    const decisionId = deriveDecisionId({ packetId: "D-abc", accountId: "acct-1", session: "ny-am", side: "long", entry: 100, stop: 95 });
    assert.equal(foldIntents(intents).get(decisionId).state, S.REJECTED);
    assert.equal(calls.invalidate.length, 1);
  });

  it("reconcile branch: a stuck SUBMITTING that the broker actually filled → skip:intent_dup", async () => {
    const { deps, calls, intents } = makeDeps({
      // Broker shows a matching, protected position.
      readBrokerPosition: async () => ({ ok: true, position: { symbol: "MNQ1!", side: "buy", qty: 1 } }),
      readBrokerStop: async () => [{ kind: "stop" }],
    });
    const decisionId = deriveDecisionId({ packetId: "D-abc", accountId: "acct-1", session: "ny-am", side: "long", entry: 100, stop: 95 });
    intents.push({ decision_id: decisionId, state: S.SUBMITTING, symbol: "MNQ1!", side: "long" });
    const r = await runTrancheManager({ bestPacket: anchorPacket }, deps);
    assert.equal(r.action, "skip:intent_dup");
    assert.equal(calls.accept.length, 0, "never double-place a position the broker already holds");
  });

  it("reconcile branch: a stuck SUBMITTING the broker never received → allow create", async () => {
    const { deps, calls, intents } = makeDeps({
      readBrokerPosition: async () => ({ ok: true, position: null }), // broker flat → prior submit didn't land
    });
    const decisionId = deriveDecisionId({ packetId: "D-abc", accountId: "acct-1", session: "ny-am", side: "long", entry: 100, stop: 95 });
    intents.push({ decision_id: decisionId, state: S.SUBMITTING, symbol: "MNQ1!", side: "long" });
    const r = await runTrancheManager({ bestPacket: anchorPacket }, deps);
    assert.equal(r.action, "open_anchor");
    assert.equal(calls.accept.length, 1, "safe to place — the broker never got the first attempt");
  });
});
