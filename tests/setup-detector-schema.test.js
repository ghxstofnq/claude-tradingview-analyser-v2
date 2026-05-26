import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disambiguateFvg, disambiguateSessionLevel, disambiguateStructureEvent } from '../cli/lib/setup-detector-schema.js';

test('disambiguateFvg: state=fresh becomes created_never_retested', () => {
  const fvg = { state: 'fresh', reacted: true, created_ms: 1000, top: 100, bottom: 95, kind: 'fvg', dir: 'bull' };
  const r = disambiguateFvg(fvg);
  assert.equal(r.state_semantic, 'created_never_retested');
  assert.equal(r.retested_since_creation, false);
  assert.equal(r.displacement_at_creation, true);
  assert.equal(r.valid_as_zone, true);
});

test('disambiguateFvg: state=ce_tapped becomes midpoint_tapped_at_least_once', () => {
  const fvg = { state: 'ce_tapped', reacted: false, created_ms: 1000, top: 100, bottom: 95, kind: 'fvg', dir: 'bull' };
  const r = disambiguateFvg(fvg);
  assert.equal(r.state_semantic, 'midpoint_tapped_at_least_once');
  assert.equal(r.retested_since_creation, true);
  assert.equal(r.displacement_at_creation, false);
  assert.equal(r.valid_as_zone, true);
});

test('disambiguateFvg: state=taken becomes fully_traded_through and valid_as_zone=false', () => {
  const fvg = { state: 'taken', reacted: true, created_ms: 1000, top: 100, bottom: 95, kind: 'fvg', dir: 'bull' };
  const r = disambiguateFvg(fvg);
  assert.equal(r.state_semantic, 'fully_traded_through');
  assert.equal(r.valid_as_zone, false);
});

test('disambiguateSessionLevel: taken=true becomes swept=true valid_as_target=false', () => {
  const lvl = { name: 'AS_H', price: 29990, taken: true };
  const r = disambiguateSessionLevel(lvl);
  assert.equal(r.swept, true);
  assert.equal(r.valid_as_target, false);
});

test('disambiguateSessionLevel: taken=false becomes valid_as_target=true', () => {
  const lvl = { name: 'PDH', price: 30119, taken: false };
  const r = disambiguateSessionLevel(lvl);
  assert.equal(r.swept, false);
  assert.equal(r.valid_as_target, true);
});

test('disambiguateStructureEvent: surfaces is_reclaimed from existing field', () => {
  const ev = { event: 'bos', dir: 'bull', level: 100, reclaimed: true };
  const r = disambiguateStructureEvent(ev);
  assert.equal(r.is_reclaimed, true);
});
