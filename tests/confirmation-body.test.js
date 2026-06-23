import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidConfirmationForSide, hasDeliberateBody, CONFIRM_BODY_MIN } from '../app/main/strategy/walkers/lifecycle-utils.js';

// D4 — confirmation must be a DELIBERATE close (confirmation.md / TRADE24 09:02:
// "if I see a wick, if I see sloppy delivery, I do not take"; strong body,
// minimal wicks, PRICE 19:55). Now enforced on the shared gate so MSS / Trend /
// Inversion all require body_ratio >= 0.6, not just the Trend wick-tap path.
const confirmRow = (bodyRatio) => ({
  entry_state: 'confirmed', confirm_close: true, ce_held: true, chop_15m: false, confirm_dir: 'bull',
  ...(bodyRatio == null ? {} : { last_bar: { body_ratio: bodyRatio } }),
});

test('confirmation with a strong body (0.8) is valid', () => {
  assert.equal(isValidConfirmationForSide(confirmRow(0.8), 'long'), true);
});

test('confirmation with a sloppy/wicky body (0.4) is rejected (D4)', () => {
  assert.equal(isValidConfirmationForSide(confirmRow(0.4), 'long'), false);
});

test('a doji-ish close (0.05) is rejected', () => {
  assert.equal(isValidConfirmationForSide(confirmRow(0.05), 'long'), false);
});

test('a body exactly at the 0.6 threshold passes', () => {
  assert.equal(isValidConfirmationForSide(confirmRow(CONFIRM_BODY_MIN), 'long'), true);
});

test('a field-less confirmation row (no body data) stays valid — legacy idiom', () => {
  assert.equal(isValidConfirmationForSide(confirmRow(null), 'long'), true);
});

test('all other gates still bind: a sound body but wrong confirm_dir is invalid', () => {
  assert.equal(isValidConfirmationForSide({ ...confirmRow(0.9), confirm_dir: 'bear' }, 'long'), false);
});

test('inversion path (requireBody:false) accepts a wicky violating close — judged by close-through, not body', () => {
  // The violating candle blasts through the zone and can carry a wick; body
  // ratio is the wrong measure there (confirmation.md per-model breakdown).
  assert.equal(isValidConfirmationForSide(confirmRow(0.4), 'long', { requireBody: false }), true);
});

test('hasDeliberateBody: present<0.6 false, present>=0.6 true, absent true, top-level body_ratio honored', () => {
  assert.equal(hasDeliberateBody({ last_bar: { body_ratio: 0.59 } }), false);
  assert.equal(hasDeliberateBody({ last_bar: { body_ratio: 0.6 } }), true);
  assert.equal(hasDeliberateBody({}), true);
  assert.equal(hasDeliberateBody({ body_ratio: 0.3 }), false);
});
