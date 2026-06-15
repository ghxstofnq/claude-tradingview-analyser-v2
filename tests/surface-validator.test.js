// Deterministic-packet surface audit (single-brain, 2026-06-12). The walker
// chain is the only setup producer; surface_setup/surface_no_trade calls are
// audited against the chain's packet for the bar. The old detector-candidate
// validator was removed with the cli/lib/setup-detector.js live injection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  validateSetupAgainstDeterministicPacket,
  surfaceSetup,
  surfaceNoTrade,
  setCurrentDeterministicPacket,
  clearTurnAuditState,
  clearCurrentSurfaceState,
  getCurrentSurfaceState,
} from '../app/main/tools/surface.js';
import { setBacktestSessionContext, clearBacktestSessionContext, activeSessionDir } from '../app/main/sessions.js';

function executablePacket() {
  return {
    status: 'executable',
    finalVerdict: 'manual_candidate',
    model: 'Trend',
    side: 'long',
    grade: 'B',
    entry: { price: 21000, evidenceRef: 'packet.entry' },
    stop: { price: 20990, evidenceRef: 'packet.stop' },
    tp1: { price: 21020, evidenceRef: 'packet.tp1' },
  };
}

test('deterministic packet validator rejects Claude setup that differs from executable packet truth', () => {
  const packet = executablePacket();
  const valid = { model: 'Trend', side: 'long', grade: 'B', entry: 21000, stop: 20990, tp1: 21020 };
  assert.doesNotThrow(() => validateSetupAgainstDeterministicPacket(valid, packet));
  assert.throws(() => validateSetupAgainstDeterministicPacket({ ...valid, entry: 21001 }, packet), /entry.*deterministic packet/);
  assert.throws(() => validateSetupAgainstDeterministicPacket(valid, { ...packet, status: 'blocked', finalVerdict: 'no_trade' }), /no executable deterministic packet/);
});

test('surface_setup rejects when the chain produced no executable packet this bar', async () => {
  clearCurrentSurfaceState();
  setCurrentDeterministicPacket({ status: 'blocked', finalVerdict: 'no_trade', blockers: ['no_confirmed_packet'] });
  const payload = { model: 'MSS', side: 'long', entry: 29998.5, stop: 29981.25, tp1: 30015, grade: 'B' };
  await assert.rejects(
    () => surfaceSetup(payload),
    /no executable deterministic packet/i,
  );
  clearTurnAuditState();
  clearCurrentSurfaceState();
});

test('surface_no_trade rejects when an executable packet is active (packet truth must not be hidden)', async () => {
  clearCurrentSurfaceState();
  setCurrentDeterministicPacket(executablePacket());
  await assert.rejects(
    () => surfaceNoTrade({ reason: 'waiting' }),
    /executable deterministic packet is active/i,
  );
  clearTurnAuditState();
  clearCurrentSurfaceState();
});

test('surface_no_trade preserves structured blockers in UI state and append-only no-trade log', async () => {
  clearTurnAuditState();
  clearCurrentSurfaceState();
  const runId = `surface-no-trade-${Date.now()}`;
  setBacktestSessionContext({ runId, session: 'ny-am' });
  // Resolve via activeSessionDir so the read path tracks GOFNQ_STATE_DIR
  // (the test runner redirects the state root); hardcoding state/ would miss
  // the redirected write.
  const dir = await activeSessionDir();
  try {
    const result = await surfaceNoTrade({
      reason: 'cannot evaluate: strategy chain incomplete: missing_ltf_bias',
      evaluationStatus: 'cannot_evaluate_strategy_chain',
      blockers: ['missing_ltf_bias'],
      sourceHealth: { status: 'fresh', schemaSupported: true, stale: false, blockers: [] },
      strategyChainStatus: 'blocked',
      evidenceRefs: ['ltf-bias.md'],
      eventTimeUtc: '2026-06-03T14:31:00.000Z',
    });

    assert.equal(result.ok, true);
    assert.deepEqual(getCurrentSurfaceState().noTrade, {
      reason: 'cannot evaluate: strategy chain incomplete: missing_ltf_bias',
      evaluationStatus: 'cannot_evaluate_strategy_chain',
      blockers: ['missing_ltf_bias'],
      sourceHealth: { status: 'fresh', schemaSupported: true, stale: false, blockers: [] },
      strategyChainStatus: 'blocked',
      evidenceRefs: ['ltf-bias.md'],
      eventTimeUtc: '2026-06-03T14:31:00.000Z',
    });

    const lines = (await readFile(path.join(dir, 'no-trades.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.reason, 'cannot evaluate: strategy chain incomplete: missing_ltf_bias');
    assert.equal(record.evaluationStatus, 'cannot_evaluate_strategy_chain');
    assert.deepEqual(record.blockers, ['missing_ltf_bias']);
    assert.equal(record.sourceHealth.status, 'fresh');
    assert.equal(record.strategyChainStatus, 'blocked');
    assert.deepEqual(record.evidenceRefs, ['ltf-bias.md']);
    assert.equal(record.eventTimeUtc, '2026-06-03T14:31:00.000Z');
  } finally {
    clearBacktestSessionContext();
    clearCurrentSurfaceState();
    await rm(path.resolve('state', 'backtest', runId), { recursive: true, force: true });
  }
});
