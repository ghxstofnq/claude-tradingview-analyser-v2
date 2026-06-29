// Batch A walker-alignment regression — 2026-06-09 NY-AM only.
//
// Folds the recorded 06-09 MNQ tape through the REAL deterministic chain and
// asserts the user-approved oracle packet (docs/audits/recent-oracle-packets/
// 2026-06-09-ny-am.md; docs/strategy/lanto-oracle.md §2026-06-09):
//   Inversion short A+ · entry 29731.25 · stop 29851.50 · TP1 29595.25 ·
//   window ~10:29-10:34 ET · one primary trade for the session.
//
// SKIPPED — BLOCKED. The chain cannot emit this packet without new user
// modeling decisions; forcing it would require fixture-specific hardcoding
// (forbidden). Full evidence + the decisions needed are in
// docs/audits/2026-06-30-batch-a-06-09-blocker.md. The assertions below are
// the live target: delete the `skip` option once an entry-fill rule + an
// inversion stop-anchor rule are approved, and drive it RED -> GREEN.
//
// Today the chain first emits the stale 10:00 ET packet (entry 29964.75);
// the approved entry 29731.25 is a 1m bar OPEN with no structural anchor and
// the stop 29851.50 is an h1 FVG candle-1-open the inversion stop rule never
// reads — see the blocker report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { foldTape, assessTape } from "../cli/lib/day-tape.js";
import { __test as barClose } from "../app/main/bar-close.js";

const TAPE = join(dirname(fileURLToPath(import.meta.url)), "tapes", "2026-06-09-ny-am-replay.tape.json");

test(
  "2026-06-09 NY-AM folds to the approved Inversion short A+ packet",
  { skip: "BLOCKED — see docs/audits/2026-06-30-batch-a-06-09-blocker.md (entry 29731.25 / stop 29851.50 have no production-general anchor; needs user fill-rule + stop-anchor decisions)" },
  async () => {
    const tape = JSON.parse(readFileSync(TAPE, "utf8"));
    const outcome = await foldTape(tape, { truthFn: barClose.buildDeterministicPacketTruthFromInputs });

    const verdict = assessTape(tape, outcome);
    assert.ok(
      verdict.ok,
      `chain diverged from the approved 06-09 oracle:\n  ${verdict.failures.join("\n  ")}\n`
        + `first packet: ${JSON.stringify(outcome.firstPacket)}\n`
        + `distinct: ${JSON.stringify(outcome.distinctPacketIds)}`,
    );

    // Pin the headline fields explicitly so a future regression names the field.
    assert.equal(outcome.firstPacket?.model, "Inversion", "model");
    assert.equal(outcome.firstPacket?.side, "short", "side");
    assert.equal(outcome.firstPacket?.entry, 29731.25, "entry");
    assert.equal(outcome.firstPacket?.stop, 29851.5, "stop");
    assert.equal(outcome.firstPacket?.tp1, 29595.25, "tp1");
    assert.equal(outcome.firstPacket?.grade, "A+", "grade");
    assert.equal(outcome.distinctPacketIds.length, 1, "one primary trade per session");
  },
);
