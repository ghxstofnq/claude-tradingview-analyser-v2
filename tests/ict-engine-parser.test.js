import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_SCHEMA, parseRow, parseIctEngineTable, findIctEngineRows,
} from '../cli/lib/ict-engine-parser.js';

test('parseRow coerces a level row by field type', () => {
  const r = parseRow('level | name=PWH|price=29783.75|state=complete|swept=1|formed_ms=0');
  assert.equal(r.type, 'level');
  assert.deepEqual(r.fields, {
    name: 'PWH', price: 29783.75, state: 'complete', swept: true, formed_ms: 0,
  });
});

test('parseRow returns null for a non-row string and an unknown type', () => {
  assert.equal(parseRow('@Nephew_Sam_'), null);
  assert.equal(parseRow('banana | x=1'), null);
});

test('parseRow keeps quality.displacement a string but structure.displacement a bool', () => {
  const q = parseRow('quality | range_3h=110.75|range_quality=tight|displacement=weak|candle=doji_wick|has_chop=1');
  assert.equal(q.fields.displacement, 'weak');
  assert.equal(q.fields.has_chop, true);
  const s = parseRow('structure | event=mss|dir=bear|level=29350.25|broken_swing_ms=1|confirmed_ms=2|displacement=1|tier=internal|validation=break');
  assert.equal(s.fields.displacement, true);
  assert.equal(s.fields.level, 29350.25);
});

test('parseRow coerces atr_14 and atr_17 as numbers and recognises acceptable displacement', () => {
  const q = parseRow('quality | range_3h=16|range_quality=tight|displacement=acceptable|candle=normal|atr_14=1.50|atr_17=1.50|session=ny_am');
  assert.equal(q.fields.atr_14, 1.5);
  assert.equal(q.fields.atr_17, 1.5);
  assert.equal(typeof q.fields.atr_14, 'number');
  assert.equal(typeof q.fields.atr_17, 'number');
  assert.equal(q.fields.displacement, 'acceptable');
  assert.equal(q.fields.session, 'ny_am');
});

test('parseRow parses a liquidity row with numeric price and boolean swept', () => {
  const r = parseRow('liquidity | kind=eqh|side=buy|price=29397.50|swept=0');
  assert.equal(r.type, 'liquidity');
  assert.deepEqual(r.fields, {
    kind: 'eqh', side: 'buy', price: 29397.50, swept: false,
  });
});

test('parseIctEngineTable buckets rows and derives swing.is_high', () => {
  const rows = [
    'meta | schema=1|count=6|emit_ny=09:20:20|emit_ms=1779369620478|tf=15|symbol=MNQ1!',
    'level | name=PWH|price=29783.75|state=complete|swept=0|formed_ms=0',
    'sweep | target=PDH|price=29397.00|side=buy|swept_ms=1779336900000|rejected=0',
    'fvg | kind=fvg|dir=bear|top=29355.50|bottom=29296.50|ce=29326.00|created_ms=1779358500000|took_liq=1|disp_score=0.74|reacted=0|reaction_dir=none|state=fresh|size_quality=normal',
    'bpr | dir=bull|top=28965.00|bottom=28964.00|created_ms=1779256800000|took_liq=0|reacted=0|reaction_dir=none|state=fresh',
    'swing | kind=HL|price=29350.25|bar_ms=1779353100000|tier=internal|swept=1',
    'swing | kind=LH|price=29429.75|bar_ms=1779355800000|tier=internal|swept=0',
    'structure | event=mss|dir=bear|level=29350.25|broken_swing_ms=1779353100000|confirmed_ms=1779358500000|displacement=1|tier=internal|validation=break',
    'liquidity | kind=eqh|side=buy|price=29550.00|swept=0',
    'liquidity | kind=eql|side=sell|price=29150.25|swept=1',
    'quality | range_3h=110.75|range_quality=tight|displacement=weak|candle=doji_wick|atr_14=85.75|atr_17=87.50|session=ny_am',
  ];
  const t = parseIctEngineTable(rows);
  assert.equal(t.schema, 1);
  assert.equal(t.schema_supported, true);
  assert.equal(t.meta.tf, '15');
  assert.equal(t.levels.length, 1);
  assert.equal(t.sweeps.length, 1);
  assert.equal(t.fvgs.length, 1);
  assert.equal(t.bprs.length, 1);
  assert.equal(t.swings.length, 2);
  assert.equal(t.structures.length, 1);
  assert.equal(t.pools.length, 2);
  assert.equal(t.quality.range_3h, 110.75);
  assert.equal(t.quality.atr_14, 85.75);
  assert.equal(t.quality.atr_17, 87.5);
  assert.equal(t.quality.session, 'ny_am');
  // textbook convention: HL is a low pivot, LH is a high pivot
  assert.equal(t.swings[0].is_high, false);
  assert.equal(t.swings[1].is_high, true);
  assert.equal(t.fvgs[0].ce, 29326.00);
  // size_quality survives as string default (not in ROW_FIELD_TYPES coercion)
  assert.equal(t.fvgs[0].size_quality, 'normal');
  // liquidity pools: numeric price, boolean swept, string kind/side
  assert.equal(t.pools[0].kind, 'eqh');
  assert.equal(t.pools[0].price, 29550);
  assert.equal(t.pools[0].swept, false);
  assert.equal(t.pools[1].kind, 'eql');
  assert.equal(t.pools[1].swept, true);
});

test('schema 4: swing swept_ms coerces to number (internal-sweep patience signal)', () => {
  const rows = [
    'meta | schema=4|count=2|emit_ny=09:20:20|emit_ms=1779369620478|tf=1|symbol=MES1!|bar_ms=1779369600000|bar_closed=1',
    // a swept internal low carries WHEN it was swept; an unswept swing emits 0
    'swing | kind=HL|price=7607.00|bar_ms=1779368700000|tier=internal|swept=1|swept_ms=1779369000000|significant=0',
    'swing | kind=LH|price=7622.50|bar_ms=1779368100000|tier=internal|swept=0|swept_ms=0|significant=1',
  ];
  const t = parseIctEngineTable(rows);
  assert.equal(t.schema, 4);
  assert.equal(t.schema_supported, true);
  assert.equal(t.swings.length, 2);
  // swept low: numeric swept_ms, is_high derived false (HL = low pivot)
  assert.equal(t.swings[0].swept, true);
  assert.equal(t.swings[0].swept_ms, 1779369000000);
  assert.equal(t.swings[0].is_high, false);
  // unswept high: swept_ms 0, is_high true (LH = high pivot)
  assert.equal(t.swings[1].swept, false);
  assert.equal(t.swings[1].swept_ms, 0);
  assert.equal(t.swings[1].is_high, true);
});

test('parseIctEngineTable accepts schema=1 and schema=2 (current supported set)', () => {
  const t1 = parseIctEngineTable(['meta | schema=1|count=0|emit_ny=00:00:00|emit_ms=0|tf=15|symbol=MNQ1!']);
  assert.equal(t1.schema, 1);
  assert.equal(t1.schema_supported, true);

  const t2 = parseIctEngineTable(['meta | schema=2|count=0|emit_ny=00:00:00|emit_ms=0|tf=15|symbol=MNQ1!']);
  assert.equal(t2.schema, 2);
  assert.equal(t2.schema_supported, true);
});

test('parseIctEngineTable flags an unknown schema as unsupported', () => {
  const t = parseIctEngineTable(['meta | schema=99|count=0|emit_ny=00:00:00|emit_ms=0|tf=15|symbol=MNQ1!']);
  assert.equal(t.schema, 99);
  assert.equal(t.schema_supported, false);
});

test('C19: below-current schemas still PARSE but schema_current flags a stale deploy', () => {
  const stale = parseIctEngineTable(['meta | schema=1|count=0|emit_ny=00:00:00|emit_ms=0|tf=15|symbol=MNQ1!']);
  assert.equal(stale.schema_supported, true, 'old schema must still parse (fixture back-compat)');
  assert.equal(stale.schema_current, false, 'but flags as not the currently-deployed schema');

  const current = parseIctEngineTable(['meta | schema=4|count=0|emit_ny=00:00:00|emit_ms=0|tf=15|symbol=MNQ1!']);
  assert.equal(current.schema_current, true);
});

test('parseIctEngineTable returns null without a meta row', () => {
  assert.equal(parseIctEngineTable(['level | name=PWH|price=1|state=complete|swept=0|formed_ms=0']), null);
  assert.equal(parseIctEngineTable([]), null);
  assert.equal(parseIctEngineTable(null), null);
});

test('findIctEngineRows locates V1 or V2 study by name prefix', () => {
  const v1Tables = { studies: [
    { name: 'FVG/iFVG (Nephew_Sam_)', tables: [{ rows: ['@Nephew_Sam_'] }] },
    { name: 'ICT Engine', tables: [{ rows: ['meta | schema=1'] }] },
  ] };
  assert.deepEqual(findIctEngineRows(v1Tables), ['meta | schema=1']);

  const v2Tables = { studies: [
    { name: 'ICT Engine V2', tables: [{ rows: ['meta | schema=2'] }] },
  ] };
  assert.deepEqual(findIctEngineRows(v2Tables), ['meta | schema=2']);

  assert.equal(findIctEngineRows({ studies: [] }), null);
  assert.equal(findIctEngineRows(null), null);
});

test('ENGINE_SCHEMA is the original supported version (1); SUPPORTED_SCHEMAS spans current set', () => {
  assert.equal(ENGINE_SCHEMA, 1);
});

test('parseIctEngineTable coerces V2 fvg lifecycle fields to correct types', () => {
  const fvgRow = 'fvg | kind=fvg|dir=bull|top=30081.75|bottom=30034.00|ce=30058.00|created_ms=1779977520000|took_liq=1|disp_score=0.87|reacted=1|reaction_dir=bull|state=fresh|size_quality=normal|entered_ms=1779978180000|bars_in_zone=2|minutes_in_zone=70|ce_held=1|confirm_close=1|confirm_dir=bull|confirm_ms=1779978240000|chop_15m=0|entry_state=confirmed';
  const t = parseIctEngineTable([
    'meta | schema=2|count=1|emit_ny=11:33:44|emit_ms=1779982424234|tf=1|symbol=MNQ1!',
    fvgRow,
  ]);
  const fvg = t.fvgs[0];
  assert.equal(fvg.entered_ms, 1779978180000);
  assert.equal(fvg.bars_in_zone, 2);
  assert.equal(fvg.minutes_in_zone, 70);
  assert.equal(fvg.ce_held, true);
  assert.equal(fvg.confirm_close, true);
  assert.equal(fvg.confirm_dir, 'bull');
  assert.equal(fvg.confirm_ms, 1779978240000);
  assert.equal(fvg.chop_15m, false);
  assert.equal(fvg.entry_state, 'confirmed');
  assert.equal(fvg.size_quality, 'normal');
});

test('parseIctEngineTable coerces V2 bpr.ce to num + lifecycle fields like fvg', () => {
  const bprRow = 'bpr | dir=bear|top=30048.00|bottom=30047.50|created_ms=1779974400000|took_liq=0|reacted=1|reaction_dir=bear|state=invalidated|ce=30047.75|entered_ms=1779974820000|bars_in_zone=6|minutes_in_zone=127|ce_held=0|confirm_close=1|confirm_dir=bear|confirm_ms=1779974820000|chop_15m=0|entry_state=invalidated';
  const t = parseIctEngineTable([
    'meta | schema=2|count=1|emit_ny=11:33:44|emit_ms=1779982424234|tf=1|symbol=MNQ1!',
    bprRow,
  ]);
  const bpr = t.bprs[0];
  assert.equal(bpr.ce, 30047.75);
  assert.equal(bpr.entered_ms, 1779974820000);
  assert.equal(bpr.bars_in_zone, 6);
  assert.equal(bpr.minutes_in_zone, 127);
  assert.equal(bpr.ce_held, false);
  assert.equal(bpr.confirm_close, true);
  assert.equal(bpr.entry_state, 'invalidated');
});

test('parseIctEngineTable handles V2 quality row (no has_chop, adds session)', () => {
  const t = parseIctEngineTable([
    'meta | schema=2|count=1|emit_ny=11:33:44|emit_ms=1779982424234|tf=1|symbol=MNQ1!',
    'quality | range_3h=363.75|range_quality=good|displacement=clean|candle=normal|atr_14=12.50|atr_17=13.25|session=ny_am',
  ]);
  assert.equal(t.quality.range_3h, 363.75);
  assert.equal(t.quality.range_quality, 'good');
  assert.equal(t.quality.displacement, 'clean');
  assert.equal(t.quality.atr_14, 12.5);
  assert.equal(t.quality.atr_17, 13.25);
  assert.equal(t.quality.session, 'ny_am');
  assert.equal(t.quality.has_chop, undefined); // V2 dropped this field
});

test('parseIctEngineTable accepts schema=3 and coerces the V3 additive fields', () => {
  const rows = [
    'meta | schema=3|count=3|emit_ny=11:33:44|emit_ms=1781300000000|tf=1|symbol=MNQ1!|bar_ms=1781299940000|bar_closed=1',
    'fvg | kind=ifvg|dir=bear|top=29800|bottom=29770|ce=29785|created_ms=1781200000000|took_liq=1|disp_score=0.8|reacted=0|reaction_dir=none|state=inverted|size_quality=normal|entered_ms=0|bars_in_zone=0|minutes_in_zone=0|ce_held=0|confirm_close=0|confirm_dir=none|confirm_ms=0|chop_15m=0|entry_state=none|inverted_ms=1781299880000',
    'level | name=NYPM.H|price=29910.25|state=complete|swept=0|formed_ms=1781280000000',
    'quality | range_3h=120.5|range_quality=good|displacement=clean|candle=normal|atr_14=12.25|atr_17=13.5|session=ny_pm|leg_high=29920.5|leg_low=29744.25|leg_high_ms=1781290000000|leg_low_ms=1781295000000',
  ];
  const parsed = parseIctEngineTable(rows);
  assert.equal(parsed.schema, 3);
  assert.equal(parsed.schema_supported, true);
  assert.equal(parsed.meta.bar_ms, 1781299940000);
  assert.equal(parsed.meta.bar_closed, true);
  assert.equal(parsed.fvgs[0].inverted_ms, 1781299880000);
  assert.equal(parsed.levels[0].name, 'NYPM.H');
  assert.equal(parsed.levels[0].price, 29910.25);
  assert.equal(parsed.quality.leg_high, 29920.5);
  assert.equal(parsed.quality.leg_low, 29744.25);
  assert.equal(parsed.quality.leg_high_ms, 1781290000000);
  assert.equal(parsed.quality.leg_low_ms, 1781295000000);
});

test('parseRow coerces the 3 FVG forming candles (V3) to numbers', () => {
  const r = parseRow('fvg | kind=fvg|dir=bull|top=21000|bottom=20980|created_ms=1781010000000|c1o=20970|c1h=20980|c1l=20960|c1c=20975|c2o=20982|c2h=21010|c2l=20981|c2c=21005|c3o=21006|c3h=21020|c3l=21000|c3c=21015');
  assert.equal(r.fields.c1h, 20980);
  assert.equal(r.fields.c2l, 20981);
  assert.equal(r.fields.c3c, 21015);
  assert.equal(typeof r.fields.c1o, 'number');
});
