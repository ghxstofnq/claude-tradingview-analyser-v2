// Audit fixes I28 / I29 / U1 in the ICT Engine parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRow, parseIctEngineTable, findIctEngineRows } from '../cli/lib/ict-engine-parser.js';

test('I28: a blank price cell parses to null, not 0', () => {
  const r = parseRow('level | name=PWH|price=|swept=0|formed_ms=0');
  assert.equal(r.fields.price, null);          // was Number('') === 0 → phantom level at 0
  const ok = parseRow('level | name=PWH|price=100|swept=0|formed_ms=0');
  assert.equal(ok.fields.price, 100);          // a real value still coerces
});

test('U1: ce is the exact midpoint, not the tick-rounded emit', () => {
  const out = parseIctEngineTable([
    'meta | schema=4|count=1|emit_ms=1000',
    'fvg | top=100.5|bottom=90|ce=95|created_ms=1',   // emitted ce rounded to 95
  ]);
  assert.equal(out.fvgs[0].ce, 95.25);              // (100.5 + 90) / 2
});

test('I29: with two ICT Engine studies, pick the freshest emit', () => {
  const rows = findIctEngineRows({ studies: [
    { name: 'ICT Engine',    tables: [{ rows: ['meta | schema=4|count=0|emit_ms=1000'] }] },
    { name: 'ICT Engine V2', tables: [{ rows: ['meta | schema=4|count=0|emit_ms=2000'] }] },
  ] });
  assert.ok(rows[0].includes('emit_ms=2000'));      // the newer instance, not the first
});
