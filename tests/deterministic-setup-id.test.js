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

// One deterministic fold per underlying bar: the queue synthesizes a
// 5m-tagged copy of the same minute event at 5m boundaries; both copies
// must resolve to the SAME cache key so the second drain reuses the first
// fold's truth (live 2026-06-12 London: duplicate truth records + double
// walker advancement every 5th minute).
test("5m-tagged copy of a bar keys to the same truth cache entry", () => {
  const base = { ts: "2026-06-12T09:00:00.000Z", tf: "1m", bar_close_time: 1781254800, is_5m_close: true };
  const fiveM = { ...base, tf: "5m" };
  assert.equal(__test.truthCacheKeyFor(base), __test.truthCacheKeyFor(fiveM));
  assert.notEqual(__test.truthCacheKeyFor(base), __test.truthCacheKeyFor({ ...base, bar_close_time: 1781254860 }));
});

// The per-bar LLM gate must be provider-aware: a Claude login failure must
// not suppress turns when the purpose resolves to Codex (2026-06-12: Claude
// 401 muted narration even though Codex was authenticated and selected).
test("bar-close LLM gate only blocks when the resolved provider is claude", () => {
  const { llmTurnAuthBlocked } = __test;
  assert.equal(llmTurnAuthBlocked({ providerName: "claude", claudeBlocked: true }), true);
  assert.equal(llmTurnAuthBlocked({ providerName: "claude", claudeBlocked: false }), false);
  assert.equal(llmTurnAuthBlocked({ providerName: "codex", claudeBlocked: true }), false);
});
