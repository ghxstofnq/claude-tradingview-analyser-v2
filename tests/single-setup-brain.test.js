import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Single-setup-brain guard (audit phase 5).
//
// Decision being locked in:
//   - The walker chain / `buildDeterministicPacketTruthFromInputs` path is the
//     CANONICAL setup producer for live trading and production backtests.
//   - `cli/lib/setup-detector.js` (+ its `-stops` / `-schema` siblings) is an
//     OFFLINE / diagnostic helper only: manual `/analyze` (cli/commands/analyze.js),
//     `scripts/replay-runner.js`, and tests. It is NOT a live setup producer.
//
// The autonomous runtime lives entirely under `app/main/**` (the Electron main
// process: live bar-close loop, backtest engine/deps/baseline, prompt loaders,
// surface tools, IPC). If any of those files import the detector, the "two
// brains" risk is back. This test fails the moment that happens.
//
// ponytail: static-import scan only. It does NOT catch an indirect path (an
// app/main file shelling out to `tv analyze` and reading `bundle.candidates`).
// That's a deliberate non-goal — the live loop reads `<walker_truth>`, and an
// import is the boundary a future dev would actually cross. Widen only if that
// indirect path ever appears.
// ============================================================================

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Matches a real module reference, not prose: `from '…setup-detector…'`,
// `require('…setup-detector…')`, or `import('…setup-detector…')`. Comments that
// merely mention the file by name (there are several documenting its removal)
// don't have an import keyword immediately before a quoted path, so they pass.
const IMPORT_RE = /(?:from|require\(|import\()\s*['"][^'"]*setup-detector/;

function tracked(glob) {
  return execFileSync("git", ["ls-files", "-z", "--", glob], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter((f) => f.endsWith(".js"));
}

test("no app/main file imports cli/lib/setup-detector (single brain: walker chain only)", () => {
  const offenders = [];
  for (const rel of tracked("app/main")) {
    const src = readFileSync(path.join(repoRoot, rel), "utf8");
    for (const [i, line] of src.split("\n").entries()) {
      if (IMPORT_RE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `app/main must not import setup-detector — the walker chain (buildDeterministicPacketTruthFromInputs) ` +
      `is the only live/backtest setup producer. Offending imports:\n${offenders.join("\n")}`,
  );
});

test("setup-detector carries the offline/diagnostic source-of-truth banner", () => {
  const src = readFileSync(path.join(repoRoot, "cli/lib/setup-detector.js"), "utf8");
  assert.match(
    src,
    /SETUP-DETECTOR: OFFLINE \/ DIAGNOSTIC ONLY/,
    "cli/lib/setup-detector.js must keep its source-of-truth banner so the offline-only status stays explicit",
  );
});
