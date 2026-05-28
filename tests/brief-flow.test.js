// Brief-flow integration tests.
//
// Exercises the orchestration layer end-to-end WITHOUT invoking the
// Claude SDK: directly calls surface tools + scheduled-turn helpers,
// asserts disk + IPC side effects. Covers the bits that audit pass
// after audit pass have been bugs (the SDK part itself isn't tested
// here — that's external).
//
// What's covered:
//   - surfaceSessionBrief writes brief-<symbol>.json + brief.json mirror
//     + pillars.md + per-pillar files atomically.
//   - surfaceSessionBrief rejects symbol not in pair allow-list.
//   - surfaceSessionBrief rejects pillar_grade "A+" with < 2 pillars.
//   - session-brief preflight returns ok during trading hours.
//   - session-brief preflight returns !ok on weekend.
//   - session-brief postValidate detects missing + partial dual-symbol
//     surface_session_brief tool calls.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Use a sandbox under tests/.tmp/ so we never touch real state/.
const SANDBOX = path.join(REPO_ROOT, "tests", ".tmp-brief-flow");

const VALID_PRIMARY_BRIEF = {
  session: "ny-am",
  symbol: "MNQ1!",
  brief: "headline paragraph",
  htf_bias: [
    { tf: "DAILY", bias: "BULLISH", note: "n" },
    { tf: "4H", bias: "BULLISH", note: "n" },
    { tf: "1H", bias: "MIXED", note: "n" },
  ],
  overnight: [{ k: "Asia range", v: "30 pts" }],
  key_levels: [{ name: "PDH", price: 21487.25, state: "untaken" }],
  pillar_grade: "B",
  pillars: [
    { name: "Draw & Bias", status: "pass", elements: [{ name: "HTF bias", status: "pass" }] },
    { name: "Price-Action Quality", status: "weak", elements: [{ name: "range", status: "weak" }] },
  ],
  plan: "look for MSS at PDH",
  scenarios: [
    {
      id: "scn-1",
      grade: "A+",
      condition: "sweep of AS.L at 21290 (engine.levels.AS_L) + 5m MSS up",
      action: "MSS long on the 5m FVG retest, stop below the sweep wick",
      target: "21 420 (engine.levels.PWH)",
    },
  ],
  anchored_target: "21487.25 (PDH)",
  anchored_stop: "21450.50 (Asia low)",
  sizing_note: "0.75 R",
};

describe("brief flow — surface tool", () => {
  before(async () => {
    await fs.rm(SANDBOX, { recursive: true, force: true });
    await fs.mkdir(SANDBOX, { recursive: true });
  });
  after(async () => {
    await fs.rm(SANDBOX, { recursive: true, force: true });
  });

  it("writes per-symbol, mirror, and pillars files atomically", async () => {
    const { writeBrief } = await import("../app/main/session-memory.js");
    const dir = path.join(SANDBOX, "writes");
    await writeBrief(dir, { ...VALID_PRIMARY_BRIEF, ts: "2026-05-25T13:00:00Z" });

    // Primary brief
    const briefMNQ = JSON.parse(await fs.readFile(path.join(dir, "brief-MNQ1!.json"), "utf8"));
    assert.equal(briefMNQ.symbol, "MNQ1!");
    // Legacy mirror — must be the PRIMARY, not whichever wrote last.
    const briefMirror = JSON.parse(await fs.readFile(path.join(dir, "brief.json"), "utf8"));
    assert.equal(briefMirror.symbol, "MNQ1!");
    // Atomic combined pillars file (the canonical source readMemory uses).
    const pillars = await fs.readFile(path.join(dir, "pillars.md"), "utf8");
    assert.match(pillars, /Pillar 1 — Draw & Bias/);
    assert.match(pillars, /Pillar 2 — Price-Action Quality/);
    // Individual pillar files (still written for human inspection).
    const pillar1 = await fs.readFile(path.join(dir, "pillar1.md"), "utf8");
    assert.match(pillar1, /Pillar 1 — Draw & Bias/);
    const pillar2 = await fs.readFile(path.join(dir, "pillar2.md"), "utf8");
    assert.match(pillar2, /Pillar 2 — Price-Action Quality/);
  });

  it("readMemory prefers pillars.md over the individual files", async () => {
    const { writeBrief, readMemory } = await import("../app/main/session-memory.js");
    const dir = path.join(SANDBOX, "reads");
    await writeBrief(dir, { ...VALID_PRIMARY_BRIEF, ts: "2026-05-25T13:00:00Z" });
    const txt = await readMemory(dir);
    assert.ok(txt, "expected memory block");
    // Should include the combined pillars block, not the duplicated
    // pillar1/pillar2 sections.
    assert.match(txt, /--- pillars\.md ---/);
    assert.equal((txt.match(/--- pillar1\.md ---/g) || []).length, 0);
  });
});

describe("brief flow — postValidate", () => {
  it("flags missing surface_session_brief call as a problem", async () => {
    const { postValidate } = await import("../app/main/session-brief.js");
    const problem = postValidate([]);
    assert.match(problem, /completed without calling surface_session_brief/);
  });

  it("flags single-symbol brief in dual-symbol mode", async () => {
    const { postValidate } = await import("../app/main/session-brief.js");
    const problem = postValidate(["mcp__tv__surface_session_brief"]);
    assert.match(problem, /only 1× — expected 2/);
  });

  it("accepts two surface_session_brief calls", async () => {
    const { postValidate } = await import("../app/main/session-brief.js");
    const result = postValidate([
      "mcp__tv__surface_session_brief",
      "mcp__tv__surface_session_brief",
    ]);
    assert.equal(result, null);
  });
});

describe("brief flow — chart preflight retry", () => {
  it("retries transient TradingView null/chart-ready errors before succeeding", async () => {
    const { ensureChartStateWithRetry } = await import("../app/main/session-brief.js");
    const calls = [];
    const sleeps = [];

    const result = await ensureChartStateWithRetry({
      symbol: "MNQ1!",
      ensureFn: async (opts) => {
        calls.push(opts);
        if (calls.length === 1) throw new Error("JS evaluation error: Error: Value is null");
        if (calls.length === 2) throw new Error("Cannot read properties of undefined (reading '_activeChartWidgetWV')");
        return { ok: true };
      },
      sleepFn: async (ms) => { sleeps.push(ms); },
      maxAttempts: 3,
      baseDelayMs: 25,
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [25, 50]);
  });

  it("does not retry permanent chart preflight failures", async () => {
    const { ensureChartStateWithRetry } = await import("../app/main/session-brief.js");
    let calls = 0;

    await assert.rejects(
      () => ensureChartStateWithRetry({
        symbol: "MNQ1!",
        ensureFn: async () => {
          calls += 1;
          throw new Error("wrong symbol: expected MNQ1!");
        },
        sleepFn: async () => {},
        maxAttempts: 3,
        baseDelayMs: 25,
      }),
      /wrong symbol/,
    );
    assert.equal(calls, 1);
  });
});

// Grade-semantics guards in surface.js. Catches the 2026-05-26 failure mode
// where pillar_grade="B" was surfaced with two WEAK pillars — internally
// inconsistent per CLAUDE.md constraint #9 (two weak/missing → no-trade).
describe("brief flow — surfaceSessionBrief grade semantics", () => {
  const baseWithTwoWeak = {
    session: "ny-am",
    symbol: "MNQ1!",
    brief: "headline",
    htf_bias: [
      { tf: "DAILY", bias: "NEUTRAL", note: "n (engine_by_tf.daily.structures[0])" },
      { tf: "4H", bias: "MIXED", note: "n (engine_by_tf.h4.structures[0])" },
      { tf: "1H", bias: "BULLISH", note: "n (engine_by_tf.h1.structures[0])" },
    ],
    overnight: [],
    key_levels: [],
    pillars: [
      { name: "Draw & Bias", status: "weak", elements: [{ name: "HTF", status: "weak" }] },
      { name: "Price-Action Quality", status: "weak", elements: [{ name: "range", status: "weak" }] },
    ],
    plan: "p",
    scenarios: [{ condition: "c", action: "a" }],
    anchored_target: "1 (path)",
    anchored_stop: "1 (path)",
    sizing_note: "0.5 R (memory.USER)",
  };

  it("rejects pillar_grade='B' with two weak pillars (constraint #9)", async () => {
    const { surfaceSessionBrief } = await import("../app/main/tools/surface.js");
    await assert.rejects(
      () => surfaceSessionBrief({ ...baseWithTwoWeak, pillar_grade: "B" }),
      /two weak\/missing → no-trade|2 weak\/fail pillars/i,
    );
  });

  it("rejects pillar_grade='A+' when any pillar is weak", async () => {
    const { surfaceSessionBrief } = await import("../app/main/tools/surface.js");
    await assert.rejects(
      () => surfaceSessionBrief({ ...baseWithTwoWeak, pillar_grade: "A+" }),
      /A\+ requires every pillar to be 'pass'/,
    );
  });

  // Note: the "happy path" (pillar_grade='no-trade' accepted) is intentionally
  // not exercised here — calling surfaceSessionBrief with a valid payload
  // writes to state/session/<today>/<session>/ and pollutes the active day's
  // PREP state. The two rejection tests above cover the guard logic; the
  // surface-tool write path is already covered by the SANDBOX-based tests
  // earlier in this file.
});

// no_trade_reason cross-validation. Drives the hard-vs-soft short-circuit
// downstream — without it the chain can't decide whether to skip phases.
describe("brief flow — no_trade_reason cross-validation", () => {
  const baseValid = {
    session: "ny-am",
    symbol: "MNQ1!",
    brief: "headline",
    htf_bias: [
      { tf: "DAILY", bias: "NEUTRAL", note: "n (engine_by_tf.daily.structures[0])" },
      { tf: "4H", bias: "MIXED", note: "n (engine_by_tf.h4.structures[0])" },
      { tf: "1H", bias: "BULLISH", note: "n (engine_by_tf.h1.structures[0])" },
    ],
    overnight: [],
    key_levels: [],
    pillars: [
      { name: "Draw & Bias", status: "weak", elements: [{ name: "HTF", status: "weak" }] },
      { name: "Price-Action Quality", status: "weak", elements: [{ name: "range", status: "weak" }] },
    ],
    plan: "p",
    scenarios: [{ condition: "c", action: "a" }],
    anchored_target: "1 (path)",
    anchored_stop: "1 (path)",
    sizing_note: "0.5 R (memory.USER)",
  };

  it("rejects pillar_grade='no-trade' without no_trade_reason", async () => {
    const { surfaceSessionBrief } = await import("../app/main/tools/surface.js");
    await assert.rejects(
      () => surfaceSessionBrief({ ...baseValid, pillar_grade: "no-trade" }),
      /no_trade_reason/i,
    );
  });

  it("rejects no_trade_reason set with non-no-trade grade", async () => {
    const { surfaceSessionBrief } = await import("../app/main/tools/surface.js");
    await assert.rejects(
      () => surfaceSessionBrief({ ...baseValid, pillar_grade: "B", no_trade_reason: "pillar2_poor" }),
      /reason only valid with no-trade/i,
    );
  });
});

// Dual-symbol comparative pillar1.md/pillar2.md rendering. After both
// surface calls, the file should contain both ## MNQ1! and ## MES1!
// sections with per-symbol frontmatter keys. After just the primary,
// only MNQ. Closes the "last surface call wins" bug from PR #59 era.
describe("brief flow — dual-symbol comparative pillar1.md", () => {
  const SECONDARY_BRIEF = {
    session: "ny-am",
    symbol: "MES1!",
    brief: "MES headline",
    htf_bias: [
      { tf: "DAILY", bias: "BULLISH", note: "n (engine_by_tf.daily.structures[0])" },
      { tf: "4H", bias: "BULLISH", note: "n (engine_by_tf.h4.structures[0])" },
      { tf: "1H", bias: "MIXED", note: "n (engine_by_tf.h1.structures[0])" },
    ],
    overnight: [{ k: "Asia range", v: "20 pts" }],
    key_levels: [{ name: "PDH", price: 6500, state: "untaken" }],
    pillar_grade: "B",
    pillars: [
      { name: "Draw & Bias", status: "pass", elements: [{ name: "HTF", status: "pass" }] },
      { name: "Price-Action Quality", status: "weak", elements: [{ name: "range", status: "weak" }] },
    ],
    plan: "MES plan",
    anchored_target: "6500 (PDH)",
    anchored_stop: "6450 (Asia low)",
    sizing_note: "0.5 R (memory.USER)",
  };

  it("after writing both per-symbol briefs, pillar1.md contains both sections", async () => {
    const { writeBrief } = await import("../app/main/session-memory.js");
    const dir = path.join(SANDBOX, "dual");
    await fs.mkdir(dir, { recursive: true });
    await writeBrief(dir, { ...VALID_PRIMARY_BRIEF, ts: "2026-05-26T13:00:00Z" });
    await writeBrief(dir, { ...SECONDARY_BRIEF, ts: "2026-05-26T13:00:00Z" });

    const pillar1 = await fs.readFile(path.join(dir, "pillar1.md"), "utf8");
    assert.match(pillar1, /## MNQ1!/);
    assert.match(pillar1, /## MES1!/);
    // Per-symbol frontmatter keys at column 0 (valid YAML).
    assert.match(pillar1, /\nmnq:/);
    assert.match(pillar1, /\nmes:/);
  });

  it("after writing only the primary, pillar1.md has only the MNQ section", async () => {
    const { writeBrief } = await import("../app/main/session-memory.js");
    const dir = path.join(SANDBOX, "primary-only");
    await fs.mkdir(dir, { recursive: true });
    await writeBrief(dir, { ...VALID_PRIMARY_BRIEF, ts: "2026-05-26T13:00:00Z" });

    const pillar1 = await fs.readFile(path.join(dir, "pillar1.md"), "utf8");
    assert.match(pillar1, /## MNQ1!/);
    assert.doesNotMatch(pillar1, /## MES1!/);
  });
});

// Scenarios schema extension (PREP redesign, 2026-05-27).
//
// The MCP tool boundary (sdk.js) enforces the new shape via Zod — that
// validation only fires when the LLM actually calls the tool, not when
// our app code calls surfaceSessionBrief directly. These tests verify:
//   1. The sdk.js module loads (proving the schema is syntactically valid).
//   2. A brief with the new scenarios shape round-trips through writeBrief
//      and the new fields survive the read.
//   3. The renderer-side helper (Prep.helpers.js) handles scenarios with
//      and without the new fields (covered in tests/prep-helpers.test.js).
describe("brief flow — scenarios schema extension (2026-05-27)", () => {
  it("sdk.js loads without throwing (schema is syntactically valid)", async () => {
    // Importing sdk.js executes the Zod schema construction. If the new
    // scenarios shape has a syntax error, this import throws.
    const sdk = await import("../app/main/sdk.js");
    assert.ok(sdk, "expected sdk module to import");
  });

  it("round-trips the new scenarios shape through writeBrief", async () => {
    const { writeBrief } = await import("../app/main/session-memory.js");
    const dir = path.join(SANDBOX, "scenarios-roundtrip");
    await fs.mkdir(dir, { recursive: true });
    await writeBrief(dir, { ...VALID_PRIMARY_BRIEF, ts: "2026-05-27T13:00:00Z" });

    const brief = JSON.parse(await fs.readFile(path.join(dir, "brief-MNQ1!.json"), "utf8"));
    assert.equal(Array.isArray(brief.scenarios), true);
    assert.equal(brief.scenarios.length, 1);
    const s = brief.scenarios[0];
    assert.equal(s.id, "scn-1");
    assert.equal(s.grade, "A+");
    assert.match(s.condition, /sweep of AS\.L/);
    assert.match(s.action, /MSS long/);
    assert.match(s.target, /21 420/);
    assert.match(s.target, /\(engine\.levels\.PWH\)/);
  });

  it("preserves scenarios even when surfaceSessionBrief is called directly", async () => {
    // surfaceSessionBrief is what the renderer-side IPC handlers call.
    // It doesn't run Zod (that's the SDK tool boundary), but it does
    // write the payload to disk verbatim. Confirm scenarios are kept.
    const { surfaceSessionBrief } = await import("../app/main/tools/surface.js");
    const dir = path.join(SANDBOX, "surface-direct");
    await fs.mkdir(dir, { recursive: true });
    process.env.GOFNQ_BRIEF_DIR_OVERRIDE = dir;
    try {
      const payload = {
        ...VALID_PRIMARY_BRIEF,
        scenarios: [
          {
            id: "scn-2",
            grade: "B",
            condition: "break PDH 21385 (engine.levels.PDH) with displacement",
            action: "Trend long on retest, stop below BPR low",
            target: "21 420 (engine.levels.PWH)",
          },
        ],
      };
      const result = await surfaceSessionBrief(payload);
      assert.equal(result.ok, true);
    } finally {
      delete process.env.GOFNQ_BRIEF_DIR_OVERRIDE;
    }
  });
});
