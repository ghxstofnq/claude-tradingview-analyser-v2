// keymap.test — global key precedence + typing guard (Command Shell PR1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveKey } from "../../app/renderer/src/shell/keymap.helpers.js";

const ev = (key, o = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, repeat: false, typing: false, ...o });

test("meta chords fire even while typing", () => {
  assert.deepEqual(resolveKey(ev("k", { metaKey: true, typing: true }), {}), { type: "toggle-palette" });
  assert.deepEqual(resolveKey(ev("j", { metaKey: true, typing: true }), {}), { type: "toggle-agent" });
  assert.deepEqual(resolveKey(ev("F", { metaKey: true, shiftKey: true, typing: true }), {}), { type: "open-flatten" });
  assert.deepEqual(resolveKey(ev("3", { metaKey: true, typing: true }), {}), { type: "open-page", page: "review" });
  // ctrl works as the meta on non-mac
  assert.deepEqual(resolveKey(ev("k", { ctrlKey: true }), {}), { type: "toggle-palette" });
});

test("Escape always resolves to back", () => {
  assert.deepEqual(resolveKey(ev("Escape"), { paletteOpen: true }), { type: "back" });
  assert.deepEqual(resolveKey(ev("Escape"), { page: "live" }), { type: "back" });
});

test("bare / and 1-7 only when not typing and no overlay", () => {
  assert.deepEqual(resolveKey(ev("/"), {}), { type: "open-palette" });
  assert.deepEqual(resolveKey(ev("1"), {}), { type: "open-page", page: "briefing" });
  assert.deepEqual(resolveKey(ev("7"), {}), { type: "open-page", page: "system" });
  assert.equal(resolveKey(ev("/", { typing: true }), {}), null);
  assert.equal(resolveKey(ev("2", { typing: true }), {}), null);
  // an open page may still be switched with bare numbers
  assert.deepEqual(resolveKey(ev("2"), { page: "briefing" }), { type: "open-page", page: "live" });
});

test("palette-open branch: arrows / tab / enter, bare keys suppressed", () => {
  const s = { paletteOpen: true };
  assert.deepEqual(resolveKey(ev("ArrowDown"), s), { type: "sel", delta: 1 });
  assert.deepEqual(resolveKey(ev("ArrowUp"), s), { type: "sel", delta: -1 });
  assert.deepEqual(resolveKey(ev("Tab"), s), { type: "force-ask" });
  assert.deepEqual(resolveKey(ev("Enter"), s), { type: "palette-enter" });
  assert.equal(resolveKey(ev("1"), s), null);
  assert.equal(resolveKey(ev("/"), s), null);
});

test("flatten-open branch: Enter starts the hold, repeats ignored", () => {
  const s = { flattenOpen: true };
  assert.deepEqual(resolveKey(ev("Enter"), s), { type: "flatten-hold-start" });
  assert.equal(resolveKey(ev("Enter", { repeat: true }), s), null);
  assert.equal(resolveKey(ev("1"), s), null);
});
