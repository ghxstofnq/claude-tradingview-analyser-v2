#!/usr/bin/env node
// Save a fold-test for the BACKTEST popover's TESTS section.
//
// Folds the CURRENT working code (the treatment) over a symbol's corpus the
// faithful way (foldSymbol = fold-week regen + AM->PM carry) and diffs it
// against the accepted baseline file, writing state/backtest/tests/<id>.json
// with status "pending". Accept/reject + reason is set later from the popover —
// the verdict is a RECORD, not a code-swap (see /fold-test).
//
// The accepted baseline is the "off"/current-code state, so to test a change
// set its env gate before running; the diff is then the change's effect.
// Pure compute (no TV/CDP) — safe even during a live session.
//
//   node scripts/save-fold-test.mjs MNQ1! "my gate label"                  # all dates
//   node scripts/save-fold-test.mjs MNQ1! "label" 2026-05-11 2026-05-12    # subset (corpus_match=false)
//   TV_MY_GATE=1 node scripts/save-fold-test.mjs MNQ1! "my gate"           # treatment with a gate on
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTestArtifact } from "../app/main/backtest-baseline.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [symbol, label, ...dates] = process.argv.slice(2);
if (!symbol || !label) {
  console.error('usage: save-fold-test.mjs <SYMBOL> "<label>" [dates...]');
  process.exit(2);
}
const stateDir = path.join(REPO, "state");
const t = await buildTestArtifact({ stateDir, symbol, label, dates: dates.length ? dates : undefined });
const sg = (n) => (n >= 0 ? "+" : "") + n + "R";
console.log(`saved test ${t.id}: "${t.label}" ${symbol}`);
console.log(`  treatment ${sg(t.treatment_total)} vs baseline ${sg(t.baseline_total)} = delta ${sg(t.delta)}  (corpus_match=${t.corpus_match}, ${t.dates.length} dates)`);
process.exit(0);
