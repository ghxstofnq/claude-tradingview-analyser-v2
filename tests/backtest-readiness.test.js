import assert from "node:assert/strict";
import test from "node:test";
import { composeReadiness } from "../cli/lib/backtest-verdict.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { collectBacktestReadiness } from "../cli/lib/backtest-readiness.js";
import { readinessScopeDigest, writeApproval, writeTestEvidence } from "../cli/lib/backtest-readiness-state.js";

// The real-money readiness gate — fail-closed, table-driven. Positive R must
// NEVER override a failed/missing mechanical gate. Lock the whole hierarchy.

const GREEN = {
  tests_green: true,
  baseline_current: true,
  corpus_certified: true,
  parity_certified: true,
  strategy_review_state: "approved",
  cum_r: 22.66,
  sessions: 31,
  minSessions: 20,
  user_approved_window: true,
};

function gateById(r, id) {
  return r.gates.find((g) => g.id === id);
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "readiness-"));
}

function cleanRepo() {
  const repo = tmp();
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  fs.writeFileSync(path.join(repo, "tracked.txt"), "one\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["-c", "user.email=a@example.test", "-c", "user.name=A", "commit", "-m", "init"], { cwd: repo, stdio: "ignore" });
  const code_sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  return { repo, code_sha };
}

const SELECTED_MNQ = Object.fromEntries(
  Array.from({ length: 31 }, (_, index) => [`2026-01-${String(index + 1).padStart(2, "0")}|ny-am|MNQ1!`, `mnq-${index + 1}`]),
);
const SELECTED_MES = Object.fromEntries(
  Array.from({ length: 31 }, (_, index) => [`2026-01-${String(index + 1).padStart(2, "0")}|ny-am|MES1!`, `mes-${index + 1}`]),
);

const CERTIFIED = {
  manifest_id: "gate-corpus-2026-h1-v1",
  certified: true,
  selection_digest: "e".repeat(64),
  parity: { certified: true },
  requirements: { from: "2026-01-10", to: "2026-07-03", symbols: ["MNQ1!", "MES1!"] },
  symbols: {
    "MNQ1!": { expected: 31, valid: 31, selected: SELECTED_MNQ },
    "MES1!": { expected: 31, valid: 31, selected: SELECTED_MES },
  },
};

const BASELINE = {
  symbol: "MNQ1!",
  total_r: 22.66,
  corpus: { n_sessions: 31, dates: ["2026-01-12"], run_ids: Object.values(SELECTED_MNQ) },
};

test("collectBacktestReadiness — composes fold, certification, test evidence, clean code, levers, approval", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepo();
  writeTestEvidence({ stateDir, code_sha, command: "npm run test" });
  const levers = { GOFNQ_HTF_INTRADAY_DRAW: "1" };
  writeApproval({
    stateDir,
    record: {
      manifest_id: CERTIFIED.manifest_id,
      selection_digest: CERTIFIED.selection_digest,
      scope_digest: readinessScopeDigest(CERTIFIED.requirements),
      evidence_scope: CERTIFIED.requirements,
      code_sha,
      symbol: "MNQ1!",
      levers,
      strategy_review_state: "approved",
      user_approved_window: true,
      note: "fixture approval",
    },
  });

  const readiness = await collectBacktestReadiness({
    symbol: "MNQ1!",
    stateDir,
    cwd: repo,
    env: levers,
    foldSymbol: async () => ({ ...BASELINE, code_sha }),
    certifyCorpus: () => CERTIFIED,
  });

  assert.equal(readiness.verdict, "NET_POSITIVE_APPROVED");
  assert.equal(readiness.ready, true);
  assert.equal(gateById(readiness, "tests").status, "pass");
  assert.equal(gateById(readiness, "corpus").status, "pass");
  assert.equal(gateById(readiness, "parity").status, "pass");
  assert.equal(gateById(readiness, "strategy_review").status, "pass");
});

test("review regression — canonical performance numeric strings fail closed", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepo();
  const levers = { GOFNQ_HTF_INTRADAY_DRAW: "1" };
  writeTestEvidence({ stateDir, code_sha, command: "npm run test" });
  writeApproval({
    stateDir,
    record: {
      manifest_id: CERTIFIED.manifest_id,
      selection_digest: CERTIFIED.selection_digest,
      scope_digest: readinessScopeDigest(CERTIFIED.requirements),
      evidence_scope: CERTIFIED.requirements,
      code_sha,
      symbol: "MNQ1!",
      levers,
      strategy_review_state: "approved",
      user_approved_window: true,
      note: "fixture approval",
    },
  });
  const readiness = await collectBacktestReadiness({
    symbol: "MNQ1!",
    stateDir,
    cwd: repo,
    env: levers,
    foldSymbol: async () => ({ ...BASELINE, total_r: "999", code_sha }),
    certifyCorpus: () => CERTIFIED,
  });
  assert.equal(readiness.verdict, "BLOCKED");
  assert.equal(readiness.ready, false);
  assert.equal(gateById(readiness, "baseline").status, "fail");
  assert.match(gateById(readiness, "baseline").reason, /performance.*invalid/i);
});

test("collectBacktestReadiness — dirty worktree fails closed even with matching old evidence", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepo();
  writeTestEvidence({ stateDir, code_sha, command: "npm run test" });
  fs.writeFileSync(path.join(repo, "tracked.txt"), "dirty\n");

  const readiness = await collectBacktestReadiness({
    symbol: "MNQ1!",
    stateDir,
    cwd: repo,
    env: {},
    foldSymbol: async () => ({ ...BASELINE, code_sha: code_sha.slice(0, 7) }),
    certifyCorpus: () => CERTIFIED,
  });

  assert.equal(readiness.verdict, "BLOCKED");
  assert.equal(readiness.ready, false);
  assert.equal(gateById(readiness, "tests").status, "fail");
  assert.match(gateById(readiness, "tests").reason, /worktree is dirty/);
  assert.equal(gateById(readiness, "baseline").status, "fail");
  assert.match(gateById(readiness, "baseline").reason, /worktree is dirty/);
});

test("collectBacktestReadiness — cached baseline avoids a refold and fails closed when its code SHA is stale", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepo();
  writeTestEvidence({ stateDir, code_sha, command: "npm run test" });
  let foldCalls = 0;
  const readiness = await collectBacktestReadiness({
    symbol: "MNQ1!",
    stateDir,
    cwd: repo,
    env: {},
    baseline: { ...BASELINE, code_sha: "deadbee" },
    foldSymbol: async () => { foldCalls += 1; return BASELINE; },
    certifyCorpus: () => CERTIFIED,
  });

  assert.equal(foldCalls, 0);
  assert.equal(readiness.verdict, "BLOCKED");
  assert.equal(gateById(readiness, "baseline").status, "fail");
});

test("collectBacktestReadiness — fold errors become parseable blocked readiness, not thrown CLI errors", async () => {
  const stateDir = tmp();
  const { repo } = cleanRepo();
  const readiness = await collectBacktestReadiness({
    symbol: "MNQ1!",
    stateDir,
    cwd: repo,
    env: {},
    foldSymbol: async () => { throw new Error("missing index"); },
    certifyCorpus: () => ({ ...CERTIFIED, certified: false, parity: { certified: false, evidence: "missing" }, blockers: [] }),
  });

  assert.equal(readiness.verdict, "BLOCKED");
  assert.equal(readiness.ready, false);
  assert.equal(readiness.baseline_error, "missing index");
});

test("collectBacktestReadiness — corpus and parity are independent gates with symbol-specific corpus reasons", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepo();
  writeTestEvidence({ stateDir, code_sha, command: "npm run test" });
  const readiness = await collectBacktestReadiness({
    symbol: "MES1!",
    stateDir,
    cwd: repo,
    env: {},
    foldSymbol: async () => ({ ...BASELINE, symbol: "MES1!", code_sha: code_sha.slice(0, 7) }),
    certifyCorpus: () => ({
      ...CERTIFIED,
      certified: false,
      symbols: {
        "MNQ1!": { expected: 239, valid: 233, selected: SELECTED_MNQ },
        "MES1!": { expected: 239, valid: 235, selected: SELECTED_MES },
      },
      blockers: [
        { code: "missing_coverage", symbol: "MNQ1!", message: "MNQ missing 6" },
        { code: "missing_coverage", symbol: "MES1!", message: "MES missing 4" },
        { code: "parity_not_certified", message: "parity missing" },
      ],
      parity: { certified: false, evidence: "parity missing" },
    }),
  });

  assert.equal(gateById(readiness, "corpus").status, "fail");
  assert.equal(gateById(readiness, "corpus").reason, "MES missing 4");
  assert.equal(gateById(readiness, "parity").status, "fail");
  assert.deepEqual(gateById(readiness, "corpus").evidence.blockers.map((b) => b.code), ["missing_coverage"]);
});

test("collectBacktestReadiness — complete coverage passes corpus while absent parity fails only parity", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepo();
  writeTestEvidence({ stateDir, code_sha, command: "npm run test" });
  const readiness = await collectBacktestReadiness({
    symbol: "MNQ1!",
    stateDir,
    cwd: repo,
    env: {},
    foldSymbol: async () => ({ ...BASELINE, code_sha: code_sha.slice(0, 7) }),
    certifyCorpus: () => ({
      ...CERTIFIED,
      certified: false,
      symbols: {
        "MNQ1!": { expected: 239, valid: 239, selected: SELECTED_MNQ },
        "MES1!": { expected: 239, valid: 239, selected: SELECTED_MES },
      },
      blockers: [{ code: "parity_not_certified", message: "parity missing" }],
      parity: { certified: false, evidence: "parity missing" },
    }),
  });

  assert.equal(gateById(readiness, "corpus").status, "pass");
  assert.equal(gateById(readiness, "parity").status, "fail");
});

test("collectBacktestReadiness — another symbol's coverage gap does not block the selected symbol", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepo();
  writeTestEvidence({ stateDir, code_sha, command: "npm run test" });
  const readiness = await collectBacktestReadiness({
    symbol: "MES1!",
    stateDir,
    cwd: repo,
    env: {},
    foldSymbol: async () => ({
      ...BASELINE,
      symbol: "MES1!",
      code_sha,
      corpus: { ...BASELINE.corpus, run_ids: Object.values(SELECTED_MES) },
    }),
    certifyCorpus: () => ({
      ...CERTIFIED,
      certified: false,
      symbols: {
        "MNQ1!": { expected: 32, valid: 31, selected: SELECTED_MNQ },
        "MES1!": { expected: 31, valid: 31, selected: SELECTED_MES },
      },
      blockers: [{ code: "missing_coverage", symbol: "MNQ1!", message: "MNQ missing 1" }],
    }),
  });

  assert.equal(gateById(readiness, "corpus").status, "pass");
});

test("composeReadiness — all green + approved is the only green-light", () => {
  const r = composeReadiness(GREEN);
  assert.equal(r.verdict, "NET_POSITIVE_APPROVED");
  assert.equal(r.ready, true);
});

test("composeReadiness — gates are an ordered array of {id,status,evidence,reason}", () => {
  const r = composeReadiness(GREEN);
  assert.ok(Array.isArray(r.gates));
  assert.ok(r.gates.length >= 6);
  for (const g of r.gates) {
    assert.equal(typeof g.id, "string");
    assert.ok(["pass", "fail", "pending"].includes(g.status), `bad status ${g.status}`);
    assert.ok("evidence" in g);
    assert.equal(typeof g.reason, "string");
  }
  // Deterministic order: two calls give the same id sequence.
  const ids = r.gates.map((g) => g.id);
  assert.deepEqual(composeReadiness(GREEN).gates.map((g) => g.id), ids);
});

// Tier 1 — any failed/missing mechanical gate => BLOCKED.
for (const [label, patch, failId] of [
  ["tests not green", { tests_green: false }, "tests"],
  ["tests missing", { tests_green: undefined }, "tests"],
  ["baseline stale", { baseline_current: false }, "baseline"],
  ["corpus not certified", { corpus_certified: false }, "corpus"],
  ["corpus missing", { corpus_certified: undefined }, "corpus"],
  ["parity not certified", { parity_certified: false }, "parity"],
  ["parity missing", { parity_certified: undefined }, "parity"],
  ["below session floor", { sessions: 5 }, "sessions"],
  ["sessions missing", { sessions: undefined }, "sessions"],
]) {
  test(`composeReadiness — mechanical gate BLOCKED: ${label}`, () => {
    const r = composeReadiness({ ...GREEN, ...patch });
    assert.equal(r.verdict, "BLOCKED");
    assert.equal(r.ready, false);
    assert.equal(gateById(r, failId).status, "fail");
  });
}

// Tier 2 — explicit strategy rejection => BLOCKED.
test("composeReadiness — strategy rejection => BLOCKED", () => {
  const r = composeReadiness({ ...GREEN, strategy_review_state: "rejected" });
  assert.equal(r.verdict, "BLOCKED");
  assert.equal(r.ready, false);
  assert.equal(gateById(r, "strategy_review").status, "fail");
});

// Positive R must never override a failed mechanical gate.
test("composeReadiness — positive R does NOT override a failed gate", () => {
  const r = composeReadiness({ ...GREEN, tests_green: false, cum_r: 999 });
  assert.equal(r.verdict, "BLOCKED");
  assert.equal(r.ready, false);
});

// Tier 3 — mechanical green but non-positive R => NOT_READY.
for (const [label, cum_r] of [["zero R", 0], ["negative R", -4.2]]) {
  test(`composeReadiness — mechanical green, ${label} => NOT_READY`, () => {
    const r = composeReadiness({ ...GREEN, cum_r });
    assert.equal(r.verdict, "NOT_READY");
    assert.equal(r.ready, false);
    assert.equal(gateById(r, "net_positive").status, "fail");
  });
}

// Tier 4 — mechanical green + positive R but review/approval pending => REVIEW_REQUIRED.
test("composeReadiness — strategy review pending => REVIEW_REQUIRED", () => {
  const r = composeReadiness({ ...GREEN, strategy_review_state: "pending" });
  assert.equal(r.verdict, "REVIEW_REQUIRED");
  assert.equal(r.ready, false);
  assert.equal(gateById(r, "strategy_review").status, "pending");
});

test("composeReadiness — user window not approved => REVIEW_REQUIRED", () => {
  const r = composeReadiness({ ...GREEN, user_approved_window: false });
  assert.equal(r.verdict, "REVIEW_REQUIRED");
  assert.equal(r.ready, false);
  assert.equal(gateById(r, "user_approval").status, "pending");
});

test("review regression — performance folds only the certifier-selected run IDs", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepo();
  writeTestEvidence({ stateDir, code_sha, command: "npm run test" });
  const cert = {
    ...CERTIFIED,
    requirements: { ...CERTIFIED.requirements, symbols: ["MNQ1!"] },
    symbols: {
      "MNQ1!": {
        expected: 1,
        valid: 1,
        selected: { "2026-01-12|ny-am|MNQ1!": "selected-run" },
      },
    },
  };
  let received;
  const readiness = await collectBacktestReadiness({
    symbol: "MNQ1!",
    stateDir,
    cwd: repo,
    env: {},
    minSessions: 1,
    foldSymbol: async (opts) => {
      received = opts;
      return {
        ...BASELINE,
        code_sha,
        corpus: { n_sessions: 1, dates: ["2026-01-12"], run_ids: ["selected-run"] },
      };
    },
    certifyCorpus: () => cert,
  });
  assert.deepEqual(received.runIds, ["selected-run"]);
  assert.equal(gateById(readiness, "baseline").status, "pass");
});

test("review regression — abbreviated SHA and selected-run drift never pass baseline", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepo();
  const cert = {
    ...CERTIFIED,
    requirements: { ...CERTIFIED.requirements, symbols: ["MNQ1!"] },
    symbols: {
      "MNQ1!": {
        expected: 1,
        valid: 1,
        selected: { "2026-01-12|ny-am|MNQ1!": "selected-run" },
      },
    },
  };
  const scope_digest = readinessScopeDigest(cert.requirements);
  for (const baseline of [
    {
      ...BASELINE,
      code_sha: code_sha.slice(0, 7),
      corpus: { n_sessions: 1, run_ids: ["selected-run"] },
      readiness_identity: { manifest_id: cert.manifest_id, selection_digest: cert.selection_digest, scope_digest },
    },
    {
      ...BASELINE,
      code_sha,
      corpus: { n_sessions: 1, run_ids: ["unselected-run"] },
      readiness_identity: { manifest_id: cert.manifest_id, selection_digest: cert.selection_digest, scope_digest },
    },
  ]) {
    const readiness = await collectBacktestReadiness({
      symbol: "MNQ1!",
      stateDir,
      cwd: repo,
      env: {},
      minSessions: 1,
      baseline,
      certifyCorpus: () => cert,
    });
    assert.equal(gateById(readiness, "baseline").status, "fail");
  }
});

test("review regression — injected top-level performance cannot override certified baseline totals", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepo();
  const cert = {
    ...CERTIFIED,
    requirements: { ...CERTIFIED.requirements, symbols: ["MNQ1!"] },
    symbols: {
      "MNQ1!": {
        expected: 1,
        valid: 1,
        selected: { "2026-01-12|ny-am|MNQ1!": "selected-run" },
      },
    },
  };
  const readiness = await collectBacktestReadiness({
    symbol: "MNQ1!",
    stateDir,
    cwd: repo,
    env: {},
    minSessions: 20,
    foldSymbol: async () => ({
      ...BASELINE,
      code_sha,
      total_r: -5,
      corpus: { n_sessions: 1, dates: ["2026-01-12"], run_ids: ["selected-run"] },
      cum_r: 999,
      sessions: 20,
    }),
    certifyCorpus: () => cert,
  });
  assert.equal(gateById(readiness, "baseline").status, "pass");
  assert.equal(gateById(readiness, "sessions").status, "fail");
  assert.deepEqual(gateById(readiness, "sessions").evidence, { sessions: 1, min_sessions: 20 });
  assert.equal(gateById(readiness, "net_positive").status, "fail");
  assert.equal(gateById(readiness, "net_positive").evidence.cum_r, -5);
  assert.equal(readiness.verdict, "BLOCKED");
});

test("review regression — symbol outside certification scope fails closed before folding", async () => {
  let folds = 0;
  const readiness = await collectBacktestReadiness({
    symbol: "NQ1!",
    stateDir: tmp(),
    cwd: cleanRepo().repo,
    env: {},
    foldSymbol: async () => { folds += 1; return BASELINE; },
    certifyCorpus: () => ({
      ...CERTIFIED,
      requirements: { ...CERTIFIED.requirements, symbols: ["MNQ1!"] },
      symbols: { "MNQ1!": { expected: 1, valid: 1, selected: {} } },
    }),
  });
  assert.equal(folds, 0);
  assert.equal(readiness.verdict, "BLOCKED");
  assert.match(gateById(readiness, "corpus").reason, /not included in certification scope/i);
});

test("review regression — invalid session floor is always BLOCKED", () => {
  for (const minSessions of [-1, 0, 1.5, Number.NaN]) {
    const r = composeReadiness({ ...GREEN, sessions: 0, minSessions });
    assert.equal(r.verdict, "BLOCKED");
    assert.equal(gateById(r, "sessions").status, "fail");
    assert.match(gateById(r, "sessions").reason, /floor is invalid/i);
  }
});
