// command-shell-a11y-contract.test — locks the keyboard/a11y contract (Task D2)
// under `node --test`: the pure a11y helpers (clickable / tab / focusTrapTarget)
// and a source-grep contract that the segmented controls carry tablist/tab
// semantics and the raw-onClick FLATTEN control was made keyboard-operable. The
// live focus-trap + tablist behaviour is exercised end-to-end by the Playwright
// harness's keyboard scenario (design-harness/command-shell-smoke.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clickable, tab, focusTrapTarget, FOCUSABLE_SELECTOR } from "../app/renderer/src/a11y.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel) => readFileSync(path.join(repoRoot, "app/renderer/src", rel), "utf8");

// ── clickable ─────────────────────────────────────────────────────────────────
test("clickable gives button semantics + Enter/Space activation", () => {
  let fired = 0;
  const props = clickable(() => { fired += 1; }, { label: "flatten" });
  assert.equal(props.role, "button");
  assert.equal(props.tabIndex, 0);
  assert.equal(props["aria-label"], "flatten");
  for (const key of ["Enter", " ", "Spacebar"]) {
    let prevented = false;
    props.onKeyDown({ key, preventDefault: () => { prevented = true; } });
    assert.ok(prevented, `${key} should preventDefault`);
  }
  assert.equal(fired, 3);
  props.onKeyDown({ key: "a", preventDefault: () => { throw new Error("must not fire on letter keys"); } });
  assert.equal(fired, 3);
  assert.deepEqual(clickable("not a fn"), {}); // guard
});

// ── tab ─────────────────────────────────────────────────────────────────────
test("tab exposes role=tab, aria-selected, and roving tabindex", () => {
  const on = tab(() => {}, { selected: true, label: "FEED" });
  assert.equal(on.role, "tab");
  assert.equal(on["aria-selected"], "true");
  assert.equal(on.tabIndex, 0);
  assert.equal(on["aria-label"], "FEED");
  const off = tab(() => {}, { selected: false });
  assert.equal(off["aria-selected"], "false");
  assert.equal(off.tabIndex, -1);      // not in the Tab order until selected
});

test("tab activates on Enter/Space and moves to the sibling tab on Arrow keys", () => {
  let selected = 0;
  const props = tab(() => { selected += 1; }, { selected: true });
  props.onKeyDown({ key: "Enter", preventDefault() {}, currentTarget: {} });
  assert.equal(selected, 1);

  // ArrowRight → focus + click the next role=tab sibling.
  let focused = false; let clicked = false;
  const sibling = { getAttribute: (a) => (a === "role" ? "tab" : null), focus: () => { focused = true; }, click: () => { clicked = true; } };
  props.onKeyDown({ key: "ArrowRight", preventDefault() {}, currentTarget: { nextElementSibling: sibling } });
  assert.ok(focused && clicked, "ArrowRight should focus+activate the next tab");

  // A non-tab sibling is ignored (no throw).
  const nonTab = { getAttribute: () => "button", focus() { throw new Error("no"); }, click() { throw new Error("no"); } };
  props.onKeyDown({ key: "ArrowLeft", preventDefault() {}, currentTarget: { previousElementSibling: nonTab } });
});

// ── focusTrapTarget ─────────────────────────────────────────────────────────
test("focusTrapTarget wraps at the edges and pulls escaped focus back in", () => {
  assert.equal(focusTrapTarget({ count: 3, activeIndex: -1, shiftKey: false }), 0);  // escaped → first
  assert.equal(focusTrapTarget({ count: 3, activeIndex: -1, shiftKey: true }), 2);   // escaped, shift → last
  assert.equal(focusTrapTarget({ count: 3, activeIndex: 2, shiftKey: false }), 0);   // last, Tab → wrap first
  assert.equal(focusTrapTarget({ count: 3, activeIndex: 0, shiftKey: true }), 2);    // first, Shift+Tab → wrap last
  assert.equal(focusTrapTarget({ count: 3, activeIndex: 1, shiftKey: false }), null); // middle → native
  assert.equal(focusTrapTarget({ count: 0, activeIndex: -1 }), null);                 // nothing focusable
  assert.ok(FOCUSABLE_SELECTOR.includes('[role="tab"]'));
});

// ── source-grep contract: the segmented controls are tablists ─────────────────
test("segmented controls carry role=tablist + tab() semantics", () => {
  const live = src("shell/pages/LivePage.jsx");
  assert.match(live, /role="tablist"[^>]*aria-label="live view"/);
  assert.match(live, /\.\.\.tab\(/);                  // FEED/POSITIONS use tab()
  assert.match(live, /clickable\(onFlatten, \{ label:/); // FLATTEN is keyboard-operable

  const review = src("shell/pages/ReviewPage.jsx");
  assert.match(review, /role="tablist"[^>]*aria-label="review domain"/);
  assert.match(review, /\.\.\.tab\(/);

  const settings = src("shell/pages/SettingsPage.jsx");
  assert.match(settings, /role="tablist"[^>]*aria-label="automation mode"/);
  assert.match(settings, /\.\.\.tab\(/);
});

test("Page + Palette wire the focus trap and dialog semantics", () => {
  const page = src("shell/pages/Page.jsx");
  assert.match(page, /useFocusTrap/);
  assert.match(page, /role="dialog"/);
  const palette = src("shell/Palette.jsx");
  assert.match(palette, /useFocusTrap/);
  assert.match(palette, /role="dialog"/);
});

test("app.css keeps a visible :focus-visible ring using a DESIGN.md token", () => {
  const css = src("app.css");
  assert.match(css, /:focus-visible\s*\{\s*outline:\s*2px solid var\(--primary\)/);
  assert.match(css, /\[role="tab"\]:focus-visible/);
});
