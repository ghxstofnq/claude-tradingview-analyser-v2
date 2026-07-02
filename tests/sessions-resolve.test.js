// C7 regression: resolveSessionFolder must date an overnight (00:00-02:59 ET)
// idle write to YESTERDAY's ny-pm, not today's orphan folder. Live sessions and
// same-day idle windows pass through with today's date unchanged.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSessionFolder } from "../app/main/sessions.js";

describe("resolveSessionFolder (C7)", () => {
  const D = "2026-07-02";

  it("passes a live session through with today's date", () => {
    assert.deepEqual(resolveSessionFolder({ date: D, session: "ny-am", et_hour: 10, et_minute: 15 }), { date: D, folder: "ny-am" });
  });

  it("overnight idle (01:00 ET) → yesterday's ny-pm", () => {
    assert.deepEqual(resolveSessionFolder({ date: D, session: "idle", et_hour: 1, et_minute: 0 }), { date: "2026-07-01", folder: "ny-pm" });
  });

  it("post-PM idle (17:00 ET) → today's ny-pm", () => {
    assert.deepEqual(resolveSessionFolder({ date: D, session: "idle", et_hour: 17, et_minute: 0 }), { date: D, folder: "ny-pm" });
  });

  it("inter-session idle (12:30 ET) → today's ny-am", () => {
    assert.deepEqual(resolveSessionFolder({ date: D, session: "idle", et_hour: 12, et_minute: 30 }), { date: D, folder: "ny-am" });
  });

  it("post-London idle (07:00 ET) → today's london", () => {
    assert.deepEqual(resolveSessionFolder({ date: D, session: "idle", et_hour: 7, et_minute: 0 }), { date: D, folder: "london" });
  });

  it("overnight date shift crosses a month boundary", () => {
    assert.deepEqual(resolveSessionFolder({ date: "2026-03-01", session: "idle", et_hour: 2, et_minute: 30 }), { date: "2026-02-28", folder: "ny-pm" });
  });
});
