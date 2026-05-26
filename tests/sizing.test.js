import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeFor, dayOfWeek, computeSize } from "../cli/lib/sizing.js";

test("A+ Tue returns full size", () => {
  const s = sizeFor({ grade: "A+", dow: "Tue" });
  assert.equal(s.contracts, 2);
  assert.equal(s.r_unit, 1.0);
});

test("A+ Mon reduced", () => {
  const s = sizeFor({ grade: "A+", dow: "Mon" });
  assert.equal(s.contracts, 1);
  assert.equal(s.r_unit, 0.5);
  assert.match(s.label, /reduced/);
});

test("A+ Fri reduced", () => {
  const s = sizeFor({ grade: "A+", dow: "Fri" });
  assert.equal(s.contracts, 1);
});

test("B Wed at half of A+ allocation", () => {
  const s = sizeFor({ grade: "B", dow: "Wed" });
  assert.equal(s.contracts, 1);
  assert.equal(s.r_unit, 0.5);
});

test("B Mon → reduced (1c at 0.5R, not no-trade)", () => {
  const s = sizeFor({ grade: "B", dow: "Mon" });
  assert.equal(s.contracts, 1);
  assert.equal(s.r_unit, 0.5);
});

test("no-trade always returns 0 contracts", () => {
  const s = sizeFor({ grade: "no-trade", dow: "Tue" });
  assert.equal(s.contracts, 0);
  assert.equal(s.label, "no-trade");
});

test("dayOfWeek returns a 3-letter weekday", () => {
  const dow = dayOfWeek(new Date("2026-05-26T15:00:00Z"));    // Tuesday
  assert.equal(dow, "Tue");
});

// computeSize — chain-helper R sizing (separate from contract-based sizeFor).
// Used by surface_session_brief.sizing_note + entry-hunt setup payloads.
// Spec: docs/superpowers/specs/2026-05-26-strategy-chain-design.md §4.5.

test("computeSize Tuesday A+ → 1.0R (core-day, full size)", () => {
  const r = computeSize({ day_of_week: 'Tue', grade: 'A+' });
  assert.equal(r.r_size, 1.0);
  assert.equal(r.override_reason, null);
});

test("computeSize Tuesday B → 0.5R (core-day, B-grade discount)", () => {
  const r = computeSize({ day_of_week: 'Tue', grade: 'B' });
  assert.equal(r.r_size, 0.5);
});

test("computeSize Monday A+ → 0.5R (Mon reduced regardless of grade)", () => {
  const r = computeSize({ day_of_week: 'Mon', grade: 'A+' });
  assert.equal(r.r_size, 0.5);
});

test("computeSize Monday B → 0.5R (Mon B same as Mon A+, NOT multiplied)", () => {
  const r = computeSize({ day_of_week: 'Mon', grade: 'B' });
  assert.equal(r.r_size, 0.5);
});

test("computeSize Friday A+ → 0.5R (Fri reduced)", () => {
  const r = computeSize({ day_of_week: 'Fri', grade: 'A+' });
  assert.equal(r.r_size, 0.5);
});

test("computeSize Friday B → 0.5R (Fri B same as Fri A+)", () => {
  const r = computeSize({ day_of_week: 'Fri', grade: 'B' });
  assert.equal(r.r_size, 0.5);
});

test("computeSize no-trade → r_size 0", () => {
  const r = computeSize({ day_of_week: 'Tue', grade: 'no-trade' });
  assert.equal(r.r_size, 0);
});

test("computeSize memory override (skip + day match) → r_size 0", () => {
  const r = computeSize({ day_of_week: 'Wed', grade: 'A+', memory_overrides: 'Trader skips PCE Wednesdays' });
  assert.equal(r.r_size, 0);
  assert.equal(r.override_reason, 'Trader skips PCE Wednesdays');
});

test("computeSize memory_overrides without a skip rule does not override", () => {
  const r = computeSize({ day_of_week: 'Tue', grade: 'A+', memory_overrides: 'Trader prefers tight stops' });
  assert.equal(r.r_size, 1.0);
  assert.equal(r.override_reason, null);
});

test("computeSize cites include memory.USER when memory_overrides passed (even empty string)", () => {
  const r = computeSize({ day_of_week: 'Tue', grade: 'A+', memory_overrides: '' });
  assert.deepEqual(r.cites.sort(), ['memory.USER', 'strategy.sizing-table']);
});

test("computeSize cites omit memory.USER when no memory_overrides passed", () => {
  const r = computeSize({ day_of_week: 'Tue', grade: 'A+' });
  assert.deepEqual(r.cites, ['strategy.sizing-table']);
});

test("computeSize unknown day defaults to Tue-Thu row (1.0R for A+)", () => {
  const r = computeSize({ day_of_week: 'Sat', grade: 'A+' });
  assert.equal(r.r_size, 1.0);
});
