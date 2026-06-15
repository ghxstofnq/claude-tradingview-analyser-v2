import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { finalizeOpenReactionDeterministic } from "../app/main/live-open-reaction-finalizer.js";

// A recording deps stub. Every external effect (capture, file reads, the three
// surface writers, the bias resolver) is injected so the test is pure — no fs,
// no CDP, no Electron. Mirrors the backtest's single deterministic resolution.
function makeDeps(overrides = {}) {
  const calls = { leaderDecision: [], ltfBias: [], openReaction: [], capture: 0 };
  const deps = {
    readExistingLeader: async () => null,
    readPersistedBias: async () => null,
    readBrief: async () => ({ primary_draw: { dir: "below" }, htf_bias_dir: "bearish" }),
    capture: async () => {
      calls.capture += 1;
      return {
        bundle: {
          pair: {
            primary: "MNQ1!",
            secondary: "MES1!",
            leader_evidence: { leader: "MES1!", reason: "secondary_higher_disp_score", margin: 0.4 },
            symbols: {
              "MNQ1!": { symbol: "MNQ1!", gates: { engine: {} } },
              "MES1!": { symbol: "MES1!", gates: { engine: {} } },
            },
          },
        },
      };
    },
    deriveBias: async () => ({
      bias: "bearish",
      htf_ltf_alignment: "aligned",
      is_retrace_day: false,
      entry_model_priority: "trend",
      grade_cap: "A+",
      source: "deterministic-resolver",
      cite: "gates.engine.pillar1.sweeps[0]",
      interaction: "break_rejection",
    }),
    writeLeaderDecision: async (p) => { calls.leaderDecision.push(p); },
    writeLtfBias: async (p) => { calls.ltfBias.push(p); },
    writeOpenReaction: async (p) => { calls.openReaction.push(p); },
    ...overrides,
  };
  return { deps, calls };
}

const BASE = { session: "ny-am", eventTs: "2026-06-15T13:45:00.000Z", minutesIntoPhase: 14 };

describe("finalizeOpenReactionDeterministic", () => {
  it("picks the leader from pair.leader_evidence and writes all three files (no LLM)", async () => {
    const { deps, calls } = makeDeps();
    const r = await finalizeOpenReactionDeterministic({ ...BASE, deps });
    assert.equal(r.wrote, true);
    assert.equal(r.leader, "MES1!");
    assert.equal(r.bias, "bearish");
    assert.equal(calls.leaderDecision.length, 1);
    assert.equal(calls.leaderDecision[0].leader, "MES1!");
    assert.equal(calls.leaderDecision[0].primary, "MNQ1!");
    assert.equal(calls.ltfBias.length, 1);
    assert.equal(calls.ltfBias[0].ltf_bias, "bearish");
    assert.equal(calls.ltfBias[0].grade_cap, "A+");
    assert.equal(calls.openReaction.length, 1);
    assert.equal(calls.openReaction[0].bias_direction, "bearish");
  });

  it("defaults the leader to PAIR_PRIMARY when the evidence is inconclusive (null)", async () => {
    const { deps, calls } = makeDeps({
      capture: async () => ({
        bundle: {
          pair: {
            primary: "MNQ1!", secondary: "MES1!",
            leader_evidence: { leader: null, reason: "inconclusive_margin_below_threshold" },
            symbols: { "MNQ1!": { symbol: "MNQ1!", gates: { engine: {} } }, "MES1!": { symbol: "MES1!", gates: { engine: {} } } },
          },
        },
      }),
    });
    const r = await finalizeOpenReactionDeterministic({ ...BASE, deps });
    assert.equal(r.leader, "MNQ1!");
    assert.equal(calls.leaderDecision[0].leader, "MNQ1!");
  });

  it("does NOT re-write the leader decision when a pair-decision already exists", async () => {
    const { deps, calls } = makeDeps({
      readExistingLeader: async () => "MNQ1!",
      // pair-decision exists → CLI short-circuits to a single-symbol bundle
      capture: async () => ({ bundle: { symbol: "MNQ1!", gates: { engine: {} } } }),
    });
    const r = await finalizeOpenReactionDeterministic({ ...BASE, deps });
    assert.equal(r.wrote, true);
    assert.equal(r.leader, "MNQ1!");
    assert.equal(calls.leaderDecision.length, 0);
    assert.equal(calls.ltfBias.length, 1);
  });

  it("writes a pending (null) bias when the resolver has no verdict yet — file exists, gate still blocks", async () => {
    const { deps, calls } = makeDeps({ deriveBias: async () => null });
    const r = await finalizeOpenReactionDeterministic({ ...BASE, deps });
    assert.equal(r.wrote, true);
    assert.equal(r.bias, null);
    assert.equal(calls.ltfBias.length, 1);
    assert.equal(calls.ltfBias[0].ltf_bias, null);
    assert.equal(calls.ltfBias[0].grade_cap, "B"); // default cap
    assert.equal(calls.openReaction[0].bias_direction, "pending");
  });

  it("is idempotent — skips when a leader AND a final (non-pending) bias already exist", async () => {
    const { deps, calls } = makeDeps({
      readExistingLeader: async () => "MNQ1!",
      readPersistedBias: async () => "bearish",
    });
    const r = await finalizeOpenReactionDeterministic({ ...BASE, deps });
    assert.equal(r.wrote, false);
    assert.equal(r.reason, "already_final");
    assert.equal(calls.capture, 0);
    assert.equal(calls.ltfBias.length, 0);
  });

  it("treats a persisted 'pending'/'stand_aside' bias as NOT final (re-runs)", async () => {
    for (const pending of ["pending", "stand_aside", "", "  "]) {
      const { deps, calls } = makeDeps({
        readExistingLeader: async () => "MNQ1!",
        readPersistedBias: async () => pending,
        capture: async () => ({ bundle: { symbol: "MNQ1!", gates: { engine: {} } } }),
      });
      const r = await finalizeOpenReactionDeterministic({ ...BASE, deps });
      assert.equal(r.wrote, true, `pending="${pending}" should re-run`);
      assert.equal(calls.ltfBias.length, 1);
    }
  });

  it("returns capture_failed without writing anything when the capture throws or is empty", async () => {
    for (const cap of [async () => { throw new Error("wedge"); }, async () => ({ bundle: null }), async () => null]) {
      const { deps, calls } = makeDeps({ capture: cap });
      const r = await finalizeOpenReactionDeterministic({ ...BASE, deps });
      assert.equal(r.wrote, false);
      assert.equal(r.reason, "capture_failed");
      assert.equal(calls.leaderDecision.length, 0);
      assert.equal(calls.ltfBias.length, 0);
      assert.equal(calls.openReaction.length, 0);
    }
  });
});
