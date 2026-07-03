// shell-keys.test — webview → shell chord filter (PR3 keyboard forwarder).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shellChordFromInput } from "../../app/main/shell-keys.js";

const down = (o) => ({ type: "keyDown", key: "", meta: false, control: false, shift: false, alt: false, isAutoRepeat: false, ...o });

test("forwards the global chord set on keyDown", () => {
  assert.ok(shellChordFromInput(down({ key: "k", meta: true })));   // ⌘K
  assert.ok(shellChordFromInput(down({ key: "j", control: true }))); // Ctrl+J
  assert.ok(shellChordFromInput(down({ key: "f", meta: true, shift: true }))); // ⇧⌘F
  assert.ok(shellChordFromInput(down({ key: "3", meta: true })));    // ⌘3
  assert.ok(shellChordFromInput(down({ key: "Escape" })));          // Esc (no meta)
});

test("does not forward ordinary typing or non-chord keys", () => {
  assert.equal(shellChordFromInput(down({ key: "k" })), null);          // k without meta
  assert.equal(shellChordFromInput(down({ key: "a", meta: true })), null); // ⌘A (not a chord)
  assert.equal(shellChordFromInput(down({ key: "8", meta: true })), null); // ⌘8 out of range
  assert.equal(shellChordFromInput(down({ key: "f", meta: true })), null); // ⌘F without shift
  assert.equal(shellChordFromInput(down({ key: "1" })), null);             // bare 1 (typing)
});

test("ignores keyUp and malformed input", () => {
  assert.equal(shellChordFromInput({ type: "keyUp", key: "k", meta: true }), null);
  assert.equal(shellChordFromInput(null), null);
  assert.equal(shellChordFromInput({}), null);
});

test("preserves modifier flags in the forwarded chord", () => {
  const c = shellChordFromInput(down({ key: "f", meta: true, shift: true, alt: true, isAutoRepeat: true }));
  assert.deepEqual(c, { key: "f", meta: true, control: false, shift: true, alt: true, repeat: true });
});
