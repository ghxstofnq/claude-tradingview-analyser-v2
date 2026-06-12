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

// 2026-06-12 NY-AM live: a paired baseline refresh crashed mid-sweep and
// left the chart on MES@5m; the chain folded MES bars against MNQ context
// for 23 minutes without noticing. The fold must fail closed on a
// symbol mismatch — wrong-symbol evidence is an instrument failure.
test("fold blocks symbol_mismatch when the bundle's chart symbol is not the leader", async () => {
  const truth = await __test.buildDeterministicPacketTruthFromInputs({
    inputs: {
      bundle: {
        chart: { symbol: "CME_MINI:MES1!" },
        quote: { last: 7410, time: 1781275900 },
        bars: { last_5_bars: [{ time: 1781275840, open: 7409, high: 7412, low: 7408, close: 7410 }] },
        engine: {},
        gates: {
          engine: {
            // healthy MES table — today's real case: the wrong symbol's
            // engine was perfectly healthy, so only an identity check
            // could catch the hijack
            meta: { schema: 2, schema_supported: true, stale: false },
            price_context: { last: 7410, inside_fvgs: [], inside_bprs: [] },
            pillar1: { sweeps: [] },
            pillar2: { current_tf: { range_3h: 20, range_quality: "good", displacement: "clean", candle: "normal" } },
            pillar3: { fvgs: [{ kind: "fvg", dir: "bull", top: 7420, bottom: 7400, ce: 7410, state: "fresh", took_liq: false, disp_score: 0.5 }], bprs: [], failure_swings: [], most_recent_structure: null, structures_by_tier: { swing: [] }, swings: { swing: [], internal: [] } },
            confirmation: { last_bar: { direction: "bull", body_ratio: 0.6 }, last_bar_age_seconds: 10 },
          },
        },
      },
      leader: "MNQ1!",
      ltf_bias_context: { bias: "bearish", htf_ltf_alignment: "aligned", is_retrace_day: false, entry_model_priority: "MSS", grade_cap: "B" },
      session_state: { pillar1: { status: "pass" }, pillar2: { status: "pass" } },
      untaken_targets: { untaken_above: [], untaken_below: [] },
    },
    previousWalkers: [],
    event: { ts: "2026-06-12T14:20:00.000Z", tf: "1m" },
    session: "ny-am",
  });
  assert.equal(truth.finalVerdict, "no_trade");
  assert.ok(truth.blockers.includes("symbol_mismatch"), `blockers: ${truth.blockers}`);
  // walkers must not advance on wrong-symbol evidence
  assert.equal(truth.walkersChanged, false);
});
