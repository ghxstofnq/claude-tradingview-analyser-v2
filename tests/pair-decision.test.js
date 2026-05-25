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
  assert.equal(read.schema, 1);
  assert.equal(read.evidence.margin, 0.28);
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
