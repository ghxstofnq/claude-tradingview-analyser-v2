// C8 regression: the CME equity-index holiday / early-close calendar, and the
// supervisor gating that consumes it. A weekday holiday must read as closed so
// the chain never arms/hunts on a shut or half-day market.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isHolidayFullClose, earlyCloseMinuteET, isHolidayClosed } from "../cli/lib/market-calendar.js";
import { upcomingSession } from "../app/main/session-supervisor.js";

describe("market-calendar (C8)", () => {
  it("full closures are closed at every ET minute", () => {
    assert.equal(isHolidayFullClose("2026-12-25"), true);
    assert.equal(isHolidayClosed("2026-01-01", 3 * 60), true);   // London hour
    assert.equal(isHolidayClosed("2026-04-03", 10 * 60), true);  // Good Friday, NY AM
  });

  it("early-close days trade the morning, close from 13:00 ET", () => {
    assert.equal(earlyCloseMinuteET("2026-07-03"), 13 * 60);
    assert.equal(isHolidayClosed("2026-07-03", 10 * 60), false);       // NY AM open
    assert.equal(isHolidayClosed("2026-07-03", 13 * 60), true);        // NY PM blocked
    assert.equal(isHolidayClosed("2026-07-03", 13 * 60 + 30), true);
    assert.equal(isHolidayFullClose("2026-07-03"), false);
  });

  it("a normal weekday is never holiday-closed", () => {
    assert.equal(isHolidayClosed("2026-07-06", 10 * 60), false);
    assert.equal(earlyCloseMinuteET("2026-07-06"), null);
  });

  it("undefined date does not throw and is not closed (back-compat)", () => {
    assert.equal(isHolidayClosed(undefined, 600), false);
  });

  it("supervisor does not flag a session on a full-closure holiday", () => {
    // New Year's Day 2026 (Thu), 10 min before NY AM open.
    assert.equal(upcomingSession({ weekday: "Thu", etMinutes: 9 * 60 + 20, date: "2026-01-01" }), null);
  });

  it("supervisor still flags the morning session on an early-close day", () => {
    // July 3 (Fri), 10 min before NY AM — the morning is a normal session.
    assert.equal(upcomingSession({ weekday: "Fri", etMinutes: 9 * 60 + 20, date: "2026-07-03" }), "ny-am");
  });
});
