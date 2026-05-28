import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceCap } from '../../app/main/walker/walker-cap.js';

test('cap: below max, returns unchanged', () => {
  const ws = [{ id: 'a', created_at: 1 }, { id: 'b', created_at: 2 }];
  assert.deepEqual(enforceCap(ws, 4), ws);
});

test('cap: at max + 1, evicts oldest', () => {
  const ws = [
    { id: 'a', created_at: 1 },
    { id: 'b', created_at: 2 },
    { id: 'c', created_at: 3 },
    { id: 'd', created_at: 4 },
    { id: 'e', created_at: 5 },
  ];
  const capped = enforceCap(ws, 4);
  assert.equal(capped.length, 4);
  assert.equal(capped.find((w) => w.id === 'a'), undefined);
});

test('cap: never evicts walkers past confirmation stage', () => {
  const ws = [
    { id: 'a', created_at: 1, stage: 'spawn' },
    { id: 'b', created_at: 2, stage: 'spawn' },
    { id: 'c', created_at: 3, stage: 'confirmation' },
    { id: 'd', created_at: 4, stage: 'spawn' },
    { id: 'e', created_at: 5, stage: 'spawn' },
  ];
  const capped = enforceCap(ws, 4);
  assert.ok(capped.find((w) => w.id === 'c'), 'must keep confirmation-stage walker');
  assert.equal(capped.length, 4);
});
