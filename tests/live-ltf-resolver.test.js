// Live LTF-bias fallback — the chain must not depend on an LLM turn for the
// open-reaction verdict (2026-06-12 London: auth-blocked catch-up left every
// live bar on missing_ltf_bias).

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveLtfBiasContext } from "../app/main/live-ltf-resolver.js";
import { openReactionWindowMs } from "../app/main/backtest-engine.js";

const SESSION = "london";
const DATE = "2026-06-12";
const W = openReactionWindowMs({ date: DATE, session: SESSION });
const tsAt = (offsetMin) => new Date(W.startMs + offsetMin * 60_000).toISOString();

const BRIEF = {
  pillar2_verdict: "good",
  primary_draw: { tf: "h4", kind: "fvg", dir: "bear", state: "fresh", took_liq: true, top: 29600, bottom: 29500, ce: 29550, cite: "engine_by_tf.h4.fvgs[0]" },
};

function bundleWith({ sweeps = [], swing = null } = {}) {
  return {
    gates: {
      engine: {
        pillar1: { sweeps },
        pillar3: { failure_swings: [], most_recent_structure: null, fvgs: [], structures_by_tier: { swing: swing ? [swing] : [] } },
      },
    },
  };
}

test("pre-boundary bars return null — the chain stays honestly blocked", () => {
  const r = deriveLtfBiasContext({ bundle: bundleWith(), brief: BRIEF, session: SESSION, eventTs: tsAt(10) });
  assert.equal(r, null);
});

test("post-boundary rejection toward the draw resolves aligned with A+ cap", () => {
  const sweeps = [{ target: "AS.H", price: 29590, side: "buy", swept_ms: W.startMs + 8 * 60_000, rejected: true }];
  const r = deriveLtfBiasContext({ bundle: bundleWith({ sweeps }), brief: BRIEF, session: SESSION, eventTs: tsAt(16) });
  assert.equal(r.bias, "bearish");
  assert.equal(r.htf_ltf_alignment, "aligned");
  assert.equal(r.grade_cap, "A+");
  assert.equal(r.source, "deterministic-resolver");
});

test("quiet open resolves unclear with null bias (chain stays blocked, honestly)", () => {
  const r = deriveLtfBiasContext({ bundle: bundleWith(), brief: BRIEF, session: SESSION, eventTs: tsAt(20) });
  assert.equal(r.bias, null);
  assert.equal(r.htf_ltf_alignment, "unclear");
  assert.equal(r.grade_cap, "B");
});

test("no brief draw → null (HTF bias underivable)", () => {
  const r = deriveLtfBiasContext({ bundle: bundleWith(), brief: {}, session: SESSION, eventTs: tsAt(20) });
  assert.equal(r, null);
});
