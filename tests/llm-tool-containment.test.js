// Regression for audit C26/C27: the walker chain is the only setup producer.
// LLM turns must be scoped so a confused/injected turn cannot author state it
// isn't the owner of, enforced in CODE (not just prompt text).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TOOLS_BY_PURPOSE, buildAllowedToolNames } from "../app/main/sdk.js";
import {
  assertOwnerPurpose,
  setCurrentTurnPurpose,
  setCurrentDeterministicPacket,
  surfaceSetup,
} from "../app/main/tools/surface.js";

describe("per-purpose tool allow-list (C26)", () => {
  it("only the live-chain purposes expose surface_setup / surface_no_trade", () => {
    for (const [purpose, tools] of Object.entries(TOOLS_BY_PURPOSE)) {
      const hasSetup = tools.includes("surface_setup") || tools.includes("surface_no_trade");
      if (purpose === "bar-close" || purpose === "catch-up") assert.ok(hasSetup, `${purpose} should have setup tools`);
      else assert.ok(!hasSetup, `${purpose} must NOT expose setup tools`);
    }
  });
  it("chat and review cannot author any surface_* state", () => {
    for (const p of ["chat", "review"]) {
      assert.ok(!TOOLS_BY_PURPOSE[p].some((t) => t.startsWith("surface_")), `${p} must expose no surface_* tool`);
    }
  });
  it("brief owns only surface_session_brief; wrap owns only surface_session_summary", () => {
    assert.ok(TOOLS_BY_PURPOSE.brief.includes("surface_session_brief"));
    assert.ok(!TOOLS_BY_PURPOSE.brief.includes("surface_session_summary"));
    assert.deepEqual(TOOLS_BY_PURPOSE.wrap.filter((t) => t.startsWith("surface_")), ["surface_session_summary"]);
  });
  it("an unknown purpose gets no state-authoring tools (fail-safe)", () => {
    const allowed = buildAllowedToolNames("some-new-unmapped-purpose");
    assert.ok(!allowed.some((t) => t.includes("surface_")), "unmapped purpose must not reach a surface tool");
  });
});

// The owner-guard is invoked by the SDK MCP tool handlers (which run inside the
// LLM turn), NOT inside the surface functions — so the deterministic chain's
// direct JS calls never touch a purpose global a concurrent turn could mutate.
describe("owner-purpose guard (C26 belt-and-braces, handler-layer)", () => {
  it("a null purpose (direct JS chain call) is always allowed", () => {
    setCurrentTurnPurpose(null);
    assert.doesNotThrow(() => assertOwnerPurpose("surface_setup"));
  });
  it("a non-owner purpose is rejected", () => {
    setCurrentTurnPurpose("chat");
    assert.throws(() => assertOwnerPurpose("surface_setup"), /not callable from a 'chat' turn/);
    setCurrentTurnPurpose("wrap");
    assert.throws(() => assertOwnerPurpose("surface_session_brief"), /not callable from a 'wrap' turn/);
    setCurrentTurnPurpose(null);
  });
  it("the owner purpose passes the guard", () => {
    setCurrentTurnPurpose("bar-close");
    assert.doesNotThrow(() => assertOwnerPurpose("surface_setup"));
    setCurrentTurnPurpose("brief");
    assert.doesNotThrow(() => assertOwnerPurpose("surface_session_brief"));
    setCurrentTurnPurpose(null);
  });
});

describe("surface_setup fails closed on the packet (C27)", () => {
  it("no armed packet → rejected (not silently accepted), regardless of purpose", async () => {
    setCurrentDeterministicPacket(null); // no packet armed
    await assert.rejects(surfaceSetup({ grade: "B", side: "long", entry: 1, stop: 0.5, tp1: 2 }), /deterministic packet/i);
  });
});

// The parity-protection regression the review demanded: the surface functions
// must NOT read a purpose global, so the deterministic chain's direct call
// still succeeds even while a concurrent non-owner LLM turn has set its purpose.
// (Before the fix, an in-function owner-guard threw here and dropped the setup —
// a live-only failure the backtest never sees = a parity break.)
describe("chain direct call is not blocked by a concurrent turn's purpose (parity)", () => {
  it("surfaceSetup with a matching armed packet succeeds while purpose='chat'", async () => {
    const packet = {
      status: "executable", finalVerdict: "manual_candidate",
      model: "MSS", side: "long", grade: "B",
      entry: { price: 21000 }, stop: { price: 20990 }, tp1: { price: 21050 },
    };
    setCurrentDeterministicPacket(packet);
    setCurrentTurnPurpose("chat"); // a concurrent chat turn set this
    const payload = { model: "MSS", side: "long", grade: "B", entry: 21000, stop: 20990, tp1: 21050 };
    // Must NOT throw an owner error — the chain call bypasses the guard entirely.
    await assert.doesNotReject(surfaceSetup(payload));
    setCurrentTurnPurpose(null);
    setCurrentDeterministicPacket(null);
  });
});
