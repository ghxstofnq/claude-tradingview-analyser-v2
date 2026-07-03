// command-list.test — ⌘K command composition + filtering (Command Shell PR1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommands, visibleRows } from "../../app/renderer/src/shell/commandList.helpers.js";

const byId = (rows, id) => rows.find((r) => r.id === id);

test("tripped guard swaps the briefing opener for the review-stop-out ask", () => {
  const ok = buildCommands({ tripped: false });
  const tripped = buildCommands({ tripped: true });
  assert.ok(byId(ok, "open:briefing"));
  assert.ok(!byId(ok, "review-trip"));
  assert.ok(byId(tripped, "review-trip"));
  assert.ok(!byId(tripped, "open:briefing"));
  assert.equal(byId(tripped, "review-trip").action.type, "ask");
});

test("position gates BE/trail and the flatten tint", () => {
  const flat = buildCommands({ hasPosition: false });
  const inPos = buildCommands({ hasPosition: true });
  assert.ok(!byId(flat, "be") && !byId(flat, "trail"));
  assert.ok(byId(inPos, "be") && byId(inPos, "trail"));
  assert.equal(byId(flat, "flatten").tint, "mute");
  assert.equal(byId(inPos, "flatten").tint, "red");
});

test("levels become arm-alert rows (max 2)", () => {
  const rows = buildCommands({ levels: [
    { name: "PDH", price: 21502.25 }, { name: "ONL", price: 21404.5 }, { name: "PWH", price: 21600 },
  ] });
  const arms = rows.filter((r) => r.id.startsWith("arm:"));
  assert.equal(arms.length, 2);
  assert.deepEqual(arms[0].action, { type: "arm", name: "PDH", price: 21502.25 });
});

test("symbol switch targets the other instrument", () => {
  assert.match(byId(buildCommands({ symbol: "MNQ1!" }), "sym").label, /MES1!/);
  assert.match(byId(buildCommands({ symbol: "MES1!" }), "sym").label, /MNQ1!/);
});

test("root view shows only root rows, capped at 8", () => {
  const all = buildCommands({ hasPosition: true, levels: [{ name: "PDH", price: 1 }] });
  const root = visibleRows(all, "");
  assert.ok(root.length <= 8);
  assert.ok(root.every((r) => r.root !== false));
});

test("verb shortcuts jump to their command", () => {
  const all = buildCommands({ hasPosition: true });
  assert.equal(visibleRows(all, "fla")[0].id, "flatten");
  assert.equal(visibleRows(all, "be")[0].id, "be");
  assert.equal(visibleRows(all, "trail")[0].id, "trail");
  assert.equal(visibleRows(all, "suggest")[0].id, "auto:suggest");
  assert.equal(visibleRows(all, "manual")[0].id, "auto:manual");
});

test("plain queries substring-filter labels", () => {
  const all = buildCommands({});
  const hits = visibleRows(all, "switch");
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((r) => r.label.toLowerCase().includes("switch")));
});

test("theme toggle is a non-root command reachable by search", () => {
  const all = buildCommands({});
  const theme = byId(all, "theme");
  assert.ok(theme && theme.root === false);
  assert.equal(theme.action.type, "theme");
  assert.ok(!visibleRows(all, "").some((r) => r.id === "theme"));
  assert.equal(visibleRows(all, "theme")[0].id, "theme");
});
