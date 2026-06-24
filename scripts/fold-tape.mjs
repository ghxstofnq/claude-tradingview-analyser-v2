#!/usr/bin/env node
// Fold a tests/tapes/*.tape.json through the REAL deterministic chain
// (buildDeterministicPacketTruthFromInputs) and assess vs its expected block.
// Stage-G oracle validation helper — no chart access, seconds.
//
// Usage: node scripts/fold-tape.mjs <path-to-tape.json>
import fs from "node:fs";
import { foldTape, assessTape } from "../cli/lib/day-tape.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/fold-tape.mjs <tape.json>");
  process.exit(2);
}
const tape = JSON.parse(fs.readFileSync(file, "utf8"));
const truthFn = barCloseTruth.buildDeterministicPacketTruthFromInputs;

const outcome = await foldTape(tape, { truthFn });
console.log(`\n${tape.fixture} — ${tape.date} ${tape.session} (verified:${tape.verified})`);
console.log(`bars=${outcome.bars} packets=${outcome.packets.length} distinct=${outcome.distinctPacketIds.length}`);
console.log("verdictCounts:", JSON.stringify(outcome.verdictCounts));
if (outcome.firstPacket) console.log("firstPacket:", JSON.stringify(outcome.firstPacket));
console.log("firstPacketEventTs:", outcome.firstPacketEventTs);
console.log("\nexpected:", JSON.stringify(tape.expected));
const v = assessTape(tape, outcome);
console.log(v.ok ? "\nASSESS: PASS ✓" : "\nASSESS: FAIL ✗");
for (const f of v.failures) console.log("  -", f);
process.exit(v.ok ? 0 : 1);
