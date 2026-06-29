// Guard: the root runner must run EVERY tracked tests/**/*.test.js. If anyone reverts
// the runner to a hardcoded subset (the old fragility), --list diverges from git and
// this fails. Both sides use git independently, so a missed nested dir trips it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });

test("runner --list covers exactly the tracked tests/**/*.test.js", () => {
  const tracked = git("ls-files", "-z", "--", "tests")
    .split("\0")
    .filter((f) => f.endsWith(".test.js"))
    .sort();

  const listed = execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts/run-root-tests.mjs"), "--list"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .sort();

  assert.deepEqual(listed, tracked);
  assert.ok(tracked.includes("tests/test-gate-coverage.test.js"));
});
