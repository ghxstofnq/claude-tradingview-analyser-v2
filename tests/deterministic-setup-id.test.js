// Surfaced setup ids must be unique per walker and stable across bars.
//
// 2026-06-12 (user report: "there could be more than one trade in a day"):
// deterministicSetupId truncated the walker id to 14 chars — every walker id
// starts with walker_<market>_<session>, so EVERY setup in a session
// collided into one surfaced id ("D-walkermnq1nyam"). The backtest's
// de-dup then swallowed every setup after the first, and live journaling
// keyed different setups to the same id.

import { test } from "node:test";
import assert from "node:assert/strict";
import { __test } from "../app/main/bar-close.js";

const { deterministicPacketToSurfacePayload } = __test;

const ev = { ts: "2026-06-09T13:58:00.000Z", tf: "1m" };

function packet(walkerId, overrides = {}) {
  return {
    walkerId,
    model: "Inversion",
    side: "short",
    grade: "A+",
    entry: { price: 29691, evidenceRef: "e" },
    stop: { price: 29727.25, evidenceRef: "s" },
    tp1: { price: 29566, evidenceRef: "t" },
    blockers: [],
    ...overrides,
  };
}

test("different walkers in the same session get different setup ids", () => {
  const a = deterministicPacketToSurfacePayload(packet("walker_mnq1!_ny-am_inversion_short_zone_29792-29811_2026-06-09t13:47"), ev);
  const b = deterministicPacketToSurfacePayload(packet("walker_mnq1!_ny-am_mss_long_zone_29700-29706_2026-06-09t13:55"), ev);
  assert.notEqual(a.id, b.id);
});

test("the same walker keeps the same setup id across bars", () => {
  const w = "walker_mnq1!_ny-am_inversion_short_zone_29792-29811_2026-06-09t13:47";
  const a = deterministicPacketToSurfacePayload(packet(w), { ts: "2026-06-09T13:58:00.000Z" });
  const b = deterministicPacketToSurfacePayload(packet(w), { ts: "2026-06-09T14:05:00.000Z" });
  assert.equal(a.id, b.id);
});

// 2026-06-12 London live session: every bar blocked 'unknown_session' —
// the strategy context only accepted ny-am/ny-pm. London is a first-class
// session (briefs fire for it, the supervisor arms for it, §2.2 names its
// levels); the chain must walk it.
test("london is a valid strategy session", async () => {
  const { buildStrategyContext } = await import("../app/main/strategy/context/build-strategy-context.js");
  const ctx = buildStrategyContext({ market: "MNQ1!", session: "london", gates: { engine: {} } });
  const all = [...(ctx.sourceHealth?.blockers ?? []), ...(ctx.blockers ?? [])];
  assert.ok(!all.includes("unknown_session"), `unexpected unknown_session in ${all}`);
});
