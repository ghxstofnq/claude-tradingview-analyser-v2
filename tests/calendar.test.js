// tests/calendar.test.js — unit tests for app/main/calendar.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  filterEvents,
  isImminent,
  groupByDay,
  countRemaining,
} from "../app/main/calendar.js";

describe("filterEvents", () => {
  it("keeps USD high + medium events; drops low + non-USD", () => {
    const raw = [
      { country: "USD", impact: "High",   date: "2026-05-27T12:30:00Z", title: "CPI" },
      { country: "USD", impact: "Medium", date: "2026-05-27T14:00:00Z", title: "Consumer Confidence" },
      { country: "USD", impact: "Low",    date: "2026-05-27T15:00:00Z", title: "Crude Inventories" },
      { country: "EUR", impact: "High",   date: "2026-05-27T08:00:00Z", title: "ECB Rate Decision" },
      { country: "GBP", impact: "Medium", date: "2026-05-27T09:30:00Z", title: "GDP" },
    ];
    const kept = filterEvents(raw);
    assert.equal(kept.length, 2);
    assert.equal(kept[0].event, "CPI");
    assert.equal(kept[1].event, "Consumer Confidence");
  });

  it("normalizes the impact strings to lower-case", () => {
    const raw = [{ country: "USD", impact: "High", date: "2026-05-27T12:30:00Z", title: "CPI" }];
    const kept = filterEvents(raw);
    assert.equal(kept[0].impact, "high");
  });

  it("handles empty / null input", () => {
    assert.deepEqual(filterEvents(null), []);
    assert.deepEqual(filterEvents([]), []);
    assert.deepEqual(filterEvents(undefined), []);
  });
});

describe("isImminent", () => {
  it("returns true for an event within 2h in the future", () => {
    const now = new Date("2026-05-27T12:00:00-04:00");
    const ev = { ts: "2026-05-27T13:30:00-04:00" };
    assert.equal(isImminent(ev, now), true);
  });

  it("returns false for an event already past", () => {
    const now = new Date("2026-05-27T12:00:00-04:00");
    const ev = { ts: "2026-05-27T11:00:00-04:00" };
    assert.equal(isImminent(ev, now), false);
  });

  it("returns false for an event more than 2h out", () => {
    const now = new Date("2026-05-27T12:00:00-04:00");
    const ev = { ts: "2026-05-27T16:00:00-04:00" };
    assert.equal(isImminent(ev, now), false);
  });

  it("treats events without ts as not-imminent", () => {
    assert.equal(isImminent({}, new Date()), false);
    assert.equal(isImminent(null, new Date()), false);
  });
});

describe("groupByDay", () => {
  it("groups events by ET weekday + date", () => {
    // 2026-05-25 is Memorial Day Monday; 2026-05-26 is Tuesday.
    const events = [
      { ts: "2026-05-25T13:30:00Z", event: "Monday early" }, // 09:30 ET Mon
      { ts: "2026-05-25T22:00:00Z", event: "Monday late"  }, // 18:00 ET Mon
      { ts: "2026-05-26T12:30:00Z", event: "Tuesday"      }, // 08:30 ET Tue
    ];
    const groups = groupByDay(events);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].weekday, "MON");
    assert.equal(groups[0].events.length, 2);
    assert.equal(groups[1].weekday, "TUE");
    assert.equal(groups[1].events.length, 1);
  });

  it("preserves chronological order across days", () => {
    const events = [
      { ts: "2026-05-29T12:00:00Z", event: "Friday" },
      { ts: "2026-05-27T12:00:00Z", event: "Wednesday" },
      { ts: "2026-05-28T12:00:00Z", event: "Thursday" },
    ];
    const groups = groupByDay(events);
    assert.deepEqual(groups.map((g) => g.weekday), ["WED", "THU", "FRI"]);
  });
});

describe("countRemaining", () => {
  it("counts only events strictly after now", () => {
    const now = new Date("2026-05-27T12:00:00-04:00");
    const events = [
      { ts: "2026-05-27T11:00:00-04:00" }, // past
      { ts: "2026-05-27T13:00:00-04:00" }, // future
      { ts: "2026-05-28T09:00:00-04:00" }, // future
    ];
    assert.equal(countRemaining(events, now), 2);
  });
});
