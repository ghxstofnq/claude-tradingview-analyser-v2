// Batch A walker-alignment regression — 2026-06-16 NY-AM only.
//
// Folds the recorded 06-16 MNQ tape through the REAL deterministic chain and
// asserts it emits the user-approved oracle packet (docs/audits/recent-oracle-
// packets/2026-06-16-ny-am.md; docs/strategy/lanto-oracle.md §2026-06-16):
//   MSS / Reversal-FVG short B · entry 30864.25 · stop 30905.00 · TP1 30750.75 ·
//   first packet 2026-06-16T13:57:00Z · one primary trade for the session.
//
// Runs against the tape directly (not via runTapesFromDir) so it asserts the
// oracle regardless of the tape's `verified` flag — RED until the chain
// aligns, GREEN once it does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { foldTape, assessTape } from "../cli/lib/day-tape.js";
import { __test as barClose } from "../app/main/bar-close.js";

const TAPE = join(dirname(fileURLToPath(import.meta.url)), "tapes", "2026-06-16-ny-am-replay.tape.json");

test("2026-06-16 NY-AM folds to the approved MSS reversal-FVG short packet", async () => {
  const tape = JSON.parse(readFileSync(TAPE, "utf8"));
  const outcome = await foldTape(tape, { truthFn: barClose.buildDeterministicPacketTruthFromInputs });

  // The tape's `expected` block IS the promoted/user-corrected oracle row.
  const verdict = assessTape(tape, outcome);
  assert.ok(
    verdict.ok,
    `chain diverged from the approved 06-16 oracle:\n  ${verdict.failures.join("\n  ")}\n`
      + `first packet: ${JSON.stringify(outcome.firstPacket)}\n`
      + `distinct: ${JSON.stringify(outcome.distinctPacketIds)}`,
  );

  // Pin the headline fields explicitly so a future regression names the field.
  assert.equal(outcome.firstPacket?.model, "MSS", "model");
  assert.equal(outcome.firstPacket?.side, "short", "side");
  assert.equal(outcome.firstPacket?.entry, 30864.25, "entry");
  assert.equal(outcome.firstPacket?.stop, 30905, "stop");
  assert.equal(outcome.firstPacket?.tp1, 30750.75, "tp1");
  assert.equal(outcome.firstPacket?.grade, "B", "grade");
  assert.equal(outcome.firstPacketEventTs, "2026-06-16T13:57:00.000Z", "first_packet_event_ts");
  assert.equal(outcome.distinctPacketIds.length, 1, "one primary trade per session");
});
