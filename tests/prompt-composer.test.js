import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findPartialReferences,
  composePhaseWithPartials,
  joinSystemPrompt,
} from "../app/main/prompt-composer.js";

// ---------- findPartialReferences ----------

test("findPartialReferences: returns names in body order", () => {
  const body = "foo\n<!-- @partial:bundle-fields -->\nbar\n<!-- @partial:ict-vocab -->\nbaz";
  assert.deepEqual(findPartialReferences(body), ["bundle-fields", "ict-vocab"]);
});

test("findPartialReferences: empty body returns []", () => {
  assert.deepEqual(findPartialReferences(""), []);
});

test("findPartialReferences: no markers returns []", () => {
  assert.deepEqual(findPartialReferences("just plain text"), []);
});

test("findPartialReferences: throws on duplicate marker in same body", () => {
  const body = "<!-- @partial:foo -->\n<!-- @partial:foo -->";
  assert.throws(() => findPartialReferences(body), /duplicate partial marker: foo/);
});

test("findPartialReferences: accepts hyphens and digits in names", () => {
  const body = "<!-- @partial:open-reaction-phase -->\n<!-- @partial:phase-1 -->";
  assert.deepEqual(findPartialReferences(body), ["open-reaction-phase", "phase-1"]);
});

test("findPartialReferences: rejects uppercase in marker", () => {
  // Uppercase falls outside the [a-z0-9-]+ whitelist — regex must NOT match.
  const body = "<!-- @partial:BundleFields -->";
  assert.deepEqual(findPartialReferences(body), []);
});

test("findPartialReferences: rejects path traversal characters", () => {
  // Slashes, dots — regex must NOT match.
  const body = "<!-- @partial:../etc/passwd -->\n<!-- @partial:foo.md -->";
  assert.deepEqual(findPartialReferences(body), []);
});

// ---------- composePhaseWithPartials ----------

test("composePhaseWithPartials: substitutes one marker", () => {
  const body = "before\n<!-- @partial:foo -->\nafter";
  const map = new Map([["foo", "FOO-CONTENT\n"]]);
  assert.equal(composePhaseWithPartials(body, map), "before\nFOO-CONTENT\nafter");
});

test("composePhaseWithPartials: strips exactly one trailing newline from partial", () => {
  // Partial files end with one newline by convention; the marker line is
  // already followed by content in the body. Stripping prevents a double
  // blank line.
  const body = "X\n<!-- @partial:foo -->\nY";
  const map = new Map([["foo", "BODY\n"]]);
  assert.equal(composePhaseWithPartials(body, map), "X\nBODY\nY");
});

test("composePhaseWithPartials: does NOT strip newline if partial has none", () => {
  const body = "X\n<!-- @partial:foo -->\nY";
  const map = new Map([["foo", "BODY"]]); // no trailing newline
  assert.equal(composePhaseWithPartials(body, map), "X\nBODY\nY");
});

test("composePhaseWithPartials: substitutes multiple markers in order", () => {
  const body = "A\n<!-- @partial:one -->\nB\n<!-- @partial:two -->\nC";
  const map = new Map([["one", "ONE\n"], ["two", "TWO\n"]]);
  assert.equal(composePhaseWithPartials(body, map), "A\nONE\nB\nTWO\nC");
});

test("composePhaseWithPartials: returns body unchanged when no markers", () => {
  const body = "no markers here";
  assert.equal(composePhaseWithPartials(body, new Map()), "no markers here");
});

test("composePhaseWithPartials: throws when referenced partial missing", () => {
  const body = "<!-- @partial:missing -->";
  assert.throws(() => composePhaseWithPartials(body, new Map()), /partial not provided: missing/);
});

test("composePhaseWithPartials: preserves multibyte UTF-8 in partial content", () => {
  const body = "<!-- @partial:foo -->";
  const map = new Map([["foo", "α β γ — em-dash\n"]]);
  assert.equal(composePhaseWithPartials(body, map), "α β γ — em-dash");
});

// ---------- joinSystemPrompt ----------

const BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";

test("joinSystemPrompt: passes a string through unchanged (idempotent)", () => {
  assert.equal(joinSystemPrompt("hello world"), "hello world");
});

test("joinSystemPrompt: joins string[] with double newline", () => {
  assert.equal(joinSystemPrompt(["A", "B", "C"]), "A\n\nB\n\nC");
});

test("joinSystemPrompt: removes the boundary marker before joining", () => {
  assert.equal(
    joinSystemPrompt(["A", "B", BOUNDARY, "C"]),
    "A\n\nB\n\nC"
  );
});

test("joinSystemPrompt: boundary in the middle vs end produces same content", () => {
  assert.equal(joinSystemPrompt(["A", BOUNDARY, "B"]), "A\n\nB");
});

test("joinSystemPrompt: empty array returns empty string", () => {
  assert.equal(joinSystemPrompt([]), "");
});

test("joinSystemPrompt: array of only boundaries returns empty string", () => {
  assert.equal(joinSystemPrompt([BOUNDARY]), "");
});

test("joinSystemPrompt: throws on null", () => {
  assert.throws(() => joinSystemPrompt(null), /expected string or string\[\]/);
});

test("joinSystemPrompt: throws on number", () => {
  assert.throws(() => joinSystemPrompt(42), /expected string or string\[\]/);
});

test("joinSystemPrompt: throws on object (non-array)", () => {
  assert.throws(() => joinSystemPrompt({foo: "bar"}), /expected string or string\[\]/);
});
