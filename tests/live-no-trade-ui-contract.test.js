import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { normalizeNoTradePayload, noTradeStatusLabel } from '../app/renderer/src/hooks/useActiveSetup.helpers.js';

const livePopoverSource = readFileSync(new URL('../app/renderer/src/LivePopover.jsx', import.meta.url), 'utf8');

test('normalizeNoTradePayload preserves structured cannot-evaluate blockers for the live UI', () => {
  const payload = {
    reason: 'cannot evaluate: strategy chain incomplete: missing_ltf_bias',
    evaluationStatus: 'cannot_evaluate_strategy_chain',
    blockers: ['missing_ltf_bias'],
    sourceHealth: { status: 'fresh', schemaSupported: true, stale: false, blockers: [] },
    strategyChainStatus: 'blocked',
    evidenceRefs: ['ltf-bias.md'],
    eventTimeUtc: '2026-06-03T14:31:00.000Z',
  };

  assert.deepEqual(normalizeNoTradePayload(payload, 1780497060000), {
    reason: 'cannot evaluate: strategy chain incomplete: missing_ltf_bias',
    evaluationStatus: 'cannot_evaluate_strategy_chain',
    blockers: ['missing_ltf_bias'],
    sourceHealth: { status: 'fresh', schemaSupported: true, stale: false, blockers: [] },
    strategyChainStatus: 'blocked',
    evidenceRefs: ['ltf-bias.md'],
    eventTimeUtc: '2026-06-03T14:31:00.000Z',
    receivedAtMs: 1780497060000,
  });
});

test('noTradeStatusLabel distinguishes cannot-evaluate from ordinary no-trade', () => {
  assert.equal(noTradeStatusLabel({ evaluationStatus: 'cannot_evaluate_source_health' }), 'cannot evaluate');
  assert.equal(noTradeStatusLabel({ evaluationStatus: 'cannot_evaluate_strategy_chain' }), 'cannot evaluate');
  assert.equal(noTradeStatusLabel({ evaluationStatus: 'no_trade' }), 'no-trade');
  assert.equal(noTradeStatusLabel({ blockers: ['missing_confirmation_close'] }), 'no-trade');
});

test('LivePopover entry-hunt view renders structured no-trade blockers, source health, and evidence refs', () => {
  assert.match(livePopoverSource, /noTrade\?\.blockers/);
  assert.match(livePopoverSource, /NO-TRADE BLOCKERS/);
  assert.match(livePopoverSource, /SOURCE HEALTH/);
  assert.match(livePopoverSource, /EVIDENCE REFS/);
});
