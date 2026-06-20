// Backtest engine — deterministic open-reaction leg (§2.3 / §7 Step 4).
//
// With a direct-brief (synthesized) context, the engine must fold the open
// window with an honest "unclear" LTF context, then resolve the open
// reaction from the engine's sweep rows at the minute-15 boundary and apply
// the resolved context to every later bar. Day-state contexts (the day ran
// live) are never overridden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpStateDir } from "./helpers/tmp-state.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { runBacktest, openReactionWindowMs } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";

const DATE = "2026-06-09";
const SESSION = "ny-am";

function isoAtEt(hhmm) {
  const { startMs } = openReactionWindowMs({ date: DATE, session: SESSION });
  const [h, m] = hhmm.split(":").map(Number);
  const offsetMin = (h - 9) * 60 + (m - 30);
  return new Date(startMs + offsetMin * 60_000).toISOString();
}

function entryAt(hhmm, { sweeps = [], close = 100 } = {}) {
  const ts = isoAtEt(hhmm);
  const closeSec = Date.parse(ts) / 1000;
  return {
    event: { ts, tf: "1m" },
    inputs: {
      bundle: {
        chart: { symbol: "MNQ1!" },
        quote: { symbol: "MNQ1!", last: 100, time: closeSec },
        bars: { last_5_bars: [{ time: closeSec - 60, open: 99, high: Math.max(101, close + 1), low: Math.min(98, close - 1), close }] },
        engine: {},
        gates: {
          engine: {
            pillar1: { sweeps },
            pillar3: { failure_swings: [], most_recent_structure: null, fvgs: [] },
          },
        },
      },
      leader: "MNQ1!",
      // recorder embeds the static context; the engine overrides in the fold
      ltf_bias_context: null,
      session_state: null,
      untaken_targets: null,
    },
  };
}

function sweepAt(hhmm, { target, rejected }) {
  return { target, price: 100, side: "x", swept_ms: Date.parse(isoAtEt(hhmm)), rejected };
}

function makeDeps({ entries, capture }) {
  return {
    recordEntries: async ({ context }) => {
      for (const e of entries) {
        e.inputs.ltf_bias_context = context.ltf_bias_context;
        e.inputs.session_state = context.session_state;
        e.inputs.untaken_targets = context.untaken_targets;
      }
      return { entries, warnings: [] };
    },
    loadDayContext: async () => null,
    runDirectBrief: async () =>
      contextFromBriefPayloads({
        session: SESSION,
        payloads: [{
          symbol: "MNQ1!",
          pillar_grade: "B",
          pillar2_verdict: "marginal",
          primary_draw: { tf: "h4", kind: "fvg", dir: "bear", top: 95, bottom: 90, ce: 92.5, cite: "engine_by_tf.h4.fvgs[0]" },
          overnight_block: { untaken_above: [], untaken_below: [{ name: "PDL", price: 90 }] },
        }],
      }),
    truthFn: async ({ inputs }) => {
      capture.push(JSON.parse(JSON.stringify(inputs.ltf_bias_context)));
      return { walkers: [], bestPacket: null, surfacePayload: null };
    },
    gradeFn: () => ({ outcome: "pending" }),
  };
}

async function run({ entries, capture }) {
  const dir = tmpStateDir("bt-or-");
  const bus = new EventEmitter();
  const result = await runBacktest({
    date: DATE, session: SESSION, mode: "auto",
    bus, stateDir: dir, deps: makeDeps({ entries, capture }),
  });
  return result;
}

// §7 Step 4 gives the open reaction "15–30 minutes": interactions count
// through minute 30 (endMs), the verdict first resolves at minute 15
// (resolveMs) and re-evaluates until minute 30. (June 11 ny-pm: the NYAM.H
// break printed at minute 29 — a legitimate open-reaction event the old
// 15-minute interaction window discarded.)
test("openReactionWindowMs: interactions span 30 minutes, resolution starts at 15", () => {
  const w = openReactionWindowMs({ date: DATE, session: SESSION });
  assert.equal(w.resolveMs - w.startMs, 15 * 60_000);
  assert.equal(w.endMs - w.startMs, 30 * 60_000);
});

test("direct-brief fold: unclear before the boundary, aligned after a rejection in draw direction", async () => {
  const rejection = sweepAt("09:43", { target: "LO.H", rejected: true });
  const entries = [
    entryAt("09:35"),
    entryAt("09:44", { sweeps: [rejection] }),
    entryAt("09:46", { sweeps: [rejection] }),
    entryAt("09:50", { sweeps: [rejection] }),
  ];
  const capture = [];
  const { summary } = await run({ entries, capture });

  // pre-boundary bars: honest unknown — mirrors live (no ltf-bias.md yet)
  assert.equal(capture[0].htf_ltf_alignment, "unclear");
  assert.equal(capture[0].bias, null);
  assert.equal(capture[0].grade_cap, "B");
  assert.equal(capture[1].htf_ltf_alignment, "unclear");

  // post-boundary bars: resolved from the sweep evidence
  assert.equal(capture[2].htf_ltf_alignment, "aligned");
  assert.equal(capture[2].bias, "bearish");
  assert.equal(capture[2].grade_cap, "A+");
  assert.equal(capture[3].htf_ltf_alignment, "aligned");

  assert.equal(summary.chain_status, "clean");
  assert.equal(summary.open_reaction.interaction, "rejection");
  assert.equal(summary.open_reaction.level, "LO.H");
});

test("direct-brief fold: continuation against the draw marks the run divergent", async () => {
  const cont = sweepAt("09:40", { target: "LO.H", rejected: false });
  const entries = [entryAt("09:44", { sweeps: [cont] }), entryAt("09:50", { sweeps: [cont] })];
  const capture = [];
  const { summary } = await run({ entries, capture });

  assert.equal(capture[1].htf_ltf_alignment, "divergent");
  assert.equal(capture[1].bias, "bullish");
  assert.equal(capture[1].is_retrace_day, true);
  assert.equal(capture[1].grade_cap, "B");
  assert.equal(summary.chain_status, "divergent");
});

test("direct-brief fold: quiet open degrades the chain, keeps B cap", async () => {
  const entries = [entryAt("09:44"), entryAt("09:50")];
  const capture = [];
  const { summary } = await run({ entries, capture });

  assert.equal(capture[1].htf_ltf_alignment, "unclear");
  assert.equal(capture[1].grade_cap, "B");
  assert.equal(summary.chain_status, "degraded:open_unclear");
});

test("day-state context is never overridden by the resolver", async () => {
  const rejection = sweepAt("09:43", { target: "LO.H", rejected: true });
  const entries = [entryAt("09:50", { sweeps: [rejection] })];
  const capture = [];
  const recorded = {
    session: SESSION,
    leader: "MNQ1!",
    ltf_bias_context: { bias: "bullish", htf_ltf_alignment: "divergent", is_retrace_day: true, entry_model_priority: "MSS", grade_cap: "B" },
    session_state: { pillar1: { status: "pass", htfBias: "bullish" }, pillar2: { status: "pass", verdict: "good" } },
    untaken_targets: { untaken_above: [], untaken_below: [] },
    brief_digest: { htf_destination: {}, primary_draw: {} },
  };
  const dir = tmpStateDir("bt-or-");
  const bus = new EventEmitter();
  const deps = makeDeps({ entries, capture });
  deps.loadDayContext = async () => recorded;
  const { summary } = await runBacktest({ date: DATE, session: SESSION, mode: "auto", bus, stateDir: dir, deps });

  assert.equal(capture[0].htf_ltf_alignment, "divergent");
  assert.equal(capture[0].bias, "bullish");
  assert.equal(summary.chain_status, "clean");
  assert.equal(summary.open_reaction ?? null, null);
});

// §7 Step 4: "Wait for first 15–30 minutes." The engine's sweep `rejected`
// flag matures as later bars close back through the level — a continuation
// read at minute 15 can become a rejection by minute 22 (observed June 9:
// LO.H break at 09:43 read as continuation at 09:45; the rejection that
// defined the A+ short printed by 09:52). The resolver re-evaluates each
// bar until minute 30, then freezes.
test("open-reaction verdict matures: rejected flag flips within minute 15-30 window", async () => {
  const contAt43 = sweepAt("09:43", { target: "LO.H", rejected: false });
  const rejAt43 = sweepAt("09:43", { target: "LO.H", rejected: true });
  const entries = [
    entryAt("09:46", { sweeps: [contAt43] }),             // minute-15 read: continuation (close holds 100)
    entryAt("09:52", { sweeps: [rejAt43], close: 98 }),   // same sweep rejected — closes back UNDER LO.H (real rejection)
    entryAt("10:05", { sweeps: [rejAt43], close: 98 }),
  ];
  const capture = [];
  const { summary } = await run({ entries, capture });

  assert.equal(capture[0].htf_ltf_alignment, "divergent");  // first read
  assert.equal(capture[1].htf_ltf_alignment, "aligned");    // matured
  assert.equal(capture[1].bias, "bearish");
  assert.equal(capture[2].htf_ltf_alignment, "aligned");
  assert.equal(summary.open_reaction.interaction, "rejection");
  assert.equal(summary.chain_status, "clean");
});

test("open-reaction verdict freezes after minute 30", async () => {
  const cont = sweepAt("09:43", { target: "LO.H", rejected: false });
  const lateRej = sweepAt("09:43", { target: "LO.H", rejected: true });
  const entries = [
    entryAt("09:46", { sweeps: [cont] }),
    entryAt("10:05", { sweeps: [lateRej] }),  // past minute 30 — ignored
  ];
  const capture = [];
  const { summary } = await run({ entries, capture });

  assert.equal(capture[1].htf_ltf_alignment, "divergent");
  assert.equal(summary.open_reaction.interaction, "continuation");
  assert.equal(summary.chain_status, "divergent");
});

// §2.3 "never marries a bias": after the open window freezes, a SWING-tier
// MSS confirming against the current bias realigns the fold's context —
// mirroring the live resolver (live/replay parity).
test("post-freeze swing MSS against the bias realigns the fold context", async () => {
  const cont = sweepAt("09:40", { target: "LO.H", rejected: false }); // bullish divergent open
  const mssBearMs = Date.parse(isoAtEt("10:40"));
  const lateBar = entryAt("10:45", { sweeps: [cont] });
  lateBar.inputs.bundle.gates.engine.pillar3.structures_by_tier = {
    swing: [{ event: "mss", dir: "bear", tier: "swing", confirmed_ms: mssBearMs }],
  };
  const after = entryAt("10:50", { sweeps: [cont] });
  after.inputs.bundle.gates.engine.pillar3.structures_by_tier = {
    swing: [{ event: "mss", dir: "bear", tier: "swing", confirmed_ms: mssBearMs }],
  };
  const entries = [entryAt("09:46", { sweeps: [cont] }), lateBar, after];
  const capture = [];
  const { summary } = await run({ entries, capture });

  assert.equal(capture[0].htf_ltf_alignment, "divergent"); // open read
  assert.equal(capture[1].htf_ltf_alignment, "aligned");   // realigned on the MSS bar
  assert.equal(capture[1].bias, "bearish");
  assert.equal(capture[2].htf_ltf_alignment, "aligned");
  assert.equal(summary.chain_status, "clean");
  assert.equal(summary.open_reaction.htf_ltf_alignment, "aligned");
  assert.equal(summary.open_reaction.interaction, "mss_realignment");
});

// 2026-06-18 parity: a swing-tier BoS WITH displacement realigns the fold the
// same as an MSS — the structural-turn signal the MSS-only filter skipped.
// (A no-displacement BoS must stay inert — see the live-ltf-resolver guard.)
test("post-freeze swing BoS with displacement realigns the fold context", async () => {
  const cont = sweepAt("09:40", { target: "LO.H", rejected: false }); // bullish divergent open
  const bosBearMs = Date.parse(isoAtEt("10:40"));
  const bosSwing = { swing: [{ event: "bos", dir: "bear", tier: "swing", displacement: true, confirmed_ms: bosBearMs }] };
  const lateBar = entryAt("10:45", { sweeps: [cont] });
  lateBar.inputs.bundle.gates.engine.pillar3.structures_by_tier = bosSwing;
  const after = entryAt("10:50", { sweeps: [cont] });
  after.inputs.bundle.gates.engine.pillar3.structures_by_tier = bosSwing;
  const entries = [entryAt("09:46", { sweeps: [cont] }), lateBar, after];
  const capture = [];
  const { summary } = await run({ entries, capture });

  assert.equal(capture[1].bias, "bearish");
  assert.equal(summary.open_reaction.interaction, "mss_realignment");
});

// User ruling 2026-06-12 (§2.3 "never marries a bias"): a quiet open leaves
// the LTF bias pending — the first post-window swing-tier structure earns
// the day its direction at B cap (neutral overnight = one weaker element).
test("unclear open: post-window swing structure earns the fold its direction at B", async () => {
  const structMs = Date.parse(isoAtEt("10:40"));
  const lateBar = entryAt("10:45");
  lateBar.inputs.bundle.gates.engine.pillar3.structures_by_tier = {
    swing: [{ event: "bos", dir: "bear", tier: "swing", confirmed_ms: structMs }],
  };
  const entries = [entryAt("09:46"), lateBar, (() => { const e = entryAt("10:50"); e.inputs.bundle.gates.engine.pillar3.structures_by_tier = { swing: [{ event: "bos", dir: "bear", tier: "swing", confirmed_ms: structMs }] }; return e; })()];
  const capture = [];
  const { summary } = await run({ entries, capture });

  assert.equal(capture[0].htf_ltf_alignment, "unclear");  // quiet open
  assert.equal(capture[1].bias, "bearish");               // earned on the structure bar
  assert.equal(capture[1].htf_ltf_alignment, "aligned");  // brief draw is bearish
  assert.equal(capture[1].grade_cap, "B");                // neutral overnight stays B
  assert.equal(capture[2].bias, "bearish");
  assert.equal(summary.open_reaction.interaction, "late_direction");
});
