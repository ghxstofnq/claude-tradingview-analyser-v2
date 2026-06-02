// metrics.js — record, rotation, retention.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const METRICS_FILE = path.join(REPO_ROOT, "state", "metrics.jsonl");
const METRICS_DIR = path.dirname(METRICS_FILE);

// Each test cleans up after itself. record() writes to the real
// state/metrics.jsonl; we snapshot + restore.
let _snapshot = null;
let _rotatedFiles = new Map();

async function snapshot() {
  try { _snapshot = await fs.readFile(METRICS_FILE, "utf8"); }
  catch { _snapshot = null; }
  // Track existing rotated files and their content so tests can append to an
  // existing date file without polluting the user's metrics history.
  _rotatedFiles = new Map();
  try {
    const entries = await fs.readdir(METRICS_DIR);
    for (const e of entries.filter((name) => /^metrics-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))) {
      try { _rotatedFiles.set(e, await fs.readFile(path.join(METRICS_DIR, e), "utf8")); }
      catch { _rotatedFiles.set(e, null); }
    }
  } catch {}
}
async function restore() {
  if (_snapshot != null) await fs.writeFile(METRICS_FILE, _snapshot, "utf8");
  else { try { await fs.unlink(METRICS_FILE); } catch {} }
  try {
    const entries = await fs.readdir(METRICS_DIR);
    for (const e of entries) {
      if (!/^metrics-\d{4}-\d{2}-\d{2}\.jsonl$/.test(e)) continue;
      if (!_rotatedFiles.has(e)) {
        try { await fs.unlink(path.join(METRICS_DIR, e)); } catch {}
      }
    }
    for (const [e, content] of _rotatedFiles.entries()) {
      if (content != null) await fs.writeFile(path.join(METRICS_DIR, e), content, "utf8");
    }
  } catch {}
}

describe("metrics — record", () => {
  before(snapshot);
  after(restore);

  it("appends a json line to metrics.jsonl", async () => {
    // Start from a known state.
    try { await fs.unlink(METRICS_FILE); } catch {}
    const { record } = await import("../app/main/metrics.js");
    await record({ kind: "brief", event: "succeeded", session: "ny-am", durationMs: 1234 });
    const txt = await fs.readFile(METRICS_FILE, "utf8");
    const lines = txt.trim().split("\n");
    assert.equal(lines.length, 1);
    const row = JSON.parse(lines[0]);
    assert.equal(row.kind, "brief");
    assert.equal(row.event, "succeeded");
    assert.equal(row.session, "ny-am");
    assert.equal(row.durationMs, 1234);
    assert.ok(row.ts, "expected ts to be set");
  });

  it("no-ops on missing kind / event", async () => {
    try { await fs.unlink(METRICS_FILE); } catch {}
    const { record } = await import("../app/main/metrics.js");
    await record({ kind: "brief" });             // missing event
    await record({ event: "succeeded" });         // missing kind
    await record({});                              // both missing
    try {
      const txt = await fs.readFile(METRICS_FILE, "utf8");
      assert.equal(txt.trim(), "");
    } catch {
      // no file created — also acceptable
    }
  });

  it("carries optional run_id through to disk (backtest tagging)", async () => {
    try { await fs.unlink(METRICS_FILE); } catch {}
    const { record } = await import("../app/main/metrics.js");
    await record({
      kind: "bar-close", event: "succeeded", session: "ny-am",
      durationMs: 1234, run_id: "20260528-103047-am-2026-05-20",
    });
    const txt = await fs.readFile(METRICS_FILE, "utf8");
    const row = JSON.parse(txt.trim().split("\n").pop());
    assert.equal(row.run_id, "20260528-103047-am-2026-05-20");
  });

  it("omits run_id when not provided (existing rows unaffected)", async () => {
    try { await fs.unlink(METRICS_FILE); } catch {}
    const { record } = await import("../app/main/metrics.js");
    await record({ kind: "brief", event: "succeeded", session: "ny-am", durationMs: 1234 });
    const txt = await fs.readFile(METRICS_FILE, "utf8");
    const row = JSON.parse(txt.trim().split("\n").pop());
    assert.equal("run_id" in row, false);
  });
});

describe("metrics — rotateMetricsFile", () => {
  before(snapshot);
  after(restore);

  it("rotates a file with mtime from a prior day", async () => {
    // Seed metrics.jsonl with content, then backdate its mtime by 2 days.
    // Use a unique marker because the target rotated date may already exist
    // in a developer workspace; rotation should append to that file.
    const marker = `rotation-test-${Date.now()}-${Math.random()}`;
    const seed = JSON.stringify({ ts: "2026-05-22T13:00:00Z", kind: "brief", event: "succeeded", marker }) + "\n";
    await fs.writeFile(METRICS_FILE, seed, "utf8");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await fs.utimes(METRICS_FILE, twoDaysAgo, twoDaysAgo);
    const { rotateMetricsFile } = await import("../app/main/metrics.js");
    await rotateMetricsFile();
    // Rotated file should contain the old content; metrics.jsonl gone.
    let metricsExists = false;
    try { await fs.access(METRICS_FILE); metricsExists = true; } catch {}
    assert.equal(metricsExists, false, "metrics.jsonl should be rotated away");
    const entries = await fs.readdir(METRICS_DIR);
    const rotatedEntries = entries.filter((e) => /^metrics-\d{4}-\d{2}-\d{2}\.jsonl$/.test(e));
    const rotatedContents = await Promise.all(rotatedEntries.map((e) => fs.readFile(path.join(METRICS_DIR, e), "utf8")));
    assert.ok(rotatedContents.some((txt) => txt.includes(marker)), "rotated metrics should contain the old content");
  });

  it("leaves today's file alone", async () => {
    // Write a fresh file (mtime = now). rotateMetricsFile should not touch it.
    await fs.writeFile(METRICS_FILE, JSON.stringify({ ts: new Date().toISOString(), kind: "chat", event: "started" }) + "\n", "utf8");
    const { rotateMetricsFile } = await import("../app/main/metrics.js");
    await rotateMetricsFile();
    const txt = await fs.readFile(METRICS_FILE, "utf8");
    assert.ok(txt.includes('"kind":"chat"'), "today's file should be preserved");
  });
});
