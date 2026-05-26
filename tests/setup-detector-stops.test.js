import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopOptionsForFvgEntry, stopOptionsForInversionEntry, stopOptionsForStructureEntry, closestSwingPivot } from '../cli/lib/setup-detector-stops.js';

test('closestSwingPivot: picks pivot with minimum absolute distance to entry', () => {
  const pivots = [
    { price: 29985, tier: 'internal', is_high: false },
    { price: 30005, tier: 'swing',    is_high: true  },
    { price: 29990, tier: 'internal', is_high: false },
  ];
  // entry=30000, side=long → stop must be below entry; both lows qualify; 29990 is closer.
  const r = closestSwingPivot(pivots, { entry: 30000, side: 'long' });
  assert.equal(r.price, 29990);
});

test('closestSwingPivot: returns null when no pivot on correct side', () => {
  const pivots = [
    { price: 30010, tier: 'internal', is_high: true },
  ];
  const r = closestSwingPivot(pivots, { entry: 30000, side: 'long' });
  assert.equal(r, null);
});

test('stopOptionsForFvgEntry: bull side ranks candle1_low > swing > fvg_bottom', () => {
  const fvg = { top: 29998.5, bottom: 29992.5, dir: 'bull', created_ms: 1779836400000, kind: 'fvg' };
  const bars = [
    { time: 1779836160 / 1, low: 29981.25, high: 29988.75 }, // candle 1
    { time: 1779836280 / 1, low: 29982.25, high: 29991.5 },  // candle 2
    { time: 1779836400 / 1, low: 29990,    high: 29998.5 },  // candle 3
  ];
  const pivots = [{ price: 29982.25, tier: 'internal', is_high: false, cite: 'gates.engine.pillar3.structures_by_tier.internal[7]' }];
  const r = stopOptionsForFvgEntry({ fvg, side: 'long', barsAtTf: bars, tf: 'm5', tfMs: 120_000, fvgIdx: 3, pivots, entry: 29998.5 });
  assert.equal(r[0].kind, 'fvg_candle1_low');
  assert.equal(r[0].value, 29981.25);
  assert.equal(r[0].cite, 'bars_by_tf.m5.last_5_bars[0].low');
  assert.equal(r[1].kind, 'swing_pivot');
  assert.equal(r[1].value, 29982.25);
  assert.equal(r[2].kind, 'fvg_bottom');
  assert.equal(r[2].value, 29992.5);
  assert.equal(r[2].cite, 'engine_by_tf.m5.fvgs[3].bottom');
});

test('stopOptionsForFvgEntry: skips candle1_low if bars unavailable', () => {
  const fvg = { top: 29998.5, bottom: 29992.5, dir: 'bull', created_ms: 1779836400000, kind: 'fvg' };
  const pivots = [{ price: 29982.25, tier: 'internal', is_high: false, cite: 'gates.engine.pillar3.structures_by_tier.internal[7]' }];
  const r = stopOptionsForFvgEntry({ fvg, side: 'long', barsAtTf: [], tf: 'm5', tfMs: 120_000, fvgIdx: 3, pivots, entry: 29998.5 });
  assert.equal(r[0].kind, 'swing_pivot');
  assert.equal(r[1].kind, 'fvg_bottom');
});

test('stopOptionsForInversionEntry: bull side uses candle 3 of original FVG (the low that defined the bottom)', () => {
  const fvg = { top: 29998.5, bottom: 29992.5, dir: 'bull', created_ms: 1779836400000, kind: 'ifvg' };
  const bars = [
    { time: 1779836400 / 1, low: 29990, high: 29998.5 },  // candle 3
  ];
  const r = stopOptionsForInversionEntry({ fvg, side: 'long', barsAtTf: bars, tf: 'm5', tfMs: 120_000, fvgIdx: 2, pivots: [], entry: 29998.5 });
  assert.equal(r[0].kind, 'fvg_candle3_low');
  assert.equal(r[0].value, 29990);
  assert.equal(r[0].cite, 'bars_by_tf.m5.last_5_bars[0].low');
});

test('stopOptionsForStructureEntry: returns swing pivot only', () => {
  const pivots = [{ price: 29982.25, tier: 'swing', is_high: false, cite: 'gates.engine.pillar3.structures_by_tier.swing[1]' }];
  const r = stopOptionsForStructureEntry({ side: 'long', pivots, entry: 30000 });
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'swing_pivot');
  assert.equal(r[0].value, 29982.25);
  assert.equal(r[0].cite, 'gates.engine.pillar3.structures_by_tier.swing[1]');
});
