// tests/strategy-lever-report.test.js
// Pure unit coverage for scripts/evaluate-strategy-lever.mjs (Task E2): the
// report SHAPE, the fail-closed fidelity-gate rules, and determinism. These
// tests feed synthetic foldSymbol-shaped results — no corpus, no engine, no
// TradingView, and no writes to state/ (buildLeverReport is pure).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLeverReport,
  computeFidelityGate,
  movedSessions,
  sessionPackets,
  overallStatus,
  effectiveLeverSet,
} from "../scripts/evaluate-strategy-lever.mjs";

// ── fold-shaped fixture builders ─────────────────────────────────────────────
function openRow(o) {
  return {
    type: "open", id: o.id, entry: o.entry, stop: o.stop, tp1: o.tp1, tp2: o.tp2 ?? null,
    grade: o.grade, model: o.model, side: o.side, event_ts: o.event_ts ?? "2026-03-02T14:31:00Z",
  };
}
function outcomeRow(id, r) {
  return { type: "outcome", setup_id: id, outcome: r >= 0 ? "tp1_hit" : "stop_hit", realized_r: r };
}
// A foldSymbol() result: total_r + per_day + run_details.
function fold({ total = 0, days = [] }) {
  return {
    total_r: total,
    per_day: days.map((d) => ({ run_id: `${d.date}-${d.session}`, date: d.date, session: d.session, r: d.r })),
    run_details: days.map((d) => ({ entry: { date: d.date, session: d.session, open_reaction: null }, setups: d.setups ?? [] })),
    code_sha: "abc123",
  };
}

const mssLong = (r) => [openRow({ id: "s1", model: "mss", side: "long", entry: 21000, stop: 20990, tp1: 21050, tp2: 21100, grade: "A+" }), outcomeRow("s1", r)];

// Baseline: 03-02 am no-trade (0R). Treatment: 03-02 am fires an A+ MSS long +2R.
function noTradeToTradeFolds() {
  const baseline = fold({ total: 0, days: [{ date: "2026-03-02", session: "ny-am", r: 0, setups: [] }] });
  const treatment = fold({ total: 2, days: [{ date: "2026-03-02", session: "ny-am", r: 2, setups: mssLong(2) }] });
  return { baseline, treatment };
}

const baseReportArgs = (overrides = {}) => ({
  leverId: "e3a-5m-gap-preference",
  envFlags: { GOFNQ_5M_GAP_PREF: "1" },
  baselineManifestId: "gate-corpus-2026-h1-v1",
  baselineSha: "abc123",
  treatmentSha: "abc123",
  corpusCertified: true,
  oracleTapesIntact: true,
  transcriptContradiction: false,
  now: "2026-07-10T00:00:00.000Z",
  folds: {
    "MNQ1!": noTradeToTradeFolds(),
    "MES1!": { baseline: fold({ total: 1 }), treatment: fold({ total: 1 }) },
  },
  ...overrides,
});

// ── shape ────────────────────────────────────────────────────────────────────
test("report carries the full required shape", () => {
  const r = buildLeverReport(baseReportArgs());
  assert.equal(r.id, "e3a-5m-gap-preference");
  assert.equal(r.kind, "strategy-lever-evaluation");
  assert.equal(r.created_at, "2026-07-10T00:00:00.000Z");
  assert.deepEqual(r.lever.env_flags, { GOFNQ_5M_GAP_PREF: "1" });
  assert.equal(r.baseline.manifest_id, "gate-corpus-2026-h1-v1");
  assert.equal(r.baseline.code_sha, "abc123");
  assert.equal(r.treatment.code_sha, "abc123");
  assert.equal(r.corpus_certified, true);

  const mnq = r.symbols["MNQ1!"];
  assert.equal(mnq.baseline_total_r, 0);
  assert.equal(mnq.treatment_total_r, 2);
  assert.equal(mnq.delta, 2);
  assert.equal(mnq.fold_non_negative, true);
  assert.equal(mnq.moved_sessions.length, 1);

  const moved = mnq.moved_sessions[0];
  for (const k of ["date", "session", "baseline_r", "treatment_r", "delta", "flip", "baseline_packets", "treatment_packets", "decision"]) {
    assert.ok(k in moved, `moved session missing ${k}`);
  }
  assert.equal(moved.flip, "no_trade_to_trade");
  assert.equal(moved.decision, "needs_review");
  // packet detail: model/side/entry/stop/target/grade present on the treatment packet.
  const p = moved.treatment_packets[0];
  assert.deepEqual(
    { model: p.model, side: p.side, entry: p.entry, stop: p.stop, tp1: p.tp1, tp2: p.tp2, grade: p.grade },
    { model: "mss", side: "long", entry: 21000, stop: 20990, tp1: 21050, tp2: 21100, grade: "A+" },
  );

  assert.equal(r.moved_session_count, 1);
  for (const k of ["fold_non_negative_both_symbols", "oracle_tapes_intact", "transcript_contradiction", "auto_enable_eligible"]) {
    assert.ok(k in r.fidelity_gate, `fidelity_gate missing ${k}`);
  }
});

// ── the strict fidelity gate: happy paths ────────────────────────────────────
test("auto_enable_eligible true when all three prongs hold (moved sessions cleared)", () => {
  const r = buildLeverReport(baseReportArgs());
  assert.equal(r.fidelity_gate.fold_non_negative_both_symbols, true);
  assert.equal(r.fidelity_gate.oracle_tapes_intact, true);
  assert.equal(r.fidelity_gate.transcript_contradiction, false);
  assert.equal(r.fidelity_gate.auto_enable_eligible, true);
});

test("auto_enable_eligible true with ZERO moved sessions (prong c vacuous) even if unreviewed", () => {
  const r = buildLeverReport(baseReportArgs({
    transcriptContradiction: null,
    folds: {
      "MNQ1!": { baseline: fold({ total: 3 }), treatment: fold({ total: 3 }) },
      "MES1!": { baseline: fold({ total: 1 }), treatment: fold({ total: 1 }) },
    },
  }));
  assert.equal(r.moved_session_count, 0);
  assert.equal(r.fidelity_gate.auto_enable_eligible, true);
});

// ── fail-closed rule 1: uncertified corpus ───────────────────────────────────
test("FAIL-CLOSED: uncertified corpus forces auto_enable_eligible false", () => {
  const r = buildLeverReport(baseReportArgs({ corpusCertified: false }));
  assert.equal(r.corpus_certified, false);
  assert.equal(r.fidelity_gate.auto_enable_eligible, false);
});

// ── fail-closed rule 2: negative fold on either symbol ───────────────────────
test("FAIL-CLOSED: negative fold on ONE symbol forces auto_enable_eligible false", () => {
  const r = buildLeverReport(baseReportArgs({
    folds: {
      "MNQ1!": { baseline: fold({ total: 5 }), treatment: fold({ total: 5 }) },
      "MES1!": { baseline: fold({ total: 1 }), treatment: fold({ total: -0.5 }) },
    },
  }));
  assert.equal(r.symbols["MES1!"].fold_non_negative, false);
  assert.equal(r.fidelity_gate.fold_non_negative_both_symbols, false);
  assert.equal(r.fidelity_gate.auto_enable_eligible, false);
});

test("FAIL-CLOSED: unreviewed transcript (null) with moved sessions blocks eligibility", () => {
  const r = buildLeverReport(baseReportArgs({ transcriptContradiction: null }));
  assert.equal(r.moved_session_count > 0, true);
  assert.equal(r.fidelity_gate.transcript_contradiction, null);
  assert.equal(r.fidelity_gate.auto_enable_eligible, false);
});

test("FAIL-CLOSED: a flagged transcript contradiction blocks eligibility", () => {
  const r = buildLeverReport(baseReportArgs({ transcriptContradiction: true }));
  assert.equal(r.fidelity_gate.auto_enable_eligible, false);
});

test("FAIL-CLOSED: broken oracle tapes block eligibility", () => {
  const r = buildLeverReport(baseReportArgs({ oracleTapesIntact: false }));
  assert.equal(r.fidelity_gate.oracle_tapes_intact, false);
  assert.equal(r.fidelity_gate.auto_enable_eligible, false);
});

// ── fail-closed rule 3: unapproved moved session keeps status needs_review ────
test("FAIL-CLOSED: any moved session without approval keeps status needs_review", () => {
  const r = buildLeverReport(baseReportArgs());
  assert.equal(r.moved_session_count, 1);
  assert.equal(r.status, "needs_review");
});

test("status becomes approved only when every moved session is approved", () => {
  const approved = { "MNQ1!": [{ decision: "approved" }, { decision: "approved" }] };
  assert.equal(overallStatus(approved), "approved");
  const mixed = { "MNQ1!": [{ decision: "approved" }, { decision: "needs_review" }] };
  assert.equal(overallStatus(mixed), "needs_review");
  const rejected = { "MNQ1!": [{ decision: "rejected" }] };
  assert.equal(overallStatus(rejected), "rejected");
  assert.equal(overallStatus({ "MNQ1!": [], "MES1!": [] }), "approved");
});

// ── determinism ──────────────────────────────────────────────────────────────
test("determinism: same inputs -> byte-identical report", () => {
  const a = buildLeverReport(baseReportArgs());
  const b = buildLeverReport(baseReportArgs());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("determinism: reports differ only by created_at when only the timestamp changes", () => {
  const a = buildLeverReport(baseReportArgs({ now: "2026-07-10T00:00:00.000Z" }));
  const b = buildLeverReport(baseReportArgs({ now: "2026-07-11T09:09:09.000Z" }));
  assert.notEqual(a.created_at, b.created_at);
  const { created_at: _a, ...restA } = a;
  const { created_at: _b, ...restB } = b;
  assert.deepEqual(restA, restB);
});

// ── pure helpers ─────────────────────────────────────────────────────────────
test("movedSessions catches a pure R shift on identical packets", () => {
  const days = (r) => [{ date: "2026-03-02", session: "ny-am", r, setups: mssLong(r) }];
  const moved = movedSessions(fold({ total: 2, days: days(2) }), fold({ total: 1, days: days(1) }));
  assert.equal(moved.length, 1);
  assert.equal(moved[0].flip, "same"); // packets identical
  assert.equal(moved[0].delta, -1);    // but R moved
});

test("movedSessions ignores a session with no change", () => {
  const d = [{ date: "2026-03-02", session: "ny-am", r: 2, setups: mssLong(2) }];
  assert.equal(movedSessions(fold({ total: 2, days: d }), fold({ total: 2, days: d })).length, 0);
});

test("sessionPackets summarizes open rows and attaches realized_r, ordered by event_ts", () => {
  const setups = [
    openRow({ id: "b", model: "trend", side: "long", entry: 10, stop: 9, tp1: 12, grade: "B", event_ts: "2026-03-02T15:00:00Z" }),
    openRow({ id: "a", model: "mss", side: "short", entry: 20, stop: 21, tp1: 18, grade: "A+", event_ts: "2026-03-02T14:00:00Z" }),
    outcomeRow("a", 1.5),
  ];
  const p = sessionPackets(setups);
  assert.equal(p.length, 2);
  assert.equal(p[0].id, "a"); // earlier event_ts first
  assert.equal(p[0].realized_r, 1.5);
  assert.equal(p[1].realized_r, null);
});

test("computeFidelityGate: fold_non_negative_both requires BOTH symbols true", () => {
  const g = computeFidelityGate({
    corpusCertified: true,
    foldNonNegativeBySymbol: { "MNQ1!": true, "MES1!": false },
    oracleTapesIntact: true,
    transcriptContradiction: false,
    movedSessionCount: 0,
  });
  assert.equal(g.fold_non_negative_both_symbols, false);
  assert.equal(g.auto_enable_eligible, false);
});

test("effectiveLeverSet merges base GOFNQ_/TV_ env with the treatment flags, sorted", () => {
  const set = effectiveLeverSet({ GOFNQ_NEW: "1" }, { GOFNQ_MSS_SPEED_MATCH: "1", PATH: "/x", TV_LLM_PROVIDER: "claude" });
  assert.deepEqual(Object.keys(set), ["GOFNQ_MSS_SPEED_MATCH", "GOFNQ_NEW", "TV_LLM_PROVIDER"]);
  assert.equal(set.GOFNQ_NEW, "1");
  assert.equal("PATH" in set, false);
});
