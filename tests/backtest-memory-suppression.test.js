// tests/backtest-memory-suppression.test.js
// Verifies that PersistentMemory writes (add / replace / remove) are
// suppressed while a backtest is in flight. Reads still work normally.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  PersistentMemory,
  setBacktestContext,
  clearBacktestContext,
  inBacktest,
} from "../app/main/persistent-memory.js";

function freshPM() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pmem-bt-"));
  return { tmp, pm: new PersistentMemory({ baseDir: tmp, memoryCharLimit: 2000, userCharLimit: 1500 }) };
}

test("inBacktest — defaults to false", () => {
  clearBacktestContext();
  assert.equal(inBacktest(), false);
});

test("setBacktestContext + clearBacktestContext — toggles the flag", () => {
  setBacktestContext({ runId: "20260528-103047-am-2026-05-20" });
  assert.equal(inBacktest(), true);
  clearBacktestContext();
  assert.equal(inBacktest(), false);
});

test("add — works normally outside backtest", async () => {
  clearBacktestContext();
  const { pm, tmp } = freshPM();
  await pm.load();
  const result = await pm.add("memory", "lesson A");
  assert.equal(result.success, true);
  const memPath = path.join(tmp, "MEMORY.md");
  assert.ok(fs.readFileSync(memPath, "utf8").includes("lesson A"));
});

test("add — suppressed during backtest context (no disk write, returns {suppressed:true})", async () => {
  setBacktestContext({ runId: "20260528-103047-am-2026-05-20" });
  const { pm, tmp } = freshPM();
  await pm.load();
  const result = await pm.add("memory", "lesson B");
  assert.equal(result.success, true, "still reports success so the LLM isn't confused");
  assert.equal(result.suppressed, true);
  assert.equal(result.run_id, "20260528-103047-am-2026-05-20");
  const memPath = path.join(tmp, "MEMORY.md");
  assert.equal(fs.existsSync(memPath), false, "no MEMORY.md written");
  clearBacktestContext();
});

test("replace — suppressed during backtest context", async () => {
  // First add an entry outside backtest so there's something to replace
  clearBacktestContext();
  const { pm } = freshPM();
  await pm.load();
  await pm.add("memory", "old text");
  // Now enter backtest and try to replace
  setBacktestContext({ runId: "rid-1" });
  const result = await pm.replace("memory", "old text", "new text");
  assert.equal(result.suppressed, true);
  clearBacktestContext();
  // Reload and verify the original is still there
  await pm.load();
  assert.equal(pm.memoryEntries.includes("old text"), true, "entry untouched on disk");
  assert.equal(pm.memoryEntries.includes("new text"), false);
});

test("remove — suppressed during backtest context", async () => {
  clearBacktestContext();
  const { pm } = freshPM();
  await pm.load();
  await pm.add("memory", "keep me");
  setBacktestContext({ runId: "rid-1" });
  const result = await pm.remove("memory", "keep me");
  assert.equal(result.suppressed, true);
  clearBacktestContext();
  await pm.load();
  assert.equal(pm.memoryEntries.includes("keep me"), true, "entry still on disk");
});

test("reads are NOT suppressed — formatForSystemPrompt still works during backtest", async () => {
  clearBacktestContext();
  const { pm } = freshPM();
  await pm.load();
  await pm.add("memory", "still readable");
  await pm.load(); // refresh snapshot
  setBacktestContext({ runId: "rid-1" });
  const block = pm.formatForSystemPrompt("memory");
  assert.ok(block && block.includes("still readable"));
  clearBacktestContext();
});
