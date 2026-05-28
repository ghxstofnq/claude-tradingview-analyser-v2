// tests/backtest-store.test.js
// Unit tests for the backtest store: run-id generation, on-disk layout,
// index.json read/write, aborted-run reconciliation.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  generateRunId,
  parseRunId,
  readIndex,
  writeIndexEntry,
  reconcileAbortedRuns,
  resolveRunDir,
} from "../app/main/backtest-store.js";

test("generateRunId — shape is {YYYYMMDD-HHMMSS}-{session}-{target-date}", () => {
  const id = generateRunId({ now: new Date("2026-05-28T10:30:47Z"), session: "ny-am", date: "2026-05-20" });
  assert.equal(id, "20260528-103047-am-2026-05-20");
});

test("generateRunId — london and ny-pm get their slugs", () => {
  const t = new Date("2026-05-28T03:00:00Z");
  assert.equal(generateRunId({ now: t, session: "london", date: "2026-05-15" }), "20260528-030000-london-2026-05-15");
  assert.equal(generateRunId({ now: t, session: "ny-pm",  date: "2026-05-15" }), "20260528-030000-pm-2026-05-15");
});

test("generateRunId — unknown session throws", () => {
  assert.throws(() => generateRunId({ now: new Date(), session: "wat", date: "2026-05-20" }));
});

test("parseRunId — round-trips back to its parts", () => {
  const parts = parseRunId("20260528-103047-am-2026-05-20");
  assert.deepEqual(parts, { ts: "20260528-103047", session: "ny-am", date: "2026-05-20" });
});

test("parseRunId — invalid format throws", () => {
  assert.throws(() => parseRunId("not-a-real-id"));
});

test("readIndex — returns empty when file does not exist", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-store-"));
  const ix = readIndex({ stateDir: tmp });
  assert.deepEqual(ix, { runs: [] });
});

test("writeIndexEntry — appends and persists", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-store-"));
  const entry = {
    run_id: "20260528-103047-am-2026-05-20",
    date: "2026-05-20", session: "ny-am", mode: "auto",
    created_at: "2026-05-28T10:30:47Z", elapsed_ms: 923000,
    cost_usd: 2.14, setups: 2, wins: 2, losses: 0, no_trades: 0,
    total_r: 8.5, best_model: "MSS",
    your_agreement: { agreed: 2, disagreed: 0, ungraded: 0 },
    chain_status: "clean",
  };
  writeIndexEntry({ stateDir: tmp, entry });
  const ix = readIndex({ stateDir: tmp });
  assert.equal(ix.runs.length, 1);
  assert.equal(ix.runs[0].run_id, entry.run_id);
});

test("resolveRunDir — gives the absolute per-run+session path", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-store-"));
  const dir = resolveRunDir({ stateDir: tmp, runId: "20260528-103047-am-2026-05-20" });
  assert.equal(dir, path.join(tmp, "backtest", "20260528-103047-am-2026-05-20", "ny-am"));
});

test("reconcileAbortedRuns — flags folders without summary.json that aren't in index", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-store-"));
  // Aborted folder: exists but no summary.json + not in index.json
  fs.mkdirSync(path.join(tmp, "backtest", "20260528-101010-am-2026-05-10", "ny-am"), { recursive: true });
  const aborted = reconcileAbortedRuns({ stateDir: tmp });
  assert.equal(aborted.length, 1);
  assert.equal(aborted[0].run_id, "20260528-101010-am-2026-05-10");
  assert.equal(aborted[0].chain_status, "aborted");
});

test("reconcileAbortedRuns — skips folders that have summary.json", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-store-"));
  const dir = path.join(tmp, "backtest", "20260528-101010-am-2026-05-10", "ny-am");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "summary.json"), "{}");
  const aborted = reconcileAbortedRuns({ stateDir: tmp });
  assert.equal(aborted.length, 0);
});
