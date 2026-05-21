// Regression coverage for gates.session.next_killzone_label /
// seconds_to_next_killzone — the next-killzone display fields in computeSessionGate.
//
// Bug: once a killzone's start time had passed, the countdown rolled to the
// SAME killzone tomorrow (+24h) instead of advancing to the next killzone
// today. At 09:12 ET the dashboard showed "NY AM in ~23h" while the NY AM
// killzone was already in progress.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSessionGate } from '../cli/commands/analyze.js';

// computeSessionGate derives the ET clock purely from quote.time (unix SECONDS).
// 2026-05-20 is a Wednesday; mid-May is EDT (UTC-4), so ET = UTC - 4h.
const sessionAt = (utcIso) =>
  computeSessionGate({ quote: { time: Date.parse(utcIso) / 1000, last: null } });

test('passed NY AM start advances to NY PM the same day', () => {
  // 09:12 ET — inside the NY AM killzone, phase pre_session_ny_am.
  const s = sessionAt('2026-05-20T13:12:00Z');
  assert.equal(s.next_killzone_label, 'NY PM');
  assert.equal(s.seconds_to_next_killzone, (13 * 60 + 30 - (9 * 60 + 12)) * 60);
});

test('before NY AM, next killzone is still NY AM today', () => {
  // 08:00 ET — pre-session, NY AM start not yet reached.
  const s = sessionAt('2026-05-20T12:00:00Z');
  assert.equal(s.next_killzone_label, 'NY AM');
  assert.equal(s.seconds_to_next_killzone, 30 * 60);
});

test('after midnight, next killzone is NY AM (London Open not jumped into)', () => {
  // 01:00 ET — pre_session_ny_am phase deliberately leads toward NY AM, and
  // no killzone has passed yet, so this behavior must stay unchanged.
  const s = sessionAt('2026-05-20T05:00:00Z');
  assert.equal(s.next_killzone_label, 'NY AM');
  assert.equal(s.seconds_to_next_killzone, (8 * 60 + 30 - 60) * 60);
});

test('NY AM entry-hunt phase points at NY PM', () => {
  // 09:50 ET — phase already names a future killzone; unchanged.
  const s = sessionAt('2026-05-20T13:50:00Z');
  assert.equal(s.next_killzone_label, 'NY PM');
  assert.equal(s.seconds_to_next_killzone, (13 * 60 + 30 - (9 * 60 + 50)) * 60);
});

test('after NY PM start, next killzone wraps to next-day London Open', () => {
  // 14:00 ET — all of today's killzones have started; wrap to tomorrow.
  const s = sessionAt('2026-05-20T18:00:00Z');
  assert.equal(s.next_killzone_label, 'London Open (next day)');
  assert.equal(s.seconds_to_next_killzone, (3 * 60 + 24 * 60 - 14 * 60) * 60);
});
