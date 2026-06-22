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

test('after midnight (Asia session), next killzone is London Open', () => {
  // 01:00 ET — Asia session (18:00–03:00 ET). London is a real session now,
  // so the next killzone is London Open at 03:00 ET, not NY AM.
  const s = sessionAt('2026-05-20T05:00:00Z');
  assert.equal(s.phase, 'asia');
  assert.equal(s.next_killzone_label, 'London Open');
  assert.equal(s.seconds_to_next_killzone, (3 * 60 - 60) * 60);
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

// ─────────────────────────────────────────────────────────────────────────
// open_window_start_ms / open_window_end_ms — bug discovered 2026-05-27.
// computeSessionGate never set these fields; analyze.js then passed
// Infinity to compute-leader, which filtered out every FVG and returned
// reason="no_fvgs_created_in_window" every time, regardless of data.
// ─────────────────────────────────────────────────────────────────────────

test('open_window bounds match NY-AM 09:30→09:45 ET during NY-AM phases', () => {
  // 09:35 ET on 2026-05-20 (Wed, EDT) — phase open_reaction_ny_am.
  const s = sessionAt('2026-05-20T13:35:00Z');
  assert.equal(s.phase, 'open_reaction_ny_am');
  const expectedStart = Date.parse('2026-05-20T13:30:00Z'); // 09:30 ET
  const expectedEnd   = Date.parse('2026-05-20T13:45:00Z'); // 09:45 ET
  assert.equal(s.open_window_start_ms, expectedStart);
  assert.equal(s.open_window_end_ms,   expectedEnd);
});

test('open_window bounds still anchor to today during pre_session_ny_am', () => {
  // 08:00 ET — before the open window but window bounds should already
  // point at today's 09:30 ET so compute-leader can pre-emptively read.
  const s = sessionAt('2026-05-20T12:00:00Z');
  assert.equal(s.phase, 'pre_session_ny_am');
  const expectedStart = Date.parse('2026-05-20T13:30:00Z');
  assert.equal(s.open_window_start_ms, expectedStart);
  assert.equal(s.open_window_end_ms,   expectedStart + 15 * 60 * 1000);
});

test('open_window bounds shift to NY-PM 13:30→13:45 ET during NY-PM phases', () => {
  // 13:35 ET on 2026-05-20 — phase open_reaction_ny_pm.
  const s = sessionAt('2026-05-20T17:35:00Z');
  assert.equal(s.phase, 'open_reaction_ny_pm');
  const expectedStart = Date.parse('2026-05-20T17:30:00Z'); // 13:30 ET
  const expectedEnd   = Date.parse('2026-05-20T17:45:00Z'); // 13:45 ET
  assert.equal(s.open_window_start_ms, expectedStart);
  assert.equal(s.open_window_end_ms,   expectedEnd);
});

test('open_window bounds are null during london_open phase', () => {
  // 04:00 ET on 2026-05-20 — phase london_open. Leader picks only apply
  // to NY open-reactions per the strategy chain.
  const s = sessionAt('2026-05-20T08:00:00Z');
  assert.equal(s.phase, 'london_open');
  assert.equal(s.open_window_start_ms, null);
  assert.equal(s.open_window_end_ms, null);
});

test('open_window bounds are null during the Asia session', () => {
  // 18:30 ET — past NY PM + past the 17:00-18:00 ET daily settlement break.
  // 18:00–03:00 ET is the Asia session; open-reaction bounds are NY-only.
  const s = sessionAt('2026-05-20T22:30:00Z');
  assert.equal(s.phase, 'asia');
  assert.equal(s.open_window_start_ms, null);
  assert.equal(s.open_window_end_ms, null);
});

// ─────────────────────────────────────────────────────────────────────────
// Asia session 18:00–03:00 ET — recognized as its own session/phase (the
// faithful-Lanto rebuild treats overnight as a session, not just a level).
// ─────────────────────────────────────────────────────────────────────────
test('18:00 ET (Asia open) → asia phase + Asia label', () => {
  const s = sessionAt('2026-05-20T22:00:00Z'); // 18:00 EDT
  assert.equal(s.phase, 'asia');
  assert.equal(s.label, 'Asia');
});

test('02:00 ET (post-midnight) → asia phase, not pre_session_ny_am', () => {
  const s = sessionAt('2026-05-20T06:00:00Z'); // 02:00 EDT
  assert.equal(s.phase, 'asia');
  assert.equal(s.next_killzone_label, 'London Open');
});

test('20:00 ET → asia phase, next killzone wraps to next-day London Open', () => {
  const s = sessionAt('2026-05-21T00:00:00Z'); // 20:00 EDT (prev ET day)
  assert.equal(s.phase, 'asia');
  assert.equal(s.next_killzone_label, 'London Open (next day)');
});

test('03:00 ET → london_open (Asia has ended)', () => {
  const s = sessionAt('2026-05-20T07:00:00Z'); // 03:00 EDT
  assert.equal(s.phase, 'london_open');
});
