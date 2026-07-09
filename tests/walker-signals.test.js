// tests/walker-signals.test.js
// Pure classification of walker/packet transitions into chime signals
// (app/renderer/src/shell/walkerSignals.helpers.js). Stage vocabulary mirrors
// app/main/strategy/walkers/walker-state.js.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyWalkerTransitions, describeSignal, signalEffects, BULK_MAX,
} from "../app/renderer/src/shell/walkerSignals.helpers.js";

const w = (id, stage, model = "MSS", side = "short") => ({ id, stage, model, side });
const kinds = (signals) => signals.map((s) => s.kind);

describe("classifyWalkerTransitions", () => {
  it("new active walker → walker_spawned; terminal newcomer is silent", () => {
    const out = classifyWalkerTransitions({
      prevWalkers: [],
      truth: { walkers: [w("a", "watching"), w("b", "expired")] },
    });
    assert.deepEqual(kinds(out), ["walker_spawned"]);
    assert.equal(out[0].walker.id, "a");
  });

  it("stage crossings raise tap / awaiting-confirm / confirmed", () => {
    const prev = [w("a", "pd_identified"), w("b", "tap_seen"), w("c", "confirmation_pending")];
    const next = { walkers: [w("a", "tap_seen"), w("b", "confirmation_pending"), w("c", "confirmed")] };
    assert.deepEqual(
      kinds(classifyWalkerTransitions({ prevWalkers: prev, truth: next })),
      ["confirmed", "awaiting_confirm", "zone_tapped"], // priority order
    );
  });

  it("same-candle jump raises ONE signal — the highest threshold crossed", () => {
    const out = classifyWalkerTransitions({
      prevWalkers: [w("a", "watching")],
      truth: { walkers: [w("a", "confirmed")] },
    });
    assert.deepEqual(kinds(out), ["confirmed"]);
  });

  it("blocked/expired walkers raise walker_died", () => {
    const out = classifyWalkerTransitions({
      prevWalkers: [w("a", "tap_seen"), w("b", "watching")],
      truth: { walkers: [w("a", "blocked"), w("b", "expired")] },
    });
    assert.deepEqual(kinds(out), ["walker_died", "walker_died"]);
  });

  it("spawn storms collapse to one bulk signal above BULK_MAX", () => {
    const many = Array.from({ length: BULK_MAX + 2 }, (_, i) => w(`s${i}`, "watching"));
    const out = classifyWalkerTransitions({ prevWalkers: [], truth: { walkers: many } });
    assert.deepEqual(kinds(out), ["walker_spawned_bulk"]);
    assert.equal(out[0].count, BULK_MAX + 2);
  });

  it("packet fires once on the rising edge, first in priority order", () => {
    const truth = {
      walkers: [w("a", "packet_ready")],
      bestPacket: { model: "Inversion", side: "short", grade: "B", entry: { price: 29691 }, stop: { price: 29811.75 }, tp1: { price: 29302.5 } },
      market: "MNQ1!",
    };
    const fresh = classifyWalkerTransitions({ prevWalkers: [w("a", "confirmed")], truth });
    assert.equal(fresh[0].kind, "packet_fired");
    assert.equal(fresh[0].packet.entry, 29691);
    const held = classifyWalkerTransitions({ prevWalkers: [w("a", "packet_ready")], truth, packetAlreadySignaled: true });
    assert.deepEqual(kinds(held), []); // persisting packet doesn't re-chime
  });

  it("no changes → no signals", () => {
    const prev = [w("a", "tap_seen")];
    assert.deepEqual(classifyWalkerTransitions({ prevWalkers: prev, truth: { walkers: prev } }), []);
  });

  it("crossing into packet_ready alone raises no stage signal (the packet IS the signal)", () => {
    const out = classifyWalkerTransitions({
      prevWalkers: [w("a", "confirmed")],
      truth: { walkers: [w("a", "packet_ready")] }, // bestPacket absent (e.g. gated)
    });
    assert.deepEqual(kinds(out), []);
  });
});

describe("describeSignal / signalEffects", () => {
  it("packet text carries the packet's exact numbers", () => {
    const text = describeSignal({
      kind: "packet_fired",
      packet: { market: "MNQ1!", model: "Inversion", side: "short", grade: "B", entry: 29691, stop: 29811.75, tp1: 29302.5 },
    });
    assert.match(text, /MNQ1! Inversion short B/);
    assert.match(text, /entry 29691 · stop 29811\.75 · tp1 29302\.5/);
  });

  it("only the packet notifies; only packet is loud", () => {
    assert.deepEqual(signalEffects({ kind: "packet_fired" }), { chime: "loud", notify: true, toast: true });
    assert.equal(signalEffects({ kind: "confirmed" }).notify, false);
    assert.equal(signalEffects({ kind: "walker_spawned" }).chime, "soft");
    assert.equal(signalEffects({ kind: "unknown" }).chime, null);
  });
});
