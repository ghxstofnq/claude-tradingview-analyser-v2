// Unit tests for app/renderer/src/LiveTimeline.helpers.js (Task C3).
// Pure helpers — no renderer, no main process. Locks the timeline contract:
// the durable-state → stage table, the forge-proof re-derivation from broker
// truth, the pinned recovery whitelist, and the P&L gate.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TIMELINE_STAGES,
  DURABLE_STATES,
  RECOVERY_VERBS,
  sanitizeVerbs,
  foldIntentChain,
  deriveTimeline,
  brokerVsJournal,
  sourceAgeChips,
  pnlGate,
  normalizeReconcile,
} from "../app/renderer/src/LiveTimeline.helpers.js";

import { INTENT_STATES } from "../app/main/execution/order-intent.js";

// Helpers to read the rail.
const stageStatus = (rail, key) => rail.stages.find((s) => s.key === key)?.status;
const reached = (rail) => rail.reachedKey;

describe("TIMELINE_STAGES", () => {
  it("is the frozen 7-stage rail in order", () => {
    assert.deepEqual(
      TIMELINE_STAGES.map((s) => s.key),
      ["SETUP_CONFIRMED", "RISK_PASSED", "ORDER_SENT", "FILL_CONFIRMED", "STOP_WORKING", "MANAGED", "CLOSED"]
    );
    assert.throws(() => { TIMELINE_STAGES.push({}); });
  });

  it("lock-step: DURABLE_STATES matches order-intent INTENT_STATES exactly", () => {
    const real = Object.keys(INTENT_STATES).sort();
    const mine = [...DURABLE_STATES].sort();
    assert.deepEqual(mine, real, "renderer DURABLE_STATES drifted from order-intent INTENT_STATES");
  });
});

describe("deriveTimeline — durable state → stage table (all 8 states)", () => {
  const cases = [
    ["INTENT_CREATED", "SETUP_CONFIRMED"],
    ["SUBMITTING", "RISK_PASSED"],
    ["BROKER_ACKNOWLEDGED", "ORDER_SENT"],
    // POSITION_CONFIRMED / STOP_CONFIRMED corroborated by a broker position below.
  ];
  for (const [state, wantReached] of cases) {
    it(`${state} → reached ${wantReached}`, () => {
      const rail = deriveTimeline({ chain: { state } });
      assert.equal(reached(rail), wantReached);
      assert.equal(rail.corrupt, false);
    });
  }

  it("POSITION_CONFIRMED → FILL CONFIRMED (durable is broker-derived)", () => {
    const rail = deriveTimeline({ chain: { state: "POSITION_CONFIRMED" } });
    assert.equal(reached(rail), "FILL_CONFIRMED");
  });

  it("STOP_CONFIRMED + broker position present → STOP WORKING", () => {
    const rail = deriveTimeline({
      chain: { state: "STOP_CONFIRMED" },
      exec: { position: { symbol: "MNQ1!", side: "buy", qty: 1, sl: 20990 } },
    });
    assert.equal(reached(rail), "STOP_WORKING");
    assert.equal(stageStatus(rail, "STOP_WORKING"), "done");
  });

  it("null chain → nothing reached yet", () => {
    const rail = deriveTimeline({ chain: null });
    assert.equal(reached(rail), null);
    assert.equal(stageStatus(rail, "SETUP_CONFIRMED"), "current");
  });

  it("RECOVERY_REQUIRED → red recovery badge on current stage, whitelisted verbs", () => {
    const rail = deriveTimeline({ chain: { state: "RECOVERY_REQUIRED" } });
    assert.ok(rail.recovery, "expected recovery affordance");
    assert.equal(rail.recovery.kind, "RECOVERY_REQUIRED");
    assert.ok(rail.blocked);
    for (const v of rail.recovery.verbs) assert.ok(RECOVERY_VERBS.includes(v));
    const cur = rail.stages.find((s) => s.status === "current");
    assert.equal(cur.badge, "recovery");
  });

  it("UNKNOWN durable → retry-only recovery", () => {
    const rail = deriveTimeline({ chain: { state: "UNKNOWN" } });
    assert.equal(rail.recovery.kind, "UNKNOWN");
    assert.deepEqual(rail.recovery.verbs, ["retry"]);
  });
});

describe("deriveTimeline — REJECTED terminal", () => {
  it("REJECTED fails at ORDER SENT (terminal, no recovery)", () => {
    const rail = deriveTimeline({ chain: { state: "REJECTED" } });
    assert.equal(stageStatus(rail, "ORDER_SENT"), "failed");
    assert.equal(stageStatus(rail, "SETUP_CONFIRMED"), "done");
    assert.equal(stageStatus(rail, "FILL_CONFIRMED"), "pending");
    assert.equal(rail.currentKey, "ORDER_SENT");
    assert.equal(rail.recovery, null);
    const sent = rail.stages.find((s) => s.key === "ORDER_SENT");
    assert.equal(sent.badge, "failed");
  });
});

describe("deriveTimeline — dropped>0 CORRUPT blocks happy path", () => {
  it("torn intent journal → CORRUPT recovery, blocked, nothing reached", () => {
    const rail = deriveTimeline({ chain: { state: "POSITION_CONFIRMED" }, dropped: 2 });
    assert.equal(rail.corrupt, true);
    assert.equal(rail.blocked, true);
    assert.equal(rail.recovery.kind, "CORRUPT");
    assert.equal(reached(rail), null);
    assert.deepEqual(rail.recovery.verbs, ["retry"]);
  });
  it("reconcile 'corrupt' string also trips CORRUPT", () => {
    const rail = deriveTimeline({ chain: { state: "STOP_CONFIRMED" }, reconcile: "corrupt" });
    assert.equal(rail.corrupt, true);
  });
});

describe("deriveTimeline — FORGE-PROOF (STOP_CONFIRMED vs broker truth)", () => {
  it("record claims STOP_CONFIRMED but broker read shows NO position → NOT STOP WORKING", () => {
    const rail = deriveTimeline({
      chain: { state: "STOP_CONFIRMED" },
      exec: { connected: true, position: null, workingOrders: [] },
      reconcile: "HEALTHY", // broker CONFIRMED flat
    });
    assert.notEqual(reached(rail), "STOP_WORKING");
    assert.equal(stageStatus(rail, "STOP_WORKING"), "pending");
    assert.ok(rail.recovery, "a forged fill must surface a recovery");
    assert.equal(rail.recovery.kind, "POSITION_MISMATCH");
  });

  it("record claims STOP_CONFIRMED but broker unreadable (ok:false) → NOT STOP WORKING", () => {
    const rail = deriveTimeline({
      chain: { state: "STOP_CONFIRMED" },
      exec: null,
      reconcile: { state: "UNKNOWN", broker_read: { ok: false, position: null } },
    });
    assert.notEqual(reached(rail), "STOP_WORKING");
  });

  it("naked position (broker holds position, no stop) → CRITICAL_NO_STOP recovery", () => {
    const rail = deriveTimeline({
      chain: { state: "POSITION_CONFIRMED" },
      exec: { position: { symbol: "MNQ1!", side: "buy", qty: 1 }, workingOrders: [] },
    });
    assert.equal(reached(rail), "FILL_CONFIRMED");
    assert.equal(rail.recovery.kind, "CRITICAL_NO_STOP");
    assert.deepEqual(rail.recovery.verbs, ["protect", "flatten"]);
  });
});

describe("deriveTimeline — broker-truth escalation & CLOSED", () => {
  it("reconcile MANAGEMENT_ONLY → MANAGED", () => {
    const rail = deriveTimeline({
      chain: { state: "STOP_CONFIRMED" },
      exec: { position: { symbol: "MNQ1!", side: "buy", qty: 1, sl: 20990 } },
      reconcile: "MANAGEMENT_ONLY",
    });
    assert.equal(reached(rail), "MANAGED");
  });
  it("trade.tp1_hit → MANAGED", () => {
    const rail = deriveTimeline({
      chain: { state: "STOP_CONFIRMED" },
      exec: { position: { symbol: "MNQ1!", side: "buy", qty: 1, sl: 21000 } },
      trade: { tp1_hit: true },
    });
    assert.equal(reached(rail), "MANAGED");
  });
  it("journal terminal outcome → CLOSED", () => {
    const rail = deriveTimeline({ chain: { state: "STOP_CONFIRMED" }, trade: { outcome: "STOPPED" } });
    assert.equal(reached(rail), "CLOSED");
    assert.equal(stageStatus(rail, "CLOSED"), "done");
  });
  it("broker flat AFTER a confirmed position → CLOSED", () => {
    const rail = deriveTimeline({
      chain: { state: "STOP_CONFIRMED" },
      reconcile: "HEALTHY",
      trade: { outcome: "TP2_HIT" },
    });
    assert.equal(reached(rail), "CLOSED");
  });

  it("reconcile CRITICAL_NO_STOP raises protect/flatten recovery", () => {
    const rail = deriveTimeline({
      chain: { state: "POSITION_CONFIRMED" },
      reconcile: "CRITICAL_NO_STOP",
    });
    assert.equal(rail.recovery.kind, "CRITICAL_NO_STOP");
    assert.deepEqual(rail.recovery.verbs, ["protect", "flatten"]);
  });
  it("reconcile ORPHAN_POSITION raises adopt/flatten recovery", () => {
    const rail = deriveTimeline({ chain: null, reconcile: "ORPHAN_POSITION",
      exec: { position: { symbol: "MNQ1!", side: "buy", qty: 1, sl: 1 } } });
    assert.equal(rail.recovery.kind, "ORPHAN_POSITION");
    assert.deepEqual(rail.recovery.verbs, ["adopt", "flatten"]);
  });
});

describe("sanitizeVerbs — pinned whitelist", () => {
  it("drops a forged verb, keeps whitelisted ones, de-dupes", () => {
    assert.deepEqual(sanitizeVerbs(["retry", "nuke", "flatten", "retry", "wire_transfer"]), ["retry", "flatten"]);
  });
  it("RECOVERY_VERBS is exactly the four pinned verbs", () => {
    assert.deepEqual([...RECOVERY_VERBS], ["retry", "adopt", "protect", "flatten"]);
    assert.throws(() => { RECOVERY_VERBS.push("x"); });
  });
});

describe("foldIntentChain", () => {
  it("groups by decision_id, preserves order, ignores no-id records", () => {
    const records = [
      { decision_id: "A", state: "INTENT_CREATED", ts: "2026-07-10T13:00:00Z", symbol: "MNQ1!", side: "buy" },
      { state: "SUBMITTING" }, // no decision_id — ignored
      { decision_id: "A", state: "SUBMITTING", ts: "2026-07-10T13:00:01Z", symbol: "MNQ1!" },
      { decision_id: "B", state: "INTENT_CREATED", ts: "2026-07-10T13:05:00Z", symbol: "MNQ1!", side: "sell" },
      { decision_id: "A", state: "BROKER_ACKNOWLEDGED", ts: "2026-07-10T13:00:02Z", symbol: "MNQ1!" },
    ];
    const { active, chains } = foldIntentChain(records);
    assert.equal(chains.length, 2);
    const a = chains.find((c) => c.decision_id === "A");
    assert.equal(a.transitions.length, 3);
    assert.equal(a.state, "BROKER_ACKNOWLEDGED");
    // Active = newest non-rejected chain by last ts → B (13:05 > 13:00:02).
    assert.equal(active.decision_id, "B");
  });

  it("prefers a non-REJECTED chain over a newer REJECTED one", () => {
    const records = [
      { decision_id: "A", state: "POSITION_CONFIRMED", ts: "2026-07-10T13:00:00Z" },
      { decision_id: "B", state: "REJECTED", ts: "2026-07-10T13:10:00Z" },
    ];
    const { active } = foldIntentChain(records);
    assert.equal(active.decision_id, "A");
  });

  it("filters by symbol root when given", () => {
    const records = [
      { decision_id: "A", state: "POSITION_CONFIRMED", ts: "2026-07-10T13:00:00Z", symbol: "MNQ1!" },
      { decision_id: "B", state: "POSITION_CONFIRMED", ts: "2026-07-10T13:10:00Z", symbol: "MES1!" },
    ];
    const { active, chains } = foldIntentChain(records, { symbol: "MNQ1!" });
    assert.equal(chains.length, 1);
    assert.equal(active.decision_id, "A");
  });

  it("empty / all-no-id → null active", () => {
    assert.equal(foldIntentChain([]).active, null);
    assert.equal(foldIntentChain([{ state: "SUBMITTING" }]).active, null);
  });
});

describe("brokerVsJournal", () => {
  it("position + stop + qty agree → covered", () => {
    const v = brokerVsJournal({
      trade: { size: { contracts: 2 }, stop: 20990 },
      exec: { position: { qty: 2, sl: 20990 } },
    });
    assert.equal(v.verdict, "covered");
    assert.equal(v.protected, true);
  });
  it("position, no stop → naked", () => {
    const v = brokerVsJournal({ trade: { size: { contracts: 1 }, stop: 20990 }, exec: { position: { qty: 1 }, workingOrders: [] } });
    assert.equal(v.verdict, "naked");
    assert.equal(v.protected, false);
  });
  it("position + stop but qty disagree → mismatch", () => {
    const v = brokerVsJournal({ trade: { size: { contracts: 1 }, stop: 20990 }, exec: { position: { qty: 3, sl: 20990 } } });
    assert.equal(v.verdict, "mismatch");
    assert.equal(v.protected, false);
  });
  it("unreadable broker (unknown) never reads covered — naked posture", () => {
    const v = brokerVsJournal({ trade: { size: { contracts: 1 }, stop: 20990 }, exec: null, reconcile: { state: "UNKNOWN", broker_read: { ok: false, position: null } } });
    assert.equal(v.verdict, "unknown");
    assert.equal(v.protected, false);
  });
  it("reconcile stop_present object corroborates a covered position", () => {
    const v = brokerVsJournal({
      trade: { size: { contracts: 1 }, stop: 20990 },
      exec: { position: { qty: 1 } },
      reconcile: { state: "MANAGEMENT_ONLY", broker_read: { ok: true, position: { qty: 1 } }, stop_present: true },
    });
    assert.equal(v.verdict, "covered");
  });
});

describe("sourceAgeChips", () => {
  const now = 1_000_000_000_000;
  it("fresh reads → not stale; old reads → stale (red)", () => {
    const chips = sourceAgeChips({
      exec: { read_at: now - 3000, position: null, workingOrders: [] },
      health: { loop: "healthy", heartbeat_age_s: 2 },
      lastBar: { time: now - 1000 },
      now,
    });
    const byKey = Object.fromEntries(chips.map((c) => [c.key, c]));
    assert.equal(byKey.position.stale, false);
    assert.equal(byKey.orders.stale, false);
    assert.equal(byKey.price.stale, false);
    assert.equal(byKey.engine.stale, false);
  });
  it("missing timestamp ⇒ stale (fail-closed)", () => {
    const chips = sourceAgeChips({ exec: { position: null }, health: null, lastBar: null, now });
    const byKey = Object.fromEntries(chips.map((c) => [c.key, c]));
    assert.equal(byKey.position.stale, true);
    assert.equal(byKey.position.age_s, null);
    assert.equal(byKey.engine.stale, true);
  });
  it("stale exec read (>10s) ⇒ stale", () => {
    const chips = sourceAgeChips({ exec: { read_at: now - 20000, position: null }, now });
    assert.equal(chips.find((c) => c.key === "position").stale, true);
  });
  it("unhealthy loop forces the engine chip stale even with a fresh heartbeat", () => {
    const chips = sourceAgeChips({ health: { loop: "stale", heartbeat_age_s: 1 }, now });
    assert.equal(chips.find((c) => c.key === "engine").stale, true);
  });
});

describe("pnlGate", () => {
  it("PENDING until durable ≥ POSITION_CONFIRMED", () => {
    for (const state of ["INTENT_CREATED", "SUBMITTING", "BROKER_ACKNOWLEDGED"]) {
      const g = pnlGate({ chain: { state } });
      assert.equal(g.show, false);
      assert.equal(g.label, "PENDING");
    }
  });
  it("shows P&L at POSITION_CONFIRMED and STOP_CONFIRMED", () => {
    assert.equal(pnlGate({ chain: { state: "POSITION_CONFIRMED" } }).show, true);
    assert.equal(pnlGate({ chain: { state: "STOP_CONFIRMED" } }).show, true);
  });
  it("journal 'filled' state alone is NOT enough (no durable intent → PENDING)", () => {
    const g = pnlGate({ chain: null, trade: { state: "filled" } });
    assert.equal(g.show, false);
    assert.equal(g.label, "PENDING");
  });
  it("REJECTED / RECOVERY never show P&L", () => {
    assert.equal(pnlGate({ chain: { state: "REJECTED" } }).show, false);
    assert.equal(pnlGate({ chain: { state: "RECOVERY_REQUIRED" } }).show, false);
  });
});

describe("normalizeReconcile", () => {
  it("string MANAGEMENT_ONLY → position + stop present, ok", () => {
    const n = normalizeReconcile("MANAGEMENT_ONLY");
    assert.equal(n.positionPresent, true);
    assert.equal(n.stopPresent, true);
    assert.equal(n.brokerOk, true);
  });
  it("string CRITICAL_NO_STOP → position present, no stop", () => {
    const n = normalizeReconcile("CRITICAL_NO_STOP");
    assert.equal(n.positionPresent, true);
    assert.equal(n.stopPresent, false);
  });
  it("string HEALTHY → confirmed flat", () => {
    const n = normalizeReconcile("HEALTHY");
    assert.equal(n.positionFlat, true);
    assert.equal(n.positionPresent, false);
  });
  it("null → all false, brokerOk null", () => {
    assert.deepEqual(normalizeReconcile(null), { state: null, brokerOk: null, positionPresent: false, positionFlat: false, stopPresent: false });
  });
});
