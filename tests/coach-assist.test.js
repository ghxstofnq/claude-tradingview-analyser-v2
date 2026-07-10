// Unit tests for the on-demand coach narrator driver (app/main/coach-assist.js).
// Proves: the deterministic-context builder, the coach.md file assembler, the
// `## COACH` marker-slice reuse, the in-flight guard, and every generateCoach
// path — success persists, failure/auth/timeout writes NO file and returns a
// structured error, and the turn is contained (never a surface/trade tool).

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const mod = await import("../app/main/coach-assist.js");
const {
  buildCoachContext, buildCoachFile, coachFilePath, readCoachRaw,
  createInFlightGate, generateCoach, COACH_DEFAULT_SESSIONS,
} = mod;

// A turn stub that streams `chunks` (array of strings), then optionally an
// error event, then completes. Captures the args it was called with.
function makeTurn({ chunks = [], error = null, provider = "claude" } = {}) {
  const calls = [];
  const turn = async (opts) => {
    calls.push(opts);
    for (const c of chunks) opts.onEvent?.({ type: "chunk", text: c, provider });
    if (error) opts.onEvent?.({ type: "error", ...error });
  };
  turn.calls = calls;
  return turn;
}

function baseDeps(overrides = {}) {
  const metrics = [];
  const persisted = [];
  return {
    journals: [{ date: "2026-07-10", session: "ny-am", brief: { pillar_grade: "B" }, stats: { wins: 1, losses: 0, net_r: 2 }, setups: [], trades: [], fills: [], intents: [] }],
    reset: () => {},
    metric: (m) => metrics.push(m),
    isAuthBlocked: () => false,
    persist: async (contents) => { persisted.push(contents); return "/tmp/coach.md"; },
    now: () => "2026-07-10T20:00:00.000Z",
    gate: createInFlightGate(),
    _metrics: metrics,
    _persisted: persisted,
    ...overrides,
  };
}

describe("buildCoachContext", () => {
  test("embeds the digest JSON, the number discipline, and the ## COACH marker", () => {
    const digest = { n_sessions: 3, aggregate: { cum_r: 2.5 } };
    const txt = buildCoachContext(digest);
    assert.match(txt, /"n_sessions": 3/);
    assert.match(txt, /must not produce any number/i);
    assert.match(txt, /Retrospective only/i);
    assert.match(txt, /\n## COACH$/);
  });
});

describe("buildCoachFile", () => {
  test("frontmatter carries ts / provider / digest_hash + body", () => {
    const out = buildCoachFile({ text: "Equity building.", provider: "claude", digest_hash: "abcd1234", ts: "2026-07-10T20:00:00.000Z" });
    assert.match(out, /^---\n/);
    assert.match(out, /ts: 2026-07-10T20:00:00.000Z/);
    assert.match(out, /provider: claude/);
    assert.match(out, /digest_hash: abcd1234/);
    assert.match(out, /\nEquity building\.\n/);
  });
  test("empty body → null (no file)", () => {
    assert.equal(buildCoachFile({ text: "   " }), null);
    assert.equal(buildCoachFile({ text: "" }), null);
    assert.equal(buildCoachFile({ text: null }), null);
  });
  test("defaults provider + ts when absent", () => {
    const out = buildCoachFile({ text: "x", digest_hash: "h" });
    assert.match(out, /provider: claude/);
    assert.match(out, /ts: .+/);
  });
});

describe("createInFlightGate", () => {
  test("single-slot: second acquire fails until release", () => {
    const g = createInFlightGate();
    assert.equal(g.busy(), false);
    assert.equal(g.tryAcquire(), true);
    assert.equal(g.busy(), true);
    assert.equal(g.tryAcquire(), false); // already held
    g.release();
    assert.equal(g.busy(), false);
    assert.equal(g.tryAcquire(), true);  // reusable
  });
});

describe("generateCoach — success", () => {
  test("persists coach.md and returns coach + digest_hash", async () => {
    const deps = baseDeps({ turn: makeTurn({ chunks: ["thinking...\n\n## COACH\n\nEquity is building on clean B days."] }) });
    const res = await generateCoach(deps);
    assert.equal(res.ok, true);
    assert.match(res.coach, /Equity is building on clean B days\./);
    assert.match(res.coach, /digest_hash: [0-9a-f]{8}/);
    assert.equal(deps._persisted.length, 1);
    // metric lifecycle: started + succeeded
    assert.ok(deps._metrics.some((m) => m.kind === "coach" && m.event === "started"));
    assert.ok(deps._metrics.some((m) => m.kind === "coach" && m.event === "succeeded"));
    // the turn ran with purpose "coach"
    assert.equal(deps.turn.calls[0].purpose, "coach");
    // fresh-session reset called for coach
    // (reset is a no-op stub; assert it was wired by using a spy)
  });

  test("resetSession('coach') fires before the turn (fresh session)", async () => {
    const resets = [];
    const deps = baseDeps({ reset: (p) => resets.push(p), turn: makeTurn({ chunks: ["## COACH\n\nread."] }) });
    await generateCoach(deps);
    assert.deepEqual(resets, ["coach"]);
  });

  test("gate is released after success (reusable)", async () => {
    const gate = createInFlightGate();
    const deps = baseDeps({ gate, turn: makeTurn({ chunks: ["## COACH\n\nread."] }) });
    await generateCoach(deps);
    assert.equal(gate.busy(), false);
  });
});

describe("generateCoach — failure paths write NO file", () => {
  test("no ## COACH marker → ok:false, no persist", async () => {
    const deps = baseDeps({ turn: makeTurn({ chunks: ["some prose without the heading"] }) });
    const res = await generateCoach(deps);
    assert.equal(res.ok, false);
    assert.equal(deps._persisted.length, 0);
    assert.ok(deps._metrics.some((m) => m.event === "failed"));
  });

  test("errored turn → ok:false, no persist, metric failed", async () => {
    const deps = baseDeps({ turn: makeTurn({ chunks: ["## COACH\n\nignored"], error: { message: "boom" } }) });
    const res = await generateCoach(deps);
    assert.equal(res.ok, false);
    assert.equal(res.error, "boom");
    assert.equal(deps._persisted.length, 0);
  });

  test("timeout → ok:false, metric timeout", async () => {
    const deps = baseDeps({ turn: makeTurn({ chunks: [], error: { kind: "timeout", message: "timed out" } }) });
    const res = await generateCoach(deps);
    assert.equal(res.ok, false);
    assert.ok(deps._metrics.some((m) => m.event === "timeout"));
  });

  test("auth blocked → skipped, turn never runs, no file", async () => {
    const turn = makeTurn({ chunks: ["## COACH\n\nx"] });
    const deps = baseDeps({ isAuthBlocked: () => true, turn });
    const res = await generateCoach(deps);
    assert.equal(res.ok, false);
    assert.equal(res.skipped, true);
    assert.equal(turn.calls.length, 0);
    assert.equal(deps._persisted.length, 0);
    assert.ok(deps._metrics.some((m) => m.event === "skipped" && m.reason === "claude_auth_blocked"));
  });

  test("persist throws → ok:false with a write error, metric failed", async () => {
    const deps = baseDeps({
      turn: makeTurn({ chunks: ["## COACH\n\nread."] }),
      persist: async () => { throw new Error("disk full"); },
    });
    const res = await generateCoach(deps);
    assert.equal(res.ok, false);
    assert.match(res.error, /disk full/);
    assert.ok(deps._metrics.some((m) => m.event === "failed" && /write:/.test(String(m.reason))));
  });
});

describe("generateCoach — in-flight guard", () => {
  test("a re-entrant call while the gate is held is rejected without firing a turn", async () => {
    const gate = createInFlightGate();
    gate.tryAcquire(); // simulate a turn already running
    const turn = makeTurn({ chunks: ["## COACH\n\nx"] });
    const res = await generateCoach(baseDeps({ gate, turn }));
    assert.equal(res.ok, false);
    assert.equal(res.inFlight, true);
    assert.equal(turn.calls.length, 0); // never fired a second turn
    assert.equal(gate.busy(), true);    // the original holder still owns the lock
  });
});

describe("generateCoach — defaults", () => {
  test("COACH_DEFAULT_SESSIONS is a positive integer", () => {
    assert.ok(Number.isInteger(COACH_DEFAULT_SESSIONS) && COACH_DEFAULT_SESSIONS > 0);
  });
});

describe("coachFilePath + readCoachRaw honor GOFNQ_STATE_DIR", () => {
  let dir;
  let prev;
  beforeEach(() => {
    prev = process.env.GOFNQ_STATE_DIR;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-test-"));
    process.env.GOFNQ_STATE_DIR = dir;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.GOFNQ_STATE_DIR;
    else process.env.GOFNQ_STATE_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("path resolves under state/review and read is a write-read roundtrip", async () => {
    const p = coachFilePath();
    assert.equal(p, path.join(dir, "review", "coach.md"));
    assert.equal(await readCoachRaw(), null); // absent → null
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "---\nprovider: claude\n---\n\nread body");
    assert.match(await readCoachRaw(), /read body/);
  });

  test("empty file → null", async () => {
    const p = coachFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "   \n");
    assert.equal(await readCoachRaw(), null);
  });
});
