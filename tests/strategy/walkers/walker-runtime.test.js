import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readWalkersJson,
  resolveWalkersJsonPath,
  writeWalkersJson,
} from '../../../app/main/strategy/walkers/walker-runtime.js';

test('resolveWalkersJsonPath writes directly under active session directory', async () => {
  const sessionDir = path.join(os.tmpdir(), 'state', 'session', '2026-05-29', 'ny-am');

  const resolved = resolveWalkersJsonPath(sessionDir);

  assert.equal(resolved, path.join(sessionDir, 'walkers.json'));
  assert.equal(resolved.includes(path.join('ny-am', 'ny-am', 'walkers.json')), false);
});

test('readWalkersJson returns empty state for a missing walkers file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'walker-runtime-'));
  try {
    const state = await readWalkersJson(path.join(root, 'state', 'session', '2026-05-29', 'ny-am'));
    assert.deepEqual(state, { schemaVersion: 1, walkers: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writeWalkersJson writes atomically and leaves no temp files behind', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'walker-runtime-'));
  try {
    const sessionDir = path.join(root, 'state', 'session', '2026-05-29', 'ny-am');
    const state = {
      schemaVersion: 1,
      walkers: [
        { id: 'walker_mnq_mss', market: 'MNQ1!', session: 'ny-am', stage: 'watching' },
      ],
    };

    await writeWalkersJson(sessionDir, state);

    const resolved = resolveWalkersJsonPath(sessionDir);
    assert.equal(existsSync(resolved), true);
    assert.deepEqual(JSON.parse(await readFile(resolved, 'utf8')), state);
    const roundTrip = await readWalkersJson(sessionDir);
    assert.deepEqual(roundTrip, state);

    const sessionFiles = await import('node:fs/promises').then((fs) => fs.readdir(sessionDir));
    assert.deepEqual(sessionFiles.filter((name) => name.includes('.tmp.')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('readWalkersJson fails closed on malformed persisted state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'walker-runtime-'));
  try {
    const sessionDir = path.join(root, 'state', 'session', '2026-05-29', 'ny-am');
    await writeWalkersJson(sessionDir, { schemaVersion: 1, walkers: 'not-array' });

    const state = await readWalkersJson(sessionDir);

    assert.equal(state.schemaVersion, 1);
    assert.deepEqual(state.walkers, []);
    assert.deepEqual(state.blockers, ['malformed_walkers_state']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
