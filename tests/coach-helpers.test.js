// Unit tests for the coach card view-model (app/renderer/src/Review.helpers.js
// coachViewModel). Proves it parses the coach.md frontmatter + paragraphs and,
// critically, that an injected <script> survives ONLY as a plain-text token —
// the card renders each paragraph as a React text node, so the string never
// becomes live markup.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { coachViewModel, coachStoredHash, critiqueMetaLabel } from "../app/renderer/src/Review.helpers.js";

const withHash = (hash, body = "A read.") => `---\nts: 2026-07-10T20:00:00.000Z\nprovider: claude\ndigest_hash: ${hash}\n---\n\n${body}`;

describe("coachViewModel", () => {
  test("parses frontmatter + paragraphs", () => {
    const raw = "---\nts: 2026-07-10T20:00:00.000Z\nprovider: claude\ndigest_hash: abcd1234\n---\n\nEquity is building.\n\nKeep the discipline.";
    const vm = coachViewModel(raw);
    assert.equal(vm.provider, "claude");
    assert.equal(vm.ts, "2026-07-10T20:00:00.000Z");
    assert.deepEqual(vm.paragraphs, ["Equity is building.", "Keep the discipline."]);
  });

  test("an injected <script> is a plain-text token, never structured markup", () => {
    const raw = "---\nprovider: claude\n---\n\nInjection check: <script>alert(2)</script> stays inert.";
    const vm = coachViewModel(raw);
    // The dangerous string is preserved verbatim as text (React escapes it on
    // render) — the view-model does NO html/markdown interpretation.
    assert.equal(vm.paragraphs.length, 1);
    assert.ok(vm.paragraphs[0].includes("<script>alert(2)</script>"));
    // No structured fields fabricated from the payload.
    assert.equal(typeof vm.paragraphs[0], "string");
  });

  test("null / empty / non-string → null (no card)", () => {
    assert.equal(coachViewModel(null), null);
    assert.equal(coachViewModel(""), null);
    assert.equal(coachViewModel(undefined), null);
    assert.equal(coachViewModel(42), null);
    assert.equal(coachViewModel("---\nprovider: claude\n---\n\n   "), null);
  });

  test("frontmatter-less prose still parses to paragraphs", () => {
    const vm = coachViewModel("just a plain read with no frontmatter");
    assert.deepEqual(vm.paragraphs, ["just a plain read with no frontmatter"]);
    assert.equal(vm.provider, null);
  });

  test("critiqueMetaLabel renders provider · time for the coach card", () => {
    const label = critiqueMetaLabel({ provider: "claude", ts: "2026-07-10T20:00:00.000Z" });
    assert.match(label, /CLAUDE/);
  });
});

describe("coachStoredHash", () => {
  test("parses digest_hash; null when absent / no frontmatter / non-string", () => {
    assert.equal(coachStoredHash(withHash("abcd1234")), "abcd1234");
    assert.equal(coachStoredHash("---\nprovider: claude\n---\n\nbody"), null);
    assert.equal(coachStoredHash("no frontmatter"), null);
    assert.equal(coachStoredHash(null), null);
  });
});

describe("coachViewModel — staleness", () => {
  test("matching stored/current hash → NOT stale (no badge)", () => {
    const vm = coachViewModel(withHash("abcd1234"), { currentHash: "abcd1234" });
    assert.equal(vm.stored_hash, "abcd1234");
    assert.equal(vm.stale, false);
  });

  test("differing hash → stale", () => {
    const vm = coachViewModel(withHash("abcd1234"), { currentHash: "ffff0000" });
    assert.equal(vm.stale, true);
  });

  test("missing stored hash (old file) with a current hash → treated stale", () => {
    const raw = "---\nts: t\nprovider: claude\n---\n\nOld read without a hash.";
    const vm = coachViewModel(raw, { currentHash: "ffff0000" });
    assert.equal(vm.stored_hash, null);
    assert.equal(vm.stale, true);
  });

  test("no current hash to compare → never claims stale (no misleading badge)", () => {
    const vm = coachViewModel(withHash("abcd1234"), { currentHash: null });
    assert.equal(vm.stale, false);
    // default arg (no options) also → not stale
    assert.equal(coachViewModel(withHash("abcd1234")).stale, false);
  });
});
