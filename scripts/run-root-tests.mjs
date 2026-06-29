#!/usr/bin/env node
// Root test runner. Enumerates *tracked* tests/**/*.test.js via git (auto-discovers
// any new nested dir — no brittle shell globs to keep in sync) and runs node --test
// over the exact list. `--list` prints the discovered files (used by the coverage guard).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function trackedRootTests() {
  const out = execFileSync("git", ["ls-files", "-z", "--", "tests"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out
    .split("\0")
    .filter((f) => f.endsWith(".test.js"))
    .sort();
}

const files = trackedRootTests();

if (process.argv.includes("--list")) {
  process.stdout.write(files.join("\n") + (files.length ? "\n" : ""));
  process.exit(0);
}

if (files.length === 0) {
  // A test gate that silently runs zero tests is the exact failure we're preventing.
  console.error("run-root-tests: found 0 tracked tests under tests/ — refusing to pass.");
  process.exit(1);
}

// Isolate state writes so the suite never clobbers live state/ (see lessons #79).
const env = { ...process.env };
if (!env.GOFNQ_STATE_DIR) env.GOFNQ_STATE_DIR = mkdtempSync(path.join(tmpdir(), "gofnq-test-"));

const res = spawnSync(process.execPath, ["--test", ...files], {
  cwd: repoRoot,
  stdio: "inherit",
  env,
});
process.exit(res.status ?? 1);
