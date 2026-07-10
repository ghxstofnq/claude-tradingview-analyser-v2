import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("tv backtest verdict emits parseable BLOCKED JSON and exits nonzero when evidence is absent", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "backtest-cli-blocked-"));
  const result = spawnSync(process.execPath, ["cli/index.js", "backtest", "verdict", "--symbol", "MNQ1!"], {
    cwd: REPO,
    env: { ...process.env, GOFNQ_STATE_DIR: stateDir },
    encoding: "utf8",
  });

  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.verdict, "BLOCKED");
  assert.equal(payload.ready, false);
  assert.ok(Array.isArray(payload.gates));
  assert.equal(payload.gates.find((gate) => gate.id === "corpus")?.status, "fail");
  assert.equal(payload.gates.find((gate) => gate.id === "parity")?.status, "fail");
});