import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  normalizeLevers,
  currentCodeIdentity,
  readinessScopeDigest,
  writeTestEvidence,
  readTestEvidence,
  testsGreenForSha,
  testsGreenForCurrentCode,
  writeApproval,
  readApproval,
  validateApproval,
  approvalPath,
  readinessDir,
} from "../cli/lib/backtest-readiness-state.js";
import { approveReadiness, verifyReadinessTests } from "../cli/lib/backtest-readiness-actions.js";
import { execFileSync } from "node:child_process";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "readiness-state-"));
}

test("normalizeLevers — keeps GOFNQ strategy levers, sorted; drops operational + non-GOFNQ", () => {
  const env = {
    GOFNQ_PM_CARRY_ONLY: "1",
    GOFNQ_HTF_INTRADAY_DRAW: "1",
    GOFNQ_STATE_DIR: "/tmp/state",
    GOFNQ_LOG_DIR: "/tmp/log",
    PATH: "/usr/bin",
    NODE_OPTIONS: "--x",
  };
  const levers = normalizeLevers(env);
  assert.deepEqual(Object.keys(levers), ["GOFNQ_HTF_INTRADAY_DRAW", "GOFNQ_PM_CARRY_ONLY"]);
  assert.equal(levers.GOFNQ_STATE_DIR, undefined);
});

test("normalizeLevers — rejects malformed lever input instead of silently dropping it", () => {
  assert.throws(() => normalizeLevers(null), /lever environment must be an object/);
  assert.throws(() => normalizeLevers(["GOFNQ_FAKE"]), /lever environment must be a plain object/);
});

test("normalizeLevers — never persists secret-like GOFNQ values", () => {
  assert.deepEqual(normalizeLevers({
    GOFNQ_API_KEY: "do-not-write",
    GOFNQ_SESSION_TOKEN: "also-secret",
    GOFNQ_INV_GATE: "1",
  }), { GOFNQ_INV_GATE: "1" });
});

test("test evidence — green only for the exact bound SHA, fail-closed otherwise", () => {
  const stateDir = tmp();
  assert.equal(testsGreenForSha({ stateDir, code_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), false); // missing
  writeTestEvidence({ stateDir, code_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", command: "npm run test" });
  assert.equal(testsGreenForSha({ stateDir, code_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), true);
  assert.equal(testsGreenForSha({ stateDir, code_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }), false); // wrong sha
  assert.equal(testsGreenForSha({ stateDir, code_sha: undefined }), false); // no sha
});

test("test evidence — rejects malformed current positive records", () => {
  const stateDir = tmp();
  fs.mkdirSync(readinessDir(stateDir), { recursive: true });
  const file = path.join(readinessDir(stateDir), "tests-green.json");
  fs.writeFileSync(file, JSON.stringify({ schema: 999, kind: "tests_green", code_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }));
  assert.equal(testsGreenForSha({ stateDir, code_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), false);
  fs.writeFileSync(file, JSON.stringify({ schema: 1, kind: "other", code_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }));
  assert.equal(testsGreenForSha({ stateDir, code_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), false);
  fs.writeFileSync(file, JSON.stringify({ schema: 1, kind: "tests_green", code_sha: "" }));
  assert.equal(testsGreenForSha({ stateDir, code_sha: "" }), false);
  fs.writeFileSync(file, JSON.stringify({
    schema: 1,
    kind: "tests_green",
    code_sha: "a".repeat(40),
    command: "npm run test",
    ran_at: "not-a-timestamp",
  }));
  assert.equal(testsGreenForSha({ stateDir, code_sha: "a".repeat(40) }), false);
});

test("test evidence — requires a fully clean worktree for current-code evidence", () => {
  const stateDir = tmp();
  const repo = tmp();
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  fs.writeFileSync(path.join(repo, "tracked.txt"), "one\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["-c", "user.email=a@example.test", "-c", "user.name=A", "commit", "-m", "init"], { cwd: repo, stdio: "ignore" });

  const clean = currentCodeIdentity({ cwd: repo });
  assert.equal(clean.ok, true);
  writeTestEvidence({ stateDir, code_sha: clean.code_sha, command: "npm run test" });
  assert.equal(testsGreenForCurrentCode({ stateDir, cwd: repo }).ok, true);

  fs.writeFileSync(path.join(repo, "node_modules"), "untracked artifact\n");
  assert.equal(testsGreenForCurrentCode({ stateDir, cwd: repo }).ok, false);
  fs.rmSync(path.join(repo, "node_modules"));
  assert.equal(testsGreenForCurrentCode({ stateDir, cwd: repo }).ok, true);

  fs.writeFileSync(path.join(repo, "tracked.txt"), "two\n");
  const dirty = currentCodeIdentity({ cwd: repo });
  assert.equal(dirty.ok, false);
  assert.match(dirty.reason, /worktree is dirty/);
  assert.equal(testsGreenForCurrentCode({ stateDir, cwd: repo }).ok, false);
});

test("test evidence — atomic replace supersedes an old SHA record", () => {
  const stateDir = tmp();
  writeTestEvidence({ stateDir, code_sha: "1111111111111111111111111111111111111111", command: "npm run test" });
  writeTestEvidence({ stateDir, code_sha: "2222222222222222222222222222222222222222", command: "npm run test" });
  assert.equal(testsGreenForSha({ stateDir, code_sha: "1111111111111111111111111111111111111111" }), false);
  assert.equal(testsGreenForSha({ stateDir, code_sha: "2222222222222222222222222222222222222222" }), true);
});

const APPROVAL = {
  manifest_id: "gate-corpus-2026-h1-v1",
  selection_digest: "e".repeat(64),
  evidence_scope: { from: "2026-01-10", to: "2026-07-03", sessions: ["ny-am", "ny-pm"], symbols: ["MNQ1!"] },
  scope_digest: readinessScopeDigest({ from: "2026-01-10", to: "2026-07-03", sessions: ["ny-am", "ny-pm"], symbols: ["MNQ1!"] }),
  code_sha: "cccccccccccccccccccccccccccccccccccccccc",
  symbol: "MNQ1!",
  levers: { GOFNQ_HTF_INTRADAY_DRAW: "1" },
  strategy_review_state: "approved",
  user_approved_window: true,
  note: "signed off",
  ts: "2026-07-10T12:00:00.000Z",
};

test("approval — round-trips and validates when every bound value matches", () => {
  const stateDir = tmp();
  writeApproval({ stateDir, record: APPROVAL });
  const back = readApproval({ stateDir, manifest_id: APPROVAL.manifest_id, symbol: "MNQ1!" });
  assert.equal(back.code_sha, "cccccccccccccccccccccccccccccccccccccccc");
  assert.equal(back.kind, "readiness_approval");
  const v = validateApproval({
    record: back,
    manifest_id: APPROVAL.manifest_id,
    selection_digest: APPROVAL.selection_digest,
    scope_digest: APPROVAL.scope_digest,
    code_sha: "cccccccccccccccccccccccccccccccccccccccc",
    symbol: "MNQ1!",
    levers: { GOFNQ_HTF_INTRADAY_DRAW: "1" },
  });
  assert.equal(v.ok, true);
  assert.equal(v.strategy_review_state, "approved");
  assert.equal(v.user_approved_window, true);
});

test("approval — rejects incomplete or malformed positive records", () => {
  const v1 = validateApproval({
    record: { ...APPROVAL, schema: 1, kind: "readiness_approval", user_approved_window: false },
    manifest_id: APPROVAL.manifest_id,
    selection_digest: APPROVAL.selection_digest,
    scope_digest: APPROVAL.scope_digest,
    code_sha: "cccccccccccccccccccccccccccccccccccccccc",
    symbol: "MNQ1!",
    levers: { GOFNQ_HTF_INTRADAY_DRAW: "1" },
  });
  assert.equal(v1.ok, false);
  assert.match(v1.reason, /user window/);

  const v2 = validateApproval({
    record: { ...APPROVAL, schema: 1, kind: "readiness_approval", strategy_review_state: "pending" },
    manifest_id: APPROVAL.manifest_id,
    selection_digest: APPROVAL.selection_digest,
    scope_digest: APPROVAL.scope_digest,
    code_sha: "cccccccccccccccccccccccccccccccccccccccc",
    symbol: "MNQ1!",
    levers: { GOFNQ_HTF_INTRADAY_DRAW: "1" },
  });
  assert.equal(v2.ok, false);
  assert.match(v2.reason, /strategy review/);

  const v3 = validateApproval({
    record: { ...APPROVAL, schema: 1, kind: "readiness_approval", levers: [] },
    manifest_id: APPROVAL.manifest_id,
    selection_digest: APPROVAL.selection_digest,
    scope_digest: APPROVAL.scope_digest,
    code_sha: "cccccccccccccccccccccccccccccccccccccccc",
    symbol: "MNQ1!",
    levers: { GOFNQ_HTF_INTRADAY_DRAW: "1" },
  });
  assert.equal(v3.ok, false);
  assert.match(v3.reason, /lever shape/);
});

for (const [label, drift] of [
  ["code sha", { code_sha: "dddddddddddddddddddddddddddddddddddddddd" }],
  ["selection digest", { selection_digest: "f".repeat(64) }],
  ["evidence scope", { scope_digest: "f".repeat(64) }],
  ["manifest id", { manifest_id: "gate-corpus-2026-h1-v2" }],
  ["levers", { levers: { GOFNQ_HTF_INTRADAY_DRAW: "0" } }],
]) {
  test(`approval — drift on ${label} => not ok, with a clear reason`, () => {
    const stateDir = tmp();
    writeApproval({ stateDir, record: APPROVAL });
    const back = readApproval({ stateDir, manifest_id: APPROVAL.manifest_id, symbol: "MNQ1!" });
    const v = validateApproval({
      record: back,
      manifest_id: APPROVAL.manifest_id,
      selection_digest: APPROVAL.selection_digest,
      scope_digest: APPROVAL.scope_digest,
      code_sha: "cccccccccccccccccccccccccccccccccccccccc",
      symbol: "MNQ1!",
      levers: { GOFNQ_HTF_INTRADAY_DRAW: "1" },
      ...drift,
    });
    assert.equal(v.ok, false);
    assert.equal(typeof v.reason, "string");
    assert.ok(v.reason.length > 0);
  });
}

test("approval — missing record is pending, fail-closed", () => {
  const stateDir = tmp();
  const back = readApproval({ stateDir, manifest_id: APPROVAL.manifest_id, symbol: "MNQ1!" });
  assert.equal(back, null);
  const v = validateApproval({
    record: back,
    manifest_id: APPROVAL.manifest_id,
    selection_digest: APPROVAL.selection_digest,
    scope_digest: APPROVAL.scope_digest,
    code_sha: "cccccccccccccccccccccccccccccccccccccccc",
    symbol: "MNQ1!",
    levers: {},
  });
  assert.equal(v.ok, false);
});

test("approval path — no traversal escapes the approvals dir", () => {
  const stateDir = tmp();
  // Unsafe manifest id is rejected outright.
  assert.equal(approvalPath({ stateDir, manifest_id: "../evil", symbol: "MNQ1!" }), null);
  // A hostile symbol is rejected rather than silently slugged.
  assert.equal(approvalPath({ stateDir, manifest_id: APPROVAL.manifest_id, symbol: "../../etc/passwd" }), null);
  assert.ok(approvalPath({ stateDir, manifest_id: APPROVAL.manifest_id, symbol: "MNQ1!" }));
});

function cleanRepoFixture() {
  const repo = tmp();
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  fs.writeFileSync(path.join(repo, "tracked.txt"), "one\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["-c", "user.email=a@example.test", "-c", "user.name=A", "commit", "-m", "init"], { cwd: repo, stdio: "ignore" });
  const code_sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  return { repo, code_sha };
}

function fakeSpawn(exitCode, seen) {
  return (cmd, args, opts) => {
    seen.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit("close", exitCode));
    return child;
  };
}

test("verifyReadinessTests — runs broad test command safely and writes evidence only on exit 0", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepoFixture();
  const seen = [];
  const result = await verifyReadinessTests({
    stateDir,
    cwd: repo,
    spawnImpl: fakeSpawn(0, seen),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code_sha, code_sha);
  assert.deepEqual(seen.map((x) => [x.cmd, x.args]), [["npm", ["run", "test"]]]);
  assert.equal(seen[0].opts.shell, false);
  assert.equal(readTestEvidence({ stateDir }).code_sha, code_sha);
});

test("verifyReadinessTests — failure clears old positive evidence and returns nonzero result", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepoFixture();
  writeTestEvidence({ stateDir, code_sha, command: "npm run test" });

  const result = await verifyReadinessTests({
    stateDir,
    cwd: repo,
    spawnImpl: fakeSpawn(1, []),
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(readTestEvidence({ stateDir }), null);
});

test("approveReadiness — requires explicit strategy review and user-window approval", async () => {
  const stateDir = tmp();
  const { repo } = cleanRepoFixture();
  await assert.rejects(() => approveReadiness({
    stateDir,
    cwd: repo,
    symbol: "MNQ1!",
    strategyReview: "pending",
    userWindowApproved: true,
    certifyCorpus: () => ({ manifest_id: "gate-corpus-2026-h1-v1", certified: true, selection_digest: "e".repeat(64) }),
  }), /strategy review/);

  await assert.rejects(() => approveReadiness({
    stateDir,
    cwd: repo,
    symbol: "MNQ1!",
    strategyReview: "approved",
    userWindowApproved: false,
    certifyCorpus: () => ({ manifest_id: "gate-corpus-2026-h1-v1", certified: true, selection_digest: "e".repeat(64) }),
  }), /user window/);
});

test("approveReadiness — requires green test evidence for the exact clean code", async () => {
  const stateDir = tmp();
  const { repo } = cleanRepoFixture();
  await assert.rejects(() => approveReadiness({
    stateDir,
    cwd: repo,
    symbol: "MNQ1!",
    strategyReview: "approved",
    userWindowApproved: true,
  }), /no green test evidence/);
});

test("approveReadiness — writes auditable current manifest selection code lever record", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepoFixture();
  writeTestEvidence({ stateDir, code_sha, command: "npm run test" });
  const requirements = { from: "2026-01-10", to: "2026-07-03", sessions: ["ny-am", "ny-pm"], symbols: ["MNQ1!"] };
  const result = await approveReadiness({
    stateDir,
    cwd: repo,
    symbol: "MNQ1!",
    env: { GOFNQ_HTF_INTRADAY_DRAW: "1", GOFNQ_STATE_DIR: "/tmp/ignored" },
    strategyReview: "approved",
    userWindowApproved: true,
    note: "reviewed",
    certifyCorpus: () => ({
      manifest_id: "gate-corpus-2026-h1-v1",
      certified: true,
      selection_digest: "e".repeat(64),
      parity: { certified: true },
      requirements,
      symbols: { "MNQ1!": { expected: 1, valid: 1, selected: { "2026-01-12|ny-am|MNQ1!": "run-1" } } },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.code_sha, code_sha);
  assert.equal(result.record.scope_digest, readinessScopeDigest(requirements));
  assert.deepEqual(result.record.levers, { GOFNQ_HTF_INTRADAY_DRAW: "1" });
  const stored = readApproval({ stateDir, manifest_id: "gate-corpus-2026-h1-v1", symbol: "MNQ1!" });
  assert.equal(stored.note, "reviewed");
  assert.equal(stored.kind, "readiness_approval");
});

test("review regression — mixed-case secret-like lever names are never persisted", () => {
  assert.deepEqual(normalizeLevers({ GOFNQ_api_key: "secret", GOFNQ_INV_GATE: "1" }), {
    GOFNQ_INV_GATE: "1",
  });
});

test("review regression — test evidence is rejected when HEAD changes during the run", async () => {
  const stateDir = tmp();
  const { repo } = cleanRepoFixture();
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      fs.writeFileSync(path.join(repo, "tracked.txt"), "two\n");
      execFileSync("git", ["add", "tracked.txt"], { cwd: repo, stdio: "ignore" });
      execFileSync("git", ["-c", "user.email=a@example.test", "-c", "user.name=A", "commit", "-m", "changed"], { cwd: repo, stdio: "ignore" });
      child.emit("close", 0);
    });
    return child;
  };
  const result = await verifyReadinessTests({ stateDir, cwd: repo, spawnImpl });
  assert.equal(result.ok, false);
  assert.match(result.reason, /changed during test run/i);
  assert.equal(readTestEvidence({ stateDir }), null);
});

test("review regression — explicit current strategy rejection remains rejected", () => {
  const stateDir = tmp();
  const scope = { ...APPROVAL.evidence_scope, symbols: ["MNQ1!"] };
  const record = {
    ...APPROVAL,
    evidence_scope: scope,
    scope_digest: readinessScopeDigest(scope),
    strategy_review_state: "rejected",
    user_approved_window: false,
  };
  writeApproval({ stateDir, record });
  const v = validateApproval({
    record: readApproval({ stateDir, manifest_id: record.manifest_id, symbol: record.symbol }),
    manifest_id: record.manifest_id,
    selection_digest: record.selection_digest,
    scope_digest: record.scope_digest,
    code_sha: record.code_sha,
    symbol: record.symbol,
    levers: record.levers,
  });
  assert.equal(v.ok, false);
  assert.equal(v.strategy_review_state, "rejected");
  assert.match(v.reason, /rejected/i);
});

test("review regression — approval rejects a symbol outside certification scope", async () => {
  const stateDir = tmp();
  const { repo, code_sha } = cleanRepoFixture();
  writeTestEvidence({ stateDir, code_sha, command: "npm run test" });
  await assert.rejects(() => approveReadiness({
    stateDir,
    cwd: repo,
    symbol: "NQ1!",
    strategyReview: "approved",
    userWindowApproved: true,
    certifyCorpus: () => ({
      manifest_id: "gate-corpus-2026-h1-v1",
      certified: true,
      selection_digest: "e".repeat(64),
      parity: { certified: true },
      requirements: { from: "2026-01-10", to: "2026-07-03", symbols: ["MNQ1!"], sessions: ["ny-am"] },
      symbols: { "MNQ1!": { expected: 1, valid: 1, selected: {} } },
    }),
  }), /not included in certification scope/i);
});
