// Track 2 §2b item 5 (docs/intent/2026-07-10-unified-goal.md): the on-demand
// anomaly explainer runs under its own read-only `explain` purpose, isolated from
// the chat channel. These tests lock the end-to-end wiring: a dedicated phase
// prompt, an empty (read-only) tool allow-list (no surface / trade / alert /
// memory tools), a metrics bucket, a one-shot session (resetSession before every
// turn), the error→turn_complete guard on the reject path, and the main-side
// in-flight gate (one explanation at a time).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  TOOLS_BY_PURPOSE,
  buildAllowedToolNames,
  _loadSystemPromptForTests as loadSystemPrompt,
} from "../app/main/sdk.js";
import { joinSystemPrompt } from "../app/main/prompt-composer.js";
import { freshTally } from "../app/main/metrics.js";
import { runExplainTurn, isExplainInFlight } from "../app/main/explain-turn.js";
import { createInFlightGate } from "../app/main/coach-assist.js";

describe("explain purpose — tool containment (read-only, no trade surface)", () => {
  it("maps to an empty tool list (no surface_*, no alerts, no captures)", () => {
    assert.deepEqual(
      TOOLS_BY_PURPOSE.explain,
      [],
      "explain must map to an empty tool list — the anomaly/readiness/health context arrives in the prompt, no tools"
    );
  });

  it("buildAllowedToolNames('explain') reaches no mcp__tv__ / surface_ / memory tool", () => {
    const allowed = buildAllowedToolNames("explain");
    assert.ok(!allowed.some((t) => t.startsWith("mcp__tv__")), "explain must reach no mcp__tv__ tool");
    assert.ok(!allowed.some((t) => t.includes("surface_")), "explain must reach no surface_* tool");
    assert.ok(!allowed.some((t) => /memory/i.test(t)), "explain must reach no memory-write tool");
    // Read/Glob remain reachable (the default floor) — but the turn is told not to
    // read files; the context is fully in the prompt.
    assert.ok(allowed.includes("Read"), "explain keeps the Read built-in floor");
    assert.ok(allowed.includes("Glob"), "explain keeps the Glob built-in floor");
  });
});

describe("explain purpose — system prompt", () => {
  it("composes a dedicated phase prompt with kernel rules + explainer framing", async () => {
    const prompt = joinSystemPrompt(await loadSystemPrompt("explain"));
    // Kernel rules ride along.
    assert.match(prompt, /Cite or omit/i, "explain missing kernel rule cite-or-omit");
    assert.match(prompt, /No arithmetic/i, "explain missing kernel rule no-arithmetic");
    assert.match(prompt, /Grade enum only/i, "explain missing kernel rule grade-enum");
    // Dedicated phase marker + the explicit not-a-signal framing.
    assert.match(prompt, /ANOMALY EXPLAINER PROTOCOL/i, "explain missing its phase protocol marker");
    assert.match(prompt, /not a (?:trade )?signal/i, "explain must state it is not a trade signal");
    // Names real recovery verbs and forbids invented ones.
    assert.match(prompt, /retry reconcile/i, "explain must name the retry-reconcile recovery verb");
    assert.match(prompt, /restart detector/i, "explain must name the restart-detector recovery verb");
    assert.match(prompt, /invented/i, "explain must forbid invented controls");
  });

  it("carries no analysis/brief bundle body (it is an ops explainer, not a setup producer)", async () => {
    const prompt = joinSystemPrompt(await loadSystemPrompt("explain"));
    assert.doesNotMatch(prompt, /<bundle_fields>/, "explain must not carry the bundle-fields partial");
    assert.doesNotMatch(prompt, /surface_setup/, "explain must not instruct surface_setup");
    assert.doesNotMatch(prompt, /publish the PREP-panel SESSION BRIEF/, "explain must not carry the brief phase body");
  });
});

describe("explain purpose — metrics bucket", () => {
  it("freshTally() carries an explain bucket", () => {
    const tally = freshTally();
    assert.ok(Object.prototype.hasOwnProperty.call(tally, "explain"), "metrics must have an explain bucket");
    for (const ev of ["started", "succeeded", "failed", "timeout"]) {
      assert.ok(Object.prototype.hasOwnProperty.call(tally.explain, ev), `explain bucket missing '${ev}'`);
    }
  });
});

describe("explain purpose — one-shot session (reset per turn)", () => {
  function fakeTurn(events = []) {
    const calls = [];
    const turn = async (opts) => {
      calls.push(opts);
      for (const ev of events) opts.onEvent?.(ev);
    };
    return { turn, calls };
  }

  it("resetSession('explain') fires BEFORE the turn on every run — no context accrues", async () => {
    const order = [];
    const resets = [];
    const { turn, calls } = fakeTurn([{ type: "chunk", text: "hi" }, { type: "turn_complete" }]);
    const reset = (purpose, provider) => { resets.push([purpose, provider]); order.push("reset"); };
    const wrappedTurn = async (opts) => { order.push("turn"); return turn(opts); };

    await runExplainTurn({
      event: { kind: "app_error", message: "boom" },
      provider: "claude",
      onEvent: () => {},
      turn: wrappedTurn,
      reset,
      metric: () => {},
      gate: createInFlightGate(),
    });

    assert.equal(resets.length, 1, "reset must fire exactly once per run");
    assert.deepEqual(resets[0], ["explain", "claude"], "reset must target the explain session for this provider");
    assert.deepEqual(order, ["reset", "turn"], "reset must happen BEFORE the turn (one-shot)");
    assert.equal(calls[0].purpose, "explain", "turn must run under the explain purpose");
  });

  it("forwards chunk + turn_complete events to onEvent (streams to the renderer)", async () => {
    const seen = [];
    const { turn } = fakeTurn([
      { type: "chunk", text: "part 1 " },
      { type: "chunk", text: "part 2" },
      { type: "turn_complete", durationMs: 12 },
    ]);
    const res = await runExplainTurn({
      event: { kind: "readiness", message: "detector stale" },
      provider: "claude", onEvent: (ev) => seen.push(ev),
      turn, reset: () => {}, metric: () => {}, gate: createInFlightGate(),
    });
    assert.equal(res.ok, true);
    assert.deepEqual(seen.map((e) => e.type), ["chunk", "chunk", "turn_complete"]);
  });

  it("records started + succeeded metrics under kind 'explain'", async () => {
    const metrics = [];
    const { turn } = fakeTurn([{ type: "turn_complete" }]);
    await runExplainTurn({
      event: {}, provider: "claude", onEvent: () => {},
      turn, reset: () => {}, metric: (m) => metrics.push(m), gate: createInFlightGate(),
    });
    assert.ok(metrics.some((m) => m.kind === "explain" && m.event === "started"));
    assert.ok(metrics.some((m) => m.kind === "explain" && m.event === "succeeded"));
  });

  it("records a failed metric and returns ok:false when the turn errors", async () => {
    const metrics = [];
    const { turn } = fakeTurn([{ type: "error", message: "kaput" }, { type: "turn_complete" }]);
    const res = await runExplainTurn({
      event: {}, provider: "claude", onEvent: () => {},
      turn, reset: () => {}, metric: (m) => metrics.push(m), gate: createInFlightGate(),
    });
    assert.equal(res.ok, false);
    assert.ok(metrics.some((m) => m.kind === "explain" && m.event === "failed"));
  });

  it("when the turn itself rejects, emits error (provider-stamped) THEN turn_complete so RUNNING clears", async () => {
    const seen = [];
    const rejectingTurn = async () => { throw new Error("kaboom"); };
    const res = await runExplainTurn({
      event: {}, provider: "claude",
      onEvent: (ev) => seen.push(ev),
      turn: rejectingTurn, reset: () => {}, metric: () => {}, gate: createInFlightGate(),
    });
    assert.equal(res.ok, false);
    assert.deepEqual(seen.map((e) => e.type), ["error", "turn_complete"], "reject path must emit error then turn_complete");
    assert.equal(seen[0].provider, "claude", "reject-path error event must be provider-stamped");
  });

  it("NEVER throws: a serialize() throw returns ok:false + failed metric + error→turn_complete", async () => {
    // The documented contract is 'never throws' — a throw from serialize (or the
    // started metric / reset) must be caught the same way a rejecting turn is.
    const seen = [];
    const metrics = [];
    let turnFired = false;
    const res = await runExplainTurn({
      event: {}, provider: "claude",
      onEvent: (ev) => seen.push(ev),
      turn: async () => { turnFired = true; },        // must NOT be reached
      reset: () => {},
      metric: (m) => metrics.push(m),
      serialize: () => { throw new Error("serialize boom"); },
      gate: createInFlightGate(),
    });
    assert.equal(res.ok, false, "a serialize throw must return ok:false, not throw");
    assert.match(res.error, /serialize boom/);
    assert.equal(turnFired, false, "the turn must not fire when serialization throws");
    assert.deepEqual(seen.map((e) => e.type), ["error", "turn_complete"], "must emit error then turn_complete");
    assert.equal(seen[0].provider, "claude", "the error event must be provider-stamped");
    assert.ok(metrics.some((m) => m.kind === "explain" && m.event === "failed"), "a failed metric must be recorded");
  });

  it("NEVER throws: releases the in-flight gate even when serialize throws", async () => {
    const gate = createInFlightGate();
    await runExplainTurn({
      event: {}, onEvent: () => {}, turn: async () => {}, reset: () => {}, metric: () => {},
      serialize: () => { throw new Error("boom"); }, gate,
    });
    assert.equal(gate.busy(), false, "the gate must be released after a throwing run");
  });

  it("serializes the {event, readiness, health} into the turn text via the injected serializer", async () => {
    let seenText = null;
    const { turn } = fakeTurn([{ type: "turn_complete" }]);
    await runExplainTurn({
      event: { kind: "app_error", message: "X" },
      readiness: { rows: [{ id: "detector", status: "fail", reason: "stale", label: "Detector" }] },
      health: { loop: "down" },
      onEvent: () => {},
      turn: async (opts) => { seenText = opts.text; return turn(opts); },
      reset: () => {}, metric: () => {},
      serialize: ({ event, readiness, health }) => `E:${event.message}|R:${readiness.rows.length}|H:${health.loop}`,
      gate: createInFlightGate(),
    });
    assert.equal(seenText, "E:X|R:1|H:down", "turn text must come from the serializer over event+readiness+health");
  });
});

describe("explain purpose — in-flight gate (one explanation at a time)", () => {
  it("rejects a second run while one is in flight, and never fires a second turn", async () => {
    const gate = createInFlightGate();
    let started = 0;
    let release;
    const blockingTurn = async (opts) => {
      started += 1;
      await new Promise((r) => { release = r; }); // hold the turn open
      opts.onEvent?.({ type: "turn_complete" });
    };

    const first = runExplainTurn({
      event: {}, onEvent: () => {}, turn: blockingTurn, reset: () => {}, metric: () => {}, gate,
    });
    // Second call while the first is still running.
    const second = await runExplainTurn({
      event: {}, onEvent: () => {}, turn: blockingTurn, reset: () => {}, metric: () => {}, gate,
    });

    assert.equal(second.ok, false, "the second concurrent run must be rejected");
    assert.equal(second.inFlight, true, "the rejection must be flagged inFlight");
    assert.equal(started, 1, "only ONE turn may fire while the gate is held");

    release?.();
    await first; // let the first finish + release the gate

    // Once released, a fresh run proceeds.
    const third = await runExplainTurn({
      event: {}, onEvent: () => {}, turn: async (o) => o.onEvent?.({ type: "turn_complete" }),
      reset: () => {}, metric: () => {}, gate,
    });
    assert.equal(third.ok, true, "a run after release must proceed");
  });

  it("exposes the production in-flight probe (false when idle)", () => {
    assert.equal(isExplainInFlight(), false, "no explanation should be running at import time");
  });
});

describe("explain purpose — IPC routing (feedback-loop invariant)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ipcSrc = readFileSync(path.resolve(here, "../app/main/ipc.js"), "utf8");

  // Slice one ipcMain.handle(...) block by name, from its handle() to the next
  // handle() (or EOF) — so assertions target THAT handler, not the whole file.
  function handlerBlock(name) {
    const start = ipcSrc.indexOf(`ipcMain.handle("${name}"`);
    assert.ok(start >= 0, `ipc.js must register the ${name} handler`);
    const next = ipcSrc.indexOf("ipcMain.handle(", start + 1);
    return ipcSrc.slice(start, next === -1 ? undefined : next);
  }

  it("the explain:run handler maps turn error events to explain:error and NEVER to app:error", () => {
    const block = handlerBlock("explain:run");
    assert.match(block, /ev\.type === "error"[\s\S]*?send\("explain:error"/, "an error event must route to explain:error");
    assert.ok(!block.includes("app:error"), "the explain handler must NEVER route to app:error (would feed the anomaly list it renders in)");
    // it streams over the dedicated explain:* channel, nothing else.
    assert.ok(block.includes('send("explain:chunk"'), "chunks route to explain:chunk");
    assert.ok(block.includes('send("explain:turn_complete"'), "completion routes to explain:turn_complete");
  });

  it("discriminator: the adjacent analysis:run handler DOES route errors to app:error", () => {
    // Proves the test can detect app:error routing — explain deliberately differs.
    const block = handlerBlock("analysis:run");
    assert.ok(block.includes("app:error"), "analysis:run routes errors to app:error (the pattern explain intentionally breaks from)");
  });
});
