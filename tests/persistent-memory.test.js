import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PersistentMemory,
  getPersistentMemory,
  _resetSingletonForTests,
} from "../app/main/persistent-memory.js";

async function makeTempStore({ memoryCharLimit, userCharLimit } = {}) {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "persistent-memory-test-"));
  const mem = new PersistentMemory({
    baseDir,
    memoryCharLimit: memoryCharLimit ?? 2000,
    userCharLimit: userCharLimit ?? 1500,
  });
  await mem.load();
  return { mem, baseDir };
}

async function rmDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

test("load on fresh dir yields empty store and null snapshot blocks", async () => {
  const { mem, baseDir } = await makeTempStore();
  try {
    assert.deepEqual(mem.memoryEntries, []);
    assert.deepEqual(mem.userEntries, []);
    assert.equal(mem.formatForSystemPrompt("memory"), null);
    assert.equal(mem.formatForSystemPrompt("user"), null);
    assert.equal(mem.formatBlockForSystemPrompt(), "");
  } finally {
    await rmDir(baseDir);
  }
});

test("add appends entry and increments usage", async () => {
  const { mem, baseDir } = await makeTempStore();
  try {
    const res = await mem.add("user", "Trader prefers concise responses");
    assert.equal(res.success, true);
    assert.equal(res.entry_count, 1);
    assert.equal(res.entries.length, 1);
    assert.match(res.usage, /\d+% — \d+\/[\d,]+ chars/);
    // Verify file written
    const raw = await fs.readFile(path.join(baseDir, "USER.md"), "utf8");
    assert.equal(raw, "Trader prefers concise responses");
  } finally {
    await rmDir(baseDir);
  }
});

test("add refuses duplicate entries", async () => {
  const { mem, baseDir } = await makeTempStore();
  try {
    await mem.add("memory", "PCE-day price action is whippy on MNQ");
    const res = await mem.add("memory", "PCE-day price action is whippy on MNQ");
    assert.equal(res.success, true); // success but with no-duplicate message
    assert.match(res.message, /already exists|no duplicate added/);
    assert.equal(res.entry_count, 1);
  } finally {
    await rmDir(baseDir);
  }
});

test("add refuses on cap overflow with structured error", async () => {
  const { mem, baseDir } = await makeTempStore({ memoryCharLimit: 50 });
  try {
    await mem.add("memory", "x".repeat(40));
    const res = await mem.add("memory", "y".repeat(40));
    assert.equal(res.success, false);
    assert.match(res.error, /at [\d,]+\/[\d,]+ chars/);
    assert.match(res.error, /replace or remove/);
    assert.ok(Array.isArray(res.current_entries));
    assert.ok(res.usage);
  } finally {
    await rmDir(baseDir);
  }
});

test("replace finds entry by substring and updates it", async () => {
  const { mem, baseDir } = await makeTempStore();
  try {
    await mem.add("user", "Trader uses structural stops below the FVG low");
    const res = await mem.replace(
      "user",
      "structural stops",
      "Trader uses structural stops below FVG low or sweep low",
    );
    assert.equal(res.success, true);
    assert.equal(res.entry_count, 1);
    assert.match(res.entries[0], /sweep low/);
    // Disk reflects the change
    const raw = await fs.readFile(path.join(baseDir, "USER.md"), "utf8");
    assert.match(raw, /sweep low/);
  } finally {
    await rmDir(baseDir);
  }
});

test("replace refuses on ambiguous substring match", async () => {
  const { mem, baseDir } = await makeTempStore();
  try {
    await mem.add("memory", "MES displacement is weaker than MNQ on average");
    await mem.add("memory", "MES candle bodies are tight during NY-PM lulls");
    const res = await mem.replace("memory", "MES", "Updated note about MES");
    assert.equal(res.success, false);
    assert.match(res.error, /multiple entries matched/);
    assert.ok(Array.isArray(res.matches));
    assert.equal(res.matches.length, 2);
  } finally {
    await rmDir(baseDir);
  }
});

test("remove deletes an entry by substring", async () => {
  const { mem, baseDir } = await makeTempStore();
  try {
    await mem.add("user", "Trader skips Mondays during FOMC weeks");
    await mem.add("user", "Trader sizes 0.75R on Friday afternoons");
    const res = await mem.remove("user", "FOMC");
    assert.equal(res.success, true);
    assert.equal(res.entry_count, 1);
    assert.match(res.entries[0], /0\.75R/);
  } finally {
    await rmDir(baseDir);
  }
});

test("remove fails when no entry matches", async () => {
  const { mem, baseDir } = await makeTempStore();
  try {
    await mem.add("memory", "Real entry");
    const res = await mem.remove("memory", "nonexistent text");
    assert.equal(res.success, false);
    assert.match(res.error, /no entry matched/);
  } finally {
    await rmDir(baseDir);
  }
});

test("formatForSystemPrompt returns frozen snapshot with usage indicator", async () => {
  const { mem, baseDir } = await makeTempStore({ memoryCharLimit: 100 });
  try {
    await mem.add("memory", "First lesson");
    // Reload to capture snapshot of current state
    await mem.load();
    const block = mem.formatForSystemPrompt("memory");
    assert.ok(block);
    assert.match(block, /MEMORY \(cross-day notes\) \[\d+% — \d+\/100 chars\]/);
    assert.match(block, /First lesson/);
  } finally {
    await rmDir(baseDir);
  }
});

test("formatForSystemPrompt snapshot is frozen between load() calls", async () => {
  const { mem, baseDir } = await makeTempStore();
  try {
    await mem.add("user", "Original entry");
    await mem.load(); // capture snapshot
    const blockBefore = mem.formatForSystemPrompt("user");
    // Add a new entry; snapshot should NOT change.
    await mem.add("user", "New entry written mid-turn");
    const blockAfterWrite = mem.formatForSystemPrompt("user");
    assert.equal(
      blockBefore,
      blockAfterWrite,
      "snapshot must stay frozen until next load()",
    );
    // After explicit reload, the snapshot reflects the new state.
    await mem.load();
    const blockAfterReload = mem.formatForSystemPrompt("user");
    assert.notEqual(blockBefore, blockAfterReload);
    assert.match(blockAfterReload, /New entry/);
  } finally {
    await rmDir(baseDir);
  }
});

test("formatBlockForSystemPrompt wraps both blocks with fence and system note", async () => {
  const { mem, baseDir } = await makeTempStore();
  try {
    await mem.add("user", "Trader trades MNQ + MES");
    await mem.add("memory", "Asia chops between 21:00-22:30 ET on Sundays");
    await mem.load();
    const block = mem.formatBlockForSystemPrompt();
    assert.match(block, /^<persistent_memory>/);
    assert.match(block, /<\/persistent_memory>$/);
    assert.match(block, /\[System note:/);
    assert.match(block, /USER PROFILE/);
    assert.match(block, /MEMORY \(cross-day notes\)/);
    assert.match(block, /MNQ \+ MES/);
    assert.match(block, /Asia chops/);
  } finally {
    await rmDir(baseDir);
  }
});

test("formatBlockForSystemPrompt returns empty string when both stores are empty", async () => {
  const { mem, baseDir } = await makeTempStore();
  try {
    assert.equal(mem.formatBlockForSystemPrompt(), "");
  } finally {
    await rmDir(baseDir);
  }
});

test("external drift: oversized single entry triggers backup and refusal", async () => {
  const { mem, baseDir } = await makeTempStore({ memoryCharLimit: 100 });
  try {
    // Write a file with one massive entry (exceeds cap, no § delimiter).
    const memPath = path.join(baseDir, "MEMORY.md");
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(memPath, "x".repeat(500), "utf8");

    const res = await mem.add("memory", "tiny new entry");
    assert.equal(res.success, false);
    assert.match(res.error, /wouldn't round-trip|drift/i);
    assert.ok(res.drift_backup);

    // Backup file should exist with original content
    const bakRaw = await fs.readFile(res.drift_backup, "utf8");
    assert.equal(bakRaw, "x".repeat(500));

    // Original file should still be there (unchanged)
    const origRaw = await fs.readFile(memPath, "utf8");
    assert.equal(origRaw, "x".repeat(500));
  } finally {
    await rmDir(baseDir);
  }
});

test("external drift NOT triggered when on-disk file is tool-shaped", async () => {
  const { mem, baseDir } = await makeTempStore({ memoryCharLimit: 1000 });
  try {
    // Pre-seed a tool-shaped file by going through add() the normal way
    await mem.add("memory", "First lesson");
    await mem.add("memory", "Second lesson");
    // External actor adds a third entry the right way (parser-compatible).
    const memPath = path.join(baseDir, "MEMORY.md");
    const existing = await fs.readFile(memPath, "utf8");
    await fs.writeFile(memPath, existing + "\n§\nThird lesson", "utf8");

    // A subsequent tool write should succeed (no drift detected — the
    // on-disk file round-trips through our parser).
    const res = await mem.add("memory", "Fourth lesson");
    assert.equal(res.success, true);
    assert.equal(res.entry_count, 4);
  } finally {
    await rmDir(baseDir);
  }
});

test("atomic write: no .tmp file remains after a successful add", async () => {
  const { mem, baseDir } = await makeTempStore();
  try {
    await mem.add("memory", "Atomic write check");
    const files = await fs.readdir(baseDir);
    assert.ok(files.includes("MEMORY.md"));
    assert.ok(!files.some((f) => f.endsWith(".tmp")), "no .tmp leftover");
  } finally {
    await rmDir(baseDir);
  }
});

test("invalid target rejects cleanly", async () => {
  const { mem, baseDir } = await makeTempStore();
  try {
    const res = await mem.add("invalid", "content");
    assert.equal(res.success, false);
    assert.match(res.error, /invalid target/);
  } finally {
    await rmDir(baseDir);
  }
});

test("getPersistentMemory returns a singleton", async () => {
  _resetSingletonForTests();
  const a = getPersistentMemory();
  const b = getPersistentMemory();
  assert.equal(a, b);
  _resetSingletonForTests();
});
