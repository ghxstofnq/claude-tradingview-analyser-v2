# Roadmap Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three open items in CLAUDE.md "Pending implementation → Next" — grow the fixture corpus, make Pillar 2 thresholds symbol-aware, and add an LLM-as-judge semantic regression check.

**Architecture:** Two deterministic Node tooling additions (`scripts/`) plus one small CLI helper module (`cli/lib/`), one focused change to `cli/commands/analyze.js`, and one new slash command (`.claude/commands/judge.md`). No new runtime dependencies. The LLM-as-judge runs as a Claude Code slash command (not an API script — CLAUDE.md forbids Anthropic API in scripts); a deterministic Node script tallies its categorical verdicts.

**Tech Stack:** Node ESM (`"type": "module"`), `node:test` + `node:assert/strict` (the existing `npm run test:unit` runner), the vendored `tv` CLI.

---

## Design decisions & tensions (standing-rule confirmation)

Per the CLAUDE.md workflow rule, this plan was checked against `docs/research/ai-consistency.md`, `docs/research/ai-trading-analysis.md`, `docs/strategy/trading-strategy-2026.md`, and `docs/strategy/entry-models.md`. Tensions surfaced:

1. **"Target ~10" vs "build organically."** `tests/fixtures/README.md` and `ai-trading-analysis.md` rec #7 say build the corpus *as states occur*, not in a batch. Resolution: this plan does **not** fabricate 10 fixtures. Part 1 ships tooling that makes capture + gap-tracking frictionless; Part 3 is the ongoing capture procedure. Reaching ~10 is paced by real market states.
2. **No backtesting on data Claude has seen** (constraint #10). Fixtures must come from post-cutoff sessions. Live capture going forward is inherently post-cutoff and is the default method in Part 3.
3. **Body-ratio thresholds are not symbol-dependent.** `computeCandleStats` uses `avg >= 0.6 / >= 0.3` — a normalised 0..1 ratio, identical across instruments. Only the **range** threshold (`>= 40` points) is price-scale dependent. Part 2 makes *only the range threshold* symbol-aware and leaves body-ratio fixed.
4. **Per-symbol thresholds need calibration data.** Part 2 ships the *mechanism* with only `MNQ` calibrated (40, from seed fixture 001); unknown symbols emit `range_acceptable: null` ("uncalibrated — judge manually"). Other symbols get calibrated as Part 3 adds fixtures for them. Part 2 therefore depends on Part 3 for full value but is shippable alone.
5. **LLM-as-judge cannot be an API script.** CLAUDE.md: "Claude Code session only — no Anthropic API in scripts." The judge is a slash command. Per constraint #7 (no LLM arithmetic) the judge emits **categorical** per-dimension verdicts; a deterministic script tallies them. Per `ai-consistency.md` ("deterministic format checks plus LLM-as-judge for semantics") the judge *complements* `smoke:fixtures`, it does not replace it.

**Sequencing:** Part 1 and Part 2 are independent and can be done in either order / in parallel. Part 3 uses Part 1's tooling. Part 4 is gated on Part 3 reaching ~10 fixtures.

**Commits:** Conventional Commits; every commit ends with `Co-Authored-By: Claude <noreply@anthropic.com>` per CLAUDE.md. Commit subjects are shown per task below.

---

## File Structure

**Created:**
- `cli/lib/pillar2-thresholds.js` — per-symbol Pillar 2 calibration lookup. Pure functions.
- `scripts/fixture-coverage.js` — reports which target coverage cells the corpus fills. Pure helpers + a `main()`.
- `scripts/new-fixture.js` — scaffolds a new fixture (next id, capture, expected.md template).
- `scripts/judge-report.js` — tallies the judge's categorical verdicts into an agreement report.
- `.claude/commands/judge.md` — `/judge` slash command: semantic regression check.
- `tests/pillar2-thresholds.test.js`, `tests/fixture-coverage.test.js`, `tests/judge-report.test.js` — unit tests.

**Modified:**
- `cli/commands/analyze.js` — `computeGates` takes a `symbol`; `range_acceptable` uses the per-symbol threshold; `pillar2` gate gains `range_acceptable_min`.
- `.claude/commands/analyze.md` — Pillar 2 step notes `range_acceptable` may be `null`.
- `package.json` — three npm scripts.
- `CLAUDE.md` — bundle-fields doc, "Next" list, architecture-decisions row.
- `tests/fixtures/README.md` — mention the coverage report + `new-fixture` helper.

---

## Part 1 — Fixture tooling

Lowers the friction that has kept the corpus at one fixture: a coverage report (see the gaps) and a capture scaffold (one command).

### Task 1.1: Coverage report — pure helpers

**Files:**
- Create: `scripts/fixture-coverage.js`
- Test: `tests/fixture-coverage.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/fixture-coverage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStructuredBlock, fixtureGrade, fixtureEntryModel, sessionBucket,
} from '../scripts/fixture-coverage.js';

test('parseStructuredBlock extracts the trailing json block', () => {
  const md = 'prose\n\n```json\n{"grade":"A+"}\n```\n';
  assert.deepEqual(parseStructuredBlock(md), { grade: 'A+' });
});

test('parseStructuredBlock returns null when there is no block', () => {
  assert.equal(parseStructuredBlock('no json here'), null);
});

test('fixtureGrade reads the grade enum, rejects anything else', () => {
  assert.equal(fixtureGrade({ grade: 'no-trade' }), 'no-trade');
  assert.equal(fixtureGrade({ grade: 'bogus' }), null);
  assert.equal(fixtureGrade(null), null);
});

test('fixtureEntryModel reads pillar3.entry_model', () => {
  assert.equal(fixtureEntryModel({ pillar3: { entry_model: 'MSS' } }), 'MSS');
  assert.equal(fixtureEntryModel({ pillar3: { entry_model: null } }), null);
});

test('sessionBucket buckets by in_ny_open_window', () => {
  assert.equal(sessionBucket({ gates: { session: { in_ny_open_window: true } } }), 'ny_open');
  assert.equal(sessionBucket({ gates: { session: { in_ny_open_window: false } } }), 'outside_ny');
  assert.equal(sessionBucket({}), 'unknown');
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test tests/fixture-coverage.test.js`
Expected: FAIL — `Cannot find module '../scripts/fixture-coverage.js'`.

- [ ] **Step 3: Implement `scripts/fixture-coverage.js`**

```js
#!/usr/bin/env node
/**
 * fixture-coverage.js — reports which target coverage cells the fixture
 * corpus fills, and which are still empty.
 *
 * Usage: npm run fixture:coverage   (or: node scripts/fixture-coverage.js)
 *
 * Target cells (tests/fixtures/README.md "When to grow the corpus"):
 *   NY-open window × {A+, B, no-trade};  outside-NY (any);
 *   A+ per entry model × {MSS, Trend, Inversion}.
 *
 * Exit code: 0 always (informational).
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = 'tests/fixtures';

/** Extract and parse the trailing ```json fenced block of an expected.md. */
export function parseStructuredBlock(mdText) {
  const m = String(mdText).match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Grade enum from the structured block; null if absent/invalid. */
export function fixtureGrade(structured) {
  const g = structured?.grade;
  return g === 'A+' || g === 'B' || g === 'no-trade' ? g : null;
}

/** Entry model from the structured block; null if no model in play. */
export function fixtureEntryModel(structured) {
  const m = structured?.pillar3?.entry_model;
  return m === 'MSS' || m === 'Trend' || m === 'Inversion' ? m : null;
}

/** Session bucket from the bundle's gates. */
export function sessionBucket(bundle) {
  const s = bundle?.gates?.session;
  if (!s) return 'unknown';
  return s.in_ny_open_window === true ? 'ny_open' : 'outside_ny';
}

function main() {
  const bundles = readdirSync(FIXTURES).filter((f) => f.endsWith('.bundle.json')).sort();
  const rows = bundles.map((b) => {
    const base = b.replace(/\.bundle\.json$/, '');
    const expectedPath = join(FIXTURES, `${base}.expected.md`);
    let bundle = null;
    try { bundle = JSON.parse(readFileSync(join(FIXTURES, b), 'utf8')); } catch {}
    const structured = existsSync(expectedPath)
      ? parseStructuredBlock(readFileSync(expectedPath, 'utf8'))
      : null;
    return {
      name: base,
      session: bundle ? sessionBucket(bundle) : 'unknown',
      grade: fixtureGrade(structured),
      model: fixtureEntryModel(structured),
    };
  });

  const cells = [
    { id: 'ny_open + A+',       hit: (r) => r.session === 'ny_open' && r.grade === 'A+' },
    { id: 'ny_open + B',        hit: (r) => r.session === 'ny_open' && r.grade === 'B' },
    { id: 'ny_open + no-trade', hit: (r) => r.session === 'ny_open' && r.grade === 'no-trade' },
    { id: 'outside_ny (any)',   hit: (r) => r.session === 'outside_ny' },
    { id: 'A+ MSS',             hit: (r) => r.grade === 'A+' && r.model === 'MSS' },
    { id: 'A+ Trend',           hit: (r) => r.grade === 'A+' && r.model === 'Trend' },
    { id: 'A+ Inversion',       hit: (r) => r.grade === 'A+' && r.model === 'Inversion' },
  ];

  console.log(`Fixture corpus: ${rows.length} fixture(s) (target ~10)\n`);
  for (const r of rows) {
    console.log(`  ${r.name}  [${r.session}]  grade=${r.grade ?? '—'}  model=${r.model ?? '—'}`);
  }
  console.log('\nCoverage cells:');
  let filled = 0;
  for (const c of cells) {
    const hits = rows.filter(c.hit).length;
    if (hits > 0) filled++;
    console.log(`  ${hits > 0 ? '[x]' : '[ ]'} ${c.id}  (${hits})`);
  }
  console.log(`\n${filled}/${cells.length} target cells filled.`);
}

// Run main() only when invoked directly, so tests can import the helpers.
if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test tests/fixture-coverage.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Add the npm script**

In `package.json` `scripts`, add: `"fixture:coverage": "node scripts/fixture-coverage.js"`.

- [ ] **Step 6: Smoke-run it**

Run: `npm run fixture:coverage`
Expected: lists `001-current` as `[outside_ny] grade=no-trade model=—`; reports `1/7 target cells filled`.

- [ ] **Step 7: Commit**

`git add scripts/fixture-coverage.js tests/fixture-coverage.test.js package.json`
Commit: `feat: add fixture coverage report`

### Task 1.2: New-fixture scaffold

**Files:**
- Create: `scripts/new-fixture.js`
- Test: `tests/fixture-coverage.test.js` (extend — `nextFixtureId` is exported from `new-fixture.js`)

- [ ] **Step 1: Write the failing test**

Add to `tests/fixture-coverage.test.js`:

```js
import { nextFixtureId } from '../scripts/new-fixture.js';

test('nextFixtureId returns the next zero-padded id', () => {
  assert.equal(nextFixtureId(['001-current.bundle.json', '001-current.expected.md']), '002');
  assert.equal(nextFixtureId([]), '001');
  assert.equal(nextFixtureId(['007-x.bundle.json', '003-y.bundle.json']), '008');
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test tests/fixture-coverage.test.js`
Expected: FAIL — `Cannot find module '../scripts/new-fixture.js'`.

- [ ] **Step 3: Implement `scripts/new-fixture.js`**

```js
#!/usr/bin/env node
/**
 * new-fixture.js — scaffold a new regression fixture: pick the next id,
 * capture the current chart with `tv analyze`, and write an expected.md
 * template for hand-grading.
 *
 * Usage: npm run fixture:new -- <label>
 *   e.g. npm run fixture:new -- ny-open-mss
 *
 * Exit codes: 0 ok, 2 usage error, 1 capture failed.
 */
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const FIXTURES = 'tests/fixtures';

/** Next zero-padded fixture id given the existing fixture filenames. */
export function nextFixtureId(existingFiles) {
  const ids = existingFiles
    .map((f) => f.match(/^(\d+)-/))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const max = ids.length ? Math.max(...ids) : 0;
  return String(max + 1).padStart(3, '0');
}

function expectedTemplate(id, label) {
  return `# Fixture ${id} — Expected Analysis (${label})

**Bundle:** \`${id}-${label}.bundle.json\`
**Chart:** <symbol> @ <resolution>
**Bundle time:** <gates.session.timestamp_et>
**Session label:** <gates.session.label>

**Note to reviewer:** hand-grade this with \`docs/strategy/trading-strategy-2026.md §7\`.
Cite every price as \`<price> (<json.path>)\`. Delete this note when graded.

---

## Pillar 1 — Draw & Bias
TODO

## Pillar 2 — Price Action Quality
TODO

## Pillar 3 — Entry Model + Confirmation
TODO

## Grade
TODO

---

## Structured output

\`\`\`json
{
  "pillar1": { "htf_bias": null, "htf_draw": null, "overnight": null, "ny_reaction": null },
  "pillar2": { "range_acceptable": null, "displacement_present": null, "candle_quality": null, "verdict": null },
  "pillar3": { "entry_model": null, "confirmation_status": null },
  "trade": { "entry": null, "stop": null, "target_tp1": null, "target_tp2": null, "invalidation": null },
  "grade": null
}
\`\`\`
`;
}

function main() {
  const label = process.argv[2];
  if (!label || !/^[a-z0-9-]+$/.test(label)) {
    console.error('usage: npm run fixture:new -- <label>   (lower-case, digits, hyphens)');
    process.exit(2);
  }
  const id = nextFixtureId(readdirSync(FIXTURES));
  const bundlePath = join(FIXTURES, `${id}-${label}.bundle.json`);
  const expectedPath = join(FIXTURES, `${id}-${label}.expected.md`);

  console.log(`Capturing ${bundlePath} ...`);
  const res = spawnSync('./bin/tv', ['analyze', '--out', bundlePath], { stdio: 'inherit' });
  if (res.status !== 0 || !existsSync(bundlePath)) {
    console.error('capture failed — is TradingView Desktop running on CDP 9223?');
    process.exit(1);
  }
  writeFileSync(expectedPath, expectedTemplate(id, label));
  console.log(`Wrote ${expectedPath} — hand-grade it, then run: npm run smoke:fixtures`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test tests/fixture-coverage.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Add the npm script**

In `package.json` `scripts`, add: `"fixture:new": "node scripts/new-fixture.js"`.

- [ ] **Step 6: Update `tests/fixtures/README.md`**

In "How to add a fixture", replace the manual step 2 with: "Run `npm run fixture:new -- <label>` — it picks the next `NNN`, captures the chart, and scaffolds the `expected.md` template." Keep steps 3–4 (hand-grade, `smoke:fixtures`). Add a line under "When to grow the corpus": "Run `npm run fixture:coverage` to see which target cells are still empty."

- [ ] **Step 7: Commit**

`git add scripts/new-fixture.js tests/fixture-coverage.test.js package.json tests/fixtures/README.md`
Commit: `feat: add new-fixture scaffold helper`

---

## Part 2 — Symbol-aware Pillar 2 thresholds

Makes the `range_acceptable` gate calibrated per symbol instead of hardcoded `>= 40` (MNQ-1m). Body-ratio thresholds stay fixed (normalised ratio — see tension #3).

### Task 2.1: Threshold lookup module

**Files:**
- Create: `cli/lib/pillar2-thresholds.js`
- Test: `tests/pillar2-thresholds.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/pillar2-thresholds.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSymbol, pillar2Thresholds } from '../cli/lib/pillar2-thresholds.js';

test('normalizeSymbol strips the exchange prefix and upper-cases', () => {
  assert.equal(normalizeSymbol('CME_MINI:MNQ1!'), 'MNQ1!');
  assert.equal(normalizeSymbol('mnq1!'), 'MNQ1!');
  assert.equal(normalizeSymbol('  CME_MINI:MES1!  '), 'MES1!');
  assert.equal(normalizeSymbol(''), '');
  assert.equal(normalizeSymbol(null), '');
});

test('pillar2Thresholds returns the calibrated MNQ minimum', () => {
  assert.equal(pillar2Thresholds('CME_MINI:MNQ1!').range_acceptable_min, 40);
});

test('pillar2Thresholds returns null for an uncalibrated symbol', () => {
  assert.equal(pillar2Thresholds('CME_MINI:MES1!').range_acceptable_min, null);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test tests/pillar2-thresholds.test.js`
Expected: FAIL — `Cannot find module '../cli/lib/pillar2-thresholds.js'`.

- [ ] **Step 3: Implement `cli/lib/pillar2-thresholds.js`**

```js
/**
 * pillar2-thresholds.js — per-symbol Pillar 2 calibration.
 *
 * The only price-scale-dependent Pillar 2 threshold is the minimum
 * acceptable range (in price points). Body-ratio thresholds in
 * computeCandleStats are a normalised 0..1 value — identical across
 * instruments — and deliberately stay hardcoded there.
 *
 * Only MNQ is calibrated (40, from seed fixture 001). Uncalibrated
 * symbols return null; analyze.js then emits range_acceptable: null
 * ("uncalibrated — judge the range manually"). Add a symbol here once
 * a fixture for it has been hand-graded.
 */

const RANGE_MIN_BY_SYMBOL = {
  'MNQ1!': 40,
  'MNQ': 40,
};

/** "CME_MINI:MNQ1!" -> "MNQ1!"; trims, upper-cases. */
export function normalizeSymbol(raw) {
  if (typeof raw !== 'string') return '';
  const afterColon = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw;
  return afterColon.trim().toUpperCase();
}

/** { range_acceptable_min: number|null, symbol: string }. */
export function pillar2Thresholds(rawSymbol) {
  const symbol = normalizeSymbol(rawSymbol);
  const min = Object.prototype.hasOwnProperty.call(RANGE_MIN_BY_SYMBOL, symbol)
    ? RANGE_MIN_BY_SYMBOL[symbol]
    : null;
  return { range_acceptable_min: min, symbol };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test tests/pillar2-thresholds.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

`git add cli/lib/pillar2-thresholds.js tests/pillar2-thresholds.test.js`
Commit: `feat: add per-symbol Pillar 2 threshold lookup`

### Task 2.2: Wire the lookup into `computeGates`

**Files:**
- Modify: `cli/commands/analyze.js` — import (line 1 area), `computeGates` signature (line 155), range gate (line 432), `pillar2` return (line ~506), call site (line 766).

- [ ] **Step 1: Add the import**

At the top of `cli/commands/analyze.js`, after the existing imports (line 4), add:

```js
import { pillar2Thresholds } from '../lib/pillar2-thresholds.js';
```

- [ ] **Step 2: Add `symbol` to the `computeGates` signature**

Line 155 — change:

```js
export function computeGates({ quote, bars, pine, fvgBoxesVerbose, barsByTf, replayStatus }) {
```

to:

```js
export function computeGates({ quote, bars, pine, fvgBoxesVerbose, barsByTf, replayStatus, symbol }) {
```

- [ ] **Step 3: Replace the hardcoded range gate**

Line 432 — change:

```js
  // Heuristic threshold for MNQ 1m (calibrated to seed fixture).
  const rangeAcceptable = rangeValue != null && rangeValue >= 40;
```

to:

```js
  // Per-symbol range threshold (cli/lib/pillar2-thresholds.js). null when
  // the symbol is uncalibrated — range_acceptable is then null, not false.
  const { range_acceptable_min: rangeMin } = pillar2Thresholds(symbol);
  const rangeAcceptable = rangeMin == null
    ? null
    : (rangeValue != null && rangeValue >= rangeMin);
```

- [ ] **Step 4: Emit `range_acceptable_min` in the `pillar2` gate**

In the returned `pillar2` object (line ~506), change:

```js
      range_acceptable: rangeAcceptable,
```

to:

```js
      range_acceptable: rangeAcceptable,
      range_acceptable_min: rangeMin,
```

- [ ] **Step 5: Pass the symbol at the call site**

Line 766 — change:

```js
    const gates = computeGates({ quote, bars, pine, fvgBoxesVerbose, barsByTf: bars_by_tf, replayStatus });
```

to:

```js
    const gates = computeGates({ quote, bars, pine, fvgBoxesVerbose, barsByTf: bars_by_tf, replayStatus, symbol: state.symbol });
```

(`state` is the chart-info object assigned to `bundle.chart` at line 770; `state.symbol` is the chart symbol.)

- [ ] **Step 6: Run the smoke harness — verify no fixture breakage**

Run: `npm run smoke:fixtures`
Expected: PASS 2/2. Fixture 001 is `CME_MINI:MNQ1!`, so `range_acceptable` stays a boolean (`true`) — the existing `range_acceptable = true` in `001-current.expected.md` still holds. `smoke-fixtures.js` does not assert `pillar2` children, so the new `range_acceptable_min` field is non-breaking.

- [ ] **Step 7: Run the unit suite**

Run: `npm run test:unit`
Expected: PASS — all existing tests plus the new `pillar2-thresholds` tests.

- [ ] **Step 8: Commit**

`git add cli/commands/analyze.js`
Commit: `feat: make Pillar 2 range gate symbol-aware`

### Task 2.3: Update the docs

**Files:**
- Modify: `.claude/commands/analyze.md` — Pillar 2 step (the "Range" bullet under "Step 3").
- Modify: `CLAUDE.md` — bundle-fields note + "Next" list + architecture row.

- [ ] **Step 1: Update the slash command**

In `.claude/commands/analyze.md`, "Step 3 — Pillar 2", the Range bullet — append:

> `range_acceptable` is `true`/`false` for calibrated symbols and `null` for uncalibrated ones (`gates.pillar2.range_acceptable_min` is `null`). On `null`, judge the range manually against HTF context — do not treat `null` as a fail.

- [ ] **Step 2: Update `CLAUDE.md`**

In the `analyze` recipe `gates.pillar2` field description, add `range_acceptable_min`. In "Pending implementation → Next", strike the Pillar 2 thresholds line (now done) — replace with: "~~Pillar 2 thresholds symbol-aware~~ — done 2026-05-20; `MNQ` calibrated, other symbols emit `null` until a fixture calibrates them." Add an architecture-decisions row dated 2026-05-20: "Pillar 2 range threshold is per-symbol (`cli/lib/pillar2-thresholds.js`); body-ratio stays fixed (normalised ratio). Uncalibrated symbols emit `range_acceptable: null`."

- [ ] **Step 3: Run the harness** (CLAUDE.md mandates it after editing `analyze.md`)

Run: `npm run smoke:fixtures`
Expected: PASS 2/2.

- [ ] **Step 4: Commit**

`git add .claude/commands/analyze.md CLAUDE.md`
Commit: `docs: note symbol-aware range gate in analyze command and CLAUDE.md`

---

## Part 3 — Grow the fixture corpus (procedural)

Not a code task — this is the ongoing capture work, made cheap by Part 1. Reaching ~10 is paced by real market states (tension #1).

### Task 3.1: Capture coverage gaps

- [ ] **Step 1: See the gaps**

Run: `npm run fixture:coverage`. Note which of the 7 target cells are empty.

- [ ] **Step 2: Capture, live, as states occur**

During upcoming NY sessions, when the chart is in a target state, run:
`npm run fixture:new -- <label>` (e.g. `ny-open-trend-aplus`, `ny-open-no-trade`). One command captures the bundle and scaffolds the expected.md.

- [ ] **Step 3: Hand-grade each new fixture**

Fill the scaffolded `tests/fixtures/NNN-<label>.expected.md` using `docs/strategy/trading-strategy-2026.md §7` and `docs/strategy/entry-models.md` (for the A+-per-model fixtures). Cite every price `<price> (<json.path>)`. The trader reviews/amends the grade — the expected files are the project's documented opinion, not Claude's.

- [ ] **Step 4: Verify and commit each fixture**

Run: `npm run smoke:fixtures` (must pass) and `npm run fixture:coverage` (confirm the cell is now filled). Commit each fixture pair: `test: add fixture NNN-<label> (<cell>)`.

- [ ] **Step 5: Calibrate other symbols (links Part 2)**

When a fixture for a non-MNQ symbol is graded and you know that symbol's typical 1m range, add it to `RANGE_MIN_BY_SYMBOL` in `cli/lib/pillar2-thresholds.js` and extend `tests/pillar2-thresholds.test.js`. Commit: `feat: calibrate Pillar 2 range threshold for <symbol>`.

- [ ] **Step 6: Stop at ~10 with the 7 cells filled**

`npm run fixture:coverage` should report `7/7 target cells filled` and ~10 fixtures. That unblocks Part 4.

> **Note on replay:** post-cutoff historical sessions can be captured faster via TradingView replay instead of waiting live. The CLI's replay surface is in `@tvmcp/core/replay`; confirm the exact `./bin/tv` replay subcommands with `./bin/tv --help` before using — do not assume the command names. Constraint #10 still applies: replay only post-cutoff dates.

---

## Part 4 — LLM-as-judge for semantic regression

**Gated on Part 3** (corpus ~10). Adds a semantic check alongside the deterministic `smoke:fixtures`: does a fresh read of a bundle still agree with its golden `expected.md` after a prompt/model change?

### Task 4.1: Judge-report tally script

**Files:**
- Create: `scripts/judge-report.js`
- Test: `tests/judge-report.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/judge-report.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally, agreementPct } from '../scripts/judge-report.js';

test('tally counts verdicts per dimension', () => {
  const results = [
    { dimensions: { grade: 'agree', htf_bias: 'agree' } },
    { dimensions: { grade: 'disagree', htf_bias: 'partial' } },
  ];
  const t = tally(results);
  assert.deepEqual(t.grade, { agree: 1, partial: 0, disagree: 1 });
  assert.deepEqual(t.htf_bias, { agree: 1, partial: 1, disagree: 0 });
});

test('agreementPct scores partial as half credit', () => {
  assert.equal(agreementPct({ agree: 1, partial: 0, disagree: 1 }), 50);
  assert.equal(agreementPct({ agree: 1, partial: 1, disagree: 0 }), 75);
  assert.equal(agreementPct({ agree: 0, partial: 0, disagree: 0 }), null);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test tests/judge-report.test.js`
Expected: FAIL — `Cannot find module '../scripts/judge-report.js'`.

- [ ] **Step 3: Implement `scripts/judge-report.js`**

```js
#!/usr/bin/env node
/**
 * judge-report.js — tallies the /judge slash command's categorical
 * verdicts into a per-dimension agreement report.
 *
 * Reads tests/fixtures/*.judge.json (written by /judge). Each file:
 *   { "fixture": "001-current",
 *     "dimensions": { "grade": "agree", "htf_bias": "partial", ... } }
 * verdict ∈ { agree, partial, disagree }.
 *
 * Usage: npm run judge:report
 * Exit code: 0 always (informational).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = 'tests/fixtures';

/** Count verdicts per dimension across all judge results. */
export function tally(judgeResults) {
  const dims = {};
  for (const r of judgeResults) {
    for (const [dim, verdict] of Object.entries(r?.dimensions || {})) {
      dims[dim] ??= { agree: 0, partial: 0, disagree: 0 };
      if (verdict in dims[dim]) dims[dim][verdict]++;
    }
  }
  return dims;
}

/** Agreement % for one dimension's counts; partial = half credit. null if empty. */
export function agreementPct(counts) {
  const total = counts.agree + counts.partial + counts.disagree;
  if (total === 0) return null;
  return Math.round(((counts.agree + counts.partial * 0.5) / total) * 100);
}

function main() {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.judge.json'));
  if (files.length === 0) {
    console.error('no *.judge.json files — run /judge first');
    process.exit(0);
  }
  const results = files.map((f) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')));
  const dims = tally(results);
  console.log(`Judge report — ${results.length} fixture(s)\n`);
  for (const [dim, counts] of Object.entries(dims)) {
    console.log(`  ${dim.padEnd(22)} ${agreementPct(counts)}%  ` +
      `(agree ${counts.agree} / partial ${counts.partial} / disagree ${counts.disagree})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test tests/judge-report.test.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Add the npm script and commit**

In `package.json` add `"judge:report": "node scripts/judge-report.js"`.
`git add scripts/judge-report.js tests/judge-report.test.js package.json`
Commit: `feat: add judge-report tally script`

### Task 4.2: The `/judge` slash command

**Files:**
- Create: `.claude/commands/judge.md`

Not unit-testable (it is an LLM procedure) — verified by running it against the corpus.

- [ ] **Step 1: Write `.claude/commands/judge.md`**

The command body must specify:
- **Argument:** a fixture id (`001`) or `all`.
- **Procedure, per fixture:**
  1. `Read tests/fixtures/NNN-label.bundle.json`. **Blind pass** — produce a fresh structured verdict from the bundle alone (grade, `pillar1.htf_bias`, `pillar2.verdict`, `pillar3.entry_model`, `pillar3.confirmation_status`, trade direction), applying the same strategy/rules as `analyze.md`. Do **not** read `expected.md` yet (avoids anchoring).
  2. `Read tests/fixtures/NNN-label.expected.md` — parse its trailing `json` block (the golden verdict).
  3. **Compare** the blind verdict against the golden, dimension by dimension. Each dimension gets a categorical verdict: `agree` (same enum value) / `partial` (adjacent, e.g. `A+` vs `B`, or same direction different strength) / `disagree`.
  4. `Write tests/fixtures/NNN-label.judge.json`: `{ "fixture": "NNN-label", "judged_at": "<iso>", "dimensions": { "grade": ..., "htf_bias": ..., "pillar2_verdict": ..., "entry_model": ..., "confirmation_status": ..., "trade_direction": ... }, "notes": "<one line per disagree>" }`.
- **Rules:** reuse `analyze.md`'s non-negotiables (cite-or-omit, no arithmetic, grade enum). The judge emits **only categorical** verdicts — never a numeric score (constraint #7; the score is computed by `judge-report.js`).
- **Chat output:** a one-line-per-fixture summary, then "Run `npm run judge:report` for the tally."

- [ ] **Step 2: Run it against the corpus**

Run `/judge all` in a Claude Code session, then `npm run judge:report`.
Expected: a `*.judge.json` per fixture; the report prints per-dimension agreement %.

- [ ] **Step 3: Commit**

`git add .claude/commands/judge.md`
Commit: `feat: add /judge semantic regression command`

- [ ] **Step 4: Document it**

In `CLAUDE.md`, add a "judge recipe" note and strike the "LLM-as-judge" line from "Next". Add a `.gitignore` entry for `tests/fixtures/*.judge.json` if these should not be committed (decision for the trader — they are regenerated each run; recommend gitignoring them). Commit: `docs: document the /judge recipe`.

---

## Self-Review

- **Spec coverage:** Item 1 (corpus) → Part 1 tooling + Part 3 procedure. Item 2 (symbol-aware Pillar 2) → Part 2. Item 3 (LLM-as-judge) → Part 4. All three covered.
- **Placeholder scan:** Part 3 is intentionally procedural (data collection needs the trader + live states — see tension #1); it has exact commands, no TODO-code. The replay note explicitly says to confirm command names rather than inventing them. No code placeholders elsewhere.
- **Type consistency:** `parseStructuredBlock`/`fixtureGrade`/`fixtureEntryModel`/`sessionBucket` (Task 1.1) and `nextFixtureId` (Task 1.2) all exported and consumed consistently. `pillar2Thresholds` returns `{ range_acceptable_min, symbol }` — `range_acceptable_min` used identically in Task 2.2. `tally`/`agreementPct` shapes match between `judge-report.js` and its test. The judge writes `dimensions` with the six keys `judge-report.js` tallies.
- **Open dependency:** Part 4's exact `partial` rubric may need tuning once 10 real fixtures exist — flagged in Task 4.2; acceptable, the structure is fixed and only the adjacency rule may be refined.
