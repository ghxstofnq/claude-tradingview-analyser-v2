// Replay accuracy gate — the standing regression test fix #4 asked for.
//
// scripts/replay-runner.js (npm run replay) replays every recorded case in
// tests/fixtures/*.replay.json through the real setup detector / packet
// builders and scores actual vs expected. Until now that was a manual
// script: a detector regression (missed A+ setup, false candidate, wrong
// model/side/packet) wouldn't fail CI. This test makes any non-zero error
// count a hard `npm test` failure.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runReplayCasesFromDir, formatReplayRunReport } from "../scripts/replay-runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

// Floor, not exact count — the corpus is meant to grow. Shrinking below the
// committed baseline means cases were deleted, which is itself a regression.
const MIN_CASES = 12;

test("replay corpus: every recorded case still produces its hand-verified verdict", () => {
  const run = runReplayCasesFromDir(FIXTURES_DIR);
  const report = run.report;
  const detail = formatReplayRunReport(run);

  assert.ok(run.cases.length >= MIN_CASES,
    `replay corpus shrank: ${run.cases.length} cases < ${MIN_CASES} baseline\n${detail}`);
  assert.equal(report.missed_valid_setups, 0, `missed valid setups\n${detail}`);
  assert.equal(report.false_candidates, 0, `false candidates\n${detail}`);
  assert.equal(report.wrong_model, 0, `wrong model\n${detail}`);
  assert.equal(report.wrong_side, 0, `wrong side\n${detail}`);
  assert.equal(report.wrong_packet ?? 0, 0, `wrong packet\n${detail}`);
  assert.equal(report.correct_trades + report.correct_no_trades, run.cases.length,
    `some cases neither correct-trade nor correct-no-trade\n${detail}`);
});
