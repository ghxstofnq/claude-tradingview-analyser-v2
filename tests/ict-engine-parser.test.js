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

test('parseIctEngineTable buckets rows and derives swing.is_high', () => {
  const rows = [
    'meta | schema=1|count=6|emit_ny=09:20:20|emit_ms=1779369620478|tf=15|symbol=MNQ1!',
    'level | name=PWH|price=29783.75|state=complete|swept=0|formed_ms=0',
    'sweep | target=PDH|price=29397.00|side=buy|swept_ms=1779336900000|rejected=0',
    'fvg | kind=fvg|dir=bear|top=29355.50|bottom=29296.50|ce=29326.00|created_ms=1779358500000|took_liq=1|disp_score=0.74|reacted=0|reaction_dir=none|state=fresh',
    'bpr | dir=bull|top=28965.00|bottom=28964.00|created_ms=1779256800000|took_liq=0|reacted=0|reaction_dir=none|state=fresh',
    'swing | kind=HL|price=29350.25|bar_ms=1779353100000|tier=internal|swept=1',
    'swing | kind=LH|price=29429.75|bar_ms=1779355800000|tier=internal|swept=0',
    'structure | event=mss|dir=bear|level=29350.25|broken_swing_ms=1779353100000|confirmed_ms=1779358500000|displacement=1|tier=internal|validation=break',
    'quality | range_3h=110.75|range_quality=tight|displacement=weak|candle=doji_wick|has_chop=1',
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
  assert.equal(t.quality.range_3h, 110.75);
  // textbook convention: HL is a low pivot, LH is a high pivot
  assert.equal(t.swings[0].is_high, false);
  assert.equal(t.swings[1].is_high, true);
  assert.equal(t.fvgs[0].ce, 29326.00);
});

test('parseIctEngineTable flags an unsupported schema', () => {
  const t = parseIctEngineTable(['meta | schema=2|count=0|emit_ny=00:00:00|emit_ms=0|tf=15|symbol=MNQ1!']);
  assert.equal(t.schema, 2);
  assert.equal(t.schema_supported, false);
});

test('parseIctEngineTable returns null without a meta row', () => {
  assert.equal(parseIctEngineTable(['level | name=PWH|price=1|state=complete|swept=0|formed_ms=0']), null);
  assert.equal(parseIctEngineTable([]), null);
  assert.equal(parseIctEngineTable(null), null);
});

test('findIctEngineRows locates the study or returns null', () => {
  const tables = { studies: [
    { name: 'FVG/iFVG (Nephew_Sam_)', tables: [{ rows: ['@Nephew_Sam_'] }] },
    { name: 'ICT Engine', tables: [{ rows: ['meta | schema=1'] }] },
  ] };
  assert.deepEqual(findIctEngineRows(tables), ['meta | schema=1']);
  assert.equal(findIctEngineRows({ studies: [] }), null);
  assert.equal(findIctEngineRows(null), null);
});

test('ENGINE_SCHEMA is the supported version', () => {
  assert.equal(ENGINE_SCHEMA, 1);
});
