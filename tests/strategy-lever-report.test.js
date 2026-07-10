// tests/strategy-lever-report.test.js
// Pure unit coverage for scripts/evaluate-strategy-lever.mjs (Task E2): the
// report SHAPE, the fail-closed fidelity-gate rules (incl. the three proven
// fail-opens from PR #237 adversarial review), and determinism. These tests feed
// synthetic foldSymbol-shaped results — no corpus, no engine, no TradingView,
// and no writes to state/ (buildLeverReport is pure).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLeverReport,
  computeFidelityGate,
  movedSessions,
  sessionPackets,
  overallStatus,
  effectiveLeverSet,
  isValidLeverId,
  hasRecordedDecisions,
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
// A healthy, matched (not-moved) day so a symbol folds ≥1 session without a move.
const quietDay = (date, r = 0) => ({ date, session: "ny-am", r, setups: [] });

// Baseline: 03-02 am no-trade (0R). Treatment: 03-02 am fires an A+ MSS long +2R.
function noTradeToTradeFolds() {
  const baseline = fold({ total: 0, days: [quietDay("2026-03-02", 0)] });
  const treatment = fold({ total: 2, days: [{ date: "2026-03-02", session: "ny-am", r: 2, setups: mssLong(2) }] });
  return { baseline, treatment };
}
// A healthy symbol that never moves (same quiet day in both folds).
function unchangedFolds(total = 0) {
  const d = [quietDay("2026-03-02", total)];
  return { baseline: fold({ total, days: d }), treatment: fold({ total, days: d }) };
}

const baseReportArgs = (overrides = {}) => ({
  leverId: "e3a-5m-gap-preference",
  envFlags: { GOFNQ_5M_GAP_PREF: "1" },
  baselineManifestId: "gate-corpus-2026-h1-v1",
  baselineSha: "abc123",
  treatmentSha: "abc123",
  corpusCertified: true,
  oracleTapesIntact: true,
  oracleTapesRun: 3,
  transcriptContradiction: false,
  now: "2026-07-10T00:00:00.000Z",
  folds: {
    "MNQ1!": noTradeToTradeFolds(),
    "MES1!": unchangedFolds(1),
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
  assert.equal(r.treatment.code_sha, "abc123");
  assert.equal(r.corpus_certified, true);
  assert.deepEqual(r.required_symbols, ["MNQ1!", "MES1!"]);
  assert.ok("ambient_levers" in r.warnings);

  const mnq = r.symbols["MNQ1!"];
  assert.equal(mnq.baseline_total_r, 0);
  assert.equal(mnq.treatment_total_r, 2);
  assert.equal(mnq.delta, 2);
  assert.equal(mnq.fold_non_negative, true);
  assert.equal(mnq.sessions_folded, 1);
  assert.equal(mnq.healthy, true);
  assert.equal(mnq.fold_error, null);
  assert.equal(mnq.moved_sessions.length, 1);

  const moved = mnq.moved_sessions[0];
  for (const k of ["date", "session", "baseline_r", "treatment_r", "delta", "flip", "baseline_packets", "treatment_packets", "decision"]) {
    assert.ok(k in moved, `moved session missing ${k}`);
  }
  assert.equal(moved.flip, "no_trade_to_trade");
  assert.equal(moved.decision, "needs_review");
  const p = moved.treatment_packets[0];
  assert.deepEqual(
    { model: p.model, side: p.side, entry: p.entry, stop: p.stop, tp1: p.tp1, tp2: p.tp2, grade: p.grade },
    { model: "mss", side: "long", entry: 21000, stop: 20990, tp1: 21050, tp2: 21100, grade: "A+" },
  );

  assert.equal(r.moved_session_count, 1);
  for (const k of ["fold_non_negative_by_symbol", "fold_non_negative_both_symbols", "oracle_tapes_intact", "oracle_tapes_run", "transcript_contradiction", "auto_enable_eligible", "blockers"]) {
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
  assert.deepEqual(r.fidelity_gate.blockers, []);
});

test("auto_enable_eligible true with ZERO moved sessions (prong c vacuous) when folds are healthy", () => {
  const r = buildLeverReport(baseReportArgs({
    transcriptContradiction: null,
    folds: { "MNQ1!": unchangedFolds(3), "MES1!": unchangedFolds(1) },
  }));
  assert.equal(r.moved_session_count, 0);
  assert.equal(r.fidelity_gate.auto_enable_eligible, true);
});

// ── fail-open #1 (adversarial review): crashed / zero-session fold ────────────
test("FAIL-CLOSED #1a: a crashed fold (_fold_error) is ineligible even with 0 moved sessions", () => {
  const crashed = { total_r: 0, per_day: [], run_details: [], code_sha: null, _fold_error: "chart wedged" };
  const r = buildLeverReport(baseReportArgs({
    transcriptContradiction: false,
    folds: {
      "MNQ1!": { baseline: crashed, treatment: crashed },
      "MES1!": { baseline: crashed, treatment: crashed },
    },
  }));
  assert.equal(r.symbols["MNQ1!"].healthy, false);
  assert.equal(r.symbols["MNQ1!"].fold_error, "chart wedged");
  assert.equal(r.moved_session_count, 0);
  assert.equal(r.fidelity_gate.fold_non_negative_both_symbols, false);
  assert.equal(r.fidelity_gate.auto_enable_eligible, false); // was true before the fix
});

test("FAIL-CLOSED #1b: a zero-session fold (no error, empty per_day) is ineligible", () => {
  const empty = fold({ total: 0, days: [] });
  const r = buildLeverReport(baseReportArgs({
    folds: {
      "MNQ1!": { baseline: empty, treatment: empty },
      "MES1!": unchangedFolds(1),
    },
  }));
  assert.equal(r.symbols["MNQ1!"].sessions_folded, 0);
  assert.equal(r.symbols["MNQ1!"].healthy, false);
  assert.equal(r.fidelity_gate.auto_enable_eligible, false);
});

// ── fail-open #2 (adversarial review): "both symbols" must require both ───────
test("FAIL-CLOSED #2: a single-symbol folds map cannot pass fold_non_negative_both", () => {
  const r = buildLeverReport(baseReportArgs({
    folds: { "MNQ1!": unchangedFolds(5) }, // MES1! absent
  }));
  assert.equal(r.fidelity_gate.fold_non_negative_both_symbols, false);
  assert.equal(r.fidelity_gate.auto_enable_eligible, false);
  assert.ok(r.fidelity_gate.blockers.some((b) => /missing required symbol/.test(b)));
});

// ── fail-open #3 (adversarial review): empty verified-tape set ≠ intact ───────
test("FAIL-CLOSED #3: zero verified tapes run is not oracle-intact", () => {
  const r = buildLeverReport(baseReportArgs({ oracleTapesIntact: true, oracleTapesRun: 0 }));
  assert.equal(r.fidelity_gate.oracle_tapes_run, 0);
  assert.equal(r.fidelity_gate.oracle_tapes_intact, false); // every([]) === true would have lied
  assert.equal(r.fidelity_gate.auto_enable_eligible, false);
});

// ── other fail-closed preconditions ──────────────────────────────────────────
test("FAIL-CLOSED: uncertified corpus forces auto_enable_eligible false", () => {
  const r = buildLeverReport(baseReportArgs({ corpusCertified: false }));
  assert.equal(r.corpus_certified, false);
  assert.equal(r.fidelity_gate.auto_enable_eligible, false);
});

test("FAIL-CLOSED: negative fold on ONE symbol forces auto_enable_eligible false", () => {
  const r = buildLeverReport(baseReportArgs({
    folds: {
      "MNQ1!": unchangedFolds(5),
      "MES1!": { baseline: fold({ total: 1, days: [quietDay("2026-03-02", 1)] }), treatment: fold({ total: -0.5, days: [{ date: "2026-03-02", session: "ny-am", r: -0.5, setups: mssLong(-0.5) }] }) },
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
  const r = buildLeverReport(baseReportArgs({ oracleTapesIntact: false, oracleTapesRun: 3 }));
  assert.equal(r.fidelity_gate.oracle_tapes_intact, false);
  assert.equal(r.fidelity_gate.auto_enable_eligible, false);
});

// ── status rollup (human review, separate from the mechanical gate) ──────────
test("FAIL-CLOSED: any moved session without approval keeps status needs_review", () => {
  const r = buildLeverReport(baseReportArgs());
  assert.equal(r.moved_session_count, 1);
  assert.equal(r.status, "needs_review");
});

test("status becomes approved only when every moved session is approved", () => {
  assert.equal(overallStatus({ "MNQ1!": [{ decision: "approved" }, { decision: "approved" }] }), "approved");
  assert.equal(overallStatus({ "MNQ1!": [{ decision: "approved" }, { decision: "needs_review" }] }), "needs_review");
  assert.equal(overallStatus({ "MNQ1!": [{ decision: "rejected" }] }), "rejected");
  assert.equal(overallStatus({ "MNQ1!": [], "MES1!": [] }), "approved");
});

// ── lever-id sanitization + overwrite protection ─────────────────────────────
test("isValidLeverId accepts safe ids and rejects path/shell-unsafe ones", () => {
  for (const ok of ["e3a-5m-gap-preference", "lever.1", "GOFNQ_x", "a_b-c.d"]) assert.equal(isValidLeverId(ok), true, ok);
  for (const bad of ["../escape", "a/b", "a b", "a;rm", "a$(x)", "", null, 42]) assert.equal(isValidLeverId(bad), false, String(bad));
});

test("buildLeverReport rejects an unsafe leverId", () => {
  assert.throws(() => buildLeverReport(baseReportArgs({ leverId: "../pwn" })), /invalid leverId/);
  assert.throws(() => buildLeverReport(baseReportArgs({ leverId: "" })), /leverId is required/);
});

test("hasRecordedDecisions detects hand-recorded (non-default) decisions", () => {
  const clean = buildLeverReport(baseReportArgs());
  assert.equal(hasRecordedDecisions(clean), false); // all needs_review
  const approved = structuredClone(clean);
  approved.symbols["MNQ1!"].moved_sessions[0].decision = "approved";
  assert.equal(hasRecordedDecisions(approved), true);
  assert.equal(hasRecordedDecisions(null), false);
});

// ── determinism (strengthened: shuffle input orderings) ──────────────────────
test("determinism: same inputs -> byte-identical report", () => {
  assert.equal(JSON.stringify(buildLeverReport(baseReportArgs())), JSON.stringify(buildLeverReport(baseReportArgs())));
});

test("determinism: reports differ ONLY by created_at when only the timestamp changes", () => {
  const a = buildLeverReport(baseReportArgs({ now: "2026-07-10T00:00:00.000Z" }));
  const b = buildLeverReport(baseReportArgs({ now: "2026-07-11T09:09:09.000Z" }));
  assert.notEqual(a.created_at, b.created_at);
  const { created_at: _a, ...restA } = a;
  const { created_at: _b, ...restB } = b;
  assert.deepEqual(restA, restB);
});

test("determinism: shuffled input orderings produce identical output", () => {
  // Two moved MNQ days (order matters) + one quiet MES day.
  const trendShort = (r) => [openRow({ id: "s2", model: "trend", side: "short", entry: 100, stop: 105, tp1: 92, grade: "B", event_ts: "2026-03-03T14:31:00Z" }), outcomeRow("s2", r)];
  const mnqBaseline = fold({ total: 1, days: [quietDay("2026-03-02", 0), { date: "2026-03-03", session: "ny-am", r: 1, setups: trendShort(1) }] });
  const mnqTreatment = fold({ total: 3, days: [{ date: "2026-03-02", session: "ny-am", r: 2, setups: mssLong(2) }, { date: "2026-03-03", session: "ny-am", r: 1, setups: trendShort(1) }] });
  const ordered = baseReportArgs({
    folds: { "MNQ1!": { baseline: mnqBaseline, treatment: mnqTreatment }, "MES1!": unchangedFolds(1) },
  });

  // Deep-clone and reverse: folds-map order, per_day order, run_details order, setups order.
  const rev = (f) => ({
    ...f,
    per_day: [...f.per_day].reverse(),
    run_details: [...f.run_details].reverse().map((rd) => ({ ...rd, setups: [...rd.setups].reverse() })),
  });
  const shuffled = {
    ...ordered,
    folds: Object.fromEntries(Object.entries(ordered.folds).reverse().map(([sym, pair]) => [sym, { baseline: rev(pair.baseline), treatment: rev(pair.treatment) }])),
  };

  assert.deepEqual(buildLeverReport(shuffled), buildLeverReport(ordered));
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

test("computeFidelityGate: fold_non_negative_both requires BOTH required symbols true", () => {
  const g = computeFidelityGate({
    corpusCertified: true,
    requiredSymbols: ["MNQ1!", "MES1!"],
    presentSymbols: ["MNQ1!", "MES1!"],
    foldNonNegativeBySymbol: { "MNQ1!": true, "MES1!": false },
    allSymbolsHealthy: true,
    oracleTapesIntact: true,
    oracleTapesRun: 3,
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
