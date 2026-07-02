// Batch A walker-alignment regression — 2026-06-09 NY-AM only.
//
// Folds the recorded 06-09 MNQ tape through the REAL deterministic chain and
// asserts the Option-A evidence-backed oracle packet (docs/audits/recent-
// oracle-packets/2026-06-09-ny-am.md; docs/strategy/lanto-oracle.md §2026-06-09):
//   Inversion short B · entry 29760 · execution stop 29819.25 (structural 29818.75) · TP1 29595.25 · first
//   packet 2026-06-09T14:27:00Z · one primary trade for the session.
//
// This replaces the previously-approved-but-inconsistent 29731.25 / 29851.50
// A+ target. The old target had no production-general anchor (see
// docs/audits/2026-06-30-batch-a-06-09-blocker.md); this test pins the first
// candidate the tape actually supports after suppressing the stale 10:00 ET
// low-coherence inversion latch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { foldTape, assessTape } from "../cli/lib/day-tape.js";
import { __test as barClose } from "../app/main/bar-close.js";

const TAPE = join(dirname(fileURLToPath(import.meta.url)), "tapes", "2026-06-09-ny-am-replay.tape.json");

test("2026-06-09 NY-AM folds to the evidence-backed Inversion short B packet", async () => {
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
    assert.equal(outcome.firstPacket?.entry, 29760, "entry");
    assert.equal(outcome.firstPacket?.stop, 29819.25, "execution stop");
    assert.equal(outcome.firstPacket?.tp1, 29595.25, "tp1");
    assert.equal(outcome.firstPacket?.grade, "B", "grade");
    assert.equal(outcome.firstPacketEventTs, "2026-06-09T14:27:00.000Z", "first_packet_event_ts");
    assert.equal(outcome.distinctPacketIds.length, 1, "one primary trade per session");
});
