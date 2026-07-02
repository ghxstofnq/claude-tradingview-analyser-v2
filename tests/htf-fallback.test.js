// Unit tests for the HTF-fallback verdict + the stand-aside gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { htfFallbackVerdict } from "../app/main/htf-fallback.js";

const base = { htfBias: "bullish", session: "ny-am", ms: 2000, windowEndMs: 1000 };

test("gate off (opt-out via =0): fires a B trade in the HTF lean, even against near-term structure", () => {
  process.env.GOFNQ_HTF_FALLBACK_STANDASIDE = "0";
  const v = htfFallbackVerdict({ ...base, h4StructDir: "bearish", h1StructDir: "bearish" });
  assert.equal(v?.ltf_bias, "bullish");          // legacy opt-out behavior (default is now stand-aside)
  assert.equal(v?.interaction, "htf_fallback");
  assert.equal(v?.grade_cap, "B");
});

test("stand-aside gate: conflicted HTF (bullish lean vs bearish 4H/1H) → no trade", () => {
  process.env.GOFNQ_HTF_FALLBACK_STANDASIDE = "1";
  // The June 24/25 shape: daily-weighted bullish lean, bearish near-term structure.
  const v = htfFallbackVerdict({ ...base, h4StructDir: "bearish", h1StructDir: "bearish" });
  assert.equal(v, null);
  delete process.env.GOFNQ_HTF_FALLBACK_STANDASIDE;
});

test("stand-aside gate: clean HTF (near-term agrees) still trades the lean", () => {
  process.env.GOFNQ_HTF_FALLBACK_STANDASIDE = "1";
  const v = htfFallbackVerdict({ ...base, h4StructDir: "bullish", h1StructDir: "bullish" });
  assert.equal(v?.ltf_bias, "bullish");
  delete process.env.GOFNQ_HTF_FALLBACK_STANDASIDE;
});

test("stand-aside gate: no near-term structure printed → lean stands (nothing to conflict)", () => {
  process.env.GOFNQ_HTF_FALLBACK_STANDASIDE = "1";
  const v = htfFallbackVerdict({ ...base, h4StructDir: null, h1StructDir: null });
  assert.equal(v?.ltf_bias, "bullish");
  delete process.env.GOFNQ_HTF_FALLBACK_STANDASIDE;
});

test("stand-aside gate: a single opposing near-term TF is enough to stand aside", () => {
  process.env.GOFNQ_HTF_FALLBACK_STANDASIDE = "1";
  const v = htfFallbackVerdict({ ...base, h4StructDir: "bullish", h1StructDir: "bearish" });
  assert.equal(v, null);
  delete process.env.GOFNQ_HTF_FALLBACK_STANDASIDE;
});
