// Single-brain entry hunt (2026-06-12): the walker chain is the only setup
// producer; the per-bar LLM turn narrates the chain's verdict and never
// surfaces. Source: docs/research/ai-trading-analysis.md — "deterministic
// extraction → LLM synthesis: code identifies structure; the LLM interprets
// and contextualizes." These tests lock the gating + prompt contract.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRunNarrationTurn,
  buildWalkerTruthBlock,
  entryHuntNarrationHint,
  walkersSignatureChanged,
  __test,
} from '../app/main/bar-close.js';

describe('shouldRunNarrationTurn', () => {
  test('packet bar always narrates', () => {
    assert.equal(shouldRunNarrationTurn({ truth: { bestPacket: { model: 'MSS' } }, ev: { tf: '1m' } }), true);
  });

  test('walker stage change narrates', () => {
    assert.equal(shouldRunNarrationTurn({ truth: { bestPacket: null, walkersChanged: true }, ev: { tf: '1m' } }), true);
  });

  test('5m close narrates even when quiet (strategy confirmation TF)', () => {
    assert.equal(shouldRunNarrationTurn({ truth: { bestPacket: null, walkersChanged: false }, ev: { tf: '5m', is_5m_close: true } }), true);
  });

  test('quiet 1m bar skips the LLM turn entirely', () => {
    assert.equal(shouldRunNarrationTurn({ truth: { bestPacket: null, walkersChanged: false }, ev: { tf: '1m', is_5m_close: false } }), false);
  });

  test('missing truth narrates (fail-open so chain failures stay visible)', () => {
    assert.equal(shouldRunNarrationTurn({ truth: null, ev: { tf: '1m' } }), true);
  });
});

describe('walkersSignatureChanged', () => {
  const w = (id, stage) => ({ id, stage, model: 'MSS', side: 'short' });

  test('same walkers in different order → unchanged', () => {
    assert.equal(walkersSignatureChanged([w('a', 'tap_seen'), w('b', 'watching')], [w('b', 'watching'), w('a', 'tap_seen')]), false);
  });

  test('stage advance → changed', () => {
    assert.equal(walkersSignatureChanged([w('a', 'tap_seen')], [w('a', 'confirmation_pending')]), true);
  });

  test('walker spawned → changed; both empty → unchanged', () => {
    assert.equal(walkersSignatureChanged([], [w('a', 'pd_identified')]), true);
    assert.equal(walkersSignatureChanged([], []), false);
  });
});

describe('buildWalkerTruthBlock', () => {
  test('compact block carries verdict, packet prices, walker stages — no rawPayload', () => {
    const truth = {
      finalVerdict: 'manual_candidate',
      noTradeReason: null,
      blockers: [],
      bestPacket: {
        model: 'Inversion', side: 'short', grade: 'B',
        entry: { price: 29792, rawPayload: { huge: 'x'.repeat(500) } },
        stop: { price: 29847, kind: 'inversion_structural_swing' },
        tp1: { price: 29302.5, rMultiple: 8.9 },
      },
      walkers: [{ id: 'a', model: 'Inversion', side: 'short', stage: 'packet_ready', evidence: { big: true } }],
    };
    const block = buildWalkerTruthBlock(truth);
    assert.match(block, /<walker_truth>/);
    assert.match(block, /"entry": 29792/);
    assert.match(block, /"stop": 29847/);
    assert.match(block, /"stop_kind": "inversion_structural_swing"/);
    assert.match(block, /"stage": "packet_ready"/);
    assert.ok(!block.includes('rawPayload'), 'rawPayload must not leak into the prompt');
    assert.ok(!block.includes('evidence'), 'walker evidence must not leak into the prompt');
  });

  test('null truth produces an explicit chain_error block, not silence', () => {
    const block = buildWalkerTruthBlock(null);
    assert.match(block, /<walker_truth>/);
    assert.match(block, /chain_error/);
  });
});

describe('entryHuntNarrationHint', () => {
  test('forbids surfacing, points at walker_truth, never mentions candidate_object', () => {
    const hint = entryHuntNarrationHint();
    assert.match(hint, /walker_truth/);
    assert.match(hint, /DO NOT call surface_setup/i);
    assert.match(hint, /DO NOT call .*surface_no_trade|surface_no_trade/i);
    assert.ok(!hint.includes('candidate_object'), 'old detector contract must be gone');
    assert.ok(!/Read state\/last-scan/.test(hint));
  });
});

describe('truth carries walkersChanged', () => {
  test('chain-incomplete early return reports walkersChanged=false', () => {
    const truth = __test.buildDeterministicPacketTruthFromInputs({
      inputs: { bundle: { gates: { engine: {} } } },
      previousWalkers: [],
      event: { ts: '2026-06-12T13:31:00.000Z', tf: '1m' },
      session: 'ny-am',
    });
    assert.equal(truth.finalVerdict, 'no_trade');
    assert.equal(truth.walkersChanged, false);
  });
});
