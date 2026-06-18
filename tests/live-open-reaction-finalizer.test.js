import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { finalizeOpenReactionDeterministic, planLeaderLock } from "../app/main/live-open-reaction-finalizer.js";

// A recording deps stub. Every external effect (capture, file reads, the three
// surface writers, the bias resolver, notify) is injected so the test is pure.
function makeDeps(overrides = {}) {
  const calls = { leaderDecision: [], ltfBias: [], openReaction: [], capture: 0, notify: [] };
  // SMT-divergence evidence (clear): MES is the laggard, done.
  const divergedEvidence = {
    method: "smt", smt_leader: "MES1!", bias_dir: "short", divergence: true,
    gap: 1.12, done: true, reason: "smt_divergence",
    criteria: { data_present: true, pivots_confirmed: true, gap_cleared: true },
  };
  const deps = {
    readExistingLeader: async () => null,
    readPersistedBias: async () => null,
    readBrief: async () => ({ primary_draw: { dir: "below" }, htf_bias_dir: "bearish" }),
    capture: async () => {
      calls.capture += 1;
      return {
        bundle: {
          pair: {
            primary: "MNQ1!", secondary: "MES1!",
            leader_evidence: divergedEvidence,
            symbols: {
              "MNQ1!": { symbol: "MNQ1!", gates: { engine: {} } },
              "MES1!": { symbol: "MES1!", gates: { engine: {} } },
            },
          },
        },
      };
    },
    deriveBias: async () => ({
      bias: "bearish", htf_ltf_alignment: "aligned", is_retrace_day: false,
      entry_model_priority: "trend", grade_cap: "A+", source: "deterministic-resolver",
      cite: "gates.engine.pillar1.sweeps[0]", interaction: "break_rejection",
    }),
    writeLeaderDecision: async (p) => { calls.leaderDecision.push(p); },
    writeLtfBias: async (p) => { calls.ltfBias.push(p); },
    writeOpenReaction: async (p) => { calls.openReaction.push(p); },
    notify: async (n) => { calls.notify.push(n); },
    ...overrides,
  };
  return { deps, calls };
}

const ETS = "2026-06-18T13:50:00.000Z";

// Build leader_evidence variants for the capture stub.
function captureWith(evidence, single = false) {
  return async () => single
    ? { bundle: { symbol: "MNQ1!", gates: { engine: {} } } }
    : {
        bundle: {
          pair: {
            primary: "MNQ1!", secondary: "MES1!", leader_evidence: evidence,
            symbols: { "MNQ1!": { symbol: "MNQ1!", gates: { engine: {} } }, "MES1!": { symbol: "MES1!", gates: { engine: {} } } },
          },
        },
      };
}

describe("planLeaderLock (pure timing policy)", () => {
  const diverged = { done: true, smt_leader: "MES1!", reason: "smt_divergence", criteria: { data_present: true, pivots_confirmed: true, gap_cleared: true } };
  const nearTie = { done: false, reason: "no_divergence_measured", criteria: { data_present: true, pivots_confirmed: true, gap_cleared: false } };
  const unreadable = { done: false, reason: "smt_unreadable_data", criteria: { data_present: false, pivots_confirmed: false, gap_cleared: false } };

  it("pre-window (<15m): wait, never lock", () => {
    assert.deepEqual(planLeaderLock({ minutesIntoPhase: 12, evidence: diverged }), { action: "wait", reason: "pre_window" });
  });
  it("clear divergence at 16m: lock the laggard early", () => {
    const r = planLeaderLock({ minutesIntoPhase: 16, evidence: diverged });
    assert.equal(r.action, "lock"); assert.equal(r.leader, "MES1!");
  });
  it("near-tie still resolving at 20m: wait", () => {
    assert.equal(planLeaderLock({ minutesIntoPhase: 20, evidence: nearTie }).action, "wait");
  });
  it("near-tie at 30m hard stop: lock MNQ", () => {
    const r = planLeaderLock({ minutesIntoPhase: 30, evidence: nearTie });
    assert.equal(r.action, "lock"); assert.equal(r.leader, "MNQ1!"); assert.equal(r.reason, "no_divergence_measured");
  });
  it("unreadable at 30m hard stop: stand aside, no leader", () => {
    const r = planLeaderLock({ minutesIntoPhase: 30, evidence: unreadable });
    assert.equal(r.action, "standaside"); assert.equal(r.reason, "smt_unreadable_data");
  });
  it("existing leader: never re-lock", () => {
    assert.equal(planLeaderLock({ existingLeader: "MNQ1!", minutesIntoPhase: 30, evidence: diverged }).action, "none");
  });
});

describe("finalizeOpenReactionDeterministic", () => {
  it("locks the SMT laggard early on a clear divergence (≥15m)", async () => {
    const { deps, calls } = makeDeps();
    const r = await finalizeOpenReactionDeterministic({ session: "ny-am", eventTs: ETS, minutesIntoPhase: 16, deps });
    assert.equal(r.wrote, true);
    assert.equal(r.leader, "MES1!");
    assert.equal(r.locked, true);
    assert.equal(calls.leaderDecision.length, 1);
    assert.equal(calls.leaderDecision[0].leader, "MES1!");
    assert.equal(calls.leaderDecision[0].method, "smt");
    assert.equal(calls.leaderDecision[0].standaside, false);
    assert.equal(calls.ltfBias.length, 1);
  });

  it("pre-window (<15m): writes provisional bias but does NOT lock the leader", async () => {
    const { deps, calls } = makeDeps();
    const r = await finalizeOpenReactionDeterministic({ session: "ny-am", eventTs: ETS, minutesIntoPhase: 12, deps });
    assert.equal(r.wrote, true);
    assert.equal(r.locked, false);
    assert.equal(calls.leaderDecision.length, 0);   // not locked
    assert.equal(calls.ltfBias.length, 1);          // bias still provisional
  });

  it("near-tie at the 30m hard stop locks MNQ", async () => {
    const nearTie = { method: "smt", smt_leader: null, done: false, reason: "no_divergence_measured", criteria: { data_present: true, pivots_confirmed: true, gap_cleared: false } };
    const { deps, calls } = makeDeps({ capture: captureWith(nearTie) });
    const r = await finalizeOpenReactionDeterministic({ session: "ny-am", eventTs: ETS, minutesIntoPhase: 30, deps });
    assert.equal(r.leader, "MNQ1!");
    assert.equal(calls.leaderDecision[0].leader, "MNQ1!");
    assert.equal(calls.leaderDecision[0].reason, "no_divergence_measured");
  });

  it("unreadable data at the 30m hard stop stands aside + notifies, never MNQ", async () => {
    const unreadable = { method: "smt", smt_leader: null, done: false, reason: "smt_unreadable_data", criteria: { data_present: false, pivots_confirmed: false, gap_cleared: false } };
    const { deps, calls } = makeDeps({ capture: captureWith(unreadable) });
    const r = await finalizeOpenReactionDeterministic({ session: "ny-am", eventTs: ETS, minutesIntoPhase: 30, deps });
    assert.equal(r.standaside, true);
    assert.equal(r.leader, null);
    assert.equal(calls.leaderDecision[0].standaside, true);
    assert.equal(calls.leaderDecision[0].leader, null);
    assert.equal(calls.notify.length, 1);
    assert.equal(calls.ltfBias[0].ltf_bias, "stand_aside");
    assert.equal(calls.ltfBias[0].grade_cap, "no-trade");
  });

  it("resolving (15–30m, not done) writes provisional bias, no lock", async () => {
    const resolving = { method: "smt", smt_leader: null, done: false, reason: "no_divergence_measured", criteria: { data_present: true, pivots_confirmed: true, gap_cleared: false } };
    const { deps, calls } = makeDeps({ capture: captureWith(resolving) });
    const r = await finalizeOpenReactionDeterministic({ session: "ny-am", eventTs: ETS, minutesIntoPhase: 20, deps });
    assert.equal(r.locked, false);
    assert.equal(calls.leaderDecision.length, 0);
    assert.equal(calls.ltfBias.length, 1);
  });

  it("does NOT re-lock when a pair-decision already exists", async () => {
    const { deps, calls } = makeDeps({
      readExistingLeader: async () => "MNQ1!",
      capture: captureWith(null, true),
    });
    const r = await finalizeOpenReactionDeterministic({ session: "ny-am", eventTs: ETS, minutesIntoPhase: 30, deps });
    assert.equal(r.wrote, true);
    assert.equal(r.leader, "MNQ1!");
    assert.equal(calls.leaderDecision.length, 0);
    assert.equal(calls.ltfBias.length, 1);
  });

  it("is idempotent — skips when a leader AND a final bias already exist", async () => {
    const { deps, calls } = makeDeps({ readExistingLeader: async () => "MNQ1!", readPersistedBias: async () => "bearish" });
    const r = await finalizeOpenReactionDeterministic({ session: "ny-am", eventTs: ETS, minutesIntoPhase: 30, deps });
    assert.equal(r.wrote, false);
    assert.equal(r.reason, "already_final");
    assert.equal(calls.capture, 0);
  });

  it("returns capture_failed without writing anything when capture is empty", async () => {
    for (const cap of [async () => { throw new Error("wedge"); }, async () => ({ bundle: null }), async () => null]) {
      const { deps, calls } = makeDeps({ capture: cap });
      const r = await finalizeOpenReactionDeterministic({ session: "ny-am", eventTs: ETS, minutesIntoPhase: 16, deps });
      assert.equal(r.wrote, false);
      assert.equal(r.reason, "capture_failed");
      assert.equal(calls.leaderDecision.length, 0);
      assert.equal(calls.ltfBias.length, 0);
    }
  });
});
