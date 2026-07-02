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
  clearTurnAuditState,
  surfaceSetup,
  surfaceSessionBrief,
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

describe("owner-purpose guard (C26/C27 belt-and-braces)", () => {
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

describe("surface_setup fails closed (C27)", () => {
  it("a chat turn cannot mint a setup (owner guard fires before any IO)", async () => {
    setCurrentTurnPurpose("chat");
    await assert.rejects(surfaceSetup({ grade: "B", side: "long", entry: 1, stop: 0.5, tp1: 2 }), /not callable from a 'chat' turn/);
    setCurrentTurnPurpose(null);
  });
  it("even on a bar-close turn, no armed packet → rejected (not silently accepted)", async () => {
    setCurrentTurnPurpose("bar-close");
    clearTurnAuditState(); // no packet armed
    await assert.rejects(surfaceSetup({ grade: "B", side: "long", entry: 1, stop: 0.5, tp1: 2 }), /deterministic packet/i);
    setCurrentTurnPurpose(null);
  });
  it("a chat turn cannot author a session brief", async () => {
    setCurrentTurnPurpose("chat");
    await assert.rejects(surfaceSessionBrief({ symbol: "MNQ1!" }), /not callable from a 'chat' turn/);
    setCurrentTurnPurpose(null);
  });
});
