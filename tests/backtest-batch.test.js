import { test } from "node:test";
import assert from "node:assert/strict";
import { expandJobs, weekdaysBetween } from "../app/main/backtest-batch.js";

test("weekdaysBetween skips weekends, inclusive", () => {
  // 2026-06-08 Mon .. 2026-06-09 Tue → both weekdays
  assert.deepEqual(weekdaysBetween("2026-06-08", "2026-06-09"), ["2026-06-08", "2026-06-09"]);
  // a weekend in the middle is skipped: Fri 06-12 .. Mon 06-15
  assert.deepEqual(weekdaysBetween("2026-06-12", "2026-06-15"), ["2026-06-12", "2026-06-15"]);
});

test("expandJobs: range × sessions × symbol (both)", () => {
  const jobs = expandJobs({ symbol: "both", from: "2026-06-08", to: "2026-06-09", sessions: ["ny-am", "london"] });
  assert.equal(jobs.length, 2 * 2 * 2); // 2 days × 2 sessions × 2 symbols
  assert.ok(jobs.every((j) => j.date && j.session && j.symbol));
  assert.ok(jobs.some((j) => j.symbol === "MNQ1!") && jobs.some((j) => j.symbol === "MES1!"));
});

test("expandJobs: single symbol, single day", () => {
  const jobs = expandJobs({ symbol: "mnq", from: "2026-06-08", to: "2026-06-08", sessions: ["ny-am"] });
  assert.deepEqual(jobs, [{ date: "2026-06-08", session: "ny-am", symbol: "MNQ1!" }]);
});

test("expandJobs: empty when no sessions", () => {
  assert.equal(expandJobs({ symbol: "mnq", from: "2026-06-08", to: "2026-06-09", sessions: [] }).length, 0);
});
