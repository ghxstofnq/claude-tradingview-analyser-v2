// Tests for ET wall-clock → UTC ISO conversion used by `tv replay start --at`.
// The replay anchor is the single point in time TV's chart snaps to, so the
// conversion has to be DST-aware (EDT vs EST) without using any non-standard
// dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { etTimestampToIsoUtc } from "../packages/core/replay.js";

test("EDT (May): 09:30 ET → 13:30 UTC", () => {
  assert.equal(etTimestampToIsoUtc("2026-05-20", "09:30"), "2026-05-20T13:30:00.000Z");
});

test("EDT (May): 16:00 ET (NY close) → 20:00 UTC", () => {
  assert.equal(etTimestampToIsoUtc("2026-05-20", "16:00"), "2026-05-20T20:00:00.000Z");
});

test("EST (January): 09:30 ET → 14:30 UTC", () => {
  assert.equal(etTimestampToIsoUtc("2026-01-15", "09:30"), "2026-01-15T14:30:00.000Z");
});

test("EST (January): 18:00 ET (futures Sunday-style open) → 23:00 UTC", () => {
  assert.equal(etTimestampToIsoUtc("2026-01-15", "18:00"), "2026-01-15T23:00:00.000Z");
});

test("around DST spring-forward (March, after the jump): EDT", () => {
  // 2026-03-08 is the second Sunday — DST kicks in at 02:00 ET.
  // Any time on Monday 2026-03-09 is EDT.
  assert.equal(etTimestampToIsoUtc("2026-03-09", "09:30"), "2026-03-09T13:30:00.000Z");
});

test("around DST spring-forward (March, before the jump): EST", () => {
  // 2026-03-07 (Saturday) is still EST.
  assert.equal(etTimestampToIsoUtc("2026-03-07", "09:30"), "2026-03-07T14:30:00.000Z");
});

test("around DST fall-back (November, after the jump): EST", () => {
  // First Sunday Nov 2026 = Nov 1. From Nov 2 on it's EST.
  assert.equal(etTimestampToIsoUtc("2026-11-02", "09:30"), "2026-11-02T14:30:00.000Z");
});

test("midnight ET → ISO does not return 24:00", () => {
  // Edge case for the hour='2-digit' / hour12=false formatter which on
  // some Node versions returns "24" instead of "00" for midnight. Guarded
  // via parseInt(...) % 24 in the helper.
  const iso = etTimestampToIsoUtc("2026-05-20", "00:00");
  assert.equal(iso, "2026-05-20T04:00:00.000Z");
});

test("seconds default to 0", () => {
  // We only accept HH:MM in the CLI but the helper truncates anything extra.
  // Trader-facing: minute precision is enough — TV snaps to the bar that
  // covers the requested instant.
  assert.equal(etTimestampToIsoUtc("2026-05-20", "09:30"), "2026-05-20T13:30:00.000Z");
});

test("invalid date string throws", () => {
  assert.throws(() => etTimestampToIsoUtc("not-a-date", "09:30"));
});

test("invalid time string throws", () => {
  assert.throws(() => etTimestampToIsoUtc("2026-05-20", "not-a-time"));
});
