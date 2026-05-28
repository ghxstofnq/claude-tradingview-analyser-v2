import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readWalkersJson, writeWalkersJson, parseMemorySkipLines } from '../../app/main/walker/walker-runtime.js';

test('runtime: readWalkersJson returns empty default when file missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walker-'));
  const state = readWalkersJson(tmpDir, 'ny-am');
  assert.deepEqual(state, { session: 'ny-am', walkers: [], triggers: [], proof: { last_1m_close: null, last_5m_close: null } });
  fs.rmSync(tmpDir, { recursive: true });
});

test('runtime: writeWalkersJson then readWalkersJson roundtrips', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walker-'));
  const s = { session: 'ny-am', walkers: [{ id: 'w1', model: 'MSS' }], triggers: [], proof: { last_1m_close: 1000, last_5m_close: 1000 } };
  writeWalkersJson(tmpDir, 'ny-am', s);
  const r = readWalkersJson(tmpDir, 'ny-am');
  assert.deepEqual(r, s);
  fs.rmSync(tmpDir, { recursive: true });
});

test('runtime: parseMemorySkipLines extracts walker-skip lines from MEMORY.md content', () => {
  const md = `# Memory\n- general note\n- walker-skip: MSS long AS.L\n- walker-skip: TREND short *\n- another note\n`;
  const lines = parseMemorySkipLines(md);
  assert.deepEqual(lines, ['walker-skip: MSS long AS.L', 'walker-skip: TREND short *']);
});

test('runtime: readWalkersJson recovers from corrupt JSON by returning empty default', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walker-'));
  const sessionDir = path.join(tmpDir, 'ny-am');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'walkers.json'), '{ invalid json');
  const state = readWalkersJson(tmpDir, 'ny-am');
  assert.deepEqual(state.walkers, []);
  fs.rmSync(tmpDir, { recursive: true });
});
