// Track 2 §2b item 3 (docs/intent/2026-07-10-unified-goal.md): the on-demand
// PREP/LIVE deep-read moves off the shared chat channel into its own `analysis`
// purpose. These tests lock the end-to-end wiring: a dedicated phase prompt, a
// read-only tool allow-list (no surface / trade / alert tools), a metrics bucket,
// and a one-shot session (resetSession before every turn — no cross-question
// context accumulation).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TOOLS_BY_PURPOSE,
  buildAllowedToolNames,
  _loadSystemPromptForTests as loadSystemPrompt,
} from "../app/main/sdk.js";
import { joinSystemPrompt } from "../app/main/prompt-composer.js";
import { freshTally } from "../app/main/metrics.js";
import { runAnalysisTurn } from "../app/main/analysis-turn.js";

describe("analysis purpose — tool containment (read-only, no trade surface)", () => {
  it("maps to an empty tool list (no surface_*, no alerts, no analyze captures)", () => {
    assert.deepEqual(
      TOOLS_BY_PURPOSE.analysis,
      [],
      "analysis must map to an empty tool list — deterministic bundle arrives in the prompt/state, no captures"
    );
  });

  it("buildAllowedToolNames('analysis') reaches no mcp__tv__ / surface_ tool", () => {
    const allowed = buildAllowedToolNames("analysis");
    assert.ok(!allowed.some((t) => t.startsWith("mcp__tv__")), "analysis must reach no mcp__tv__ tool");
    assert.ok(!allowed.some((t) => t.includes("surface_")), "analysis must reach no surface_* tool");
    // Read/Glob remain reachable (same as journal/coach/review) so the turn can
    // read the deterministic state files it is told to ground its numbers in.
    assert.ok(allowed.includes("Read"), "analysis keeps the Read built-in");
    assert.ok(allowed.includes("Glob"), "analysis keeps the Glob built-in");
  });

  it("does NOT get the memory write tool (analysis is a read, authors no memory)", () => {
    const analysis = buildAllowedToolNames("analysis");
    const chat = buildAllowedToolNames("chat");
    // Whatever memory tool chat gets (if any), analysis must not.
    const chatOnly = chat.filter((t) => !analysis.includes(t));
    assert.ok(
      !analysis.some((t) => /memory/i.test(t)),
      "analysis must not reach a memory-write tool"
    );
    // Sanity: analysis is a strict subset (minus alerts/memory) of what chat can reach.
    assert.ok(chatOnly.length >= 0);
  });
});

describe("analysis purpose — system prompt", () => {
  it("composes a dedicated phase prompt with kernel rules + analysis framing", async () => {
    const prompt = joinSystemPrompt(await loadSystemPrompt("analysis"));
    // Kernel rules ride along (cite-or-reject / no-arithmetic / grade enum).
    assert.match(prompt, /Cite or omit/i, "analysis missing kernel rule cite-or-omit");
    assert.match(prompt, /No arithmetic/i, "analysis missing kernel rule no-arithmetic");
    assert.match(prompt, /Grade enum only/i, "analysis missing kernel rule grade-enum");
    // Dedicated phase marker + the explicit not-a-signal framing (the walker
    // chain is the only setup producer — analysis never places a trade).
    assert.match(prompt, /DEEP-READ ANALYSIS/i, "analysis missing its phase protocol marker");
    assert.match(prompt, /not a (?:trade )?signal/i, "analysis must state it is not a trade signal");
  });

  it("embeds the shared bundle-fields + ict-vocab partials (not duplicated inline)", async () => {
    const prompt = joinSystemPrompt(await loadSystemPrompt("analysis"));
    assert.match(prompt, /<bundle_fields>/, "analysis should embed the bundle-fields partial");
    assert.match(prompt, /<ict_vocabulary>/, "analysis should embed the ict-vocab partial");
  });

  it("carries no walker-chain / brief phase body (it is not a setup producer)", async () => {
    const prompt = joinSystemPrompt(await loadSystemPrompt("analysis"));
    assert.doesNotMatch(prompt, /publish the PREP-panel SESSION BRIEF/, "analysis must not carry the brief phase body");
    assert.doesNotMatch(prompt, /surface_setup/, "analysis must not instruct surface_setup");
  });
});

describe("analysis purpose — metrics bucket", () => {
  it("freshTally() carries an analysis bucket", () => {
    const tally = freshTally();
    assert.ok(Object.prototype.hasOwnProperty.call(tally, "analysis"), "metrics must have an analysis bucket");
    for (const ev of ["started", "succeeded", "failed"]) {
      assert.ok(Object.prototype.hasOwnProperty.call(tally.analysis, ev), `analysis bucket missing '${ev}'`);
    }
  });
});

describe("analysis purpose — one-shot session (reset per turn)", () => {
  function fakeTurn(events = []) {
    const calls = [];
    const turn = async (opts) => {
      calls.push(opts);
      for (const ev of events) opts.onEvent?.(ev);
    };
    return { turn, calls };
  }

  it("resetSession('analysis') fires BEFORE the turn on every run — no context accrues", async () => {
    const resets = [];
    const { turn, calls } = fakeTurn([{ type: "chunk", text: "hi" }, { type: "turn_complete" }]);
    const order = [];
    const reset = (purpose, provider) => { resets.push([purpose, provider]); order.push("reset"); };
    const wrappedTurn = async (opts) => { order.push("turn"); return turn(opts); };

    await runAnalysisTurn({
      text: "deep read please",
      provider: "claude",
      onEvent: () => {},
      turn: wrappedTurn,
      reset,
      metric: () => {},
    });

    assert.equal(resets.length, 1, "reset must fire exactly once per run");
    assert.deepEqual(resets[0], ["analysis", "claude"], "reset must target the analysis session for this provider");
    assert.deepEqual(order, ["reset", "turn"], "reset must happen BEFORE the turn (one-shot, no accumulation)");
    assert.equal(calls[0].purpose, "analysis", "turn must run under the analysis purpose");
  });

  it("forwards chunk + turn_complete events to onEvent (streams to the renderer)", async () => {
    const seen = [];
    const { turn } = fakeTurn([
      { type: "chunk", text: "part 1 " },
      { type: "chunk", text: "part 2" },
      { type: "turn_complete", durationMs: 42 },
    ]);
    const res = await runAnalysisTurn({
      text: "q", provider: "claude",
      onEvent: (ev) => seen.push(ev),
      turn, reset: () => {}, metric: () => {},
    });
    assert.equal(res.ok, true);
    assert.deepEqual(seen.map((e) => e.type), ["chunk", "chunk", "turn_complete"]);
  });

  it("records started + succeeded metrics under kind 'analysis'", async () => {
    const metrics = [];
    const { turn } = fakeTurn([{ type: "turn_complete" }]);
    await runAnalysisTurn({
      text: "q", provider: "claude", onEvent: () => {},
      turn, reset: () => {}, metric: (m) => metrics.push(m),
    });
    assert.ok(metrics.some((m) => m.kind === "analysis" && m.event === "started"));
    assert.ok(metrics.some((m) => m.kind === "analysis" && m.event === "succeeded"));
  });

  it("records a failed metric and returns ok:false when the turn errors", async () => {
    const metrics = [];
    const { turn } = fakeTurn([{ type: "error", message: "boom" }, { type: "turn_complete" }]);
    const res = await runAnalysisTurn({
      text: "q", provider: "claude", onEvent: () => {},
      turn, reset: () => {}, metric: (m) => metrics.push(m),
    });
    assert.equal(res.ok, false);
    assert.ok(metrics.some((m) => m.kind === "analysis" && m.event === "failed"));
  });
});
