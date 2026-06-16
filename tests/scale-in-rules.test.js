import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SCALE_IN_MAX, DEDUP_WINDOW_MS, SCALE_IN_STOP_STREAK,
  greenLightReached, isNearDuplicate, canScaleInto, addsDisabledFromOutcomes,
} from "../cli/lib/scale-in-rules.js";
import { foldOpenTrades } from "../cli/lib/trade-outcomes.js";

describe("constants match the backtest", () => {
  it("SCALE_IN_MAX is 5, breaker 2, dedup 10min", () => {
    assert.equal(SCALE_IN_MAX, 5);
    assert.equal(SCALE_IN_STOP_STREAK, 2);
    assert.equal(DEDUP_WINDOW_MS, 10 * 60 * 1000);
  });
});

describe("greenLightReached (50% to TP1)", () => {
  it("long: true at exactly 50%", () => {
    assert.equal(greenLightReached({ side: "long", entry: 100, tp1: 110 }, 105), true);
  });
  it("long: false below 50%", () => {
    assert.equal(greenLightReached({ side: "long", entry: 100, tp1: 110 }, 104), false);
  });
  it("short: true at 50%", () => {
    assert.equal(greenLightReached({ side: "short", entry: 110, tp1: 100 }, 105), true);
  });
  it("false on bad input (entry==tp1)", () => {
    assert.equal(greenLightReached({ side: "long", entry: 100, tp1: 100 }, 100), false);
  });
});

describe("greenLightReached honors greenlight_ref (backtest parity)", () => {
  // Backtest fires green light off 50% to the nearest intraday objective
  // (greenlight_ref) when present, falling back to tp1 — backtest-engine.js
  // `GREENLIGHT_INTRADAY ? (a.greenlight_ref ?? a.tp1) : a.tp1`.
  it("long: uses greenlight_ref when nearer than tp1 (greenlights earlier)", () => {
    // 50% to ref(104) = 102; 50% to tp1(110) = 105. At 102 the ref-based
    // rule is true while the tp1-based rule would still be false.
    const a = { side: "long", entry: 100, tp1: 110, greenlight_ref: 104 };
    assert.equal(greenLightReached(a, 102), true);
  });
  it("short: uses greenlight_ref when present", () => {
    const a = { side: "short", entry: 110, tp1: 100, greenlight_ref: 106 };
    assert.equal(greenLightReached(a, 108), true); // 50% to 106 = 108
  });
  it("falls back to tp1 when greenlight_ref is null", () => {
    const a = { side: "long", entry: 100, tp1: 110, greenlight_ref: null };
    assert.equal(greenLightReached(a, 104), false); // below 50% to tp1
    assert.equal(greenLightReached(a, 105), true);
  });
  it("falls back to tp1 when greenlight_ref is absent", () => {
    assert.equal(greenLightReached({ side: "long", entry: 100, tp1: 110 }, 105), true);
  });

  it("round-trip: accept event → foldOpenTrades → anchor green-lights off the ref", () => {
    // Mirrors the live accept event shape (app/main/trades.js acceptSetup),
    // which now carries greenlight_ref. foldOpenTrades spreads ...ev, so the
    // folded anchor exposes it to greenLightReached — the live chain end-to-end.
    const events = [{
      type: "accept", id: "t1", side: "long",
      entry: 100, stop: 95, tp1: 110, tp2: 130, greenlight_ref: 104,
    }];
    const [anchor] = foldOpenTrades(events);
    assert.equal(anchor.greenlight_ref, 104);
    assert.equal(greenLightReached(anchor, 102), true);  // 50% to ref(104)=102
  });
});

describe("isNearDuplicate (same side within 10 min)", () => {
  const log = [{ side: "long", tp1: 110, ms: 1000 }];
  it("true: same side within window", () => {
    assert.equal(isNearDuplicate({ side: "long", event_ts: new Date(1000 + 5 * 60000).toISOString() }, log), true);
  });
  it("false: same side outside window", () => {
    assert.equal(isNearDuplicate({ side: "long", event_ts: new Date(1000 + 11 * 60000).toISOString() }, log), false);
  });
  it("false: opposite side", () => {
    assert.equal(isNearDuplicate({ side: "short", event_ts: new Date(1000 + 5 * 60000).toISOString() }, log), false);
  });
});

describe("canScaleInto", () => {
  const anchor = { side: "long", greenLight: true };
  const log = [];
  it("true: green-lit, same side, under max, not dup", () => {
    assert.equal(canScaleInto({ anchor, setup: { side: "long", event_ts: new Date().toISOString() }, openCount: 1, takenLog: log }), true);
  });
  it("false: anchor not green-lit", () => {
    assert.equal(canScaleInto({ anchor: { side: "long", greenLight: false }, setup: { side: "long", event_ts: new Date().toISOString() }, openCount: 1, takenLog: log }), false);
  });
  it("false: opposite side", () => {
    assert.equal(canScaleInto({ anchor, setup: { side: "short", event_ts: new Date().toISOString() }, openCount: 1, takenLog: log }), false);
  });
  it("false: at max (1 anchor + 5 adds)", () => {
    assert.equal(canScaleInto({ anchor, setup: { side: "long", event_ts: new Date().toISOString() }, openCount: 6, takenLog: log }), false);
  });
  it("respects maxAdds override", () => {
    assert.equal(canScaleInto({ anchor, setup: { side: "long", event_ts: new Date().toISOString() }, openCount: 3, takenLog: log, maxAdds: 2 }), false);
  });
});

describe("addsDisabledFromOutcomes (2 add-stops in a row)", () => {
  it("true after 2 consecutive add stop-outs", () => {
    const ev = [
      { type: "outcome", status: "STOPPED", tranche_role: "add", ts: "2026-06-15T14:00:00Z" },
      { type: "outcome", status: "STOPPED", tranche_role: "add", ts: "2026-06-15T14:05:00Z" },
    ];
    assert.equal(addsDisabledFromOutcomes(ev), true);
  });
  it("a winning add resets the streak", () => {
    const ev = [
      { type: "outcome", status: "STOPPED", tranche_role: "add", ts: "2026-06-15T14:00:00Z" },
      { type: "outcome", status: "TP1_HIT", tranche_role: "add", ts: "2026-06-15T14:05:00Z" },
      { type: "outcome", status: "STOPPED", tranche_role: "add", ts: "2026-06-15T14:10:00Z" },
    ];
    assert.equal(addsDisabledFromOutcomes(ev), false);
  });
  it("anchor stop-outs do not count", () => {
    const ev = [
      { type: "outcome", status: "STOPPED", tranche_role: "anchor", ts: "2026-06-15T14:00:00Z" },
      { type: "outcome", status: "STOPPED", tranche_role: "add", ts: "2026-06-15T14:05:00Z" },
    ];
    assert.equal(addsDisabledFromOutcomes(ev), false);
  });
});

describe("parity: green-lit anchor then two same-side packets", () => {
  it("first within window = dup, second outside = add", () => {
    const anchor = { side: "long", entry: 100, tp1: 110, greenLight: true };
    const takenLog = [{ side: "long", tp1: 110, ms: 0 }];
    const dup = { side: "long", event_ts: new Date(5 * 60000).toISOString() };
    const add = { side: "long", event_ts: new Date(11 * 60000).toISOString() };
    assert.equal(canScaleInto({ anchor, setup: dup, openCount: 1, takenLog }), false);
    assert.equal(canScaleInto({ anchor, setup: add, openCount: 1, takenLog }), true);
  });
});
