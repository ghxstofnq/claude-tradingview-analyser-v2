#!/usr/bin/env node
// Promote the 5 Stage-G oracle tapes to verified:true, freezing `expected` from
// the validated fold (the chain's current output). Per the user-approved
// pass-bar (2026-06-23): model_class + side + grade + no-trade match the oracle;
// the exact entry tick is accepted as discretionary (a valid winning entry in
// the move). This locks the day-tape gate (tests/day-tape.test.js) as the
// Stage-G regression baseline — any future fold drift breaks the gate.
//
//   node scripts/promote-stage-g-tapes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldTape } from '../cli/lib/day-tape.js';
import { __test as bc } from '../app/main/bar-close.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAPES = ['2026-06-09', '2026-06-16', '2026-06-17', '2026-02-09', '2026-06-18']
  .map((d) => `tests/tapes/${d}-ny-am-replay.tape.json`);
const truthFn = bc.buildDeterministicPacketTruthFromInputs;

for (const rel of TAPES) {
  const p = path.join(ROOT, rel);
  const tape = JSON.parse(fs.readFileSync(p, 'utf8'));
  const o = await foldTape(tape, { truthFn });
  tape.expected = o.firstPacket
    ? {
        outcome: 'trade',
        model: o.firstPacket.model,
        side: o.firstPacket.side,
        entry: o.firstPacket.entry,
        stop: o.firstPacket.stop,
        tp1: o.firstPacket.tp1,
        grade: o.firstPacket.grade,
        first_packet_event_ts: o.firstPacketEventTs,
        max_packets: o.distinctPacketIds.length,
      }
    : { outcome: 'no_trade' };
  tape.verified = true;
  fs.writeFileSync(p, `${JSON.stringify(tape, null, 2)}\n`, 'utf8');
  console.log(`promoted ${rel} → ${JSON.stringify(tape.expected)}`);
}
