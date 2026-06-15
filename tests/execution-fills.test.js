// tests/execution-fills.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFill, readFills, dayRealizedLossUsd, readAllFills } from "../app/main/execution/fills.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fills-")); });

describe("fills", () => {
  it("appends then reads a record round-trip for a date", () => {
    const rec = { account: "paper", symbol: "MNQ1!", side: "long", actual: { r: 1.6, usd: 320 } };
    appendFill(dir, "2026-06-15", rec);
    const back = readFills(dir, "2026-06-15");
    assert.equal(back.length, 1);
    assert.equal(back[0].symbol, "MNQ1!");
    assert.ok(back[0].ts, "appendFill stamps ts");
  });
  it("returns [] for a date with no file", () => {
    assert.deepEqual(readFills(dir, "2026-01-01"), []);
  });
  it("sums realized losses (positive $ number) for the daily halt", () => {
    appendFill(dir, "2026-06-15", { actual: { usd: -200 } });
    appendFill(dir, "2026-06-15", { actual: { usd: 120 } });
    appendFill(dir, "2026-06-15", { actual: { usd: -150 } });
    assert.equal(dayRealizedLossUsd(readFills(dir, "2026-06-15")), 350);
  });
  it("readAllFills concatenates every date file oldest-first", () => {
    appendFill(dir, "2026-06-12", { ts: "2026-06-12T10:00:00Z", actual: { r: 1 } });
    appendFill(dir, "2026-06-15", { ts: "2026-06-15T10:00:00Z", actual: { r: -1 } });
    const all = readAllFills(dir);
    assert.equal(all.length, 2);
    assert.equal(all[0].ts, "2026-06-12T10:00:00Z");
    assert.equal(all[1].ts, "2026-06-15T10:00:00Z");
  });
  it("readAllFills returns [] for a missing dir", () => {
    assert.deepEqual(readAllFills(join(dir, "nope")), []);
  });
});

process.on("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
