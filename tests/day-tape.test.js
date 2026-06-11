// Day-tape replay — fold the real deterministic chain over a recorded
// session's per-bar inputs and assert the whole story: walker spawns,
// confirms on the right bar, emits the packet with exact entry/stop/TP,
// and quiet bars stay no-trade. See cli/lib/day-tape.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  foldTape,
  assessTape,
  buildWalkerInputsRecord,
  buildTapeFromRecords,
  runTapesFromDir,
} from "../cli/lib/day-tape.js";

// ------------------------------------------------------------------ helpers

function tapeOf(entries, expected = { outcome: "no_trade" }, extra = {}) {
  return {
    fixture: "test-tape",
    date: "2026-06-11",
    session: "ny-am",
    verified: true,
    expected,
    entries,
    ...extra,
  };
}

function entry(ts, marker) {
  return { event: { ts, tf: "1m" }, inputs: { bundle: { marker } } };
}

/** Fake truth fn: spawns a walker on marker 'spawn', fires a packet on marker 'confirm'. */
function fakeTruthFn({ inputs, previousWalkers, event }) {
  const marker = inputs?.bundle?.marker;
  const walkers = previousWalkers.slice();
  if (marker === "spawn") walkers.push({ id: "w1", model: "MSS", stage: "retrace_pending" });
  if (marker === "confirm" && walkers.length) {
    return {
      finalVerdict: "manual_candidate",
      walkers: walkers.map((w) => ({ ...w, stage: "confirmed" })),
      bestPacket: { status: "executable" },
      surfacePayload: { id: "D-w1", model: "MSS", side: "long", entry: 21000, stop: 20990, tp1: 21050, grade: "A+" },
    };
  }
  return { finalVerdict: "no_trade", walkers, bestPacket: null, surfacePayload: null };
}

// ------------------------------------------------------------------ foldTape

test("foldTape: carries walker state from bar to bar (the day-replay premise)", async () => {
  const seen = [];
  const tape = tapeOf([entry("t1"), entry("t2", "spawn"), entry("t3")]);
  await foldTape(tape, {
    truthFn: (args) => { seen.push(args.previousWalkers.length); return fakeTruthFn(args); },
  });
  // bar1 starts empty, bar2 spawns, bar3 must see the walker from bar2
  assert.deepEqual(seen, [0, 0, 1]);
});

test("foldTape: captures the first packet with its event timestamp and flat fields", async () => {
  const tape = tapeOf([entry("t1"), entry("t2", "spawn"), entry("t3", "confirm"), entry("t4", "confirm")]);
  const outcome = await foldTape(tape, { truthFn: fakeTruthFn });
  assert.equal(outcome.bars, 4);
  assert.equal(outcome.firstPacket.model, "MSS");
  assert.equal(outcome.firstPacket.entry, 21000);
  assert.equal(outcome.firstPacketEventTs, "t3");
  // the same confirmed walker re-surfacing on t4 is one distinct packet, not two
  assert.equal(outcome.distinctPacketIds.length, 1);
});

// ---------------------------------------------------------------- assessTape

test("assessTape: trade tape passes when model/side/entry/stop/tp1 and first bar all match", async () => {
  const tape = tapeOf(
    [entry("t1"), entry("t2", "spawn"), entry("t3", "confirm")],
    { outcome: "trade", model: "MSS", side: "long", entry: 21000, stop: 20990, tp1: 21050, first_packet_event_ts: "t3", max_packets: 1 },
  );
  const outcome = await foldTape(tape, { truthFn: fakeTruthFn });
  const verdict = assessTape(tape, outcome);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.failures, []);
});

test("assessTape: missed setup, wrong side, and early trigger all fail with named reasons", async () => {
  const tradeTape = tapeOf(
    [entry("t1"), entry("t2", "spawn"), entry("t3", "confirm")],
    { outcome: "trade", model: "MSS", side: "short", entry: 21000, first_packet_event_ts: "t9" },
  );
  const outcome = await foldTape(tradeTape, { truthFn: fakeTruthFn });
  const verdict = assessTape(tradeTape, outcome);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.failures.some((f) => /side/.test(f)), `side failure missing: ${verdict.failures}`);
  assert.ok(verdict.failures.some((f) => /first_packet_event_ts/.test(f)), `ts failure missing: ${verdict.failures}`);

  const quiet = tapeOf([entry("t1")], { outcome: "trade", model: "MSS" });
  const quietVerdict = assessTape(quiet, await foldTape(quiet, { truthFn: fakeTruthFn }));
  assert.ok(quietVerdict.failures.some((f) => /no packet/.test(f)));
});

test("assessTape: a packet on a hand-verified no-trade day is a hard failure (false candidate)", async () => {
  const tape = tapeOf([entry("t1", "spawn"), entry("t2", "confirm")], { outcome: "no_trade" });
  const verdict = assessTape(tape, await foldTape(tape, { truthFn: fakeTruthFn }));
  assert.equal(verdict.ok, false);
  assert.ok(verdict.failures.some((f) => /no_trade/.test(f)));
});

// ------------------------------------------------- recording + tape building

test("buildWalkerInputsRecord: freezes event + session + inputs for later promotion", () => {
  const rec = buildWalkerInputsRecord({
    event: { ts: "2026-06-11T13:46:00.000Z", tf: "1m" },
    session: "ny-am",
    inputs: { bundle: { gates: {} }, leader: "MNQ1!" },
  });
  assert.equal(rec.session, "ny-am");
  assert.equal(rec.event.ts, "2026-06-11T13:46:00.000Z");
  assert.equal(rec.inputs.leader, "MNQ1!");
  assert.match(rec.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("buildTapeFromRecords: builds an unverified tape with expected prefilled from the day's packet", () => {
  const records = [
    { event: { ts: "t1" }, session: "ny-am", inputs: { bundle: {} } },
    { event: { ts: "t2" }, session: "ny-am", inputs: { bundle: {} } },
  ];
  const packets = [
    { eventTimeUtc: "t2", finalVerdict: "manual_candidate", surfacePayload: { model: "Inversion", side: "long", entry: 30314.75, stop: 30269.75, tp1: 30437.5 } },
  ];
  const tape = buildTapeFromRecords(records, { fixture: "2026-06-11-ny-am", date: "2026-06-11", session: "ny-am", packets });
  assert.equal(tape.verified, false);
  assert.equal(tape.entries.length, 2);
  assert.equal(tape.expected.outcome, "trade");
  assert.equal(tape.expected.model, "Inversion");
  assert.equal(tape.expected.entry, 30314.75);
  assert.equal(tape.expected.first_packet_event_ts, "t2");
});

test("buildTapeFromRecords: a day with no packets prefills a no-trade expectation", () => {
  const records = [{ event: { ts: "t1" }, session: "ny-am", inputs: { bundle: {} } }];
  const tape = buildTapeFromRecords(records, { fixture: "x", date: "d", session: "ny-am", packets: [] });
  assert.deepEqual(tape.expected, { outcome: "no_trade" });
});

// -------------------------------------------------------------- dir gate run

test("runTapesFromDir: runs verified tapes, skips unverified, reports failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tapes-"));
  try {
    writeFileSync(join(dir, "good.tape.json"), JSON.stringify(tapeOf(
      [entry("t1"), entry("t2", "spawn"), entry("t3", "confirm")],
      { outcome: "trade", model: "MSS", side: "long" },
      { fixture: "good" },
    )));
    writeFileSync(join(dir, "bad.tape.json"), JSON.stringify(tapeOf(
      [entry("t1", "spawn"), entry("t2", "confirm")],
      { outcome: "no_trade" },
      { fixture: "bad" },
    )));
    writeFileSync(join(dir, "draft.tape.json"), JSON.stringify(tapeOf(
      [entry("t1")], { outcome: "no_trade" }, { fixture: "draft", verified: false },
    )));
    const run = await runTapesFromDir(dir, { truthFn: fakeTruthFn });
    assert.equal(run.ok, false);
    assert.deepEqual(run.skipped, ["draft"]);
    assert.deepEqual(run.tapes.filter((t) => !t.ok).map((t) => t.fixture), ["bad"]);
    assert.deepEqual(run.tapes.filter((t) => t.ok).map((t) => t.fixture), ["good"]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// ------------------------------------------------ the real gate (fix #4 core)

test("tape gate: every verified tape in tests/tapes replays through the REAL chain to its hand-verified verdict", async () => {
  const { __test } = await import("../app/main/bar-close.js");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const tapesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "tapes");
  const { formatTapeRunReport } = await import("../cli/lib/day-tape.js");

  const run = await runTapesFromDir(tapesDir, { truthFn: __test.buildDeterministicPacketTruthFromInputs });
  assert.ok(run.tapes.length >= 1, "tape corpus is empty — at least the synthetic MSS tape must run");
  assert.equal(run.ok, true, `\n${formatTapeRunReport(run)}`);
});
