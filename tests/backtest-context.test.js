// Backtest context builders — the recording loop needs the same session
// context the live chain reads from disk (brief + ltf-bias). Two sources:
// the day's recorded state (replaying a real day), or the deterministic
// brief payloads (historic day with no state — grade_cap B, mirroring the
// live catch_up backfill rule).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadDayContext, contextFromBriefPayloads } from "../app/main/backtest-context.js";

function writeDay({ root, date, session, brief, ltfBias }) {
  const dir = path.join(root, date, session);
  fs.mkdirSync(dir, { recursive: true });
  if (brief) fs.writeFileSync(path.join(dir, "brief.json"), JSON.stringify(brief));
  if (ltfBias) fs.writeFileSync(path.join(dir, "ltf-bias.md"), ltfBias);
  return dir;
}

const BRIEF = {
  symbol: "MNQ1!",
  pillar_grade: "B",
  pillar2_verdict: "pass",
  htf_destination: "below nearest untaken liquidity",
  primary_draw: { tf: "daily", kind: "fvg", dir: "bear", top: 29302.5, bottom: 29100, ce: 29200, cite: "engine_by_tf.daily.fvgs[2]" },
  overnight_block: {
    untaken_above: [{ name: "AS.H", price: 29900, cite: "x" }],
    untaken_below: [{ name: "PWL", price: 29302.5, cite: "y" }],
  },
};

const LTF_BIAS = `---
phase: open_reaction_ny_am_complete
leader: MNQ1!
bias: bearish
htf_ltf_alignment: aligned
entry_model_priority: Inversion
grade_cap: A+
is_retrace_day: false
---

# LTF Bias
`;

describe("loadDayContext", () => {
  test("builds the live-shaped context from a recorded day's brief + ltf-bias", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-ctx-"));
    writeDay({ root, date: "2026-06-09", session: "ny-am", brief: BRIEF, ltfBias: LTF_BIAS });

    const ctx = await loadDayContext({ date: "2026-06-09", session: "ny-am", sessionRoot: root });
    assert.equal(ctx.session, "ny-am");
    assert.equal(ctx.leader, "MNQ1!");
    assert.equal(ctx.ltf_bias_context.bias, "bearish");
    assert.equal(ctx.ltf_bias_context.htf_ltf_alignment, "aligned");
    assert.equal(ctx.ltf_bias_context.entry_model_priority, "Inversion");
    assert.equal(ctx.ltf_bias_context.grade_cap, "A+");
    assert.equal(ctx.session_state.pillar1.status, "pass");
    assert.equal(ctx.session_state.pillar2.status, "pass");
    assert.deepEqual(ctx.untaken_targets.untaken_below.map((t) => t.price), [29302.5]);
    assert.equal(ctx.brief_digest.primary_draw.price, 29302.5);
  });

  test("returns null when the day folder has no brief or no ltf-bias", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-ctx-"));
    writeDay({ root, date: "2026-06-10", session: "ny-am", brief: BRIEF, ltfBias: null });
    assert.equal(await loadDayContext({ date: "2026-06-10", session: "ny-am", sessionRoot: root }), null);
    assert.equal(await loadDayContext({ date: "2026-01-01", session: "ny-am", sessionRoot: root }), null);
  });

  test("prefers the leader-specific brief file when present", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-ctx-"));
    const dir = writeDay({ root, date: "2026-06-09", session: "ny-am", brief: { ...BRIEF, pillar_grade: "no-trade" }, ltfBias: LTF_BIAS });
    fs.writeFileSync(path.join(dir, "brief-MNQ1!.json"), JSON.stringify(BRIEF));
    const ctx = await loadDayContext({ date: "2026-06-09", session: "ny-am", sessionRoot: root });
    assert.equal(ctx.session_state.pillar1.status, "pass");
  });
});

describe("contextFromBriefPayloads", () => {
  test("synthesizes a grade-capped context from deterministic brief payloads", () => {
    const ctx = contextFromBriefPayloads({ session: "ny-am", payloads: [BRIEF] });
    assert.equal(ctx.leader, "MNQ1!");
    assert.equal(ctx.ltf_bias_context.bias, "bearish"); // primary_draw dir bear
    assert.equal(ctx.ltf_bias_context.grade_cap, "B");  // backfilled context caps at B
    assert.equal(ctx.ltf_bias_context.entry_model_priority, "undecided");
    assert.equal(ctx.session_state.pillar2.status, "pass");
    assert.deepEqual(ctx.untaken_targets.untaken_above.map((t) => t.price), [29900]);
  });

  test("hard no-trade brief (data_gap) yields null — the run must not pretend", () => {
    const ctx = contextFromBriefPayloads({
      session: "ny-am",
      payloads: [{ ...BRIEF, pillar_grade: "no-trade", no_trade_reason: "data_gap" }],
    });
    assert.equal(ctx, null);
  });

  test("payload without a primary draw is skipped; first drawful payload leads", () => {
    const mes = { ...BRIEF, symbol: "MES1!", primary_draw: undefined };
    const ctx = contextFromBriefPayloads({ session: "ny-am", payloads: [mes, BRIEF] });
    assert.equal(ctx.leader, "MNQ1!");
  });
});
