// Renderer-side helpers for the dedicated `analysis` purpose (Track 2 §2b item 3).
// Two pure functions extracted for node --test coverage (the renderer has no
// Vitest): the on-demand prompt builder (useAiAnalysis) and the channel-routing
// predicate that keeps analysis turns OUT of the CLAUDE/BRAIN feed (useChat).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildAnalysisPrompt } from "../app/renderer/src/hooks/useAiAnalysis.js";
import { isDedicatedChannelPurpose, isNarrationPurpose } from "../app/renderer/src/hooks/useChat.js";

describe("buildAnalysisPrompt", () => {
  it("builds the three-component pre-open read from symbol/session/brief", () => {
    const p = buildAnalysisPrompt({ symbol: "MNQ1!", session: "ny-am", brief: { pillar_grade: "B" } });
    assert.match(p, /MNQ1!/, "names the symbol");
    assert.match(p, /NY-AM/, "upper-cases the session");
    assert.match(p, /three components/i, "walks Lanto's three components");
    assert.match(p, /grade is B/, "threads the deterministic pre-session grade");
  });

  it("falls back to placeholder copy when symbol/session/brief are missing", () => {
    const p = buildAnalysisPrompt({});
    assert.match(p, /lead symbol/i);
    assert.match(p, /upcoming session/i);
    assert.doesNotMatch(p, /grade is/, "omits the grade line when no grade is known");
  });

  it("returns customPrompt verbatim when provided (LIVE live-context path)", () => {
    const custom = "Read the current active setup and tell me if it still holds.";
    assert.equal(buildAnalysisPrompt({ symbol: "MNQ1!", customPrompt: custom }), custom);
  });
});

describe("isDedicatedChannelPurpose — keeps analysis OUT of the chat feed", () => {
  it("true for purposes that render via their own surface (chat + analysis)", () => {
    assert.equal(isDedicatedChannelPurpose("chat"), true);
    assert.equal(isDedicatedChannelPurpose("analysis"), true);
  });
  it("false for autonomous purposes that DO render activity rows in the feed", () => {
    for (const p of ["bar-close", "brief", "wrap", "review", "journal", "coach", undefined, null]) {
      assert.equal(isDedicatedChannelPurpose(p), false, `${p} must not be treated as a dedicated-channel purpose`);
    }
  });
});

describe("isNarrationPurpose — analysis never narrates into BRAIN", () => {
  it("false for analysis (its prose renders in PREP/LIVE, not the BRAIN feed)", () => {
    assert.equal(isNarrationPurpose("analysis"), false);
  });
});
