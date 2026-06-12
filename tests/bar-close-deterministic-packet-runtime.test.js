import assert from 'node:assert/strict';
import test from 'node:test';

import { __test } from '../app/main/bar-close.js';

const confirmedWalker = {
  id: 'w_MNQ1__ny-am_MSS_long_pdlargebull',
  market: 'MNQ1!',
  session: 'ny-am',
  model: 'MSS',
  side: 'long',
  stage: 'confirmed',
  chain: 'MSS_standard',
  pdArrayRef: 'pd.large.bull',
  evidence: {
    pdArray: {
      evidenceRef: 'pd.large.bull',
      rawPayload: { evidenceRef: 'pd.large.bull', kind: 'fvg', dir: 'bull', direction: 'bullish', state: 'fresh', size_quality: 'large' },
    },
    confirmation: {
      evidenceRef: 'confirm.close',
      rawPayload: { close: 21000, confirm_ms: 1780062420000, entry_state: 'confirmed', confirm_close: 1, ce_held: 1, chop_15m: 0, confirm_dir: 'bull' },
    },
  },
};

function runtimeInputs() {
  return {
    leader: 'MNQ1!',
    ltf_bias_context: {
      bias: 'bullish',
      htf_ltf_alignment: 'aligned',
      is_retrace_day: false,
      entry_model_priority: 'MSS',
      grade_cap: 'A+',
    },
    session_state: {
      pillar1: { status: 'pass', htfBias: 'bullish', htfDraw: 'above PDH', primaryDraw: 'PDH' },
      pillar2: { status: 'pass', verdict: 'pass' },
    },
    untaken_targets: { untaken_above: [{ evidenceRef: 'target.pdh', label: 'PDH', price: 21050 }], untaken_below: [] },
    bundle: {
      chart: { symbol: 'CME_MINI:MNQ1!' },
      brief_digest: { htf_destination: 'above PDH', primary_draw: 'PDH' },
      gates: {
        engine: {
          meta: { schema_supported: true, stale: false },
          rows: [{ evidenceRef: 'pd.large.bull', kind: 'fvg', dir: 'bull', state: 'fresh', size_quality: 'large' }],
          pillar2: { current_tf: { candle: 'clean', displacement: 'clean' }, chop_15m: 0 },
          pillar3: { structural_stops: [{ evidenceRef: 'stop.mss_swing_low', kind: 'mss_swing_low', price: 20990 }] },
        },
      },
      bars: { last_5_bars: [] },
      bars_by_tf: { m5: { last_5_bars: [] } },
    },
  };
}

test('buildDeterministicPacketTruthFromInputs promotes confirmed walker into surfaced deterministic packet payload', () => {
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs: runtimeInputs(),
    previousWalkers: [confirmedWalker],
    event: { ts: '2026-05-29T13:45:00.000Z', tf: '1m' },
    session: 'ny-am',
  });

  assert.equal(truth.finalVerdict, 'manual_candidate');
  assert.equal(truth.bestPacket.status, 'executable');
  assert.equal(truth.surfacePayload.entry, 21000);
  assert.equal(truth.surfacePayload.stop, 20990);
  assert.equal(truth.surfacePayload.tp1, 21050);
  assert.equal(truth.surfacePayload.model, 'MSS');
  assert.equal(truth.surfacePayload.side, 'long');
  assert.equal(truth.surfacePayload.grade, 'A+');
  assert.equal(truth.surfacePayload.executionPacket, truth.bestPacket);
  assert.equal(truth.events.length >= 1, true);
});

test('deterministicPacketToSurfacePayload derives fallback setup id from event time, not wall-clock time', () => {
  const packet = {
    model: 'MSS',
    side: 'long',
    entry: { price: 21000, evidenceRef: 'confirm.close' },
    stop: { price: 20990, evidenceRef: 'stop.mss_swing_low' },
    tp1: { price: 21050, evidenceRef: 'target.pdh', rMultiple: 5 },
    grade: 'A+',
  };

  const originalNow = Date.now;
  try {
    Date.now = () => 1111111111111;
    const first = __test.deterministicPacketToSurfacePayload(packet, { ts: '2026-05-29T13:45:00.000Z', tf: '1m' });
    Date.now = () => 2222222222222;
    const second = __test.deterministicPacketToSurfacePayload(packet, { ts: '2026-05-29T13:45:00.000Z', tf: '1m' });

    assert.equal(first.id, second.id);
    assert.equal(first.id, 'D-20260529T1345');
  } finally {
    Date.now = originalNow;
  }
});

test('buildDeterministicPacketTruthFromInputs emits blocked no-trade reason instead of executable setup when packet is not ready', () => {
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs: runtimeInputs(),
    previousWalkers: [],
    event: { ts: '2026-05-29T13:45:00.000Z', tf: '1m' },
    session: 'ny-am',
  });

  assert.equal(truth.finalVerdict, 'no_trade');
  assert.equal(truth.evaluationStatus, 'evaluated');
  assert.equal(truth.bestPacket, null);
  assert.equal(truth.surfacePayload, null);
  assert.match(truth.noTradeReason, /deterministic packet blocked/);
});

test('buildDeterministicPacketTruthFromInputs labels source-health failure as cannot-evaluate, not an ordinary no-trade', () => {
  const inputs = runtimeInputs();
  inputs.bundle.gates.engine.meta.stale = true;

  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs,
    previousWalkers: [],
    event: { ts: '2026-05-29T13:45:00.000Z', tf: '1m' },
    session: 'ny-am',
  });

  assert.equal(truth.finalVerdict, 'no_trade');
  assert.equal(truth.evaluationStatus, 'cannot_evaluate_source_health');
  assert.deepEqual(truth.blockers, ['stale_source']);
  assert.match(truth.noTradeReason, /^cannot evaluate: source health failed: stale_source/);
  assert.equal(truth.bestPacket, null);
});

test('buildDeterministicPacketTruthFromInputs cannot evaluate when live chain is missing open-reaction ltf bias', () => {
  const inputs = runtimeInputs();
  delete inputs.ltf_bias_context;

  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs,
    previousWalkers: [confirmedWalker],
    event: { ts: '2026-05-29T13:45:00.000Z', tf: '1m' },
    session: 'ny-am',
  });

  assert.equal(truth.finalVerdict, 'no_trade');
  assert.equal(truth.evaluationStatus, 'cannot_evaluate_strategy_chain');
  assert.deepEqual(truth.blockers, ['missing_ltf_bias', 'missing_htf_ltf_alignment', 'missing_entry_model_priority', 'missing_grade_cap']);
  assert.equal(truth.bestPacket, null);
  assert.match(truth.noTradeReason, /strategy chain incomplete: missing_ltf_bias/);
});

test('buildDeterministicPacketTruthFromInputs cannot evaluate when prep pillar verdicts are missing', () => {
  const inputs = runtimeInputs();
  delete inputs.session_state;

  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs,
    previousWalkers: [confirmedWalker],
    event: { ts: '2026-05-29T13:45:00.000Z', tf: '1m' },
    session: 'ny-am',
  });

  assert.equal(truth.evaluationStatus, 'cannot_evaluate_strategy_chain');
  assert.deepEqual(truth.blockers, ['missing_pillar1_state', 'missing_pillar2_state']);
  assert.equal(truth.bestPacket, null);
});

test('buildDeterministicPacketTruthFromInputs enforces open-reaction grade cap on deterministic packet', () => {
  const inputs = runtimeInputs();
  inputs.ltf_bias_context.grade_cap = 'B';

  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs,
    previousWalkers: [confirmedWalker],
    event: { ts: '2026-05-29T13:45:00.000Z', tf: '1m' },
    session: 'ny-am',
  });

  assert.equal(truth.finalVerdict, 'manual_candidate');
  assert.equal(truth.bestPacket.status, 'executable');
  assert.equal(truth.bestPacket.grade, 'B');
  assert.equal(truth.surfacePayload.grade, 'B');
});

// entry_model_priority is a SELECTION preference, not a hard gate — the
// resolver spec (strategy-chain design §3.4) defines it as "which model to
// walk first" and §7 Step 5 keeps all three models playable. June 9 replay:
// the hard block discarded the hand-verified A+ Inversion short because
// in-window failure swings pointed the resolver at MSS.
test('non-priority model still surfaces when it is the only executable packet', () => {
  const inputs = runtimeInputs();
  inputs.ltf_bias_context.entry_model_priority = 'Trend';

  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs,
    previousWalkers: [confirmedWalker],
    event: { ts: '2026-05-29T13:45:00.000Z', tf: '1m' },
    session: 'ny-am',
  });

  assert.equal(truth.finalVerdict, 'manual_candidate');
  assert.equal(truth.bestPacket.model, 'MSS');
  assert.ok(!truth.bestPacket.blockers?.includes?.('entry_model_priority_blocked'));
});

// ---- live-bundle evidence bridge (2026-06-12) -------------------------------
// June 5's deterministic-packets.jsonl shows every live bar blocked with
// missing_ict_engine_rows: computeEngineGates never emitted gates.engine.rows,
// the V2 entry-state confirmation row, or pillar3.structural_stops — the three
// shapes the strategy context consumes. These tests feed the runtime a bundle
// shaped exactly like the live scan (cli/lib/compute-engine-gates.js output)
// and require the runtime to bridge the evidence instead of failing closed.

function liveShapedInputs({ fvgRow, swings = { swing: [], internal: [] }, lastBarClose = 29718.5 } = {}) {
  return {
    leader: 'MNQ1!',
    ltf_bias_context: {
      bias: 'bearish', htf_ltf_alignment: 'aligned', is_retrace_day: false,
      entry_model_priority: 'Inversion', grade_cap: 'A+',
    },
    session_state: {
      pillar1: { status: 'pass', htfBias: 'bearish', htfDraw: 'below PDL', primaryDraw: 'PDL' },
      pillar2: { status: 'pass', verdict: 'pass' },
    },
    untaken_targets: {
      untaken_above: [],
      untaken_below: [
        { price: 29302.5, name: 'label_tp1', cite: 'label.expected.tp1' },
        { price: 28779, name: 'label_tp2', cite: 'label.expected.tp2' },
      ],
    },
    bundle: {
      chart: { symbol: 'CME_MINI:MNQ1!' },
      quote: { last: lastBarClose, time: 1781013240 },
      bars: { last_5_bars: [] },
      bars_by_tf: { m5: { last_5_bars: [] } },
      gates: {
        engine: {
          // exactly what computeEngineGates emits: no rows, no entry-state
          // confirmation, no structural_stops
          meta: { schema: 2, schema_supported: true, stale: false, tf: '1' },
          price_context: { last: lastBarClose, inside_fvgs: fvgRow ? [fvgRow] : [], inside_bprs: [] },
          pillar1: { sweeps: [{ target: 'NYAM_H', price: 29847, side: 'buy', rejected: true, swept_ms: 1781012940000 }] },
          pillar2: { current_tf: { range_3h: 213.75, range_quality: 'good', displacement: 'clean', candle: 'clean' } },
          pillar3: {
            fvgs: fvgRow ? [fvgRow] : [],
            bprs: [],
            swings,
            failure_swings: [],
            most_recent_structure: null,
            fvg_summary: { size_quality: fvgRow?.size_quality ?? null },
          },
          confirmation: {
            last_bar: { time: 1781013240, close: lastBarClose, direction: 'bearish', body_ratio: 0.8 },
            last_bar_age_seconds: 4,
            m5_last_bar: null,
            m15_last_bar: null,
          },
        },
      },
    },
  };
}

const bullZone = {
  kind: 'fvg', dir: 'bull', state: 'fresh', size_quality: 'medium',
  top: 29759.75, bottom: 29730.75, ce: 29745.25, created_ms: 1781013000000,
};

test('live-shaped bundle: rows bridged from pillar3 zones — walkers spawn instead of missing_ict_engine_rows', () => {
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs: liveShapedInputs({ fvgRow: bullZone }),
    previousWalkers: [],
    event: { ts: '2026-06-09T13:51:00.000Z', tf: '1m' },
    session: 'ny-am',
  });
  assert.ok(!truth.blockers?.includes('missing_ict_engine_rows'),
    `rows not bridged: ${JSON.stringify(truth.blockers)}`);
  assert.equal(truth.sourceHealth.status, 'fresh');
  const inversionShort = truth.walkers.find((w) => w.model === 'Inversion' && w.side === 'short');
  assert.ok(inversionShort, `no Inversion short walker spawned: ${JSON.stringify(truth.walkers.map((w) => `${w.model}:${w.side}:${w.stage}`))}`);
});

test('live-shaped bundle: V2 confirmed zone bridges a confirmation row and the packet fires with swing-high stop', () => {
  const confirmedZone = {
    ...bullZone,
    entry_state: 'confirmed', confirm_close: true, confirm_dir: 'bear',
    confirm_ms: 1781013240000, ce_held: true, chop_15m: false,
  };
  const walker = {
    id: 'w_MNQ1__ny-am_Inversion_short_zone', market: 'MNQ1!', session: 'ny-am',
    model: 'Inversion', side: 'short', stage: 'tap_seen', chain: 'Inversion_standard',
    pdArrayRef: 'gates.engine.rows[0]',
    evidence: { pdArray: { evidenceRef: 'gates.engine.rows[0]', rawPayload: bullZone } },
  };
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs: liveShapedInputs({
      fvgRow: confirmedZone,
      swings: { swing: [{ kind: 'LH', price: 29847, is_high: true, bar_ms: 1781012940000 }], internal: [] },
      lastBarClose: 29718.5, // full close through the zone bottom 29730.75
    }),
    previousWalkers: [walker],
    event: { ts: '2026-06-09T13:55:00.000Z', tf: '1m' },
    session: 'ny-am',
  });
  assert.ok(truth.bestPacket, `no packet: blockers=${JSON.stringify(truth.blockers)} walkers=${JSON.stringify(truth.walkers.map((w) => `${w.model}:${w.side}:${w.stage}`))}`);
  assert.equal(truth.surfacePayload.side, 'short');
  assert.equal(truth.surfacePayload.model, 'Inversion');
  assert.equal(truth.surfacePayload.entry, 29718.5);
  // GXNQ ruling 2026-06-12 + trading-strategy-2026.md §6 ("structural
  // invalidation — low/high of PD array or swing"): the Inversion stop is
  // the structural swing high beyond the violated zone (29847), not the
  // zone top and not the nearest micro pivot.
  assert.equal(truth.surfacePayload.stop, 29847);
  assert.equal(truth.surfacePayload.tp1, 29302.5);
});

test('live-shaped bundle: bar-facts confirmation block alone never fakes a confirmed entry', () => {
  const walker = {
    id: 'w_MNQ1__ny-am_Inversion_short_zone2', market: 'MNQ1!', session: 'ny-am',
    model: 'Inversion', side: 'short', stage: 'tap_seen', chain: 'Inversion_standard',
    pdArrayRef: 'gates.engine.rows[0]',
    evidence: { pdArray: { evidenceRef: 'gates.engine.rows[0]', rawPayload: bullZone } },
  };
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs: liveShapedInputs({ fvgRow: bullZone }), // zone present, NOT confirmed
    previousWalkers: [walker],
    event: { ts: '2026-06-09T13:52:00.000Z', tf: '1m' },
    session: 'ny-am',
  });
  assert.equal(truth.bestPacket, null);
  const still = truth.walkers.find((w) => w.id === walker.id);
  assert.ok(still && still.stage !== 'confirmed', `walker must not confirm on bar-facts: ${JSON.stringify(still?.stage)}`);
});

// ---- stable zone identity + violation-close confirmation (2026-06-12) ------
// The real June 9 replay tape showed two more live gaps: (1) bridged rows used
// array-index evidence refs, so the same zone got a new walker identity every
// bar (50+ duplicate walkers, taps never matched); (2) the engine flips a
// violated zone to state=inverted but only emits entry_state=confirmed for
// CE-retest entries — a blast-through close (entry-models.md Inversion,
// aggressive variant: "enter on the initial close that violated the FVG")
// never produces a confirmation row. Both fixed in bridgeEngineEvidence.

test("bridge: zone evidence refs are boundary-based, so re-indexed zone lists do not spawn duplicate walkers", () => {
  const otherZone = { kind: 'fvg', dir: 'bull', state: 'fresh', size_quality: 'small', top: 29900, bottom: 29890, ce: 29895, created_ms: 1781012000000 };
  const bar1 = liveShapedInputs({ fvgRow: bullZone });
  bar1.bundle.gates.engine.pillar3.fvgs = [otherZone, bullZone]; // bullZone at index 1
  const truth1 = __test.buildDeterministicPacketTruthFromInputs({
    inputs: bar1, previousWalkers: [], event: { ts: '2026-06-09T13:51:00.000Z', tf: '1m' }, session: 'ny-am',
  });
  const bar2 = liveShapedInputs({ fvgRow: bullZone });
  bar2.bundle.gates.engine.pillar3.fvgs = [bullZone, otherZone]; // re-indexed: bullZone now 0
  const truth2 = __test.buildDeterministicPacketTruthFromInputs({
    inputs: bar2, previousWalkers: truth1.walkers, event: { ts: '2026-06-09T13:52:00.000Z', tf: '1m' }, session: 'ny-am',
  });
  const shortsFor = (walkers) => walkers.filter((w) => w.model === 'Inversion' && w.side === 'short');
  assert.equal(shortsFor(truth2.walkers).length, shortsFor(truth1.walkers).length,
    `re-indexing spawned duplicates: ${JSON.stringify(truth2.walkers.map((w) => w.id))}`);
});

test("bridge: a close through an inverted zone synthesizes the confirmation row and fires the packet", () => {
  const invertedZone = {
    ...bullZone, kind: 'ifvg', dir: 'bear', state: 'inverted',
    entry_state: 'none', confirm_close: false, confirm_dir: 'none',
  };
  const walker = {
    id: 'w_MNQ1__ny-am_Inversion_short_zone297307529759-75', market: 'MNQ1!', session: 'ny-am',
    model: 'Inversion', side: 'short', stage: 'pd_identified', chain: 'Inversion_standard',
    pdArrayRef: 'zone:29730.75-29759.75',
    evidence: { pdArray: { evidenceRef: 'zone:29730.75-29759.75', rawPayload: bullZone } },
  };
  const inputs = liveShapedInputs({
    fvgRow: invertedZone,
    swings: { swing: [{ kind: 'LH', price: 29847, is_high: true, bar_ms: 1781012940000 }], internal: [] },
    lastBarClose: 29718.5, // closes below the zone bottom 29730.75
  });
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs, previousWalkers: [walker], event: { ts: '2026-06-09T13:55:00.000Z', tf: '1m' }, session: 'ny-am',
  });
  assert.ok(truth.bestPacket, `no packet: blockers=${JSON.stringify(truth.blockers)} walkers=${JSON.stringify(truth.walkers.map((w) => `${w.model}:${w.side}:${w.stage}`))}`);
  assert.equal(truth.surfacePayload.side, 'short');
  assert.equal(truth.surfacePayload.entry, 29718.5);
  // GXNQ ruling 2026-06-12 + trading-strategy-2026.md §6: the Inversion
  // stop is the structural swing high beyond the violated zone — here the
  // 29847 pivot, matching the hand-verified June 9 snapshot case.
  assert.equal(truth.surfacePayload.stop, 29847);
});

test("bridge: a stale opposite-direction inverted zone cannot mask the bar's real confirmation", () => {
  // Reproduces the June 9 tape failure: an old bull-inverted zone from the
  // opening bounce satisfied close>top on every later bar, so first-match
  // synthesis emitted confirm_dir=bull and shorts never confirmed. The
  // bar's own direction must key the search.
  const staleBullInverted = {
    kind: 'ifvg', dir: 'bull', state: 'inverted', size_quality: 'small',
    top: 29661, bottom: 29660.75, ce: 29660.9, created_ms: 1781011900000,
  };
  const bearInverted = {
    ...bullZone, kind: 'ifvg', dir: 'bear', state: 'inverted', entry_state: 'none',
  };
  const walker = {
    id: 'w_MNQ1__ny-am_Inversion_short_zone3', market: 'MNQ1!', session: 'ny-am',
    model: 'Inversion', side: 'short', stage: 'pd_identified', chain: 'Inversion_standard',
    pdArrayRef: 'zone:29730.75-29759.75',
    evidence: { pdArray: { evidenceRef: 'zone:29730.75-29759.75', rawPayload: bullZone } },
  };
  const inputs = liveShapedInputs({ fvgRow: bearInverted, lastBarClose: 29718.5 });
  // stale bull zone FIRST in row order — used to win the find()
  inputs.bundle.gates.engine.pillar3.fvgs = [staleBullInverted, bearInverted];
  inputs.bundle.gates.engine.confirmation.last_bar.direction = 'bearish';
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs, previousWalkers: [walker], event: { ts: '2026-06-09T13:55:00.000Z', tf: '1m' }, session: 'ny-am',
  });
  assert.ok(truth.bestPacket, `short must confirm despite stale bull zone: ${JSON.stringify(truth.blockers)}`);
  assert.equal(truth.surfacePayload.side, 'short');
});

test("bridge: a close still INSIDE an inverted zone synthesizes nothing — no early entry", () => {
  const invertedZone = { ...bullZone, kind: 'ifvg', dir: 'bear', state: 'inverted', entry_state: 'none' };
  const walker = {
    id: 'w_MNQ1__ny-am_Inversion_short_inside', market: 'MNQ1!', session: 'ny-am',
    model: 'Inversion', side: 'short', stage: 'pd_identified', chain: 'Inversion_standard',
    pdArrayRef: 'zone:29730.75-29759.75',
    evidence: { pdArray: { evidenceRef: 'zone:29730.75-29759.75', rawPayload: bullZone } },
  };
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs: liveShapedInputs({ fvgRow: invertedZone, lastBarClose: 29740 }), // inside the zone
    previousWalkers: [walker],
    event: { ts: '2026-06-09T13:54:00.000Z', tf: '1m' }, session: 'ny-am',
  });
  assert.equal(truth.bestPacket, null);
});

test("bridge: a stale engine-confirmed row from an earlier bar never bridges this bar's confirmation", () => {
  // The engine table is a historical record: entry_state stays 'confirmed'
  // long after the confirming bar (June 9 tape: a 13:41 bull confirm masked
  // the 13:55 bearish violation). Only confirm_ms inside the current bar
  // counts as confirmation evidence.
  const staleConfirmed = {
    ...bullZone,
    entry_state: 'confirmed', confirm_close: true, confirm_dir: 'bull',
    confirm_ms: 1781012460000, // 13:41Z — fourteen bars earlier
    ce_held: true, chop_15m: false,
  };
  const walker = {
    id: 'w_MNQ1__ny-am_Inversion_short_stale', market: 'MNQ1!', session: 'ny-am',
    model: 'Inversion', side: 'short', stage: 'pd_identified', chain: 'Inversion_standard',
    pdArrayRef: 'zone:29730.75-29759.75',
    evidence: { pdArray: { evidenceRef: 'zone:29730.75-29759.75', rawPayload: bullZone } },
  };
  // The same bar ALSO carries a genuinely violated bear zone — the stale
  // bull confirm must not preempt the violation synthesis.
  const bearInverted = { ...bullZone, kind: 'ifvg', dir: 'bear', state: 'inverted', entry_state: 'none' };
  const inputs = liveShapedInputs({ fvgRow: bearInverted, lastBarClose: 29718.5 });
  inputs.bundle.gates.engine.pillar3.fvgs = [staleConfirmed, bearInverted];
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs, previousWalkers: [walker], event: { ts: '2026-06-09T13:55:00.000Z', tf: '1m' }, session: 'ny-am',
  });
  assert.ok(truth.bestPacket, `stale bull confirm masked the violation: ${JSON.stringify(truth.blockers)}`);
  assert.equal(truth.surfacePayload.side, 'short');
  assert.equal(truth.surfacePayload.entry, 29718.5);
});

test("bridge: inversion stop ignores micro pivots inside the violated structure and falls back to the zone edge when no swing exists beyond it", () => {
  const bearInverted = { ...bullZone, kind: 'ifvg', dir: 'bear', state: 'inverted', entry_state: 'none' };
  const walker = {
    id: 'w_MNQ1__ny-am_Inversion_short_fallback', market: 'MNQ1!', session: 'ny-am',
    model: 'Inversion', side: 'short', stage: 'pd_identified', chain: 'Inversion_standard',
    pdArrayRef: 'zone:29730.75-29759.75',
    evidence: { pdArray: { evidenceRef: 'zone:29730.75-29759.75', rawPayload: bullZone } },
  };
  // Only a micro pivot BETWEEN entry and the zone top — inside the violated
  // structure, structurally meaningless. No swing beyond the zone.
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs: liveShapedInputs({
      fvgRow: bearInverted,
      swings: { swing: [], internal: [{ kind: 'LH', price: 29722, is_high: true, bar_ms: 1781013000000 }] },
      lastBarClose: 29718.5,
    }),
    previousWalkers: [walker],
    event: { ts: '2026-06-09T13:55:00.000Z', tf: '1m' }, session: 'ny-am',
  });
  assert.ok(truth.bestPacket, `no packet: ${JSON.stringify(truth.blockers)}`);
  // micro pivot 29722 is below the entry side requirement anyway; zone top
  // is the documented fallback (entry-models.md Inversion §5)
  assert.equal(truth.surfacePayload.stop, 29759.75);
});

test("bridge: session-level high (NYAM.H) anchors the inversion stop when pivot confirmation lags", () => {
  // June 9 at the 09:52 confirmation: the 29847 swing pivot wasn't engine-
  // confirmed until 09:56, but NYAM.H already carried 29847 — the session
  // high is the structural high a trader sees instantly (GXNQ ruling:
  // "stop above the structural high").
  const bearInverted = { ...bullZone, kind: 'ifvg', dir: 'bear', state: 'inverted', entry_state: 'none' };
  const walker = {
    id: 'w_MNQ1__ny-am_Inversion_short_level', market: 'MNQ1!', session: 'ny-am',
    model: 'Inversion', side: 'short', stage: 'pd_identified', chain: 'Inversion_standard',
    pdArrayRef: 'zone:29730.75-29759.75',
    evidence: { pdArray: { evidenceRef: 'zone:29730.75-29759.75', rawPayload: bullZone } },
  };
  const inputs = liveShapedInputs({ fvgRow: bearInverted, lastBarClose: 29718.5 }); // no swings
  inputs.bundle.gates.engine.pillar1.session_levels = {
    NYAM_H: { name: 'NYAM.H', price: 29847, state: 'untaken', swept: false },
    NYAM_L: { name: 'NYAM.L', price: 29633.25, state: 'untaken', swept: false },
    PWH: { name: 'PWH', price: 30807.75, state: 'untaken', swept: false },
  };
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs, previousWalkers: [walker], event: { ts: '2026-06-09T13:55:00.000Z', tf: '1m' }, session: 'ny-am',
  });
  assert.ok(truth.bestPacket, `no packet: ${JSON.stringify(truth.blockers)}`);
  // nearest structural high beyond the zone: NYAM.H 29847, not PWH 30807.75,
  // and never NYAM.L
  assert.equal(truth.surfacePayload.stop, 29847);
});

test("bridge: V3 leg_high (running extreme since last structure break) joins the structural stop pool", () => {
  // The engine's V3 quality row carries the current leg's live extremes —
  // available the bar they print, no pivot-confirmation lag at all. A
  // leg_high beyond the violated zone and NEARER than the session high is
  // the tightest honest structural stop (strategy §6: structural
  // invalidation).
  const bearInverted = { ...bullZone, kind: 'ifvg', dir: 'bear', state: 'inverted', entry_state: 'none' };
  const walker = {
    id: 'w_MNQ1__ny-am_Inversion_short_leg', market: 'MNQ1!', session: 'ny-am',
    model: 'Inversion', side: 'short', stage: 'pd_identified', chain: 'Inversion_standard',
    pdArrayRef: 'zone:29730.75-29759.75',
    evidence: { pdArray: { evidenceRef: 'zone:29730.75-29759.75', rawPayload: bullZone } },
  };
  const inputs = liveShapedInputs({ fvgRow: bearInverted, lastBarClose: 29718.5 }); // no swings
  inputs.bundle.gates.engine.pillar1.session_levels = {
    NYAM_H: { name: 'NYAM.H', price: 29847, state: 'untaken', swept: false },
  };
  inputs.bundle.gates.engine.pillar2.current_tf = {
    ...inputs.bundle.gates.engine.pillar2.current_tf,
    leg_high: 29820, leg_low: 29610.5, leg_high_ms: 1781300000000, leg_low_ms: 1781290000000,
  };
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs, previousWalkers: [walker], event: { ts: '2026-06-09T13:55:00.000Z', tf: '1m' }, session: 'ny-am',
  });
  assert.ok(truth.bestPacket, `no packet: ${JSON.stringify(truth.blockers)}`);
  // leg_high 29820 beats NYAM.H 29847 (nearer beyond-zone structural high)
  // and never the zone top fallback 29759.75
  assert.equal(truth.surfacePayload.stop, 29820);
});
