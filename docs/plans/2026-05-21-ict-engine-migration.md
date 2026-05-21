# ICT Engine Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four chart indicators (FVG/iFVG, Anchored Market Structures, Killzones & Pivots, Balanced Price Range) with the single **ICT Engine** indicator as the data source for `tv analyze`.

**Architecture:** The ICT Engine emits one machine-readable table — schema-versioned, pipe-delimited rows covering levels, sweeps, FVGs, BPRs, swings, structure events, and quality. A new pure parser (`cli/lib/ict-engine-parser.js`) turns that table into structured numeric objects; `computeGates` is rebuilt to read the parsed engine output instead of decoding four separate Pine studies. This keeps the project on the research-mandated "deterministic extraction → LLM synthesis" pattern (`docs/research/ai-trading-analysis.md`) while moving MSS/BOS detection from LLM-interpretive to mechanical.

**Tech Stack:** Node ESM, `node:test` + `node:assert/strict`, the vendored `tv` CLI.

---

## Why this is safe (research / strategy check)

Re-read 2026-05-21 before writing this plan:

- `ai-trading-analysis.md` — the engine **is** the deterministic-extraction layer; migrating keeps the hybrid architecture and makes more of it mechanical. Failure mode #1 (hallucinated levels) → the parser must emit numbers at resolvable JSON paths so cite-or-reject (constraint #6) still holds. Honored in the parser design below.
- `trading-strategy-2026.md` §2.1 — "extensive imbalances that took liquidity" maps exactly onto the engine's `disp_score` + `took_liq`. §7 step 3 wants 15m + 5m anatomy → the engine is single-TF, so HTF/LTF quality requires a **per-TF capture** (Phase 2).
- `entry-models.md` — MSS/Trend/Inversion remain LLM synthesis; the engine supplies `structure` (BOS/MSS) and `state=inverted` FVGs as evidence. No conflict.
- **Tension — single-TF:** confirmed from the Pine source (`request.security` is used only for PDH/PDL/PWH/PWL). The plan resolves it by capturing the engine table at each TF in the existing multi-TF chart sweep.

## Convention decision

The ICT Engine uses the **textbook** convention (verified from `trackTier` in the Pine source): `HH`=Higher High, `LH`=Lower High, `HL`=Higher Low, `LL`=Lower Low — second letter is the pivot type. The user wants textbook. The project's current docs (`analyze.md` ICT vocabulary, `CLAUDE.md` key-naming note) teach the *reversed* LuxAlgo-AMS convention — Phase 4 flips them to textbook.

## File Structure

| File | Responsibility |
|---|---|
| `cli/lib/ict-engine-parser.js` | **(new)** Pure functions: parse the engine's table-of-strings into structured numeric objects. No CDP, no I/O. |
| `tests/ict-engine-parser.test.js` | **(new)** Unit tests for the parser. |
| `cli/commands/analyze.js` | Rebuild `computeGates` from parsed engine output; capture the engine table per-TF. |
| `cli/lib/pillar2-thresholds.js` + `tests/pillar2-thresholds.test.js` | **(removed)** Superseded by the engine's ATR-relative `quality` row. |
| `.claude/commands/analyze.md` | Textbook convention; new gate shape; drop the bgColor-decode note. |
| `CLAUDE.md` | Flip the key-naming note; update the `analyze` recipe; add a decision row. |
| `tests/fixtures/*` | Regenerated against the new bundle shape. |
| `cmd/tv-dash/main.go` | Only if a gate field name it reads changes. |

---

## Phase 1 — The parser (this plan)

A self-contained, fully unit-tested pure module. Ships independently of the wiring.

### Task 1: ICT Engine table parser

**Files:**
- Create: `cli/lib/ict-engine-parser.js`
- Test: `tests/ict-engine-parser.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_SCHEMA, parseRow, parseIctEngineTable, findIctEngineRows,
} from '../cli/lib/ict-engine-parser.js';

test('parseRow coerces a level row by field type', () => {
  const r = parseRow('level | name=PWH|price=29783.75|state=complete|swept=1|formed_ms=0');
  assert.equal(r.type, 'level');
  assert.deepEqual(r.fields, {
    name: 'PWH', price: 29783.75, state: 'complete', swept: true, formed_ms: 0,
  });
});

test('parseRow returns null for a non-row string and an unknown type', () => {
  assert.equal(parseRow('@Nephew_Sam_'), null);
  assert.equal(parseRow('banana | x=1'), null);
});

test('parseRow keeps quality.displacement a string but structure.displacement a bool', () => {
  const q = parseRow('quality | range_3h=110.75|range_quality=tight|displacement=weak|candle=doji_wick|has_chop=1');
  assert.equal(q.fields.displacement, 'weak');
  assert.equal(q.fields.has_chop, true);
  const s = parseRow('structure | event=mss|dir=bear|level=29350.25|broken_swing_ms=1|confirmed_ms=2|displacement=1|tier=internal|validation=break');
  assert.equal(s.fields.displacement, true);
  assert.equal(s.fields.level, 29350.25);
});

test('parseIctEngineTable buckets rows and derives swing.is_high', () => {
  const rows = [
    'meta | schema=1|count=6|emit_ny=09:20:20|emit_ms=1779369620478|tf=15|symbol=MNQ1!',
    'level | name=PWH|price=29783.75|state=complete|swept=0|formed_ms=0',
    'sweep | target=PDH|price=29397.00|side=buy|swept_ms=1779336900000|rejected=0',
    'fvg | kind=fvg|dir=bear|top=29355.50|bottom=29296.50|ce=29326.00|created_ms=1779358500000|took_liq=1|disp_score=0.74|reacted=0|reaction_dir=none|state=fresh',
    'bpr | dir=bull|top=28965.00|bottom=28964.00|created_ms=1779256800000|took_liq=0|reacted=0|reaction_dir=none|state=fresh',
    'swing | kind=HL|price=29350.25|bar_ms=1779353100000|tier=internal|swept=1',
    'swing | kind=LH|price=29429.75|bar_ms=1779355800000|tier=internal|swept=0',
    'structure | event=mss|dir=bear|level=29350.25|broken_swing_ms=1779353100000|confirmed_ms=1779358500000|displacement=1|tier=internal|validation=break',
    'quality | range_3h=110.75|range_quality=tight|displacement=weak|candle=doji_wick|has_chop=1',
  ];
  const t = parseIctEngineTable(rows);
  assert.equal(t.schema, 1);
  assert.equal(t.schema_supported, true);
  assert.equal(t.meta.tf, '15');
  assert.equal(t.levels.length, 1);
  assert.equal(t.sweeps.length, 1);
  assert.equal(t.fvgs.length, 1);
  assert.equal(t.bprs.length, 1);
  assert.equal(t.swings.length, 2);
  assert.equal(t.structures.length, 1);
  assert.equal(t.quality.range_3h, 110.75);
  // textbook convention: HL is a low pivot, LH is a high pivot
  assert.equal(t.swings[0].is_high, false);
  assert.equal(t.swings[1].is_high, true);
  assert.equal(t.fvgs[0].ce, 29326.00);
});

test('parseIctEngineTable flags an unsupported schema', () => {
  const t = parseIctEngineTable(['meta | schema=2|count=0|emit_ny=00:00:00|emit_ms=0|tf=15|symbol=MNQ1!']);
  assert.equal(t.schema, 2);
  assert.equal(t.schema_supported, false);
});

test('parseIctEngineTable returns null without a meta row', () => {
  assert.equal(parseIctEngineTable(['level | name=PWH|price=1|state=complete|swept=0|formed_ms=0']), null);
  assert.equal(parseIctEngineTable([]), null);
  assert.equal(parseIctEngineTable(null), null);
});

test('findIctEngineRows locates the study or returns null', () => {
  const tables = { studies: [
    { name: 'FVG/iFVG (Nephew_Sam_)', tables: [{ rows: ['@Nephew_Sam_'] }] },
    { name: 'ICT Engine', tables: [{ rows: ['meta | schema=1'] }] },
  ] };
  assert.deepEqual(findIctEngineRows(tables), ['meta | schema=1']);
  assert.equal(findIctEngineRows({ studies: [] }), null);
  assert.equal(findIctEngineRows(null), null);
});

test('ENGINE_SCHEMA is the supported version', () => {
  assert.equal(ENGINE_SCHEMA, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/ict-engine-parser.test.js`
Expected: FAIL — `Cannot find module '../cli/lib/ict-engine-parser.js'`.

- [ ] **Step 3: Write the parser**

```js
/**
 * ict-engine-parser.js — parse the ICT Engine indicator's evidence table.
 *
 * The ICT Engine emits its entire output as one TradingView table: rows of
 * "<type> | k=v|k=v|...". This module turns those strings into structured,
 * numerically-typed objects so analyze.js can build gates whose every price
 * resolves at a real JSON path (cite-or-reject, CLAUDE.md constraint #6).
 *
 * Pure functions — no CDP, no I/O. Source of the table format: the ICT Engine
 * Pine v6 indicator (emitMeta/emitLevelAndSweep/emitFvg/... emitters).
 */

/** Engine table schema this parser understands. Guard on meta.schema. */
export const ENGINE_SCHEMA = 1;

// Per-row-type field coercion. Keys not listed default to 'str', so unknown
// future fields survive as strings rather than being dropped or mis-coerced.
// `displacement` is intentionally per-type: a bool on structure rows, a string
// enum (clean|weak|na) on the quality row.
const ROW_FIELD_TYPES = {
  meta: { schema: 'num', count: 'num', emit_ms: 'num' },
  level: { price: 'num', swept: 'bool', formed_ms: 'num' },
  sweep: { price: 'num', swept_ms: 'num', rejected: 'bool' },
  fvg: {
    top: 'num', bottom: 'num', ce: 'num', created_ms: 'num',
    took_liq: 'bool', disp_score: 'num', reacted: 'bool',
  },
  bpr: { top: 'num', bottom: 'num', created_ms: 'num', took_liq: 'bool', reacted: 'bool' },
  swing: { price: 'num', bar_ms: 'num', swept: 'bool' },
  structure: {
    level: 'num', broken_swing_ms: 'num', confirmed_ms: 'num', displacement: 'bool',
  },
  quality: { range_3h: 'num', has_chop: 'bool' },
};

/** Coerce one payload value. 'num' → finite Number or null; 'bool' → v==='1'. */
function coerceValue(v, kind) {
  if (kind === 'bool') return v === '1';
  if (kind === 'num') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return v;
}

/**
 * Parse one table row "<type> | k=v|k=v|...".
 * Returns { type, fields } or null when the string is not a known engine row.
 */
export function parseRow(row) {
  if (typeof row !== 'string') return null;
  const sep = row.indexOf(' | ');
  if (sep === -1) return null;
  const type = row.slice(0, sep).trim();
  const typeMap = ROW_FIELD_TYPES[type];
  if (!typeMap) return null;
  const fields = {};
  for (const pair of row.slice(sep + 3).split('|')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    if (!key) continue;
    fields[key] = coerceValue(pair.slice(eq + 1), typeMap[key] || 'str');
  }
  return { type, fields };
}

/** A swing pivot's type is its kind's SECOND letter: H→high pivot, L→low. */
function withIsHigh(swing) {
  return { ...swing, is_high: typeof swing.kind === 'string' && swing.kind[1] === 'H' };
}

/**
 * Parse the full engine table (array of row strings) into a structured object.
 * Returns null when there is no meta row (not an ICT Engine table).
 */
export function parseIctEngineTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out = {
    schema: null, schema_supported: false, meta: null,
    levels: [], sweeps: [], fvgs: [], bprs: [], swings: [], structures: [], quality: null,
  };
  for (const raw of rows) {
    const parsed = parseRow(raw);
    if (!parsed) continue;
    const { type, fields } = parsed;
    if (type === 'meta') {
      out.meta = fields;
      out.schema = fields.schema ?? null;
      out.schema_supported = out.schema === ENGINE_SCHEMA;
    } else if (type === 'level') out.levels.push(fields);
    else if (type === 'sweep') out.sweeps.push(fields);
    else if (type === 'fvg') out.fvgs.push(fields);
    else if (type === 'bpr') out.bprs.push(fields);
    else if (type === 'swing') out.swings.push(withIsHigh(fields));
    else if (type === 'structure') out.structures.push(fields);
    else if (type === 'quality') out.quality = fields;
  }
  return out.meta == null ? null : out;
}

/**
 * Locate the ICT Engine's rows inside a `tv data tables` (getPineTables) result.
 * Returns the rows array, or null when the indicator is not on the chart.
 */
export function findIctEngineRows(pineTablesResult) {
  const study = (pineTablesResult?.studies || []).find((s) => s?.name === 'ICT Engine');
  const rows = study?.tables?.[0]?.rows;
  return Array.isArray(rows) ? rows : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/ict-engine-parser.test.js`
Expected: PASS — 8/8.

- [ ] **Step 5: Run the full unit suite to confirm nothing else broke**

Run: `npm run test:unit`
Expected: PASS — all existing tests plus the 8 new ones.

- [ ] **Step 6: Commit**

```bash
git add cli/lib/ict-engine-parser.js tests/ict-engine-parser.test.js
git commit -m "feat: add ICT Engine evidence-table parser"
```

---

## Phases 2–5 — roadmap (separate plans)

Per the writing-plans scope check, these are distinct subsystems and each gets its own detailed plan once Phase 1 lands. Summary so the migration is legible end-to-end:

**Phase 2 — Capture the engine table per-TF.** Extend `captureMultiTf` in `analyze.js`: at each TF switch, also call `data.getPineTables()`, run `findIctEngineRows` + `parseIctEngineTable`, and store under a new top-level `engine_by_tf.{daily,h4,h1,m15,m5,m1}`. Capture the engine at the current TF too. Acceptance: a full `tv analyze` bundle carries `engine_by_tf` with a parsed object per TF.

**Phase 3 — Rebuild `computeGates` from the engine.** `gates.session.*` stays (clock-based, indicator-independent). Rebuild `gates.pillar1` (`session_levels` from engine `levels`; new `sweeps` array), `gates.pillar2` (from the engine `quality` row at current TF + m5 + m15), `gates.pillar3` (`fvgs`/`structure_events`/`swings` from the engine). All prices land at numeric JSON paths (e.g. `gates.pillar3.fvgs[0].ce`). Delete `cli/lib/pillar2-thresholds.js` + its test. Acceptance: `npm run smoke:fixtures` passes on a regenerated fixture.

**Phase 4 — Docs.** `analyze.md`: rewrite the ICT-vocabulary section to textbook convention, drop the bgColor note, repoint phase reads to the new gate shape. `CLAUDE.md`: flip the key-naming note, update the `analyze` recipe section, add a decision row.

**Phase 5 — Fixtures + harness.** Regenerate every `tests/fixtures/*.bundle.json`; re-grade `.expected.md` as needed; confirm `verify-citations.js` resolves the new numeric paths. Update `cmd/tv-dash/main.go` only if a gate field it reads was renamed.

---

## Self-Review

- **Spec coverage:** Phase 1 delivers the parser the user asked for; Phases 2–5 cover capture, gates, docs, fixtures — every file in the File Structure table is addressed.
- **Placeholder scan:** none — Phase 1 has complete code; Phases 2–5 are explicitly scoped as follow-on plans, not in-plan placeholders.
- **Type consistency:** `parseRow`/`parseIctEngineTable`/`findIctEngineRows`/`ENGINE_SCHEMA` names match between the test and the implementation.
