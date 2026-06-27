import { test } from "node:test";
import assert from "node:assert/strict";
import { openReactionVerdict, decisionLine, drawBiasVoteRows } from "../app/renderer/src/Prep.helpers.js";
import { normalizeLtfBiasRecord } from "../cli/lib/ltf-bias-record.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";

// CONTRACT TESTS (seam ❶ from docs/strategy/prep-live-pipeline-wiring.md).
//
// The open-reaction PENDING bug was the reader (openReactionVerdict) keying on
// field names the WRITER never emits — it read `bias`/`verdict`/`reaction_dir`
// while surfaceOpenReaction writes `bias_direction`. Nothing failed the build, so
// it shipped and sat on PENDING for every directional open.
//
// These tests drive each PREP/LIVE reader with the writer's EXACT emitted field
// set and fail if the reader returns its DEFAULT (PENDING / undefined / flat
// no-trade). If a writer drops a field, or a reader starts depending on a field
// the writer doesn't emit, one of these breaks — catching the whole class.

// ── open-reaction.json ─────────────────────────────────────────────────────
// surfaceOpenReaction (app/main/tools/surface.js) writes EXACTLY these keys.
const OPEN_REACTION_WRITER_RECORD = {
  ts: "2026-06-24T13:44:05.000Z",
  minutes_into_phase: 14,
  latest_read: "NY swept the high and rolled — bearish reaction",
  bias_direction: "bearish",
  watching: "post-window structure to earn direction",
};

test("CONTRACT open-reaction → openReactionVerdict resolves the writer's bias_direction (the PENDING-bug guard)", () => {
  const out = openReactionVerdict(OPEN_REACTION_WRITER_RECORD, { pillar1_votes: { htf: "bearish" } });
  assert.equal(out.resolved, true, "reader must resolve the writer's bias_direction, not sit on PENDING");
  assert.notEqual(out.verdict, "PENDING");
  assert.equal(out.rows[2].v, "BEAR");
});

// ── ltf-bias.json / ltf-bias-live.json ─────────────────────────────────────
// The deterministic finalizer + surface_ltf_bias write ltf_bias / htf_ltf_alignment
// / grade_cap / entry_model_priority. getOpenReaction normalizes them via
// normalizeLtfBiasRecord into the { bias, htf_ltf_alignment, ... } the LTF strip
// and the Prep Open-row read.
const LTF_BIAS_WRITER_RECORD = {
  ltf_bias: "bearish",
  htf_ltf_alignment: "divergent",
  grade_cap: "B",
  entry_model_priority: "MSS",
  is_retrace_day: false,
};

test("CONTRACT ltf-bias → normalizeLtfBiasRecord maps the writer's ltf_bias to the reader's `bias`", () => {
  const ctx = normalizeLtfBiasRecord(LTF_BIAS_WRITER_RECORD);
  assert.equal(ctx.bias, "bearish", "reader keys on `bias`; writer emits `ltf_bias` — the mapping must hold");
  assert.equal(ctx.htf_ltf_alignment, "divergent");
  assert.equal(ctx.grade_cap, "B");
  assert.equal(ctx.entry_model_priority, "MSS");
});

// ── brief-*.json → PREP hero ───────────────────────────────────────────────
// Drive a REAL brief payload (buildDirectSessionBriefPayloads, the writer) through
// the PREP hero readers (decisionLine + drawBiasVoteRows). A 1-component lean must
// flow end-to-end and render as a pending lean, not a flat no-trade.
function leanBundle() {
  const ds = {
    htf: {
      daily: { change_pct: "0.2%", top_fvgs: [], top_bprs: [], recent_structures: [] },
      h4: { change_pct: "0.4%", recent_structures: [], top_bprs: [],
        top_fvgs: [{ dir: "bull", top: 30000, bottom: 29950, ce: 29975, disp_score: 0.8, took_liq: true, state: "fresh", size_quality: "normal", cite: "engine_by_tf.h4.fvgs[0]" }] },
      h1: { change_pct: "0.1%", top_fvgs: [], top_bprs: [], recent_structures: [] },
    },
    pillar1: {
      session_levels: { PDH: { price: 29920, state: "untaken", swept: false } },
      untaken_buy_side_above: [{ name: "PDH", price: 29920 }],
      untaken_sell_side_below: [], untaken_pools_above: [], untaken_pools_below: [], sweeps: [],
    },
    pillar2: {
      current_tf: { range_quality: "good", displacement: "clean", candle: "normal" },
      m5: { range_quality: "good", displacement: "clean", candle: "normal" },
      m15: { range_quality: "good", displacement: "acceptable", candle: "normal" },
    },
  };
  return { brief_digest: { symbols: { "MNQ1!": ds }, leader_evidence: {} } };
}

test("CONTRACT brief → decisionLine renders the writer's lean (not a flat no-trade)", () => {
  const [brief] = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: leanBundle(), symbols: ["MNQ1!"] });
  // The writer must emit the lean block the hero reads.
  assert.ok(brief.lean && brief.lean.status === "pending_open", "brief writer must emit a lean block");
  assert.equal(brief.pillar_grade, "no-trade");

  const d = decisionLine(brief);
  assert.equal(d.pending, true, "hero must render the writer's lean as pending, not a flat no-trade");
  assert.equal(d.grade, "B?");
  assert.match(d.bias, /LEANING/);

  const vote = drawBiasVoteRows(brief);
  assert.equal(vote.cast, 1, "vote rows must read the writer's pillar1_votes");
});
