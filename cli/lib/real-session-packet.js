function unixSecondsFromIso(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`invalid ISO timestamp: ${iso}`);
  return Math.floor(ms / 1000);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function findBarAt(bars, time, purpose) {
  const bar = (bars ?? []).find((b) => Number(b?.time) === time);
  if (!bar) throw new Error(`missing ${purpose} candle at unix ${time}`);
  return bar;
}

function normalizeTargetPrice(value, name) {
  const price = Number(value);
  if (!Number.isFinite(price)) throw new Error(`${name} missing or invalid`);
  return price;
}

export function buildRealSessionExecutionPacket({ label, bundle }) {
  if (!label) throw new Error('label missing');
  if (!bundle) throw new Error('bundle missing');
  if (bundle.validation?.ok !== true) {
    const blockers = bundle.validation?.blockers?.join('; ') || 'validation.ok is not true';
    throw new Error(`bundle not replay-ready: ${blockers}`);
  }
  if (label.replay?.ready !== true) throw new Error('label replay.ready is not true');

  const expected = label.expected ?? {};
  if (expected.outcome !== 'trade') {
    return { outcome: 'no_trade', reason: `label outcome=${expected.outcome ?? 'missing'}` };
  }
  const side = expected.side;
  if (side !== 'long' && side !== 'short') throw new Error(`unsupported side: ${side}`);

  const m1Bars = bundle.bars_by_tf?.m1?.bars;
  if (!Array.isArray(m1Bars)) throw new Error('bundle missing bars_by_tf.m1.bars');
  const stopTime = unixSecondsFromIso(expected.stop_anchor_time_et);
  const entryTime = unixSecondsFromIso(expected.entry_time_et);
  const stopBar = findBarAt(m1Bars, stopTime, 'stop_anchor');
  const entryBar = findBarAt(m1Bars, entryTime, 'entry_confirmation');

  const entry = normalizeTargetPrice(entryBar.close, 'entry close');
  const stop = side === 'long'
    ? normalizeTargetPrice(stopBar.low, 'stop low')
    : normalizeTargetPrice(stopBar.high, 'stop high');
  const tp1 = normalizeTargetPrice(expected.tp1, 'TP1');
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(tp1 - entry);

  return {
    outcome: 'trade',
    model: expected.model,
    side,
    entry: {
      value: entry,
      time_et: expected.entry_time_et,
      cite: 'bars_by_tf.m1.bars[entry_confirmation].close',
    },
    stop: {
      value: stop,
      anchor: expected.stop_anchor,
      time_et: expected.stop_anchor_time_et,
      cite: side === 'long' ? 'bars_by_tf.m1.bars[stop_anchor].low' : 'bars_by_tf.m1.bars[stop_anchor].high',
    },
    tp1: {
      value: tp1,
      cite: 'label.expected.tp1',
    },
    risk_points: round2(risk),
    tp1_r_multiple: risk > 0 ? round2(reward / risk) : null,
    evidence: {
      source: 'real_session_label_plus_tradingview_replay_capture',
      bundle_schema: bundle.schema ?? null,
      validation: bundle.validation,
      stop_anchor_bar: stopBar,
      entry_confirmation_bar: entryBar,
    },
  };
}
