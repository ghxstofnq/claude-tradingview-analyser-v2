import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writePairDecision, readPairDecision } from '../cli/lib/pair-decision.js';

async function mkdtmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'pair-decision-'));
}

test('writes and reads back a valid decision', async () => {
  const dir = await mkdtmp();
  const payload = {
    date: '2026-05-25',
    session: 'ny-am',
    primary: 'MNQ1!',
    secondary: 'MES1!',
    leader: 'MNQ1!',
    decided_at: '2026-05-25T13:45:00Z',
    evidence: { primary_disp_score: 0.82, secondary_disp_score: 0.54, margin: 0.28, threshold: 0.10 },
    reason: 'primary_higher_disp_score',
  };
  await writePairDecision(dir, payload);
  const read = await readPairDecision(dir, '2026-05-25');
  assert.equal(read.leader, 'MNQ1!');
  assert.equal(read.schema, 2);
  assert.equal(read.evidence.margin, 0.28);
});

test('round-trips the SMT v2 fields (method, bias_dir, divergence, gap, standaside)', async () => {
  const dir = await mkdtmp();
  await writePairDecision(dir, {
    date: '2026-06-18',
    session: 'ny-am',
    primary: 'MNQ1!',
    secondary: 'MES1!',
    leader: 'MES1!',
    method: 'smt',
    bias_dir: 'short',
    divergence: true,
    gap: 1.12,
    standaside: false,
    decided_at: '2026-06-18T13:50:00Z',
    evidence: { 'MNQ1!': { strength: 0.7 }, 'MES1!': { strength: -0.42 } },
    reason: 'smt_divergence',
  });
  const read = await readPairDecision(dir, '2026-06-18');
  assert.equal(read.method, 'smt');
  assert.equal(read.bias_dir, 'short');
  assert.equal(read.divergence, true);
  assert.equal(read.gap, 1.12);
  assert.equal(read.standaside, false);
  assert.equal(read.leader, 'MES1!');
  assert.equal(read.evidence['MES1!'].strength, -0.42);
});

test('stand-aside decision round-trips (no leader, flagged)', async () => {
  const dir = await mkdtmp();
  await writePairDecision(dir, {
    date: '2026-06-18', session: 'ny-am', primary: 'MNQ1!', secondary: 'MES1!',
    leader: null, method: 'smt', standaside: true, reason: 'smt_unreadable_data',
    decided_at: '2026-06-18T14:00:00Z',
  });
  const read = await readPairDecision(dir, '2026-06-18');
  assert.equal(read.standaside, true);
  assert.equal(read.leader, null);
  assert.equal(read.reason, 'smt_unreadable_data');
});

test('returns null when file does not exist', async () => {
  const dir = await mkdtmp();
  const read = await readPairDecision(dir, '2026-05-25');
  assert.equal(read, null);
});

test('returns null when file is stale (different date)', async () => {
  const dir = await mkdtmp();
  await writePairDecision(dir, {
    date: '2026-05-24',
    session: 'ny-am',
    primary: 'MNQ1!',
    secondary: 'MES1!',
    leader: 'MNQ1!',
    decided_at: '2026-05-24T13:45:00Z',
    evidence: { primary_disp_score: 0.82, secondary_disp_score: 0.54, margin: 0.28, threshold: 0.10 },
    reason: 'primary_higher_disp_score',
  });
  const read = await readPairDecision(dir, '2026-05-25');
  assert.equal(read, null);
});

test('writes atomically (no half-written file on a thrown serializer)', async () => {
  const dir = await mkdtmp();
  // Pass a payload with a circular ref to force JSON.stringify to throw.
  const bad = { date: '2026-05-25' };
  bad.self = bad;
  await assert.rejects(() => writePairDecision(dir, bad));
  // The target file should not exist (atomic = no partial file left behind).
  await assert.rejects(() => fs.stat(path.join(dir, 'pair-decision.json')));
});
