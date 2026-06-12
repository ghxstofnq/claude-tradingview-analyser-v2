// Backtest engine — summary.md wrap artifact.
//
// A replayed day's wrap is the run summary. The engine writes summary.md
// with chain_audit frontmatter (mirroring the live wrap's summary.md shape)
// so the popover DETAIL view renders the wrap and the run is auditable as
// a markdown document, not just JSON.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";

function deps() {
  return {
    recordEntries: async () => ({ entries: [], warnings: [] }),
    loadDayContext: async () => ({
      session: "ny-am", leader: "MNQ1!",
      ltf_bias_context: { bias: "bearish", htf_ltf_alignment: "aligned", is_retrace_day: false, entry_model_priority: "MSS", grade_cap: "A+" },
      session_state: { pillar1: { status: "pass", htfBias: "bearish" }, pillar2: { status: "pass", verdict: "good" } },
      untaken_targets: { untaken_above: [], untaken_below: [] },
      brief_digest: { htf_destination: {}, primary_draw: {} },
    }),
    runDirectBrief: async () => null,
    truthFn: async () => ({ walkers: [] }),
    gradeFn: () => ({ outcome: "pending" }),
  };
}

test("completed run writes summary.md with chain_audit frontmatter", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-md-"));
  const bus = new EventEmitter();
  const { runId } = await runBacktest({
    date: "2026-06-09", session: "ny-am", mode: "auto", bus, stateDir: dir, deps: deps(),
  });

  const md = fs.readFileSync(path.join(dir, "backtest", runId, "ny-am", "summary.md"), "utf8");
  assert.match(md, /^---\n/);
  assert.match(md, /chain_status: "clean"/);
  assert.match(md, /context_source: "day_state"/);
  assert.match(md, /setups: 0/);
  assert.match(md, /# Backtest 2026-06-09 ny-am/);
});
