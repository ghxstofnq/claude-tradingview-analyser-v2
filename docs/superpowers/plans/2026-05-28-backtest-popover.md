# Backtest Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Backtest popover (anchored to a new `BACKTEST` topbar cell, same pattern as CLAUDE / ALERTS) that re-runs the live phase chain against a historical session, grades trades automatically, and accumulates a track-record library.

**Architecture:** A new `app/main/backtest-engine.js` orchestrates one run by reusing `sdk.userTurn` unchanged — only the writer path differs (`state/backtest/<run-id>/<session>/` instead of `state/session/<date>/<session>/`). Pure helpers (`backtest-store.js`, `backtest-grader.js`) are TDD-tested with `node --test`. The renderer hosts a single `BacktestPopover.jsx` component with six states (IDLE / AUTO RUNNING / PAUSE AWAITING / DONE / LIBRARY / DETAIL), driven by a `useBacktest()` hook over IPC.

**Tech Stack:** Node 18+, Electron 30, React 18, `node --test`, `@anthropic-ai/claude-agent-sdk ^0.3.150`. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-28-backtest-popover-design.md](../specs/2026-05-28-backtest-popover-design.md)

**Branch:** `feat/backtest-popover` (already created; spec committed)

---

## File map

**New (main process):**
- `app/main/backtest-engine.js` — the per-run loop orchestrator
- `app/main/backtest-store.js` — run-id generation, index.json read/write, aborted-run reconciliation
- `app/main/backtest-grader.js` — pure outcome-grading function
- `app/main/ipc-backtest.js` — IPC handlers for the renderer

**New (renderer):**
- `app/renderer/src/BacktestPopover.jsx` — the popover component (6 states)
- `app/renderer/src/Backtest.helpers.js` — pure helpers extracted for `node --test`
- `app/renderer/src/hooks/useBacktest.js` — subscribes to engine progress + reads index

**New (tests):**
- `tests/backtest-store.test.js`
- `tests/backtest-grader.test.js`
- `tests/backtest-helpers.test.js`
- `tests/backtest-engine.test.js`

**Modified (main process):**
- `app/main/persistent-memory.js` — suppress writes during a backtest run
- `app/main/metrics.js` — accept + persist optional `run_id` field
- `app/main/sdk.js` — accept + propagate `backtestContext` (writer path + run-id)
- `app/main/session-memory.js` — accept writer-path override (small additive arg on existing functions)
- `app/main/ipc.js` (or wherever IPC handlers are registered) — wire `ipc-backtest.js`
- `app/preload/*` — expose `window.api.backtest.*`

**Modified (renderer):**
- `app/renderer/src/App.jsx` — add `<BacktestPopover>` inside the topbar (sits beside CLAUDE / ALERTS cells)
- `app/renderer/src/Prep.jsx` — show "BACKTEST RUNNING" placeholder when `useBacktest().running`
- `app/renderer/src/Live.jsx` — same placeholder treatment
- `app/renderer/src/app.css` — add `.bt-popover`, `.bt-popover .head`, `.done-grid`, `.setup-card`, `.log`, etc. (port from the approved mockups)

---

### Task 1: Confirm branch + clean tree

**Files:** none (git only)

- [ ] **Step 1: Verify branch + status**

```bash
git status
git branch --show-current
```
Expected: working tree clean. On `feat/backtest-popover`. Spec already committed (`docs/superpowers/specs/2026-05-28-backtest-popover-design.md` shows in `git log --oneline main..HEAD`).

- [ ] **Step 2: Run the existing test suite to establish a baseline**

```bash
npm test 2>&1 | tail -8
```
Expected: all tests pass (or the same pre-existing failures documented in CLAUDE.md — note them so a new failure later in the plan is easy to spot).

---

### Task 2: Run-ID generator + store (foundation)

**Files:**
- Create: `app/main/backtest-store.js`
- Test: `tests/backtest-store.test.js`

The store owns run-id format, the on-disk `state/backtest/` layout, and `index.json` read/write/reconcile.

- [ ] **Step 1: Write the failing test**

```js
// tests/backtest-store.test.js
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

test("parseRunId — round-trips back to its parts", () => {
  const parts = parseRunId("20260528-103047-am-2026-05-20");
  assert.deepEqual(parts, { ts: "20260528-103047", session: "ny-am", date: "2026-05-20" });
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/backtest-store.test.js 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module '../app/main/backtest-store.js'`.

- [ ] **Step 3: Write the minimal implementation**

```js
// app/main/backtest-store.js
import fs from "node:fs";
import path from "node:path";

const SESSION_SLUG = { "ny-am": "am", "ny-pm": "pm", london: "london" };
const SLUG_SESSION = { am: "ny-am", pm: "ny-pm", london: "london" };

function pad(n, w = 2) { return String(n).padStart(w, "0"); }

export function generateRunId({ now = new Date(), session, date }) {
  const y = now.getUTCFullYear();
  const mo = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const h = pad(now.getUTCHours());
  const mi = pad(now.getUTCMinutes());
  const s = pad(now.getUTCSeconds());
  const slug = SESSION_SLUG[session];
  if (!slug) throw new Error(`unknown session: ${session}`);
  return `${y}${mo}${d}-${h}${mi}${s}-${slug}-${date}`;
}

export function parseRunId(runId) {
  // 20260528-103047-am-2026-05-20  →  {ts, session, date}
  const m = /^(\d{8}-\d{6})-(am|pm|london)-(\d{4}-\d{2}-\d{2})$/.exec(runId);
  if (!m) throw new Error(`invalid run_id: ${runId}`);
  return { ts: m[1], session: SLUG_SESSION[m[2]], date: m[3] };
}

export function resolveRunDir({ stateDir, runId }) {
  const { session } = parseRunId(runId);
  return path.join(stateDir, "backtest", runId, session);
}

function indexPath(stateDir) {
  return path.join(stateDir, "backtest", "index.json");
}

export function readIndex({ stateDir }) {
  const p = indexPath(stateDir);
  if (!fs.existsSync(p)) return { runs: [] };
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function writeIndexEntry({ stateDir, entry }) {
  const p = indexPath(stateDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const ix = readIndex({ stateDir });
  ix.runs.push(entry);
  fs.writeFileSync(p, JSON.stringify(ix, null, 2));
}

export function reconcileAbortedRuns({ stateDir }) {
  const root = path.join(stateDir, "backtest");
  if (!fs.existsSync(root)) return [];
  const ix = readIndex({ stateDir });
  const known = new Set(ix.runs.map((r) => r.run_id));
  const aborted = [];
  for (const entry of fs.readdirSync(root)) {
    if (entry === "index.json") continue;
    if (known.has(entry)) continue;
    try {
      const { session, date } = parseRunId(entry);
      const sessionDir = path.join(root, entry, session);
      const summary = path.join(sessionDir, "summary.json");
      if (fs.existsSync(summary)) continue;
      aborted.push({ run_id: entry, date, session, chain_status: "aborted" });
    } catch {
      // unparseable folder name — skip
    }
  }
  return aborted;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --test tests/backtest-store.test.js 2>&1 | tail -10
```
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/main/backtest-store.js tests/backtest-store.test.js
git commit -m "feat(backtest): run-id + store foundation (state/backtest/<id>/<session>/, index.json)"
```

---

### Task 3: Outcome grader (pure function)

**Files:**
- Create: `app/main/backtest-grader.js`
- Test: `tests/backtest-grader.test.js`

Pure function: given a setup + a new bar, decide whether stop / TP1 hit. Conservative on intra-bar conflict (stop assumed first).

- [ ] **Step 1: Write the failing test**

```js
// tests/backtest-grader.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";

test("long: bar.low <= stop → stop_hit", () => {
  const trade = { side: "long", entry: 29080, stop: 29050, tp1: 29150 };
  const bar = { high: 29110, low: 29045 };
  assert.deepEqual(gradeOpenTrade(trade, bar), {
    outcome: "stop_hit", exit: 29050, conflict_bar: false,
  });
});

test("long: bar.high >= tp1 → tp1_hit", () => {
  const trade = { side: "long", entry: 29080, stop: 29050, tp1: 29150 };
  const bar = { high: 29160, low: 29070 };
  assert.deepEqual(gradeOpenTrade(trade, bar), {
    outcome: "tp1_hit", exit: 29150, conflict_bar: false,
  });
});

test("long: bar straddles both → stop_hit + conflict_bar:true (conservative)", () => {
  const trade = { side: "long", entry: 29080, stop: 29050, tp1: 29150 };
  const bar = { high: 29160, low: 29045 };
  assert.deepEqual(gradeOpenTrade(trade, bar), {
    outcome: "stop_hit", exit: 29050, conflict_bar: true,
  });
});

test("short: bar.high >= stop → stop_hit", () => {
  const trade = { side: "short", entry: 29080, stop: 29105, tp1: 29050 };
  const bar = { high: 29110, low: 29070 };
  assert.deepEqual(gradeOpenTrade(trade, bar), {
    outcome: "stop_hit", exit: 29105, conflict_bar: false,
  });
});

test("short: bar.low <= tp1 → tp1_hit", () => {
  const trade = { side: "short", entry: 29080, stop: 29105, tp1: 29050 };
  const bar = { high: 29090, low: 29045 };
  assert.deepEqual(gradeOpenTrade(trade, bar), {
    outcome: "tp1_hit", exit: 29050, conflict_bar: false,
  });
});

test("short: straddles → stop_hit + conflict (conservative)", () => {
  const trade = { side: "short", entry: 29080, stop: 29105, tp1: 29050 };
  const bar = { high: 29110, low: 29045 };
  assert.deepEqual(gradeOpenTrade(trade, bar), {
    outcome: "stop_hit", exit: 29105, conflict_bar: true,
  });
});

test("bar inside levels → pending", () => {
  const trade = { side: "long", entry: 29080, stop: 29050, tp1: 29150 };
  const bar = { high: 29100, low: 29070 };
  assert.deepEqual(gradeOpenTrade(trade, bar), { outcome: "pending" });
});

test("invalid side throws", () => {
  assert.throws(() => gradeOpenTrade({ side: "wrong", entry: 1, stop: 1, tp1: 1 }, { high: 1, low: 1 }));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/backtest-grader.test.js 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module '../app/main/backtest-grader.js'`.

- [ ] **Step 3: Write the implementation**

```js
// app/main/backtest-grader.js
// Pure function — given an open trade and the latest closed bar, returns
// the grading outcome. Conservative rule on intra-bar conflict: if a single
// bar's high/low straddles both stop and tp1, assume stop hit first.

export function gradeOpenTrade(trade, bar) {
  const { side, stop, tp1 } = trade;
  const { high, low } = bar;

  if (side === "long") {
    const stopHit = low <= stop;
    const tpHit = high >= tp1;
    if (stopHit && tpHit) return { outcome: "stop_hit", exit: stop, conflict_bar: true };
    if (stopHit) return { outcome: "stop_hit", exit: stop, conflict_bar: false };
    if (tpHit) return { outcome: "tp1_hit", exit: tp1, conflict_bar: false };
    return { outcome: "pending" };
  }
  if (side === "short") {
    const stopHit = high >= stop;
    const tpHit = low <= tp1;
    if (stopHit && tpHit) return { outcome: "stop_hit", exit: stop, conflict_bar: true };
    if (stopHit) return { outcome: "stop_hit", exit: stop, conflict_bar: false };
    if (tpHit) return { outcome: "tp1_hit", exit: tp1, conflict_bar: false };
    return { outcome: "pending" };
  }
  throw new Error(`gradeOpenTrade: unknown side: ${side}`);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --test tests/backtest-grader.test.js 2>&1 | tail -10
```
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/main/backtest-grader.js tests/backtest-grader.test.js
git commit -m "feat(backtest): pure outcome-grading function (stop-first on conflict)"
```

---

### Task 4: Renderer helpers (state machine + aggregation)

**Files:**
- Create: `app/renderer/src/Backtest.helpers.js`
- Test: `tests/backtest-helpers.test.js`

Pure functions the popover will use, extracted so they can be unit-tested with `node --test` (the renderer has no Vitest).

- [ ] **Step 1: Write the failing tests**

```js
// tests/backtest-helpers.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextState,
  aggregateRuns,
  filterRuns,
  formatRunForRow,
  estimateCost,
} from "../app/renderer/src/Backtest.helpers.js";

test("nextState — IDLE + start (auto) → AUTO_RUNNING", () => {
  assert.equal(nextState("IDLE", { type: "START", mode: "auto" }), "AUTO_RUNNING");
});

test("nextState — IDLE + start (pause) → AUTO_RUNNING (mode is just a flag, state same)", () => {
  assert.equal(nextState("IDLE", { type: "START", mode: "pause" }), "AUTO_RUNNING");
});

test("nextState — AUTO_RUNNING + setup_surfaced (mode=pause) → PAUSE_AWAITING", () => {
  assert.equal(nextState("AUTO_RUNNING", { type: "SETUP_SURFACED", mode: "pause" }), "PAUSE_AWAITING");
});

test("nextState — AUTO_RUNNING + setup_surfaced (mode=auto) → AUTO_RUNNING (no transition)", () => {
  assert.equal(nextState("AUTO_RUNNING", { type: "SETUP_SURFACED", mode: "auto" }), "AUTO_RUNNING");
});

test("nextState — PAUSE_AWAITING + decision → AUTO_RUNNING", () => {
  assert.equal(nextState("PAUSE_AWAITING", { type: "DECISION", choice: "accept" }), "AUTO_RUNNING");
  assert.equal(nextState("PAUSE_AWAITING", { type: "DECISION", choice: "reject" }), "AUTO_RUNNING");
});

test("nextState — any running → DONE on completion", () => {
  assert.equal(nextState("AUTO_RUNNING", { type: "COMPLETE" }), "DONE");
  assert.equal(nextState("PAUSE_AWAITING", { type: "COMPLETE" }), "DONE");
});

test("nextState — DONE + dismiss → IDLE", () => {
  assert.equal(nextState("DONE", { type: "DISMISS" }), "IDLE");
});

test("nextState — any → LIBRARY on view_all", () => {
  assert.equal(nextState("IDLE", { type: "VIEW_ALL" }), "LIBRARY");
  assert.equal(nextState("DONE", { type: "VIEW_ALL" }), "LIBRARY");
});

test("nextState — LIBRARY + row click → DETAIL", () => {
  assert.equal(nextState("LIBRARY", { type: "ROW_CLICK" }), "DETAIL");
});

test("nextState — DETAIL + back → LIBRARY", () => {
  assert.equal(nextState("DETAIL", { type: "BACK" }), "LIBRARY");
});

test("aggregateRuns — totals + per-grade + agreement", () => {
  const runs = [
    { setups: 2, wins: 2, losses: 0, total_r: 8.5, your_agreement: { agreed: 2, disagreed: 0, ungraded: 0 }, best_model: "MSS",
      setups_by_grade: { "A+": 2, "B": 0, "NO": 0 }, wins_by_grade: { "A+": 2, "B": 0 } },
    { setups: 1, wins: 0, losses: 1, total_r: -1.0, your_agreement: { agreed: 0, disagreed: 1, ungraded: 0 }, best_model: "Trend",
      setups_by_grade: { "A+": 0, "B": 1, "NO": 0 }, wins_by_grade: { "A+": 0, "B": 0 } },
  ];
  const agg = aggregateRuns(runs);
  assert.equal(agg.total_runs, 2);
  assert.equal(agg.cum_r, 7.5);
  assert.equal(agg.aplus_hit_rate.numerator, 2);
  assert.equal(agg.aplus_hit_rate.denominator, 2);
  assert.equal(agg.b_hit_rate.numerator, 0);
  assert.equal(agg.b_hit_rate.denominator, 1);
  assert.equal(agg.agreement.agreed, 2);
  assert.equal(agg.agreement.disagreed, 1);
});

test("filterRuns — by session", () => {
  const runs = [
    { session: "ny-am", date: "2026-05-20" },
    { session: "ny-pm", date: "2026-05-19" },
    { session: "london", date: "2026-05-18" },
  ];
  assert.equal(filterRuns(runs, { session: "ny-am" }).length, 1);
  assert.equal(filterRuns(runs, { session: null }).length, 3);
});

test("filterRuns — by mode", () => {
  const runs = [{ mode: "auto" }, { mode: "pause" }, { mode: "auto" }];
  assert.equal(filterRuns(runs, { mode: "auto" }).length, 2);
});

test("formatRunForRow — shortens session label", () => {
  const row = formatRunForRow({ session: "ny-am", date: "2026-05-20", total_r: 8.5 });
  assert.equal(row.session_short, "AM");
  assert.equal(row.session_short_for, "ny-am");
});

test("estimateCost — auto cheaper than pause; scales with session length", () => {
  const a = estimateCost({ session: "ny-am", mode: "auto" });
  const b = estimateCost({ session: "ny-am", mode: "pause" });
  assert.ok(b > a);
  assert.ok(a >= 1 && a <= 50);  // sanity
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/backtest-helpers.test.js 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module '../app/renderer/src/Backtest.helpers.js'`.

- [ ] **Step 3: Write the implementation**

```js
// app/renderer/src/Backtest.helpers.js
// Pure helpers consumed by BacktestPopover.jsx — extracted so they're
// testable via `node --test` (renderer has no Vitest in this project).

const SESSION_BARS = { "ny-am": 180, "ny-pm": 180, london: 180 };
const AVG_TURN_COST_USD = { auto: 0.12, pause: 0.15 };
const SESSION_SHORT = { "ny-am": "AM", "ny-pm": "PM", london: "LON" };

export function nextState(state, event) {
  switch (state) {
    case "IDLE":
      if (event.type === "START") return "AUTO_RUNNING";
      if (event.type === "VIEW_ALL") return "LIBRARY";
      return state;
    case "AUTO_RUNNING":
      if (event.type === "SETUP_SURFACED" && event.mode === "pause") return "PAUSE_AWAITING";
      if (event.type === "COMPLETE") return "DONE";
      if (event.type === "VIEW_ALL") return "LIBRARY";
      return state;
    case "PAUSE_AWAITING":
      if (event.type === "DECISION") return "AUTO_RUNNING";
      if (event.type === "COMPLETE") return "DONE";
      return state;
    case "DONE":
      if (event.type === "DISMISS") return "IDLE";
      if (event.type === "VIEW_ALL") return "LIBRARY";
      if (event.type === "OPEN_DETAIL") return "DETAIL";
      if (event.type === "RUN_ANOTHER") return "IDLE";
      return state;
    case "LIBRARY":
      if (event.type === "ROW_CLICK") return "DETAIL";
      if (event.type === "DISMISS") return "IDLE";
      return state;
    case "DETAIL":
      if (event.type === "BACK") return "LIBRARY";
      if (event.type === "DISMISS") return "IDLE";
      return state;
    default:
      return state;
  }
}

export function aggregateRuns(runs) {
  const total_runs = runs.length;
  const cum_r = runs.reduce((s, r) => s + (r.total_r ?? 0), 0);
  const aplus_setups = runs.reduce((s, r) => s + (r.setups_by_grade?.["A+"] ?? 0), 0);
  const aplus_wins   = runs.reduce((s, r) => s + (r.wins_by_grade?.["A+"]   ?? 0), 0);
  const b_setups     = runs.reduce((s, r) => s + (r.setups_by_grade?.B      ?? 0), 0);
  const b_wins       = runs.reduce((s, r) => s + (r.wins_by_grade?.B        ?? 0), 0);
  const agreed       = runs.reduce((s, r) => s + (r.your_agreement?.agreed     ?? 0), 0);
  const disagreed    = runs.reduce((s, r) => s + (r.your_agreement?.disagreed  ?? 0), 0);
  const ungraded     = runs.reduce((s, r) => s + (r.your_agreement?.ungraded   ?? 0), 0);
  return {
    total_runs,
    cum_r,
    aplus_hit_rate: { numerator: aplus_wins, denominator: aplus_setups },
    b_hit_rate:     { numerator: b_wins,     denominator: b_setups },
    agreement:      { agreed, disagreed, ungraded },
  };
}

export function filterRuns(runs, { session = null, mode = null, grade = null } = {}) {
  return runs.filter((r) => {
    if (session && r.session !== session) return false;
    if (mode && r.mode !== mode) return false;
    if (grade && !runMatchesGrade(r, grade)) return false;
    return true;
  });
}

function runMatchesGrade(run, grade) {
  if (grade === "NO") return (run.setups ?? 0) === 0;
  return ((run.setups_by_grade ?? {})[grade] ?? 0) > 0;
}

export function formatRunForRow(run) {
  return {
    ...run,
    session_short: SESSION_SHORT[run.session] ?? run.session,
    session_short_for: run.session,
  };
}

export function estimateCost({ session, mode }) {
  const turns = SESSION_BARS[session] ?? 180;
  const cost = AVG_TURN_COST_USD[mode] ?? AVG_TURN_COST_USD.auto;
  return Math.round(turns * cost * 100) / 100;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --test tests/backtest-helpers.test.js 2>&1 | tail -10
```
Expected: all helper tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/Backtest.helpers.js tests/backtest-helpers.test.js
git commit -m "feat(backtest): renderer helpers (state machine, aggregation, filter, estimate)"
```

---

### Task 5: Memory write suppression

**Files:**
- Modify: `app/main/persistent-memory.js`
- Test: `tests/backtest-memory-suppression.test.js`

Persistent memory (USER.md / MEMORY.md) must not be mutated by backtest runs. Reads still work normally.

- [ ] **Step 1: Read the existing memory writer to find the touch point**

```bash
grep -n "writeMemory\|appendMemory\|writeToMemory" app/main/persistent-memory.js | head
```
Expected: at least one exported writer. Note its signature.

- [ ] **Step 2: Write the failing test**

```js
// tests/backtest-memory-suppression.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeMemoryNote, setBacktestContext, clearBacktestContext } from "../app/main/persistent-memory.js";

test("writeMemoryNote — normally persists to MEMORY.md", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pmem-"));
  clearBacktestContext();
  writeMemoryNote({ memoryDir: tmp, body: "lesson A", source: "live" });
  const memPath = path.join(tmp, "MEMORY.md");
  assert.ok(fs.readFileSync(memPath, "utf8").includes("lesson A"));
});

test("writeMemoryNote — suppressed during backtest context (returns {suppressed:true})", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pmem-"));
  setBacktestContext({ runId: "20260528-103047-am-2026-05-20" });
  const res = writeMemoryNote({ memoryDir: tmp, body: "lesson B", source: "backtest" });
  assert.equal(res.suppressed, true);
  const memPath = path.join(tmp, "MEMORY.md");
  assert.equal(fs.existsSync(memPath), false);
  clearBacktestContext();
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
node --test tests/backtest-memory-suppression.test.js 2>&1 | tail -10
```
Expected: FAIL — exports not found.

- [ ] **Step 4: Add the suppression mechanism**

In `app/main/persistent-memory.js`, add module-scope context plus exported set/clear plus a check at the start of the writer:

```js
// near the top of persistent-memory.js — module-scope context
let _backtestContext = null;
export function setBacktestContext(ctx) { _backtestContext = ctx; }
export function clearBacktestContext() { _backtestContext = null; }
export function inBacktest() { return _backtestContext !== null; }

// inside the writer (whatever the actual name is — adapt to what you found in Step 1)
export function writeMemoryNote({ memoryDir, body, source }) {
  if (_backtestContext) {
    return { suppressed: true, reason: "backtest_context", run_id: _backtestContext.runId };
  }
  // ...existing write logic, unchanged
}
```

If `writeMemoryNote` is named differently in your code, rename the test imports accordingly and add the same guard at the top of every persistent-memory writer (there should be only one or two — see Step 1).

- [ ] **Step 5: Run test to verify pass**

```bash
node --test tests/backtest-memory-suppression.test.js 2>&1 | tail -10
```
Expected: both tests pass.

- [ ] **Step 6: Run the existing memory tests to ensure no regression**

```bash
node --test tests/persistent-memory.test.js tests/memory-guardrails.test.js 2>&1 | tail -10
```
Expected: same pass/fail counts as Task 1 baseline.

- [ ] **Step 7: Commit**

```bash
git add app/main/persistent-memory.js tests/backtest-memory-suppression.test.js
git commit -m "feat(backtest): suppress persistent-memory writes during a backtest run"
```

---

### Task 6: Metrics `run_id` field

**Files:**
- Modify: `app/main/metrics.js`
- Test: extend `tests/metrics.test.js`

Every metric row gets an optional `run_id`. Existing rows are unaffected.

- [ ] **Step 1: Read the existing metrics writer**

```bash
grep -n "export function\|export const" app/main/metrics.js | head
```
Note the writer entry-point name (likely `record` or `append`).

- [ ] **Step 2: Write a failing test**

```js
// Append to tests/metrics.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { record, readRecent } from "../app/main/metrics.js";

test("metrics: record carries optional run_id through to disk", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "metrics-"));
  record({ dir: tmp, event: "bar-close", status: "succeeded", durationMs: 1234,
           cost: 0.10, run_id: "20260528-103047-am-2026-05-20" });
  const rows = readRecent({ dir: tmp });
  assert.equal(rows[rows.length - 1].run_id, "20260528-103047-am-2026-05-20");
});

test("metrics: record omits run_id when not provided", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "metrics-"));
  record({ dir: tmp, event: "bar-close", status: "succeeded", durationMs: 1234, cost: 0.10 });
  const rows = readRecent({ dir: tmp });
  assert.equal(rows[rows.length - 1].run_id, undefined);
});
```

(If the existing API doesn't accept `dir` parameter, adapt to whatever the writer does — the goal is "row has `run_id` when passed in".)

- [ ] **Step 3: Run test to verify it fails**

```bash
node --test tests/metrics.test.js 2>&1 | tail -10
```
Expected: the two new tests fail (run_id not in the persisted row).

- [ ] **Step 4: Modify the writer to pass through `run_id`**

In `app/main/metrics.js`, in the row-construction site, include `run_id` if present:

```js
// Inside whatever shapes the row before fs.appendFileSync:
const row = {
  ts: new Date().toISOString(),
  event, status, durationMs, cost,
  // ... other existing fields
  ...(run_id ? { run_id } : {}),
};
```

- [ ] **Step 5: Run tests to verify pass**

```bash
node --test tests/metrics.test.js 2>&1 | tail -10
```
Expected: all tests pass (including the new two).

- [ ] **Step 6: Commit**

```bash
git add app/main/metrics.js tests/metrics.test.js
git commit -m "feat(backtest): metrics row carries optional run_id field"
```

---

### Task 7: SDK accepts backtest context (writer path + run-id propagation)

**Files:**
- Modify: `app/main/sdk.js`
- Modify: `app/main/session-memory.js`
- Test: `tests/backtest-sdk-context.test.js`

`sdk.userTurn` already takes a `purpose` and reads/writes session memory. Add an optional `backtestContext: { runId, sessionDir }` arg that:
- Sets `persistent-memory.setBacktestContext()` for the duration of the turn (clears in `finally`)
- Sets a per-call `sessionDir` override that `session-memory.js` uses instead of the live session path
- Adds `run_id` to every metric row emitted by the turn

- [ ] **Step 1: Read the userTurn entry point**

```bash
grep -n "export.*userTurn\|async function userTurn" app/main/sdk.js | head
```
Note the existing signature.

- [ ] **Step 2: Write a failing test (uses real fs, mocks the SDK call)**

```js
// tests/backtest-sdk-context.test.js
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// We import dynamically so we can stub the underlying Agent SDK before the
// module captures it. Adjust the mock to match the actual SDK call site.
test("userTurn with backtestContext — writes pillar1 to backtest path, not session path", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-sdk-"));
  const backtestDir = path.join(tmp, "backtest", "20260528-103047-am-2026-05-20", "ny-am");
  fs.mkdirSync(backtestDir, { recursive: true });

  // Stub the Agent SDK to immediately call our captured tool — see actual SDK
  // mock surface in app/main/sdk.js. The simplest equivalent: a mock that
  // produces a SDKResultSuccess with cost=0 and triggers the session-memory
  // writer with a known frontmatter body.
  const { userTurn } = await import("../app/main/sdk.js");
  await userTurn({
    purpose: "brief",
    backtestContext: { runId: "20260528-103047-am-2026-05-20", sessionDir: backtestDir },
    mockResult: { /* sentinel that triggers a pillar1.md write */ },
  });

  // The writer goes through session-memory.js → writes to backtestDir, not the live path.
  assert.ok(fs.existsSync(path.join(backtestDir, "pillar1.md")));
});
```

(If your `userTurn` doesn't yet accept a `mockResult` hook, add one as the smallest possible test seam; live code passes through `undefined`. This is purely so the test can exercise the session-memory writer without a real LLM call.)

- [ ] **Step 3: Run test — expect failure**

```bash
node --test tests/backtest-sdk-context.test.js 2>&1 | tail -10
```
Expected: FAIL (no backtestContext support yet).

- [ ] **Step 4: Modify `app/main/sdk.js`**

```js
// near the top of userTurn — adapt to your code's actual shape
import { setBacktestContext, clearBacktestContext } from "./persistent-memory.js";

export async function userTurn({ purpose, backtestContext = null, ...rest }) {
  if (backtestContext) setBacktestContext(backtestContext);
  try {
    // Pass sessionDir override through to session-memory writes.
    const sessionDir = backtestContext?.sessionDir ?? defaultSessionDir(purpose);
    // ... existing logic but with sessionDir override threaded through ...
    // Every metrics.record() call inside this function should include
    //   run_id: backtestContext?.runId
  } finally {
    if (backtestContext) clearBacktestContext();
  }
}
```

- [ ] **Step 5: Modify `app/main/session-memory.js` writers to accept an explicit `sessionDir`**

Find each writer (`writePillarMarkdown`, `writeBrief`, `writeLtfBias`, etc. — exact names from the Explore agent's report). Add an optional `sessionDir` arg that overrides the result of `sessions.js:activeSessionDir()`:

```js
export function writePillarMarkdown({ pillar, body, sessionDir = activeSessionDir() }) {
  const p = path.join(sessionDir, `pillar${pillar}.md`);
  // ...existing logic
}
```

(Repeat the small `sessionDir = activeSessionDir()` default for every writer.)

- [ ] **Step 6: Run test to verify pass**

```bash
node --test tests/backtest-sdk-context.test.js 2>&1 | tail -10
```
Expected: pass.

- [ ] **Step 7: Run regressions on the existing SDK + session-memory tests**

```bash
node --test tests/*.test.js 2>&1 | tail -12
```
Expected: same pass/fail counts as the Task 1 baseline (no new failures).

- [ ] **Step 8: Commit**

```bash
git add app/main/sdk.js app/main/session-memory.js tests/backtest-sdk-context.test.js
git commit -m "feat(backtest): SDK accepts backtestContext (sessionDir override + memory suppression scope)"
```

---

### Task 8: Engine scaffolding + lifecycle

**Files:**
- Create: `app/main/backtest-engine.js`
- Test: `tests/backtest-engine.test.js`

The engine drives one run end-to-end. This task sets up the lifecycle (start / stop / state events) with mocked TV + SDK so we can TDD the orchestration without a real chart.

- [ ] **Step 1: Write failing test — lifecycle skeleton**

```js
// tests/backtest-engine.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";

function fakeTv() {
  const calls = [];
  return {
    calls,
    replay: {
      async start({ date, time }) { calls.push(["replay.start", date, time]); },
      async step() { calls.push(["replay.step"]); return { bar: { high: 100, low: 99 }, ts: Date.now() }; },
      async stop() { calls.push(["replay.stop"]); },
    },
    async analyzePillar3() { return { quote: { last: 100 }, bars: { last_bar: { high: 100, low: 99 } } }; },
  };
}

function fakeSdk() {
  return {
    async userTurn({ purpose, backtestContext }) {
      return { ok: true, purpose, runId: backtestContext?.runId, cost: 0.01 };
    },
  };
}

test("runBacktest — emits start/done events and calls replay.start + replay.stop", async () => {
  const tv = fakeTv();
  const sdk = fakeSdk();
  const events = [];
  const bus = new EventEmitter();
  bus.on("backtest:event", (e) => events.push(e));

  // 3-bar mini run for the test
  await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "auto",
    tv, sdk, bus, maxBars: 3,
  });

  const replayCalls = tv.calls.map((c) => c[0]);
  assert.ok(replayCalls.includes("replay.start"));
  assert.ok(replayCalls.includes("replay.stop"));
  assert.ok(events.some((e) => e.type === "start"));
  assert.ok(events.some((e) => e.type === "done"));
});

test("runBacktest — generates a run_id and creates the on-disk folder structure", async () => {
  const tv = fakeTv();
  const sdk = fakeSdk();
  const bus = new EventEmitter();
  const result = await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "auto",
    tv, sdk, bus, maxBars: 1,
  });
  assert.match(result.runId, /^\d{8}-\d{6}-am-2026-05-20$/);
  // sessionDir was passed to sdk.userTurn for memory writes
  // (verify by inspecting fakeSdk recorded calls if you make it record them)
});

test("runBacktest — STOP event aborts mid-loop", async () => {
  const tv = fakeTv();
  const sdk = fakeSdk();
  const bus = new EventEmitter();
  // Stop after 2 bars
  let count = 0;
  bus.on("backtest:event", (e) => {
    if (e.type === "progress") {
      count++;
      if (count === 2) bus.emit("backtest:command", { type: "stop" });
    }
  });
  await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "auto",
    tv, sdk, bus, maxBars: 100,
  });
  // Should have stopped before 100 bars
  const stepCount = tv.calls.filter((c) => c[0] === "replay.step").length;
  assert.ok(stepCount < 100, `expected <100, got ${stepCount}`);
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
node --test tests/backtest-engine.test.js 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module '../app/main/backtest-engine.js'`.

- [ ] **Step 3: Write a minimal engine**

```js
// app/main/backtest-engine.js
import fs from "node:fs";
import path from "node:path";
import { generateRunId, resolveRunDir, writeIndexEntry } from "./backtest-store.js";

const ANCHORS = { "ny-am": "08:30", "ny-pm": "12:00", london: "02:00" };

export async function runBacktest({
  date, session, mode,
  tv, sdk, bus,
  stateDir = "state",
  maxBars = 180,
}) {
  const runId = generateRunId({ session, date });
  const sessionDir = resolveRunDir({ stateDir, runId });
  fs.mkdirSync(sessionDir, { recursive: true });

  const ctx = { runId, sessionDir };
  let stopped = false;
  bus.on("backtest:command", (cmd) => { if (cmd.type === "stop") stopped = true; });

  bus.emit("backtest:event", { type: "start", runId, session, date, mode });

  let totalCost = 0;
  try {
    await tv.replay.start({ date, time: ANCHORS[session] });

    // brief
    const briefRes = await sdk.userTurn({ purpose: "brief", backtestContext: ctx });
    totalCost += briefRes.cost ?? 0;

    // main loop
    for (let bar = 0; bar < maxBars && !stopped; bar++) {
      await tv.replay.step();
      const bundle = await tv.analyzePillar3();
      const res = await sdk.userTurn({ purpose: "bar-close", backtestContext: ctx, bundle });
      totalCost += res.cost ?? 0;
      bus.emit("backtest:event", {
        type: "progress",
        runId, bar, total: maxBars, cost: totalCost, phase: "bar-close",
      });
    }

    // wrap
    await sdk.userTurn({ purpose: "wrap", backtestContext: ctx });
    await tv.replay.stop();

    const summary = {
      run_id: runId, date, session, mode, chain_status: stopped ? "user-stopped" : "clean",
      created_at: new Date().toISOString(), cost_usd: round2(totalCost),
      setups: 0, wins: 0, losses: 0, no_trades: 0, total_r: 0, best_model: null,
      your_agreement: { agreed: 0, disagreed: 0, ungraded: 0 },
    };
    fs.writeFileSync(path.join(sessionDir, "summary.json"), JSON.stringify(summary, null, 2));
    writeIndexEntry({ stateDir, entry: summary });

    bus.emit("backtest:event", { type: "done", runId, summary });
    return { runId, summary };
  } catch (e) {
    bus.emit("backtest:event", { type: "error", runId, message: e.message });
    try { await tv.replay.stop(); } catch {}
    throw e;
  }
}

function round2(n) { return Math.round(n * 100) / 100; }
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --test tests/backtest-engine.test.js 2>&1 | tail -10
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/main/backtest-engine.js tests/backtest-engine.test.js
git commit -m "feat(backtest): engine scaffolding — lifecycle, run-id, brief→loop→wrap"
```

---

### Task 9: Engine — surfaced setups + outcome integration

**Files:**
- Modify: `app/main/backtest-engine.js`
- Modify: `tests/backtest-engine.test.js`

Wire `backtest-grader` into the loop: after each bar step, walk open trades, mark stop/TP hits, append to `setups.jsonl`.

- [ ] **Step 1: Extend the engine test**

```js
// Append to tests/backtest-engine.test.js
test("runBacktest — auto mode auto-opens a trade on surfaced setup and grades it", async () => {
  const tv = { replay: {
      async start() {}, async stop() {},
      async step() { return { bar: { high: 100, low: 99 } }; },
    },
    async analyzePillar3() { return { bars: { last_bar: { high: 90, low: 88 } } }; },
  };
  // sdk emits a setup on the 2nd bar
  let barCount = 0;
  const sdk = {
    async userTurn({ purpose, backtestContext }) {
      if (purpose === "bar-close") {
        barCount++;
        if (barCount === 2) {
          return { cost: 0.01, surfacedSetup: {
            id: "s1", side: "short", entry: 95, stop: 105, tp1: 89,
          } };
        }
      }
      return { cost: 0.01 };
    },
  };
  const bus = new (await import("node:events")).EventEmitter();
  const events = [];
  bus.on("backtest:event", (e) => events.push(e));

  const { runId } = await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "auto",
    tv, sdk, bus, maxBars: 5,
  });

  // The bar after the surfaced setup has low=88 ≤ tp1=89 → TP1 hit
  const setupEvents = events.filter((e) => e.type === "setup_outcome");
  assert.equal(setupEvents.length, 1);
  assert.equal(setupEvents[0].outcome, "tp1_hit");
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
node --test tests/backtest-engine.test.js 2>&1 | tail -10
```
Expected: new test fails (no setup tracking).

- [ ] **Step 3: Wire the grader into the engine**

In `app/main/backtest-engine.js`, add an `openTrades[]` array and call `gradeOpenTrade` after each step. When `mode === "auto"` and `res.surfacedSetup` exists, push the trade and write a setups.jsonl row. When grade resolves, write the outcome row + emit event.

```js
import { gradeOpenTrade } from "./backtest-grader.js";
// inside runBacktest, near the loop:
const openTrades = [];
const setupsPath = path.join(sessionDir, "setups.jsonl");

// ... in the loop, after sdk.userTurn returns res:
if (mode === "auto" && res.surfacedSetup) {
  openTrades.push(res.surfacedSetup);
  fs.appendFileSync(setupsPath, JSON.stringify({ type: "open", ...res.surfacedSetup }) + "\n");
  bus.emit("backtest:event", { type: "setup_surfaced", runId, setup: res.surfacedSetup });
}

// After the bar advance:
const lastBar = bundle?.bars?.last_bar;
if (lastBar) {
  for (const trade of [...openTrades]) {
    const verdict = gradeOpenTrade(trade, lastBar);
    if (verdict.outcome !== "pending") {
      fs.appendFileSync(setupsPath, JSON.stringify({ type: "outcome", setup_id: trade.id, ...verdict }) + "\n");
      bus.emit("backtest:event", { type: "setup_outcome", runId, setupId: trade.id, ...verdict });
      openTrades.splice(openTrades.indexOf(trade), 1);
    }
  }
}
```

Also update the summary computation at end-of-run to count setups + wins + losses + total R from `openTrades` + the outcomes written.

- [ ] **Step 4: Run all engine tests**

```bash
node --test tests/backtest-engine.test.js 2>&1 | tail -10
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/main/backtest-engine.js tests/backtest-engine.test.js
git commit -m "feat(backtest): engine grades open trades after each bar (auto-mode)"
```

---

### Task 10: Engine — pause-on-setup decision flow

**Files:**
- Modify: `app/main/backtest-engine.js`
- Modify: `tests/backtest-engine.test.js`

In PAUSE mode, when a setup surfaces, the engine awaits a user decision via the bus.

- [ ] **Step 1: Add a failing test**

```js
test("runBacktest — pause mode awaits user decision before continuing", async () => {
  const tv = { replay: {
    async start() {}, async stop() {},
    async step() { return { bar: { high: 100, low: 99 } }; },
  },
  async analyzePillar3() { return { bars: { last_bar: { high: 100, low: 99 } } }; },
  };
  let barCount = 0;
  const sdk = {
    async userTurn({ purpose }) {
      if (purpose === "bar-close") {
        barCount++;
        if (barCount === 1) return { cost: 0, surfacedSetup: { id: "s1", side: "short", entry: 100, stop: 102, tp1: 98 } };
      }
      return { cost: 0 };
    },
  };
  const bus = new (await import("node:events")).EventEmitter();
  let pausedEmitted = false;
  bus.on("backtest:event", (e) => {
    if (e.type === "paused") {
      pausedEmitted = true;
      // Simulate user clicking REJECT
      setTimeout(() => bus.emit("backtest:command", { type: "decision", choice: "reject", setupId: "s1" }), 5);
    }
  });
  const { runId } = await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "pause",
    tv, sdk, bus, maxBars: 3,
  });
  assert.equal(pausedEmitted, true);
});
```

- [ ] **Step 2: Run test — expect failure**

- [ ] **Step 3: Add pause logic to the engine**

```js
// inside the loop, after res returns and surfacedSetup is present:
if (res.surfacedSetup) {
  bus.emit("backtest:event", { type: mode === "pause" ? "paused" : "setup_surfaced", runId, setup: res.surfacedSetup });
  if (mode === "pause") {
    const decision = await waitForDecision(bus);
    if (decision.choice === "accept") {
      openTrades.push(res.surfacedSetup);
      fs.appendFileSync(setupsPath, JSON.stringify({ type: "open", ...res.surfacedSetup, accepted_by: "user" }) + "\n");
    } else {
      fs.appendFileSync(setupsPath, JSON.stringify({ type: "rejected", setup_id: res.surfacedSetup.id }) + "\n");
    }
  } else {
    openTrades.push(res.surfacedSetup);
    fs.appendFileSync(setupsPath, JSON.stringify({ type: "open", ...res.surfacedSetup, accepted_by: "auto" }) + "\n");
  }
}

// helper at module bottom:
function waitForDecision(bus) {
  return new Promise((resolve) => {
    const handler = (cmd) => {
      if (cmd.type === "decision") {
        bus.off("backtest:command", handler);
        resolve(cmd);
      }
    };
    bus.on("backtest:command", handler);
  });
}
```

- [ ] **Step 4: Run tests**

```bash
node --test tests/backtest-engine.test.js 2>&1 | tail -10
```
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/main/backtest-engine.js tests/backtest-engine.test.js
git commit -m "feat(backtest): pause-on-setup decision flow (accept/reject via bus)"
```

---

### Task 11: IPC + preload bridge

**Files:**
- Create: `app/main/ipc-backtest.js`
- Modify: `app/main/ipc.js` (wire new handlers)
- Modify: `app/preload/*` (expose `window.api.backtest.*`)

Renderer calls 6 IPC methods: `start, stop, accept, reject, list, get, delete`.

- [ ] **Step 1: Read the existing IPC layer**

```bash
grep -n "ipcMain.handle\|ipcMain.on\|exposeInMainWorld" app/main/ipc.js app/preload/*.js 2>/dev/null | head -20
```

- [ ] **Step 2: Create `app/main/ipc-backtest.js`**

```js
// app/main/ipc-backtest.js
import { ipcMain, BrowserWindow } from "electron";
import { EventEmitter } from "node:events";
import { runBacktest } from "./backtest-engine.js";
import { readIndex, reconcileAbortedRuns } from "./backtest-store.js";
import fs from "node:fs";
import path from "node:path";

const STATE_DIR = "state";
let currentBus = null;
let currentRun = null;

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

export function registerBacktestIpc({ tv, sdk }) {
  ipcMain.handle("backtest:start", async (_evt, { date, session, mode }) => {
    if (currentRun) throw new Error("a backtest is already running");
    currentBus = new EventEmitter();
    currentBus.on("backtest:event", (e) => broadcast("backtest:event", e));

    currentRun = (async () => {
      try {
        return await runBacktest({ date, session, mode, tv, sdk, bus: currentBus, stateDir: STATE_DIR });
      } finally {
        currentBus = null;
        currentRun = null;
      }
    })();
    return { started: true };
  });

  ipcMain.handle("backtest:stop", async () => {
    if (!currentBus) return { stopped: false, reason: "no_active_run" };
    currentBus.emit("backtest:command", { type: "stop" });
    return { stopped: true };
  });

  ipcMain.handle("backtest:decision", async (_evt, { choice, setupId }) => {
    if (!currentBus) throw new Error("no active run to decide on");
    currentBus.emit("backtest:command", { type: "decision", choice, setupId });
    return { ok: true };
  });

  ipcMain.handle("backtest:list", async () => {
    const ix = readIndex({ stateDir: STATE_DIR });
    const aborted = reconcileAbortedRuns({ stateDir: STATE_DIR });
    return { runs: [...ix.runs, ...aborted] };
  });

  ipcMain.handle("backtest:get", async (_evt, { runId }) => {
    const ix = readIndex({ stateDir: STATE_DIR });
    const entry = ix.runs.find((r) => r.run_id === runId) ?? null;
    if (!entry) return { entry: null };
    const sessionDir = path.join(STATE_DIR, "backtest", runId, entry.session);
    const setupsPath = path.join(sessionDir, "setups.jsonl");
    const activityPath = path.join(sessionDir, "activity.jsonl");
    const summaryPath = path.join(sessionDir, "summary.json");
    return {
      entry,
      setups: fs.existsSync(setupsPath) ? fs.readFileSync(setupsPath, "utf8").trim().split("\n").map(JSON.parse) : [],
      activity: fs.existsSync(activityPath) ? fs.readFileSync(activityPath, "utf8").trim().split("\n").map(JSON.parse) : [],
      summaryMd: fs.existsSync(path.join(sessionDir, "summary.md")) ? fs.readFileSync(path.join(sessionDir, "summary.md"), "utf8") : null,
    };
  });

  ipcMain.handle("backtest:delete", async (_evt, { runId }) => {
    const ix = readIndex({ stateDir: STATE_DIR });
    const next = { runs: ix.runs.filter((r) => r.run_id !== runId) };
    fs.writeFileSync(path.join(STATE_DIR, "backtest", "index.json"), JSON.stringify(next, null, 2));
    const folder = path.join(STATE_DIR, "backtest", runId);
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
    return { deleted: true };
  });
}
```

- [ ] **Step 3: Call `registerBacktestIpc({ tv, sdk })` from `app/main/ipc.js`**

Find where other IPC bundles register and add:

```js
import { registerBacktestIpc } from "./ipc-backtest.js";
// ... near other registers, with the same tv/sdk references used by live:
registerBacktestIpc({ tv: <existing tv handle>, sdk: <existing sdk handle> });
```

- [ ] **Step 4: Expose in preload**

In the preload (`app/preload/*.js` — exact file depends on existing layout):

```js
contextBridge.exposeInMainWorld("api", {
  // ... existing exposures ...
  backtest: {
    start: (cfg) => ipcRenderer.invoke("backtest:start", cfg),
    stop:  () => ipcRenderer.invoke("backtest:stop"),
    decision: (cfg) => ipcRenderer.invoke("backtest:decision", cfg),
    list:  () => ipcRenderer.invoke("backtest:list"),
    get:   (cfg) => ipcRenderer.invoke("backtest:get", cfg),
    delete: (cfg) => ipcRenderer.invoke("backtest:delete", cfg),
    onEvent: (cb) => {
      const handler = (_evt, e) => cb(e);
      ipcRenderer.on("backtest:event", handler);
      return () => ipcRenderer.off("backtest:event", handler);
    },
  },
});
```

- [ ] **Step 5: Smoke-check the wiring (no automated test — main + preload are integration territory)**

```bash
npm run electron 2>&1 | grep -i "backtest" | head
```
Expected: app starts without crashes referencing backtest. (If it crashes, fix the wiring before continuing.)

- [ ] **Step 6: Commit**

```bash
git add app/main/ipc-backtest.js app/main/ipc.js app/preload/*.js
git commit -m "feat(backtest): IPC handlers + preload bridge (start/stop/decision/list/get/delete + event stream)"
```

---

### Task 12: `useBacktest()` hook

**Files:**
- Create: `app/renderer/src/hooks/useBacktest.js`

Subscribes to `backtest:event` stream, exposes `{ state, currentRun, library, actions }`.

- [ ] **Step 1: Write the hook**

```jsx
// app/renderer/src/hooks/useBacktest.js
import { useEffect, useReducer, useCallback } from "react";
import { nextState } from "../Backtest.helpers.js";

const INITIAL = {
  ui: "IDLE",
  library: { runs: [], loading: true },
  currentRun: null,    // { runId, session, date, mode, progress, setups[] }
  surfacedSetup: null, // populated when AWAITING in pause mode
  selectedRunId: null, // for DETAIL view
  detail: null,
};

function reducer(s, action) {
  switch (action.type) {
    case "LIBRARY_LOADED": return { ...s, library: { runs: action.runs, loading: false } };
    case "START":          return { ...s, ui: nextState(s.ui, action), currentRun: { runId: null, ...action.cfg, progress: { bar: 0, total: 180, cost: 0 }, setups: [] } };
    case "ENGINE_EVENT": {
      const e = action.event;
      if (e.type === "start")          return { ...s, currentRun: { ...s.currentRun, runId: e.runId } };
      if (e.type === "progress")       return { ...s, currentRun: { ...s.currentRun, progress: { bar: e.bar, total: e.total, cost: e.cost, phase: e.phase } } };
      if (e.type === "setup_surfaced") return { ...s, currentRun: { ...s.currentRun, setups: [...s.currentRun.setups, e.setup] } };
      if (e.type === "paused")         return { ...s, ui: nextState(s.ui, { type: "SETUP_SURFACED", mode: "pause" }), surfacedSetup: e.setup };
      if (e.type === "setup_outcome")  return { ...s, currentRun: { ...s.currentRun, setups: s.currentRun.setups.map((x) => x.id === e.setupId ? { ...x, outcome: e.outcome, exit: e.exit } : x) } };
      if (e.type === "done")           return { ...s, ui: "DONE", currentRun: { ...s.currentRun, summary: e.summary } };
      if (e.type === "error")          return { ...s, ui: "DONE", currentRun: { ...s.currentRun, error: e.message } };
      return s;
    }
    case "DECISION":   return { ...s, ui: nextState(s.ui, { type: "DECISION", choice: action.choice }), surfacedSetup: null };
    case "VIEW_ALL":   return { ...s, ui: nextState(s.ui, action) };
    case "ROW_CLICK":  return { ...s, ui: nextState(s.ui, action), selectedRunId: action.runId };
    case "BACK":       return { ...s, ui: nextState(s.ui, action), selectedRunId: null, detail: null };
    case "DISMISS":    return { ...s, ui: nextState(s.ui, action) };
    case "DETAIL_LOADED": return { ...s, detail: action.detail };
    default: return s;
  }
}

export function useBacktest() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // Initial library load + subscribe to events
  useEffect(() => {
    window.api.backtest.list().then(({ runs }) => dispatch({ type: "LIBRARY_LOADED", runs }));
    const off = window.api.backtest.onEvent((e) => dispatch({ type: "ENGINE_EVENT", event: e }));
    return off;
  }, []);

  // When DETAIL opens, fetch the run's deep data
  useEffect(() => {
    if (state.ui === "DETAIL" && state.selectedRunId) {
      window.api.backtest.get({ runId: state.selectedRunId })
        .then((detail) => dispatch({ type: "DETAIL_LOADED", detail }));
    }
  }, [state.ui, state.selectedRunId]);

  return {
    state,
    actions: {
      start: useCallback((cfg) => { dispatch({ type: "START", cfg }); window.api.backtest.start(cfg); }, []),
      stop:  useCallback(() => window.api.backtest.stop(), []),
      accept: useCallback((setupId) => { window.api.backtest.decision({ choice: "accept", setupId }); dispatch({ type: "DECISION", choice: "accept" }); }, []),
      reject: useCallback((setupId) => { window.api.backtest.decision({ choice: "reject", setupId }); dispatch({ type: "DECISION", choice: "reject" }); }, []),
      viewAll: useCallback(() => dispatch({ type: "VIEW_ALL" }), []),
      rowClick: useCallback((runId) => dispatch({ type: "ROW_CLICK", runId }), []),
      back: useCallback(() => dispatch({ type: "BACK" }), []),
      dismiss: useCallback(() => dispatch({ type: "DISMISS" }), []),
      deleteRun: useCallback(async (runId) => { await window.api.backtest.delete({ runId }); const { runs } = await window.api.backtest.list(); dispatch({ type: "LIBRARY_LOADED", runs }); }, []),
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/renderer/src/hooks/useBacktest.js
git commit -m "feat(backtest): useBacktest hook (state machine + IPC bridge)"
```

---

### Task 13: `BacktestPopover.jsx` — shell + IDLE state

**Files:**
- Create: `app/renderer/src/BacktestPopover.jsx`
- Modify: `app/renderer/src/app.css` (add `.bt-popover` styles)

Build the popover shell + the IDLE state (new-run form + recent runs list).

- [ ] **Step 1: Write the popover shell + IDLE body**

```jsx
// app/renderer/src/BacktestPopover.jsx
import React, { useState } from "react";
import { useBacktest } from "./hooks/useBacktest.js";
import { aggregateRuns, formatRunForRow, estimateCost } from "./Backtest.helpers.js";

export function BacktestCell() {
  const [open, setOpen] = useState(false);
  const { state, actions } = useBacktest();

  return (
    <div className={"cell pop-cell bt" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)}>
      <span className="k">BACKTEST</span>
      <BacktestBadge state={state} />
      {open && (
        <div className="bt-popover" onClick={(e) => e.stopPropagation()}>
          <Header state={state} onClose={() => setOpen(false)} actions={actions} />
          <div className="body">
            {state.ui === "IDLE" && <IdleBody state={state} actions={actions} />}
            {state.ui === "AUTO_RUNNING" && <RunningBody state={state} actions={actions} />}
            {state.ui === "PAUSE_AWAITING" && <PauseBody state={state} actions={actions} />}
            {state.ui === "DONE" && <DoneBody state={state} actions={actions} />}
            {state.ui === "LIBRARY" && <LibraryBody state={state} actions={actions} />}
            {state.ui === "DETAIL" && <DetailBody state={state} actions={actions} />}
          </div>
        </div>
      )}
    </div>
  );
}

function BacktestBadge({ state }) {
  if (state.ui === "AUTO_RUNNING") {
    const pct = state.currentRun?.progress ? Math.round((state.currentRun.progress.bar / state.currentRun.progress.total) * 100) : 0;
    return <span className="llm-ind"><span className="dot" /><span className="pct">{pct}%</span></span>;
  }
  if (state.ui === "PAUSE_AWAITING") {
    return <span className="paused-ind"><span className="dot" /><span className="lbl">PAUSED</span></span>;
  }
  if (state.ui === "DONE") {
    return <span className="done-ind"><span className="check">✓</span><span className="count green">{state.library.runs.length}</span></span>;
  }
  return <span className="count amber">{state.library.runs.length}</span>;
}

function Header({ state, onClose, actions }) {
  if (state.ui === "DETAIL") {
    return (
      <div className="head">
        <span className="back" onClick={actions.back}>← LIBRARY</span>
        <span className="t">{state.selectedRunId}</span>
        <span className="spacer" />
        <span className="x" onClick={onClose}>×</span>
      </div>
    );
  }
  const ttl = {
    IDLE: "BACKTEST",
    AUTO_RUNNING: "BACKTEST · AUTO",
    PAUSE_AWAITING: "BACKTEST · AWAITING DECISION",
    DONE: "BACKTEST · COMPLETE",
    LIBRARY: "BACKTEST · LIBRARY",
  }[state.ui];
  return (
    <div className="head">
      <span className={"t " + state.ui.toLowerCase()}>{ttl}</span>
      <span className="x" onClick={state.ui === "AUTO_RUNNING" || state.ui === "PAUSE_AWAITING" ? null : onClose}>
        {state.ui === "AUTO_RUNNING" || state.ui === "PAUSE_AWAITING" ? "─" : "×"}
      </span>
    </div>
  );
}

function IdleBody({ state, actions }) {
  const [date, setDate] = useState(toIsoDate(new Date()));
  const [session, setSession] = useState("ny-am");
  const [mode, setMode] = useState("auto");
  const est = estimateCost({ session, mode });
  const agg = aggregateRuns(state.library.runs);

  return (
    <>
      <div className="section">
        <div className="sect-hd"><span>NEW RUN</span><span className="meta">EST. ${est.toFixed(2)}</span></div>
        <div className="row"><span className="k">DATE</span>
          <div className="search-wrap"><input value={date} onChange={(e) => setDate(e.target.value)} autoComplete="off" /></div>
        </div>
        <div className="row"><span className="k">SESSION</span>
          <Seg value={session} onChange={setSession} options={[["london","LON"],["ny-am","AM"],["ny-pm","PM"]]} />
        </div>
        <div className="row"><span className="k">PAIR</span><span className="v">MNQ1! + MES1!</span></div>
        <div className="row"><span className="k">MODE</span>
          <Seg value={mode} onChange={setMode} options={[["auto","AUTO"],["pause","PAUSE ON SETUP"]]} />
        </div>
        <button className="start-btn" onClick={() => actions.start({ date, session, mode })}>▶  START RUN</button>
      </div>
      <RecentSection runs={state.library.runs} agg={agg} actions={actions} />
    </>
  );
}

function Seg({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map(([v, lbl]) => (
        <div key={v} className={"s" + (value === v ? " on" : "")} onClick={() => onChange(v)}>{lbl}</div>
      ))}
    </div>
  );
}

function RecentSection({ runs, agg, actions }) {
  const recent = runs.slice(0, 5);
  return (
    <div className="section">
      <div className="sect-hd"><span>RECENT</span><span className="meta">{agg.total_runs} RUNS</span></div>
      <div className="recent-summary">
        A+ <b className="green">{pct(agg.aplus_hit_rate)}</b> · B <b>{pct(agg.b_hit_rate)}</b> · CUM <b className="green">{agg.cum_r.toFixed(1)}R</b>
      </div>
      {recent.map((r) => <RunRow key={r.run_id} run={r} onClick={() => actions.rowClick(r.run_id)} />)}
      {runs.length > 5 && (
        <div className="view-all" onClick={actions.viewAll}>VIEW ALL {runs.length} RUNS →</div>
      )}
    </div>
  );
}

function RunRow({ run, onClick }) {
  const f = formatRunForRow(run);
  const grade = run.setups === 0 ? "NO" : (run.wins / run.setups >= 0.5 ? "A+" : "B");
  return (
    <div className="run-row" onClick={onClick}>
      <span className="date">{(run.date ?? "").slice(5)}</span>
      <span className="ses">{f.session_short}</span>
      <span><span className={"gp " + gradeClass(grade)}>{grade}</span></span>
      <span className={"pnl " + (run.total_r > 0 ? "green" : run.total_r < 0 ? "red" : "")}>
        {run.total_r > 0 ? "+" : ""}{run.total_r.toFixed(1)}R
      </span>
      <span className="arr">▸</span>
    </div>
  );
}

// Stubs — filled by Tasks 14-18
function RunningBody({ state, actions }) { return <div className="section">running...</div>; }
function PauseBody({ state, actions }) { return <div className="section">paused...</div>; }
function DoneBody({ state, actions }) { return <div className="section">done...</div>; }
function LibraryBody({ state, actions }) { return <div className="section">library...</div>; }
function DetailBody({ state, actions }) { return <div className="section">detail...</div>; }

function toIsoDate(d) { return d.toISOString().slice(0, 10); }
function pct({ numerator, denominator }) { return denominator === 0 ? "—" : `${Math.round(100 * numerator / denominator)}%`; }
function gradeClass(g) { return g === "A+" ? "green" : g === "B" ? "amber" : "dim"; }
```

- [ ] **Step 2: Copy the popover CSS from mockup v3 + v12 into `app/renderer/src/app.css`**

Open the approved mockups and paste the rule sets into `app.css`:
- `.cell.bt.open`
- `.bt-popover`, `.bt-popover .head`, `.bt-popover .body`, `.bt-popover .section`, `.bt-popover .sect-hd`
- `.row` (already exists — verify it works for the form)
- `.seg`, `.seg .s`, `.seg .s.on`
- `.search-wrap`, `.search-wrap input`, `:-webkit-autofill` override
- `.start-btn`
- `.recent-summary`, `.run-row`, `.gp`, `.gp.green/.amber/.dim`, `.pnl.green/.red`, `.view-all`
- `.llm-ind`, `.paused-ind`, `.done-ind`
- `.count.amber`, `.count.green`

(Source files for these rules: `.superpowers/brainstorm/79492-1779929198/content/popover-v3-matched.html` and `popover-v12-library-fixed3.html`. Strip the `<style>` wrapper — paste rules into `app.css` under a `/* === BACKTEST POPOVER === */` comment block.)

- [ ] **Step 3: Wire `<BacktestCell />` into `App.jsx`**

Find the topbar status section in `app/renderer/src/App.jsx` where CLAUDE / ALERTS cells live. Add:

```jsx
import { BacktestCell } from "./BacktestPopover.jsx";
// ... inside the .status div, beside the ALERTS cell:
<BacktestCell />
```

- [ ] **Step 4: Manual smoke**

```bash
npm run electron
```
Click the new BACKTEST cell. Verify: popover drops down, IDLE body renders, form interactive, can close with ×.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/BacktestPopover.jsx app/renderer/src/app.css app/renderer/src/App.jsx
git commit -m "feat(backtest): popover shell + IDLE state (new-run form, recent runs)"
```

---

### Task 14: AUTO RUNNING body

**Files:**
- Modify: `app/renderer/src/BacktestPopover.jsx`
- Modify: `app/renderer/src/app.css` (port `.feed`, `.progress`, `.setup-card`, `.agree` rules from v6)

Fill in `RunningBody` with progress block + LLM activity feed + surfaced setups (read-only with optional AGREE/DISAGREE).

- [ ] **Step 1: Replace `RunningBody` with full implementation**

```jsx
function RunningBody({ state, actions }) {
  const cur = state.currentRun ?? {};
  const pct = cur.progress ? Math.round((cur.progress.bar / cur.progress.total) * 100) : 0;
  return (
    <>
      <div className="section">
        <div className="sect-hd"><span>{cur.date} · {sessionLabel(cur.session)} · {cur.mode?.toUpperCase()}</span><span className="meta">${(cur.progress?.cost ?? 0).toFixed(2)}</span></div>
        <div className="row"><span className="k">BAR</span><span className="v">{cur.progress?.bar ?? 0} / {cur.progress?.total ?? 180}</span></div>
        <div className="row"><span className="k">PHASE</span><span className="v amber">{cur.progress?.phase ?? "—"}</span></div>
        <div className="progress"><div className="fill" style={{ width: pct + "%" }} /></div>
        <button className="stop-btn" onClick={actions.stop}>■  STOP RUN</button>
      </div>
      <div className="section">
        <div className="sect-hd"><span>SETUPS</span><span className="meta">{cur.setups?.length ?? 0}</span></div>
        {(cur.setups ?? []).map((s) => <SetupCardReadOnly key={s.id} setup={s} />)}
      </div>
    </>
  );
}

function SetupCardReadOnly({ setup }) {
  return (
    <div className="setup-card">
      <div className="hd">
        <span className={"gp " + gradeClass(setup.grade ?? "A+")}>{setup.grade ?? "A+"}</span>
        <span className={"side " + setup.side[0]}>{setup.side.toUpperCase()}</span>
        <span className="model">{setup.model ?? ""}</span>
        <span className="ts">{setup.ts ?? ""}</span>
      </div>
      <div className="lvls">
        <div className="lv"><span className="k">ENTRY</span><span className="v">{setup.entry}</span></div>
        <div className="lv"><span className="k">STOP</span><span className="v red">{setup.stop}</span></div>
        <div className="lv"><span className="k">TP1</span><span className="v green">{setup.tp1}</span></div>
      </div>
      {setup.outcome && (
        <div className="outcome">
          <span className={"res " + (setup.outcome === "tp1_hit" ? "win" : "loss")}>
            <span className="ind" />
            {setup.outcome === "tp1_hit" ? "HIT TP1" : "STOPPED"} @ {setup.exit}
          </span>
        </div>
      )}
    </div>
  );
}

function sessionLabel(s) { return ({ "ny-am": "NY-AM", "ny-pm": "NY-PM", london: "LONDON" })[s] ?? s; }
```

- [ ] **Step 2: Port `.progress`, `.stop-btn`, `.setup-card`, `.lvls`, `.outcome` from `popover-v6-auto-running.html` into `app.css`**

- [ ] **Step 3: Manual smoke**

Start a run (use a known valid date/session). Verify:
- Popover transitions IDLE → AUTO RUNNING
- Progress bar advances
- BAR / PHASE rows update
- STOP button stops the run
- A surfaced setup card appears in the SETUPS section

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/BacktestPopover.jsx app/renderer/src/app.css
git commit -m "feat(backtest): AUTO RUNNING body (progress + setups + stop)"
```

---

### Task 15: PAUSE AWAITING body

**Files:**
- Modify: `app/renderer/src/BacktestPopover.jsx`
- Modify: `app/renderer/src/app.css` (port `.pause-banner`, `.decide` from v5)

Pause body with the explicit ACCEPT / REJECT decision UI.

- [ ] **Step 1: Replace `PauseBody`**

```jsx
function PauseBody({ state, actions }) {
  const setup = state.surfacedSetup;
  if (!setup) return null;
  return (
    <>
      <div className="section">
        <div className="sect-hd"><span>RUN PAUSED</span><span className="meta">BAR {state.currentRun?.progress?.bar}</span></div>
        <button className="stop-btn" onClick={actions.stop}>■ STOP RUN</button>
      </div>
      <div className="section">
        <div className="pause-banner"><span className="ico" />RUN PAUSED — DECIDE BEFORE CONTINUING</div>
        <div className="setup-card">
          <div className="hd">
            <span className={"gp " + gradeClass(setup.grade ?? "A+")}>{setup.grade ?? "A+"}</span>
            <span className={"side " + setup.side[0]}>{setup.side.toUpperCase()}</span>
            <span className="model">{setup.model ?? ""}</span>
            <span className="ts">{setup.ts ?? ""}</span>
          </div>
          <div className="lvls">
            <div className="lv"><span className="k">ENTRY</span><span className="v">{setup.entry}</span></div>
            <div className="lv"><span className="k">STOP</span><span className="v red">{setup.stop}</span></div>
            <div className="lv"><span className="k">TP1</span><span className="v green">{setup.tp1}</span></div>
          </div>
          {setup.rationale && <div className="rationale-block">{setup.rationale}</div>}
        </div>
        <div className="decide">
          <button className="btn accept" onClick={() => actions.accept(setup.id)}>✓ ACCEPT</button>
          <button className="btn reject" onClick={() => actions.reject(setup.id)}>✗ REJECT</button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Port `.pause-banner`, `.decide`, `.rationale-block`, `.decide .btn.accept/.reject` from `popover-v5-pause-decision.html`**

- [ ] **Step 3: Manual smoke**

Start a run in PAUSE mode. Verify:
- When a setup surfaces, the popover transitions to PAUSE AWAITING
- ACCEPT button resumes the run; REJECT also resumes the run
- Setup card shows rationale (if present)

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/BacktestPopover.jsx app/renderer/src/app.css
git commit -m "feat(backtest): PAUSE AWAITING body (ACCEPT / REJECT decision flow)"
```

---

### Task 16: DONE body

**Files:**
- Modify: `app/renderer/src/BacktestPopover.jsx`
- Modify: `app/renderer/src/app.css` (port `.done-grid`)

- [ ] **Step 1: Replace `DoneBody`**

```jsx
function DoneBody({ state, actions }) {
  const s = state.currentRun?.summary;
  if (!s) return <div className="section">no summary</div>;
  return (
    <>
      <div className="section">
        <div className="sect-hd"><span>{s.date} · {sessionLabel(s.session)} · {s.mode?.toUpperCase()}</span><span className="meta">${s.cost_usd?.toFixed(2)}</span></div>
        <div className="done-grid">
          <div className="lcell">
            <span className="k">RESULT</span>
            <span className={"v " + (s.total_r > 0 ? "green" : s.total_r < 0 ? "red" : "")}>
              {s.total_r > 0 ? "+" : ""}{s.total_r.toFixed(1)}R
            </span>
            <span className="sub">{s.wins}W · {s.losses}L</span>
          </div>
          <div className="lcell"><span className="k">SETUPS</span><span className="v">{s.setups}</span></div>
          <div className="lcell"><span className="k">WIN-RATE</span>
            <span className="v green">{s.setups > 0 ? Math.round(100 * s.wins / s.setups) : 0}%</span>
          </div>
          <div className="lcell"><span className="k">BEST</span><span className="v amber">{s.best_model ?? "—"}</span></div>
        </div>
        <div className="actions">
          <button className="btn secondary" onClick={() => actions.rowClick(s.run_id)}>▸ OPEN DETAIL</button>
          <button className="btn primary" onClick={actions.dismiss}>+ RUN ANOTHER</button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Port `.done-grid` rules from `popover-v7-done.html`**

- [ ] **Step 3: Manual smoke** — let a small run complete, see DONE body with summary + actions.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/BacktestPopover.jsx app/renderer/src/app.css
git commit -m "feat(backtest): DONE body (4-cell summary + open-detail / run-another actions)"
```

---

### Task 17: LIBRARY body

**Files:**
- Modify: `app/renderer/src/BacktestPopover.jsx`
- Modify: `app/renderer/src/app.css` (port `.agg-grid`, `.filters`, `.lib-table`, `.btn-add`)

- [ ] **Step 1: Replace `LibraryBody`**

```jsx
function LibraryBody({ state, actions }) {
  const [sessionFilter, setSessionFilter] = useState(null);
  const [modeFilter, setModeFilter] = useState(null);
  const [gradeFilter, setGradeFilter] = useState(null);
  const filtered = filterRuns(state.library.runs, { session: sessionFilter, mode: modeFilter, grade: gradeFilter });
  const agg = aggregateRuns(state.library.runs);

  return (
    <>
      <div className="section">
        <div className="sect-hd"><span>AGGREGATE</span><span className="meta">{agg.total_runs} RUNS</span></div>
        <div className="agg-grid">
          <div className="lcell"><span className="k">TOTAL</span><span className="v">{agg.total_runs}</span></div>
          <div className="lcell"><span className="k">A+ HIT-RATE</span><span className="v green">{pct(agg.aplus_hit_rate)}</span></div>
          <div className="lcell"><span className="k">B HIT-RATE</span><span className="v">{pct(agg.b_hit_rate)}</span></div>
          <div className="lcell"><span className="k">CUM P&amp;L</span><span className="v green">{agg.cum_r > 0 ? "+" : ""}{agg.cum_r.toFixed(1)}R</span></div>
          <div className="lcell"><span className="k">AGREEMENT</span><span className="v amber">{agreementPct(agg.agreement)}</span></div>
        </div>
      </div>
      <div className="section">
        <div className="filters">
          <Filter label="SESSION" value={sessionFilter} onChange={setSessionFilter} options={[[null,"ALL"],["ny-am","AM"],["ny-pm","PM"],["london","LON"]]} />
          <Filter label="GRADE" value={gradeFilter} onChange={setGradeFilter} options={[[null,"ALL"],["A+","A+"],["B","B"],["NO","NO"]]} />
          <Filter label="MODE" value={modeFilter} onChange={setModeFilter} options={[[null,"ALL"],["auto","AUTO"],["pause","PAUSE"]]} />
          <div className="search-wrap"><input placeholder="date / note..." autoComplete="off" /></div>
          <button className="btn-add" onClick={() => actions.dismiss()}>+</button>
        </div>
      </div>
      <div className="section" style={{ padding: 0 }}>
        <table className="lib-table">
          <thead><tr><th>DATE</th><th>SESSION</th><th>MODE</th><th>SETUPS</th><th>W/L</th><th>GRADE</th><th>P&amp;L</th><th>YOU</th><th>COST</th><th /></tr></thead>
          <tbody>
            {filtered.map((r) => (<LibRow key={r.run_id} run={r} onClick={() => actions.rowClick(r.run_id)} />))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Filter({ label, value, onChange, options }) {
  return (
    <div className="filter">
      <span className="k">{label}</span>
      <div className="seg">
        {options.map(([v, lbl]) => (
          <div key={String(v)} className={"s" + (value === v ? " on" : "")} onClick={() => onChange(v)}>{lbl}</div>
        ))}
      </div>
    </div>
  );
}

function LibRow({ run, onClick }) {
  const grade = run.setups === 0 ? "NO" : (run.wins / run.setups >= 0.5 ? "A+" : "B");
  const f = formatRunForRow(run);
  return (
    <tr onClick={onClick}>
      <td>{run.date}</td>
      <td className="ses">{f.session_short}</td>
      <td className="dim">{run.mode?.toUpperCase()}</td>
      <td>{run.setups}</td>
      <td className={run.wins > run.losses ? "green" : run.losses > 0 ? "red" : "dim"}>{run.wins} / {run.losses}</td>
      <td><span className={"pill " + gradeClass(grade)}>{grade}</span></td>
      <td className={run.total_r > 0 ? "green" : run.total_r < 0 ? "red" : "dim"}>{run.total_r > 0 ? "+" : ""}{run.total_r.toFixed(1)}R</td>
      <td>{agreementMarks(run.your_agreement)}</td>
      <td className="dim">${run.cost_usd?.toFixed(2)}</td>
      <td className="arr">▸</td>
    </tr>
  );
}

function agreementMarks(a) {
  if (!a) return "—";
  return <><span className="ok">{"✓".repeat(a.agreed)}</span><span className="no">{"✗".repeat(a.disagreed)}</span></>;
}
function agreementPct(a) {
  const total = (a?.agreed ?? 0) + (a?.disagreed ?? 0);
  return total === 0 ? "—" : `${Math.round(100 * (a.agreed) / total)}%`;
}
```

- [ ] **Step 2: Port `.agg-grid`, `.filters`, `.filter`, `.lib-table`, `.btn-add` from `popover-v12-library-fixed3.html`**

The popover width needs to widen for LIBRARY/DETAIL. Adjust the `.bt-popover` to grow when `state.ui === "LIBRARY"` or `"DETAIL"` — easiest is a CSS class toggled in `BacktestCell`:

```jsx
<div className={"bt-popover" + (state.ui === "LIBRARY" || state.ui === "DETAIL" ? " wide" : "")}>
```

```css
.bt-popover.wide { width: 880px; max-width: calc(100vw - 40px); }
```

- [ ] **Step 3: Manual smoke** — click VIEW ALL, see the table with filters + aggregate stats.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/BacktestPopover.jsx app/renderer/src/app.css
git commit -m "feat(backtest): LIBRARY body (aggregate dashboard + filters + sortable table)"
```

---

### Task 18: DETAIL body

**Files:**
- Modify: `app/renderer/src/BacktestPopover.jsx`
- Modify: `app/renderer/src/app.css` (port `.log`, expanded `.setup-card`, `.agree-row` from v14)

- [ ] **Step 1: Replace `DetailBody`**

```jsx
function DetailBody({ state, actions }) {
  const detail = state.detail;
  if (!detail) return <div className="section">loading...</div>;
  const { entry, setups, activity } = detail;
  const setupOpenEvents = setups.filter((s) => s.type === "open");
  return (
    <>
      <div className="section">
        <div className="sect-hd"><span>SUMMARY</span><span className="meta">${entry.cost_usd?.toFixed(2)}</span></div>
        <div className="done-grid">
          <div className="lcell"><span className="k">RESULT</span><span className={"v " + (entry.total_r > 0 ? "green" : "red")}>{entry.total_r > 0 ? "+" : ""}{entry.total_r?.toFixed(1)}R</span></div>
          <div className="lcell"><span className="k">SETUPS</span><span className="v">{entry.setups}</span></div>
          <div className="lcell"><span className="k">WIN-RATE</span><span className="v green">{entry.setups > 0 ? Math.round(100 * entry.wins / entry.setups) : 0}%</span></div>
          <div className="lcell"><span className="k">AGREEMENT</span><span className="v amber">{agreementPct(entry.your_agreement)}</span></div>
        </div>
      </div>
      <div className="section">
        <div className="sect-hd"><span>SETUPS</span><span className="meta">{setupOpenEvents.length}</span></div>
        {setupOpenEvents.map((s) => {
          const outcome = setups.find((o) => o.type === "outcome" && o.setup_id === s.id);
          return (
            <div key={s.id} className="setup-card">
              <div className="hd">
                <span className={"gp " + gradeClass(s.grade ?? "A+")}>{s.grade ?? "A+"}</span>
                <span className={"side " + s.side[0]}>{s.side.toUpperCase()}</span>
                <span className="model">{s.model ?? ""}</span>
                <span className="ts">{s.ts ?? ""}</span>
              </div>
              <div className="lvls">
                <div className="lv"><span className="k">ENTRY</span><span className="v">{s.entry}</span></div>
                <div className="lv"><span className="k">STOP</span><span className="v red">{s.stop}</span></div>
                <div className="lv"><span className="k">TP1</span><span className="v green">{s.tp1}</span></div>
                <div className="lv"><span className="k">TP2</span><span className="v green">{s.tp2 ?? "—"}</span></div>
              </div>
              {s.rationale && <div className="rationale-block">{s.rationale}</div>}
              {outcome && (
                <div className="outcome">
                  <span className={"res " + (outcome.outcome === "tp1_hit" ? "win" : "loss")}>
                    <span className="ind" />
                    {outcome.outcome === "tp1_hit" ? "HIT TP1" : "STOPPED"} @ {outcome.exit}
                  </span>
                  <span className="meta">{s.accepted_by === "auto" ? "AUTO-ACCEPTED" : "USER-ACCEPTED"}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="section">
        <div className="sect-hd"><span>LLM ACTIVITY LOG</span><span className="meta">{activity.length} TURNS</span></div>
        <div className="log">
          {activity.map((a, i) => (
            <div key={i} className={"ln phase-" + a.phase}>
              <span className="t">{a.ts}</span>
              <span className="ph">{a.phase}</span>
              <span className="msg">{a.message}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="section">
        <div className="actions">
          <button className="btn primary">▸ REPLAY ON CHART</button>
          <button className="btn">↻ RE-RUN</button>
          <div className="spacer" />
          <button className="btn danger" onClick={() => actions.deleteRun(entry.run_id)}>DELETE RUN</button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Port `.log`, `.log .ln`, `.actions`, `.agree-row` from `popover-v14-detail.html`**

- [ ] **Step 3: Manual smoke** — click a row in LIBRARY, verify the DETAIL body renders.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/BacktestPopover.jsx app/renderer/src/app.css
git commit -m "feat(backtest): DETAIL body (setup cards with rationale + activity log + actions)"
```

---

### Task 19: Exclusive-mode placeholders for PREP / LIVE

**Files:**
- Modify: `app/renderer/src/Prep.jsx`
- Modify: `app/renderer/src/Live.jsx`

When a backtest is running, PREP and LIVE can't show meaningful live data (chart is in replay). Show a centered placeholder.

- [ ] **Step 1: Add a small `useBacktestRunning` hook**

In `app/renderer/src/hooks/useBacktest.js`, export a slim view of just the running state:

```js
export function useBacktestRunning() {
  // We can't reuse the full useBacktest hook (it would double-subscribe).
  // Lift to a singleton listener if needed. For simplicity, expose a
  // lightweight global event subscription that returns { running, session }.
  const [running, setRunning] = useState(false);
  const [session, setSession] = useState(null);
  useEffect(() => {
    const off = window.api.backtest.onEvent((e) => {
      if (e.type === "start") { setRunning(true); setSession(e.session); }
      if (e.type === "done" || e.type === "error") { setRunning(false); setSession(null); }
    });
    return off;
  }, []);
  return { running, session };
}
```

- [ ] **Step 2: Add the placeholder check at the top of `Prep.jsx` and `Live.jsx`**

```jsx
import { useBacktestRunning } from "./hooks/useBacktest.js";

export function Prep(props) {
  const { running, session } = useBacktestRunning();
  if (running) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--label)", letterSpacing: "0.22em", fontSize: "11px" }}>
        BACKTEST RUNNING · {sessionLabel(session)} — LIVE DATA UNAVAILABLE
      </div>
    );
  }
  // ... existing Prep body
}
```

Same change in `Live.jsx`.

- [ ] **Step 3: Manual smoke** — start a backtest, switch to PREP / LIVE tabs, see placeholder. Backtest completes, panels restore.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/Prep.jsx app/renderer/src/Live.jsx app/renderer/src/hooks/useBacktest.js
git commit -m "feat(backtest): exclusive-mode placeholders for PREP / LIVE while a run is active"
```

---

### Task 20: End-to-end manual smoke + finalize

**Files:** none (testing + CLAUDE.md update)

- [ ] **Step 1: Run the full unit test suite**

```bash
npm test 2>&1 | tail -12
```
Expected: all new tests pass; existing tests unchanged from Task 1 baseline.

- [ ] **Step 2: Run smoke fixtures**

```bash
npm run smoke:fixtures 2>&1 | tail -8
```
Expected: 16/16 pass (unchanged).

- [ ] **Step 3: Manual end-to-end run**

Boot the app (`npm run electron`). Click **BACKTEST** in topbar:
1. IDLE — fill in a known historical date (e.g. 2026-05-20), select NY-AM, AUTO mode. EST cost shows.
2. Click START — popover transitions to AUTO RUNNING. Progress bar advances.
3. Wait for completion — popover transitions to DONE. Summary shows.
4. Click OPEN DETAIL — DETAIL view renders with setups + activity log.
5. Click DELETE RUN — run removed, return to LIBRARY (now empty if it was the only run).
6. Run a second time in PAUSE mode — when a setup surfaces, ACCEPT/REJECT buttons work.
7. Check `state/backtest/<run-id>/` on disk — folder structure matches spec.
8. Check `state/session/` was NOT touched.

- [ ] **Step 4: Add architecture-decision row to CLAUDE.md**

In `CLAUDE.md` under the **Architecture decisions** table, append a row:

```markdown
| 2026-05-28 | Backtest popover (6 UI states, engine reuses live phase chain) | New `app/main/backtest-engine.js` orchestrates a per-run loop that drives `replay.start/step/stop`, invokes `sdk.userTurn({purpose, backtestContext})` with a writer override pointing at `state/backtest/<run-id>/<session>/`, and grades open trades via `app/main/backtest-grader.js` (stop-first on intra-bar conflict). Persistent memory writes are suppressed during a run (set/clearBacktestContext in `persistent-memory.js`). Renderer hosts a single `BacktestPopover.jsx` anchored to a new `BACKTEST` topbar cell (same recipe as `.claude-popover`); six states (IDLE / AUTO RUNNING / PAUSE AWAITING / DONE / LIBRARY / DETAIL) drive the view. Two modes: AUTO (LLM auto-accepts every surfaced setup) and PAUSE (run blocks on ACCEPT / REJECT). Replay anchor uses the `replay --at HH:MM` flag from PR #77. Cost shown as estimate on configure form; no hard ceiling. Spec: [docs/superpowers/specs/2026-05-28-backtest-popover-design.md](docs/superpowers/specs/2026-05-28-backtest-popover-design.md). Plan: [docs/superpowers/plans/2026-05-28-backtest-popover.md](docs/superpowers/plans/2026-05-28-backtest-popover.md). |
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: backtest popover architecture-decision row"
```

- [ ] **Step 6: Push branch + open PR**

```bash
git push -u origin feat/backtest-popover
gh pr create --title "feat(backtest): six-state popover that replays past sessions through the live phase chain" --body "$(cat <<'EOF'
## Summary
- New BACKTEST topbar cell + 880px popover (same recipe as CLAUDE / ALERTS) with six states: IDLE / AUTO RUNNING / PAUSE AWAITING / DONE / LIBRARY / DETAIL
- New engine in app/main/backtest-engine.js reuses sdk.userTurn unchanged; only the writer path differs (state/backtest/<run-id>/<session>/)
- AUTO mode auto-accepts every surfaced setup and auto-grades outcomes from bar high/low (stop-first on intra-bar conflict); PAUSE mode blocks on ACCEPT/REJECT per setup
- Persistent memory writes suppressed during a run so backtests are repeatable

## Test plan
- [x] Unit tests for store, grader, helpers, engine (mocked TV+SDK)
- [x] Smoke fixtures still 16/16
- [x] Manual: full run end-to-end on 2026-05-20 NY-AM in both modes, verified state/backtest/ folder shape and state/session/ untouched

Spec: docs/superpowers/specs/2026-05-28-backtest-popover-design.md
Plan: docs/superpowers/plans/2026-05-28-backtest-popover.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (do this before handing off)

After all 20 tasks land:

1. **Spec coverage:** Every section of the spec maps to a task:
   - State + persistence → Task 2 (store)
   - Outcome grading → Task 3 (grader)
   - State machine + UI → Tasks 4, 13-18
   - Memory suppression → Task 5
   - Cost / metrics → Task 6
   - SDK / writer override → Task 7
   - Engine lifecycle → Task 8
   - Engine setup/outcome integration → Task 9
   - Pause-on-setup flow → Task 10
   - IPC → Task 11
   - Hook → Task 12
   - Six UI states → Tasks 13, 14, 15, 16, 17, 18
   - Exclusive mode → Task 19
   - End-to-end + docs → Task 20

2. **Placeholder scan:** No "TBD" / "TODO" / "implement later" in any task. All code blocks are complete.

3. **Type consistency:**
   - `run_id` (snake_case) consistently used in store + engine + metrics
   - `runId` (camelCase) consistently used in JS code / function args
   - `backtestContext: { runId, sessionDir }` shape stays the same across tasks
   - `surfacedSetup` event shape (`{ id, side, entry, stop, tp1, model, grade }`) is consistent

4. **Implementation order:** Pure helpers first (Tasks 2-4), small existing-file mods (Tasks 5-7), engine core (Tasks 8-10), IPC + hook (Tasks 11-12), UI states (Tasks 13-18), integration (Tasks 19-20). Each task produces a committable, testable artifact.

---
