import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { __test } from '../cli/commands/live.js';

test('defaultTruthPathForSession points live-dry-run at current ET session deterministic truth', () => {
  const p = __test.defaultTruthPathForSession({
    session: 'ny-pm',
    nowMs: Date.parse('2026-06-02T22:28:34.490Z'),
  });

  assert.match(p, /state\/session\/2026-06-02\/ny-pm\/deterministic-packet\.json$/);
});

test('sessionFromOpts defaults to the active ET session instead of hard-coding NY-AM', () => {
  assert.equal(__test.sessionFromOpts({ now: '2026-06-02T17:30:00.000Z' }), 'ny-pm');
  assert.equal(__test.sessionFromOpts({ now: '2026-06-02T13:45:00.000Z' }), 'ny-am');
  assert.equal(__test.sessionFromOpts({ now: '2026-06-02T07:30:00.000Z' }), 'london');
  assert.equal(__test.sessionFromOpts({ now: '2026-06-02T11:13:00.000Z' }), 'idle');
});

test('persistDryRunSessionRecord writes blocked dry-run verdicts to session-local no-trades and deterministic truth', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'live-dry-run-session-'));
  const sessionDir = path.join(dir, 'state', 'session', '2026-06-04', 'ny-am');
  try {
    const record = {
      mode: 'live-dry-run',
      actionable: false,
      finalVerdict: 'cannot_evaluate_source_health',
      eventTimeUtc: '2026-06-04T13:38:00.000Z',
      bestPacket: null,
      blockers: ['stale_source', 'bars_not_updating'],
      summary: 'Source health blocked: stale_source, bars_not_updating',
      truthPath: path.join(sessionDir, 'deterministic-packet.json'),
    };

    await __test.persistDryRunSessionRecord({ record, sessionDir, writtenAt: '2026-06-04T13:55:18.997Z' });

    const deterministic = JSON.parse(await readFile(path.join(sessionDir, 'deterministic-packet.json'), 'utf8'));
    assert.equal(deterministic.finalVerdict, 'cannot_evaluate_source_health');
    assert.equal(deterministic.evaluationStatus, 'cannot_evaluate_source_health');
    assert.deepEqual(deterministic.blockers, ['stale_source', 'bars_not_updating']);
    assert.equal(deterministic.bestPacket, null);

    const noTradeLines = (await readFile(path.join(sessionDir, 'no-trades.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(noTradeLines.length, 1);
    const noTrade = JSON.parse(noTradeLines[0]);
    assert.equal(noTrade.finalVerdict, 'cannot_evaluate_source_health');
    assert.equal(noTrade.reason, 'Source health blocked: stale_source, bars_not_updating');
    assert.deepEqual(noTrade.blockers, ['stale_source', 'bars_not_updating']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
