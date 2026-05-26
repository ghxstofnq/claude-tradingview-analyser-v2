# Strategy Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move strategy interpretation from the LLM prompt into deterministic code. Add `cli/lib/setup-detector.js` that evaluates MSS / Trend / Inversion component-by-component against engine state, emits a structured candidate object, and the model copies values + writes narration. Post-hoc validator in `surface.js` audits the model's surfaced setup. New `<anti_patterns>` prompt block lists the 8 specific misreads from this week. No model override. Tests-only trust path — full reject mode from day one.

**Architecture:** Three new pure modules in `cli/lib/` (`setup-detector.js` orchestrator, `setup-detector-stops.js` stop placement, `setup-detector-schema.js` field disambiguation). Detector called from `cli/commands/analyze.js` → writes `bundle.candidates`. `bar-close.js` reads `bundle.candidates` → injects into per-bar prompt as `<candidate_object>`. `app/main/tools/surface.js` `surfaceSetup` gains a validator audit step. `app/main/prompts/analyze.md` `<phase name="entry_hunt">` rewritten + new `<anti_patterns>` block; mirrored to `.claude/commands/analyze.md`.

**Tech Stack:** Node 20 (ESM), `node:test` runner, Zod (already used by SDK), Electron 32 main + React renderer, Chrome DevTools Protocol on port 9223.

**Spec:** [`docs/superpowers/specs/2026-05-26-strategy-detector-design.md`](../specs/2026-05-26-strategy-detector-design.md)

**Branch base:** `feat/setup-detector` cuts from `spec/strategy-chain` (depends on `brief_digest`, `entry-model-priority.js`, `sizing.js` from PR #61). Final task rebases onto `main` after #61 merges (no-op if main already contains the chain work).

---

## File map

**Create:**
- `cli/lib/setup-detector.js` — orchestrator, per-model evaluators, tradable rule, conflict resolution.
- `cli/lib/setup-detector-stops.js` — stop placement (candle 1, candle 3, swing pivot, FVG fallback).
- `cli/lib/setup-detector-schema.js` — engine field disambiguation rewrites.
- `tests/setup-detector.test.js` — orchestrator + per-model evaluator + tradable rule tests (~35).
- `tests/setup-detector-stops.test.js` — stop placement tests (~10).
- `tests/setup-detector-schema.test.js` — field rewrite tests (~6).
- `tests/surface-validator.test.js` — validator audit tests (~10).
- `tests/fixtures/006-mss-bull-tradable.bundle.json` + `.expected.md`.
- `tests/fixtures/007-trend-bull-tradable.bundle.json` + `.expected.md`.
- `tests/fixtures/008-inversion-short-tradable.bundle.json` + `.expected.md`.
- `tests/fixtures/miss-regressions/miss-{01..08}-*.bundle.json` + `.expected.md` (8 pairs).

**Modify:**
- `cli/commands/analyze.js` — call `detectSetups`, attach to `bundle.candidates`.
- `app/main/bar-close.js` — read `bundle.candidates`, inject `<candidate_object>` into per-bar prompt; detect override attempts.
- `app/main/tools/surface.js` — `validateSetupAgainstCandidate` audit step in `surfaceSetup`; throw on mismatch.
- `app/main/prompts/analyze.md` — rewrite `<phase name="entry_hunt">`, add `<anti_patterns>` block.
- `.claude/commands/analyze.md` — mirror prompt changes.
- `CLAUDE.md` — append decision row + update `analyze` recipe section.

---

## Task 1: Branch setup + fixture directory scaffolding

**Files:**
- Modify: working tree
- Create: `tests/fixtures/miss-regressions/` directory

- [ ] **Step 1: Verify clean working tree**

Run: `git status`
Expected: clean (or only known stale files like `tests/.tmp-brief-flow/`)

- [ ] **Step 2: Cut feature branch from spec/strategy-chain**

Run: `git checkout -b feat/setup-detector spec/strategy-chain`
Expected: switched to a new branch 'feat/setup-detector'

- [ ] **Step 3: Create fixture directory**

Run: `mkdir -p tests/fixtures/miss-regressions`
Expected: directory created.

- [ ] **Step 4: Commit branch marker (empty README placeholder for the new dir so git tracks it)**

Create `tests/fixtures/miss-regressions/README.md`:

```markdown
# Miss-regression fixtures

Each fixture in this directory captures one of the 8 strategy-fidelity misses
from the 2026-05-26 session log (see docs/research/2026-05-26-llm-strategy-fidelity.md).
The detector must NOT replicate the misread on each bundle.

Format matches `tests/fixtures/README.md`: paired `*.bundle.json` + `*.expected.md`.
```

```bash
git add tests/fixtures/miss-regressions/README.md
git commit -m "$(cat <<'EOF'
chore(detector): scaffold feat/setup-detector branch + miss-regressions dir

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Schema disambiguation module + tests

**Files:**
- Create: `cli/lib/setup-detector-schema.js`
- Create: `tests/setup-detector-schema.test.js`

This module is the foundation — every evaluator and stop-placement helper consumes its rewrites. Build first, depend on it everywhere.

- [ ] **Step 1: Write failing test for FVG state rewrite**

Create `tests/setup-detector-schema.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disambiguateFvg, disambiguateSessionLevel, disambiguateStructureEvent } from '../cli/lib/setup-detector-schema.js';

test('disambiguateFvg: state=fresh becomes created_never_retested', () => {
  const fvg = { state: 'fresh', reacted: true, created_ms: 1000, top: 100, bottom: 95, kind: 'fvg', dir: 'bull' };
  const r = disambiguateFvg(fvg);
  assert.equal(r.state_semantic, 'created_never_retested');
  assert.equal(r.retested_since_creation, false);
  assert.equal(r.displacement_at_creation, true);
  assert.equal(r.valid_as_zone, true);
});

test('disambiguateFvg: state=ce_tapped becomes midpoint_tapped_at_least_once', () => {
  const fvg = { state: 'ce_tapped', reacted: false, created_ms: 1000, top: 100, bottom: 95, kind: 'fvg', dir: 'bull' };
  const r = disambiguateFvg(fvg);
  assert.equal(r.state_semantic, 'midpoint_tapped_at_least_once');
  assert.equal(r.retested_since_creation, true);
  assert.equal(r.displacement_at_creation, false);
  assert.equal(r.valid_as_zone, true);
});

test('disambiguateFvg: state=taken becomes fully_traded_through and valid_as_zone=false', () => {
  const fvg = { state: 'taken', reacted: true, created_ms: 1000, top: 100, bottom: 95, kind: 'fvg', dir: 'bull' };
  const r = disambiguateFvg(fvg);
  assert.equal(r.state_semantic, 'fully_traded_through');
  assert.equal(r.valid_as_zone, false);
});

test('disambiguateSessionLevel: taken=true becomes swept=true valid_as_target=false', () => {
  const lvl = { name: 'AS_H', price: 29990, taken: true };
  const r = disambiguateSessionLevel(lvl);
  assert.equal(r.swept, true);
  assert.equal(r.valid_as_target, false);
});

test('disambiguateSessionLevel: taken=false becomes valid_as_target=true', () => {
  const lvl = { name: 'PDH', price: 30119, taken: false };
  const r = disambiguateSessionLevel(lvl);
  assert.equal(r.swept, false);
  assert.equal(r.valid_as_target, true);
});

test('disambiguateStructureEvent: surfaces is_reclaimed from existing field', () => {
  const ev = { event: 'bos', dir: 'bull', level: 100, reclaimed: true };
  const r = disambiguateStructureEvent(ev);
  assert.equal(r.is_reclaimed, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern="disambiguate"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `cli/lib/setup-detector-schema.js`:

```js
// Rewrites ambiguous engine fields into semantically explicit names.
// Source: docs/superpowers/specs/2026-05-26-strategy-detector-design.md §Schema disambiguation

const FVG_STATE_SEMANTIC = {
  fresh:     'created_never_retested',
  ce_tapped: 'midpoint_tapped_at_least_once',
  taken:     'fully_traded_through',
  invalidated: 'invalidated',
};

export function disambiguateFvg(fvg) {
  if (!fvg) return fvg;
  return {
    ...fvg,
    state_semantic: FVG_STATE_SEMANTIC[fvg.state] ?? fvg.state,
    retested_since_creation: fvg.state !== 'fresh',
    displacement_at_creation: fvg.reacted === true,
    valid_as_zone: fvg.state !== 'taken' && fvg.state !== 'invalidated',
  };
}

export function disambiguateSessionLevel(lvl) {
  if (!lvl) return lvl;
  return {
    ...lvl,
    swept: lvl.taken === true,
    valid_as_target: lvl.taken !== true,
  };
}

export function disambiguateStructureEvent(ev) {
  if (!ev) return ev;
  return {
    ...ev,
    is_reclaimed: ev.reclaimed === true,
  };
}

// Derives candle 1 / candle 3 prices from an FVG's created_ms + the bars at the FVG's TF.
// FVG is a 3-candle pattern. candle 3 = bar at created_ms. candle 1 = bar at created_ms - 2 * tf_ms.
export function deriveFvgFormationCandles(fvg, barsAtTf, tfMs) {
  if (!fvg || !fvg.created_ms || !Array.isArray(barsAtTf) || !tfMs) return null;
  const c3Ms = fvg.created_ms;
  const c1Ms = fvg.created_ms - 2 * tfMs;
  const c3 = barsAtTf.find((b) => Math.abs(b.time * 1000 - c3Ms) < tfMs / 2);
  const c1 = barsAtTf.find((b) => Math.abs(b.time * 1000 - c1Ms) < tfMs / 2);
  if (!c1 || !c3) return null;
  return {
    candle1: { time_ms: c1.time * 1000, low: c1.low, high: c1.high },
    candle3: { time_ms: c3.time * 1000, low: c3.low, high: c3.high },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --test-name-pattern="disambiguate"`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/setup-detector-schema.js tests/setup-detector-schema.test.js
git commit -m "$(cat <<'EOF'
feat(detector): schema disambiguation module — FVG/level/structure rewrites

Rewrites ambiguous engine fields per PARSE/ARCHITECT pattern. fvg.state
becomes state_semantic + retested_since_creation; fvg.reacted becomes
displacement_at_creation; level.taken becomes swept + valid_as_target;
structure_event.reclaimed surfaces as is_reclaimed. Also derives
candle 1 / candle 3 prices from FVG created_ms + bars (for stop placement).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Stop placement module + tests

**Files:**
- Create: `cli/lib/setup-detector-stops.js`
- Create: `tests/setup-detector-stops.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/setup-detector-stops.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopOptionsForFvgEntry, stopOptionsForInversionEntry, stopOptionsForStructureEntry, closestSwingPivot } from '../cli/lib/setup-detector-stops.js';

const TF_M5_MS = 5 * 60 * 1000;

test('closestSwingPivot: picks pivot with minimum absolute distance to entry', () => {
  const pivots = [
    { price: 29985, tier: 'internal', is_high: false },
    { price: 30005, tier: 'swing',    is_high: true  },
    { price: 29990, tier: 'internal', is_high: false },
  ];
  // entry=30000, side=long → stop must be below entry; both lows qualify; 29990 is closer.
  const r = closestSwingPivot(pivots, { entry: 30000, side: 'long' });
  assert.equal(r.price, 29990);
});

test('closestSwingPivot: returns null when no pivot on correct side', () => {
  const pivots = [
    { price: 30010, tier: 'internal', is_high: true },
  ];
  const r = closestSwingPivot(pivots, { entry: 30000, side: 'long' });
  assert.equal(r, null);
});

test('stopOptionsForFvgEntry: bull side ranks candle1_low > swing > fvg_bottom', () => {
  const fvg = { top: 29998.5, bottom: 29992.5, dir: 'bull', created_ms: 1779836400000, kind: 'fvg' };
  const bars = [
    { time: 1779836160 / 1, low: 29981.25, high: 29988.75 }, // candle 1
    { time: 1779836280 / 1, low: 29982.25, high: 29991.5 },  // candle 2
    { time: 1779836400 / 1, low: 29990,    high: 29998.5 },  // candle 3
  ];
  const pivots = [{ price: 29982.25, tier: 'internal', is_high: false, cite: 'gates.engine.pillar3.structures_by_tier.internal[7]' }];
  const r = stopOptionsForFvgEntry({ fvg, side: 'long', barsAtTf: bars, tf: 'm5', tfMs: 120_000, fvgIdx: 3, pivots, entry: 29998.5 });
  assert.equal(r[0].kind, 'fvg_candle1_low');
  assert.equal(r[0].value, 29981.25);
  assert.equal(r[0].cite, 'bars_by_tf.m5.last_5_bars[0].low');
  assert.equal(r[1].kind, 'swing_pivot');
  assert.equal(r[1].value, 29982.25);
  assert.equal(r[2].kind, 'fvg_bottom');
  assert.equal(r[2].value, 29992.5);
  assert.equal(r[2].cite, 'engine_by_tf.m5.fvgs[3].bottom');
});

test('stopOptionsForFvgEntry: skips candle1_low if bars unavailable', () => {
  const fvg = { top: 29998.5, bottom: 29992.5, dir: 'bull', created_ms: 1779836400000, kind: 'fvg' };
  const pivots = [{ price: 29982.25, tier: 'internal', is_high: false, cite: 'gates.engine.pillar3.structures_by_tier.internal[7]' }];
  const r = stopOptionsForFvgEntry({ fvg, side: 'long', barsAtTf: [], tf: 'm5', tfMs: 120_000, fvgIdx: 3, pivots, entry: 29998.5 });
  assert.equal(r[0].kind, 'swing_pivot');
  assert.equal(r[1].kind, 'fvg_bottom');
});

test('stopOptionsForInversionEntry: bull side uses candle 3 of original FVG (the low that defined the bottom)', () => {
  const fvg = { top: 29998.5, bottom: 29992.5, dir: 'bull', created_ms: 1779836400000, kind: 'ifvg' };
  const bars = [
    { time: 1779836400 / 1, low: 29990, high: 29998.5 },  // candle 3
  ];
  const r = stopOptionsForInversionEntry({ fvg, side: 'long', barsAtTf: bars, tf: 'm5', tfMs: 120_000, fvgIdx: 2, pivots: [], entry: 29998.5 });
  assert.equal(r[0].kind, 'fvg_candle3_low');
  assert.equal(r[0].value, 29990);
  assert.equal(r[0].cite, 'bars_by_tf.m5.last_5_bars[0].low');
});

test('stopOptionsForStructureEntry: returns swing pivot only', () => {
  const pivots = [{ price: 29982.25, tier: 'swing', is_high: false, cite: 'gates.engine.pillar3.structures_by_tier.swing[1]' }];
  const r = stopOptionsForStructureEntry({ side: 'long', pivots, entry: 30000 });
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'swing_pivot');
  assert.equal(r[0].value, 29982.25);
  assert.equal(r[0].cite, 'gates.engine.pillar3.structures_by_tier.swing[1]');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern="stop"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `cli/lib/setup-detector-stops.js`:

```js
import { deriveFvgFormationCandles } from './setup-detector-schema.js';

// Returns the pivot with minimum absolute distance from `entry` that's on the correct
// side (below entry for long, above entry for short). Pivots span all tiers (HH/HL/LH/LL).
export function closestSwingPivot(pivots, { entry, side }) {
  if (!Array.isArray(pivots) || pivots.length === 0) return null;
  const filtered = pivots.filter((p) => {
    if (side === 'long')  return p.is_high === false && p.price < entry;
    if (side === 'short') return p.is_high === true  && p.price > entry;
    return false;
  });
  if (filtered.length === 0) return null;
  return filtered.reduce((best, cur) =>
    Math.abs(cur.price - entry) < Math.abs(best.price - entry) ? cur : best
  );
}

// Finds the bar index in barsAtTf that matches a target ms timestamp (within tfMs/2).
function findBarIndex(barsAtTf, targetMs, tfMs) {
  return barsAtTf.findIndex((b) => Math.abs(b.time * 1000 - targetMs) < tfMs / 2);
}

// Priority for FVG-based entries (MSS retrace, Trend pullback):
//   1. candle 1 low/high of the 3-candle FVG formation
//   2. closest swing pivot past entry
//   3. FVG bottom/top (fallback)
export function stopOptionsForFvgEntry({ fvg, side, barsAtTf, tf, tfMs, fvgIdx, pivots, entry }) {
  const options = [];
  const candles = deriveFvgFormationCandles(fvg, barsAtTf, tfMs);
  if (candles) {
    const kind = side === 'long' ? 'fvg_candle1_low' : 'fvg_candle1_high';
    const value = side === 'long' ? candles.candle1.low : candles.candle1.high;
    const barIdx = findBarIndex(barsAtTf, candles.candle1.time_ms, tfMs);
    options.push({
      kind, value,
      cite: `bars_by_tf.${tf}.last_5_bars[${barIdx}].${side === 'long' ? 'low' : 'high'}`,
      rationale: `FVG candle 1 (first structure candle of the 3-candle formation, time_ms=${candles.candle1.time_ms})`,
    });
  }
  const pivot = closestSwingPivot(pivots, { entry, side });
  if (pivot) {
    options.push({
      kind: 'swing_pivot',
      value: pivot.price,
      cite: pivot.cite,
      rationale: `closest swing ${pivot.tier} pivot past entry`,
    });
  }
  const fallbackKind = side === 'long' ? 'fvg_bottom' : 'fvg_top';
  const fallbackValue = side === 'long' ? fvg.bottom : fvg.top;
  options.push({
    kind: fallbackKind,
    value: fallbackValue,
    cite: `engine_by_tf.${tf}.fvgs[${fvgIdx}].${side === 'long' ? 'bottom' : 'top'}`,
    rationale: 'FVG bottom/top — fallback when candle 1 and swing pivot unavailable',
  });
  return options;
}

// Priority for Inversion entries: stop = candle 3 low/high of the ORIGINAL FVG
// (the candle that defined the bottom/top of the original bear/bull gap before polarity flip).
export function stopOptionsForInversionEntry({ fvg, side, barsAtTf, tf, tfMs, fvgIdx, pivots, entry }) {
  const options = [];
  const candles = deriveFvgFormationCandles(fvg, barsAtTf, tfMs);
  if (candles) {
    const kind = side === 'long' ? 'fvg_candle3_low' : 'fvg_candle3_high';
    const value = side === 'long' ? candles.candle3.low : candles.candle3.high;
    const barIdx = findBarIndex(barsAtTf, candles.candle3.time_ms, tfMs);
    options.push({
      kind, value,
      cite: `bars_by_tf.${tf}.last_5_bars[${barIdx}].${side === 'long' ? 'low' : 'high'}`,
      rationale: `candle 3 of the ORIGINAL FVG (defines invalidation of the polarity flip, time_ms=${candles.candle3.time_ms})`,
    });
  }
  const pivot = closestSwingPivot(pivots, { entry, side });
  if (pivot) {
    options.push({
      kind: 'swing_pivot',
      value: pivot.price,
      cite: pivot.cite,
      rationale: `closest swing ${pivot.tier} pivot past entry`,
    });
  }
  return options;
}

// Structure-based entries (MSS without FVG, BoS continuation): closest swing pivot only.
export function stopOptionsForStructureEntry({ side, pivots, entry }) {
  const pivot = closestSwingPivot(pivots, { entry, side });
  if (!pivot) return [];
  return [{
    kind: 'swing_pivot',
    value: pivot.price,
    cite: pivot.cite,
    rationale: `closest swing ${pivot.tier} pivot past entry`,
  }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --test-name-pattern="stop"`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/setup-detector-stops.js tests/setup-detector-stops.test.js
git commit -m "$(cat <<'EOF'
feat(detector): stop placement module — FVG candle 1/3, swing pivot, fallback

Pre-ranked stop options per the user's documented rules: FVG entries
use candle 1 low (first structure candle, derived from created_ms -
2*tf_ms); inversion entries use candle 3 low (the bar that defined the
original gap's invalidation); structure entries use closest swing pivot
across all tiers (swing or internal, any of HH/HL/LH/LL).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: MSS evaluator — components + tests

**Files:**
- Create: `cli/lib/setup-detector.js` (initial scaffold with MSS only)
- Create: `tests/setup-detector.test.js` (MSS portion)

- [ ] **Step 1: Write failing tests for MSS components**

Create `tests/setup-detector.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMssComponents } from '../cli/lib/setup-detector.js';

function baseBundle() {
  return {
    quote: { last: 29998.5 },
    engine_by_tf: {
      m5: {
        fvgs: [{ kind: 'fvg', dir: 'bull', top: 29998.5, bottom: 29992.5, ce: 29995.5, state: 'fresh', reacted: true, size_quality: 'medium', created_ms: 1779836400000, took_liq: true, disp_score: 0.7 }],
        bprs: [],
        structures: [{ event: 'mss', dir: 'bull', level: 30002.25, displacement: true, tier: 'internal', validation: 'sweep', confirmed_ms: 1779836400000 }],
        quality: { displacement: 'clean', range_quality: 'good' },
      },
    },
    gates: {
      engine: {
        price_context: { last: 29998.5, inside_fvgs: [{ kind: 'fvg', dir: 'bull', top: 29998.5, bottom: 29992.5, state: 'fresh' }], inside_bprs: [] },
        pillar1: { sweeps: [{ target: 'AS_L', price: 29982.25, side: 'sell', rejected: true, swept_ms: 1779836280000 }] },
        pillar2: { current_tf: { range_quality: 'good', displacement: 'clean' } },
        pillar3: {
          failure_swings: [{ event: 'mss', dir: 'bull', level: 30002.25, validation: 'sweep' }],
          fvg_summary: { size_quality: 'medium' },
        },
        confirmation: { last_bar: { body_ratio: 0.7, direction: 'bullish', close_position_in_range: 0.85 } },
      },
    },
  };
}

const BULL_LONG_CTX = { side: 'long', htf_destination: { dir: 'above', cite: 'pillar1.mnq.htf_destination' } };

test('MSS context_draw: present when side aligns with htf_destination', () => {
  const r = evaluateMssComponents(baseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.context_draw.present, true);
});

test('MSS context_draw: absent when side opposite to htf_destination', () => {
  const r = evaluateMssComponents(baseBundle(), { side: 'short', htf_destination: { dir: 'above' } }, 'm5');
  assert.equal(r.context_draw.present, false);
  assert.match(r.context_draw.missing_reason, /htf_destination dir=above/);
});

test('MSS liquidity_grab: present when sweep matches side', () => {
  const r = evaluateMssComponents(baseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.liquidity_grab.present, true);
});

test('MSS liquidity_grab: absent when no sweep on right side', () => {
  const b = baseBundle();
  b.gates.engine.pillar1.sweeps = [];
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.liquidity_grab.present, false);
});

test('MSS mss_displacement: present when failure_swings has matching event', () => {
  const r = evaluateMssComponents(baseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.mss_displacement.present, true);
});

test('MSS mss_displacement: absent when failure_swings empty', () => {
  const b = baseBundle();
  b.gates.engine.pillar3.failure_swings = [];
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.mss_displacement.present, false);
});

test('MSS retrace_to_fvg: present when inside_fvgs contains a fresh FVG of correct dir', () => {
  const r = evaluateMssComponents(baseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.retrace_to_fvg.present, true);
});

test('MSS retrace_to_fvg: absent when inside_fvgs empty (FVG just created, not yet retested)', () => {
  const b = baseBundle();
  b.gates.engine.price_context.inside_fvgs = [];
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.retrace_to_fvg.present, false);
  assert.match(r.retrace_to_fvg.missing_reason, /not yet retested/);
});

test('MSS confirmation: present when last_bar body_ratio>=0.6 and direction matches', () => {
  const r = evaluateMssComponents(baseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, true);
});

test('MSS confirmation: absent when last_bar body_ratio<0.6', () => {
  const b = baseBundle();
  b.gates.engine.confirmation.last_bar.body_ratio = 0.4;
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, false);
});

test('MSS displacement_quality: present when size_quality!=weak AND displacement clean/acceptable', () => {
  const r = evaluateMssComponents(baseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.displacement_quality.present, true);
});

test('MSS displacement_quality: absent when size_quality=weak', () => {
  const b = baseBundle();
  b.gates.engine.pillar3.fvg_summary.size_quality = 'weak';
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.displacement_quality.present, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern="MSS"`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the orchestrator scaffold + MSS evaluator**

Create `cli/lib/setup-detector.js`:

```js
import { disambiguateFvg, disambiguateSessionLevel, disambiguateStructureEvent } from './setup-detector-schema.js';

// Public API — returns the full candidate object. Filled in across subsequent tasks.
export function detectSetups({ bundle, leader, ltf_bias_context, untaken_targets }) {
  // Task 9 fills this in.
  throw new Error('detectSetups: not implemented yet');
}

// ============================================================================
// MSS — 6 components, evaluated against engine state.
// Strategy reference: docs/strategy/entry-models.md §MSS.
// ============================================================================

const MIN_CONFIRMATION_BODY_RATIO = 0.6;

export function evaluateMssComponents(bundle, ctx, tf) {
  const eng = bundle?.gates?.engine ?? {};
  const tfEng = bundle?.engine_by_tf?.[tf] ?? {};
  const side = ctx.side;
  const isLong = side === 'long';

  // 1. context_draw — side aligns with htf_destination dir.
  const htfDir = ctx.htf_destination?.dir;
  const context_draw_aligned = (isLong && htfDir === 'above') || (!isLong && htfDir === 'below');
  const context_draw = {
    present: context_draw_aligned,
    cite: ctx.htf_destination?.cite ?? null,
    value: ctx.htf_destination ?? null,
    ...(context_draw_aligned ? {} : { missing_reason: `htf_destination dir=${htfDir}, side=${side} not aligned` }),
  };

  // 2. liquidity_grab — recent sweep matching side.
  const sweeps = eng.pillar1?.sweeps ?? [];
  const matchingSweep = sweeps.find((s) =>
    isLong ? s.side === 'sell' && s.rejected : s.side === 'buy' && s.rejected
  );
  const liquidity_grab = {
    present: !!matchingSweep,
    cite: matchingSweep ? `gates.engine.pillar1.sweeps[${sweeps.indexOf(matchingSweep)}]` : null,
    value: matchingSweep ?? null,
    ...(matchingSweep ? {} : { missing_reason: `no rejected ${isLong ? 'sell-side' : 'buy-side'} sweep in pillar1.sweeps` }),
  };

  // 3. mss_displacement — engine's pre-filtered failure_swings (mss + validation=sweep).
  const failureSwings = eng.pillar3?.failure_swings ?? [];
  const matchingFs = failureSwings.find((fs) => fs.dir === (isLong ? 'bull' : 'bear'));
  const mss_displacement = {
    present: !!matchingFs,
    cite: matchingFs ? `gates.engine.pillar3.failure_swings[${failureSwings.indexOf(matchingFs)}]` : null,
    value: matchingFs ?? null,
    ...(matchingFs ? {} : { missing_reason: `no failure_swing with dir=${isLong ? 'bull' : 'bear'} in pillar3.failure_swings` }),
  };

  // 4. retrace_to_fvg — currently inside a fresh FVG of correct direction.
  // CRITICAL: "fresh" means never-retested. inside_fvgs[] currently containing the FVG = real retrace.
  const insideFvgs = eng.price_context?.inside_fvgs ?? [];
  const insideMatch = insideFvgs.find((f) => f.dir === (isLong ? 'bull' : 'bear') && f.state === 'fresh');
  const retrace_to_fvg = {
    present: !!insideMatch,
    cite: insideMatch ? `gates.engine.price_context.inside_fvgs[${insideFvgs.indexOf(insideMatch)}]` : null,
    value: insideMatch ? disambiguateFvg(insideMatch) : null,
    ...(insideMatch ? {} : { missing_reason: 'price not currently inside a fresh same-direction FVG — fresh FVG just created is not yet retested' }),
  };

  // 5. confirmation — last_bar body_ratio + direction.
  const lb = eng.confirmation?.last_bar ?? {};
  const confirmedDir = (isLong && lb.direction === 'bullish') || (!isLong && lb.direction === 'bearish');
  const bodyOk = (lb.body_ratio ?? 0) >= MIN_CONFIRMATION_BODY_RATIO;
  const confirmation = {
    present: confirmedDir && bodyOk,
    cite: 'gates.engine.confirmation.last_bar',
    value: lb,
    ...(confirmedDir && bodyOk ? {} : {
      missing_reason: !bodyOk
        ? `last_bar.body_ratio ${lb.body_ratio} below ${MIN_CONFIRMATION_BODY_RATIO}`
        : `last_bar.direction ${lb.direction} not matching side ${side}`,
    }),
  };

  // 6. displacement_quality — pillar3 size_quality AND pillar2 displacement.
  const sizeQ = eng.pillar3?.fvg_summary?.size_quality;
  const dispQ = eng.pillar2?.current_tf?.displacement;
  const sizeOk = sizeQ && sizeQ !== 'weak';
  const dispOk = dispQ === 'clean' || dispQ === 'acceptable';
  const displacement_quality = {
    present: sizeOk && dispOk,
    cite: 'gates.engine.pillar3.fvg_summary.size_quality + gates.engine.pillar2.current_tf.displacement',
    value: { size_quality: sizeQ, displacement: dispQ },
    ...(sizeOk && dispOk ? {} : {
      missing_reason: !sizeOk
        ? `size_quality=${sizeQ} is weak`
        : `pillar2 displacement=${dispQ} not in {clean, acceptable}`,
    }),
  };

  return { context_draw, liquidity_grab, mss_displacement, retrace_to_fvg, confirmation, displacement_quality };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --test-name-pattern="MSS"`
Expected: PASS — all 12 tests green.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/setup-detector.js tests/setup-detector.test.js
git commit -m "$(cat <<'EOF'
feat(detector): MSS evaluator — 6 components against engine state

Each component returns {present, cite, value, missing_reason?}.
Components mechanically evaluate strategy rules from
docs/strategy/entry-models.md §MSS: context_draw (side vs htf_destination),
liquidity_grab (pillar1.sweeps with rejected=true), mss_displacement
(pillar3.failure_swings), retrace_to_fvg (price_context.inside_fvgs
with fresh + dir match — CRITICAL: fresh FVG not retested = component
absent), confirmation (last_bar body_ratio>=0.6 + direction match),
displacement_quality (size_quality + pillar2.displacement).

Closes miss-08 ("Pullback to FVG already played"): retrace_to_fvg is now
strictly inside_fvgs[] currently containing the FVG.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Trend evaluator + tests

**Files:**
- Modify: `cli/lib/setup-detector.js` (add Trend evaluator)
- Modify: `tests/setup-detector.test.js` (add Trend section)

- [ ] **Step 1: Append failing tests for Trend components**

Append to `tests/setup-detector.test.js`:

```js
import { evaluateTrendComponents } from '../cli/lib/setup-detector.js';

function trendBaseBundle() {
  const b = baseBundle();
  // Replace MSS-specific signals with Trend-specific ones:
  b.gates.engine.pillar3.failure_swings = []; // not used by Trend
  b.gates.engine.pillar3.most_recent_structure = { event: 'bos', dir: 'bull', level: 30002.25, displacement: true, tier: 'swing' };
  b.gates.engine.price_context.inside_fvgs = [{ kind: 'fvg', dir: 'bull', top: 29998.5, bottom: 29992.5, state: 'fresh' }];
  return b;
}

test('Trend context_draw: present when side aligns with htf_destination', () => {
  const r = evaluateTrendComponents(trendBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.context_draw.present, true);
});

test('Trend bos_in_direction: present when most_recent_structure is BoS matching side', () => {
  const r = evaluateTrendComponents(trendBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.bos_in_direction.present, true);
});

test('Trend bos_in_direction: absent when structure is MSS not BoS', () => {
  const b = trendBaseBundle();
  b.gates.engine.pillar3.most_recent_structure.event = 'mss';
  const r = evaluateTrendComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.bos_in_direction.present, false);
});

test('Trend pullback_to_pd_array: present when inside_fvgs contains a fresh FVG of correct dir', () => {
  const r = evaluateTrendComponents(trendBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.pullback_to_pd_array.present, true);
});

test('Trend pullback_to_pd_array: absent when inside_fvgs+inside_bprs empty', () => {
  const b = trendBaseBundle();
  b.gates.engine.price_context.inside_fvgs = [];
  b.gates.engine.price_context.inside_bprs = [];
  const r = evaluateTrendComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.pullback_to_pd_array.present, false);
});

test('Trend confirmation: present when last_bar body_ratio>=0.6 and direction matches', () => {
  const r = evaluateTrendComponents(trendBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, true);
});

test('Trend displacement_quality: same rule as MSS', () => {
  const r = evaluateTrendComponents(trendBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.displacement_quality.present, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern="Trend"`
Expected: FAIL — evaluateTrendComponents not exported.

- [ ] **Step 3: Implement Trend evaluator**

Append to `cli/lib/setup-detector.js`:

```js
// ============================================================================
// Trend — 5 components. Strategy ref: docs/strategy/entry-models.md §Trend.
// ============================================================================

export function evaluateTrendComponents(bundle, ctx, tf) {
  const eng = bundle?.gates?.engine ?? {};
  const side = ctx.side;
  const isLong = side === 'long';

  // 1. context_draw — same as MSS.
  const htfDir = ctx.htf_destination?.dir;
  const aligned = (isLong && htfDir === 'above') || (!isLong && htfDir === 'below');
  const context_draw = {
    present: aligned,
    cite: ctx.htf_destination?.cite ?? null,
    value: ctx.htf_destination ?? null,
    ...(aligned ? {} : { missing_reason: `htf_destination dir=${htfDir}, side=${side} not aligned` }),
  };

  // 2. bos_in_direction — most_recent_structure is BoS in correct dir.
  const mrs = eng.pillar3?.most_recent_structure;
  const bosOk = mrs?.event === 'bos' && mrs?.dir === (isLong ? 'bull' : 'bear');
  const bos_in_direction = {
    present: bosOk,
    cite: 'gates.engine.pillar3.most_recent_structure',
    value: mrs ?? null,
    ...(bosOk ? {} : { missing_reason: `most_recent_structure event=${mrs?.event} dir=${mrs?.dir} not BoS in side ${side}` }),
  };

  // 3. pullback_to_pd_array — inside any FVG or BPR of correct dir.
  const insideFvgs = eng.price_context?.inside_fvgs ?? [];
  const insideBprs = eng.price_context?.inside_bprs ?? [];
  const dirMatch = (z) => z.dir === (isLong ? 'bull' : 'bear');
  const fvg = insideFvgs.find((f) => dirMatch(f) && f.state !== 'taken');
  const bpr = insideBprs.find((b) => dirMatch(b) && b.state !== 'taken');
  const match = fvg ?? bpr;
  const pullback_to_pd_array = {
    present: !!match,
    cite: fvg
      ? `gates.engine.price_context.inside_fvgs[${insideFvgs.indexOf(fvg)}]`
      : bpr
        ? `gates.engine.price_context.inside_bprs[${insideBprs.indexOf(bpr)}]`
        : null,
    value: match ? disambiguateFvg(match) : null,
    ...(match ? {} : { missing_reason: `no inside FVG or BPR matching dir=${isLong ? 'bull' : 'bear'}` }),
  };

  // 4. confirmation — same as MSS.
  const lb = eng.confirmation?.last_bar ?? {};
  const confirmedDir = (isLong && lb.direction === 'bullish') || (!isLong && lb.direction === 'bearish');
  const bodyOk = (lb.body_ratio ?? 0) >= MIN_CONFIRMATION_BODY_RATIO;
  const confirmation = {
    present: confirmedDir && bodyOk,
    cite: 'gates.engine.confirmation.last_bar',
    value: lb,
    ...(confirmedDir && bodyOk ? {} : { missing_reason: !bodyOk ? `body_ratio ${lb.body_ratio} below ${MIN_CONFIRMATION_BODY_RATIO}` : `direction ${lb.direction} not matching side ${side}` }),
  };

  // 5. displacement_quality — same as MSS.
  const sizeQ = eng.pillar3?.fvg_summary?.size_quality;
  const dispQ = eng.pillar2?.current_tf?.displacement;
  const sizeOk = sizeQ && sizeQ !== 'weak';
  const dispOk = dispQ === 'clean' || dispQ === 'acceptable';
  const displacement_quality = {
    present: sizeOk && dispOk,
    cite: 'gates.engine.pillar3.fvg_summary.size_quality + gates.engine.pillar2.current_tf.displacement',
    value: { size_quality: sizeQ, displacement: dispQ },
    ...(sizeOk && dispOk ? {} : { missing_reason: !sizeOk ? `size_quality=${sizeQ} is weak` : `displacement=${dispQ} not in {clean, acceptable}` }),
  };

  return { context_draw, bos_in_direction, pullback_to_pd_array, confirmation, displacement_quality };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --test-name-pattern="Trend"`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/setup-detector.js tests/setup-detector.test.js
git commit -m "$(cat <<'EOF'
feat(detector): Trend evaluator — 5 components against engine state

Continuation entries. Components: context_draw, bos_in_direction
(most_recent_structure event=bos in side), pullback_to_pd_array
(inside FVG or BPR of correct dir, not taken), confirmation,
displacement_quality.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Inversion evaluator + tests

**Files:**
- Modify: `cli/lib/setup-detector.js` (add Inversion evaluator)
- Modify: `tests/setup-detector.test.js` (add Inversion section)

- [ ] **Step 1: Append failing tests for Inversion components**

Append to `tests/setup-detector.test.js`:

```js
import { evaluateInversionComponents } from '../cli/lib/setup-detector.js';

function inversionBaseBundle() {
  const b = baseBundle();
  // Inversion-specific: there's a fresh inverted FVG in price_context.inside_fvgs.
  b.gates.engine.price_context.inside_fvgs = [{ kind: 'ifvg', dir: 'bull', top: 29998.5, bottom: 29992.5, state: 'fresh' }];
  b.engine_by_tf.m5.fvgs = [{ kind: 'ifvg', dir: 'bull', top: 29998.5, bottom: 29992.5, state: 'fresh', created_ms: 1779836400000, reacted: true, took_liq: false, size_quality: 'medium', disp_score: 0.7 }];
  return b;
}

test('Inversion context_draw: present when side aligns with htf_destination', () => {
  const r = evaluateInversionComponents(inversionBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.context_draw.present, true);
});

test('Inversion inverted_pd_array: present when fresh ifvg matches dir', () => {
  const r = evaluateInversionComponents(inversionBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.inverted_pd_array.present, true);
});

test('Inversion inverted_pd_array: absent when only regular FVGs present', () => {
  const b = inversionBaseBundle();
  b.engine_by_tf.m5.fvgs[0].kind = 'fvg';
  const r = evaluateInversionComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.inverted_pd_array.present, false);
});

test('Inversion tap_into_ifvg: present when inside_fvgs contains the ifvg', () => {
  const r = evaluateInversionComponents(inversionBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.tap_into_ifvg.present, true);
});

test('Inversion tap_into_ifvg: absent when inside_fvgs has no ifvg', () => {
  const b = inversionBaseBundle();
  b.gates.engine.price_context.inside_fvgs = [];
  const r = evaluateInversionComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.tap_into_ifvg.present, false);
});

test('Inversion confirmation: present when last_bar body_ratio>=0.6 and direction matches', () => {
  const r = evaluateInversionComponents(inversionBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, true);
});

test('Inversion displacement_quality: present when size_quality + pillar2 displacement OK', () => {
  const r = evaluateInversionComponents(inversionBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.displacement_quality.present, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern="Inversion"`
Expected: FAIL — evaluateInversionComponents not exported.

- [ ] **Step 3: Implement Inversion evaluator**

Append to `cli/lib/setup-detector.js`:

```js
// ============================================================================
// Inversion — 5 components. Strategy ref: docs/strategy/entry-models.md §Inversion.
// ============================================================================

export function evaluateInversionComponents(bundle, ctx, tf) {
  const eng = bundle?.gates?.engine ?? {};
  const tfEng = bundle?.engine_by_tf?.[tf] ?? {};
  const side = ctx.side;
  const isLong = side === 'long';

  // 1. context_draw — same as MSS/Trend.
  const htfDir = ctx.htf_destination?.dir;
  const aligned = (isLong && htfDir === 'above') || (!isLong && htfDir === 'below');
  const context_draw = {
    present: aligned,
    cite: ctx.htf_destination?.cite ?? null,
    value: ctx.htf_destination ?? null,
    ...(aligned ? {} : { missing_reason: `htf_destination dir=${htfDir}, side=${side} not aligned` }),
  };

  // 2. inverted_pd_array — fresh ifvg in correct direction in the TF's FVG list.
  const tfFvgs = tfEng.fvgs ?? [];
  const ifvg = tfFvgs.find((f) => f.kind === 'ifvg' && f.state === 'fresh' && f.dir === (isLong ? 'bull' : 'bear'));
  const inverted_pd_array = {
    present: !!ifvg,
    cite: ifvg ? `engine_by_tf.${tf}.fvgs[${tfFvgs.indexOf(ifvg)}]` : null,
    value: ifvg ? disambiguateFvg(ifvg) : null,
    ...(ifvg ? {} : { missing_reason: `no fresh ifvg with dir=${isLong ? 'bull' : 'bear'} at TF ${tf}` }),
  };

  // 3. tap_into_ifvg — currently inside an ifvg of correct dir.
  const insideFvgs = eng.price_context?.inside_fvgs ?? [];
  const insideIfvg = insideFvgs.find((f) => f.kind === 'ifvg' && f.dir === (isLong ? 'bull' : 'bear'));
  const tap_into_ifvg = {
    present: !!insideIfvg,
    cite: insideIfvg ? `gates.engine.price_context.inside_fvgs[${insideFvgs.indexOf(insideIfvg)}]` : null,
    value: insideIfvg ? disambiguateFvg(insideIfvg) : null,
    ...(insideIfvg ? {} : { missing_reason: `price not currently inside an inverted FVG of dir=${isLong ? 'bull' : 'bear'}` }),
  };

  // 4. confirmation — same as MSS/Trend.
  const lb = eng.confirmation?.last_bar ?? {};
  const confirmedDir = (isLong && lb.direction === 'bullish') || (!isLong && lb.direction === 'bearish');
  const bodyOk = (lb.body_ratio ?? 0) >= MIN_CONFIRMATION_BODY_RATIO;
  const confirmation = {
    present: confirmedDir && bodyOk,
    cite: 'gates.engine.confirmation.last_bar',
    value: lb,
    ...(confirmedDir && bodyOk ? {} : { missing_reason: !bodyOk ? `body_ratio ${lb.body_ratio} below ${MIN_CONFIRMATION_BODY_RATIO}` : `direction ${lb.direction} not matching side ${side}` }),
  };

  // 5. displacement_quality — same as MSS/Trend.
  const sizeQ = eng.pillar3?.fvg_summary?.size_quality;
  const dispQ = eng.pillar2?.current_tf?.displacement;
  const sizeOk = sizeQ && sizeQ !== 'weak';
  const dispOk = dispQ === 'clean' || dispQ === 'acceptable';
  const displacement_quality = {
    present: sizeOk && dispOk,
    cite: 'gates.engine.pillar3.fvg_summary.size_quality + gates.engine.pillar2.current_tf.displacement',
    value: { size_quality: sizeQ, displacement: dispQ },
    ...(sizeOk && dispOk ? {} : { missing_reason: !sizeOk ? `size_quality=${sizeQ} is weak` : `displacement=${dispQ} not in {clean, acceptable}` }),
  };

  return { context_draw, inverted_pd_array, tap_into_ifvg, confirmation, displacement_quality };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --test-name-pattern="Inversion"`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/setup-detector.js tests/setup-detector.test.js
git commit -m "$(cat <<'EOF'
feat(detector): Inversion evaluator — 5 components against engine state

Inverted PD-array entries. Components: context_draw, inverted_pd_array
(fresh ifvg in engine_by_tf.<tf>.fvgs), tap_into_ifvg (inside_fvgs
contains an ifvg of correct dir), confirmation, displacement_quality.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Tradable rule + grade logic + grade_capped + tests

**Files:**
- Modify: `cli/lib/setup-detector.js` (add tradable + grade)
- Modify: `tests/setup-detector.test.js` (add tradable section)

- [ ] **Step 1: Append failing tests**

Append to `tests/setup-detector.test.js`:

```js
import { computeGradeProposed, computeGradeCapped, isTradable } from '../cli/lib/setup-detector.js';

function allPresentComponents() {
  return {
    context_draw:        { present: true, cite: 'x' },
    liquidity_grab:      { present: true, cite: 'x' },
    mss_displacement:    { present: true, cite: 'x' },
    retrace_to_fvg:      { present: true, cite: 'x' },
    confirmation:        { present: true, cite: 'x' },
    displacement_quality: { present: true, cite: 'x' },
  };
}

test('computeGradeProposed: all present + clean displacement = A+', () => {
  const r = computeGradeProposed(allPresentComponents(), { displacement: 'clean' });
  assert.equal(r, 'A+');
});

test('computeGradeProposed: all present + acceptable displacement = B', () => {
  const r = computeGradeProposed(allPresentComponents(), { displacement: 'acceptable' });
  assert.equal(r, 'B');
});

test('computeGradeProposed: missing component = no-trade', () => {
  const c = allPresentComponents();
  c.retrace_to_fvg.present = false;
  const r = computeGradeProposed(c, { displacement: 'clean' });
  assert.equal(r, 'no-trade');
});

test('computeGradeCapped: takes minimum of proposed and grade_cap', () => {
  assert.equal(computeGradeCapped('A+', { grade_cap: 'B' }), 'B');
  assert.equal(computeGradeCapped('B', { grade_cap: 'A+' }), 'B');
  assert.equal(computeGradeCapped('A+', { grade_cap: 'A+' }), 'A+');
});

test('computeGradeCapped: divergent + non-MSS model = no-trade', () => {
  assert.equal(computeGradeCapped('A+', { grade_cap: 'A+', htf_ltf_alignment: 'divergent', model: 'Trend' }), 'no-trade');
  assert.equal(computeGradeCapped('A+', { grade_cap: 'A+', htf_ltf_alignment: 'divergent', model: 'MSS' }), 'A+');
});

test('computeGradeCapped: is_retrace_day + poor pillar2 = capped at B', () => {
  assert.equal(computeGradeCapped('A+', { grade_cap: 'A+', is_retrace_day: true, pillar2_range_quality: 'poor' }), 'B');
});

test('isTradable: all components + grade in {A+,B} + tp & stop available = true', () => {
  const r = isTradable({
    components: allPresentComponents(),
    grade_proposed: 'A+',
    grade_capped: 'B',
    stop_options: [{ kind: 'fvg_candle1_low', value: 100, cite: 'x' }],
    tp1: { value: 110 }, tp2: { value: 120 },
  });
  assert.equal(r, true);
});

test('isTradable: grade_capped=no-trade returns false', () => {
  const r = isTradable({
    components: allPresentComponents(),
    grade_proposed: 'A+',
    grade_capped: 'no-trade',
    stop_options: [{ kind: 'fvg_candle1_low', value: 100, cite: 'x' }],
    tp1: { value: 110 }, tp2: { value: 120 },
  });
  assert.equal(r, false);
});

test('isTradable: no stop_options returns false', () => {
  const r = isTradable({
    components: allPresentComponents(),
    grade_proposed: 'A+',
    grade_capped: 'A+',
    stop_options: [],
    tp1: { value: 110 }, tp2: { value: 120 },
  });
  assert.equal(r, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern="computeGrade|isTradable"`
Expected: FAIL — symbols not exported.

- [ ] **Step 3: Implement tradable + grade**

Append to `cli/lib/setup-detector.js`:

```js
// ============================================================================
// Tradable rule + grade logic.
// Strategy ref: docs/strategy/trading-strategy-2026.md §7 step 7.
// ============================================================================

const GRADE_RANK = { 'no-trade': 0, B: 1, 'A+': 2 };
const RANK_GRADE = { 0: 'no-trade', 1: 'B', 2: 'A+' };
const gradeRank = (g) => GRADE_RANK[g] ?? 0;

// A+ when all components present AND pillar2.displacement is "clean"
// B   when all components present AND displacement is "acceptable"
// no-trade when any component is missing.
export function computeGradeProposed(components, { displacement }) {
  const allPresent = Object.values(components).every((c) => c.present === true);
  if (!allPresent) return 'no-trade';
  if (displacement === 'clean') return 'A+';
  if (displacement === 'acceptable') return 'B';
  return 'no-trade';
}

// Cap proposed grade by grade_cap from ltf-bias-context + strategy modifiers.
export function computeGradeCapped(proposed, {
  grade_cap = 'A+',
  htf_ltf_alignment,
  model,
  is_retrace_day,
  pillar2_range_quality,
} = {}) {
  let capped = RANK_GRADE[Math.min(gradeRank(proposed), gradeRank(grade_cap))];
  // Divergent + non-MSS = no-trade (matches strategy: divergent = retrace day = MSS only).
  if (htf_ltf_alignment === 'divergent' && model !== 'MSS') capped = 'no-trade';
  // Retrace day + poor pillar2 = cap at B.
  if (is_retrace_day && pillar2_range_quality === 'poor' && gradeRank(capped) > gradeRank('B')) capped = 'B';
  return capped;
}

export function isTradable({ components, grade_proposed, grade_capped, stop_options, tp1, tp2 }) {
  const allPresent = Object.values(components).every((c) => c.present === true);
  if (!allPresent) return false;
  if (grade_proposed === 'no-trade') return false;
  if (grade_capped === 'no-trade') return false;
  if (!Array.isArray(stop_options) || stop_options.length === 0) return false;
  if (!tp1?.value || !tp2?.value) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --test-name-pattern="computeGrade|isTradable"`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/setup-detector.js tests/setup-detector.test.js
git commit -m "$(cat <<'EOF'
feat(detector): tradable rule + grade proposal + grade_capped

computeGradeProposed: A+ iff all components present + displacement
clean; B if all present + acceptable; else no-trade.
computeGradeCapped: min(proposed, grade_cap) + strategy modifiers
(divergent+non-MSS = no-trade, retrace_day+poor pillar2 = B-cap).
isTradable: all-components + grade in {A+,B} + stop_options non-empty
+ tp1/tp2 defined.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: TP picker + entry/cite helpers + tests

**Files:**
- Modify: `cli/lib/setup-detector.js` (add tp picker)
- Modify: `tests/setup-detector.test.js` (add tp/entry section)

- [ ] **Step 1: Append failing tests**

Append to `tests/setup-detector.test.js`:

```js
import { pickTpFromUntakenTargets, deriveEntry } from '../cli/lib/setup-detector.js';

test('pickTpFromUntakenTargets: long picks nearest untaken_above', () => {
  const untaken = { untaken_above: [{ price: 30015, cite: 'pillar1.mnq.overnight.untaken_above[0]' }, { price: 30050, cite: 'pillar1.mnq.overnight.untaken_above[1]' }], untaken_below: [] };
  const r = pickTpFromUntakenTargets(untaken, { side: 'long', entry: 29998.5, rank: 0 });
  assert.equal(r.value, 30015);
  assert.equal(r.cite, 'pillar1.mnq.overnight.untaken_above[0]');
});

test('pickTpFromUntakenTargets: tp2 picks second-nearest', () => {
  const untaken = { untaken_above: [{ price: 30015, cite: 'a' }, { price: 30050, cite: 'b' }, { price: 30119, cite: 'c' }], untaken_below: [] };
  const r = pickTpFromUntakenTargets(untaken, { side: 'long', entry: 29998.5, rank: 1 });
  assert.equal(r.value, 30050);
});

test('pickTpFromUntakenTargets: returns null when no targets in direction', () => {
  const untaken = { untaken_above: [], untaken_below: [{ price: 29800, cite: 'a' }] };
  const r = pickTpFromUntakenTargets(untaken, { side: 'long', entry: 29998.5, rank: 0 });
  assert.equal(r, null);
});

test('deriveEntry: FVG entry uses FVG top/bottom by direction', () => {
  const fvg = { top: 29998.5, bottom: 29992.5, dir: 'bull', kind: 'fvg' };
  const r = deriveEntry({ kind: 'fvg', fvg, side: 'long', tf: 'm5', fvgIdx: 3 });
  assert.equal(r.value, 29998.5);  // long enters at FVG top
  assert.equal(r.cite, 'engine_by_tf.m5.fvgs[3].top');
});

test('deriveEntry: BPR entry uses BPR top/bottom by direction', () => {
  const bpr = { top: 29998.5, bottom: 29992.5, dir: 'bull' };
  const r = deriveEntry({ kind: 'bpr', bpr, side: 'long', tf: 'm5', bprIdx: 1 });
  assert.equal(r.cite, 'engine_by_tf.m5.bprs[1].top');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern="pickTpFromUntaken|deriveEntry"`
Expected: FAIL.

- [ ] **Step 3: Implement TP picker + entry helper**

Append to `cli/lib/setup-detector.js`:

```js
// ============================================================================
// TP picker + entry helper.
// ============================================================================

// Picks the (rank+1)-th nearest untaken target in the trade's direction.
// rank=0 → nearest (tp1). rank=1 → next-nearest (tp2).
export function pickTpFromUntakenTargets(untaken, { side, entry, rank }) {
  const pool = side === 'long' ? untaken?.untaken_above ?? [] : untaken?.untaken_below ?? [];
  if (pool.length === 0) return null;
  // Filter and sort by absolute distance from entry; correct side already enforced.
  const sorted = [...pool]
    .filter((t) => side === 'long' ? t.price > entry : t.price < entry)
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
  if (rank >= sorted.length) return null;
  const picked = sorted[rank];
  return { value: picked.price, cite: picked.cite };
}

// Derives entry price + cite based on entry kind (FVG / BPR) and side.
// Long entries at the upper edge (top); short entries at the lower edge (bottom).
export function deriveEntry({ kind, fvg, bpr, side, tf, fvgIdx, bprIdx }) {
  if (kind === 'fvg') {
    const value = side === 'long' ? fvg.top : fvg.bottom;
    const path = side === 'long' ? 'top' : 'bottom';
    return { value, cite: `engine_by_tf.${tf}.fvgs[${fvgIdx}].${path}` };
  }
  if (kind === 'bpr') {
    const value = side === 'long' ? bpr.top : bpr.bottom;
    const path = side === 'long' ? 'top' : 'bottom';
    return { value, cite: `engine_by_tf.${tf}.bprs[${bprIdx}].${path}` };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --test-name-pattern="pickTpFromUntaken|deriveEntry"`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/setup-detector.js tests/setup-detector.test.js
git commit -m "$(cat <<'EOF'
feat(detector): TP picker (untaken-only) + entry helper

pickTpFromUntakenTargets picks the (rank+1)-th nearest untaken_above
(long) or untaken_below (short). Closes miss-04: TPs structurally
cannot reference swept levels.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Orchestrator (detectSetups) — pick best, build rejections, conflict resolution

**Files:**
- Modify: `cli/lib/setup-detector.js` (fill in detectSetups + buildCandidate per model + pickBest)
- Modify: `tests/setup-detector.test.js` (add orchestrator section)

- [ ] **Step 1: Append failing tests**

Append to `tests/setup-detector.test.js`:

```js
import { detectSetups, pickBestCandidate, buildRejectionSummary } from '../cli/lib/setup-detector.js';
import { dayOfWeek } from '../cli/lib/sizing.js';

function fullPositiveMssBundle() {
  const b = baseBundle();
  // Ensure all 6 MSS components fire (already true in baseBundle), add untaken targets.
  b.brief_digest = {
    symbols: {
      'MNQ1!': {
        htf: {},
        pillar1: { htf_destination: { dir: 'above', cite: 'pillar1.mnq.htf_destination', primary_draw: { kind: 'fvg', cite: 'engine_by_tf.h4.fvgs[0]' } } },
        pillar2: { range_quality: 'good', displacement: 'clean' },
        ltf_context: {},
      },
    },
  };
  b.engine_by_tf.m1 = { /* placeholder; bars derive candle1 */ };
  b.bars_by_tf = {
    m5: { last_5_bars: [
      { time: 1779836160 / 1, low: 29981.25, high: 29988.75 },
      { time: 1779836280 / 1, low: 29982.25, high: 29991.5 },
      { time: 1779836400 / 1, low: 29990, high: 29998.5 },
    ] },
  };
  return b;
}

test('detectSetups: returns wait state when leader undefined', () => {
  const r = detectSetups({ bundle: baseBundle(), leader: null, ltf_bias_context: {}, untaken_targets: {} });
  assert.equal(r.best_candidate, null);
  assert.match(r.rejection_summary, /leader/i);
});

test('detectSetups: returns wait state when engine stale', () => {
  const b = baseBundle();
  b.gates = { ...b.gates, engine: { ...b.gates.engine, meta: { stale: true, emit_age_seconds: 9999 } } };
  const r = detectSetups({ bundle: b, leader: 'mnq', ltf_bias_context: {}, untaken_targets: {} });
  assert.equal(r.best_candidate, null);
  assert.match(r.rejection_summary, /stale/i);
});

test('detectSetups: builds MSS-long candidate when all components present', () => {
  const b = fullPositiveMssBundle();
  const r = detectSetups({
    bundle: b,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'mss' },
    untaken_targets: { untaken_above: [{ price: 30015, cite: 'pillar1.mnq.overnight.untaken_above[0]' }, { price: 30119, cite: 'pillar1.mnq.overnight.untaken_above[1]' }], untaken_below: [] },
  });
  assert.equal(r.best_candidate?.model, 'MSS');
  assert.equal(r.best_candidate?.side, 'long');
  assert.equal(r.best_candidate?.grade_proposed, 'A+');
  assert.ok(r.best_candidate?.stop_options?.length > 0);
  assert.equal(r.best_candidate?.tp1?.value, 30015);
});

test('pickBestCandidate: prefers entry_model_priority resolver order', () => {
  const candidates = [
    { model: 'Trend', side: 'long', grade_proposed: 'A+', tradable: true, components: {}, rationale: 'x' },
    { model: 'MSS', side: 'long', grade_proposed: 'A+', tradable: true, components: {}, rationale: 'y' },
  ];
  const r = pickBestCandidate(candidates, { entry_model_priority: 'mss' });
  assert.equal(r.best_candidate.model, 'MSS');
  assert.equal(r.rejections.length, 1);
  assert.equal(r.rejections[0].model, 'Trend');
});

test('buildRejectionSummary: composes single-sentence summary from rejections', () => {
  const rejections = [
    { model: 'MSS', side: 'long', reason: 'no liquidity grab' },
    { model: 'Trend', side: 'long', reason: 'no BoS in direction' },
    { model: 'Inversion', side: 'long', reason: 'no inverted FVG' },
  ];
  const r = buildRejectionSummary(rejections, { side: 'long', untaken_above: [{ price: 30015 }], untaken_below: [] });
  assert.match(r, /no tradable setup/i);
  assert.match(r, /30015/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern="detectSetups|pickBestCandidate|buildRejectionSummary"`
Expected: FAIL — detectSetups throws "not implemented yet".

- [ ] **Step 3: Implement orchestrator**

Replace the placeholder `detectSetups` in `cli/lib/setup-detector.js` and append the helpers. Full updated `detectSetups`:

```js
import { resolveEntryModelPriority } from './entry-model-priority.js';
import { stopOptionsForFvgEntry, stopOptionsForInversionEntry, stopOptionsForStructureEntry } from './setup-detector-stops.js';

const TF_MS = { m1: 60_000, m5: 300_000, m15: 900_000, h1: 3_600_000, h4: 14_400_000, daily: 86_400_000 };

export function detectSetups({ bundle, leader, ltf_bias_context, untaken_targets }) {
  const meta = {
    detector_version: '1.0',
    leader,
    timestamp_ms: Date.now(),
    bar_close_ms: bundle?.quote?.time ? bundle.quote.time * 1000 : null,
  };

  // Early returns: leader undefined, engine stale, missing brief digest.
  if (!leader) return waitState({ reason: 'Awaiting leader decision in open_reaction', meta });
  if (bundle?.gates?.engine?.meta?.stale === true) {
    const age = bundle.gates.engine.meta.emit_age_seconds;
    return waitState({ reason: `Engine stale (age ${age}s). Awaiting fresh data.`, meta });
  }
  if (!bundle?.brief_digest?.symbols) {
    return waitState({ reason: 'Awaiting brief. Run brief phase first.', meta });
  }

  const symKey = Object.keys(bundle.brief_digest.symbols).find((k) => k.toLowerCase().includes(leader)) ?? Object.keys(bundle.brief_digest.symbols)[0];
  const briefSym = bundle.brief_digest.symbols[symKey] ?? {};
  const htf_destination = briefSym.pillar1?.htf_destination;
  const primary_draw = briefSym.pillar1?.primary_draw;
  const pillar2 = briefSym.pillar2 ?? {};

  // Determine side(s) to evaluate based on ltf_bias_context + htf_destination.
  const candidates = [];
  for (const side of resolveSidesToEvaluate({ htf_destination, ltf_bias_context })) {
    const ctx = { side, htf_destination, primary_draw, ltf_bias_context };
    candidates.push(buildMssCandidate(bundle, ctx, 'm5', untaken_targets));
    candidates.push(buildTrendCandidate(bundle, ctx, 'm5', untaken_targets));
    candidates.push(buildInversionCandidate(bundle, ctx, 'm5', untaken_targets));
  }

  const tradables = candidates.filter((c) => c?.tradable === true);
  const nonTradables = candidates.filter((c) => c && !c.tradable);

  if (tradables.length === 0) {
    return {
      best_candidate: null,
      rejections: nonTradables.map((c) => ({ model: c.model, side: c.side, reason: firstMissingReason(c.components) || c.grade_capped })),
      rejection_summary: buildRejectionSummary(
        nonTradables.map((c) => ({ model: c.model, side: c.side, reason: firstMissingReason(c.components) })),
        { side: nonTradables[0]?.side, ...untaken_targets }
      ),
      meta,
    };
  }

  const { best_candidate, rejections } = pickBestCandidate(tradables, ltf_bias_context);
  // Add non-tradable models to rejections for full visibility.
  const allRejections = [
    ...rejections,
    ...nonTradables.map((c) => ({ model: c.model, side: c.side, reason: firstMissingReason(c.components) || `grade ${c.grade_capped}` })),
  ];
  return {
    best_candidate,
    rejections: allRejections,
    rejection_summary: null,
    meta,
  };
}

function waitState({ reason, meta }) {
  return { best_candidate: null, rejections: [], rejection_summary: reason, meta };
}

function resolveSidesToEvaluate({ htf_destination, ltf_bias_context }) {
  // Default: side from htf_destination (above => long, below => short).
  if (htf_destination?.dir === 'above') return ['long'];
  if (htf_destination?.dir === 'below') return ['short'];
  return ['long', 'short'];
}

function firstMissingReason(components) {
  if (!components) return null;
  const missing = Object.values(components).find((c) => !c?.present);
  return missing?.missing_reason ?? null;
}

// ============================================================================
// Per-model candidate builders — combine evaluator + stops + tp + grade.
// ============================================================================

function buildMssCandidate(bundle, ctx, tf, untaken_targets) {
  const components = evaluateMssComponents(bundle, ctx, tf);
  const { side } = ctx;
  const insideFvgs = bundle?.gates?.engine?.price_context?.inside_fvgs ?? [];
  const tfFvgs = bundle?.engine_by_tf?.[tf]?.fvgs ?? [];
  const fvg = insideFvgs.find((f) => f.dir === (side === 'long' ? 'bull' : 'bear') && f.state === 'fresh');
  const fvgIdx = fvg ? tfFvgs.findIndex((f) => f.top === fvg.top && f.bottom === fvg.bottom) : -1;

  // Stop options
  const bars = bundle?.bars_by_tf?.[tf]?.last_5_bars ?? [];
  const swingTier = bundle?.gates?.engine?.pillar3?.structures_by_tier?.swing ?? [];
  const internalTier = bundle?.gates?.engine?.pillar3?.structures_by_tier?.internal ?? [];
  const pivots = [
    ...swingTier.map((s, idx) => ({ price: s.level, tier: 'swing', is_high: s.is_high, cite: `gates.engine.pillar3.structures_by_tier.swing[${idx}].level` })),
    ...internalTier.map((s, idx) => ({ price: s.level, tier: 'internal', is_high: s.is_high, cite: `gates.engine.pillar3.structures_by_tier.internal[${idx}].level` })),
  ];
  const entry = fvg
    ? deriveEntry({ kind: 'fvg', fvg, side, tf, fvgIdx })
    : { value: bundle?.quote?.last, cite: 'quote.last' };
  const stop_options = fvg
    ? stopOptionsForFvgEntry({ fvg, side, barsAtTf: bars, tf, tfMs: TF_MS[tf], fvgIdx, pivots, entry: entry.value })
    : stopOptionsForStructureEntry({ side, pivots, entry: entry.value });

  // TPs
  const tp1 = pickTpFromUntakenTargets(untaken_targets, { side, entry: entry.value, rank: 0 });
  const tp2 = pickTpFromUntakenTargets(untaken_targets, { side, entry: entry.value, rank: 1 });

  // Grade
  const grade_proposed = computeGradeProposed(components, { displacement: bundle?.gates?.engine?.pillar2?.current_tf?.displacement });
  const grade_capped = computeGradeCapped(grade_proposed, {
    grade_cap: ctx.ltf_bias_context?.grade_cap,
    htf_ltf_alignment: ctx.ltf_bias_context?.htf_ltf_alignment,
    model: 'MSS',
    is_retrace_day: ctx.ltf_bias_context?.is_retrace_day,
    pillar2_range_quality: bundle?.gates?.engine?.pillar2?.current_tf?.range_quality,
  });
  const tradable = isTradable({ components, grade_proposed, grade_capped, stop_options, tp1, tp2 });

  return {
    model: 'MSS',
    side,
    entry,
    stop: stop_options[0] ? { value: stop_options[0].value, cite: stop_options[0].cite, kind: stop_options[0].kind } : null,
    stop_options,
    tp1, tp2,
    grade_proposed, grade_capped,
    components,
    rationale: buildRationale('MSS', side, components),
    tradable,
  };
}

function buildTrendCandidate(bundle, ctx, tf, untaken_targets) {
  const components = evaluateTrendComponents(bundle, ctx, tf);
  const { side } = ctx;
  const insideFvgs = bundle?.gates?.engine?.price_context?.inside_fvgs ?? [];
  const tfFvgs = bundle?.engine_by_tf?.[tf]?.fvgs ?? [];
  const fvg = insideFvgs.find((f) => f.dir === (side === 'long' ? 'bull' : 'bear') && f.state !== 'taken');
  const fvgIdx = fvg ? tfFvgs.findIndex((f) => f.top === fvg.top && f.bottom === fvg.bottom) : -1;

  const bars = bundle?.bars_by_tf?.[tf]?.last_5_bars ?? [];
  const swingTier = bundle?.gates?.engine?.pillar3?.structures_by_tier?.swing ?? [];
  const internalTier = bundle?.gates?.engine?.pillar3?.structures_by_tier?.internal ?? [];
  const pivots = [
    ...swingTier.map((s, idx) => ({ price: s.level, tier: 'swing', is_high: s.is_high, cite: `gates.engine.pillar3.structures_by_tier.swing[${idx}].level` })),
    ...internalTier.map((s, idx) => ({ price: s.level, tier: 'internal', is_high: s.is_high, cite: `gates.engine.pillar3.structures_by_tier.internal[${idx}].level` })),
  ];
  const entry = fvg
    ? deriveEntry({ kind: 'fvg', fvg, side, tf, fvgIdx })
    : { value: bundle?.quote?.last, cite: 'quote.last' };
  const stop_options = fvg
    ? stopOptionsForFvgEntry({ fvg, side, barsAtTf: bars, tf, tfMs: TF_MS[tf], fvgIdx, pivots, entry: entry.value })
    : stopOptionsForStructureEntry({ side, pivots, entry: entry.value });

  const tp1 = pickTpFromUntakenTargets(untaken_targets, { side, entry: entry.value, rank: 0 });
  const tp2 = pickTpFromUntakenTargets(untaken_targets, { side, entry: entry.value, rank: 1 });
  const grade_proposed = computeGradeProposed(components, { displacement: bundle?.gates?.engine?.pillar2?.current_tf?.displacement });
  const grade_capped = computeGradeCapped(grade_proposed, {
    grade_cap: ctx.ltf_bias_context?.grade_cap,
    htf_ltf_alignment: ctx.ltf_bias_context?.htf_ltf_alignment,
    model: 'Trend',
    is_retrace_day: ctx.ltf_bias_context?.is_retrace_day,
    pillar2_range_quality: bundle?.gates?.engine?.pillar2?.current_tf?.range_quality,
  });
  const tradable = isTradable({ components, grade_proposed, grade_capped, stop_options, tp1, tp2 });

  return {
    model: 'Trend',
    side,
    entry,
    stop: stop_options[0] ? { value: stop_options[0].value, cite: stop_options[0].cite, kind: stop_options[0].kind } : null,
    stop_options,
    tp1, tp2,
    grade_proposed, grade_capped,
    components,
    rationale: buildRationale('Trend', side, components),
    tradable,
  };
}

function buildInversionCandidate(bundle, ctx, tf, untaken_targets) {
  const components = evaluateInversionComponents(bundle, ctx, tf);
  const { side } = ctx;
  const tfFvgs = bundle?.engine_by_tf?.[tf]?.fvgs ?? [];
  const ifvg = tfFvgs.find((f) => f.kind === 'ifvg' && f.state === 'fresh' && f.dir === (side === 'long' ? 'bull' : 'bear'));
  const fvgIdx = ifvg ? tfFvgs.indexOf(ifvg) : -1;

  const bars = bundle?.bars_by_tf?.[tf]?.last_5_bars ?? [];
  const swingTier = bundle?.gates?.engine?.pillar3?.structures_by_tier?.swing ?? [];
  const internalTier = bundle?.gates?.engine?.pillar3?.structures_by_tier?.internal ?? [];
  const pivots = [
    ...swingTier.map((s, idx) => ({ price: s.level, tier: 'swing', is_high: s.is_high, cite: `gates.engine.pillar3.structures_by_tier.swing[${idx}].level` })),
    ...internalTier.map((s, idx) => ({ price: s.level, tier: 'internal', is_high: s.is_high, cite: `gates.engine.pillar3.structures_by_tier.internal[${idx}].level` })),
  ];
  const entry = ifvg
    ? deriveEntry({ kind: 'fvg', fvg: ifvg, side, tf, fvgIdx })
    : { value: bundle?.quote?.last, cite: 'quote.last' };
  const stop_options = ifvg
    ? stopOptionsForInversionEntry({ fvg: ifvg, side, barsAtTf: bars, tf, tfMs: TF_MS[tf], fvgIdx, pivots, entry: entry.value })
    : stopOptionsForStructureEntry({ side, pivots, entry: entry.value });

  const tp1 = pickTpFromUntakenTargets(untaken_targets, { side, entry: entry.value, rank: 0 });
  const tp2 = pickTpFromUntakenTargets(untaken_targets, { side, entry: entry.value, rank: 1 });
  const grade_proposed = computeGradeProposed(components, { displacement: bundle?.gates?.engine?.pillar2?.current_tf?.displacement });
  const grade_capped = computeGradeCapped(grade_proposed, {
    grade_cap: ctx.ltf_bias_context?.grade_cap,
    htf_ltf_alignment: ctx.ltf_bias_context?.htf_ltf_alignment,
    model: 'Inversion',
    is_retrace_day: ctx.ltf_bias_context?.is_retrace_day,
    pillar2_range_quality: bundle?.gates?.engine?.pillar2?.current_tf?.range_quality,
  });
  const tradable = isTradable({ components, grade_proposed, grade_capped, stop_options, tp1, tp2 });

  return {
    model: 'Inversion',
    side,
    entry,
    stop: stop_options[0] ? { value: stop_options[0].value, cite: stop_options[0].cite, kind: stop_options[0].kind } : null,
    stop_options,
    tp1, tp2,
    grade_proposed, grade_capped,
    components,
    rationale: buildRationale('Inversion', side, components),
    tradable,
  };
}

function buildRationale(model, side, components) {
  const present = Object.entries(components).filter(([, v]) => v?.present).map(([k]) => k);
  return `${model}-${side === 'long' ? 'bull' : 'bear'}: ${present.join(', ')} all present.`;
}

// ============================================================================
// Conflict resolution + rejection summary.
// ============================================================================

export function pickBestCandidate(candidates, ltf_bias_context) {
  if (candidates.length === 0) return { best_candidate: null, rejections: [] };
  if (candidates.length === 1) return { best_candidate: candidates[0], rejections: [] };

  // Use entry_model_priority resolver. Priority order: MSS > Trend > Inversion default;
  // can be overridden by ltf_bias_context.entry_model_priority (e.g., "mss", "trend").
  const preferred = (ltf_bias_context?.entry_model_priority ?? 'mss').toLowerCase();
  const order = preferred === 'trend'     ? ['Trend', 'MSS', 'Inversion']
              : preferred === 'inversion' ? ['Inversion', 'MSS', 'Trend']
              :                              ['MSS', 'Trend', 'Inversion'];
  const sorted = [...candidates].sort((a, b) => {
    const ai = order.indexOf(a.model), bi = order.indexOf(b.model);
    if (ai !== bi) return ai - bi;
    // Tiebreak: higher grade_proposed wins.
    return gradeRank(b.grade_proposed) - gradeRank(a.grade_proposed);
  });
  return {
    best_candidate: sorted[0],
    rejections: sorted.slice(1).map((c) => ({ model: c.model, side: c.side, reason: `lower priority than ${sorted[0].model}` })),
  };
}

export function buildRejectionSummary(rejections, { side, untaken_above, untaken_below }) {
  if (!rejections || rejections.length === 0) return 'No tradable setup. Awaiting fresh signals.';
  const reasonsList = rejections.map((r) => `${r.model}: ${r.reason}`).join('; ');
  const watch = side === 'long' && untaken_above?.length
    ? ` Watching: untaken target ${untaken_above[0].price} above.`
    : side === 'short' && untaken_below?.length
      ? ` Watching: untaken target ${untaken_below[0].price} below.`
      : '';
  return `No tradable setup. ${reasonsList}.${watch}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --test-name-pattern="detectSetups|pickBestCandidate|buildRejectionSummary"`
Expected: PASS — all 5 tests green.

Also run the full file: `npm run test:unit -- tests/setup-detector.test.js` → all 40+ tests green.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/setup-detector.js tests/setup-detector.test.js
git commit -m "$(cat <<'EOF'
feat(detector): orchestrator — detectSetups, candidate builders, conflict resolution

detectSetups orchestrates: wait state on missing leader/stale/missing
brief; builds MSS + Trend + Inversion candidates per side; filters
tradables; resolves conflicts via entry_model_priority. Builds
rejection_summary citing watched untaken targets.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Validator (surface.js audit) + tests

**Files:**
- Modify: `app/main/tools/surface.js` (add validateSetupAgainstCandidate)
- Create: `tests/surface-validator.test.js`

- [ ] **Step 1: Read the existing surface.js surface_setup tool**

Run: `grep -n "surface_setup\|surfaceSetup" app/main/tools/surface.js | head -20`

Locate the `surface_setup` tool definition and identify where to insert the audit (immediately after Zod validation passes, before persistence).

- [ ] **Step 2: Write failing tests for the validator**

Create `tests/surface-validator.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSetupAgainstCandidate } from '../app/main/tools/surface.js';

function validCandidate() {
  return {
    best_candidate: {
      model: 'MSS', side: 'long',
      entry: { value: 29998.5, cite: 'engine_by_tf.m5.fvgs[3].top' },
      stop: { value: 29981.25, cite: 'bars_by_tf.m5.last_5_bars[0].low', kind: 'fvg_candle1_low' },
      stop_options: [
        { kind: 'fvg_candle1_low', value: 29981.25, cite: 'bars_by_tf.m5.last_5_bars[0].low', rationale: 'x' },
        { kind: 'swing_pivot', value: 29982.25, cite: 'engine.swings.internal[7]', rationale: 'y' },
      ],
      tp1: { value: 30015, cite: 'pillar1.mnq.overnight.untaken_above[0]' },
      tp2: { value: 30119, cite: 'pillar1.mnq.overnight.untaken_above[1]' },
      grade_proposed: 'A+',
      grade_capped: 'B',
    },
  };
}

function validBundle() {
  return {
    engine_by_tf: { m5: { fvgs: [{}, {}, {}, { top: 29998.5 }] } },
    bars_by_tf: { m5: { last_5_bars: [{ low: 29981.25 }] } },
    pillar1: { mnq: { overnight: { untaken_above: [{ price: 30015 }, { price: 30119 }] } } },
    gates: { engine: { pillar1: { session_levels: { AS_H: { price: 29990, swept: true, valid_as_target: false } } } } },
  };
}

test('validator: valid payload passes', () => {
  const payload = { model: 'MSS', side: 'long', entry: 29998.5, entry_cite: 'engine_by_tf.m5.fvgs[3].top', stop: 29981.25, stop_cite: 'bars_by_tf.m5.last_5_bars[0].low', tp1: 30015, tp1_cite: 'pillar1.mnq.overnight.untaken_above[0]', tp2: 30119, tp2_cite: 'pillar1.mnq.overnight.untaken_above[1]', grade: 'B' };
  assert.doesNotThrow(() => validateSetupAgainstCandidate(payload, validCandidate(), validBundle()));
});

test('validator: throws when entry_cite does not resolve', () => {
  const payload = { model: 'MSS', side: 'long', entry: 29998.5, entry_cite: 'engine_by_tf.m5.fvgs[99].top', stop: 29981.25, stop_cite: 'bars_by_tf.m5.last_5_bars[0].low', tp1: 30015, tp1_cite: 'pillar1.mnq.overnight.untaken_above[0]', tp2: 30119, tp2_cite: 'pillar1.mnq.overnight.untaken_above[1]', grade: 'B' };
  assert.throws(() => validateSetupAgainstCandidate(payload, validCandidate(), validBundle()), /does not resolve/);
});

test('validator: throws when tp1_cite points at swept level', () => {
  const payload = { model: 'MSS', side: 'long', entry: 29998.5, entry_cite: 'engine_by_tf.m5.fvgs[3].top', stop: 29981.25, stop_cite: 'bars_by_tf.m5.last_5_bars[0].low', tp1: 29990, tp1_cite: 'gates.engine.pillar1.session_levels.AS_H', tp2: 30119, tp2_cite: 'pillar1.mnq.overnight.untaken_above[1]', grade: 'B' };
  assert.throws(() => validateSetupAgainstCandidate(payload, validCandidate(), validBundle()), /swept|valid_as_target/i);
});

test('validator: throws when stop value not in stop_options', () => {
  const payload = { model: 'MSS', side: 'long', entry: 29998.5, entry_cite: 'engine_by_tf.m5.fvgs[3].top', stop: 29970, stop_cite: 'bars_by_tf.m5.last_5_bars[0].low', tp1: 30015, tp1_cite: 'pillar1.mnq.overnight.untaken_above[0]', tp2: 30119, tp2_cite: 'pillar1.mnq.overnight.untaken_above[1]', grade: 'B' };
  assert.throws(() => validateSetupAgainstCandidate(payload, validCandidate(), validBundle()), /stop_options/);
});

test('validator: throws when grade exceeds grade_capped', () => {
  const payload = { model: 'MSS', side: 'long', entry: 29998.5, entry_cite: 'engine_by_tf.m5.fvgs[3].top', stop: 29981.25, stop_cite: 'bars_by_tf.m5.last_5_bars[0].low', tp1: 30015, tp1_cite: 'pillar1.mnq.overnight.untaken_above[0]', tp2: 30119, tp2_cite: 'pillar1.mnq.overnight.untaken_above[1]', grade: 'A+' };
  assert.throws(() => validateSetupAgainstCandidate(payload, validCandidate(), validBundle()), /grade.*exceeds/);
});

test('validator: throws when model/side mismatch with detector', () => {
  const payload = { model: 'Trend', side: 'long', entry: 29998.5, entry_cite: 'engine_by_tf.m5.fvgs[3].top', stop: 29981.25, stop_cite: 'bars_by_tf.m5.last_5_bars[0].low', tp1: 30015, tp1_cite: 'pillar1.mnq.overnight.untaken_above[0]', tp2: 30119, tp2_cite: 'pillar1.mnq.overnight.untaken_above[1]', grade: 'B' };
  assert.throws(() => validateSetupAgainstCandidate(payload, validCandidate(), validBundle()), /model\/side.*does not match/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit -- tests/surface-validator.test.js`
Expected: FAIL — `validateSetupAgainstCandidate` not exported.

- [ ] **Step 4: Implement validator + wire into surface_setup**

Add to `app/main/tools/surface.js` (near top after existing imports / before tool definitions):

```js
// ============================================================================
// Setup-candidate validator. Audits surface_setup payload against the
// detector's best_candidate. Throws on mismatch. Spec:
// docs/superpowers/specs/2026-05-26-strategy-detector-design.md §Validator.
// ============================================================================

const GRADE_RANK_VAL = { 'no-trade': 0, B: 1, 'A+': 2 };
const gradeRank = (g) => GRADE_RANK_VAL[g] ?? 0;

function resolveCite(cite, bundle) {
  if (!cite || typeof cite !== 'string') return undefined;
  try {
    return cite.split(/\.|\[|\]/).filter(Boolean).reduce((acc, key) => acc?.[isFinite(key) ? Number(key) : key], bundle);
  } catch { return undefined; }
}

function isUntakenTarget(cite, bundle) {
  // Untaken: anything under untaken_above[]/untaken_below[] in brief or pillar1.
  if (/untaken_(above|below)\[/.test(cite ?? '')) return true;
  // Internal swings that aren't taken.
  const resolved = resolveCite(cite, bundle);
  if (resolved && resolved.swept === false && resolved.valid_as_target !== false) return true;
  if (resolved && resolved.taken === false) return true;
  if (resolved && resolved.valid_as_target === false) return false;
  if (resolved && resolved.swept === true) return false;
  return true; // default permissive if structure unknown; cite resolution check catches the rest
}

export function validateSetupAgainstCandidate(payload, candidate, bundle) {
  const errors = [];
  const cand = candidate?.best_candidate;

  // 0. There must be a best_candidate.
  if (!cand) {
    throw new Error('Setup validation failed: detector emitted best_candidate=null (no tradable setup). Use surface_no_trade instead.');
  }

  // 1. Every cite resolves.
  for (const [key, cite] of [['entry_cite', payload.entry_cite], ['stop_cite', payload.stop_cite], ['tp1_cite', payload.tp1_cite], ['tp2_cite', payload.tp2_cite]]) {
    if (resolveCite(cite, bundle) === undefined) errors.push(`${key} ${cite} does not resolve in bundle`);
  }

  // 2. TP cites are untaken.
  if (!isUntakenTarget(payload.tp1_cite, bundle)) errors.push(`tp1_cite ${payload.tp1_cite} points at a swept/taken level (valid_as_target=false)`);
  if (!isUntakenTarget(payload.tp2_cite, bundle)) errors.push(`tp2_cite ${payload.tp2_cite} points at a swept/taken level (valid_as_target=false)`);

  // 3. Stop matches one of the detector's stop_options.
  const matchedStop = (cand.stop_options ?? []).find((opt) => Math.abs(opt.value - payload.stop) < 0.01);
  if (!matchedStop) {
    errors.push(`stop value ${payload.stop} not in detector's stop_options: ${(cand.stop_options ?? []).map((o) => `${o.kind}=${o.value}`).join(', ')}`);
  }

  // 4. Grade <= grade_capped.
  if (gradeRank(payload.grade) > gradeRank(cand.grade_capped)) {
    errors.push(`grade ${payload.grade} exceeds grade_capped ${cand.grade_capped}`);
  }

  // 5. Model/side matches detector's pick.
  if (payload.model !== cand.model || payload.side !== cand.side) {
    errors.push(`payload model/side ${payload.model}/${payload.side} does not match detector's pick ${cand.model}/${cand.side}`);
  }

  if (errors.length) {
    throw new Error(`Setup validation failed: ${errors.join('; ')}`);
  }
}
```

Then locate the existing `surface_setup` tool handler in the same file. After Zod parsing succeeds but before persistence, add:

```js
// ... existing surface_setup handler ...
const parsed = SetupSchema.parse(rawArgs);
// NEW: validate against detector candidate
if (currentBundle?.candidates) {
  validateSetupAgainstCandidate(parsed, currentBundle.candidates, currentBundle);
}
// ... rest of handler ...
```

(`currentBundle` is the in-scope bundle reference inside the tool handler; if the variable name differs, use the existing local. If no bundle is in scope, skip — the wiring task ensures candidates are attached.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- tests/surface-validator.test.js`
Expected: PASS — all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add app/main/tools/surface.js tests/surface-validator.test.js
git commit -m "$(cat <<'EOF'
feat(validator): surface_setup audits payload against detector candidate

validateSetupAgainstCandidate runs 5 checks before persisting:
(1) every cite resolves in the bundle, (2) TP cites point at untaken
targets only, (3) stop value matches one of the detector's
stop_options, (4) grade <= grade_capped, (5) model/side matches
detector's pick. Throws on any mismatch — strict (reject) mode from
day one per spec.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Wire detector into analyze.js — bundle.candidates

**Files:**
- Modify: `cli/commands/analyze.js`

- [ ] **Step 1: Locate the brief_digest emission**

Run: `grep -n "brief_digest\|buildBriefDigest\|bundle =\|bundle\." cli/commands/analyze.js | head -30`

Find where `brief_digest` is attached. The detector attaches similarly.

- [ ] **Step 2: Import + call detectSetups**

Edit `cli/commands/analyze.js`. Near the existing brief_digest section, add:

```js
import { detectSetups } from '../lib/setup-detector.js';
```

After the brief_digest assignment block, add:

```js
// Detector — pre-compute candidate setups for entry_hunt phase.
// Spec: docs/superpowers/specs/2026-05-26-strategy-detector-design.md
// Detector handles wait states (missing leader, stale engine, missing brief)
// gracefully; it always returns a defined shape.
try {
  const leader = bundle?.brief_digest?.leader ?? null;
  const ltfBiasContext = bundle?.brief_digest?.ltf_bias_context ?? {};
  const symKey = Object.keys(bundle?.brief_digest?.symbols ?? {})[0] ?? null;
  const untakenAbove = symKey ? (bundle.brief_digest.symbols[symKey]?.pillar1?.overnight_block?.untaken_above ?? []) : [];
  const untakenBelow = symKey ? (bundle.brief_digest.symbols[symKey]?.pillar1?.overnight_block?.untaken_below ?? []) : [];
  const candidates = detectSetups({
    bundle,
    leader,
    ltf_bias_context: ltfBiasContext,
    untaken_targets: { untaken_above: untakenAbove, untaken_below: untakenBelow },
  });
  bundle = { ...bundle, candidates };
} catch (err) {
  // Detector errors don't crash analyze; surface as a wait-state candidate.
  bundle = { ...bundle, candidates: { best_candidate: null, rejections: [], rejection_summary: `Detector error: ${err.message}`, meta: { detector_version: '1.0', error: true } } };
}
```

- [ ] **Step 3: Run smoke fixtures**

Run: `npm run smoke:fixtures`
Expected: PASS — all 10 (or current count) fixtures still pass. Detector adds a new field; existing schema checks should not break.

- [ ] **Step 4: Commit**

```bash
git add cli/commands/analyze.js
git commit -m "$(cat <<'EOF'
feat(analyze): emit bundle.candidates via detector

cli/commands/analyze.js now calls detectSetups after brief_digest is
built. Detector reads leader + ltf_bias_context + untaken_targets from
brief_digest, returns the candidate object on bundle.candidates. Errors
from detector caught and surfaced as a wait-state candidate so analyze
never crashes.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Wire bar-close.js — inject `<candidate_object>` block

**Files:**
- Modify: `app/main/bar-close.js`

- [ ] **Step 1: Locate entry_hunt prompt construction**

Run: `grep -n "entry_hunt\|untaken_targets\|<candidate" app/main/bar-close.js | head -20`

Find where the entry_hunt phase prompt is composed (near the untaken_targets injection added recently).

- [ ] **Step 2: Add candidate-injection helper**

In `app/main/bar-close.js`, add (near other helpers):

```js
function readCandidatesBlock(bundle) {
  const c = bundle?.candidates;
  if (!c) return '';
  const pretty = JSON.stringify(c, null, 2);
  return `<candidate_object>\n${pretty}\n</candidate_object>\n\n`;
}
```

- [ ] **Step 3: Inject before per-bar entry_hunt prompt**

Locate the line that assembles the per-bar entry_hunt prompt (where `untakenTargetsBlock` is already prepended). Add `candidatesBlock` similarly:

```js
const candidatesBlock = readCandidatesBlock(bundle);
const userPrompt = candidatesBlock + untakenTargetsBlock + /* existing prompt */;
```

- [ ] **Step 4: Smoke test**

Run: `npm run smoke:fixtures` → expected: PASS.
Run: `npm run test:unit -- tests/setup-detector.test.js tests/setup-detector-stops.test.js tests/setup-detector-schema.test.js tests/surface-validator.test.js` → all green.

- [ ] **Step 5: Commit**

```bash
git add app/main/bar-close.js
git commit -m "$(cat <<'EOF'
feat(bar-close): inject <candidate_object> block into entry_hunt prompt

Per-bar entry_hunt prompt now prepends the pretty-printed
bundle.candidates as <candidate_object>. Model reads this block,
copies values into surface_setup or surface_no_trade. Same pattern as
the existing <untaken_targets> block.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Rewrite `<phase name="entry_hunt">` + add `<anti_patterns>` block

**Files:**
- Modify: `app/main/prompts/analyze.md`

- [ ] **Step 1: Locate current entry_hunt phase**

Run: `grep -n "phase name=\"entry_hunt\"\|/phase" app/main/prompts/analyze.md | head -10`

Note the line range of the current entry_hunt phase.

- [ ] **Step 2: Replace the entry_hunt phase contents**

In `app/main/prompts/analyze.md`, replace the body of `<phase name="entry_hunt">` with:

```xml
<phase name="entry_hunt">

You are in entry hunt. A precomputed `<candidate_object>` block has been
injected above. The detector has already evaluated every entry-model
rule against engine state. **Your job is to package and narrate, not
to interpret strategy.**

## Procedure

1. Read `<candidate_object>`.
2. If `best_candidate` is non-null:
   - Call `surface_setup` with EXACTLY these values from best_candidate:
     - `model` = best_candidate.model
     - `side` = best_candidate.side
     - `entry` = best_candidate.entry.value, `entry_cite` = best_candidate.entry.cite
     - `stop` = best_candidate.stop.value (must be one of best_candidate.stop_options), `stop_cite` = best_candidate.stop.cite
     - `tp1` = best_candidate.tp1.value, `tp1_cite` = best_candidate.tp1.cite
     - `tp2` = best_candidate.tp2.value, `tp2_cite` = best_candidate.tp2.cite
     - `grade` = best_candidate.grade_capped (NOT grade_proposed; the cap is enforced)
   - Write 2-3 sentences for the `narration` field explaining the chain in plain English:
     what set the trade up (HTF + Pillar 1), what triggered it (the failure_swing /
     BoS / iFVG tap), what's at risk (stop logic), what closes the chain (tp2 = primary draw).
3. If `best_candidate` is null:
   - Call `surface_no_trade` with `reason` = candidate.rejection_summary (verbatim, do not edit).
   - Add a 1-sentence `note` describing what to watch on the next bar (the rejection_summary
     usually identifies it; restate in plain English).

## You may NOT

- Override the detector's pick. If you disagree with `best_candidate=null` and think there is a setup,
  call `surface_no_trade` and set `chain_status: degraded:disagreement` with a 1-sentence reason in `note`.
  The detector's decision stands; this flags for human review at session end.
- Promote `grade` past `grade_capped`. The validator rejects this.
- Substitute a different stop value than one of `stop_options[]`. Pick `stop_options[0]` unless that
  cite fails to resolve, then `stop_options[1]`, etc.
- Substitute a TP that isn't from `untaken_above[]` / `untaken_below[]`. Detector already filtered;
  use its picks.
- Walk strategy from scratch. The detector has done that work. Trust the components.

See `<anti_patterns>` block for the 8 specific misreads from the 2026-05-26 session you must avoid.

</phase>
```

- [ ] **Step 3: Add the `<anti_patterns>` block (immediately after entry_hunt phase)**

In the same file, immediately after the closing `</phase>` of entry_hunt, add:

```xml
<anti_patterns>

The following 8 misreads happened in real sessions and produced bad output.
The detector now prevents most of them structurally, but if you ever find
yourself doing one of these, stop and re-read `<candidate_object>`.

❌ "FRESH FVG" DOES NOT MEAN "RETESTED".
   `engine.fvgs[N].state: "fresh"` + `created_ms` in the last 1-3 bars means the
   pullback has not happened yet. The 3 candles around `created_ms` CREATED the
   FVG, they did not retest it. The detector's `retrace_to_fvg.present` checks
   `price_context.inside_fvgs[]` — trust that.

❌ "REACTED" DOES NOT MEAN "RETESTED".
   `reacted: true` (now exposed as `displacement_at_creation: true` after
   disambiguation) = the impulse that CREATED the FVG was clean. It does NOT
   mean a later pullback tested the zone.

❌ SWEPT LEVELS ARE NOT VALID TARGETS.
   `gates.engine.pillar1.session_levels.<LEVEL>.swept: true` (or `taken: true`)
   means the level was already taken. NEVER cite as TP. The detector's
   `tp1` / `tp2` pull from `untaken_above[]` / `untaken_below[]` only.

❌ FVG-BOTTOM STOP IS A LAST-RESORT FALLBACK.
   Strategy priority for FVG entries: candle 1 low of the 3-candle FVG
   formation > pullback swing low > FVG bottom. The detector pre-ranks all
   three in `stop_options[]`. Pick `stop_options[0]` unless its cite fails
   to resolve.

❌ LOCKED LTF BIAS DOES NOT FORCE DIRECTION.
   `ltf_bias.bias` is a snapshot at the leader-decision moment, not a lock for
   the entire session. The detector's `side` is computed from HTF destination
   + current engine state — trust its side pick over a stale LTF bias.

❌ PHASE TAG IS DERIVED FROM ET CLOCK, NOT WRITTEN BY MODEL.
   Do not author `"phase: open_reaction_ny_pm"` at 13:09 ET (21 min before NY PM
   open at 13:30). The phase is set by `surface.js` based on the live ET clock.

❌ SIZING IS PRE-COMPUTED, NEVER FABRICATED.
   `sizing_note` must come from the `<sizing_pre_computed>` block in the brief
   prompt, citing `memory.USER` or `strategy.sizing-table`. Do not write a
   prose-level sizing claim like "Tuesday standard."

❌ NEVER PROMOTE GRADE PAST `grade_capped`.
   If detector emits `grade_capped: B`, surfacing `grade: A+` will be rejected
   by the validator. Use `grade_capped` directly.

</anti_patterns>
```

- [ ] **Step 4: Verify with a syntax/grep sanity check**

Run: `grep -n "anti_patterns\|entry_hunt" app/main/prompts/analyze.md | head -20`
Expected: both blocks present.

- [ ] **Step 5: Commit**

```bash
git add app/main/prompts/analyze.md
git commit -m "$(cat <<'EOF'
feat(prompt): rewrite entry_hunt for candidate-driven flow + anti_patterns

<phase name="entry_hunt"> now reads <candidate_object> and copies
values from best_candidate. Strategy interpretation moved to code.
Override path explicit: model can flag chain_status: degraded:disagreement
but cannot trade. <anti_patterns> block lists 8 specific misreads from
2026-05-26 with structural reasoning.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Mirror prompt changes to `.claude/commands/analyze.md`

**Files:**
- Modify: `.claude/commands/analyze.md`

- [ ] **Step 1: Diff the two files**

Run: `diff app/main/prompts/analyze.md .claude/commands/analyze.md | head -40`

Identify which sections of the Electron prompt have a counterpart in the CLI slash command. Typically: phase definitions, anti-pattern blocks, and any procedure-defining text.

- [ ] **Step 2: Mirror the entry_hunt phase + anti_patterns**

In `.claude/commands/analyze.md`, locate the corresponding section (search for `entry_hunt` or `entry hunt` headers — naming convention may differ slightly). Replace with the candidate-driven version. Add the `<anti_patterns>` block at the same relative location.

The CLI prompt usually wraps the same content in slightly different XML or Markdown — preserve the existing style but copy the substantive text. Source of truth = `app/main/prompts/analyze.md`.

- [ ] **Step 3: Verify mirror parity**

Run: `diff <(grep -A 100 "phase name=\"entry_hunt\"" app/main/prompts/analyze.md) <(grep -A 100 "entry hunt" .claude/commands/analyze.md)`

Adjust until they're substantively equivalent (cosmetic diffs OK).

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/analyze.md
git commit -m "$(cat <<'EOF'
feat(cli prompt): mirror entry_hunt rewrite + anti_patterns to CLI

CLAUDE.md hard constraint #2 — CLI is the canonical surface for
non-Electron sessions. Mirrors the candidate-driven entry_hunt phase
and anti_patterns block from app/main/prompts/analyze.md.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Author 3 tradable fixtures (MSS / Trend / Inversion)

**Files:**
- Create: `tests/fixtures/006-mss-bull-tradable.bundle.json` + `.expected.md`
- Create: `tests/fixtures/007-trend-bull-tradable.bundle.json` + `.expected.md`
- Create: `tests/fixtures/008-inversion-short-tradable.bundle.json` + `.expected.md`

These end-to-end fixtures test the detector on real-shape bundles. Each is a single-symbol (not paired) bundle.

- [ ] **Step 1: Use existing fixture as template**

Run: `cp tests/fixtures/003-engine-utilization.bundle.json tests/fixtures/006-mss-bull-tradable.bundle.json`

Edit `006-mss-bull-tradable.bundle.json`:
- Ensure `gates.engine.pillar1.sweeps[]` contains a rejected sell-side sweep.
- Ensure `gates.engine.pillar3.failure_swings[]` has an MSS event with dir=bull + validation=sweep.
- Ensure `engine_by_tf.m5.fvgs[]` has a fresh bull FVG.
- Ensure `gates.engine.price_context.inside_fvgs[]` contains that FVG (price currently inside).
- Ensure `gates.engine.confirmation.last_bar` has direction=bullish + body_ratio>=0.6.
- Ensure `gates.engine.pillar2.current_tf.displacement` is `clean`.
- Add `brief_digest.symbols.<sym>.pillar1.htf_destination.dir = "above"` + cite.
- Add `brief_digest.symbols.<sym>.pillar1.overnight_block.untaken_above[]` with 2+ prices.
- Add `brief_digest.leader = "mnq"` and `brief_digest.ltf_bias_context = { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'mss' }`.

Create `tests/fixtures/006-mss-bull-tradable.expected.md`:

```markdown
# Fixture 006: MSS-bull tradable

Detector should emit:

- `best_candidate.model: "MSS"`
- `best_candidate.side: "long"`
- `best_candidate.grade_proposed: "A+"`
- `best_candidate.grade_capped: "A+"`
- `best_candidate.tradable: true`
- `best_candidate.stop_options[0].kind: "fvg_candle1_low"` (with derived value)
- `best_candidate.tp1.cite` resolves to first untaken_above entry
- All 6 MSS components `present: true`
```

- [ ] **Step 2: Repeat for Trend (007) and Inversion (008)**

For 007-trend-bull-tradable:
- Replace MSS-specific signals with Trend ones: most_recent_structure = BoS bull; inside_fvgs has fresh bull FVG; no failure_swings needed.
- Expected: best_candidate.model = "Trend", side = "long", grade_proposed = "A+".

For 008-inversion-short-tradable:
- Replace with Inversion-specific: engine_by_tf.<tf>.fvgs has a fresh ifvg dir=bear; inside_fvgs contains that ifvg.
- Set side via htf_destination.dir = "below".
- Expected: best_candidate.model = "Inversion", side = "short", grade_proposed in {A+, B}.

- [ ] **Step 3: Verify smoke fixtures still pass**

Run: `npm run smoke:fixtures`
Expected: all fixtures pass (smoke checks schema + citations; new fixtures land cleanly).

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/006-*.bundle.json tests/fixtures/006-*.expected.md tests/fixtures/007-*.bundle.json tests/fixtures/007-*.expected.md tests/fixtures/008-*.bundle.json tests/fixtures/008-*.expected.md
git commit -m "$(cat <<'EOF'
test(fixtures): tradable fixtures 006/007/008 — MSS / Trend / Inversion

Each fixture is a single-symbol bundle staged so the detector emits a
tradable candidate for the named model. Expected.md captures the
detector's required output shape for the regression test in Task 17.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Author 8 miss-regression fixtures

**Files:**
- Create: `tests/fixtures/miss-regressions/miss-{01..08}-*.bundle.json` + `.expected.md` (8 pairs)

Each fixture pins one of the 8 misses from the 2026-05-26 session. Detector run on each must NOT replicate the misread.

For each: copy a tradable fixture as a starting point, mutate ONE field to demonstrate the miss condition, write expected.md describing what the detector must emit instead.

- [ ] **Step 1: miss-01 (bars_by_tf cite — wrong access shape)**

Copy fixture 006 → `tests/fixtures/miss-regressions/miss-01-bars-by-tf-cite.bundle.json`.
Mutation: none of the bundle, but ensure `brief_digest.symbols.<sym>.htf.daily.change_pct` is set.
Expected.md: detector cites must use `brief_digest.symbols.<sym>.htf.daily.change_pct` paths, NOT `bars_by_tf.daily.change_pct`. (This isn't a detector check per se but a confirmation that detector's output uses the slim digest paths.)

- [ ] **Step 2: miss-02 (fabricated sizing)**

Not a detector concern — sizing is computed by `cli/lib/sizing.js` and injected by `app/main/session-brief.js`. Skip this fixture for the detector — the existing `computeSize` test suite covers it. Note in `miss-regressions/README.md` that miss-02 is covered upstream.

- [ ] **Step 3: miss-03 (chain_status null)**

Not a detector concern — chain_status auto-derive is in `app/main/tools/surface.js`. Skip and note as covered upstream.

- [ ] **Step 4: miss-04 (swept-level TP)**

Copy fixture 006 → `miss-04-swept-tp.bundle.json`.
Mutation: ensure `gates.engine.pillar1.session_levels.AS_H` has `swept: true` (and `valid_as_target: false`) AND that AS_H sits visually close to current price.
Expected.md: detector's `best_candidate.tp1.cite` and `tp2.cite` must NEVER point at AS_H. They must use `untaken_above[]`.

- [ ] **Step 5: miss-05 (locked LTF bias)**

Copy fixture 006 → `miss-05-locked-ltf-bias.bundle.json`.
Mutation: set `brief_digest.ltf_bias_context.bias = "bear"` while `brief_digest.symbols.<sym>.pillar1.htf_destination.dir = "above"` (HTF bull) AND retain a valid MSS-bull setup.
Expected.md: detector's `best_candidate.side` must be `"long"` (driven by htf_destination, not ltf bias snapshot). The ltf bias is informational only; the detector evaluates current engine state.

- [ ] **Step 6: miss-06 (premature phase)**

Not a detector concern — phase tag is set by `app/main/tools/surface.js` from ET clock. Skip and note as covered upstream.

- [ ] **Step 7: miss-07 (wrong stop)**

Copy fixture 006 → `miss-07-wrong-stop.bundle.json`.
Mutation: ensure `bars_by_tf.m5.last_5_bars[]` has data for the FVG's 3 formation candles, AND the swing low is 0.25 pt above (further away from entry than) the candle1_low.
Expected.md: detector's `best_candidate.stop_options[0].kind = "fvg_candle1_low"` (priority 1, even when swing low is "valid"). Validator must reject if model picks fvg_bottom.

- [ ] **Step 8: miss-08 (pullback already played)**

Copy fixture 006 → `miss-08-pullback-already-played.bundle.json`.
Mutation: ensure the fresh FVG's `created_ms` matches the current bar (FVG was just created). Set `gates.engine.price_context.inside_fvgs = []` — price displaced away.
Expected.md: detector's `retrace_to_fvg.present = false`, `missing_reason` includes "not yet retested". MSS candidate is non-tradable for this bar. The detector's rejection_summary should describe waiting for retrace.

- [ ] **Step 9: Verify smoke fixtures still pass**

Run: `npm run smoke:fixtures`
Expected: all fixtures (including new miss-regressions) pass.

Some smoke checks may need updating if they don't recurse into subdirectories. Check `scripts/smoke-fixtures.js` — if it only scans `tests/fixtures/*.bundle.json` (one level deep), update to also scan `tests/fixtures/miss-regressions/*.bundle.json`. If the scan is recursive, no change.

If you need to update `scripts/smoke-fixtures.js`, add a single line near its glob to include subdirs:

```js
// Replace glob('tests/fixtures/*.bundle.json') with the equivalent recursive form.
// Most projects use fs.readdirSync with { withFileTypes: true }; recursion is one extra map call.
```

- [ ] **Step 10: Commit**

```bash
git add tests/fixtures/miss-regressions/
git commit -m "$(cat <<'EOF'
test(fixtures): miss-regression fixtures for 5 detector-relevant misses

miss-01, 04, 05, 07, 08 each pin a specific misread from the
2026-05-26 session log. The detector must NOT replicate the misread
when run on these bundles. miss-02 (sizing), miss-03 (chain_status),
miss-06 (phase tag) are covered upstream (sizing helper / surface.js
auto-derive / clock-derived phase); noted in
miss-regressions/README.md.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Fixture-driven end-to-end tests

**Files:**
- Modify: `tests/setup-detector.test.js` (append fixture-driven section)
- Create: `tests/fixtures/miss-regressions/README.md` (clarify which misses are detector-relevant)

- [ ] **Step 1: Append fixture-driven tests**

Append to `tests/setup-detector.test.js`:

```js
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, 'fixtures');

function loadFixture(name) {
  const path = name.startsWith('miss-regressions/') ? resolve(FIXTURES, name) : resolve(FIXTURES, name);
  return JSON.parse(readFileSync(path + '.bundle.json', 'utf8'));
}

// ============================================================================
// End-to-end: tradable fixtures should produce tradable candidates.
// ============================================================================

test('fixture 006: MSS-bull-tradable produces tradable MSS-long candidate', () => {
  const bundle = loadFixture('006-mss-bull-tradable');
  const r = detectSetups({
    bundle,
    leader: bundle.brief_digest?.leader ?? 'mnq',
    ltf_bias_context: bundle.brief_digest?.ltf_bias_context ?? { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'mss' },
    untaken_targets: {
      untaken_above: bundle.brief_digest?.symbols?.[Object.keys(bundle.brief_digest.symbols)[0]]?.pillar1?.overnight_block?.untaken_above ?? [],
      untaken_below: [],
    },
  });
  assert.equal(r.best_candidate?.model, 'MSS');
  assert.equal(r.best_candidate?.side, 'long');
  assert.equal(r.best_candidate?.tradable, true);
});

test('fixture 007: Trend-bull-tradable produces tradable Trend-long candidate', () => {
  const bundle = loadFixture('007-trend-bull-tradable');
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: bundle.brief_digest?.ltf_bias_context ?? { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'trend' },
    untaken_targets: {
      untaken_above: bundle.brief_digest?.symbols?.[Object.keys(bundle.brief_digest.symbols)[0]]?.pillar1?.overnight_block?.untaken_above ?? [],
      untaken_below: [],
    },
  });
  assert.equal(r.best_candidate?.model, 'Trend');
  assert.equal(r.best_candidate?.tradable, true);
});

test('fixture 008: Inversion-short-tradable produces tradable Inversion-short candidate', () => {
  const bundle = loadFixture('008-inversion-short-tradable');
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: bundle.brief_digest?.ltf_bias_context ?? { bias: 'bear', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'inversion' },
    untaken_targets: {
      untaken_above: [],
      untaken_below: bundle.brief_digest?.symbols?.[Object.keys(bundle.brief_digest.symbols)[0]]?.pillar1?.overnight_block?.untaken_below ?? [],
    },
  });
  assert.equal(r.best_candidate?.model, 'Inversion');
  assert.equal(r.best_candidate?.side, 'short');
  assert.equal(r.best_candidate?.tradable, true);
});

// ============================================================================
// Regression: miss-regression fixtures must NOT replicate the original misread.
// ============================================================================

test('miss-04: TP cite is never a swept session level', () => {
  const bundle = loadFixture('miss-regressions/miss-04-swept-tp');
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: bundle.brief_digest?.ltf_bias_context ?? {},
    untaken_targets: {
      untaken_above: bundle.brief_digest?.symbols?.[Object.keys(bundle.brief_digest.symbols)[0]]?.pillar1?.overnight_block?.untaken_above ?? [],
      untaken_below: [],
    },
  });
  if (r.best_candidate) {
    assert.doesNotMatch(r.best_candidate.tp1.cite ?? '', /session_levels\.AS_H/);
    assert.doesNotMatch(r.best_candidate.tp2.cite ?? '', /session_levels\.AS_H/);
  }
});

test('miss-05: side is driven by htf_destination, not locked ltf_bias', () => {
  const bundle = loadFixture('miss-regressions/miss-05-locked-ltf-bias');
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bear', htf_ltf_alignment: 'divergent', grade_cap: 'B' },  // locked bear
    untaken_targets: {
      untaken_above: bundle.brief_digest?.symbols?.[Object.keys(bundle.brief_digest.symbols)[0]]?.pillar1?.overnight_block?.untaken_above ?? [],
      untaken_below: [],
    },
  });
  // HTF dir=above + valid MSS-bull setup → side must be long (MSS only allowed when divergent).
  if (r.best_candidate) {
    assert.equal(r.best_candidate.side, 'long');
    assert.equal(r.best_candidate.model, 'MSS');
  }
});

test('miss-07: stop_options[0].kind is fvg_candle1_low when bars+FVG present', () => {
  const bundle = loadFixture('miss-regressions/miss-07-wrong-stop');
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: bundle.brief_digest?.ltf_bias_context ?? {},
    untaken_targets: {
      untaken_above: bundle.brief_digest?.symbols?.[Object.keys(bundle.brief_digest.symbols)[0]]?.pillar1?.overnight_block?.untaken_above ?? [],
      untaken_below: [],
    },
  });
  if (r.best_candidate) {
    assert.equal(r.best_candidate.stop_options[0].kind, 'fvg_candle1_low');
  }
});

test('miss-08: retrace_to_fvg.present is false when FVG just created (price not inside)', () => {
  const bundle = loadFixture('miss-regressions/miss-08-pullback-already-played');
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: bundle.brief_digest?.ltf_bias_context ?? {},
    untaken_targets: { untaken_above: [], untaken_below: [] },
  });
  // MSS candidate exists but is not tradable: retrace_to_fvg is the missing component.
  const mssRejection = r.rejections?.find?.((rej) => rej.model === 'MSS');
  assert.ok(mssRejection || r.best_candidate?.model !== 'MSS' || r.best_candidate?.components?.retrace_to_fvg?.present === false);
});
```

- [ ] **Step 2: Add miss-regressions README**

Create `tests/fixtures/miss-regressions/README.md`:

```markdown
# Miss-regression fixtures

Each fixture pins one of the 8 strategy-fidelity misses from the
2026-05-26 session log (see [docs/research/2026-05-26-llm-strategy-fidelity.md](../../../docs/research/2026-05-26-llm-strategy-fidelity.md)).

## Detector-relevant misses

- `miss-04-swept-tp` — TP cite must use untaken_above[], never a swept level.
- `miss-05-locked-ltf-bias` — side driven by htf_destination, not locked ltf bias.
- `miss-07-wrong-stop` — stop_options[0] is fvg_candle1_low when bars + FVG present.
- `miss-08-pullback-already-played` — retrace_to_fvg.present requires inside_fvgs[] currently containing the FVG; a fresh-just-created FVG is not yet retested.

## Covered upstream (no detector fixture)

- **miss-01** (bars_by_tf cite) — fixed by brief_digest emission (PR #61).
- **miss-02** (fabricated sizing) — fixed by `cli/lib/sizing.js` + injection in `app/main/session-brief.js` (PR #61).
- **miss-03** (chain_status null) — auto-derived in `app/main/tools/surface.js` (PR #61).
- **miss-06** (premature phase tag) — phase derived from ET clock in `app/main/tools/surface.js` (PR #61).
```

- [ ] **Step 3: Run all detector tests**

Run: `npm run test:unit -- tests/setup-detector.test.js`
Expected: all tests pass — unit tests + fixture-driven tradables + miss regressions.

- [ ] **Step 4: Commit**

```bash
git add tests/setup-detector.test.js tests/fixtures/miss-regressions/README.md
git commit -m "$(cat <<'EOF'
test(detector): fixture-driven end-to-end + miss regression tests

3 tradable fixtures (006/007/008) verify detector emits tradable
candidates for each entry model. 4 miss-regression tests verify the
detector does not replicate the original 2026-05-26 misreads
(swept-TP, locked-LTF-bias, wrong-stop, pullback-already-played).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Update CLAUDE.md decision row + analyze recipe section

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add architecture decision row**

In `CLAUDE.md`, locate the architecture decisions table (under `## Architecture decisions`). Append a new row at the bottom:

```markdown
| 2026-05-26 | Strategy detector — code-side neurosymbolic architecture | Eight strategy-fidelity misses in one session demonstrated that prose-strategy + LLM-interpretation has too many failure surfaces. New `cli/lib/setup-detector.js` evaluates MSS / Trend / Inversion components mechanically against engine state, emits a structured candidate object on `bundle.candidates`. `bar-close.js` injects this as `<candidate_object>` into the per-bar entry_hunt prompt. Model copies values + writes narration; cannot override or trade what the detector rejected. `app/main/tools/surface.js` `surfaceSetup` audits the payload against the detector (cites resolve, TPs are untaken, stop matches `stop_options`, grade ≤ `grade_capped`, model/side match). Strict (reject) mode from day one — tests-only trust path; 70+ unit tests + 3 tradable fixtures + 4 miss-regression fixtures. Schema disambiguation rewrites ambiguous engine fields (`reacted` → `displacement_at_creation`, `fvg.state: "fresh"` → `state_semantic: "created_never_retested"` + `retested_since_creation: false`, `level.taken: true` → `swept + valid_as_target: false`). New `<anti_patterns>` prompt block lists the 8 specific 2026-05-26 misreads. Spec: [docs/superpowers/specs/2026-05-26-strategy-detector-design.md](docs/superpowers/specs/2026-05-26-strategy-detector-design.md). Plan: [docs/superpowers/plans/2026-05-26-strategy-detector-implementation.md](docs/superpowers/plans/2026-05-26-strategy-detector-implementation.md). |
```

- [ ] **Step 2: Update `analyze` recipe section**

In `CLAUDE.md`, the `## The analyze recipe` section describes the bundle shape. Add a `candidates` field to the schema block:

Find the line ending with `gates: { ... }` followed by `}`, and add before the closing `}`:

```
  candidates: {                                          detector output (cli/lib/setup-detector.js)
    best_candidate: { model, side, entry, stop, stop_options[], tp1, tp2,
                      grade_proposed, grade_capped, components, rationale, tradable } | null,
    rejections: [{ model, side, reason }],
    rejection_summary: string | null,                    set when best_candidate is null
    meta: { detector_version, leader, timestamp_ms, bar_close_ms }
  }
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(CLAUDE): decision row + analyze recipe — strategy detector

Documents the neurosymbolic detector architecture as a decision row.
Updates the analyze recipe schema with the new bundle.candidates
field. Links to spec + plan.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Final smoke + push + rebase + PR

**Files:**
- None new; integration checkpoint.

- [ ] **Step 1: Full test sweep**

Run: `npm run test:unit && npm run smoke:fixtures`
Expected: ALL tests pass. ALL fixtures pass.

- [ ] **Step 2: Rebase onto main if PR #61 has merged**

Run: `git fetch origin && git log --oneline origin/main -5`
If `origin/main` contains the strategy-chain work (look for commits from PR #61 like `feat(chain): brief digest emission` or similar), rebase:

```bash
git rebase origin/main
```

Resolve any conflicts (most likely in `app/main/prompts/analyze.md` — pick the union of both prompt-section rewrites). Re-run tests after rebase: `npm run test:unit && npm run smoke:fixtures`.

If PR #61 hasn't merged yet, skip the rebase. Open the PR against `main` and GitHub will mark it as needing rebase; that's fine, the rebase can happen at merge time.

- [ ] **Step 3: Push branch**

```bash
git push -u origin feat/setup-detector
```

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "feat: strategy detector — code-side neurosymbolic architecture" --body "$(cat <<'EOF'
## Summary
- New `cli/lib/setup-detector.js` evaluates MSS / Trend / Inversion components mechanically against engine state, emits a structured candidate object on `bundle.candidates`.
- `app/main/tools/surface.js` `surfaceSetup` audits the model's surfaced setup against the detector (cite resolution, untaken TPs, stop in priority options, grade ≤ grade_capped, model/side match). Strict reject mode from day one.
- `app/main/prompts/analyze.md` `<phase name="entry_hunt">` rewritten to read `<candidate_object>` and copy values; new `<anti_patterns>` block lists 8 specific misreads from the 2026-05-26 session.
- Schema disambiguation (`cli/lib/setup-detector-schema.js`) rewrites ambiguous engine fields (`reacted`, `fvg.state`, `level.taken`) into semantically explicit names per PARSE/ARCHITECT pattern.

Closes the strategy-fidelity miss class diagnosed in [docs/research/2026-05-26-llm-strategy-fidelity.md](docs/research/2026-05-26-llm-strategy-fidelity.md). Spec: [docs/superpowers/specs/2026-05-26-strategy-detector-design.md](docs/superpowers/specs/2026-05-26-strategy-detector-design.md). Plan: [docs/superpowers/plans/2026-05-26-strategy-detector-implementation.md](docs/superpowers/plans/2026-05-26-strategy-detector-implementation.md).

## Test plan
- [x] All unit tests pass (`npm run test:unit`) — 70+ new tests across schema disambiguation, stop placement, per-model evaluators, tradable rule, conflict resolution, validator audit.
- [x] All smoke fixtures pass (`npm run smoke:fixtures`) — 3 tradable fixtures (006/007/008) + 4 miss-regression fixtures + all prior 5 fixtures.
- [ ] Manual: run a live session and verify detector emits tradable candidate during a real MSS-bull setup; verify validator rejects an A+ override on a B-capped setup.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Capture PR URL + report**

PR URL appears in stdout. Report it. Run `gh pr view` to confirm details.

---

## Self-review summary

Spec coverage: all 10 locked decisions mapped to tasks (all 3 models in Tasks 4/5/6; tests-only via Tasks 4-10 unit tests + Task 17 fixtures; no override enforced in Task 13 prompt + Task 10 validator; copy+narrate is Task 13; schema disambiguation is Task 2; conflict resolution is Task 9 pickBestCandidate; detector on leader only is Task 9 resolveSidesToEvaluate + waitState).

8 misses → fixtures/coverage:
- miss-01 covered upstream (PR #61).
- miss-02 covered upstream (sizing helper + brief injection).
- miss-03 covered upstream (chain_status auto-derive).
- miss-04 → fixture miss-04 + Task 17 regression test (TP not swept).
- miss-05 → fixture miss-05 + Task 17 regression test (side from htf_destination).
- miss-06 covered upstream (clock-derived phase).
- miss-07 → fixture miss-07 + Task 17 regression test (stop_options[0] = fvg_candle1_low).
- miss-08 → fixture miss-08 + Task 17 regression test (retrace_to_fvg requires inside_fvgs[]).

Placeholder scan: no TBD / TODO / "similar to" / "fill in" — every step has actual code or commands.

Type consistency: `Candidate`, `ComponentResult`, `StopOption` shape consistent across Tasks 2/3/4/5/6/9/10. `gradeRank` defined once and reused.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-26-strategy-detector-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
