import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeLtfBiasRecord, isFinalizedLtfBiasRecord } from "../cli/lib/ltf-bias-record.js";

describe("normalizeLtfBiasRecord", () => {
  it("maps the real ltf-bias.json sidecar to the chain context (the bug: chain read .md frontmatter, which lacks these)", () => {
    const rec = {
      session: "ny-pm", ltf_bias: "mixed", htf_ltf_alignment: "divergent",
      leader: "MNQ1!", is_retrace_day: true, entry_model_priority: "MSS", grade_cap: "B",
    };
    const c = normalizeLtfBiasRecord(rec);
    assert.equal(c.bias, "mixed");
    assert.equal(c.leader, "MNQ1!");
    assert.equal(c.htf_ltf_alignment, "divergent");
    assert.equal(c.is_retrace_day, true);
    assert.equal(c.entry_model_priority, "MSS");
    assert.equal(c.grade_cap, "B");
  });

  it("accepts the legacy `bias` / `leader_bias` field names too", () => {
    assert.equal(normalizeLtfBiasRecord({ bias: "bullish" }).bias, "bullish");
    assert.equal(normalizeLtfBiasRecord({ leader_bias: "bearish" }).bias, "bearish");
  });

  it("ltf_bias wins over the legacy aliases", () => {
    assert.equal(normalizeLtfBiasRecord({ ltf_bias: "bullish", bias: "bearish" }).bias, "bullish");
  });

  it("is_retrace_day accepts boolean or string", () => {
    assert.equal(normalizeLtfBiasRecord({ is_retrace_day: true }).is_retrace_day, true);
    assert.equal(normalizeLtfBiasRecord({ is_retrace_day: "true" }).is_retrace_day, true);
    assert.equal(normalizeLtfBiasRecord({ is_retrace_day: false }).is_retrace_day, false);
    assert.equal(normalizeLtfBiasRecord({}).is_retrace_day, false);
  });

  it("missing bias → null (so the readiness check still blocks honestly)", () => {
    assert.equal(normalizeLtfBiasRecord({ htf_ltf_alignment: "aligned" }).bias, null);
  });

  it("garbage / non-object → empty object", () => {
    assert.deepEqual(normalizeLtfBiasRecord(null), {});
    assert.deepEqual(normalizeLtfBiasRecord(undefined), {});
    assert.deepEqual(normalizeLtfBiasRecord("nope"), {});
  });
});

describe("isFinalizedLtfBiasRecord", () => {
  it("a STAND-ASIDE finalized record (bias null, but grade_cap + entry_model_priority set) is usable — the June 16 bug: this was discarded for the lossy .md", () => {
    const c = normalizeLtfBiasRecord({
      session: "ny-am", ltf_bias: null, htf_ltf_alignment: "unclear",
      entry_model_priority: "undecided", grade_cap: "B", source: "deterministic-finalizer",
    });
    assert.equal(c.bias, null);
    assert.equal(isFinalizedLtfBiasRecord(c), true);
  });

  it("a directional record is usable", () => {
    assert.equal(isFinalizedLtfBiasRecord(normalizeLtfBiasRecord({ ltf_bias: "bullish", grade_cap: "A+" })), true);
  });

  it("a stub with only alignment is NOT finalized (fall back to .md)", () => {
    assert.equal(isFinalizedLtfBiasRecord(normalizeLtfBiasRecord({ htf_ltf_alignment: "aligned" })), false);
  });

  it("empty / garbage → not finalized", () => {
    assert.equal(isFinalizedLtfBiasRecord(normalizeLtfBiasRecord({})), false);
    assert.equal(isFinalizedLtfBiasRecord({}), false);
    assert.equal(isFinalizedLtfBiasRecord(null), false);
  });
});
