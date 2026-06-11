import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearTurnAuditState,
  setCurrentDeterministicPacket,
  surfaceNoTrade,
  validateSetupAgainstDeterministicPacket,
} from '../app/main/tools/surface.js';

describe('deterministic packet surface lock', () => {
  test('surface_no_trade rejects when executable deterministic packet is active', async () => {
    clearTurnAuditState();
    setCurrentDeterministicPacket({ status: 'executable', finalVerdict: 'manual_candidate' });
    await assert.rejects(
      () => surfaceNoTrade({ reason: 'model disagrees' }),
      /executable deterministic packet is active/,
    );
    clearTurnAuditState();
  });

  test('surface_setup payload must match deterministic packet prices and metadata', () => {
    const packet = {
      status: 'executable',
      finalVerdict: 'manual_candidate',
      model: 'MSS',
      side: 'long',
      grade: 'B',
      entry: { price: 100.25 },
      stop: { price: 99.75 },
      tp1: { price: 101.25 },
    };
    assert.doesNotThrow(() => validateSetupAgainstDeterministicPacket({
      model: 'MSS', side: 'long', grade: 'B', entry: 100.25, stop: 99.75, tp1: 101.25,
    }, packet));
    assert.throws(() => validateSetupAgainstDeterministicPacket({
      model: 'Trend', side: 'long', grade: 'B', entry: 100.25, stop: 99.75, tp1: 101.25,
    }, packet), /deterministic packet validation failed/);
  });
});
