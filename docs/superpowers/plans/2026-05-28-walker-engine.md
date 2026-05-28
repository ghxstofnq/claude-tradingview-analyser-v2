# Walker Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the ghxstofnq/tradingview-mcp-ict walker-engine pattern for Pillar 3 + confirmation so the LLM is removed from the entry decision, with seven upgrades over the original. Engine runs in pure JS, called by the bar-close detector + backtest engine on every closed 1m bar (and 5m on 5m boundaries).

**Architecture:** Pure-function modules in `app/main/walker/` with an impure runtime adapter. State persists to `state/session/<date>/<session>/walkers.json`. ACCEPT/REJECT UI + trade tracking unchanged — engine emits the setup, existing surface_setup path renders it.

**Tech Stack:** Node ES modules, `node --test`, existing Electron main process, `gates.engine.*` bundle output (from PR0's V2 parser), existing per-session state pattern, existing `app/main/calendar.js` for news, existing `state/memory/MEMORY.md` for vetoes.

**Depends on:** PR0 (ICT Engine V2 parser migration) merged.

---

## File Structure

```
app/main/walker/
  walker-engine.js         tickWalkers({prev, gates, bars, rules, calendar, memory, history}) -> {next, triggers}
  walker-stages.js         stage definitions per model — pure data
  walker-spawn.js          detectIgnitions(gates, bars, prev, calendar, memory, suppressionContext) -> newWalkers
  walker-evaluate.js       evaluateAdvance(walker, gates, bars) -> nextStage|kill, evaluateKill(...)
  walker-cap.js            enforceCap(walkers, maxLive) -> walkers[]
  walker-sizing.js         computeSizeMultiplier({model, history, userMax}) -> {factor, reason}
  walker-runtime.js        impure: load/save walkers.json, parse memory skip lines, IPC dispatch

tests/walker/
  walker-engine.test.js          engine API contract
  walker-stages.test.js          stage tables consistent + complete
  walker-spawn-mss.test.js       MSS standard + sweep-into-5m ignition tests
  walker-spawn-trend.test.js     Trend standard ignition tests
  walker-spawn-inversion.test.js Inversion aggressive + patient ignition tests
  walker-evaluate-mss.test.js    MSS advance + kill per stage
  walker-evaluate-trend.test.js  Trend advance + kill per stage
  walker-evaluate-inversion.test.js Inversion advance + kill per stage
  walker-cap.test.js             eviction logic
  walker-sizing.test.js          multiplier math + guardrails
  walker-fixtures/               recorded bar streams + gates snapshots
    mss-aplus-001.json
    trend-aplus-001.json
    inversion-aplus-001.json
    no-trade-001.json
    invalidated-001.json
    news-pause-001.json
    correlation-suppress-001.json

app/main/bar-close.js              [modify] — route entry-hunt to walkerTick instead of Claude
app/main/backtest-engine.js        [modify] — same routing for backtest mode
app/main/prompts/phase-bar-close.md [modify] — strip entry-hunt section
app/renderer/src/LivePopover.jsx   [modify] — add WALKER STATUS panel
app/renderer/src/hooks/useWalkers.js [create] — subscribe to walker state via IPC
app/preload.cjs                    [modify] — expose window.api.walkers

cli/lib/entry-model-priority.js    [DELETE]
cli/lib/setup-detector.js          [DELETE]
tests/entry-model-priority.test.js [DELETE]
tests/setup-detector.test.js       [DELETE]
```

---

## Phase A — Scaffolding

### Task 1: Branch setup

- [ ] **Step 1: Create branch off the merged PR0 branch**

PR0 must be merged before starting. Then:

Run: `git fetch origin main && git checkout -b feat/walker-engine origin/main`
Expected: `Switched to a new branch 'feat/walker-engine'`

Verify PR0 changes are present:

Run: `grep -c "schema === 2" cli/lib/ict-engine-parser.js`
Expected: at least 1.

### Task 2: Create walker module directory + index

**Files:**
- Create: `app/main/walker/walker-engine.js` (empty export stub)
- Create: `app/main/walker/walker-stages.js`
- Create: `app/main/walker/walker-spawn.js`
- Create: `app/main/walker/walker-evaluate.js`
- Create: `app/main/walker/walker-cap.js`
- Create: `app/main/walker/walker-sizing.js`
- Create: `app/main/walker/walker-runtime.js`

- [ ] **Step 1: Make the dir + stub files**

Run:

```bash
mkdir -p app/main/walker
cat > app/main/walker/walker-engine.js <<'EOF'
// Walker engine — pure function. See spec docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md
export function tickWalkers({ prev, gates, bars, rules, calendar, memory, history }) {
  // Implemented in subsequent tasks.
  return { next: prev, triggers: [] };
}
EOF
echo "export const STAGES = {};" > app/main/walker/walker-stages.js
echo "export function detectIgnitions() { return []; }" > app/main/walker/walker-spawn.js
echo "export function evaluateAdvance() { return { stage: null }; }" > app/main/walker/walker-evaluate.js
echo "export function enforceCap(walkers) { return walkers; }" > app/main/walker/walker-cap.js
echo "export function computeSizeMultiplier() { return { factor: 1.0, reason: 'default' }; }" > app/main/walker/walker-sizing.js
echo "// Impure runtime — file I/O, calendar reads, memory parsing, IPC. Implemented in Task 19." > app/main/walker/walker-runtime.js
```

- [ ] **Step 2: Commit scaffold**

```bash
git add app/main/walker/
git commit -m "$(cat <<'EOF'
feat(walker): scaffold pure-function modules

Empty stubs for walker-engine, walker-stages, walker-spawn, walker-evaluate, walker-cap, walker-sizing, walker-runtime. Tests come next.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Engine API contract

### Task 3: walker-engine API shape test

**Files:**
- Create: `tests/walker/walker-engine.test.js`

- [ ] **Step 1: Write failing test for tickWalkers signature + return shape**

```bash
mkdir -p tests/walker
```

Create `tests/walker/walker-engine.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickWalkers } from '../../app/main/walker/walker-engine.js';

test('tickWalkers: returns {next, triggers} given minimal valid input', () => {
  const result = tickWalkers({
    prev: { session: 'ny-am', walkers: [], triggers: [], proof: { last_1m_close: null, last_5m_close: null } },
    gates: { engine: { meta: { schema: 2 }, pillar1: { sweeps: [] }, pillar3: { fvgs: [], structure_events: [], failure_swings: [] }, pillar2: { current_tf: { range_quality: 'good', displacement: 'clean', candle: 'clean' } } } },
    bars: { m1: [], m5: [] },
    rules: { walker_max_live: 4, walker_auto_sizing: 'on', max_risk_per_trade: 100 },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    history: { mss: [], trend: [], inversion: [] },
  });
  assert.ok(result, 'tickWalkers must return an object');
  assert.ok(Array.isArray(result.next.walkers), 'next.walkers must be an array');
  assert.ok(Array.isArray(result.triggers), 'triggers must be an array');
  assert.equal(typeof result.next.proof, 'object');
});

test('tickWalkers: is pure — same input twice yields equal output', () => {
  const input = {
    prev: { session: 'ny-am', walkers: [], triggers: [], proof: { last_1m_close: 1000, last_5m_close: 1000 } },
    gates: { engine: { meta: { schema: 2 }, pillar1: { sweeps: [] }, pillar3: { fvgs: [], structure_events: [], failure_swings: [] }, pillar2: { current_tf: { range_quality: 'good', displacement: 'clean', candle: 'clean' } } } },
    bars: { m1: [], m5: [] },
    rules: { walker_max_live: 4, walker_auto_sizing: 'on', max_risk_per_trade: 100 },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    history: { mss: [], trend: [], inversion: [] },
  };
  const a = tickWalkers(input);
  const b = tickWalkers(input);
  assert.deepEqual(a, b, 'pure function must produce identical output for identical input');
});
```

- [ ] **Step 2: Run, verify PASS** (stub already returns the right shape).

Run: `node --test tests/walker/walker-engine.test.js`
Expected: PASS.

- [ ] **Step 3: Commit contract test**

```bash
git add tests/walker/walker-engine.test.js
git commit -m "$(cat <<'EOF'
test(walker): engine API contract — shape + purity

Locks in tickWalkers signature before implementation grows. Stub already passes.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Stage tables

### Task 4: walker-stages.js stage definitions per model

**Files:**
- Modify: `app/main/walker/walker-stages.js`
- Create: `tests/walker/walker-stages.test.js`

- [ ] **Step 1: Write failing test for STAGES table completeness**

Create `tests/walker/walker-stages.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, isTerminalStage, nextStageOf } from '../../app/main/walker/walker-stages.js';

test('STAGES: MSS standard chain', () => {
  assert.deepEqual(STAGES.MSS_standard, ['spawn', 'displacement_done', 'retrace_pending', 'confirmation', 'trigger']);
});

test('STAGES: MSS sweep_into_5m chain', () => {
  assert.deepEqual(STAGES.MSS_sweep_into_5m, ['spawn', 'displacement_done_5m', 'retrace_pending', 'confirmation', 'trigger']);
});

test('STAGES: Trend standard chain', () => {
  assert.deepEqual(STAGES.TREND_standard, ['spawn', 'impulse_done', 'retrace_pending', 'confirmation', 'trigger']);
});

test('STAGES: Inversion aggressive chain', () => {
  assert.deepEqual(STAGES.INVERSION_aggressive, ['spawn', 'inversion_violation', 'confirmation', 'trigger']);
});

test('STAGES: Inversion patient chain', () => {
  assert.deepEqual(STAGES.INVERSION_patient, ['spawn', 'inversion_violation', 'retrace_pending', 'confirmation', 'trigger']);
});

test('isTerminalStage: trigger is terminal', () => {
  assert.equal(isTerminalStage('trigger'), true);
  assert.equal(isTerminalStage('confirmation'), false);
});

test('nextStageOf: walks the MSS_standard chain', () => {
  assert.equal(nextStageOf('MSS_standard', 'spawn'), 'displacement_done');
  assert.equal(nextStageOf('MSS_standard', 'displacement_done'), 'retrace_pending');
  assert.equal(nextStageOf('MSS_standard', 'retrace_pending'), 'confirmation');
  assert.equal(nextStageOf('MSS_standard', 'confirmation'), 'trigger');
  assert.equal(nextStageOf('MSS_standard', 'trigger'), null);
});

test('nextStageOf: unknown chain returns null', () => {
  assert.equal(nextStageOf('UNKNOWN_chain', 'spawn'), null);
});
```

- [ ] **Step 2: Run, verify FAIL** (stages stub is empty).

Run: `node --test tests/walker/walker-stages.test.js`
Expected: multiple FAIL.

- [ ] **Step 3: Implement stages**

Replace `app/main/walker/walker-stages.js`:

```javascript
// Stage chains per entry-model variant. Pure data.
// Spec: docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md

export const STAGES = Object.freeze({
  MSS_standard:        ['spawn', 'displacement_done',    'retrace_pending', 'confirmation', 'trigger'],
  MSS_sweep_into_5m:   ['spawn', 'displacement_done_5m', 'retrace_pending', 'confirmation', 'trigger'],
  TREND_standard:      ['spawn', 'impulse_done',         'retrace_pending', 'confirmation', 'trigger'],
  INVERSION_aggressive:['spawn', 'inversion_violation',                     'confirmation', 'trigger'],
  INVERSION_patient:   ['spawn', 'inversion_violation',  'retrace_pending', 'confirmation', 'trigger'],
});

export function isTerminalStage(stage) {
  return stage === 'trigger';
}

export function nextStageOf(chain, currentStage) {
  const seq = STAGES[chain];
  if (!seq) return null;
  const idx = seq.indexOf(currentStage);
  if (idx < 0 || idx >= seq.length - 1) return null;
  return seq[idx + 1];
}
```

- [ ] **Step 4: Run, verify PASS.**

Run: `node --test tests/walker/walker-stages.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-stages.js tests/walker/walker-stages.test.js
git commit -m "$(cat <<'EOF'
feat(walker): stage tables for all 5 model variants

MSS standard + sweep-into-5m, Trend standard, Inversion aggressive + patient. Pure data + two helpers (nextStageOf, isTerminalStage).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Spawn detection

### Task 5: MSS standard spawn

**Files:**
- Modify: `app/main/walker/walker-spawn.js`
- Create: `tests/walker/walker-spawn-mss.test.js`

- [ ] **Step 1: Write failing test for MSS standard spawn**

Create `tests/walker/walker-spawn-mss.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIgnitions } from '../../app/main/walker/walker-spawn.js';

const baseInput = {
  gates: { engine: { pillar1: { sweeps: [] }, pillar3: { fvgs: [], structure_events: [], failure_swings: [] } } },
  bars: { m1: [], m5: [] },
  prev: { walkers: [] },
  calendar: { events: [] },
  memory: { walkerSkipLines: [] },
  suppression: { activeTradeSide: null },
};

test('MSS spawn: emits walker when sweep + same-direction failure_swing within 10 min', () => {
  const now = Date.now();
  const input = {
    ...baseInput,
    gates: {
      engine: {
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
        pillar3: {
          fvgs: [],
          structure_events: [],
          failure_swings: [{ event: 'MSS', dir: 'up', displacement: true, ts_ms: now - 30_000, level: 29782.0,
                             new_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75, dir: 'up' } }],
        },
      },
    },
  };
  const newWalkers = detectIgnitions(input);
  assert.equal(newWalkers.length, 1);
  const w = newWalkers[0];
  assert.equal(w.model, 'MSS');
  assert.equal(w.variant, 'standard');
  assert.equal(w.side, 'long');
  assert.equal(w.stage, 'displacement_done');
  assert.deepEqual(w.swept_pool, { name: 'AS.L', level: 29764.0 });
  assert.deepEqual(w.displacement_fvg, { high: 29785.5, low: 29782.0, ce: 29783.75 });
});

test('MSS spawn: skips if sweep older than 10 min', () => {
  const now = Date.now();
  const input = {
    ...baseInput,
    gates: {
      engine: {
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 11 * 60_000, dir: 'down' }] },
        pillar3: { fvgs: [], structure_events: [],
                   failure_swings: [{ event: 'MSS', dir: 'up', displacement: true, ts_ms: now - 30_000, level: 29782.0,
                                       new_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75, dir: 'up' } }] },
      },
    },
  };
  const newWalkers = detectIgnitions(input);
  assert.equal(newWalkers.length, 0);
});

test('MSS spawn: skips if a walker already exists for that pool', () => {
  const now = Date.now();
  const input = {
    ...baseInput,
    prev: { walkers: [{ id: 'w1', model: 'MSS', variant: 'standard', swept_pool: { name: 'AS.L', level: 29764.0 } }] },
    gates: {
      engine: {
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
        pillar3: { fvgs: [], structure_events: [],
                   failure_swings: [{ event: 'MSS', dir: 'up', displacement: true, ts_ms: now - 30_000, level: 29782.0,
                                       new_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75, dir: 'up' } }] },
      },
    },
  };
  const newWalkers = detectIgnitions(input);
  assert.equal(newWalkers.length, 0);
});
```

- [ ] **Step 2: Run, verify FAIL.**

Run: `node --test tests/walker/walker-spawn-mss.test.js`
Expected: FAIL — stub returns empty.

- [ ] **Step 3: Implement detectIgnitions with MSS handler**

Replace `app/main/walker/walker-spawn.js`:

```javascript
// Spawn detection — pure. Decides whether a new walker should be created
// this tick based on engine gates + bars + prior walker state.

const SWEEP_RECENCY_MS = 10 * 60_000; // 10 minutes
let _idSeq = 0;
function nextId() { return `w_${Date.now()}_${(_idSeq++).toString(36)}`; }

export function detectIgnitions({ gates, bars, prev, calendar, memory, suppression }) {
  const out = [];
  out.push(...spawnMssStandard({ gates, prev }));
  // Other variants added in subsequent tasks.
  return out;
}

function spawnMssStandard({ gates, prev }) {
  const sweeps = gates?.engine?.pillar1?.sweeps ?? [];
  const swings = gates?.engine?.pillar3?.failure_swings ?? [];
  const now = Date.now();
  const out = [];
  for (const sw of sweeps) {
    if (!sw?.swept_at_ms || now - sw.swept_at_ms > SWEEP_RECENCY_MS) continue;
    if (prev?.walkers?.some((w) =>
      w.model === 'MSS' && w.variant === 'standard' &&
      w.swept_pool?.name === sw.name && w.swept_pool?.level === sw.level)) continue;
    const swingDir = sw.dir === 'down' ? 'up' : 'down';
    const match = swings.find((s) =>
      s.event === 'MSS' && s.dir === swingDir && s.displacement === true && s.new_fvg);
    if (!match) continue;
    out.push({
      id: nextId(),
      panel_id: `${sessionPrefix()}_${swingDir === 'up' ? 'long' : 'short'}_MSS`,
      model: 'MSS',
      variant: 'standard',
      side: swingDir === 'up' ? 'long' : 'short',
      stage: 'displacement_done',
      swept_pool: { name: sw.name, level: sw.level },
      displacement_fvg: { high: match.new_fvg.high, low: match.new_fvg.low, ce: match.new_fvg.ce },
      retrace_zone: { high: match.new_fvg.high, low: match.new_fvg.ce },
      entry: null, stop: null, tp1: null, tp2: null,
      size_multiplier: 1.0, size_reason: 'default',
      hypothetical_r_to_stop: null, hypothetical_r_to_tp1: null,
      created_at: now, last_advanced_at: now, last_evaluated_at: now,
    });
  }
  return out;
}

function sessionPrefix() {
  // Stub — runtime will pass session via gates context in a later task. For now, fall back to 'am'.
  return 'am';
}
```

- [ ] **Step 4: Run, verify PASS.**

Run: `node --test tests/walker/walker-spawn-mss.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-spawn.js tests/walker/walker-spawn-mss.test.js
git commit -m "$(cat <<'EOF'
feat(walker): MSS standard spawn detection

Spawns when sweep is recent (<=10 min) AND a same-direction failure_swing with displacement + fresh FVG was emitted by engine. De-dupes per (pool, model) pair against prior walkers.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Task 6: MSS sweep-into-5m variant spawn

**Files:**
- Modify: `app/main/walker/walker-spawn.js` (add spawnMssSweepInto5m)
- Modify: `tests/walker/walker-spawn-mss.test.js` (add variant tests)

- [ ] **Step 1: Write failing test for the 5m variant**

Append to `tests/walker/walker-spawn-mss.test.js`:

```javascript
test('MSS sweep_into_5m spawn: emits when sweep on 1m + displacement FVG on 5m', () => {
  const now = Date.now();
  const input = {
    gates: {
      engine: {
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
        pillar3: { fvgs: [], structure_events: [], failure_swings: [] },
      },
      engine_by_tf: { m5: { fvgs: [{ state: 'fresh', dir: 'up', tf: 'm5', high: 29785.5, low: 29782.0, ce: 29783.75, ts_ms: now - 30_000 }] } },
    },
    bars: { m1: [], m5: [] },
    prev: { walkers: [] },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    suppression: { activeTradeSide: null },
  };
  const newWalkers = detectIgnitions(input);
  const variant = newWalkers.find((w) => w.variant === 'sweep_into_5m');
  assert.ok(variant, 'expected sweep_into_5m walker');
  assert.equal(variant.model, 'MSS');
  assert.equal(variant.side, 'long');
  assert.equal(variant.stage, 'displacement_done_5m');
  assert.deepEqual(variant.displacement_fvg, { high: 29785.5, low: 29782.0, ce: 29783.75 });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement spawnMssSweepInto5m in walker-spawn.js**

Add to `walker-spawn.js`:

```javascript
function spawnMssSweepInto5m({ gates, prev }) {
  const sweeps = gates?.engine?.pillar1?.sweeps ?? [];
  const m5Fvgs = gates?.engine_by_tf?.m5?.fvgs ?? [];
  const now = Date.now();
  const out = [];
  for (const sw of sweeps) {
    if (!sw?.swept_at_ms || now - sw.swept_at_ms > SWEEP_RECENCY_MS) continue;
    const fvgDir = sw.dir === 'down' ? 'up' : 'down';
    const fvg = m5Fvgs.find((f) => f.state === 'fresh' && f.dir === fvgDir && f.ts_ms >= sw.swept_at_ms);
    if (!fvg) continue;
    if (prev?.walkers?.some((w) =>
      w.model === 'MSS' && w.variant === 'sweep_into_5m' &&
      w.swept_pool?.name === sw.name && w.swept_pool?.level === sw.level)) continue;
    out.push({
      id: nextId(),
      panel_id: `${sessionPrefix()}_${fvgDir === 'up' ? 'long' : 'short'}_MSS`,
      model: 'MSS',
      variant: 'sweep_into_5m',
      side: fvgDir === 'up' ? 'long' : 'short',
      stage: 'displacement_done_5m',
      swept_pool: { name: sw.name, level: sw.level },
      displacement_fvg: { high: fvg.high, low: fvg.low, ce: fvg.ce },
      retrace_zone: { high: fvg.high, low: fvg.ce },
      entry: null, stop: null, tp1: null, tp2: null,
      size_multiplier: 1.0, size_reason: 'default',
      hypothetical_r_to_stop: null, hypothetical_r_to_tp1: null,
      created_at: now, last_advanced_at: now, last_evaluated_at: now,
    });
  }
  return out;
}
```

Also extend the top-level dispatch:

```javascript
out.push(...spawnMssSweepInto5m({ gates, prev }));
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-spawn.js tests/walker/walker-spawn-mss.test.js
git commit -m "$(cat <<'EOF'
feat(walker): MSS sweep-into-5m variant spawn

Triggers when 1m sweep is followed by a fresh 5m FVG in the reversal direction. Walker starts at displacement_done_5m stage.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Task 7: Trend standard spawn

**Files:**
- Modify: `app/main/walker/walker-spawn.js`
- Create: `tests/walker/walker-spawn-trend.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIgnitions } from '../../app/main/walker/walker-spawn.js';

test('Trend spawn: emits when BoS aligned with HTF bias + fresh same-dir FVG, no opposing MSS', () => {
  const now = Date.now();
  const input = {
    gates: {
      engine: {
        pillar1: { sweeps: [] },
        pillar3: {
          fvgs: [{ state: 'fresh', dir: 'up', tf: 'm5', high: 29812, low: 29808, ce: 29810, ts_ms: now - 60_000 }],
          structure_events: [{ event: 'BoS', dir: 'up', displacement: true, ts_ms: now - 90_000, tier: 'internal' }],
          failure_swings: [],
        },
      },
      engine_by_tf: { m5: { structure_events: [] } },
      htf_bias: 'bullish',
    },
    bars: { m1: [], m5: [] },
    prev: { walkers: [] },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    suppression: { activeTradeSide: null },
  };
  const newWalkers = detectIgnitions(input);
  const trendW = newWalkers.find((w) => w.model === 'TREND');
  assert.ok(trendW, 'expected TREND walker');
  assert.equal(trendW.variant, 'standard');
  assert.equal(trendW.side, 'long');
  assert.equal(trendW.stage, 'impulse_done');
  assert.deepEqual(trendW.displacement_fvg, { high: 29812, low: 29808, ce: 29810 });
});

test('Trend spawn: skips if HTF bias not aligned', () => {
  const now = Date.now();
  const input = {
    gates: {
      engine: {
        pillar1: { sweeps: [] },
        pillar3: {
          fvgs: [{ state: 'fresh', dir: 'up', tf: 'm5', high: 29812, low: 29808, ce: 29810, ts_ms: now - 60_000 }],
          structure_events: [{ event: 'BoS', dir: 'up', displacement: true, ts_ms: now - 90_000 }],
          failure_swings: [],
        },
      },
      engine_by_tf: { m5: { structure_events: [] } },
      htf_bias: 'bearish',
    },
    bars: { m1: [], m5: [] },
    prev: { walkers: [] },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    suppression: { activeTradeSide: null },
  };
  assert.equal(detectIgnitions(input).filter((w) => w.model === 'TREND').length, 0);
});

test('Trend spawn: rejects bullish_iFVG (Inversion is correct model)', () => {
  const now = Date.now();
  const input = {
    gates: {
      engine: {
        pillar1: { sweeps: [] },
        pillar3: {
          fvgs: [{ state: 'fresh', dir: 'up', kind: 'iFVG', tf: 'm5', high: 29812, low: 29808, ce: 29810, ts_ms: now - 60_000 }],
          structure_events: [{ event: 'BoS', dir: 'up', displacement: true, ts_ms: now - 90_000 }],
          failure_swings: [],
        },
      },
      engine_by_tf: { m5: { structure_events: [] } },
      htf_bias: 'bullish',
    },
    bars: { m1: [], m5: [] },
    prev: { walkers: [] },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    suppression: { activeTradeSide: null },
  };
  assert.equal(detectIgnitions(input).filter((w) => w.model === 'TREND').length, 0);
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement spawnTrendStandard**

Add to `walker-spawn.js`:

```javascript
function spawnTrendStandard({ gates, prev }) {
  const fvgs = gates?.engine?.pillar3?.fvgs ?? [];
  const structures = gates?.engine?.pillar3?.structure_events ?? [];
  const bias = gates?.htf_bias;
  if (bias !== 'bullish' && bias !== 'bearish') return [];
  const dir = bias === 'bullish' ? 'up' : 'down';
  const now = Date.now();
  const out = [];
  const bos = structures.find((s) => s.event === 'BoS' && s.dir === dir && s.displacement === true);
  if (!bos) return [];
  const fvg = fvgs.find((f) => f.state === 'fresh' && f.dir === dir && f.kind !== 'iFVG');
  if (!fvg) return [];
  if (prev?.walkers?.some((w) => w.model === 'TREND' && w.displacement_fvg?.high === fvg.high && w.displacement_fvg?.low === fvg.low)) return [];
  out.push({
    id: nextId(),
    panel_id: `${sessionPrefix()}_${dir === 'up' ? 'long' : 'short'}_TREND`,
    model: 'TREND',
    variant: 'standard',
    side: dir === 'up' ? 'long' : 'short',
    stage: 'impulse_done',
    swept_pool: null,
    displacement_fvg: { high: fvg.high, low: fvg.low, ce: fvg.ce },
    retrace_zone: { high: fvg.high, low: fvg.ce },
    entry: null, stop: null, tp1: null, tp2: null,
    size_multiplier: 1.0, size_reason: 'default',
    hypothetical_r_to_stop: null, hypothetical_r_to_tp1: null,
    created_at: now, last_advanced_at: now, last_evaluated_at: now,
  });
  return out;
}
```

Extend top-level dispatch:

```javascript
out.push(...spawnTrendStandard({ gates, prev }));
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-spawn.js tests/walker/walker-spawn-trend.test.js
git commit -m "$(cat <<'EOF'
feat(walker): Trend standard spawn detection

Spawns when HTF bias aligns with a BoS-with-displacement and a fresh same-direction FVG (not iFVG — iFVGs route through Inversion).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Task 8: Inversion aggressive + patient spawn

**Files:**
- Modify: `app/main/walker/walker-spawn.js`
- Create: `tests/walker/walker-spawn-inversion.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIgnitions } from '../../app/main/walker/walker-spawn.js';

test('Inversion aggressive spawn: emits when opposing PD array present + same-dir bias', () => {
  const now = Date.now();
  const input = {
    gates: {
      engine: {
        pillar1: { sweeps: [] },
        pillar3: {
          fvgs: [{ state: 'fresh', dir: 'down', tf: 'm5', high: 29830, low: 29826, ce: 29828, ts_ms: now - 60_000 }],
          structure_events: [], failure_swings: [],
        },
      },
      engine_by_tf: { m5: { structure_events: [] } },
      htf_bias: 'bullish',
    },
    bars: { m1: [], m5: [] },
    prev: { walkers: [] },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    suppression: { activeTradeSide: null },
  };
  const newWalkers = detectIgnitions(input);
  const invW = newWalkers.find((w) => w.model === 'INVERSION');
  assert.ok(invW);
  assert.equal(invW.variant, 'aggressive');
  assert.equal(invW.side, 'long');
  assert.equal(invW.stage, 'spawn');
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement spawnInversion (both variants)**

Add to `walker-spawn.js`:

```javascript
function spawnInversion({ gates, prev }) {
  const fvgs = gates?.engine?.pillar3?.fvgs ?? [];
  const bias = gates?.htf_bias;
  if (bias !== 'bullish' && bias !== 'bearish') return [];
  const ourDir = bias === 'bullish' ? 'up' : 'down';
  const oppDir = bias === 'bullish' ? 'down' : 'up';
  const opp = fvgs.find((f) => f.state === 'fresh' && f.dir === oppDir);
  if (!opp) return [];
  if (prev?.walkers?.some((w) => w.model === 'INVERSION' && w.displacement_fvg?.high === opp.high && w.displacement_fvg?.low === opp.low)) return [];
  const now = Date.now();
  return [{
    id: nextId(),
    panel_id: `${sessionPrefix()}_${ourDir === 'up' ? 'long' : 'short'}_INVERSION`,
    model: 'INVERSION',
    variant: 'aggressive',  // patient promoted by evaluate phase if retrace is observed
    side: ourDir === 'up' ? 'long' : 'short',
    stage: 'spawn',
    swept_pool: null,
    displacement_fvg: { high: opp.high, low: opp.low, ce: opp.ce },
    retrace_zone: { high: opp.high, low: opp.ce },
    entry: null, stop: null, tp1: null, tp2: null,
    size_multiplier: 1.0, size_reason: 'default',
    hypothetical_r_to_stop: null, hypothetical_r_to_tp1: null,
    created_at: now, last_advanced_at: now, last_evaluated_at: now,
  }];
}
```

Top-level dispatch:

```javascript
out.push(...spawnInversion({ gates, prev }));
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-spawn.js tests/walker/walker-spawn-inversion.test.js
git commit -m "$(cat <<'EOF'
feat(walker): Inversion spawn (aggressive starting variant)

Spawns when an opposing-direction fresh FVG is present in an aligned-bias environment. Defaults to aggressive variant; patient promotion happens during evaluate phase if retrace pattern is observed.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — Evaluate (advance + kill)

### Task 9: walker-evaluate.js advance — MSS chain

**Files:**
- Modify: `app/main/walker/walker-evaluate.js`
- Create: `tests/walker/walker-evaluate-mss.test.js`

- [ ] **Step 1: Write failing tests for the four MSS stage transitions**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAdvance, evaluateKill } from '../../app/main/walker/walker-evaluate.js';

const baseGates = {
  engine: {
    pillar2: { current_tf: { range_quality: 'good', displacement: 'clean', candle: 'clean', volume_acceptable: true } },
    confirmation: { last_bar: { body_ratio: 0.75, direction: 'up', close: 29787, volume_acceptable: true } },
  },
  engine_by_tf: { m5: { structure_events: [] } },
};

test('MSS advance: displacement_done -> retrace_pending when price wicks into FVG', () => {
  const walker = {
    model: 'MSS', variant: 'standard', side: 'long', stage: 'displacement_done',
    displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
  };
  const bars = { m1: [{ low: 29782.5, high: 29790, close: 29787 }] };
  const next = evaluateAdvance(walker, { ...baseGates }, bars);
  assert.equal(next.stage, 'retrace_pending');
});

test('MSS advance: retrace_pending -> confirmation on clean 1m close above CE', () => {
  const walker = {
    model: 'MSS', variant: 'standard', side: 'long', stage: 'retrace_pending',
    displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
  };
  const bars = { m1: [{ low: 29783, high: 29790, close: 29787, body_ratio: 0.75 }] };
  const next = evaluateAdvance(walker, { ...baseGates }, bars);
  assert.equal(next.stage, 'confirmation');
});

test('MSS advance: confirmation -> trigger emits setup', () => {
  const walker = {
    model: 'MSS', variant: 'standard', side: 'long', stage: 'confirmation',
    displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
    swept_pool: { name: 'AS.L', level: 29764.0 },
  };
  const bars = { m1: [{ close: 29787, low: 29783 }] };
  const next = evaluateAdvance(walker, { ...baseGates }, bars);
  assert.equal(next.stage, 'trigger');
  assert.ok(next.setup);
  assert.equal(next.setup.entry, 29787);
  assert.equal(next.setup.stop, 29763.75); // 1 tick below swept_pool.level (0.25 tick assumed)
});

test('MSS advance: confirmation BLOCKED if volume not acceptable', () => {
  const walker = {
    model: 'MSS', variant: 'standard', side: 'long', stage: 'retrace_pending',
    displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
  };
  const gates = {
    ...baseGates,
    engine: {
      ...baseGates.engine,
      confirmation: { last_bar: { body_ratio: 0.75, direction: 'up', close: 29787, volume_acceptable: false } },
    },
  };
  const bars = { m1: [{ low: 29783, high: 29790, close: 29787, body_ratio: 0.75 }] };
  const next = evaluateAdvance(walker, gates, bars);
  assert.equal(next.stage, 'retrace_pending', 'should stay pending if volume not acceptable');
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement evaluateAdvance with MSS logic**

Replace `walker-evaluate.js`:

```javascript
// Stage advance + kill evaluators. Pure functions.

const TICK_SIZE = 0.25;  // MNQ. MES uses same; if symbol-dependent, plumb in via rules.

export function evaluateAdvance(walker, gates, bars) {
  switch (walker.model) {
    case 'MSS': return advanceMss(walker, gates, bars);
    case 'TREND': return advanceTrend(walker, gates, bars);
    case 'INVERSION': return advanceInversion(walker, gates, bars);
    default: return { stage: walker.stage };
  }
}

function advanceMss(walker, gates, bars) {
  const m1 = bars?.m1 ?? [];
  const lastBar = m1[m1.length - 1];
  if (!lastBar) return { stage: walker.stage };

  if (walker.stage === 'displacement_done' || walker.stage === 'displacement_done_5m') {
    // Retrace check: did the bar wick into the FVG?
    const wickedIn = walker.side === 'long'
      ? lastBar.low <= walker.displacement_fvg.high && lastBar.low >= walker.displacement_fvg.low
      : lastBar.high >= walker.displacement_fvg.low && lastBar.high <= walker.displacement_fvg.high;
    if (wickedIn) return { stage: 'retrace_pending' };
    return { stage: walker.stage };
  }

  if (walker.stage === 'retrace_pending') {
    // Confirmation: clean-body close beyond CE in our direction + quality gates.
    const cleanBody = (lastBar.body_ratio ?? 0) >= 0.6;
    const correctDir = walker.side === 'long' ? lastBar.close > walker.displacement_fvg.ce : lastBar.close < walker.displacement_fvg.ce;
    const cleanCandle = gates?.engine?.pillar2?.current_tf?.candle === 'clean';
    const volumeOK = gates?.engine?.confirmation?.last_bar?.volume_acceptable === true;
    const m5Opposing = (gates?.engine_by_tf?.m5?.structure_events ?? []).some(
      (s) => s.event === 'MSS' && s.dir !== (walker.side === 'long' ? 'up' : 'down')
    );
    if (cleanBody && correctDir && cleanCandle && volumeOK && !m5Opposing) {
      return { stage: 'confirmation' };
    }
    return { stage: walker.stage };
  }

  if (walker.stage === 'confirmation') {
    // Build setup payload + emit trigger.
    const entry = lastBar.close;
    const stop = walker.side === 'long'
      ? walker.swept_pool.level - TICK_SIZE
      : walker.swept_pool.level + TICK_SIZE;
    const tp1 = walker.side === 'long' ? entry + (entry - stop) * 1.5 : entry - (stop - entry) * 1.5;
    const tp2 = walker.side === 'long' ? entry + (entry - stop) * 3.0 : entry - (stop - entry) * 3.0;
    return {
      stage: 'trigger',
      setup: {
        model: 'MSS', side: walker.side, entry, stop,
        tp1: roundTick(tp1), tp2: roundTick(tp2),
        size_multiplier: walker.size_multiplier ?? 1.0,
        grade: 'A+',
      },
    };
  }
  return { stage: walker.stage };
}

function advanceTrend(walker, gates, bars) {
  // Implemented in Task 10.
  return { stage: walker.stage };
}

function advanceInversion(walker, gates, bars) {
  // Implemented in Task 11.
  return { stage: walker.stage };
}

export function evaluateKill(walker, gates, bars) {
  // Implemented in Task 12.
  return { kill: false };
}

function roundTick(v) {
  return Math.round(v / TICK_SIZE) * TICK_SIZE;
}
```

- [ ] **Step 4: Run, verify PASS.**

Run: `node --test tests/walker/walker-evaluate-mss.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-evaluate.js tests/walker/walker-evaluate-mss.test.js
git commit -m "$(cat <<'EOF'
feat(walker): MSS advance evaluator — displacement -> retrace -> confirmation -> trigger

Confirmation gated by: clean body (>=0.6), correct direction past CE, engine candle=clean, volume_acceptable=true, no opposing m5 MSS. Trigger emits {entry, stop, tp1, tp2, grade=A+}.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Task 10: Trend advance evaluator

**Files:**
- Modify: `app/main/walker/walker-evaluate.js`
- Create: `tests/walker/walker-evaluate-trend.test.js`

- [ ] **Step 1: Write failing tests for Trend advance**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAdvance } from '../../app/main/walker/walker-evaluate.js';

test('Trend advance: impulse_done -> retrace_pending on wick into FVG', () => {
  const w = { model: 'TREND', variant: 'standard', side: 'long', stage: 'impulse_done',
              displacement_fvg: { high: 29812, low: 29808, ce: 29810 } };
  const bars = { m5: [{ low: 29808.5, high: 29815, close: 29812 }] };
  const next = evaluateAdvance(w, { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } }, bars);
  assert.equal(next.stage, 'retrace_pending');
});

test('Trend advance: retrace_pending -> confirmation on 5m close above CE', () => {
  const w = { model: 'TREND', variant: 'standard', side: 'long', stage: 'retrace_pending',
              displacement_fvg: { high: 29812, low: 29808, ce: 29810 } };
  const bars = { m5: [{ low: 29808.5, high: 29816, close: 29814, body_ratio: 0.72 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  assert.equal(evaluateAdvance(w, gates, bars).stage, 'confirmation');
});

test('Trend advance: confirmation -> trigger emits setup with stop at last HL', () => {
  const w = { model: 'TREND', variant: 'standard', side: 'long', stage: 'confirmation',
              displacement_fvg: { high: 29812, low: 29808, ce: 29810 } };
  const bars = { m5: [{ close: 29814, low: 29808.5 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  const next = evaluateAdvance(w, gates, bars);
  assert.equal(next.stage, 'trigger');
  assert.ok(next.setup);
  assert.equal(next.setup.model, 'TREND');
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement advanceTrend in walker-evaluate.js**

Replace the `advanceTrend` stub:

```javascript
function advanceTrend(walker, gates, bars) {
  const m5 = bars?.m5 ?? [];
  const last = m5[m5.length - 1];
  if (!last) return { stage: walker.stage };

  if (walker.stage === 'impulse_done') {
    const wickedIn = walker.side === 'long'
      ? last.low <= walker.displacement_fvg.high && last.low >= walker.displacement_fvg.low
      : last.high >= walker.displacement_fvg.low && last.high <= walker.displacement_fvg.high;
    if (wickedIn) return { stage: 'retrace_pending' };
    return { stage: walker.stage };
  }

  if (walker.stage === 'retrace_pending') {
    const cleanBody = (last.body_ratio ?? 0) >= 0.6;
    const correctDir = walker.side === 'long' ? last.close > walker.displacement_fvg.ce : last.close < walker.displacement_fvg.ce;
    const cleanCandle = gates?.engine?.pillar2?.current_tf?.candle === 'clean';
    const volumeOK = gates?.engine?.confirmation?.last_bar?.volume_acceptable === true;
    const m5Opposing = (gates?.engine_by_tf?.m5?.structure_events ?? []).some(
      (s) => s.event === 'MSS' && s.dir !== (walker.side === 'long' ? 'up' : 'down')
    );
    if (cleanBody && correctDir && cleanCandle && volumeOK && !m5Opposing) return { stage: 'confirmation' };
    return { stage: walker.stage };
  }

  if (walker.stage === 'confirmation') {
    const entry = last.close;
    // Stop at the last HL (the displacement FVG's low for long, high for short).
    const stop = walker.side === 'long' ? walker.displacement_fvg.low - TICK_SIZE : walker.displacement_fvg.high + TICK_SIZE;
    const risk = Math.abs(entry - stop);
    const tp1 = walker.side === 'long' ? entry + risk * 1.5 : entry - risk * 1.5;
    const tp2 = walker.side === 'long' ? entry + risk * 3.0 : entry - risk * 3.0;
    return {
      stage: 'trigger',
      setup: { model: 'TREND', side: walker.side, entry, stop, tp1: roundTick(tp1), tp2: roundTick(tp2), size_multiplier: walker.size_multiplier ?? 1.0, grade: 'A+' },
    };
  }
  return { stage: walker.stage };
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-evaluate.js tests/walker/walker-evaluate-trend.test.js
git commit -m "$(cat <<'EOF'
feat(walker): Trend advance evaluator

5m confirmation; stop at displacement FVG opposite edge; TP1=1.5R, TP2=3R from risk.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Task 11: Inversion advance (aggressive + patient promotion)

**Files:**
- Modify: `app/main/walker/walker-evaluate.js`
- Create: `tests/walker/walker-evaluate-inversion.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAdvance } from '../../app/main/walker/walker-evaluate.js';

test('Inversion advance: spawn -> inversion_violation on close through opposing FVG', () => {
  const w = { model: 'INVERSION', variant: 'aggressive', side: 'long', stage: 'spawn',
              displacement_fvg: { high: 29830, low: 29826, ce: 29828 } };
  const bars = { m1: [{ close: 29832, low: 29827, high: 29833, body_ratio: 0.72 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  const next = evaluateAdvance(w, gates, bars);
  assert.equal(next.stage, 'inversion_violation');
});

test('Inversion advance: inversion_violation -> confirmation on clean close above former bearish FVG', () => {
  const w = { model: 'INVERSION', variant: 'aggressive', side: 'long', stage: 'inversion_violation',
              displacement_fvg: { high: 29830, low: 29826, ce: 29828 } };
  const bars = { m1: [{ close: 29833, low: 29830.5, high: 29834, body_ratio: 0.7 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  assert.equal(evaluateAdvance(w, gates, bars).stage, 'confirmation');
});

test('Inversion advance: confirmation -> trigger emits setup', () => {
  const w = { model: 'INVERSION', variant: 'aggressive', side: 'long', stage: 'confirmation',
              displacement_fvg: { high: 29830, low: 29826, ce: 29828 } };
  const bars = { m1: [{ close: 29834, low: 29830 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  const next = evaluateAdvance(w, gates, bars);
  assert.equal(next.stage, 'trigger');
  assert.equal(next.setup.model, 'INVERSION');
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement advanceInversion**

```javascript
function advanceInversion(walker, gates, bars) {
  const m1 = bars?.m1 ?? [];
  const last = m1[m1.length - 1];
  if (!last) return { stage: walker.stage };

  if (walker.stage === 'spawn') {
    // Violation: close through the opposing FVG in our direction.
    const closedThrough = walker.side === 'long'
      ? last.close > walker.displacement_fvg.high
      : last.close < walker.displacement_fvg.low;
    if (closedThrough) return { stage: 'inversion_violation' };
    return { stage: walker.stage };
  }

  if (walker.stage === 'inversion_violation') {
    // Aggressive variant: confirm immediately on next clean close in direction.
    // Patient variant: wait for retrace into iFVG first (extra retrace_pending stage).
    if (walker.variant === 'patient') {
      // Patient: did this bar wick back into the now-iFVG?
      const wickedIn = walker.side === 'long'
        ? last.low <= walker.displacement_fvg.high && last.low >= walker.displacement_fvg.low
        : last.high >= walker.displacement_fvg.low && last.high <= walker.displacement_fvg.high;
      if (wickedIn) return { stage: 'retrace_pending' };
      return { stage: walker.stage };
    }
    // Aggressive: gate by quality + clean close past the violated FVG.
    const cleanBody = (last.body_ratio ?? 0) >= 0.6;
    const correctDir = walker.side === 'long' ? last.close > walker.displacement_fvg.high : last.close < walker.displacement_fvg.low;
    const cleanCandle = gates?.engine?.pillar2?.current_tf?.candle === 'clean';
    const volumeOK = gates?.engine?.confirmation?.last_bar?.volume_acceptable === true;
    if (cleanBody && correctDir && cleanCandle && volumeOK) return { stage: 'confirmation' };
    return { stage: walker.stage };
  }

  if (walker.stage === 'retrace_pending') {
    // Only reachable for patient variant. Wait for clean close back in direction.
    const cleanBody = (last.body_ratio ?? 0) >= 0.6;
    const correctDir = walker.side === 'long' ? last.close > walker.displacement_fvg.high : last.close < walker.displacement_fvg.low;
    const cleanCandle = gates?.engine?.pillar2?.current_tf?.candle === 'clean';
    const volumeOK = gates?.engine?.confirmation?.last_bar?.volume_acceptable === true;
    if (cleanBody && correctDir && cleanCandle && volumeOK) return { stage: 'confirmation' };
    return { stage: walker.stage };
  }

  if (walker.stage === 'confirmation') {
    const entry = last.close;
    const stop = walker.side === 'long' ? walker.displacement_fvg.low - TICK_SIZE : walker.displacement_fvg.high + TICK_SIZE;
    const risk = Math.abs(entry - stop);
    const tp1 = walker.side === 'long' ? entry + risk * 1.5 : entry - risk * 1.5;
    const tp2 = walker.side === 'long' ? entry + risk * 3.0 : entry - risk * 3.0;
    return {
      stage: 'trigger',
      setup: { model: 'INVERSION', side: walker.side, entry, stop, tp1: roundTick(tp1), tp2: roundTick(tp2), size_multiplier: walker.size_multiplier ?? 1.0, grade: 'A+' },
    };
  }
  return { stage: walker.stage };
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-evaluate.js tests/walker/walker-evaluate-inversion.test.js
git commit -m "$(cat <<'EOF'
feat(walker): Inversion advance evaluator

Aggressive variant: spawn -> inversion_violation (close through opposing FVG) -> confirmation -> trigger. Patient variant follows same chain but with extra retrace_pending stage (handled via stage table only — same transitions reused).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Task 12: walker-evaluate.js evaluateKill

**Files:**
- Modify: `app/main/walker/walker-evaluate.js`
- Modify: existing per-model test files (append kill tests)

- [ ] **Step 1: Write failing tests covering kill cases**

Append to `tests/walker/walker-evaluate-mss.test.js`:

```javascript
test('MSS kill: chop_timeout fires after 15 min without advance', () => {
  const w = { model: 'MSS', variant: 'standard', side: 'long', stage: 'retrace_pending',
              displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
              last_advanced_at: Date.now() - 16 * 60_000 };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: {} } }, engine_by_tf: { m5: { structure_events: [] } } };
  const bars = { m1: [{ low: 29783, high: 29790, close: 29787 }] };
  const k = evaluateKill(w, gates, bars);
  assert.equal(k.kill, true);
  assert.equal(k.reason, 'chop_timeout');
});

test('MSS kill: structure_break fires when new low forms below swept pool', () => {
  const w = { model: 'MSS', variant: 'standard', side: 'long', stage: 'retrace_pending',
              displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
              swept_pool: { name: 'AS.L', level: 29764.0 },
              last_advanced_at: Date.now() };
  const bars = { m1: [{ low: 29760, close: 29762, high: 29770 }] };
  const k = evaluateKill(w, {}, bars);
  assert.equal(k.kill, true);
  assert.equal(k.reason, 'structure_break');
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement evaluateKill**

Replace evaluateKill stub:

```javascript
const CHOP_TIMEOUT_MS = 15 * 60_000;

export function evaluateKill(walker, gates, bars) {
  // 1. Chop timeout — no advance in 15 min while in a retrace/intermediate stage.
  if (['retrace_pending', 'inversion_violation', 'displacement_done', 'displacement_done_5m', 'impulse_done'].includes(walker.stage)) {
    if (walker.last_advanced_at && Date.now() - walker.last_advanced_at > CHOP_TIMEOUT_MS) {
      return { kill: true, reason: 'chop_timeout' };
    }
  }

  // 2. Structure break — for MSS waiting on retrace, new low below swept pool (or new high if short) invalidates.
  if (walker.model === 'MSS' && walker.swept_pool && bars?.m1) {
    const last = bars.m1[bars.m1.length - 1];
    if (last) {
      if (walker.side === 'long' && last.low < walker.swept_pool.level) return { kill: true, reason: 'structure_break' };
      if (walker.side === 'short' && last.high > walker.swept_pool.level) return { kill: true, reason: 'structure_break' };
    }
  }

  return { kill: false };
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-evaluate.js tests/walker/walker-evaluate-mss.test.js
git commit -m "$(cat <<'EOF'
feat(walker): kill conditions — chop_timeout + structure_break

Walker dies after 15 min of no advance, or when a new same-side extreme breaks the swept pool. Per-stage applicability.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase F — Cap

### Task 13: walker-cap.js LIFO eviction

**Files:**
- Modify: `app/main/walker/walker-cap.js`
- Create: `tests/walker/walker-cap.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceCap } from '../../app/main/walker/walker-cap.js';

test('cap: below max, returns unchanged', () => {
  const ws = [{ id: 'a', created_at: 1 }, { id: 'b', created_at: 2 }];
  assert.deepEqual(enforceCap(ws, 4), ws);
});

test('cap: at max, evicts oldest', () => {
  const ws = [
    { id: 'a', created_at: 1 },
    { id: 'b', created_at: 2 },
    { id: 'c', created_at: 3 },
    { id: 'd', created_at: 4 },
    { id: 'e', created_at: 5 },
  ];
  const capped = enforceCap(ws, 4);
  assert.equal(capped.length, 4);
  assert.equal(capped.find((w) => w.id === 'a'), undefined);
});

test('cap: never evicts walkers past confirmation stage', () => {
  const ws = [
    { id: 'a', created_at: 1, stage: 'spawn' },
    { id: 'b', created_at: 2, stage: 'spawn' },
    { id: 'c', created_at: 3, stage: 'confirmation' },
    { id: 'd', created_at: 4, stage: 'spawn' },
    { id: 'e', created_at: 5, stage: 'spawn' },
  ];
  const capped = enforceCap(ws, 4);
  assert.ok(capped.find((w) => w.id === 'c'), 'must keep confirmation-stage walker');
  assert.equal(capped.length, 4);
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement enforceCap**

Replace `walker-cap.js`:

```javascript
// LIFO eviction with stage protection. Walkers in confirmation or later
// stages are protected from eviction — they're about to fire.

const PROTECTED_STAGES = new Set(['confirmation', 'trigger']);

export function enforceCap(walkers, maxLive) {
  if (!Array.isArray(walkers) || walkers.length <= maxLive) return walkers;
  const protectedW = walkers.filter((w) => PROTECTED_STAGES.has(w.stage));
  const evictable = walkers
    .filter((w) => !PROTECTED_STAGES.has(w.stage))
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));   // newest first
  const slotsForEvictable = Math.max(0, maxLive - protectedW.length);
  return [...protectedW, ...evictable.slice(0, slotsForEvictable)];
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-cap.js tests/walker/walker-cap.test.js
git commit -m "$(cat <<'EOF'
feat(walker): cap with LIFO eviction + stage protection

Confirmation+ stages are protected from eviction. Newest non-protected walkers fill remaining slots.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase G — Sizing

### Task 14: walker-sizing.js win-rate multiplier

**Files:**
- Modify: `app/main/walker/walker-sizing.js`
- Create: `tests/walker/walker-sizing.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSizeMultiplier } from '../../app/main/walker/walker-sizing.js';

test('sizing: <10 trades → 1.0x default', () => {
  const r = computeSizeMultiplier({ model: 'MSS', history: { mss: [{ outcome: 'TP1_HIT' }] }, userMax: null, autoSizing: 'on' });
  assert.equal(r.factor, 1.0);
  assert.match(r.reason, /insufficient sample/i);
});

test('sizing: 60% win rate → 1.2x', () => {
  const history = { mss: Array(20).fill(null).map((_, i) => ({ outcome: i < 13 ? 'TP1_HIT' : 'STOPPED' })) };
  const r = computeSizeMultiplier({ model: 'MSS', history, userMax: null, autoSizing: 'on' });
  assert.equal(r.factor, 1.2);
  assert.match(r.reason, /65%|13W.7L/);
});

test('sizing: 35% win rate → 0.5x', () => {
  const history = { mss: Array(20).fill(null).map((_, i) => ({ outcome: i < 7 ? 'TP1_HIT' : 'STOPPED' })) };
  const r = computeSizeMultiplier({ model: 'MSS', history, userMax: null, autoSizing: 'on' });
  assert.equal(r.factor, 0.5);
});

test('sizing: 50% win rate → 1.0x', () => {
  const history = { mss: Array(20).fill(null).map((_, i) => ({ outcome: i < 10 ? 'TP1_HIT' : 'STOPPED' })) };
  const r = computeSizeMultiplier({ model: 'MSS', history, userMax: null, autoSizing: 'on' });
  assert.equal(r.factor, 1.0);
});

test('sizing: autoSizing off → 1.0x regardless of win rate', () => {
  const history = { mss: Array(20).fill({ outcome: 'TP1_HIT' }) };
  const r = computeSizeMultiplier({ model: 'MSS', history, userMax: null, autoSizing: 'off' });
  assert.equal(r.factor, 1.0);
  assert.match(r.reason, /disabled/i);
});

test('sizing: TP1+BE+stop counts as win', () => {
  const history = { mss: [
    ...Array(10).fill({ outcome: 'TP1_HIT' }),
    ...Array(5).fill({ outcome: 'STOPPED_AT_BE' }),  // still wins
    ...Array(5).fill({ outcome: 'STOPPED' }),
  ]};
  const r = computeSizeMultiplier({ model: 'MSS', history, userMax: null, autoSizing: 'on' });
  // 15 wins / 20 trades = 75% → 1.2x
  assert.equal(r.factor, 1.2);
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement computeSizeMultiplier**

Replace `walker-sizing.js`:

```javascript
// Position-size multiplier from rolling win rate. Pure function.

const MIN_SAMPLE = 10;
const HISTORY_WINDOW = 20;
const WIN_OUTCOMES = new Set(['TP1_HIT', 'TP2_HIT', 'STOPPED_AT_BE']);

export function computeSizeMultiplier({ model, history, userMax, autoSizing }) {
  if (autoSizing === 'off') {
    return { factor: 1.0, reason: 'auto-sizing disabled in USER.md' };
  }
  const key = String(model).toLowerCase();
  const trades = (history?.[key] ?? []).slice(-HISTORY_WINDOW);
  if (trades.length < MIN_SAMPLE) {
    return { factor: 1.0, reason: `insufficient sample (${trades.length}/${MIN_SAMPLE} trades)` };
  }
  const wins = trades.filter((t) => WIN_OUTCOMES.has(t.outcome)).length;
  const rate = wins / trades.length;
  const losses = trades.length - wins;
  const reason = `${model} last ${trades.length}: ${wins}W/${losses}L · ${Math.round(rate * 100)}%`;
  let factor;
  if (rate < 0.4) factor = 0.5;
  else if (rate > 0.6) factor = 1.2;
  else factor = 1.0;
  // userMax is enforced downstream by the trade executor, not here.
  return { factor, reason };
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-sizing.js tests/walker/walker-sizing.test.js
git commit -m "$(cat <<'EOF'
feat(walker): rolling-win-rate sizing multiplier

20-trade window per model. <10 trades = 1.0x. <40% = 0.5x cooldown. 40-60% = 1.0x. >60% = 1.2x boost. Off switch via USER.md. TP1_HIT, TP2_HIT, STOPPED_AT_BE all count as wins.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase H — Wire engine + runtime

### Task 15: Wire spawn + evaluate + cap + sizing into walker-engine.js

**Files:**
- Modify: `app/main/walker/walker-engine.js`

- [ ] **Step 1: Add a comprehensive end-to-end test**

Append to `tests/walker/walker-engine.test.js`:

```javascript
import { detectIgnitions } from '../../app/main/walker/walker-spawn.js';
import { evaluateAdvance, evaluateKill } from '../../app/main/walker/walker-evaluate.js';
import { computeSizeMultiplier } from '../../app/main/walker/walker-sizing.js';

test('tickWalkers: end-to-end MSS lifecycle in three ticks', () => {
  const now = Date.now();
  let state = { session: 'ny-am', walkers: [], triggers: [], proof: { last_1m_close: null, last_5m_close: null } };
  const rules = { walker_max_live: 4, walker_auto_sizing: 'on', max_risk_per_trade: 100 };
  const memory = { walkerSkipLines: [] };
  const calendar = { events: [] };
  const history = { mss: [], trend: [], inversion: [] };

  // Tick 1: sweep + failure_swing -> spawn at displacement_done
  let r = tickWalkers({
    prev: state, gates: {
      engine: {
        meta: { schema: 2 },
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
        pillar3: { fvgs: [], structure_events: [],
                   failure_swings: [{ event: 'MSS', dir: 'up', displacement: true, ts_ms: now - 30_000, level: 29782,
                                       new_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75, dir: 'up' } }] },
        pillar2: { current_tf: { candle: 'clean' } },
        confirmation: { last_bar: { volume_acceptable: true } },
      },
      engine_by_tf: { m5: { structure_events: [] } },
    },
    bars: { m1: [{ low: 29784, high: 29790, close: 29787 }], m5: [] },
    rules, calendar, memory, history,
  });
  assert.equal(r.next.walkers.length, 1);
  assert.equal(r.next.walkers[0].stage, 'displacement_done');
  state = r.next;

  // Tick 2: bar wicks into FVG -> retrace_pending
  r = tickWalkers({
    prev: state, gates: {
      engine: {
        meta: { schema: 2 },
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
        pillar3: { fvgs: [], structure_events: [], failure_swings: [] },
        pillar2: { current_tf: { candle: 'clean' } },
        confirmation: { last_bar: { volume_acceptable: true } },
      },
      engine_by_tf: { m5: { structure_events: [] } },
    },
    bars: { m1: [{ low: 29782.5, high: 29786, close: 29784, body_ratio: 0.5 }], m5: [] },
    rules, calendar, memory, history,
  });
  assert.equal(r.next.walkers[0].stage, 'retrace_pending');
  state = r.next;

  // Tick 3: clean close above CE -> confirmation -> trigger
  r = tickWalkers({
    prev: state, gates: {
      engine: {
        meta: { schema: 2 },
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
        pillar3: { fvgs: [], structure_events: [], failure_swings: [] },
        pillar2: { current_tf: { candle: 'clean' } },
        confirmation: { last_bar: { volume_acceptable: true } },
      },
      engine_by_tf: { m5: { structure_events: [] } },
    },
    bars: { m1: [{ low: 29783, high: 29790, close: 29787, body_ratio: 0.72 }], m5: [] },
    rules, calendar, memory, history,
  });
  assert.equal(r.triggers.length, 1);
  assert.equal(r.triggers[0].outcome, 'fired');
  assert.equal(r.triggers[0].setup.model, 'MSS');
});
```

- [ ] **Step 2: Run, verify FAIL** (tickWalkers is a stub).

- [ ] **Step 3: Implement tickWalkers**

Replace `walker-engine.js`:

```javascript
import { detectIgnitions } from './walker-spawn.js';
import { evaluateAdvance, evaluateKill } from './walker-evaluate.js';
import { enforceCap } from './walker-cap.js';
import { computeSizeMultiplier } from './walker-sizing.js';

export function tickWalkers({ prev, gates, bars, rules, calendar, memory, history, suppression }) {
  const now = Date.now();
  const triggers = [];
  let walkers = (prev?.walkers ?? []).slice();
  const supp = suppression ?? { activeTradeSide: null };

  // 1. Kill pass — drop walkers that no longer apply.
  walkers = walkers.filter((w) => {
    const k = evaluateKill(w, gates, bars);
    if (k.kill) {
      triggers.push({ ts: now, walker_id: w.id, stage: w.stage, outcome: 'killed', reason: k.reason });
      return false;
    }
    return true;
  });

  // 2. Advance pass — try to move each walker forward one stage.
  walkers = walkers.map((w) => {
    const adv = evaluateAdvance(w, gates, bars);
    if (adv.stage === w.stage) return w;
    const next = { ...w, stage: adv.stage, last_advanced_at: now, last_evaluated_at: now };
    if (adv.stage === 'trigger' && adv.setup) {
      const { factor, reason } = computeSizeMultiplier({ model: w.model, history, userMax: rules?.max_risk_per_trade, autoSizing: rules?.walker_auto_sizing });
      const setup = { ...adv.setup, size_multiplier: factor };
      next.size_multiplier = factor;
      next.size_reason = reason;
      triggers.push({ ts: now, walker_id: w.id, stage: 'confirmation', outcome: 'fired', setup });
    }
    return next;
  });

  // 3. Spawn pass — new walkers from ignition events.
  const newW = detectIgnitions({ gates, bars, prev: { walkers }, calendar, memory, suppression: supp });
  walkers = walkers.concat(newW);

  // 4. Cap pass — LIFO evict with stage protection.
  walkers = enforceCap(walkers, rules?.walker_max_live ?? 4);

  // 5. Update proof markers.
  const m1Last = bars?.m1?.[bars.m1.length - 1];
  const m5Last = bars?.m5?.[bars.m5.length - 1];
  const proof = {
    last_1m_close: m1Last?.ts_ms ?? prev?.proof?.last_1m_close ?? null,
    last_5m_close: m5Last?.ts_ms ?? prev?.proof?.last_5m_close ?? null,
  };

  return {
    next: {
      session: prev?.session,
      walkers,
      triggers: (prev?.triggers ?? []).concat(triggers),
      proof,
    },
    triggers,
  };
}
```

- [ ] **Step 4: Run, verify PASS.**

Run: `node --test tests/walker/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-engine.js tests/walker/walker-engine.test.js
git commit -m "$(cat <<'EOF'
feat(walker): wire kill -> advance -> spawn -> cap into tickWalkers

End-to-end MSS lifecycle test in three ticks proves the integration. Setup size_multiplier injected from rolling win rate on trigger.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase I — Seven upgrades

### Task 16: Upgrade 1 — News-aware spawn pause

**Files:**
- Modify: `app/main/walker/walker-spawn.js`
- Modify: `app/main/walker/walker-evaluate.js`
- Append to existing spawn + evaluate test files

- [ ] **Step 1: Write failing tests**

Append to `tests/walker/walker-spawn-mss.test.js`:

```javascript
test('news pause: spawn suppressed within ±15 min of red event', () => {
  const now = Date.now();
  const input = {
    gates: { engine: {
      pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
      pillar3: { fvgs: [], structure_events: [],
                 failure_swings: [{ event: 'MSS', dir: 'up', displacement: true, ts_ms: now - 30_000, level: 29782,
                                     new_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75, dir: 'up' } }] },
    } },
    bars: { m1: [], m5: [] },
    prev: { walkers: [] },
    calendar: { events: [{ impact: 'high', ts: now + 5 * 60_000 }] },  // event 5 min away
    memory: { walkerSkipLines: [] },
    suppression: { activeTradeSide: null },
  };
  assert.equal(detectIgnitions(input).length, 0, 'spawn must be suppressed during news window');
});
```

Append to `tests/walker/walker-evaluate-mss.test.js`:

```javascript
test('news pause: retrace_pending walker killed in news window', () => {
  const now = Date.now();
  const w = { model: 'MSS', stage: 'retrace_pending', last_advanced_at: now };
  const gates = { calendar: { events: [{ impact: 'high', ts: now + 10 * 60_000 }] } };
  const k = evaluateKill(w, gates, { m1: [] });
  assert.equal(k.kill, true);
  assert.equal(k.reason, 'news_window');
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement news guard**

In `walker-spawn.js`, add at the top of `detectIgnitions`:

```javascript
const NEWS_WINDOW_MS = 15 * 60_000;
function inNewsWindow(calendar) {
  const now = Date.now();
  return (calendar?.events ?? []).some((e) => e?.impact === 'high' && Math.abs(now - e.ts) <= NEWS_WINDOW_MS);
}
export function detectIgnitions({ gates, bars, prev, calendar, memory, suppression }) {
  if (inNewsWindow(calendar)) return [];
  // ... existing dispatch
}
```

In `walker-evaluate.js`, prepend a news check to `evaluateKill`:

```javascript
const NEWS_WINDOW_MS = 15 * 60_000;
export function evaluateKill(walker, gates, bars) {
  if (walker.stage === 'retrace_pending') {
    const events = gates?.calendar?.events ?? [];
    const now = Date.now();
    if (events.some((e) => e?.impact === 'high' && Math.abs(now - e.ts) <= NEWS_WINDOW_MS)) {
      return { kill: true, reason: 'news_window' };
    }
  }
  // ... existing kill logic
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-spawn.js app/main/walker/walker-evaluate.js tests/walker/walker-spawn-mss.test.js tests/walker/walker-evaluate-mss.test.js
git commit -m "$(cat <<'EOF'
feat(walker): news-aware spawn pause + retrace kill

Within ±15 min of any impact=high calendar event, detectIgnitions returns empty and retrace_pending walkers die with reason=news_window.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Task 17: Upgrade 4 — Memory-aware spawn vetoes

**Files:**
- Modify: `app/main/walker/walker-spawn.js`
- Append to spawn test files

- [ ] **Step 1: Write failing test**

```javascript
test('memory veto: spawn skipped when walker-skip line matches', () => {
  const now = Date.now();
  const input = {
    gates: { engine: {
      pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
      pillar3: { fvgs: [], structure_events: [],
                 failure_swings: [{ event: 'MSS', dir: 'up', displacement: true, ts_ms: now - 30_000, level: 29782,
                                     new_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75, dir: 'up' } }] },
    } },
    bars: { m1: [], m5: [] },
    prev: { walkers: [] },
    calendar: { events: [] },
    memory: { walkerSkipLines: ['walker-skip: MSS long AS.L'] },
    suppression: { activeTradeSide: null },
  };
  assert.equal(detectIgnitions(input).length, 0, 'spawn must be vetoed by memory line');
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement memory veto check**

In `walker-spawn.js`, add:

```javascript
function vetoedByMemory(memory, model, side, swept_pool_name) {
  const lines = memory?.walkerSkipLines ?? [];
  for (const line of lines) {
    const m = String(line).match(/walker-skip:\s*(\w+)\s+(\w+)\s+(.+)/i);
    if (!m) continue;
    const [_, lModel, lSide, lCondition] = m;
    if (lModel.toUpperCase() === model.toUpperCase() && lSide.toLowerCase() === side.toLowerCase()) {
      if (swept_pool_name && lCondition.trim() === swept_pool_name) return true;
      if (lCondition.trim() === '*') return true;
    }
  }
  return false;
}
```

Then guard each spawn function. Example for MSS:

```javascript
function spawnMssStandard({ gates, prev, memory }) {
  // ... existing code
  for (const sw of sweeps) {
    // ... existing checks
    if (vetoedByMemory(memory, 'MSS', swingDir === 'up' ? 'long' : 'short', sw.name)) continue;
    // ... push walker
  }
}
```

And thread `memory` into each spawn call from `detectIgnitions`:

```javascript
out.push(...spawnMssStandard({ gates, prev, memory }));
out.push(...spawnMssSweepInto5m({ gates, prev, memory }));
out.push(...spawnTrendStandard({ gates, prev, memory }));
out.push(...spawnInversion({ gates, prev, memory }));
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-spawn.js tests/walker/walker-spawn-mss.test.js
git commit -m "$(cat <<'EOF'
feat(walker): memory-aware spawn vetoes

Trader writes 'walker-skip: <MODEL> <SIDE> <CONDITION>' in MEMORY.md. detectIgnitions consults these lines and skips matching spawns. Format: 'walker-skip: MSS long AS.L' or 'walker-skip: TREND short *'.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Task 18: Upgrade 5 — Correlation suppression

**Files:**
- Modify: `app/main/walker/walker-spawn.js`
- Append to spawn test files

- [ ] **Step 1: Write failing test**

```javascript
test('correlation suppression: long walker suppressed if active long trade exists', () => {
  const now = Date.now();
  const input = {
    gates: { engine: {
      pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
      pillar3: { fvgs: [], structure_events: [],
                 failure_swings: [{ event: 'MSS', dir: 'up', displacement: true, ts_ms: now - 30_000, level: 29782,
                                     new_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75, dir: 'up' } }] },
    } },
    bars: { m1: [], m5: [] },
    prev: { walkers: [] },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    suppression: { activeTradeSide: 'long' },
  };
  assert.equal(detectIgnitions(input).length, 0, 'long walker must be suppressed when active long trade exists');
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement suppression check**

In `walker-spawn.js`, guard each spawn:

```javascript
function suppressedByCorrelation(suppression, side) {
  return suppression?.activeTradeSide && suppression.activeTradeSide === side;
}
```

In each `spawn*` function, after determining `side`, check:

```javascript
if (suppressedByCorrelation(suppression, side === 'long' ? 'long' : 'short')) continue;
```

Thread `suppression` through every spawn call.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-spawn.js tests/walker/walker-spawn-mss.test.js
git commit -m "$(cat <<'EOF'
feat(walker): correlation suppression

If an active trade exists with side=X, new walkers of side=X are suppressed. Avoids correlated double-exposure across MNQ/MES.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Task 19: Upgrade 6 — Hypothetical R panel

**Files:**
- Modify: `app/main/walker/walker-evaluate.js`
- Append to evaluate tests

- [ ] **Step 1: Write failing test**

```javascript
test('hypothetical R: computed for retrace_pending MSS walker', () => {
  const w = { model: 'MSS', variant: 'standard', side: 'long', stage: 'retrace_pending',
              displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
              swept_pool: { name: 'AS.L', level: 29764.0 } };
  const bars = { m1: [{ close: 29787, low: 29783, high: 29790 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'doji_wick' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  const next = evaluateAdvance(w, gates, bars);
  // stage stays retrace_pending (candle not clean) but hypothetical_r should populate
  assert.equal(next.stage, 'retrace_pending');
  assert.ok(typeof next.hypothetical_r_to_stop === 'number');
  assert.ok(typeof next.hypothetical_r_to_tp1 === 'number');
  assert.ok(next.hypothetical_r_to_stop > 0);
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement hypothetical R computation**

In `walker-evaluate.js`, extract hypothetical-R computation as a helper and call from advance functions:

```javascript
function computeHypotheticalR(walker, lastClose) {
  if (!walker.swept_pool || lastClose == null) {
    return { hypothetical_r_to_stop: null, hypothetical_r_to_tp1: null };
  }
  const stop = walker.side === 'long'
    ? walker.swept_pool.level - TICK_SIZE
    : walker.swept_pool.level + TICK_SIZE;
  const risk = Math.abs(lastClose - stop);
  if (risk <= 0) return { hypothetical_r_to_stop: null, hypothetical_r_to_tp1: null };
  // Where's hypothetical TP1? Use displacement FVG far edge as a proxy.
  const tp1Target = walker.side === 'long' ? walker.displacement_fvg.high + risk * 0.5 : walker.displacement_fvg.low - risk * 0.5;
  return {
    hypothetical_r_to_stop: Number((risk / TICK_SIZE / 4).toFixed(2)),  // R in points / 1pt per tick
    hypothetical_r_to_tp1: Number((Math.abs(tp1Target - lastClose) / risk).toFixed(2)),
  };
}
```

Update `advanceMss`, `advanceTrend`, `advanceInversion` to merge hypothetical R into the return when stage stays in a pending state:

```javascript
// At end of each retrace_pending / inversion_violation branch:
const hyp = computeHypotheticalR(walker, lastBar.close);
return { stage: walker.stage, ...hyp };
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-evaluate.js tests/walker/walker-evaluate-mss.test.js
git commit -m "$(cat <<'EOF'
feat(walker): hypothetical R-to-stop + R-to-TP1 on retrace_pending walkers

Computed every tick from current price + projected stop. LIVE panel will render this so the trader sees what's at stake before confirmation fires.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

(Upgrades 2, 3, 7 are already implemented in earlier tasks: volume gating in Task 9, multi-TF coherence in Task 9, auto-sizing in Task 14. Tasks 16/17/18/19 cover the remaining four.)

---

## Phase J — Runtime

### Task 20: walker-runtime.js file I/O + memory + calendar adapters

**Files:**
- Modify: `app/main/walker/walker-runtime.js`
- Create: `tests/walker/walker-runtime.test.js`

- [ ] **Step 1: Write failing test for state persistence + memory parsing**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readWalkersJson, writeWalkersJson, parseMemorySkipLines } from '../../app/main/walker/walker-runtime.js';

test('runtime: readWalkersJson returns empty default when file missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walker-'));
  const state = readWalkersJson(tmpDir, 'ny-am');
  assert.deepEqual(state, { session: 'ny-am', walkers: [], triggers: [], proof: { last_1m_close: null, last_5m_close: null } });
  fs.rmSync(tmpDir, { recursive: true });
});

test('runtime: writeWalkersJson then readWalkersJson roundtrips', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walker-'));
  const s = { session: 'ny-am', walkers: [{ id: 'w1', model: 'MSS' }], triggers: [], proof: { last_1m_close: 1000, last_5m_close: 1000 } };
  writeWalkersJson(tmpDir, 'ny-am', s);
  const r = readWalkersJson(tmpDir, 'ny-am');
  assert.deepEqual(r, s);
  fs.rmSync(tmpDir, { recursive: true });
});

test('runtime: parseMemorySkipLines extracts walker-skip lines from MEMORY.md content', () => {
  const md = `# Memory\n- general note\n- walker-skip: MSS long AS.L\n- walker-skip: TREND short *\n- another note\n`;
  const lines = parseMemorySkipLines(md);
  assert.deepEqual(lines, ['walker-skip: MSS long AS.L', 'walker-skip: TREND short *']);
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement runtime helpers**

Replace `walker-runtime.js`:

```javascript
import fs from 'node:fs';
import path from 'node:path';

const EMPTY_STATE = (session) => ({
  session,
  walkers: [],
  triggers: [],
  proof: { last_1m_close: null, last_5m_close: null },
});

export function walkersJsonPath(sessionDir, sessionLabel) {
  return path.join(sessionDir, sessionLabel, 'walkers.json');
}

export function readWalkersJson(sessionDir, sessionLabel) {
  const p = walkersJsonPath(sessionDir, sessionLabel);
  if (!fs.existsSync(p)) return EMPTY_STATE(sessionLabel);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return EMPTY_STATE(sessionLabel);
  }
}

export function writeWalkersJson(sessionDir, sessionLabel, state) {
  const p = walkersJsonPath(sessionDir, sessionLabel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, p);
}

export function parseMemorySkipLines(memoryMdContent) {
  const out = [];
  for (const line of String(memoryMdContent ?? '').split('\n')) {
    const trimmed = line.replace(/^[-*]\s+/, '').trim();
    if (/^walker-skip:/i.test(trimmed)) out.push(trimmed);
  }
  return out;
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/main/walker/walker-runtime.js tests/walker/walker-runtime.test.js
git commit -m "$(cat <<'EOF'
feat(walker): runtime adapters — read/write walkers.json + parse memory skip lines

Atomic write via tmpfile + rename. Empty default on missing/corrupt. Memory parser extracts 'walker-skip: ...' lines from MEMORY.md content.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase K — Bar-close detector integration

### Task 21: Wire walkerTick into bar-close.js

**Files:**
- Modify: `app/main/bar-close.js`
- Reference: `app/main/sessions.js`, `app/main/calendar.js`, `state/memory/MEMORY.md`

- [ ] **Step 1: Inspect current bar-close routing**

Run: `grep -n "userTurn\|purpose\|phase\|entry.hunt" app/main/bar-close.js | head -30`
Expected: see where current code calls `userTurn({ purpose: 'bar-close', ... })` and how phase is derived.

- [ ] **Step 2: Modify bar-close to call walkerTick for entry-hunt phase**

In `app/main/bar-close.js`, find the closure that fires the bar-close userTurn. Wrap it with a phase gate:

```javascript
import { tickWalkers } from './walker/walker-engine.js';
import { readWalkersJson, writeWalkersJson, parseMemorySkipLines } from './walker/walker-runtime.js';
import { activeSessionDir } from './sessions.js';
import { readCache as readCalendarCache } from './calendar.js';
import { acceptSetup as persistSetup } from './trades.js';  // existing path
import fs from 'node:fs';
import path from 'node:path';

// ... inside the bar-close handler:
const phase = clock.phase;
const sessionLabel = sessionLabelForPhase(phase);

if (sessionLabel && ['ENTRY HUNT', 'OPEN REACTION'].includes(phase) === false) {
  // unchanged Claude path for brief/open-reaction/wrap/catch-up
} else if (sessionLabel) {
  // Walker path replaces entry-hunt Claude turn.
  try {
    const sessionDir = activeSessionDir(); // returns state/session/<date>/
    const prev = readWalkersJson(sessionDir, sessionLabel);
    const gates = bundle.gates;
    const bars = { m1: bundle.bars?.last_5_bars ?? [], m5: bundle.bars_by_tf?.m5?.last_5_bars ?? [] };
    const calendar = await readCalendarCache();
    const memoryPath = path.join(process.cwd(), 'state', 'memory', 'MEMORY.md');
    const memoryContent = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8') : '';
    const memory = { walkerSkipLines: parseMemorySkipLines(memoryContent) };
    const history = readClosedTradeHistory(sessionDir);  // helper that reads setups.jsonl + trades.jsonl
    const rules = readWalkerRules();  // helper that reads USER.md keys
    const activeTradePath = path.join(sessionDir, sessionLabel, 'active_trade.json');
    const activeTrade = fs.existsSync(activeTradePath) ? JSON.parse(fs.readFileSync(activeTradePath, 'utf8')) : null;
    const suppression = { activeTradeSide: activeTrade?.side ?? null };

    const { next, triggers } = tickWalkers({ prev, gates, bars, rules, calendar, memory, history, suppression });
    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      writeWalkersJson(sessionDir, sessionLabel, next);
      send('walkers:state', { session: sessionLabel, walkers: next.walkers });
    }
    for (const t of triggers) {
      if (t.outcome === 'fired' && t.setup) {
        await persistSetup(t.setup);
      }
    }
  } catch (err) {
    send('app:error', { source: 'walker', message: String(err?.message || err) });
  }
} else {
  // Outside any tracked session — no walker, no Claude.
}
```

Add helper stubs inside `bar-close.js` for `sessionLabelForPhase`, `readClosedTradeHistory`, `readWalkerRules`.

- [ ] **Step 3: Add `walkers:state` IPC broadcast**

In `app/preload.cjs`, add:

```javascript
walkers: {
  onState(cb) {
    const listener = (_e, ev) => cb(ev);
    ipcRenderer.on('walkers:state', listener);
    return () => ipcRenderer.removeListener('walkers:state', listener);
  },
},
```

- [ ] **Step 4: Smoke test — restart Electron, trigger one bar close in dev**

Run: from `app/`, `npm run dev`. Wait for first bar close after entry-hunt phase. Watch console:

Expected: `[walker] tick session=ny-am walkers=N triggers=N`. No exceptions.

If exceptions on missing helpers, walk back and implement them.

- [ ] **Step 5: Commit**

```bash
git add app/main/bar-close.js app/preload.cjs
git commit -m "$(cat <<'EOF'
feat(walker): bar-close detector routes entry-hunt to walkerTick

Entry-hunt + open-reaction phases now call walkerTick instead of firing a Claude userTurn. Brief/wrap/catch-up still on Claude. New IPC channel 'walkers:state' for LIVE renderer.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase L — Backtest integration

### Task 22: Wire walkerTick into backtest-engine.js

**Files:**
- Modify: `app/main/backtest-engine.js`

- [ ] **Step 1: Inspect current backtest flow**

Run: `grep -n "userTurn\|replay_step\|persistSetup" app/main/backtest-engine.js | head -20`
Expected: see how the backtest engine advances bars and fires LLM turns.

- [ ] **Step 2: Replace userTurn call in backtest with walkerTick**

In `app/main/backtest-engine.js`, find the per-bar advance loop. Replace the `userTurn` call with a `tickWalkers` call mirroring Task 21:

```javascript
import { tickWalkers } from './walker/walker-engine.js';

// In the per-bar loop:
const { next, triggers } = tickWalkers({
  prev: state.walkers,
  gates: bundle.gates,
  bars: { m1: bundle.bars.last_5_bars, m5: bundle.bars_by_tf.m5.last_5_bars },
  rules: state.config.rules,
  calendar: state.calendar,
  memory: { walkerSkipLines: [] },  // backtests don't apply memory vetoes — clean room
  history: state.tradeHistory,
});
state.walkers = next;
for (const t of triggers) {
  if (t.outcome === 'fired') await handleBacktestTrigger(t.setup);
}
```

- [ ] **Step 3: Smoke test — start a backtest from the BACKTEST popover**

Restart Electron. Open BACKTEST popover. Configure a small run (e.g., one ny-am session). Click START.

Expected: bars advance quickly (no LLM cost per bar). Setups fire when walkers confirm. UI updates per AUTO/PAUSE flow.

- [ ] **Step 4: Commit**

```bash
git add app/main/backtest-engine.js
git commit -m "$(cat <<'EOF'
feat(walker): backtest engine ticks walkerTick per bar

Same engine for live + backtest. Backtest no longer pays LLM cost per bar; runs at speed of disk + JS.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase M — LIVE WALKER STATUS panel

### Task 23: Add WALKER STATUS panel to EntryHuntView

**Files:**
- Create: `app/renderer/src/hooks/useWalkers.js`
- Modify: `app/renderer/src/LivePopover.jsx`

- [ ] **Step 1: Create useWalkers hook**

```javascript
// app/renderer/src/hooks/useWalkers.js
import { useEffect, useState } from 'react';

export function useWalkers() {
  const [walkers, setWalkers] = useState([]);
  useEffect(() => {
    const off = window.api?.walkers?.onState?.((ev) => {
      setWalkers(ev?.walkers ?? []);
    });
    return () => off?.();
  }, []);
  return walkers;
}
```

- [ ] **Step 2: Render WALKER STATUS in EntryHuntView**

In `app/renderer/src/LivePopover.jsx`, import the hook and add a panel above the existing SetupCard:

```jsx
import { useWalkers } from './hooks/useWalkers.js';

function WalkerStatusPanel({ walkers }) {
  if (!walkers || walkers.length === 0) {
    return (
      <div style={{ padding: '10px 14px', color: 'var(--label-dim)', fontSize: 10.5, letterSpacing: '.18em' }}>
        WALKER STATUS · no candidates
      </div>
    );
  }
  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ color: 'var(--label)', fontSize: 10, letterSpacing: '.22em', marginBottom: 8 }}>WALKER STATUS</div>
      {walkers.map((w) => (
        <div key={w.id} style={{ fontSize: 10.5, marginBottom: 6 }}>
          <div style={{ color: 'var(--value)' }}>{w.panel_id} · {w.model} · {w.variant} · {(w.size_multiplier ?? 1).toFixed(1)}× size</div>
          <div style={{ color: 'var(--label-dim)' }}>▸ {w.stage}{w.last_advanced_at ? ` (${Math.round((Date.now() - w.last_advanced_at) / 60_000)}m)` : ''}</div>
          {w.displacement_fvg && (
            <div style={{ color: 'var(--label)' }}>
              watching FVG {w.displacement_fvg.low}-{w.displacement_fvg.high}
              {w.hypothetical_r_to_stop != null ? ` · R-to-stop ${w.hypothetical_r_to_stop}` : ''}
              {w.hypothetical_r_to_tp1 != null ? ` · R-to-TP1 ${w.hypothetical_r_to_tp1}` : ''}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

Inside `EntryHuntView`, add:

```jsx
const walkers = useWalkers();
// at top of returned JSX:
<WalkerStatusPanel walkers={walkers} />
```

- [ ] **Step 3: Smoke test**

Restart Electron. Open LIVE popover during entry-hunt phase. Wait for a walker to spawn (chart needs to be at a session with a sweep).

Expected: WALKER STATUS panel renders. Updates each bar close.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/hooks/useWalkers.js app/renderer/src/LivePopover.jsx
git commit -m "$(cat <<'EOF'
feat(walker): LIVE popover WALKER STATUS panel

Renders walker list with model, stage, watched FVG, size multiplier, hypothetical R. Updates via walkers:state IPC.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase N — Helper deletions

### Task 24: Delete obsoleted helpers + their tests

**Files:**
- Delete: `cli/lib/entry-model-priority.js`
- Delete: `cli/lib/setup-detector.js`
- Delete: `tests/entry-model-priority.test.js`
- Delete: `tests/setup-detector.test.js`

- [ ] **Step 1: Confirm no other modules import these**

Run: `grep -rn "entry-model-priority\|setup-detector" app/ cli/ tests/`
Expected: only references inside the files about to be deleted, plus the spec/plan docs (which describe them historically — OK).

If a live module imports them, that import must be removed first.

- [ ] **Step 2: Delete files**

Run:

```bash
git rm cli/lib/entry-model-priority.js cli/lib/setup-detector.js tests/entry-model-priority.test.js tests/setup-detector.test.js
```

- [ ] **Step 3: Run full test suite**

Run: `npm run test:unit`
Expected: PASS. No references to the deleted modules.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(walker): delete entry-model-priority + setup-detector

Walker engine subsumes both. Spawn detection lives in walker-spawn.js; model decision is now mechanical, not a resolver.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase O — Prompt deletion

### Task 25: Strip entry-hunt section from phase-bar-close.md

**Files:**
- Modify: `app/main/prompts/phase-bar-close.md`

- [ ] **Step 1: Find the entry-hunt section boundaries**

Run: `grep -n "entry.hunt\|ENTRY HUNT\|phase=.entry.hunt" app/main/prompts/phase-bar-close.md | head -10`
Expected: line numbers for the section start and end.

- [ ] **Step 2: Delete the entry-hunt phase block + any helper subsections it owns**

Remove the block from the prompt file. Keep brief / open-reaction / catch-up / wrap sections intact.

- [ ] **Step 3: Verify prompt still loads + composes**

Run: `npm run test:unit -- --test-name-pattern="system-prompt"`
Expected: PASS — the partials system can compose this purpose without the entry-hunt block.

- [ ] **Step 4: Manual smoke — restart Electron, fire one bar-close turn in pre-session phase**

Expected: brief turn fires normally. Entry-hunt phase no longer triggers a Claude turn (walker handles).

- [ ] **Step 5: Commit**

```bash
git add app/main/prompts/phase-bar-close.md
git commit -m "$(cat <<'EOF'
feat(walker): remove entry-hunt section from phase-bar-close prompt

Walker engine owns this phase now. Prompt drops ~3K chars of Pillar 3 reasoning instructions that no longer apply.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase P — Fixture tests

### Task 26: End-to-end fixture replay tests

**Files:**
- Create: `tests/walker/walker-fixtures.test.js`
- Create: `tests/walker/walker-fixtures/*.json` (6-8 fixtures)

- [ ] **Step 1: Capture or hand-build 6 fixture scenarios**

Each fixture is a JSON file containing a series of `{gates, bars}` snapshots representing successive bar closes during a known session. Reconstruct from existing `tests/fixtures/*.bundle.json` files or record from a live replay.

Fixture list:
- `mss-aplus-001.json` — known A+ MSS setup, walker should fire confirmation by tick N
- `trend-aplus-001.json` — known A+ Trend setup
- `inversion-aplus-001.json` — known A+ Inversion setup
- `no-trade-001.json` — session with no setup, walker should never confirm
- `news-pause-001.json` — high-impact news at 09:30 ET → walker should not spawn during ±15 min window
- `correlation-suppress-001.json` — long active trade present → new long walker suppressed
- `invalidated-001.json` — MSS sweep + displacement, then structure breaks → walker dies with reason=structure_break

Each file format:

```json
{
  "label": "mss-aplus-001",
  "session": "ny-am",
  "expected_outcome": "fired",
  "expected_setup": { "model": "MSS", "side": "long", "grade": "A+" },
  "ticks": [
    { "tick": 1, "gates": { /* ... */ }, "bars": { "m1": [/* ... */], "m5": [/* ... */] } },
    /* one tick per closed bar */
  ]
}
```

- [ ] **Step 2: Write the fixture runner test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tickWalkers } from '../../app/main/walker/walker-engine.js';

const FIXTURE_DIR = path.join(import.meta.dirname, 'walker-fixtures');
const fixtures = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));

for (const file of fixtures) {
  test(`fixture: ${file}`, () => {
    const fx = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
    let state = { session: fx.session, walkers: [], triggers: [], proof: { last_1m_close: null, last_5m_close: null } };
    let fired = null;
    for (const tick of fx.ticks) {
      const r = tickWalkers({
        prev: state,
        gates: tick.gates,
        bars: tick.bars,
        rules: { walker_max_live: 4, walker_auto_sizing: 'off', max_risk_per_trade: 100 },
        calendar: tick.calendar ?? { events: [] },
        memory: tick.memory ?? { walkerSkipLines: [] },
        history: tick.history ?? { mss: [], trend: [], inversion: [] },
      });
      state = r.next;
      for (const t of r.triggers) {
        if (t.outcome === 'fired') fired = t.setup;
      }
    }
    if (fx.expected_outcome === 'fired') {
      assert.ok(fired, `${file}: expected a fired setup, got none`);
      assert.equal(fired.model, fx.expected_setup.model);
      assert.equal(fired.side, fx.expected_setup.side);
    } else if (fx.expected_outcome === 'killed') {
      assert.equal(state.walkers.length, 0, `${file}: expected all walkers killed`);
    } else if (fx.expected_outcome === 'no_spawn') {
      assert.equal(state.walkers.length, 0, `${file}: expected no spawns`);
    }
  });
}
```

- [ ] **Step 3: Run, verify each fixture PASSES**

Run: `node --test tests/walker/walker-fixtures.test.js`
Expected: all 6-8 fixtures PASS. If any fail, the walker logic disagrees with the fixture's expected outcome — investigate which is wrong.

- [ ] **Step 4: Commit fixtures + runner**

```bash
git add tests/walker/walker-fixtures.test.js tests/walker/walker-fixtures/
git commit -m "$(cat <<'EOF'
test(walker): 6-8 fixture-based end-to-end replays

A+ MSS, A+ Trend, A+ Inversion, no-trade, invalidated, news-pause, correlation-suppress. Walker engine must match expected outcome per fixture.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase Q — Backtest validation

### Task 27: Run ≥10 historical sessions through walker via backtest

- [ ] **Step 1: Open BACKTEST popover**

In the running app, open BACKTEST cell. Configure a multi-session run covering the last 10 trading days.

- [ ] **Step 2: Start the run, watch for triggers**

Let it run AUTO mode end-to-end. Observe:
- Walker triggers per session match what Claude would have surfaced in the same session
- No false positives (walker fires on a setup Claude rightfully rejected)
- No missed setups (walker rejects a setup Claude correctly took)

- [ ] **Step 3: Document discrepancies**

Where walker disagrees with Claude historically, classify:
- Walker correct — surface the fix to the trader (probable improvement)
- Walker incorrect — file a follow-up issue, do not block PR

- [ ] **Step 4: Backtest validation report**

Create a brief summary in the PR description (Task 28). Don't commit a doc.

---

## Phase R — Ship

### Task 28: Push branch + open PR

- [ ] **Step 1: Push**

Run: `git push -u origin feat/walker-engine`

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main --title "feat: walker engine for Pillar 3 + confirmation (PR1 of walker-engine spec)" --body "$(cat <<'EOF'
## Summary
- Walker engine in `app/main/walker/` — pure JS state machine
- Bar-close detector + backtest engine call `walkerTick` per bar
- Entry-hunt Claude turn removed; engine decides MSS/Trend/Inversion mechanically
- ACCEPT/REJECT UI + trade tracking unchanged
- 7 upgrades over ghxstofnq original: news-aware spawn, volume gating, multi-TF coherence, memory vetoes, correlation suppression, hypothetical-R panel, auto-sizing

## Test plan
- [ ] `npm run test:unit` — all walker tests pass
- [ ] `npm run smoke:fixtures` — citation harness intact
- [ ] Backtest popover runs ≥10 historical sessions through walker, triggers compared to Claude reference
- [ ] Manual smoke: live session — WALKER STATUS panel renders, walker spawns on real sweep, advances on real bars, confirmation fires (or is correctly rejected by volume/multi-TF/memory checks)
- [ ] Entry-hunt prompt deleted; no Claude turn during entry-hunt phase
- [ ] Deleted helpers (entry-model-priority, setup-detector) not referenced anywhere

## Validation report
<paste summary from Task 27 — walker vs Claude historical comparison>

Depends on PR0 (ICT Engine V2 migration) being merged.
Related: [docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md](docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done criteria

- All walker unit tests PASS (`node --test tests/walker/`)
- Smoke fixtures PASS (`npm run smoke:fixtures`)
- Backtest validation: ≥10 sessions replay through walker without crash, triggers consistent with Claude reference
- Live smoke: WALKER STATUS panel renders, walker spawns + advances + fires + dies correctly on real bars
- Entry-hunt prompt stripped from `phase-bar-close.md`
- `entry-model-priority.js`, `setup-detector.js`, and their tests deleted
- Branch pushed, PR opened, blocked-by-PR0 noted
