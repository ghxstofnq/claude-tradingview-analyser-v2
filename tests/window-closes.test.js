// window-closes accumulator — gives the live open-reaction read the full
// open-window 1m closes (live≠backtest fix 2026-06-21).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendWindowClose, readWindowCloses } from "../app/main/window-closes.js";
import { openReactionWindowMs } from "../app/main/backtest-engine.js";

const SESSION = "ny-am";
const DATE = "2026-06-12";
const W = openReactionWindowMs({ date: DATE, session: SESSION });
const tsAtMin = (m) => new Date(W.startMs + m * 60_000).toISOString();

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "wc-")); }

test("accumulates in-window closes, deduped, and reads them back", () => {
  const dir = tmp();
  try {
    appendWindowClose({ dir, eventTs: tsAtMin(5), session: SESSION, close: 100 });
    appendWindowClose({ dir, eventTs: tsAtMin(6), session: SESSION, close: 101 });
    appendWindowClose({ dir, eventTs: tsAtMin(6), session: SESSION, close: 101 }); // dup minute
    const arr = readWindowCloses(dir);
    assert.equal(arr.length, 2);
    assert.deepEqual(arr.map((c) => c.close), [100, 101]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("ignores closes outside the open window (before start / after end)", () => {
  const dir = tmp();
  try {
    appendWindowClose({ dir, eventTs: tsAtMin(-5), session: SESSION, close: 1 });  // pre-open
    appendWindowClose({ dir, eventTs: tsAtMin(45), session: SESSION, close: 2 });  // past +30m
    assert.equal(readWindowCloses(dir).length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("readWindowCloses returns [] when no file exists", () => {
  const dir = tmp();
  try { assert.deepEqual(readWindowCloses(dir), []); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
