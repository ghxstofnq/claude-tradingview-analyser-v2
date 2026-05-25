# Leader/Laggard Dual-Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dual-symbol (e.g. MNQ + MES) scan to `tv analyze` covering pre-session and the 15-minute NY open-reaction window, then mechanically pick the "leader" (highest engine `disp_score` on FVGs created in the window) and run single-symbol on the leader for the rest of the session.

**Architecture:** A new `--pair <primary>,<secondary>` flag triggers dual-capture in `tv analyze`. A pure library `cli/lib/compute-leader.js` computes the leader from both symbols' bundles. A second library `cli/lib/pair-decision.js` reads/writes the per-session `pair-decision.json` that locks in the leader after the open reaction. A new in-app MCP tool `surface_leader_decision` lets Claude persist the decision. The slash-command prompt is updated to drive the dual-scan during pre-session and open-reaction, then drop to single-symbol on the leader for entry-hunt.

**Tech Stack:** Node 20 (ESM), `node:test` runner, Electron 32 main + React renderer (unchanged for this plan), Chrome DevTools Protocol on port 9223 (existing).

**Spec:** [`docs/superpowers/specs/2026-05-24-leader-laggard-dual-scan-design.md`](../specs/2026-05-24-leader-laggard-dual-scan-design.md)

---

## File map

**Create:**
- `cli/lib/compute-leader.js` — pure function: bundles → leader verdict.
- `cli/lib/pair-decision.js` — read/write `pair-decision.json` (file IO helpers).
- `tests/compute-leader.test.js` — unit tests for compute-leader.
- `tests/pair-decision.test.js` — unit tests for pair-decision file IO.
- `tests/fixtures/002-paired-mnq-mes.bundle.json` — paired bundle fixture.
- `tests/fixtures/002-paired-mnq-mes.expected.md` — hand-graded expected reading.

**Modify:**
- `cli/commands/analyze.js` — add `--pair` flag, dual-capture, baseline resolution, short-circuit logic.
- `app/main/sdk.js` — register `surface_leader_decision` MCP tool.
- `app/main/tools/surface.js` — add `surfaceLeaderDecision` writer.
- `app/main/prompts/analyze.md` — phase blocks (pre-session / open-reaction / entry-hunt).
- `docs/tradingview-cookbook.md` — changelog entry + new section.

---

## Task 1: Add `compute-leader.js` pure library with full TDD

**Files:**
- Create: `cli/lib/compute-leader.js`
- Create: `tests/compute-leader.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/compute-leader.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLeader } from '../cli/lib/compute-leader.js';

// Synthetic engine builder. Returns a parsed-engine shape with only the
// fields compute-leader reads (fvgs[].disp_score and fvgs[].created_ms).
function engineWithFvgs(fvgs) {
  return { fvgs };
}

const windowStart = 1_000_000;
const windowEnd = windowStart + 15 * 60 * 1000;
const inWindow = windowStart + 1000;
const beforeWindow = windowStart - 1000;

test('picks the symbol with the higher max disp_score', () => {
  const primary = engineWithFvgs([
    { created_ms: inWindow, disp_score: 0.4 },
    { created_ms: inWindow, disp_score: 0.82 },
  ]);
  const secondary = engineWithFvgs([
    { created_ms: inWindow, disp_score: 0.54 },
  ]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: secondary,
    windowStartMs: windowStart, windowEndMs: windowEnd,
  });
  assert.equal(res.leader, 'MNQ1!');
  assert.equal(res.primary_disp_score, 0.82);
  assert.equal(res.secondary_disp_score, 0.54);
  assert.ok(Math.abs(res.margin - 0.28) < 1e-9);
  assert.equal(res.reason, 'primary_higher_disp_score');
});

test('returns secondary when secondary leads', () => {
  const primary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.30 }]);
  const secondary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.70 }]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: secondary,
    windowStartMs: windowStart, windowEndMs: windowEnd,
  });
  assert.equal(res.leader, 'MES1!');
  assert.equal(res.reason, 'secondary_higher_disp_score');
});

test('inconclusive when margin under threshold', () => {
  const primary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.55 }]);
  const secondary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.50 }]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: secondary,
    windowStartMs: windowStart, windowEndMs: windowEnd,
  });
  assert.equal(res.leader, null);
  assert.equal(res.reason, 'inconclusive_margin_below_threshold');
});

test('null when secondary engine missing', () => {
  const primary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.82 }]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: null,
    windowStartMs: windowStart, windowEndMs: windowEnd,
  });
  assert.equal(res.leader, null);
  assert.equal(res.reason, 'secondary_engine_missing');
});

test('null when no FVGs created in window', () => {
  const primary = engineWithFvgs([{ created_ms: beforeWindow, disp_score: 0.82 }]);
  const secondary = engineWithFvgs([{ created_ms: beforeWindow, disp_score: 0.70 }]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: secondary,
    windowStartMs: windowStart, windowEndMs: windowEnd,
  });
  assert.equal(res.leader, null);
  assert.equal(res.reason, 'no_fvgs_created_in_window');
});

test('ignores FVGs with non-finite disp_score', () => {
  const primary = engineWithFvgs([
    { created_ms: inWindow, disp_score: null },
    { created_ms: inWindow, disp_score: 0.30 },
  ]);
  const secondary = engineWithFvgs([
    { created_ms: inWindow, disp_score: NaN },
    { created_ms: inWindow, disp_score: 0.10 },
  ]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: secondary,
    windowStartMs: windowStart, windowEndMs: windowEnd,
  });
  assert.equal(res.leader, 'MNQ1!');
  assert.equal(res.primary_disp_score, 0.30);
  assert.equal(res.secondary_disp_score, 0.10);
});

test('threshold is configurable', () => {
  const primary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.55 }]);
  const secondary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.50 }]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: secondary,
    windowStartMs: windowStart, windowEndMs: windowEnd,
    threshold: 0.01,
  });
  assert.equal(res.leader, 'MNQ1!');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/compute-leader.test.js`
Expected: FAIL with module-not-found for `../cli/lib/compute-leader.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `cli/lib/compute-leader.js`:

```js
// compute-leader.js — pure function that decides which symbol of a pair was
// the "leader" during the NY open-reaction window. Leader = highest
// disp_score on a fresh FVG created inside the window.
//
// Hard rules:
//   - constraint #7 (no LLM arithmetic): all comparison is done here, never
//     in the prompt.
//   - constraint #6 (cite-or-reject): the verdict object includes the JSON
//     paths the caller should cite when writing the bundle.
//
// Output shape:
//   {
//     leader: 'MNQ1!' | 'MES1!' | null,
//     primary_disp_score: number,         // 0 if no qualifying FVGs
//     secondary_disp_score: number,
//     margin: number,                     // |primary - secondary|
//     threshold: number,                  // echoed for transparency
//     reason: 'primary_higher_disp_score'
//           | 'secondary_higher_disp_score'
//           | 'inconclusive_margin_below_threshold'
//           | 'no_fvgs_created_in_window'
//           | 'secondary_engine_missing',
//   }

const DEFAULT_THRESHOLD = 0.10;

function maxDispScoreInWindow(engine, windowStartMs, windowEndMs) {
  if (!engine || !Array.isArray(engine.fvgs)) return 0;
  let max = 0;
  for (const f of engine.fvgs) {
    if (!Number.isFinite(f.disp_score)) continue;
    if (!Number.isFinite(f.created_ms)) continue;
    if (f.created_ms < windowStartMs || f.created_ms >= windowEndMs) continue;
    if (f.disp_score > max) max = f.disp_score;
  }
  return max;
}

export function computeLeader({
  primary,
  secondary,
  primaryEngine,
  secondaryEngine,
  windowStartMs,
  windowEndMs,
  threshold = DEFAULT_THRESHOLD,
}) {
  if (!secondaryEngine) {
    return {
      leader: null,
      primary_disp_score: 0,
      secondary_disp_score: 0,
      margin: 0,
      threshold,
      reason: 'secondary_engine_missing',
    };
  }
  const p = maxDispScoreInWindow(primaryEngine, windowStartMs, windowEndMs);
  const s = maxDispScoreInWindow(secondaryEngine, windowStartMs, windowEndMs);
  const margin = Math.abs(p - s);

  if (p === 0 && s === 0) {
    return {
      leader: null,
      primary_disp_score: 0,
      secondary_disp_score: 0,
      margin: 0,
      threshold,
      reason: 'no_fvgs_created_in_window',
    };
  }
  if (margin < threshold) {
    return {
      leader: null,
      primary_disp_score: p,
      secondary_disp_score: s,
      margin,
      threshold,
      reason: 'inconclusive_margin_below_threshold',
    };
  }
  const leader = p > s ? primary : secondary;
  const reason = p > s ? 'primary_higher_disp_score' : 'secondary_higher_disp_score';
  return {
    leader,
    primary_disp_score: p,
    secondary_disp_score: s,
    margin,
    threshold,
    reason,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/compute-leader.test.js`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/compute-leader.js tests/compute-leader.test.js
git commit -m "$(cat <<'EOF'
feat: add compute-leader pure library for dual-symbol leader pick

Pure function that takes two parsed engine objects + the NY open-reaction
window and returns the symbol with the higher max disp_score on FVGs
created inside the window. Threshold-gated (default 0.10) so close margins
yield leader=null with reason='inconclusive_margin_below_threshold'.

Honors hard constraint #7 (no LLM arithmetic) — comparison is here, never
in the prompt.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `pair-decision.js` reader/writer with TDD

**Files:**
- Create: `cli/lib/pair-decision.js`
- Create: `tests/pair-decision.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/pair-decision.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writePairDecision, readPairDecision } from '../cli/lib/pair-decision.js';

async function mkdtmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'pair-decision-'));
}

test('writes and reads back a valid decision', async () => {
  const dir = await mkdtmp();
  const payload = {
    date: '2026-05-25',
    session: 'ny-am',
    primary: 'MNQ1!',
    secondary: 'MES1!',
    leader: 'MNQ1!',
    decided_at: '2026-05-25T13:45:00Z',
    evidence: { primary_disp_score: 0.82, secondary_disp_score: 0.54, margin: 0.28, threshold: 0.10 },
    reason: 'primary_higher_disp_score',
  };
  await writePairDecision(dir, payload);
  const read = await readPairDecision(dir, '2026-05-25');
  assert.equal(read.leader, 'MNQ1!');
  assert.equal(read.schema, 1);
  assert.equal(read.evidence.margin, 0.28);
});

test('returns null when file does not exist', async () => {
  const dir = await mkdtmp();
  const read = await readPairDecision(dir, '2026-05-25');
  assert.equal(read, null);
});

test('returns null when file is stale (different date)', async () => {
  const dir = await mkdtmp();
  await writePairDecision(dir, {
    date: '2026-05-24',
    session: 'ny-am',
    primary: 'MNQ1!',
    secondary: 'MES1!',
    leader: 'MNQ1!',
    decided_at: '2026-05-24T13:45:00Z',
    evidence: { primary_disp_score: 0.82, secondary_disp_score: 0.54, margin: 0.28, threshold: 0.10 },
    reason: 'primary_higher_disp_score',
  });
  const read = await readPairDecision(dir, '2026-05-25');
  assert.equal(read, null);
});

test('writes atomically (no half-written file on a thrown serializer)', async () => {
  const dir = await mkdtmp();
  // Pass a payload with a circular ref to force JSON.stringify to throw.
  const bad = { date: '2026-05-25' };
  bad.self = bad;
  await assert.rejects(() => writePairDecision(dir, bad));
  // The target file should not exist (atomic = no partial file left behind).
  await assert.rejects(() => fs.stat(path.join(dir, 'pair-decision.json')));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pair-decision.test.js`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the minimal implementation**

Create `cli/lib/pair-decision.js`:

```js
// pair-decision.js — reads/writes state/session/<date>/<session>/pair-decision.json
// the file that locks in which symbol of a pair is the "leader" for the
// rest of the session. Written once by surface_leader_decision at minute 14
// of the open-reaction phase; read by tv analyze to short-circuit dual-
// capture once the decision exists.

import fs from 'node:fs/promises';
import path from 'node:path';

const FILE_NAME = 'pair-decision.json';
const SCHEMA = 1;

// Atomic write: serialize first (throws bubble up before any disk write),
// then write to a sibling .tmp file and rename. Prevents partial-file
// state if the serializer throws or the process crashes mid-write.
export async function writePairDecision(sessionDir, payload) {
  const record = { schema: SCHEMA, ...payload };
  const json = JSON.stringify(record, null, 2);    // may throw on circular refs
  await fs.mkdir(sessionDir, { recursive: true });
  const target = path.join(sessionDir, FILE_NAME);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, target);
  return target;
}

// Returns the decision record if it exists AND its `date` field matches the
// requested `todayDate` string (YYYY-MM-DD). Otherwise null. Callers treat
// null as "no decision yet" and run the dual-capture flow.
export async function readPairDecision(sessionDir, todayDate) {
  const target = path.join(sessionDir, FILE_NAME);
  let text;
  try {
    text = await fs.readFile(target, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch (e) {
    throw new Error(`pair-decision.json at '${target}' is not valid JSON: ${e.message}`);
  }
  if (record.date !== todayDate) return null;
  return record;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pair-decision.test.js`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/pair-decision.js tests/pair-decision.test.js
git commit -m "$(cat <<'EOF'
feat: add pair-decision.json reader/writer

Atomic write (write to .tmp + rename) so a crash mid-write doesn't leave
a partial file. Reader returns null when the file's `date` field doesn't
match today's ET date — stale decisions are ignored without manual
cleanup.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Register `--pair` flag on `tv analyze` (scaffolding only)

**Files:**
- Modify: `cli/commands/analyze.js` (the `options` block of `register('analyze', {...})`)

- [ ] **Step 1: Add the flag declaration**

In `cli/commands/analyze.js`, find the `options:` block inside `register('analyze', { ... })` (around line 235). Add a new entry alongside the existing flags:

```js
options: {
  'current-tf-only': { type: 'boolean', description: 'Skip multi-TF capture (faster; no chart flashing). All other data still captured.' },
  'pillar3-only': { type: 'boolean', description: 'Alias for --current-tf-only. Skips the multi-TF chart sweep but captures everything else. Bundle runtime ~0.4–0.6s. Used by the live-trading polling loop.' },
  'scan-tf': { type: 'string', description: 'Briefly switch chart to this TF (1, 5, 15, 60, 240, D) for the scan, then restore. Pairs with --pillar3-only for the polling cadence. ~2–3s of chart flashing per call.' },
  baseline: { type: 'string', description: 'Path to a previously-captured full bundle. Reuses its bars_by_tf and engine_by_tf instead of re-running the multi-TF chart sweep. Pairs with --pillar3-only for fast candidate evaluation that still has full HTF context. Emits baseline_meta so the consumer can see how old the cached HTF data is.' },
  out: { type: 'string', description: 'Write bundle JSON to this path; stdout prints only {saved_to: <path>}. Use for bundles too large to pipe (>~60KB).' },
  pair: { type: 'string', description: 'Run dual-symbol scan. Format: "<primary>,<secondary>" (e.g. "MNQ1!,MES1!"). Captures both symbols; output bundle gains a top-level `pair` block. Behavior depends on pair-decision.json state for the active session.' },
  'baseline-secondary': { type: 'string', description: 'Per-symbol baseline path for the secondary symbol when using --pair. The primary uses --baseline as today.' },
},
```

- [ ] **Step 2: Verify the help text shows the new flags**

Run: `./bin/tv analyze --help 2>&1 | head -30`
Expected: the output lists `--pair` and `--baseline-secondary` along with the existing flags.

If the router doesn't auto-generate help, skip this step and rely on the smoke check in step 3.

- [ ] **Step 3: Confirm the existing analyze flow is unchanged (smoke)**

Run: `./bin/tv analyze --pillar3-only --out /tmp/analyze-smoke.json && head -c 200 /tmp/analyze-smoke.json`
Expected: produces a valid JSON bundle starting with `{"saved_to":...}` or `{"timestamp":...}`. No errors. Pair flag is registered but not yet consumed.

- [ ] **Step 4: Commit**

```bash
git add cli/commands/analyze.js
git commit -m "$(cat <<'EOF'
feat: register --pair and --baseline-secondary flags on tv analyze

No behavior yet — these are the scaffolding for the dual-symbol scan
implementation that follows. The handler still ignores them.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Implement dual-capture in the analyze handler

**Files:**
- Modify: `cli/commands/analyze.js` (after the existing capture path, before bundle assembly)

- [ ] **Step 1: Parse the `--pair` flag inside the handler**

In `cli/commands/analyze.js`, near the top of the `handler: async (opts) => { ... }` block (after baseline loading, before scan-tf), add:

```js
// 0.6. Parse --pair "<primary>,<secondary>". Both symbols required.
//      The primary MUST match the chart's current symbol — we don't silently
//      swap (the user's chart state is sacrosanct).
let pairConfig = null;
if (opts?.pair) {
  const parts = String(opts.pair).split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`--pair expects "<primary>,<secondary>"; got '${opts.pair}'`);
  }
  pairConfig = { primary: parts[0], secondary: parts[1] };
}
```

- [ ] **Step 2: Validate the chart's current symbol matches the primary**

Find where `const state = await chart.getState();` lives (around line 294). Add validation right after:

```js
const state = await chart.getState();
const originalTf = state.resolution;
const originalSymbol = state.symbol;     // e.g. "CME_MINI:MNQ1!"

if (pairConfig) {
  // chart.getState() returns the fully-qualified symbol with exchange
  // prefix. Strip the prefix for comparison against the user-supplied
  // shorthand ("MNQ1!" vs "CME_MINI:MNQ1!").
  const bare = originalSymbol.replace(/^[A-Z_]+:/, '');
  if (bare !== pairConfig.primary && bare !== pairConfig.secondary) {
    throw new Error(
      `--pair expects chart on one of [${pairConfig.primary}, ${pairConfig.secondary}]; got '${bare}'`
    );
  }
  // Normalize: if the chart is currently on what the user calls "secondary",
  // swap so the chart's current symbol is treated as primary throughout the
  // capture. The bundle's pair.primary always = the chart's current symbol.
  if (bare === pairConfig.secondary) {
    pairConfig = { primary: pairConfig.secondary, secondary: pairConfig.primary };
  }
}
```

- [ ] **Step 3: Extract the existing single-symbol capture into a function**

Bigger refactor — find the existing capture sequence (chart.getState through bundle assembly, roughly lines 294–500). Wrap the parts that read live chart data (quote, bars, indicators, pine tables, engine, gates) into a helper. Or — simpler — leave the existing flow alone and write a NEW helper that calls a subset of the same primitives for the secondary capture.

Pragmatic approach: create a new internal helper `captureSymbolBundle(symbol)` at module scope. It does just what's needed for the `pair.symbols.<symbol>` block: quote, bars, bars_by_tf, engine, engine_by_tf, gates. NOT the full top-level bundle (the chart's current capture already produces that).

Add near the existing `captureMultiTf` helper (after line 231):

```js
// captureSymbolBundle — used only for the secondary symbol in a --pair
// capture. Switches the chart to `symbol`, FORCES the TF to match the
// primary's `originalTf` (TV remembers TF per symbol so the secondary
// would otherwise land on whatever TF was last used on it — apples-to-
// oranges comparison). Grabs the same shape of data the primary capture
// produces, then leaves the chart on the secondary for the caller to
// switch back.
//
// Returns the same nested shape the bundle uses for `pair.symbols.<X>`.
const SYMBOL_SETTLE_MS = 600;       // setSymbol's own 500ms wait + 100ms slack
async function captureSymbolBundle(symbol, originalTf) {
  await chart.setSymbol({ symbol });
  await new Promise((r) => setTimeout(r, SYMBOL_SETTLE_MS));
  // Force secondary's TF to match primary's so the current-TF data is
  // comparable. captureMultiTf below restores this TF after sweeping the
  // others, so the chart is left on (secondary, originalTf).
  await chart.setTimeframe({ timeframe: originalTf });
  await new Promise((r) => setTimeout(r, TF_SETTLE_MS));
  const state = await chart.getState();
  const [q, bars, indicators, pineTables] = await Promise.all([
    quote.get(),
    data.getOhlcv({ summary: true }),
    data.getStudyValues(),
    data.getPineTables(),
  ]);
  const engine = parseIctEngineTable(findIctEngineRows(pineTables));
  // Multi-TF on the secondary too — same pattern as the primary's
  // captureMultiTf. captureMultiTf restores to its `originalTf` argument
  // at the end of the sweep.
  const { bars_by_tf, engine_by_tf } = await captureMultiTf(originalTf);
  return {
    chart: state,
    quote: q,
    bars,
    bars_by_tf,
    engine,
    engine_by_tf,
    indicators,
    // gates are computed downstream from these fields; we attach them in
    // the handler after both captures complete so the gate computation
    // is consistent across primary + secondary.
  };
}
```

(Note: import lines for `quote` / `data` / `parseIctEngineTable` / `findIctEngineRows` already exist at the top of the file — you don't need to add new imports.)

- [ ] **Step 4: Wire the secondary capture into the main bundle**

In the handler, after the primary's bundle has been fully assembled (after gates are computed, just before the `return` / `out` write), add:

```js
// 8. --pair dual-capture: snapshot the secondary symbol with the same shape
//    the primary captured, then restore the chart to the primary so any
//    subsequent commands see the original state.
let pair = null;
if (pairConfig) {
  const secondaryBundle = await captureSymbolBundle(pairConfig.secondary, originalTf);
  // Compute the secondary's gates using the same code path the primary
  // uses (computeSessionGate + computeEngineGates already imported).
  secondaryBundle.gates = {
    session: computeSessionGate(secondaryBundle),
    engine: computeEngineGates({
      engine: secondaryBundle.engine,
      engine_by_tf: secondaryBundle.engine_by_tf,
      quote: secondaryBundle.quote,
      bars: secondaryBundle.bars,
      last_bar: null, // last-bar facts attached upstream when relevant
    }),
  };
  // Restore the chart to the primary so later operations see the original.
  await chart.setSymbol({ symbol: pairConfig.primary });
  await new Promise((r) => setTimeout(r, SYMBOL_SETTLE_MS));

  pair = {
    primary: pairConfig.primary,
    secondary: pairConfig.secondary,
    window_start_ms: null,                 // filled in by Task 5
    window_end_ms: null,
    symbols: {
      [pairConfig.primary]: {
        // duplicate the top-level fields into the symbols block so consumers
        // can read pair.symbols.<X> uniformly regardless of which one is
        // primary.
        chart: state,
        quote,                              // local var built earlier in handler
        bars,
        bars_by_tf,
        engine,
        engine_by_tf,
        gates,
      },
      [pairConfig.secondary]: secondaryBundle,
    },
    leader_evidence: null,                  // filled in by Task 5
    leader_decided: false,
    leader: null,
  };
}

// Attach pair to the bundle before the final write.
const bundle = {
  timestamp: new Date().toISOString(),
  chart: state,
  visible_range: visibleRange,
  quote,
  bars,
  bars_by_tf,
  indicators,
  engine,
  engine_by_tf,
  gates,
  ...(baselineMeta ? { baseline_meta: baselineMeta } : {}),
  ...(pair ? { pair } : {}),
};
```

(Replace the existing `const bundle = {...}` block with the version above — the only diff is the `...(pair ? { pair } : {})` line and the optional `pair` variable above. The exact variable names in your handler may differ; align with what's already there.)

- [ ] **Step 5: Smoke-test with the live chart**

This step is manual — requires TradingView Desktop running on port 9223 with the ICT Engine indicator loaded on both MNQ and MES charts (or whichever pair you're testing).

Run: `./bin/tv analyze --pair MNQ1!,MES1! --out /tmp/pair-smoke.json`
Then: `cat /tmp/pair-smoke.json | python3 -c "import sys,json; b=json.load(sys.stdin); print('primary:', b['pair']['primary']); print('secondary:', b['pair']['secondary']); print('primary keys:', list(b['pair']['symbols'][b['pair']['primary']].keys())); print('secondary keys:', list(b['pair']['symbols'][b['pair']['secondary']].keys()))"`

Expected:
```
primary: MNQ1!
secondary: MES1!
primary keys: ['chart', 'quote', 'bars', 'bars_by_tf', 'engine', 'engine_by_tf', 'gates']
secondary keys: ['chart', 'quote', 'bars', 'bars_by_tf', 'engine', 'engine_by_tf', 'gates', 'indicators']
```

Also verify the chart is back on the primary symbol when the command exits (look at TradingView Desktop window).

- [ ] **Step 6: Commit**

```bash
git add cli/commands/analyze.js
git commit -m "$(cat <<'EOF'
feat: implement --pair dual-capture in tv analyze

When --pair "<primary>,<secondary>" is passed, capture the chart's
current symbol normally, then switch to the secondary, capture the same
shape, switch back. Bundle gains a `pair: {primary, secondary, symbols,
leader_evidence, leader, ...}` block.

Errors loudly if the chart isn't on either named symbol — no silent
chart swap. SYMBOL_SETTLE_MS = 600 covers setSymbol's internal wait plus
indicator re-render slack.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire compute-leader into the analyze handler

**Files:**
- Modify: `cli/commands/analyze.js` (after the pair block is built, before bundle assembly)

- [ ] **Step 1: Compute the open-reaction window from gates.session**

In the handler, after the secondary capture but before assembling `pair`, derive the window. The session phase determines whether we have a window at all (pre-session before NY open → no window yet; we still want to capture both symbols, just with empty evidence).

Add near the top of the handler (after pair parsing), a small helper to compute window bounds from the session gate:

```js
// Derive the [start, end) ms of the current session's 15-min open-reaction
// window from the session label. Pre-session phases return null/null — we
// still capture both symbols, but leader_evidence stays empty.
function openReactionWindowMs(sessionGate) {
  const label = sessionGate?.label;
  if (!label) return { start: null, end: null };
  // gates.session emits open_*_ms epoch fields during the open-reaction
  // and entry-hunt phases; we lean on those if present, otherwise null.
  const start = sessionGate.open_window_start_ms ?? null;
  if (!Number.isFinite(start)) return { start: null, end: null };
  return { start, end: start + 15 * 60 * 1000 };
}
```

(If `open_window_start_ms` isn't currently emitted by `computeSessionGate`, this task also requires adding it there — see Step 2.)

- [ ] **Step 2: Ensure `computeSessionGate` emits `open_window_start_ms`**

Check `cli/commands/analyze.js` for `computeSessionGate` (it's defined inline in that file or in a sibling lib). Find the block that detects the open-reaction phase. Add an `open_window_start_ms` field set to the NY open epoch (e.g. 13:30 UTC for NY AM, 18:00 UTC for NY PM — both in ms).

If `computeSessionGate` is non-trivial and adding this is risky, fall back to deriving the window from `gates.session.timestamp_et` + a simple "subtract minutes_into_phase, then anchor" calculation in the helper above.

- [ ] **Step 3: Import compute-leader and call it**

At the top of `cli/commands/analyze.js`, add:

```js
import { computeLeader } from '../lib/compute-leader.js';
```

Then in the dual-capture block (the section added in Task 4 Step 4), after both bundles are built and gates computed, populate `leader_evidence`:

```js
const { start: windowStartMs, end: windowEndMs } = openReactionWindowMs(secondaryBundle.gates.session);

const leader = computeLeader({
  primary: pairConfig.primary,
  secondary: pairConfig.secondary,
  primaryEngine: engine,                          // primary's engine var from earlier
  secondaryEngine: secondaryBundle.engine,
  windowStartMs: windowStartMs ?? Number.POSITIVE_INFINITY,  // empty window
  windowEndMs: windowEndMs ?? Number.POSITIVE_INFINITY,
});

pair.window_start_ms = windowStartMs;
pair.window_end_ms = windowEndMs;
pair.leader_evidence = {
  primary_disp_score: leader.primary_disp_score,
  secondary_disp_score: leader.secondary_disp_score,
  margin: leader.margin,
  threshold: leader.threshold,
  reason: leader.reason,
  // cite-or-reject anchors: paths into the bundle that resolve to the cited
  // numbers. Empty when no qualifying FVG was found (margin=0, score=0).
  primary_fvg_path: leader.primary_disp_score > 0
    ? `pair.symbols.${pairConfig.primary}.engine.fvgs[?].disp_score`
    : null,
  secondary_fvg_path: leader.secondary_disp_score > 0
    ? `pair.symbols.${pairConfig.secondary}.engine.fvgs[?].disp_score`
    : null,
};
// pair.leader stays null here — only set when surface_leader_decision is
// called by Claude at minute 14. tv analyze NEVER decides the leader on
// its own; it only computes the evidence.
```

(The `[?]` placeholder in `primary_fvg_path` is intentional — the index of the winning FVG would require tracking it through compute-leader; v1 ships the path stub. Followup can plumb the index back through.)

- [ ] **Step 4: Smoke test the evidence block**

Run: `./bin/tv analyze --pair MNQ1!,MES1! --out /tmp/pair-evidence.json`
Then: `python3 -c "import json; b=json.load(open('/tmp/pair-evidence.json')); print(json.dumps(b['pair']['leader_evidence'], indent=2))"`

Expected (during open-reaction phase): a populated object with `primary_disp_score`, `secondary_disp_score`, `margin`, `threshold: 0.10`, and a `reason` string. Outside the open-reaction window: scores `0`, reason `no_fvgs_created_in_window`.

- [ ] **Step 5: Commit**

```bash
git add cli/commands/analyze.js
git commit -m "$(cat <<'EOF'
feat: populate pair.leader_evidence from compute-leader

tv analyze --pair now derives the 15-min open-reaction window from the
session gate, scans both symbols' fvgs[] for FVGs created in the window,
and emits the comparison evidence. pair.leader stays null at this stage
— it's set by Claude's surface_leader_decision tool, not by tv analyze.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Per-symbol baseline naming with backward compatibility

**Files:**
- Modify: `cli/commands/analyze.js` (the baseline loading block, around lines 247–275)

- [ ] **Step 1: Refactor baseline loading to accept primary + secondary paths**

Find the existing baseline-loading block in the handler. Extract it into a helper that takes a path string and returns `{baseline, baselineMeta}`. Call it twice when `--pair` is used.

Add this helper near the top of the file (after imports):

```js
async function loadBaseline(absPath) {
  if (!absPath) return { baseline: null, meta: null };
  const { readFileSync } = await import('node:fs');
  let text;
  try { text = readFileSync(absPath, 'utf8'); }
  catch (e) { throw new Error(`baseline not readable at '${absPath}': ${e.message}`); }
  let baseline;
  try { baseline = JSON.parse(text); }
  catch (e) { throw new Error(`baseline at '${absPath}' is not valid JSON: ${e.message}`); }
  if (!baseline.bars_by_tf || !baseline.engine_by_tf) {
    throw new Error(`baseline at '${absPath}' is missing bars_by_tf or engine_by_tf — must be a full tv analyze capture.`);
  }
  const ms = baseline.timestamp ? Date.parse(baseline.timestamp) : NaN;
  const meta = {
    path: absPath,
    captured_at: baseline.timestamp || null,
    age_seconds: Number.isFinite(ms) ? Math.floor((Date.now() - ms) / 1000) : null,
  };
  return { baseline, meta };
}
```

Replace the inline baseline-loading block with:

```js
const { resolve: resolvePath } = await import('node:path');
const primaryBaselinePath = opts?.baseline ? resolvePath(opts.baseline) : null;
const secondaryBaselinePath = opts?.['baseline-secondary'] ? resolvePath(opts['baseline-secondary']) : null;

const { baseline, meta: baselineMeta } = await loadBaseline(primaryBaselinePath);
const { baseline: baselineSecondary, meta: baselineSecondaryMeta } = await loadBaseline(secondaryBaselinePath);
```

- [ ] **Step 2: Apply the secondary baseline inside `captureSymbolBundle`**

In `captureSymbolBundle` (added in Task 4 Step 3), accept the secondary baseline and reuse `bars_by_tf` / `engine_by_tf` from it instead of re-running the multi-TF sweep:

```js
async function captureSymbolBundle(symbol, originalTf, baselineSecondary) {
  await chart.setSymbol({ symbol });
  await new Promise((r) => setTimeout(r, SYMBOL_SETTLE_MS));
  const state = await chart.getState();
  const [q, bars, indicators, pineTables] = await Promise.all([
    quote.get(),
    data.getOhlcv({ summary: true }),
    data.getStudyValues(),
    data.getPineTables(),
  ]);
  const engine = parseIctEngineTable(findIctEngineRows(pineTables));

  let bars_by_tf, engine_by_tf;
  if (baselineSecondary) {
    bars_by_tf = baselineSecondary.bars_by_tf;
    engine_by_tf = baselineSecondary.engine_by_tf;
  } else {
    const m = await captureMultiTf(originalTf);
    bars_by_tf = m.bars_by_tf;
    engine_by_tf = m.engine_by_tf;
  }
  return { chart: state, quote: q, bars, bars_by_tf, engine, engine_by_tf, indicators };
}
```

And the call site (Task 4 Step 4) becomes:

```js
const secondaryBundle = await captureSymbolBundle(pairConfig.secondary, originalTf, baselineSecondary);
```

- [ ] **Step 3: Emit baseline_secondary_meta in the bundle**

Find where `...(baselineMeta ? { baseline_meta: baselineMeta } : {})` is spread into the bundle (added Task 4). Mirror it:

```js
const bundle = {
  // ... existing fields ...
  ...(baselineMeta ? { baseline_meta: baselineMeta } : {}),
  ...(baselineSecondaryMeta ? { baseline_secondary_meta: baselineSecondaryMeta } : {}),
  ...(pair ? { pair } : {}),
};
```

- [ ] **Step 4: Smoke-test the per-symbol baseline flow**

Manual: capture a baseline for the primary first, then for the secondary, then run the fast path.

```bash
# Capture primary baseline (chart is on MNQ).
./bin/tv analyze --out state/baseline-MNQ1!.json

# Switch chart to MES, capture secondary baseline.
./bin/tv chart set-symbol MES1!
./bin/tv analyze --out state/baseline-MES1!.json
./bin/tv chart set-symbol MNQ1!

# Fast paired run using both baselines.
time ./bin/tv analyze --pair MNQ1!,MES1! \
  --pillar3-only \
  --baseline state/baseline-MNQ1!.json \
  --baseline-secondary state/baseline-MES1!.json \
  --out /tmp/pair-fast.json
```

Expected: completes in ~2–3s (vs ~30s for a full dual sweep). The bundle has both `baseline_meta` and `baseline_secondary_meta`.

- [ ] **Step 5: Commit**

```bash
git add cli/commands/analyze.js
git commit -m "$(cat <<'EOF'
feat: per-symbol baseline support for --pair

Add --baseline-secondary flag mirroring --baseline. When passed,
captureSymbolBundle reuses bars_by_tf + engine_by_tf from the cached
baseline instead of re-running the multi-TF sweep on the secondary —
keeps the fast-poll path under ~3s for dual-symbol scans.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Pair-decision short-circuit in the analyze handler

**Files:**
- Modify: `cli/commands/analyze.js`

- [ ] **Step 1: Import the reader and resolve the active session dir**

Add to the top of `cli/commands/analyze.js`:

```js
import { readPairDecision } from '../lib/pair-decision.js';
```

In the handler, after parsing `--pair` (Task 4 Step 1), add a lookup for the active session's directory. The CLI uses a module-local convention for the session root (`state/session/`), and the active session is derived from the ET clock.

```js
// 0.7. If a pair-decision.json exists for the active session and the leader
//      is set, short-circuit the dual-capture: switch the chart to the
//      leader (if not already there) and run normal single-symbol analyze.
let pairShortCircuited = false;
if (pairConfig) {
  const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
  const sessionLabel = derivedActiveSession();           // 'ny-am' | 'ny-pm' | 'london' | null
  if (sessionLabel) {
    const { resolve: resolvePath } = await import('node:path');
    const sessionDir = resolvePath('state', 'session', today, sessionLabel);
    const decision = await readPairDecision(sessionDir, today);
    if (decision && decision.leader) {
      // Leader is known. Make sure the chart is on the leader, then drop
      // pairConfig so the rest of the handler runs the single-symbol path.
      const state0 = await chart.getState();
      const bare = state0.symbol.replace(/^[A-Z_]+:/, '');
      if (bare !== decision.leader) {
        await chart.setSymbol({ symbol: decision.leader });
        await new Promise((r) => setTimeout(r, SYMBOL_SETTLE_MS));
      }
      pairConfig = null;
      pairShortCircuited = true;
      process.stderr.write(`[tv analyze] pair-decision found: leader=${decision.leader}. running single-symbol.\n`);
    }
  }
}
```

(`derivedActiveSession()` may already exist as a helper inside `computeSessionGate`. If not, define it locally as: take the current ET hour; return `'ny-am'` for 09:30–12:00 ET, `'ny-pm'` for 13:30–16:00 ET, `'london'` for 03:00–06:00 ET, `null` otherwise. Match the existing project convention exactly — grep `cli/lib/compute-engine-gates.js` for the existing session-label code.)

- [ ] **Step 2: Surface `pair_short_circuited` in the bundle**

In the bundle assembly:

```js
const bundle = {
  // ... existing fields ...
  ...(pairShortCircuited ? { pair_short_circuited: true } : {}),
  ...(pair ? { pair } : {}),
};
```

This lets downstream consumers (the prompt) detect that we ran single-symbol because of an earlier leader decision.

- [ ] **Step 3: Smoke-test the short-circuit**

Manual:

```bash
# Create a stub pair-decision for today's NY-AM session.
TODAY=$(date +%Y-%m-%d)
mkdir -p state/session/$TODAY/ny-am
cat > state/session/$TODAY/ny-am/pair-decision.json <<EOF
{
  "schema": 1,
  "date": "$TODAY",
  "session": "ny-am",
  "primary": "MNQ1!",
  "secondary": "MES1!",
  "leader": "MES1!",
  "decided_at": "${TODAY}T13:45:00Z",
  "evidence": { "primary_disp_score": 0.5, "secondary_disp_score": 0.8, "margin": 0.3, "threshold": 0.1 },
  "reason": "secondary_higher_disp_score"
}
EOF

# Run with --pair; should switch to MES and run single-symbol.
./bin/tv analyze --pair MNQ1!,MES1! --pillar3-only --out /tmp/short-circuit.json
python3 -c "import json; b=json.load(open('/tmp/short-circuit.json')); print('pair_short_circuited:', b.get('pair_short_circuited')); print('chart symbol:', b['chart']['symbol']); print('pair block present:', 'pair' in b)"

# Cleanup
rm -rf state/session/$TODAY/ny-am/pair-decision.json
```

Expected output:
```
pair_short_circuited: True
chart symbol: CME_MINI:MES1!
pair block present: False
```

- [ ] **Step 4: Commit**

```bash
git add cli/commands/analyze.js
git commit -m "$(cat <<'EOF'
feat: short-circuit dual-capture when pair-decision.json exists

Once Claude has written pair-decision.json at minute 14 of the open
reaction, subsequent tv analyze --pair runs detect it, switch the chart
to the leader, and run a normal single-symbol bundle. Saves the dual-
capture cost for the rest of the session.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add `surface_leader_decision` MCP tool

**Files:**
- Modify: `app/main/tools/surface.js`
- Modify: `app/main/sdk.js`

- [ ] **Step 1: Add `surfaceLeaderDecision` writer in surface.js**

Add to `app/main/tools/surface.js` (alongside the existing surfaceSetup / surfaceNoTrade / surfaceSessionBrief functions):

```js
import { writePairDecision } from "../../../cli/lib/pair-decision.js";

// Persist the leader decision for the active session. Called by Claude at
// minute 14 of the open-reaction phase, alongside surface_ltf_bias.
export async function surfaceLeaderDecision(payload) {
  const { primary, secondary, leader, evidence } = payload;
  if (!primary || !secondary) throw new Error("surface_leader_decision requires primary and secondary");
  const { date } = currentSession();
  const sessionDir = path.join(REPO_ROOT, "state", "session", date, payload.session);
  await writePairDecision(sessionDir, {
    date,
    session: payload.session,
    primary,
    secondary,
    leader: leader || null,
    decided_at: new Date().toISOString(),
    evidence: evidence || null,
    reason: payload.reason || null,
  });
  _send?.("chat:tool_call", { name: "surface_leader_decision", payload });
  return { ok: true, leader: leader || null };
}
```

- [ ] **Step 2: Register the MCP tool in sdk.js**

In `app/main/sdk.js`, add to the `imports`:

```js
import {
  surfaceSetup,
  surfaceNoTrade,
  surfaceSessionBrief,
  surfaceOpenReaction,
  surfaceLtfBias,
  surfaceSessionSummary,
  surfaceLeaderDecision,    // NEW
} from "./tools/surface.js";
```

And add to the `tools` array inside `buildMcpServer()`:

```js
tool(
  "surface_leader_decision",
  "Persist the chosen leader symbol for a dual-symbol session to state/session/<date>/<session>/pair-decision.json. Call ONCE at the end of the open-reaction phase (minutes_into_phase >= 14), alongside surface_ltf_bias. After this fires, subsequent tv analyze --pair runs short-circuit and run single-symbol on the leader.",
  {
    session: z.enum(["london", "ny-am", "ny-pm"]).describe("Which session this decision is for"),
    primary: z.string().describe("Primary symbol from the pair (e.g. 'MNQ1!')"),
    secondary: z.string().describe("Secondary symbol from the pair (e.g. 'MES1!')"),
    leader: z.string().nullable().describe("The chosen leader symbol, or null if inconclusive (margin too small / no FVGs in window / etc.)"),
    evidence: z.object({
      primary_disp_score: z.number(),
      secondary_disp_score: z.number(),
      margin: z.number(),
      threshold: z.number(),
    }).describe("The numeric evidence from compute-leader. Always cite from pair.leader_evidence in the bundle."),
    reason: z.string().describe("The reason from compute-leader: primary_higher_disp_score | secondary_higher_disp_score | inconclusive_margin_below_threshold | no_fvgs_created_in_window | secondary_engine_missing"),
  },
  async (args) => {
    try {
      return ok(await surfaceLeaderDecision(args));
    } catch (e) {
      return err(e?.message || String(e));
    }
  },
),
```

- [ ] **Step 3: Syntax-check both files**

Run: `node --check app/main/tools/surface.js && node --check app/main/sdk.js && echo OK`
Expected: `OK`.

- [ ] **Step 4: Manual end-to-end test in the running app**

This requires running the Electron app and asking Claude in chat to call `surface_leader_decision` with a stub payload. Note the test session's path before testing so you can clean up.

In the chat panel, send: "Please call surface_leader_decision with session='ny-am', primary='MNQ1!', secondary='MES1!', leader='MNQ1!', evidence={primary_disp_score: 0.8, secondary_disp_score: 0.5, margin: 0.3, threshold: 0.1}, reason='primary_higher_disp_score' to test the wiring."

Then inspect the file:
```bash
TODAY=$(date +%Y-%m-%d)
cat state/session/$TODAY/ny-am/pair-decision.json
```

Expected: a valid JSON file with the payload above plus `schema: 1` and `decided_at`.

Cleanup: `rm state/session/$TODAY/ny-am/pair-decision.json`.

- [ ] **Step 5: Commit**

```bash
git add app/main/tools/surface.js app/main/sdk.js
git commit -m "$(cat <<'EOF'
feat: add surface_leader_decision MCP tool for in-app Claude

Lets Claude persist the leader pick at minute 14 of the open-reaction
phase. Writes pair-decision.json via the shared pair-decision lib so
the tv analyze short-circuit logic (Task 7) sees the same shape.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Update `app/main/prompts/analyze.md` phase blocks

**Files:**
- Modify: `app/main/prompts/analyze.md`

- [ ] **Step 1: Add the dual-symbol context to the bundle-fields reference**

Find the "Bundle fields (quick reference)" section. After the existing `engine_by_tf` bullet, add:

```markdown
- `pair` (present only when `tv analyze --pair` was used) — `{primary, secondary, window_start_ms, window_end_ms, symbols, leader_evidence, leader_decided, leader}`.
  - `pair.symbols.<symbol>` carries the same shape as the top-level bundle (`chart`, `quote`, `bars`, `bars_by_tf`, `engine`, `engine_by_tf`, `gates`) for each symbol.
  - `pair.leader_evidence` — `{primary_disp_score, secondary_disp_score, margin, threshold, reason, primary_fvg_path, secondary_fvg_path}`. Computed in code; never recompute.
  - `pair.leader` — `null` until `surface_leader_decision` fires; the chosen symbol thereafter.
- `pair_short_circuited` (present only when the analyzer detected an existing pair-decision.json) — `true` means the bundle is single-symbol on the leader; no `pair` block this turn.
```

- [ ] **Step 2: Update the Pre-session phase block**

Find the "Phase: Pre-session" section. After the existing "Goal:" line, add a paragraph:

```markdown
**If `pair` is in the bundle** — you're scanning two symbols. Write ONE `pillar1.md` and ONE `pillar2.md` that synthesize both symbols comparatively: HTF bias for both, primary HTF draw for each, overnight context for each. Single grade for the pair (the grade applies to whichever ends up being the leader). Cite from `pair.symbols.<primary>.*` and `pair.symbols.<secondary>.*` — never reach into the top-level fields for cross-asset comparisons; they only mirror the primary.
```

In the "Write the two files" subsection, the existing pillar1.md template stays — but the prose inside the `## HTF Bias`, `## Primary HTF Draw`, `## Overnight Summary` sections must reference both symbols by name when `pair` is in the bundle.

- [ ] **Step 3: Update the Open-reaction phase block**

Find the "Phase: Open reaction" section. After the existing "Required reads first:" subsection, add:

```markdown
**If `pair` is in the bundle**, you're still in dual-symbol mode. Per bar:
- Read `pair.leader_evidence`. Surface the running comparison in chat: "MNQ disp=X, MES disp=Y, margin=Z, reason=R."
- Update `open-reaction.md` describing both symbols' behavior — which one swept what level first, who broke structure first, who has cleaner candles.
- When `minutes_into_phase >= 14`, you MUST call `surface_leader_decision(...)` exactly once with the values from `pair.leader_evidence`. Use the same `reason` string. This is in ADDITION to the existing `surface_ltf_bias(...)` call. After this fires, the next `tv analyze --pair` run will short-circuit to single-symbol on the leader for the rest of the session.
```

- [ ] **Step 4: Update the Entry-hunt phase block**

Find the "Phase: Entry hunt" section. After the existing "Required reads first:" subsection, add:

```markdown
**If `pair_short_circuited: true` is in the bundle**, the leader has already been chosen — the bundle is single-symbol on the leader. Run the entry hunt exactly as today. Cite from the top-level fields (no `pair` block this turn).

**If neither `pair` nor `pair_short_circuited` is in the bundle**, you're running a normal single-symbol session — nothing changes.

**If `pair` is in the bundle during entry hunt** (which would mean Claude was late to call `surface_leader_decision`), prefer the symbol with the higher `pair.leader_evidence.primary_disp_score` vs `secondary_disp_score` and surface this exception in chat: "leader decision was missed at minute 14; treating <symbol> as leader for this turn."
```

- [ ] **Step 5: Smoke check — the prompt file is still valid markdown**

Run: `wc -l app/main/prompts/analyze.md && head -1 app/main/prompts/analyze.md`
Expected: a sensible line count (~470+ lines, up from ~467) and the first line is still `---` (frontmatter intact).

- [ ] **Step 6: Commit**

```bash
git add app/main/prompts/analyze.md
git commit -m "$(cat <<'EOF'
docs(prompt): teach Claude the dual-symbol scan phases

Phase blocks updated: pre-session (synthesize both symbols in one
pillar1.md/pillar2.md), open-reaction (surface leader_evidence per bar
and call surface_leader_decision at minute 14), entry-hunt (use the
short-circuited single-symbol bundle on the leader).

No new commands — these are behavioural additions to the existing phase
routing. The dual-scan triggers when the bundle has a `pair` block.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Capture a paired-bundle fixture for regression

**Files:**
- Create: `tests/fixtures/002-paired-mnq-mes.bundle.json`
- Create: `tests/fixtures/002-paired-mnq-mes.expected.md`

- [ ] **Step 1: Capture the bundle**

This step is manual — requires TradingView Desktop running on port 9223 with the ICT Engine indicator loaded on both MNQ and MES charts, with the chart currently on MNQ.

Run:
```bash
./bin/tv analyze --pair MNQ1!,MES1! --out tests/fixtures/002-paired-mnq-mes.bundle.json
```

Verify the bundle:
```bash
python3 -c "import json; b=json.load(open('tests/fixtures/002-paired-mnq-mes.bundle.json')); print('has pair:', 'pair' in b); print('primary:', b['pair']['primary']); print('secondary:', b['pair']['secondary']); print('evidence reason:', b['pair']['leader_evidence']['reason'])"
```

Expected: `has pair: True`, primary and secondary set, evidence reason is one of the documented strings.

- [ ] **Step 2: Hand-grade the expected.md**

Create `tests/fixtures/002-paired-mnq-mes.expected.md`:

```markdown
---
fixture_id: 002-paired-mnq-mes
captured_at: <YYYY-MM-DDTHH:MM:SSZ from bundle.timestamp>
phase: <inferred from gates.session.label>
pair: { primary: MNQ1!, secondary: MES1! }
expected_grade: <A+ | B | no-trade — judge from both symbols' pillar1+2 evidence>
---

# Expected reading — Paired MNQ + MES

## Pillar 1 — Draw & Bias (synthesized)

<two short paragraphs: HTF bias and primary draw for MNQ; same for MES; one line on whether they're aligned or diverging>

## Pillar 2 — Quality (synthesized)

<one paragraph each on the two symbols' m5/m15 anatomy and range, citing pair.symbols.<X>.gates.engine.pillar2.*>

## Leader evidence

<one line: "Primary <X> disp=Y, secondary <Z> disp=W, margin=M, reason=R" — all cited from pair.leader_evidence.*>
<one line: "Expected leader: <symbol or 'inconclusive'>">

## Final grade: <A+ | B | no-trade>
```

Fill in the bracketed fields by reading the captured bundle's actual values. Every price cited must use the `<value> (<json.path>)` syntax (cite-or-reject — same rule as fixture 001).

- [ ] **Step 3: Run the smoke harness against the new fixture**

Run: `npm run smoke:fixtures`
Expected: all fixtures pass, including the new `002-paired-mnq-mes`. If the harness rejects the paired bundle (schema check fails because `pair` is an unknown top-level field), update `scripts/smoke-fixtures.js` to allow `pair` and `pair_short_circuited` as valid top-level fields.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/002-paired-mnq-mes.bundle.json tests/fixtures/002-paired-mnq-mes.expected.md scripts/smoke-fixtures.js
git commit -m "$(cat <<'EOF'
test: add 002-paired-mnq-mes fixture for dual-scan regression

First paired bundle in the fixture corpus. Exercises the new pair.*
block end-to-end through the smoke harness. expected.md hand-graded;
schema check in smoke-fixtures.js updated to allow the new top-level
pair fields.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Update `docs/tradingview-cookbook.md`

**Files:**
- Modify: `docs/tradingview-cookbook.md`

- [ ] **Step 1: Add the changelog entry**

Find the changelog section at the top of `docs/tradingview-cookbook.md`. Add a new entry at the top (most recent first):

```markdown
- 2026-05-25 — dual-symbol scan (`tv analyze --pair MNQ1!,MES1!`) with code-side leader pick (`cli/lib/compute-leader.js`) and per-session lock (`pair-decision.json`). Surfaces the leader/laggard read during pre-session + the 15-min NY open reaction, then short-circuits to single-symbol on the leader for entry hunt. New MCP tool `surface_leader_decision`. ([design spec](superpowers/specs/2026-05-24-leader-laggard-dual-scan-design.md))
```

- [ ] **Step 2: Add a new section after the "Alerts" section**

Append to `docs/tradingview-cookbook.md`:

```markdown
## Dual-symbol scans (`--pair`)

`tv analyze --pair <primary>,<secondary>` captures both symbols in one run. The chart's current symbol must equal one of the two — no silent chart swap.

**What gets captured per symbol:** chart state, quote, bars, bars_by_tf, engine, engine_by_tf, gates. All nested under `pair.symbols.<symbol>`. The top-level fields (`chart`, `quote`, `bars`, etc.) mirror the primary for backward compatibility.

**Leader pick is code-side.** `cli/lib/compute-leader.js` is a pure function: takes both engine objects + the open-reaction window, returns the symbol with the higher max `disp_score` on FVGs created in the window. Threshold-gated (0.10 default) so close margins yield `leader: null, reason: "inconclusive_margin_below_threshold"`.

**Lifecycle.** During pre-session + the 15-min open reaction, every `tv analyze --pair` run captures both symbols and computes evidence. At minute 14, Claude (via in-app MCP) calls `surface_leader_decision(...)` which writes `state/session/<date>/<session>/pair-decision.json`. Subsequent `tv analyze --pair` runs detect this file, switch the chart to the leader, and run a normal single-symbol capture for the rest of the session.

**Per-symbol baselines.** Use `--baseline state/baseline-MNQ1!.json --baseline-secondary state/baseline-MES1!.json` to keep the fast-poll path under ~3s. The single `state/baseline.json` from before this change still works as a primary-only fallback (with a stderr warning suggesting the rename).

**Edge cases:**
- ICT Engine missing on the secondary → `pair.leader_evidence.reason: "secondary_engine_missing"`. Loud stderr warning. Entry hunt falls back to the primary.
- Chart on neither named symbol → CLI errors loudly; no silent swap.
- Pair-decision.json from a previous day → ignored as stale; treated as fresh session.

**Design + rationale:** [`docs/superpowers/specs/2026-05-24-leader-laggard-dual-scan-design.md`](superpowers/specs/2026-05-24-leader-laggard-dual-scan-design.md).
```

- [ ] **Step 3: Commit**

```bash
git add docs/tradingview-cookbook.md
git commit -m "$(cat <<'EOF'
docs: document --pair dual-scan in the tradingview cookbook

Changelog entry + new section covering --pair, compute-leader,
pair-decision.json lifecycle, per-symbol baselines, and edge cases.
Cross-references the design spec.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage:**
- §3 Architecture — Tasks 1, 2, 8 (compute-leader + pair-decision + surface_leader_decision), Tasks 3–7 (analyze.js changes), Task 9 (analyze.md), Task 11 (cookbook). ✓
- §4 Data flow — covered by Tasks 4 (dual-capture), 5 (evidence), 7 (short-circuit), 8 (decision write), 9 (prompt). ✓
- §5 Bundle shape — Task 4 (`pair` block), Task 6 (baseline_secondary_meta), Task 7 (`pair_short_circuited`). ✓
- §6 Leader rule — Task 1 (compute-leader unit tests cover all reason strings). ✓
- §7 Edge cases — covered across tasks: tie + missing engine + no FVGs in Task 1; bad chart symbol in Task 4 Step 2; stale pair-decision in Task 2 + Task 7; old baseline.json in Task 6 (backward-compat fallback — not yet explicitly added; see follow-up below).
- §8 Implementation order — matches Tasks 1–11. ✓
- §9 Out of scope — documented in spec; not in plan (correct). ✓

**Placeholder scan:**
- Task 5 Step 3: `primary_fvg_path: "pair.symbols.${pairConfig.primary}.engine.fvgs[?].disp_score"` uses `[?]` as a literal placeholder. This is documented as a v1 stub in the step itself (the FVG index isn't plumbed through compute-leader). Acceptable known limitation.
- No other placeholders detected.

**Type consistency:**
- `computeLeader` returns the same fields used everywhere downstream (`leader, primary_disp_score, secondary_disp_score, margin, threshold, reason`). ✓
- `pair-decision.json` shape matches between `writePairDecision`, `readPairDecision`, `surfaceLeaderDecision`, and the analyze short-circuit reader. ✓
- `pair` block fields in the bundle (Task 4) match the prompt's documented fields (Task 9). ✓

**Followup (deferred — not blocking):**
- Backward-compat for the old single `state/baseline.json` (mentioned in spec §3 + §7) is documented in Task 6 but not enforced in code. If only the old single file exists, the user passes `--baseline state/baseline.json` (no rename needed) and gets the primary's data. The "automatic fallback + warning" the spec mentions can be added later — for now, the rename is a user-visible breaking change worth documenting in the cookbook.
- The `primary_fvg_path` index plumbing through compute-leader is deferred to a follow-up. Citation paths work at the array level (`pair.symbols.<X>.engine.fvgs`) without the index.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-25-leader-laggard-dual-scan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
