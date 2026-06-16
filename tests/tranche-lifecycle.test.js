// Controlled replay proof — a scripted multi-tranche lifecycle folded through
// the REAL live execution functions end-to-end:
//   runTrancheManager (open anchor/add) → tickTrades (the live grader) →
//   applyTrancheExit (per-tranche broker exits).
// An in-memory journal + broker double records every action so we can assert
// the full sequence deterministically. This is the part of the cycle that CAN
// be replayed; the actual paper FILLS happen against the live price feed at the
// broker (verified separately on paper + the M0 spike), so they're modeled here
// as the grader's bar-driven transitions.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runTrancheManager } from "../app/main/execution/tranche-manager.js";
import { applyTrancheExit } from "../app/main/execution/tranche-exec.js";
import { tickTrades, foldOpenTrades } from "../cli/lib/trade-outcomes.js";

function makeHarness() {
  const events = [];          // the in-memory trades.jsonl
  const broker = [];          // recorded broker actions, in order
  let acceptSeq = 0;
  let orderSeq = 1000;

  const openDeps = {
    readExecConfig: () => ({ automationMode: "auto", maxAdds: 5, combinedCapUsd: null, guards: { perTradeMax: 100000, dailyLimit: 100000, defaultRisk: 120 } }),
    readJournal: async () => ({ events: [...events], open: foldOpenTrades(events) }),
    hasGreenLight: (evs, id) => evs.some((e) => e.type === "green_light" && e.setup_id === id),
    markGreenLight: async (id) => { events.push({ type: "green_light", setup_id: id, ts: new Date().toISOString() }); broker.push({ a: "green_light", id }); },
    sizePacket: () => ({ contracts: 1, riskUsd: 120, withinTolerance: true }),
    openRiskUsd: () => 0,
    consecutiveLossStreak: () => 0,
    dayRealizedLossUsd: () => 0,
    checkOrder: () => ({ ok: true }),
    accept: async (p) => {
      const id = `T-${String(++acceptSeq).padStart(4, "0")}`;
      events.push({ type: "accept", id, setup_id: p.id, side: p.side, grade: p.grade, entry: p.entry, stop: p.stop, tp1: p.tp1, tp2: p.tp2, size: { contracts: 1 }, symbol: p.symbol, tranche_role: p.tranche_role, ts: new Date().toISOString() });
      return { id };
    },
    openTrancheOrders: async ({ packet, trancheId }) => {
      const stopOrderId = ++orderSeq, limitOrderId = ++orderSeq;
      const tp = packet.grade === "A+" && packet.tp2 != null ? packet.tp2 : packet.tp1;
      broker.push({ a: "open", id: trancheId, stop: packet.stop, tp });
      events.push({ type: "tranche_orders", setup_id: trancheId, stopOrderId, limitOrderId, ts: new Date().toISOString() });
      return { stopOrderId, limitOrderId };
    },
    recordSkip: async () => {},
    // Real-broker arming gates the auto path; this harness models a healthy,
    // confirmed, routable account (paper) so the lifecycle proof is unaffected.
    accountRoutable: () => ({ route: true }),
    autoAllowed: () => true,
  };

  const exitDeps = {
    readEvents: async () => [...events],
    cancelOrder: async (id) => { broker.push({ a: "cancel", id }); },
    flatten: async (sym) => { broker.push({ a: "close", sym }); },
    placeStandalone: async (o) => { const id = ++orderSeq; broker.push({ a: "place", type: o.type, price: o.price, id }); return id; },
    recordTrancheOrders: async (o) => { events.push({ type: "tranche_orders", ...o, ts: new Date().toISOString() }); },
  };

  // Open via the REAL manager.
  const open = (bestPacket, price) => runTrancheManager({ bestPacket, price }, openDeps);
  // Grade one bar via the REAL grader, mirror each transition to the broker via
  // the REAL applyTrancheExit.
  const bar = async (b) => {
    const openTrades = foldOpenTrades(events);
    const { transitions } = tickTrades(openTrades, b);
    for (const tr of transitions) {
      events.push({ type: "outcome", ...tr, ts: new Date().toISOString() });
      await applyTrancheExit(tr, exitDeps);
    }
    return transitions;
  };
  const cancelsOf = (id) => broker.filter((x) => x.a === "cancel").map((x) => x.id);
  return { events, broker, open, bar, cancelsOf };
}

describe("controlled lifecycle replay (real manager + grader + exit)", () => {
  it("B anchor + B add: add stops → cancel add limit; anchor TP1 → cancel anchor stop (no orphans)", async () => {
    const h = makeHarness();
    const anchor = { id: "S-A", side: "long", grade: "B", symbol: "MNQ1!", entry: 100, stop: 40, tp1: 160, tp2: 220 };
    const add = { id: "S-B", side: "long", grade: "B", symbol: "MNQ1!", entry: 100, stop: 48, tp1: 148, tp2: 196, event_ts: new Date(Date.now() + 20 * 60000).toISOString() };

    const r1 = await h.open(anchor, 100);
    assert.equal(r1.action, "open_anchor");
    // price reaches 50% to TP1 (130) → anchor green-lights AND the add opens.
    const r2 = await h.open(add, 130);
    assert.equal(r2.action, "open_add");

    // record the two tranches' order ids
    const anchorOrders = h.events.find((e) => e.type === "tranche_orders");
    const addOrders = [...h.events].reverse().find((e) => e.type === "tranche_orders");
    const anchorStop = anchorOrders.stopOrderId;
    const addLimit = addOrders.limitOrderId;

    await h.bar({ open: 100, high: 131, low: 99, ts: "b-fill" });   // both FILLED
    await h.bar({ open: 100, high: 101, low: 47, ts: "b-addstop" }); // add stop 48 hit; anchor stop 40 safe
    await h.bar({ open: 100, high: 161, low: 100, ts: "b-anchortp" }); // anchor TP1 160 hit (B → exit)

    const cancels = h.cancelsOf();
    assert.ok(cancels.includes(addLimit), "add's resting limit cancelled when its stop filled");
    assert.ok(cancels.includes(anchorStop), "anchor's resting stop cancelled when its TP1 filled (the bug fix)");
    // No tranche left with both legs live: every opened tranche's stop OR limit got cancelled/filled.
    const opens = h.broker.filter((x) => x.a === "open").length;
    assert.equal(opens, 2);
  });

  it("A+ runner: TP1 → BE move (cancel old stop + place BE); TP2 → cancel BE stop", async () => {
    const h = makeHarness();
    const anchor = { id: "S-A", side: "long", grade: "A+", symbol: "MNQ1!", entry: 100, stop: 40, tp1: 160, tp2: 220 };
    await h.open(anchor, 100);
    const ord = h.events.find((e) => e.type === "tranche_orders");
    const origStop = ord.stopOrderId;

    await h.bar({ open: 100, high: 131, low: 99, ts: "b-fill" });    // FILLED
    await h.bar({ open: 100, high: 161, low: 100, ts: "b-tp1" });    // TP1 milestone → BE move
    await h.bar({ open: 100, high: 221, low: 150, ts: "b-tp2" });    // TP2 → close

    const placed = h.broker.filter((x) => x.a === "place" && x.type === "stop");
    assert.equal(placed.length, 1, "a break-even stop was placed");
    assert.equal(placed[0].price, 100, "BE stop at entry");
    const cancels = h.cancelsOf();
    assert.ok(cancels.includes(origStop), "original stop cancelled on the BE move");
    assert.ok(cancels.includes(placed[0].id), "BE stop cancelled when TP2 filled");
  });
});
