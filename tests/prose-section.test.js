// Unit tests for the shared Markdown-section slicer (app/main/prose-section.js).
// Proves the CRITIQUE (#239) and COACH (Track 2 §2b item 2) markers slice
// identically from the same helper — the "reuse, don't duplicate" contract.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractMarkedSection } from "../app/main/prose-section.js";

describe("extractMarkedSection", () => {
  test("returns only the text under the final H2 marker", () => {
    const prose = "memory reasoning here.\nNothing to save.\n\n## COACH\n\nEquity is grinding up.\nKeep the discipline.";
    assert.equal(
      extractMarkedSection(prose, "COACH"),
      "Equity is grinding up.\nKeep the discipline."
    );
  });

  test("same helper slices the CRITIQUE marker (parity with #239)", () => {
    const prose = "pre stuff\n\n## CRITIQUE\n\nClean MSS discipline.";
    assert.equal(extractMarkedSection(prose, "CRITIQUE"), "Clean MSS discipline.");
  });

  test("no marker → null", () => {
    assert.equal(extractMarkedSection("just some prose, no heading", "COACH"), null);
    assert.equal(extractMarkedSection("", "COACH"), null);
    assert.equal(extractMarkedSection(null, "COACH"), null);
    assert.equal(extractMarkedSection(undefined, "COACH"), null);
  });

  test("empty / missing marker arg → null (never throws)", () => {
    assert.equal(extractMarkedSection("## COACH\n\nbody", ""), null);
    assert.equal(extractMarkedSection("## COACH\n\nbody", null), null);
    assert.equal(extractMarkedSection("## COACH\n\nbody", "   "), null);
  });

  test("inline mention on one line does NOT trigger (line-anchored)", () => {
    assert.equal(extractMarkedSection("I will put it under ## COACH at the end.", "COACH"), null);
    assert.equal(extractMarkedSection("prefix ## COACH trailing on one line", "COACH"), null);
  });

  test("last occurrence wins — an earlier heading is ignored", () => {
    const prose = "## COACH\n\nfirst draft, discard me.\n\n## COACH\n\nfinal read.";
    assert.equal(extractMarkedSection(prose, "COACH"), "final read.");
  });

  test("heading with only whitespace body → null", () => {
    assert.equal(extractMarkedSection("stuff\n\n## COACH\n\n   ", "COACH"), null);
  });

  test("tolerates leading indentation and trailing spaces on the heading line", () => {
    const prose = "x\n\n  ##   COACH   \nread body here";
    assert.equal(extractMarkedSection(prose, "COACH"), "read body here");
  });

  test("a marker with regex metacharacters is matched literally", () => {
    const prose = "x\n\n## A.B\n\nliteral dot section";
    assert.equal(extractMarkedSection(prose, "A.B"), "literal dot section");
    // The '.' must NOT act as a regex wildcard — 'AxB' heading must not match.
    assert.equal(extractMarkedSection("x\n\n## AxB\n\nnope", "A.B"), null);
  });
});
