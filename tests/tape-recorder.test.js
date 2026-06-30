// Replay-stepping tape recorder — backfills historical days into walker
// day-tapes by stepping TradingView bar replay and capturing the ICT Engine
// per bar. See cli/lib/tape-recorder.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { contextFromLabel, buildTapeEntry, recordTape, mergeFiveMinuteTrack } from "../cli/lib/tape-recorder.js";

const shortLabel = {
  fixture: "2026-06-09-mnq-ny-am-inversion-short",
  trade_date: "2026-06-09",
  symbol: "MNQ",
  contract_hint: "CME_MINI:MNQ1!",
  session: "NY AM",
  expected: {
    outcome: "trade", model: "Inversion", side: "short", grade: "A+",
    entry: 29731.25, tp1: 29302.5, tp2: 28779.0,
  },
};

// ----------------------------------------------------------- contextFromLabel

test("contextFromLabel: short label maps to bearish context with pools below", () => {
  const ctx = contextFromLabel(shortLabel);
  assert.equal(ctx.session, "ny-am");
  assert.equal(ctx.leader, "MNQ1!");
  assert.equal(ctx.ltf_bias_context.bias, "bearish");
  assert.equal(ctx.ltf_bias_context.entry_model_priority, "Inversion");
  assert.equal(ctx.session_state.pillar1.status, "pass");
  assert.deepEqual(ctx.untaken_targets.untaken_above, []);
  assert.deepEqual(ctx.untaken_targets.untaken_below.map((t) => t.price), [29302.5, 28779.0]);
  assert.equal(ctx.brief_digest.htf_destination.dir, "below");
});

test("contextFromLabel: long label mirrors to bullish with pools above", () => {
  const ctx = contextFromLabel({
    ...shortLabel,
    session: "NY AM",
    expected: { ...shortLabel.expected, side: "long" },
  });
  assert.equal(ctx.ltf_bias_context.bias, "bullish");
  assert.deepEqual(ctx.untaken_targets.untaken_below, []);
  assert.deepEqual(ctx.untaken_targets.untaken_above.map((t) => t.price), [29302.5, 28779.0]);
});

test("contextFromLabel: unlabeled/unknown capture stays neutral, never defaults long", () => {
  const ctx = contextFromLabel({
    fixture: "2026-06-22-mnq-ny-am",
    trade_date: "2026-06-22",
    symbol: "MNQ",
    contract_hint: "CME_MINI:MNQ1!",
    session: "NY AM",
    label_status: "unlabeled",
    expected: { outcome: "unknown", side: null, tp1: null, tp2: null },
  });
  assert.equal(ctx.ltf_bias_context.bias, null);
  assert.equal(ctx.ltf_bias_context.htf_ltf_alignment, "unclear");
  assert.equal(ctx.ltf_bias_context.entry_model_priority, "undecided");
  assert.equal(ctx.ltf_bias_context.grade_cap, "B");
  assert.equal(ctx.session_state.pillar1.status, "unknown");
  assert.deepEqual(ctx.untaken_targets.untaken_above, []);
  assert.deepEqual(ctx.untaken_targets.untaken_below, []);
  assert.deepEqual(ctx.brief_digest.htf_destination, { dir: null, price: null, cite: null });
});

test("contextFromLabel: no-trade labels are neutral even when they carry a side hint", () => {
  const ctx = contextFromLabel({
    fixture: "2026-06-17-mnq-ny-am-no-trade",
    trade_date: "2026-06-17",
    symbol: "MNQ",
    contract_hint: "CME_MINI:MNQ1!",
    session: "NY AM",
    expected: { outcome: "no_trade", side: "short" },
  });
  assert.equal(ctx.ltf_bias_context.bias, null);
  assert.equal(ctx.ltf_bias_context.htf_ltf_alignment, "unclear");
  assert.equal(ctx.ltf_bias_context.entry_model_priority, "undecided");
  assert.deepEqual(ctx.untaken_targets.untaken_above, []);
  assert.deepEqual(ctx.untaken_targets.untaken_below, []);
});

// ------------------------------------------------------------- buildTapeEntry

test("buildTapeEntry: builds a live-shaped inputs record with fresh engine meta", () => {
  const nowMs = Date.now();
  const bars = {
    count: 5,
    last_5_bars: [
      { time: 1781012880, open: 29830, high: 29847, low: 29826, close: 29843.75 },
      { time: 1781012940, open: 29844, high: 29846, low: 29805.25, close: 29806.25 },
      // TradingView replay always shows the next FORMING bar last — it must
      // be dropped, not recorded as a close.
      { time: 1781013000, open: 29806.25, high: 29806.25, low: 29806.25, close: 29806.25 },
    ],
  };
  const engine = {
    schema: 2, schema_supported: true,
    meta: { schema: 2, tf: "1", emit_ms: nowMs - 2000, symbol: "MNQ1!" },
    levels: [], sweeps: [], fvgs: [], bprs: [], swings: [], structures: [], pools: [], quality: null,
  };
  const ctx = contextFromLabel(shortLabel);
  const entry = buildTapeEntry({ engine, bars, context: ctx, captureNowMs: nowMs });

  assert.equal(entry.event.tf, "1m");
  // event ts = close time of the last replayed 1m bar (open + 60s)
  assert.equal(entry.event.ts, new Date((1781012940 + 60) * 1000).toISOString());
  assert.equal(entry.inputs.leader, "MNQ1!");
  assert.equal(entry.inputs.bundle.quote.last, 29806.25);
  assert.equal(entry.inputs.bundle.quote.time, 1781013000);
  // staleness judged against wall clock (the engine emits live during replay)
  assert.equal(entry.inputs.bundle.gates.engine.meta.stale, false);
  assert.equal(entry.inputs.bundle.gates.engine.price_context.last, 29806.25);
  assert.equal(entry.inputs.untaken_targets.untaken_below.length, 2);
  // No 5m provided → engine_by_tf stays null; the 1m track is unchanged.
  assert.equal(entry.inputs.bundle.engine_by_tf, null);
});

// CHECKPOINT 0 (2026-06-20): the 5m engine is captured in a SECOND full pass and
// merged by timestamp — each 1m entry gets the LAST 5m bar that closed at/before
// it. Both engines kept in full so the walker decides per-field which to use.
function fiveMEntry(closeIso, label) {
  return {
    event: { ts: closeIso, tf: "5m" },
    inputs: { bundle: {
      engine: { schema: 2, schema_supported: true, meta: { schema: 2, tf: "5", emit_ms: 1, symbol: "MNQ1!" },
        levels: [], sweeps: [], fvgs: [], bprs: [], swings: [{ price: 1, is_high: true }],
        structures: [{ event: "mss", dir: label }], pools: [], quality: null },
      bars: { last_5_bars: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }] },
    } },
  };
}
function oneMEntry(closeIso) {
  return { event: { ts: closeIso, tf: "1m" }, inputs: { bundle: { engine: { meta: { tf: "1" } }, engine_by_tf: null, bars_by_tf: { m5: { last_5_bars: [] } } } } };
}

test("mergeFiveMinuteTrack: each 1m entry gets the last-closed 5m engine; pre-first-close stays null", () => {
  const e1m = [
    oneMEntry("2026-06-09T13:33:00.000Z"), // before first 5m close (13:35) → null
    oneMEntry("2026-06-09T13:36:00.000Z"), // after 13:35 close → bear
    oneMEntry("2026-06-09T13:41:00.000Z"), // after 13:40 close → bull
  ];
  const e5m = [
    fiveMEntry("2026-06-09T13:35:00.000Z", "bear"),
    fiveMEntry("2026-06-09T13:40:00.000Z", "bull"),
  ];
  const merged = mergeFiveMinuteTrack(e1m, e5m);
  assert.equal(merged[0].inputs.bundle.engine_by_tf, null);
  assert.equal(merged[1].inputs.bundle.engine_by_tf.m5.structures[0].dir, "bear");
  assert.equal(merged[2].inputs.bundle.engine_by_tf.m5.structures[0].dir, "bull");
  assert.equal(merged[1].inputs.bundle.engine_by_tf.m5.meta.tf, "5");
});

// ----------------------------------------------------------------- recordTape

function makeReplayDeps({ totalBars = 3, engineEmitAdvances = true } = {}) {
  const calls = { start: [], step: 0, stop: 0 };
  const t0 = 1781011800; // 2026-06-09T13:30:00Z = 09:30 ET
  let position = 0; // bars completed beyond the first
  let emit = 1000;
  return {
    calls,
    deps: {
      startReplay: async (args) => { calls.start.push(args); },
      stepReplay: async () => {
        calls.step += 1;
        position += 1;
        if (engineEmitAdvances) emit += 10;
      },
      stopReplay: async () => { calls.stop += 1; },
      readBars: async () => ({
        count: position + 2,
        // closed bars up to `position`, plus the forming next bar TV always shows
        last_5_bars: [
          ...Array.from({ length: Math.min(4, position + 1) }, (_, i) => {
            const idx = position - Math.min(4, position + 1) + 1 + i;
            return { time: t0 + idx * 60, open: 1, high: 2, low: 0, close: 1.5 };
          }),
          { time: t0 + (position + 1) * 60, open: 1.5, high: 1.5, low: 1.5, close: 1.5 },
        ],
      }),
      readEngine: async () => ({
        schema: 2, schema_supported: true,
        meta: { schema: 2, tf: "1", emit_ms: emit, symbol: "MNQ1!" },
        levels: [], sweeps: [], fvgs: [], bprs: [], swings: [], structures: [], pools: [], quality: null,
      }),
      sleep: async () => {},
      nowMs: () => 5000, // wall clock for staleness; emit ages stay < 90s
    },
  };
}

test("recordTape: steps replay from --from to --to, one entry per closed bar", async () => {
  const { deps, calls } = makeReplayDeps();
  const result = await recordTape({
    label: shortLabel,
    fromEt: "09:30",
    toEt: "09:33", // 09:30 open + 3 bars → closes 09:31, 09:32, 09:33
    deps,
    pollIntervalMs: 1,
    stepDeadlineMs: 50,
  });
  assert.deepEqual(calls.start, [{ date: "2026-06-09", time: "09:30" }]);
  assert.equal(calls.stop, 1);
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries[0].event.ts, "2026-06-09T13:31:00.000Z");
  assert.equal(result.entries[2].event.ts, "2026-06-09T13:33:00.000Z");
  assert.deepEqual(result.warnings, []);
});

test("recordTape: a step whose engine never re-emits is captured with a warning, not silently trusted", async () => {
  const { deps } = makeReplayDeps({ engineEmitAdvances: false });
  const result = await recordTape({
    label: shortLabel,
    fromEt: "09:30",
    toEt: "09:32",
    deps,
    pollIntervalMs: 1,
    stepDeadlineMs: 10,
  });
  assert.equal(result.entries.length, 2);
  assert.ok(result.warnings.some((w) => /emit/.test(w)), `expected emit warning, got ${JSON.stringify(result.warnings)}`);
});

test("recordTape: stopReplay still runs when capture throws mid-loop", async () => {
  const { deps, calls } = makeReplayDeps();
  deps.readBars = async () => { throw new Error("CDP gone"); };
  await assert.rejects(
    () => recordTape({ label: shortLabel, fromEt: "09:30", toEt: "09:32", deps, pollIntervalMs: 1, stepDeadlineMs: 10 }),
    /CDP gone/,
  );
  assert.equal(calls.stop, 1);
});
