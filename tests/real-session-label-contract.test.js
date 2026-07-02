import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REAL_SESSION_LABEL_DIR = new URL('./fixtures/real-sessions/', import.meta.url);
const STAGE_G_LABEL_DIR = new URL('./fixtures/stage-g-sessions/', import.meta.url);

function readLabel(name) {
  return JSON.parse(readFileSync(new URL(name, REAL_SESSION_LABEL_DIR), 'utf8'));
}

function readStageGLabel(name) {
  return JSON.parse(readFileSync(new URL(name, STAGE_G_LABEL_DIR), 'utf8'));
}

test('GXNQ label 2026-05-29 MNQ inversion long is captured as a replay-ready real-session contract', () => {
  const label = readLabel('2026-05-29-mnq-ny-am-inversion-long.label.json');

  assert.equal(label.schema, 'gxofnq.real-session-label.v1');
  assert.equal(label.fixture, '2026-05-29-mnq-ny-am-inversion-long');
  assert.equal(label.fixtureSource, 'real');
  assert.equal(label.label_status, 'labeled');
  assert.equal(label.reviewer, 'GXNQ');
  assert.equal(label.symbol, 'MNQ');
  assert.equal(label.contract_hint, 'CME_MINI:MNQ1!');
  assert.equal(label.trade_date, '2026-05-29');
  assert.equal(label.session, 'NY AM');

  assert.deepEqual(label.expected, {
    outcome: 'trade',
    model: 'Inversion',
    side: 'long',
    entry_time_et: '2026-05-29T10:48:00-04:00',
    stop_anchor_time_et: '2026-05-29T10:45:00-04:00',
    stop_anchor: 'low_of_10:45_candle',
    tp1: 30437.5,
  });

  assert.ok(label.evidence_requirements.includes('bundle must include 10:45 ET candle low for stop validation'));
  assert.ok(label.evidence_requirements.includes('bundle must include 10:48 ET confirmation candle for entry validation'));
  assert.ok(label.evidence_requirements.includes('bundle must prove TP1 30437.50 is untaken liquidity at entry time'));
  assert.equal(label.replay.bundlePath, '2026-05-29-mnq-ny-am-inversion-long.asof-1048.bundle.json');
  assert.equal(label.replay.ready, true);
  const bundle = readLabel(label.replay.bundlePath);
  assert.equal(bundle.schema, 'gxofnq.replay-capture.v1');
  assert.equal(bundle.validation?.ok, true);
  assert.ok(bundle.bars_by_tf?.m1?.bars?.some((b) => b.time === 1780065900), 'bundle has 10:45 ET stop anchor candle');
  assert.ok(bundle.bars_by_tf?.m1?.bars?.some((b) => b.time === 1780066080), 'bundle has 10:48 ET entry candle');
});

test('real-session labels are strict enough to prevent ambiguous tradable fixtures', () => {
  for (const file of readdirSync(REAL_SESSION_LABEL_DIR).filter((f) => f.endsWith('.label.json'))) {
    const label = readLabel(file);
    assert.equal(label.schema, 'gxofnq.real-session-label.v1', `${file}: schema`);

    // Non-graded helper fixtures (e.g. pm-carry bars-only PM bars for AM-trade carry
    // resolution) are not real-session labels. They must declare themselves bars-only
    // and carry no tradable expectation, so they can never be scored as a real setup.
    if (label.fixtureSource !== 'real') {
      assert.equal(label.label_status, 'bars-only', `${file}: non-real fixtures must be bars-only`);
      assert.equal(label.expected, undefined, `${file}: non-real fixtures must not declare a tradable expectation`);
      continue;
    }

    assert.ok(label.fixture, `${file}: fixture`);
    assert.ok(label.reviewer, `${file}: reviewer`);
    assert.ok(label.trade_date, `${file}: trade_date`);
    assert.ok(label.symbol, `${file}: symbol`);
    assert.ok(label.session, `${file}: session`);
    assert.ok(['labeled', 'needs_gxofnq_review'].includes(label.label_status), `${file}: label_status`);

    if (label.expected?.outcome === 'trade') {
      assert.ok(['MSS', 'Trend', 'Inversion'].includes(label.expected.model), `${file}: model`);
      assert.ok(['long', 'short'].includes(label.expected.side), `${file}: side`);
      assert.match(label.expected.entry_time_et, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-04:00$/, `${file}: entry_time_et`);
      assert.equal(typeof label.expected.tp1, 'number', `${file}: tp1`);
      assert.ok(label.expected.stop_anchor || label.expected.stop, `${file}: stop anchor/price`);
    }
  }
});

test('06-16 MNQ MSS label keeps executable fields no-lookahead and runner target as provenance', () => {
  const label = readStageGLabel('2026-06-16-mnq-ny-am-mss-short.label.json');

  assert.deepEqual(label.expected, {
    outcome: 'trade',
    model: 'MSS',
    side: 'short',
    grade: 'B',
    entry: 30864.25,
    stop: 30905,
    tp1: 30750.75,
    tp2: null,
  });
  assert.equal(label.oracle_target_context?.nyam_l_runner, 30561.75);
  assert.match(label.oracle_target_context?.note ?? '', /no-lookahead packet-time fold/);
});

test('06-25 approved no-trade label keeps pair-conflict losers as rejected provenance', () => {
  const label = readStageGLabel('2026-06-25-mnq-ny-am-no-trade.label.json');

  assert.deepEqual(label.expected, {
    outcome: 'no_trade',
    side: null,
  });
  assert.equal(label.label_status, 'labeled');
  assert.equal(label.oracle_context?.decision, 'stand_aside');
  assert.equal(label.oracle_context?.pair_leader?.evidence_leader, null);
  assert.match(label.oracle_context?.live_fallback_note ?? '', /defaults null pair-leader evidence to PAIR_PRIMARY\/MNQ1!/);

  const rejected = label.oracle_context?.rejected_candidates ?? [];
  assert.equal(rejected.length, 2);
  assert.deepEqual(rejected.map((c) => `${c.symbol}:${c.side}:${c.outcome}`), [
    'MNQ:long:stop_hit',
    'MES:short:stop_hit',
  ]);
  assert.equal(rejected[0].event_time_et, '2026-06-25T10:52:00-04:00');
  assert.equal(rejected[1].event_time_et, '2026-06-25T10:14:00-04:00');
});

test('06-15 MES corrected Trend long is approved with buffered execution stop and TP1 outcome', () => {
  const label = readStageGLabel('2026-06-15-mes-ny-am.label.json');

  assert.equal(label.label_status, 'labeled');
  assert.deepEqual(label.expected, {
    outcome: 'trade',
    model: 'Trend',
    side: 'long',
    grade: 'B',
    entry: 7630.5,
    stop: 7626,
    stop_level: 7626.5,
    invalidation: 7626.5,
    stop_buffer_ticks: 2,
    tp1: 7641.5,
    tp2: 7650,
  });
  assert.equal(label.oracle_context?.decision, 'approve_mes_trend_long_buffered_tp1');
  assert.equal(label.oracle_context?.event_time_et, '2026-06-15T11:24:00-04:00');
  assert.equal(label.oracle_context?.structural_anchor_touch_time_et, '2026-06-15T11:33:00-04:00');
  assert.equal(label.oracle_context?.tp1_time_et, '2026-06-15T11:50:00-04:00');
  assert.equal(label.oracle_context?.outcome, 'tp1_hit');
  assert.equal(label.oracle_context?.structural_stop_level, 7626.5);
  assert.equal(label.oracle_context?.execution_stop, 7626);
  assert.equal(label.oracle_context?.stop_rule, 'trend_fvg_first_candle_low');
  assert.equal(label.oracle_context?.tp1_rule, 'htf_fvg_first_candle_high');
  assert.equal(label.oracle_context?.risk_points, 4.5);
  assert.equal(label.oracle_context?.tp1_r_multiple, 2.44);
  assert.equal(label.oracle_context?.pair_leader?.evidence_leader, null);
  assert.equal(label.oracle_context?.second_entry_review?.clean_second_long_after_stop_before_tp1, false);
  assert.match(label.oracle_context?.paired_mnq_context?.fresh_fold ?? '', /no setup/);
});

test('06-22 approved MES short keeps MNQ no-setup pair context and no leader-rule promotion', () => {
  const label = readStageGLabel('2026-06-22-mes-ny-am.label.json');

  assert.deepEqual(label.expected, {
    outcome: 'trade',
    model: 'Inversion',
    side: 'short',
    grade: 'B',
    entry: 7580.5,
    stop: 7591.75,
    tp1: 7556.75,
    tp2: 7552.5,
  });
  assert.equal(label.label_status, 'labeled');
  assert.equal(label.oracle_context?.decision, 'approve_mes_short');
  assert.equal(label.oracle_context?.event_time_et, '2026-06-22T10:18:00-04:00');
  assert.equal(label.oracle_context?.tp1_time_et, '2026-06-22T10:31:00-04:00');
  assert.equal(label.oracle_context?.tp2_touch_time_et, '2026-06-22T10:32:00-04:00');
  assert.equal(label.oracle_context?.pair_leader?.evidence_leader, null);
  assert.equal(label.oracle_context?.not_a_pair_leader_rule, true);
  assert.match(label.oracle_context?.paired_mnq_context?.fresh_fold ?? '', /no setup/);
});


test('06-24 approved MNQ B long is a stopped first trade and documents the blocked second long', () => {
  const label = readStageGLabel('2026-06-24-mnq-ny-am.label.json');

  assert.equal(label.label_status, 'labeled');
  assert.deepEqual(label.expected, {
    outcome: 'trade',
    model: 'Inversion',
    side: 'long',
    grade: 'B',
    entry: 29722.25,
    stop: 29563.5,
    stop_level: 29564,
    invalidation: 29564,
    stop_buffer_ticks: 2,
    tp1: 29843.5,
    tp2: 29874,
  });
  assert.equal(label.oracle_context?.decision, 'approve_mnq_b_inversion_long_stopped');
  assert.equal(label.oracle_context?.event_time_et, '2026-06-24T09:51:00-04:00');
  assert.equal(label.oracle_context?.stop_time_et, '2026-06-24T10:20:00-04:00');
  assert.equal(label.oracle_context?.later_tp1_time_et, '2026-06-24T10:46:00-04:00');
  assert.equal(label.oracle_context?.later_tp2_time_et, '2026-06-24T10:48:00-04:00');
  assert.equal(label.oracle_context?.outcome, 'stop_hit');
  assert.equal(label.oracle_context?.second_entry_review?.actual_best_packet_count, 1);
  assert.equal(label.oracle_context?.second_entry_review?.packet_ready_count, 1);
  assert.equal(label.oracle_context?.second_entry_review?.session_primary_already_taken_count, 14);
  assert.match(label.oracle_context?.second_entry_review?.why_no_second_trade ?? '', /one-primary-packet NY-AM session latch/);
  assert.equal(label.oracle_context?.second_entry_review?.blocked_later_candidates?.[0]?.time_et, '2026-06-24T10:32:00-04:00');
  assert.equal(label.oracle_context?.second_entry_review?.blocked_later_candidates?.[0]?.blocker, 'session_primary_already_taken');
  assert.match(label.oracle_context?.second_entry_review?.probable_valid_second_entry_note ?? '', /probably have been valid and won/);
});

test('04-06 MNQ packet remains packet-only unresolved review evidence, not R-scored oracle truth', () => {
  const label = readStageGLabel('2026-04-06-mnq-ny-am.label.json');

  assert.equal(label.label_status, 'unlabeled');
  assert.equal(label.expected?.outcome, 'unknown');
  assert.equal(label.oracle_context?.decision, 'keep_packet_only_unresolved');
  assert.equal(label.oracle_context?.not_oracle_truth, true);
  assert.equal(label.oracle_context?.not_scored_in_r, true);
  assert.deepEqual(label.oracle_context?.review_packet, {
    symbol: 'MNQ',
    model: 'Inversion',
    side: 'short',
    grade: 'B',
    event_time_et: '2026-04-06T10:04:00-04:00',
    entry: 24625,
    stop: 24746.25,
    stop_level: 24745.75,
    stop_buffer_ticks: 2,
    tp1: 24337,
    tp2: 24273.75,
    outcome: 'unresolved_in_ny_am_tape',
    post_entry_max_high: 24684,
    post_entry_max_high_time_et: '2026-04-06T10:21:00-04:00',
    post_entry_min_low: 24545.25,
    post_entry_min_low_time_et: '2026-04-06T11:33:00-04:00',
  });
  assert.equal(label.oracle_context?.second_entry_review?.session_primary_already_taken_count, 7);
});

test('01-29 approved no-trade records no actual setup despite MES displacement leadership', () => {
  const label = readStageGLabel('2026-01-29-mnq-ny-am-no-trade.label.json');

  assert.equal(label.label_status, 'labeled');
  assert.deepEqual(label.expected, {
    outcome: 'no_trade',
    side: null,
  });
  assert.equal(label.oracle_context?.decision, 'stand_aside_no_setup');
  assert.equal(label.oracle_context?.pair_leader?.evidence_leader, 'MES1!');
  assert.equal(label.oracle_context?.pair_leader?.smt_leader, null);
  assert.match(label.oracle_context?.mnq_context?.fresh_fold ?? '', /no setup/);
  assert.match(label.oracle_context?.mes_context?.fresh_fold ?? '', /no setup/);
  assert.match(label.oracle_context?.no_trade_reason ?? '', /No bestPacket \/ packet_ready on either instrument/);
});

test('06-17 MES counterpart remains rejected provenance under approved MNQ no-trade', () => {
  const label = readStageGLabel('2026-06-17-mes-ny-am.label.json');

  assert.equal(label.label_status, 'unlabeled');
  assert.deepEqual(label.expected, {
    outcome: 'unknown',
    model: null,
    side: null,
    grade: null,
    entry: null,
    stop: null,
    tp1: null,
    tp2: null,
  });
  assert.equal(label.oracle_context?.decision, 'reject_mes_packet_preserve_mnq_no_trade');
  assert.equal(label.oracle_context?.not_oracle_truth, true);
  assert.deepEqual(label.oracle_context?.rejected_candidate, {
    model: 'Inversion',
    side: 'short',
    grade: 'B',
    event_time_et: '2026-06-17T10:11:00-04:00',
    entry: 7587.25,
    stop: 7593.5,
    tp1: 7577.75,
    tp2: 7295,
    outcome: 'stop_hit',
    stop_time_et: '2026-06-17T10:13:00-04:00',
    later_tp1_time_et: '2026-06-17T10:41:00-04:00',
    reason_rejected: 'Early packet stopped before target; approved MNQ row is no-trade on price quality / no clean fast entry; pair leader was inconclusive/null.',
  });
  assert.equal(label.oracle_context?.second_entry_review?.clean_second_short_before_tp1, false);
  assert.match(label.oracle_context?.second_entry_review?.current_engine_behavior ?? '', /packet_ready latches the NY-AM session/);
  assert.deepEqual(label.oracle_context?.second_entry_review?.blocked_later_candidates?.map((candidate) => `${candidate.time_et}:${candidate.side}:${candidate.blocker}`), [
    '2026-06-17T11:19:00-04:00:long:session_primary_already_taken',
    '2026-06-17T11:54:00-04:00:short:session_primary_already_taken',
  ]);
  assert.equal(label.oracle_context?.pair_leader?.evidence_leader, null);
});

test('trade labels declare a no-lookahead replay readiness contract before they can be scored', () => {
  for (const file of readdirSync(REAL_SESSION_LABEL_DIR).filter((f) => f.endsWith('.label.json'))) {
    const label = readLabel(file);
    if (label.expected?.outcome !== 'trade') continue;

    if (label.replay?.ready) {
      assert.match(label.replay?.bundlePath, /\.bundle\.json$/, `${file}: ready labels must point at a bundle`);
      const bundle = readLabel(label.replay.bundlePath);
      assert.equal(bundle.validation?.ok, true, `${file}: ready bundle validation`);
    } else {
      assert.equal(label.replay?.bundlePath, null, `${file}: bundlePath must remain null until captured`);
      assert.ok(label.replay?.reason_not_ready, `${file}: not-ready labels must explain blocker`);
    }
    assert.match(label.replay?.as_of_et, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-04:00$/, `${file}: as_of_et`);
    assert.match(label.replay?.as_of_utc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/, `${file}: as_of_utc`);
    assert.deepEqual(label.replay?.required_candles, [
      { tf: '1m', time_et: label.expected.stop_anchor_time_et, purpose: 'stop_anchor' },
      { tf: '1m', time_et: label.expected.entry_time_et, purpose: 'entry_confirmation' },
    ], `${file}: required candles`);
    assert.deepEqual(label.replay?.required_timeframes, {
      premarket_context: ['D1', 'H4', 'H1', '15M', '5M'],
      entry_window: ['15M', '5M', '1M'],
    }, `${file}: required_timeframes`);
    assert.deepEqual(label.replay?.capture_window_et, {
      context_start: `${label.trade_date}T09:30:00-04:00`,
      entry_window_end: `${label.trade_date}T12:00:00-04:00`,
      as_of: label.expected.entry_time_et,
    }, `${file}: capture_window_et`);
    assert.ok(label.replay?.readiness_checks?.includes('no bars after as_of may be used for entry decision'), `${file}: no-lookahead check`);
    assert.ok(label.replay?.readiness_checks?.includes('TP1 must cite untaken liquidity existing before/as-of entry'), `${file}: TP1 check`);
  }
});
