// Unit tests for app/renderer/src/Prep.helpers.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prepPopoverSource = readFileSync(new URL("../app/renderer/src/PrepPopover.jsx", import.meta.url), "utf8");

import {
  groupLevelsByPrice,
  selectPillar,
  pillar2ToRows,
  formatChainChip,
  htfBiasToRowsConcise,
  htfBiasToRowsDesigner,
  drawBiasVoteRows,
  overnightHeaderRows,
  scenariosMeta,
  stripCitations,
  decisionLine,
  openReactionVerdict,
} from "../app/renderer/src/Prep.helpers.js";

describe("drawBiasVoteRows (Stage F — 3-component draw-bias grade)", () => {
  it("maps both pre-open votes + a pending NY-open row, counts cast votes", () => {
    const out = drawBiasVoteRows({ pillar1_votes: { htf: "bullish", overnight: "bearish" }, pillar_grade: "B" });
    assert.equal(out.rows.length, 3);
    assert.equal(out.rows[0].v, "BULL"); assert.equal(out.rows[0].tone, "bull");
    assert.equal(out.rows[1].v, "BEAR"); assert.equal(out.rows[1].tone, "bear");
    assert.equal(out.rows[2].v, "PENDING"); assert.equal(out.rows[2].tone, "dim");
    assert.equal(out.cast, 2);
    assert.equal(out.grade, "B");
  });
  it("a 'none' vote renders NONE/dim and does not count toward cast", () => {
    const out = drawBiasVoteRows({ pillar1_votes: { htf: "none", overnight: "bullish" } });
    assert.equal(out.rows[0].v, "NONE"); assert.equal(out.rows[0].tone, "dim");
    assert.equal(out.cast, 1);
  });
  it("absent votes → all NONE/PENDING, cast 0, grade null", () => {
    const out = drawBiasVoteRows({});
    assert.equal(out.cast, 0);
    assert.equal(out.grade, null);
    assert.equal(out.rows[0].v, "NONE");
  });
});

describe("groupLevelsByPrice", () => {
  const levels = [
    { name: "PWH", price: 21420, state: "untaken" },
    { name: "PDH", price: 21385, state: "untaken" },
    { name: "AS.H", price: 21380, state: "taken" },
    { name: "AS.L", price: 21290, state: "untaken" },
    { name: "PDL", price: 21230, state: "taken" },
  ];

  it("partitions levels into above and below currentPrice", () => {
    const { above, below } = groupLevelsByPrice(levels, 21350);
    // currentPrice = 21350. Above: PWH (70 away), PDH (35), AS.H (30) — closest first.
    assert.deepEqual(above.map((l) => l.name), ["AS.H", "PDH", "PWH"]);
    // Below: AS.L (60), PDL (120) — closest first.
    assert.deepEqual(below.map((l) => l.name), ["AS.L", "PDL"]);
  });

  it("places level exactly at currentPrice into 'below'", () => {
    const { below } = groupLevelsByPrice([{ name: "X", price: 100 }], 100);
    assert.equal(below[0].name, "X");
  });

  it("returns { above: null, below: null, all: sorted-high-to-low } when currentPrice is missing", () => {
    const { above, below, all } = groupLevelsByPrice(levels, null);
    assert.equal(above, null);
    assert.equal(below, null);
    assert.deepEqual(all.map((l) => l.name), ["PWH", "PDH", "AS.H", "AS.L", "PDL"]);
  });

  it("filters out items with non-numeric price", () => {
    const { above } = groupLevelsByPrice(
      [{ name: "X", price: "PDH" }, { name: "Y", price: 100 }],
      50,
    );
    assert.equal(above.length, 1);
    assert.equal(above[0].name, "Y");
  });

  it("returns empty arrays when no valid levels exist", () => {
    const { above, below } = groupLevelsByPrice([], 100);
    assert.deepEqual(above, []);
    assert.deepEqual(below, []);
  });
});

describe("selectPillar", () => {
  const pillars = [
    { name: "Draw & Bias", status: "pass", elements: [] },
    { name: "Price-Action Quality", status: "weak", elements: [] },
    { name: "Entry Model + Confirmation", status: "pending", elements: [] },
  ];

  it("finds Pillar 1 by name substring", () => {
    const p = selectPillar(pillars, /draw.*bias/i);
    assert.equal(p.status, "pass");
  });

  it("finds Pillar 2 by name substring", () => {
    const p = selectPillar(pillars, /price.*action|quality/i);
    assert.equal(p.status, "weak");
  });

  it("returns null when no pillar matches", () => {
    assert.equal(selectPillar(pillars, /nope/i), null);
  });

  it("returns null when pillars is not an array", () => {
    assert.equal(selectPillar(undefined, /.*/), null);
    assert.equal(selectPillar(null, /.*/), null);
  });
});

describe("pillar2ToRows", () => {
  it("maps three rows in fixed order, matched by name substring", () => {
    const pillar2 = {
      elements: [
        { name: "15m/5m candle quality", status: "weak", detail: "avg body 0.42" },
        { name: "3h range size", status: "pass", detail: "132pt" },
        { name: "4H displacement", status: "weak", detail: "disp_score 4" },
      ],
    };
    const rows = pillar2ToRows(pillar2);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].k, "3h range");
    assert.match(rows[0].v, /PASS/);
    assert.equal(rows[0].tone, "ok");
    assert.equal(rows[1].k, "4H/1H displacement");
    assert.equal(rows[1].tone, "warn");
    assert.equal(rows[2].k, "15m/5m candles");
    assert.equal(rows[2].tone, "warn");
  });

  it("renders missing elements as '—' with dim tone", () => {
    const rows = pillar2ToRows({ elements: [] });
    assert.equal(rows.every((r) => r.v === "—"), true);
    assert.equal(rows.every((r) => r.tone === "dim"), true);
  });

  it("tolerates null pillar2 input", () => {
    const rows = pillar2ToRows(null);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].v, "—");
  });
});

describe("formatChainChip", () => {
  it("hides for null / undefined", () => {
    assert.equal(formatChainChip(null).visible, false);
    assert.equal(formatChainChip(undefined).visible, false);
  });

  it("hides for 'clean'", () => {
    assert.equal(formatChainChip("clean").visible, false);
  });

  it("shows amber for non-clean non-stale states", () => {
    const r = formatChainChip("degraded:pillar2_poor");
    assert.equal(r.visible, true);
    assert.equal(r.tone, "warn");
    assert.equal(r.label, "degraded:pillar2_poor");
  });

  it("shows red for stale:N", () => {
    const r = formatChainChip("stale:18");
    assert.equal(r.visible, true);
    assert.equal(r.tone, "stale");
  });
});

describe("htfBiasToRowsConcise", () => {
  it("formats biases as 'D:BULL / 4H:BULL / 1H:BEAR'", () => {
    const brief = {
      htf_bias: [
        { tf: "D",  bias: "BULL" },
        { tf: "4H", bias: "BULL" },
        { tf: "1H", bias: "BEAR" },
      ],
      htf_destination: "PWH 21450",
      primary_draw: { kind: "FVG", tf: "4H", took_liq: true, state: "ce_tapped" },
    };
    const rows = htfBiasToRowsConcise(brief);
    assert.equal(rows[0].k, "Structure");
    assert.equal(rows[0].v, "D:BULL / 4H:BULL / 1H:BEAR");
    assert.equal(rows[1].k, "Best imbalances");
    // tf first, then dir (omitted here), then kind — "4H FVG · took_liq yes"
    assert.match(rows[1].v, /4H FVG · took_liq yes/);
    assert.equal(rows[2].v, "PWH 21450");
    assert.equal(rows[3].v, "ce_tapped");
  });

  it("renders '—' for missing fields", () => {
    const rows = htfBiasToRowsConcise({});
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((r) => r.v), ["—", "—", "—", "—"]);
  });

  it("each row carries a strategy-doc tooltip", () => {
    const rows = htfBiasToRowsConcise({});
    for (const r of rows) assert.ok(r.tip && r.tip.length > 10);
  });
});

describe("overnightHeaderRows", () => {
  it("formats Asia H/L and London H/L from key_levels (legacy form)", () => {
    const brief = {
      key_levels: [
        { name: "AS_H", price: 21380 },
        { name: "AS_L", price: 21290 },
        { name: "LO_H", price: 21420 },
        { name: "LO_L", price: 21340 },
      ],
      overnight_block: { overnight_verdict: "extending HTF" },
    };
    const rows = overnightHeaderRows(brief);
    assert.equal(rows[0].v, "21380 / 21290");
    assert.equal(rows[1].v, "21420 / 21340");
    assert.equal(rows[2].v, "extending HTF");
  });

  it("accepts dotted-name variants for legacy briefs", () => {
    const brief = { key_levels: [
      { name: "AS.H", price: 100 }, { name: "AS.L", price: 90 },
    ]};
    const rows = overnightHeaderRows(brief);
    assert.equal(rows[0].v, "100 / 90");
  });
});

describe("scenariosMeta", () => {
  it("returns 'deterministic prep' when no sizing_note", () => {
    assert.equal(scenariosMeta({}), "deterministic prep");
  });

  it("appends sizing_note when present", () => {
    assert.equal(scenariosMeta({ sizing_note: "sizing 2c if A+" }), "deterministic prep · sizing 2c if A+");
  });
});

describe("PrepPopover deterministic / AI separation", () => {
  it("renders deterministic structured panels (not Claude-branded prose)", () => {
    // Verdict-first redesign: the DET view is structured panels, not prose.
    assert.match(prepPopoverSource, /title="BIAS"/);
    assert.match(prepPopoverSource, /title="OPEN REACTION"/);
    assert.match(prepPopoverSource, /title="PLAN/);
    // The deterministic body must never be branded as Claude/AI-authored.
    assert.doesNotMatch(prepPopoverSource, /BRIEF · CLAUDE/);
    assert.doesNotMatch(prepPopoverSource, /Claude will propose/);
  });
  it("gates AI analysis behind an explicit DET/AI toggle + labelled AI view", () => {
    assert.match(prepPopoverSource, /onView\("det"\)/);
    assert.match(prepPopoverSource, /onView\("ai"\)/);
    assert.match(prepPopoverSource, /AI IN-DEPTH/);
  });
});

describe("decisionLine (verdict-first hero)", () => {
  it("maps grade → tone, net bias, cast count, draw, and a deterministic reason", () => {
    const out = decisionLine({
      pillar_grade: "B",
      htf_bias_dir: "bearish",
      pillar1_votes: { htf: "bearish", overnight: "bearish" },
      pillar2_verdict: "marginal",
      primary_draw: { tf: "h4", kind: "ifvg", dir: "bull", ce: 29916.5, vote_reason: "inverted-displaced(0.52)" },
    });
    assert.equal(out.grade, "B");
    assert.equal(out.gradeTone, "amber");
    assert.equal(out.bias, "BEARISH");
    assert.equal(out.biasTone, "bad");
    assert.equal(out.cast, 2);
    assert.equal(out.draw, "h4 bull IFVG · 29916.5");
    assert.equal(out.reason, "inverted-displaced(0.52) · price quality marginal");
  });

  it("no-trade grade → red; empty brief → neutral defaults with cast 0", () => {
    assert.equal(decisionLine({ pillar_grade: "no-trade" }).gradeTone, "red");
    const empty = decisionLine({});
    assert.equal(empty.grade, "—");
    assert.equal(empty.bias, "NEUTRAL");
    assert.equal(empty.biasTone, "warn");
    assert.equal(empty.cast, 0);
    assert.equal(empty.draw, "—");
    assert.equal(empty.reason, "");
  });

  it("falls back to htf_destination when no primary_draw", () => {
    assert.equal(decisionLine({ htf_destination: "below nearest untaken liquidity" }).draw, "below nearest untaken liquidity");
  });
});

describe("openReactionVerdict (Lanto's 3rd component)", () => {
  const brief = { pillar1_votes: { htf: "bearish", overnight: "bearish" } };

  it("pre-open (no live read) → PENDING with HTF/Overnight votes mapped", () => {
    const out = openReactionVerdict(null, brief);
    assert.equal(out.resolved, false);
    assert.equal(out.verdict, "PENDING");
    assert.equal(out.rows[0].v, "BEAR");
    assert.equal(out.rows[1].v, "BEAR");
    assert.equal(out.rows[2].v, "PENDING");
    assert.equal(out.rows[2].tone, "dim");
  });

  it("live confirm → CONFIRMS; flip → FLIPS; stand-aside → NOT YET", () => {
    assert.equal(openReactionVerdict({ verdict: "confirmed", bias: "bearish" }, brief).verdict, "CONFIRMS");
    assert.equal(openReactionVerdict({ verdict: "flip", bias: "bullish" }, brief).verdict, "FLIPS");
    assert.equal(openReactionVerdict({ confirmation: "stand aside", reaction_dir: "mixed" }, brief).verdict, "NOT YET");
  });

  // The masked latent bug: the real deterministic writer emits `bias_direction`,
  // not `bias`/`verdict`/`reaction_dir`. The old reader keyed on the latter, so a
  // directional open showed PENDING. Now bias_direction drives the Open row, and
  // the verdict derives from the HTF vote when no alignment word is present.
  it("real record: bias_direction directional → Open row + verdict resolve (regression)", () => {
    const out = openReactionVerdict({ bias_direction: "bearish", latest_read: "NY swept the high and rolled" }, brief);
    assert.equal(out.resolved, true);
    assert.equal(out.rows[2].v, "BEAR");
    assert.equal(out.verdict, "CONFIRMS"); // HTF vote is bearish → open ran with the lean
    assert.equal(out.note, "NY swept the high and rolled");
  });

  // Option B: the live LTF context's own htf_ltf_alignment is the verdict source.
  it("live ltf: aligned → CONFIRMS, divergent → FLIPS, with direction from ltf.bias", () => {
    const aligned = openReactionVerdict({ bias_direction: "pending" }, brief, { bias: "bear", htf_ltf_alignment: "aligned", grade_cap: "A" });
    assert.equal(aligned.rows[2].v, "BEAR");
    assert.equal(aligned.verdict, "CONFIRMS");
    assert.equal(aligned.verdictTone, "green");

    const divergent = openReactionVerdict({ bias_direction: "pending" }, brief, { bias: "bull", htf_ltf_alignment: "divergent" });
    assert.equal(divergent.rows[2].v, "BULL");
    assert.equal(divergent.verdict, "FLIPS");
    assert.equal(divergent.verdictTone, "amber");
  });

  // 2026-06-24: a genuinely-pending open (stand-aside) must STILL read PENDING —
  // the live ltf has null bias + unclear alignment, the record says "pending".
  it("genuinely-pending open → PENDING (not a false resolve)", () => {
    const out = openReactionVerdict({ bias_direction: "pending" }, brief, { bias: null, htf_ltf_alignment: "unclear", grade_cap: "B" });
    assert.equal(out.resolved, false);
    assert.equal(out.verdict, "PENDING");
    assert.equal(out.rows[2].v, "PENDING");
  });
});

describe("stripCitations", () => {
  it("removes inline (json.path) citation parentheticals", () => {
    const input = "Bullish across Daily +16.81% (brief_digest.symbols.MNQ1!.htf.daily.change_pct), 4H +7.54% (brief_digest.symbols.MNQ1!.htf.h4.change_pct).";
    const out = stripCitations(input);
    assert.equal(out, "Bullish across Daily +16.81%, 4H +7.54%.");
  });

  it("removes citations with array indexing + bang chars", () => {
    const input = "FVG at 29 805.25 (engine_by_tf.h1.fvgs[17]) — primary draw.";
    const out = stripCitations(input);
    assert.equal(out, "FVG at 29 805.25 — primary draw.");
  });

  it("collapses double spaces left behind", () => {
    const input = "A (path.one) B (path.two) C";
    const out = stripCitations(input);
    assert.equal(out, "A B C");
  });

  it("handles null / empty input", () => {
    assert.equal(stripCitations(null), "");
    assert.equal(stripCitations(undefined), "");
    assert.equal(stripCitations(""), "");
  });
});

describe("overnightHeaderRows — overnight_block.overnight_verdict", () => {
  it("reads overnight_block.overnight_verdict (canonical field)", () => {
    const brief = {
      overnight_block: {
        asia:   { high: 29990,   low: 29770.5, state: "swept",   cite: "x" },
        london: { high: 29930.5, low: 29743,   state: "swept",   cite: "x" },
        overnight_verdict: "consolidating",
      },
    };
    const rows = overnightHeaderRows(brief);
    assert.equal(rows[0].v, "29990 / 29770.5");
    assert.equal(rows[1].v, "29930.5 / 29743");
    assert.equal(rows[2].v, "consolidating");
  });

  it("falls back to brief.overnight[0].v when no overnight_block", () => {
    const brief = { overnight: [{ k: "Asia range", v: "30 pts" }] };
    const rows = overnightHeaderRows(brief);
    assert.equal(rows[2].v, "30 pts");
  });

  it("prefers brief.overnight[].v whose k matches /overnight|tone/", () => {
    const brief = {
      overnight: [
        { k: "Asia", v: "swept" },
        { k: "London", v: "swept" },
        { k: "Overnight tone", v: "extending HTF" },
      ],
    };
    const rows = overnightHeaderRows(brief);
    assert.equal(rows[2].v, "extending HTF");
  });
});

describe("pillar2ToRows — TF-prefixed element names", () => {
  it("matches h4 / m5 element names from the chain spec", () => {
    const pillar2 = {
      elements: [
        { name: "h4 quality (good / acceptable / normal)", status: "pass" },
        { name: "h1 quality (good / clean / normal)", status: "pass" },
        { name: "m5 anatomy (clean displacement / doji_wick candle)", status: "weak" },
        { name: "m15 anatomy (clean / normal)", status: "pass" },
      ],
    };
    const rows = pillar2ToRows(pillar2);
    // 3h range — no element matches (no "range" / "3h range" in the chain spec)
    assert.equal(rows[0].v, "—");
    // 4H/1H displacement — matches h4 first
    assert.match(rows[1].v, /PASS/);
    // 15m/5m candles — matches m5 (anatomy)
    assert.match(rows[2].v, /WEAK/);
  });

  it("still matches legacy 'range' / 'displacement' / 'candle' names", () => {
    const pillar2 = {
      elements: [
        { name: "range", status: "pass" },
        { name: "displacement", status: "weak" },
        { name: "candle", status: "pass" },
      ],
    };
    const rows = pillar2ToRows(pillar2);
    assert.match(rows[0].v, /PASS/);
    assert.match(rows[1].v, /WEAK/);
    assert.match(rows[2].v, /PASS/);
  });
});

describe("htfBiasToRowsConcise — abbreviation + dir in best imbalances", () => {
  it("abbreviates DAILY -> D and BULLISH -> BULL", () => {
    const brief = {
      htf_bias: [
        { tf: "DAILY", bias: "BULLISH" },
        { tf: "4H",    bias: "BEARISH" },
        { tf: "1H",    bias: "MIXED" },
      ],
    };
    const rows = htfBiasToRowsConcise(brief);
    assert.equal(rows[0].v, "D:BULL / 4H:BEAR / 1H:MIXED");
  });

  it("includes pd.dir in best imbalances output", () => {
    const brief = {
      primary_draw: { tf: "h1", dir: "bull", kind: "fvg", took_liq: true },
    };
    const rows = htfBiasToRowsConcise(brief);
    assert.match(rows[1].v, /h1 bull FVG · took_liq yes/);
  });
});

describe("htfBiasToRowsDesigner — per-TF rows with tone + note + Draw", () => {
  it("emits one row per htf_bias TF with label, abbreviated bias, and tone", () => {
    const brief = {
      htf_bias: [
        { tf: "DAILY", bias: "BULLISH", note: "up 1% (x.y)" },
        { tf: "4H",    bias: "BEARISH", note: "down (a.b)" },
        { tf: "1H",    bias: "NEUTRAL", note: "ranging (c.d)" },
      ],
    };
    const rows = htfBiasToRowsDesigner(brief);
    assert.equal(rows[0].k, "Daily");
    assert.equal(rows[0].v, "BULL");
    assert.equal(rows[0].tone, "bull");
    assert.equal(rows[1].v, "BEAR");
    assert.equal(rows[1].tone, "bear");
    assert.equal(rows[2].v, "NEUTRAL");
    assert.equal(rows[2].tone, "neutral");
  });

  it("strips the (json.path) citation from the note but keeps it in the tip", () => {
    const brief = { htf_bias: [{ tf: "DAILY", bias: "BULLISH", note: "up 1.5% (brief_digest.x)" }] };
    const rows = htfBiasToRowsDesigner(brief);
    assert.equal(rows[0].note, "up 1.5%");
    assert.equal(rows[0].tip, "up 1.5% (brief_digest.x)");
  });

  it("appends a Draw row from primary_draw using the midpoint (ce)", () => {
    const brief = {
      htf_bias: [{ tf: "DAILY", bias: "BULLISH", note: "x (a.b)" }],
      primary_draw: { tf: "h4", kind: "fvg", dir: "bear", ce: 30002, took_liq: true, cite: "engine_by_tf.h4.fvgs[16]" },
    };
    const rows = htfBiasToRowsDesigner(brief);
    const draw = rows[rows.length - 1];
    assert.equal(draw.k, "Draw");
    assert.equal(draw.v, "30002");
    assert.match(draw.note, /h4 · FVG midpoint · bear · took liq/);
    assert.match(draw.tip, /engine_by_tf\.h4\.fvgs\[16\]/);
  });

  it("falls back to htf_destination text when no primary_draw", () => {
    const brief = {
      htf_bias: [{ tf: "DAILY", bias: "BULLISH" }],
      htf_destination: "above nearest untaken liquidity",
    };
    const rows = htfBiasToRowsDesigner(brief);
    const draw = rows[rows.length - 1];
    assert.equal(draw.k, "Draw");
    assert.equal(draw.v, "above nearest untaken liquidity");
  });

  it("returns [] for an empty brief", () => {
    assert.deepEqual(htfBiasToRowsDesigner({}), []);
    assert.deepEqual(htfBiasToRowsDesigner(null), []);
  });
});
