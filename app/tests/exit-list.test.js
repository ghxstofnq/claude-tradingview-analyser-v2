import { test } from "node:test";
import assert from "node:assert/strict";

import { reconcileExitList } from "../renderer/src/shell/exitList.helpers.js";

// reconcileExitList is the pure core of the motion-v1 exit transitions (page
// router + toast stack): given what is rendered now and what should be live, it
// decides which entries stay live, which start closing, and which mount fresh.

test("a brand-new desired key mounts live and is appended", () => {
  const next = reconcileExitList([], [{ key: "briefing" }]);
  assert.deepEqual(next, [{ key: "briefing", closing: false, item: { key: "briefing" } }]);
});

test("a still-desired key stays live and refreshes its payload", () => {
  const prev = [{ key: "t1", closing: false, item: { key: "t1", msg: "old" } }];
  const next = reconcileExitList(prev, [{ key: "t1", msg: "new" }]);
  assert.equal(next.length, 1);
  assert.equal(next[0].closing, false);
  assert.equal(next[0].item.msg, "new");
});

test("a dropped key is marked closing and keeps its last payload", () => {
  const prev = [{ key: "t1", closing: false, item: { key: "t1", msg: "bye" } }];
  const next = reconcileExitList(prev, []);
  assert.equal(next.length, 1);
  assert.equal(next[0].closing, true);
  assert.equal(next[0].item.msg, "bye"); // payload preserved for the exit render
});

test("a re-appearing key is un-closed (fast re-open cancels the exit)", () => {
  const prev = [{ key: "live", closing: true, item: { key: "live" } }];
  const next = reconcileExitList(prev, [{ key: "live" }]);
  assert.equal(next[0].closing, false);
});

test("page→page switch: outgoing closes, incoming appended live (overlap for cross-fade)", () => {
  const prev = [{ key: "briefing", closing: false, item: { key: "briefing" } }];
  const next = reconcileExitList(prev, [{ key: "live" }]);
  assert.equal(next.length, 2);
  assert.deepEqual(next.map((e) => [e.key, e.closing]), [["briefing", true], ["live", false]]);
});

test("order is preserved and closing entries are not duplicated across reconciles", () => {
  let s = reconcileExitList([], [{ key: "a" }]);
  s = reconcileExitList(s, [{ key: "a" }, { key: "b" }]); // b opens over a
  s = reconcileExitList(s, [{ key: "b" }]);               // a closes
  assert.deepEqual(s.map((e) => [e.key, e.closing]), [["a", true], ["b", false]]);
});

test("multiple live keys all drop to closing when desired empties", () => {
  const prev = [
    { key: 1, closing: false, item: { key: 1 } },
    { key: 2, closing: false, item: { key: 2 } },
  ];
  const next = reconcileExitList(prev, []);
  assert.deepEqual(next.map((e) => e.closing), [true, true]);
});
