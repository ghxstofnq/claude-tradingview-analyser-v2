import { test } from "node:test";
import assert from "node:assert/strict";
import { untakenSessionDraws, __test } from "../cli/lib/session-levels.js";
const { classify, computeSessionHistory } = __test;

// Helper: a 1H bar at a UTC instant (June = EDT, ET = UTC-4).
const bar = (iso, high, low) => ({ time: Math.floor(Date.parse(iso) / 1000), high, low });
const ms = (iso) => Date.parse(iso);

test("classify — maps ET time to the right session + session day", () => {
  // 10:00 ET = 14:00 UTC → NY AM, same day.
  assert.deepEqual(classify(ms("2026-06-04T14:00:00Z")), { name: "ny_am", sessionDay: "2026-06-04", key: "ny_am:2026-06-04" });
  // 14:00 ET = 18:00 UTC → NY PM.
  assert.equal(classify(ms("2026-06-04T18:00:00Z"))?.name, "ny_pm");
  // 01:00 ET = 05:00 UTC → Asia, belongs to the PRIOR day (session started 18:00 prev day).
  assert.deepEqual(classify(ms("2026-06-05T05:00:00Z")), { name: "asia", sessionDay: "2026-06-04", key: "asia:2026-06-04" });
});

test("computeSessionHistory — groups bars into per-session high/low", () => {
  const candles = [
    bar("2026-06-04T17:00:00Z", 30850, 30800), // 13:00 ET PM
    bar("2026-06-04T18:00:00Z", 30896, 30840), // 14:00 ET PM — the high
    bar("2026-06-04T19:00:00Z", 30870, 30830), // 15:00 ET PM
  ];
  const h = computeSessionHistory(candles);
  const pm = h.get("ny_pm:2026-06-04");
  assert.ok(pm);
  assert.equal(pm.high, 30896);
  assert.equal(pm.low, 30800);
});

test("untakenSessionDraws — surfaces an untaken PM high above price, no-lookahead", () => {
  const candles = [
    // June 4 PM: high 30896.
    bar("2026-06-04T17:00:00Z", 30850, 30800),
    bar("2026-06-04T18:00:00Z", 30896, 30840),
    bar("2026-06-04T19:00:00Z", 30870, 30830),
    // June 5 AM/PM: price stays below 30896 (so it remains untaken).
    bar("2026-06-05T14:00:00Z", 30700, 30650),
    bar("2026-06-05T18:00:00Z", 30720, 30680),
  ];
  const { above } = untakenSessionDraws(candles, { price: 30600, asOfMs: ms("2026-06-08T14:00:00Z") });
  const hit = above.find((x) => x.price === 30896);
  assert.ok(hit, "June 4 PM high 30896 should surface");
  assert.equal(hit.name, "NYPM.H");
  assert.equal(hit.sessionDay, "2026-06-04");
  assert.equal(hit.source, "session_draw");
});

test("untakenSessionDraws — a high taken later is NOT a draw", () => {
  const candles = [
    bar("2026-06-04T18:00:00Z", 30896, 30840), // June 4 PM high
    bar("2026-06-06T18:00:00Z", 30950, 30900), // later: price trades ABOVE 30896 → taken
  ];
  const { above } = untakenSessionDraws(candles, { price: 30600, asOfMs: ms("2026-06-08T14:00:00Z") });
  assert.ok(!above.find((x) => x.price === 30896), "swept high must be excluded");
});

test("untakenSessionDraws — sessions after asOf are excluded (no lookahead)", () => {
  const candles = [
    bar("2026-06-04T18:00:00Z", 30896, 30840), // June 4 PM (before asOf)
    bar("2026-06-09T18:00:00Z", 31200, 31100), // June 9 PM (AFTER asOf) — must not appear
  ];
  const { above } = untakenSessionDraws(candles, { price: 30600, asOfMs: ms("2026-06-08T14:00:00Z") });
  assert.ok(above.find((x) => x.price === 30896), "pre-asOf high present");
  assert.ok(!above.find((x) => x.price === 31200), "post-asOf high must be excluded");
});

test("untakenSessionDraws — untaken low below price surfaces as a downside draw", () => {
  const candles = [
    bar("2026-06-04T18:00:00Z", 30896, 30500), // PM low 30500
    bar("2026-06-05T18:00:00Z", 30700, 30650), // stays above 30500 → low untaken
  ];
  const { below } = untakenSessionDraws(candles, { price: 30800, asOfMs: ms("2026-06-08T14:00:00Z") });
  assert.ok(below.find((x) => x.price === 30500 && x.name === "NYPM.L"), "untaken PM low should surface");
});
