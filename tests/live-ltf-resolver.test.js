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

// §2.3 "never marries a bias" + §7 Step 5 (MSS = the LTF turning): after the
// open window, a SWING-tier MSS confirming against the current bias realigns
// it — the day's direction is allowed to change mid-session on real
// structure (2026-06-12 NY-AM read bullish-divergent at 09:47 and was frozen
// there while the question stood all morning).
test("post-window swing-tier MSS against the bias realigns it", () => {
  const sweeps = [{ target: "LO.H", price: 29700, side: "buy", swept_ms: W.startMs + 8 * 60_000, rejected: false }];
  const mssBear = { event: "mss", dir: "bear", tier: "swing", confirmed_ms: W.endMs + 40 * 60_000 };
  const r = deriveLtfBiasContext({
    bundle: bundleWith({ sweeps, swing: mssBear }),
    brief: BRIEF, session: SESSION,
    eventTs: new Date(W.endMs + 45 * 60_000).toISOString(),
  });
  // continuation up over LO.H read bullish-divergent vs the bearish draw;
  // the later swing MSS bear realigns the day bearish-aligned
  assert.equal(r.bias, "bearish");
  assert.equal(r.htf_ltf_alignment, "aligned");
  assert.equal(r.source, "deterministic-resolver:realigned");
  assert.match(r.cite, /structure/);
});

test("post-window swing MSS agreeing with the bias does not change it", () => {
  const sweeps = [{ target: "AS.H", price: 29600, side: "buy", swept_ms: W.startMs + 8 * 60_000, rejected: true }];
  const mssBear = { event: "mss", dir: "bear", tier: "swing", confirmed_ms: W.endMs + 40 * 60_000 };
  const r = deriveLtfBiasContext({
    bundle: bundleWith({ sweeps, swing: mssBear }),
    brief: BRIEF, session: SESSION,
    eventTs: new Date(W.endMs + 45 * 60_000).toISOString(),
  });
  assert.equal(r.bias, "bearish");
  assert.equal(r.source, "deterministic-resolver");
});

test("a swing BOS without displacement never flips the bias", () => {
  const sweeps = [{ target: "LO.H", price: 29700, side: "buy", swept_ms: W.startMs + 8 * 60_000, rejected: false }];
  const bosBear = { event: "bos", dir: "bear", tier: "swing", confirmed_ms: W.endMs + 40 * 60_000 };
  const r = deriveLtfBiasContext({
    bundle: bundleWith({ sweeps, swing: bosBear }),
    brief: BRIEF, session: SESSION,
    eventTs: new Date(W.endMs + 45 * 60_000).toISOString(),
  });
  // continuation up over LO.H reads bullish-divergent; a no-displacement BoS is
  // too weak to realign, so the open-reaction bias stands.
  assert.equal(r.bias, "bullish");
  assert.equal(r.source, "deterministic-resolver");
});

// 2026-06-18 NY-AM: a swing-tier BoS WITH displacement against the bias is a
// structural turn (a higher high / lower low) and realigns the day — the case
// the MSS-only filter skipped while two more shorts stacked into the reversal.
test("a swing BOS with displacement realigns the bias", () => {
  const sweeps = [{ target: "LO.H", price: 29700, side: "buy", swept_ms: W.startMs + 8 * 60_000, rejected: false }];
  const bosBearDisp = { event: "bos", dir: "bear", tier: "swing", displacement: true, confirmed_ms: W.endMs + 40 * 60_000 };
  const r = deriveLtfBiasContext({
    bundle: bundleWith({ sweeps, swing: bosBearDisp }),
    brief: BRIEF, session: SESSION,
    eventTs: new Date(W.endMs + 45 * 60_000).toISOString(),
  });
  // bullish-divergent open flips bearish-aligned on the displacement BoS
  assert.equal(r.bias, "bearish");
  assert.equal(r.source, "deterministic-resolver:realigned");
});

// §2.3 "never marries a bias" + user ruling 2026-06-12: a quiet open leaves
// the LTF bias PENDING, not the day untradeable. The first swing-tier
// structure event after the window EARNS the day its direction (B cap —
// §7 Step 7 "neutral overnight" stays one weaker element, even aligned).
test("unclear open: the first post-window swing structure earns the LTF bias at B cap", () => {
  const swing = { event: "bos", dir: "bear", tier: "swing", confirmed_ms: W.endMs + 50 * 60_000 };
  const r = deriveLtfBiasContext({
    bundle: bundleWith({ swing }),
    brief: BRIEF, session: SESSION,
    eventTs: new Date(W.endMs + 55 * 60_000).toISOString(),
  });
  assert.equal(r.bias, "bearish");
  assert.equal(r.htf_ltf_alignment, "aligned"); // BRIEF draw is bearish
  assert.equal(r.grade_cap, "B");               // neutral overnight caps at B
  assert.equal(r.interaction, "late_direction");
  assert.equal(r.source, "deterministic-resolver:late-direction");
});

test("unclear open with no post-window structure stays pending", () => {
  const r = deriveLtfBiasContext({
    bundle: bundleWith(),
    brief: BRIEF, session: SESSION,
    eventTs: new Date(W.endMs + 55 * 60_000).toISOString(),
  });
  assert.equal(r.bias, null);
  assert.equal(r.htf_ltf_alignment, "unclear");
});

test("late-earned direction can still be flipped by a later opposing swing MSS", () => {
  // structure earns bullish at +40min, then a swing MSS bear at +90min flips it
  const swings = [
    { event: "bos", dir: "bull", tier: "swing", confirmed_ms: W.endMs + 40 * 60_000 },
    { event: "mss", dir: "bear", tier: "swing", confirmed_ms: W.endMs + 90 * 60_000 },
  ];
  const b = bundleWith();
  b.gates.engine.pillar3.structures_by_tier = { swing: swings };
  const r = deriveLtfBiasContext({
    bundle: b, brief: BRIEF, session: SESSION,
    eventTs: new Date(W.endMs + 95 * 60_000).toISOString(),
  });
  assert.equal(r.bias, "bearish");
  assert.equal(r.htf_ltf_alignment, "aligned");
});

// Pillar 1 HTF fallback (§2.4 / §7 Step 7): a NEUTRAL NY-AM open (no resolved
// bias past the window) trades the HTF direction at B. NY-AM only; never PM.
const AMW = openReactionWindowMs({ date: "2026-06-12", session: "ny-am" });
const amTsPast = (offMin) => new Date(AMW.endMs + offMin * 60_000).toISOString();

test("NY-AM neutral open past the window falls back to HTF bias at B", () => {
  const r = deriveLtfBiasContext({ bundle: bundleWith(), brief: BRIEF, session: "ny-am", eventTs: amTsPast(5) });
  assert.equal(r.bias, "bearish"); // HTF direction (brief bear draw)
  assert.equal(r.htf_ltf_alignment, "unclear");
  assert.equal(r.grade_cap, "B");
  assert.equal(r.interaction, "htf_fallback");
  assert.equal(r.source, "deterministic-resolver:htf-fallback");
});

test("NY-PM neutral open does NOT fall back (PM is usually chop)", () => {
  const pmw = openReactionWindowMs({ date: "2026-06-12", session: "ny-pm" });
  const r = deriveLtfBiasContext({ bundle: bundleWith(), brief: BRIEF, session: "ny-pm", eventTs: new Date(pmw.endMs + 5 * 60_000).toISOString() });
  assert.equal(r.bias, null);
});

test("NY-AM neutral open INSIDE the window does not fall back yet", () => {
  const r = deriveLtfBiasContext({ bundle: bundleWith(), brief: BRIEF, session: "ny-am", eventTs: new Date(AMW.resolveMs + 2 * 60_000).toISOString() });
  assert.equal(r.bias, null);
});

test("a real structure still wins over the HTF fallback (per-bar recompute)", () => {
  const b = bundleWith();
  b.gates.engine.pillar3.structures_by_tier = { swing: [{ event: "bos", dir: "bull", tier: "swing", confirmed_ms: AMW.endMs + 2 * 60_000 }] };
  const r = deriveLtfBiasContext({ bundle: b, brief: BRIEF, session: "ny-am", eventTs: amTsPast(5) });
  assert.equal(r.bias, "bullish");       // late_direction wins, not the bear fallback
  assert.equal(r.interaction, "late_direction");
});

test("opt-out (GOFNQ_P1_HTF_FALLBACK=0) keeps the chain honestly blocked", () => {
  process.env.GOFNQ_P1_HTF_FALLBACK = "0";
  try {
    const r = deriveLtfBiasContext({ bundle: bundleWith(), brief: BRIEF, session: "ny-am", eventTs: amTsPast(5) });
    assert.equal(r.bias, null);
  } finally {
    delete process.env.GOFNQ_P1_HTF_FALLBACK;
  }
});

// Full open-window close coverage (live≠backtest fix 2026-06-21): the §7-Step-4
// accept-bars count needs ALL in-window closes. With only the last few (live's
// bundle tail) a weak divergent rejection reads clean; with the full window it
// correctly stands aside — matching the backtest. ACCEPT_BARS_MAX = 5.
const amW = openReactionWindowMs({ date: "2026-06-12", session: "ny-am" });
function closesAbove(n, level) {
  // n in-window closes holding ABOVE the swept high (break accepted)
  return Array.from({ length: n }, (_, i) => ({ time_ms: amW.startMs + (9 + i) * 60_000, close: level + 10 }));
}
const HIGH_SWEEP = [{ target: "AS.H", price: 29600, side: "buy", swept_ms: amW.startMs + 8 * 60_000, rejected: false }];
const tsAm = (m) => new Date(amW.startMs + m * 60_000).toISOString();

test("partial closes (4 accept bars) keep the divergent bias — the under-read", () => {
  const r = deriveLtfBiasContext({
    bundle: bundleWith({ sweeps: HIGH_SWEEP }), brief: BRIEF, session: "ny-am",
    eventTs: tsAm(20), windowClosesOverride: closesAbove(4, 29600),
  });
  assert.equal(r.bias, "bullish"); // continuation up over AS.H, divergent vs bearish HTF
});

test("full closes (6 accept bars) stand aside — divergent_weak_rejection, matches backtest", () => {
  const r = deriveLtfBiasContext({
    bundle: bundleWith({ sweeps: HIGH_SWEEP }), brief: BRIEF, session: "ny-am",
    eventTs: tsAm(20), windowClosesOverride: closesAbove(6, 29600),
  });
  assert.equal(r.bias, null);
  assert.equal(r.interaction, "divergent_weak_rejection");
});

// Post-window freeze guard: a `rejected` flag that matures AFTER minute 30 must
// not flip a frozen verdict when we have window-close coverage (2026-06-01 PM).
const REJECTED_FLAG_SWEEP = [{ target: "LO.H", price: 29700, side: "buy", swept_ms: amW.startMs + 8 * 60_000, rejected: true }];
test("post-window: matured rejected flag is ignored WHEN closes are present", () => {
  // closes hold above the level (no in-window rejection) → with the flag ignored
  // the read stays continuation/bullish, matching the backtest's frozen verdict.
  const r = deriveLtfBiasContext({
    bundle: bundleWith({ sweeps: REJECTED_FLAG_SWEEP }), brief: BRIEF, session: "ny-am",
    eventTs: tsAm(40), windowClosesOverride: closesAbove(3, 29700),
  });
  assert.equal(r.bias, "bullish");
});

test("post-window: rejected flag is HONORED when there are no closes (degraded start)", () => {
  const r = deriveLtfBiasContext({
    bundle: bundleWith({ sweeps: REJECTED_FLAG_SWEEP }), brief: BRIEF, session: "ny-am",
    eventTs: tsAm(40), windowClosesOverride: [],
  });
  assert.equal(r.bias, "bearish"); // high rejected → bearish
});
