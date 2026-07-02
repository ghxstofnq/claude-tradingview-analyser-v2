// Batch A walker-alignment regression — 2026-06-18 NY-AM only.
//
// Folds the recorded 06-18 MNQ tape through the REAL deterministic chain and
// asserts it emits the user-approved oracle packet (docs/audits/recent-oracle-
// packets/2026-06-18-ny-am.md; docs/strategy/lanto-oracle.md §2026-06-18 E2):
//   Trend / Continuation long B · entry 30452.75 (CE of the dip-reclaim bull
//   FVG 30448.25–30457.25) · execution stop 30399.5 (structural 30400 below the 30402.5 reclaim base) ·
//   TP1 30615 (NYAM.H) · first packet on the ~09:46 ET 1m reclaim · one
//   primary trade for the session.
//
// Runs against the tape directly (not via runTapesFromDir) so it asserts the
// oracle regardless of the tape's `verified` flag — RED until the chain aligns
// (it emits the premature 09:43 Inversion long at 30470.25), GREEN once the
// Trend reclaim-continuation rule lands.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { foldTape, assessTape } from "../cli/lib/day-tape.js";
import { __test as barClose } from "../app/main/bar-close.js";

const TAPE = join(dirname(fileURLToPath(import.meta.url)), "tapes", "2026-06-18-ny-am-replay.tape.json");

test("2026-06-18 NY-AM folds to the approved Trend reclaim-continuation long packet", async () => {
  const tape = JSON.parse(readFileSync(TAPE, "utf8"));
  const outcome = await foldTape(tape, { truthFn: barClose.buildDeterministicPacketTruthFromInputs });

  // The tape's `expected` block IS the approved oracle — assess against it.
  const verdict = assessTape(tape, outcome);
  assert.ok(
    verdict.ok,
    `chain diverged from the approved 06-18 oracle:\n  ${verdict.failures.join("\n  ")}\n`
      + `first packet: ${JSON.stringify(outcome.firstPacket)}\n`
      + `distinct: ${JSON.stringify(outcome.distinctPacketIds)}`,
  );

  // Pin the headline fields explicitly so a future regression names the field.
  assert.equal(outcome.firstPacket?.model, "Trend", "model");
  assert.equal(outcome.firstPacket?.side, "long", "side");
  assert.equal(outcome.firstPacket?.entry, 30452.75, "entry");
  assert.equal(outcome.firstPacket?.stop, 30399.5, "execution stop");
  assert.equal(outcome.firstPacket?.tp1, 30615, "tp1");
  assert.equal(outcome.firstPacket?.grade, "B", "grade");
  assert.equal(outcome.firstPacketEventTs, "2026-06-18T13:46:00.000Z", "first_packet_event_ts");
  assert.equal(outcome.distinctPacketIds.length, 1, "one primary trade per session");
});
