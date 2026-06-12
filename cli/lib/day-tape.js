/**
 * day-tape.js — record and replay a whole session through the deterministic
 * strategy chain (fix #4 of the dead-June-sessions series).
 *
 * A tape is the recorded sequence of per-bar detector inputs for one session
 * — exactly what app/main/bar-close.js#buildDetectorInputs handed the chain
 * live. Replaying folds the REAL production truth function
 * (buildDeterministicPacketTruthFromInputs) over the entries, carrying walker
 * state bar to bar the same way runDeterministicPacketTruthForBar does via
 * walkers.json. The proof asserts the whole story: walker spawns, confirms on
 * the right bar, emits the packet with exact entry/stop/TP — and quiet bars
 * stay no-trade.
 *
 * Pure functions; no I/O except runTapesFromDir's directory read. The truth
 * function is injected so unit tests don't need the app chain and the gate
 * test injects the real one.
 *
 * Tape shape:
 *   { fixture, date, session, verified, expected, entries: [{event, inputs}] }
 * expected: { outcome: 'trade'|'no_trade', model?, side?, entry?, stop?, tp1?,
 *             grade?, first_packet_event_ts?, max_packets? }
 * verified:false tapes (fresh promotions, not yet hand-graded) are skipped by
 * the gate — grading a tape once and flipping the flag freezes it forever.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Fold the truth function over a tape's entries, carrying walker state. */
export async function foldTape(tape, { truthFn }) {
  let walkers = [];
  const packets = [];
  const verdictCounts = {};
  const distinct = new Set();
  let firstPacket = null;
  let firstPacketEventTs = null;

  for (const entry of tape.entries ?? []) {
    const truth = await truthFn({
      inputs: entry.inputs,
      previousWalkers: walkers,
      event: entry.event,
      session: tape.session,
    });
    walkers = truth?.walkers ?? walkers;
    const verdict = truth?.finalVerdict ?? 'unknown';
    verdictCounts[verdict] = (verdictCounts[verdict] ?? 0) + 1;
    if (truth?.bestPacket) {
      const payload = truth.surfacePayload ?? {};
      const packet = {
        event_ts: entry.event?.ts ?? null,
        id: payload.id ?? null,
        model: payload.model ?? null,
        side: payload.side ?? null,
        entry: payload.entry ?? null,
        stop: payload.stop ?? null,
        tp1: payload.tp1 ?? null,
        grade: payload.grade ?? null,
      };
      packets.push(packet);
      // Distinct OPPORTUNITIES (model+side), not raw packet ids: as a move
      // unfolds, neighboring zones confirm the same trade idea under new
      // walker ids (June 9: 8 Inversion-short packets in 22 bars — one
      // opportunity). Hand-verified expectations bound opportunities.
      distinct.add(`${packet.model}:${packet.side}`);
      if (!firstPacket) {
        firstPacket = packet;
        firstPacketEventTs = packet.event_ts;
      }
    }
  }

  return {
    bars: (tape.entries ?? []).length,
    packets,
    distinctPacketIds: [...distinct],
    firstPacket,
    firstPacketEventTs,
    verdictCounts,
    finalWalkers: walkers,
  };
}

/** Compare a fold outcome against the tape's hand-verified expectation. */
export function assessTape(tape, outcome) {
  const expected = tape.expected ?? {};
  const failures = [];

  if (expected.outcome === 'no_trade') {
    if (outcome.packets.length > 0) {
      failures.push(
        `expected no_trade day but the chain fired ${outcome.distinctPacketIds.length} packet(s); `
        + `first: ${JSON.stringify(outcome.firstPacket)}`,
      );
    }
  } else if (expected.outcome === 'trade') {
    if (!outcome.firstPacket) {
      failures.push(`expected a trade but no packet fired across ${outcome.bars} bars (missed valid setup)`);
    } else {
      for (const field of ['model', 'side', 'entry', 'stop', 'tp1', 'grade']) {
        if (expected[field] != null && outcome.firstPacket[field] !== expected[field]) {
          failures.push(`${field}: expected ${expected[field]}, got ${outcome.firstPacket[field]}`);
        }
      }
      if (expected.first_packet_event_ts != null && outcome.firstPacketEventTs !== expected.first_packet_event_ts) {
        failures.push(
          `first_packet_event_ts: expected ${expected.first_packet_event_ts}, got ${outcome.firstPacketEventTs}`,
        );
      }
      if (expected.max_packets != null && outcome.distinctPacketIds.length > expected.max_packets) {
        failures.push(`distinct packets: expected ≤ ${expected.max_packets}, got ${outcome.distinctPacketIds.length}`);
      }
    }
  } else {
    failures.push(`tape has no usable expected.outcome (got ${JSON.stringify(expected.outcome)})`);
  }

  return { ok: failures.length === 0, failures };
}

/** One per-bar recording line — appended to <sessionDir>/walker-inputs.jsonl live. */
export function buildWalkerInputsRecord({ event, session, inputs }) {
  return {
    recordedAt: new Date().toISOString(),
    event,
    session,
    inputs,
  };
}

/**
 * Promote a recorded day into a tape. `packets` is the day's
 * deterministic-packets.jsonl truth records — the first surfaced packet
 * prefills the expected block so hand-grading starts from what the chain
 * said live. verified stays false until a human confirms the expectation.
 */
export function buildTapeFromRecords(records, { fixture, date, session, packets = [] }) {
  const firstFired = packets.find((p) => p?.bestPacket || p?.surfacePayload);
  const payload = firstFired?.surfacePayload ?? null;
  const expected = payload
    ? {
        outcome: 'trade',
        model: payload.model ?? null,
        side: payload.side ?? null,
        entry: payload.entry ?? null,
        stop: payload.stop ?? null,
        tp1: payload.tp1 ?? null,
        first_packet_event_ts: firstFired.eventTimeUtc ?? null,
        max_packets: 1,
      }
    : { outcome: 'no_trade' };
  return {
    fixture,
    date,
    session,
    verified: false,
    expected,
    entries: records.map((r) => ({ event: r.event, inputs: r.inputs })),
  };
}

/** Run every *.tape.json in a directory. Unverified tapes are reported, not run. */
export async function runTapesFromDir(dir, { truthFn }) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.tape.json')).sort();
  const tapes = [];
  const skipped = [];
  for (const file of files) {
    const tape = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (tape.verified !== true) {
      skipped.push(tape.fixture ?? file);
      continue;
    }
    const outcome = await foldTape(tape, { truthFn });
    const verdict = assessTape(tape, outcome);
    tapes.push({ fixture: tape.fixture ?? file, ok: verdict.ok, failures: verdict.failures, outcome });
  }
  return { ok: tapes.every((t) => t.ok), tapes, skipped };
}

export function formatTapeRunReport(run) {
  const lines = [`Day-tape run — ${run.tapes.length} tape(s), ${run.skipped.length} unverified skipped`];
  for (const t of run.tapes) {
    lines.push(`  ${t.ok ? 'PASS' : 'FAIL'}  ${t.fixture}  (${t.outcome.bars} bars, ${t.outcome.distinctPacketIds.length} packet(s))`);
    for (const f of t.failures) lines.push(`        - ${f}`);
  }
  for (const s of run.skipped) lines.push(`  SKIP  ${s} (verified: false — hand-grade and flip the flag)`);
  return lines.join('\n');
}
