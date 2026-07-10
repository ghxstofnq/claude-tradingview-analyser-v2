import test from "node:test";
import { EXPECTED_CODE_REV } from "../cli/lib/ict-engine-parser.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "cli", "index.js");

function runCli(args, stateDir) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    env: { ...process.env, GOFNQ_STATE_DIR: stateDir },
    encoding: "utf8",
  });
}

test("router keeps successful JSON command exit code at 0", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "certify-cli-"));
  const res = runCli(["backtest", "list"], stateDir);
  assert.equal(res.status, 0);
  assert.deepEqual(JSON.parse(res.stdout), { symbol: null, count: 0, runs: [] });
});

test("tv backtest certify prints parseable report and exits nonzero when uncertified", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "certify-cli-"));
  const res = runCli(["backtest", "certify"], stateDir);
  assert.notEqual(res.status, 0);

  const rep = JSON.parse(res.stdout);
  assert.equal(rep.manifest_id, "gate-corpus-2026-h1-v1");
  assert.equal(rep.certified, false);
  assert.equal(rep.requirements.schema, 4);
  assert.equal(rep.requirements.code_rev, EXPECTED_CODE_REV);
  assert.equal(rep.requirements.expected_sessions_per_symbol, 239);
  assert.deepEqual(Object.keys(rep.symbols).sort(), ["MES1!", "MNQ1!"]);
  assert.ok(rep.blockers.some((b) => b.code === "no_index"), "empty state -> no_index blocker");
  assert.equal(rep.parity.certified, false);
});
