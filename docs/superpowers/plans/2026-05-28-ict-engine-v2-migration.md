# ICT Engine V2 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update our parser + bundle to consume the ICT Engine V2 Pine indicator's schema so downstream consumers (walker engine, brief turn, citations) work against V2.

**Architecture:** Discovery-first. Tasks 1–3 capture V1's emit, load V2 on the chart, and document the schema diff. Tasks 4–9 update `cli/lib/ict-engine-parser.js` + `cli/lib/compute-engine-gates.js` based on that diff. Tasks 10–12 refresh fixtures, run smoke, open PR.

**Tech Stack:** Node ES modules, `node --test`, existing `./bin/tv analyze` CLI, existing `scripts/smoke-fixtures.js` harness, ICT Engine V2 Pine indicator (TradingView-side).

---

## File Structure

```
cli/lib/
  ict-engine-parser.js     [modify] — parse V2 schema rows + fields
  compute-engine-gates.js  [modify if needed] — surface new V2 fields in gates
docs/research/
  ict-engine-v2-schema.md  [create] — V1 vs V2 schema diff documentation
tests/fixtures/
  *.bundle.json            [refresh] — re-captured against V2 chart
  *.expected.md            [audit] — citation paths still resolve
scripts/
  verify-citations.js      [modify if needed] — handle any renamed fields
```

---

## Task 1: Branch setup

**Files:**
- Branch: `feat/ict-engine-v2-migration` (off `main`)

- [ ] **Step 1: Create feature branch from main**

Run: `git fetch origin main && git checkout -b feat/ict-engine-v2-migration origin/main`
Expected: `Switched to a new branch 'feat/ict-engine-v2-migration'`

Verify clean tree: `git status`
Expected: `nothing to commit, working tree clean`

---

## Task 2: Capture V1 baseline emit

**Files:**
- Create: `tests/migration/v1-baseline.bundle.json` (artifact, gitignored or committed for diff)

- [ ] **Step 1: Ensure chart has V1 ICT Engine loaded**

In TradingView (in-app webview), confirm the chart shows `ICT-ENGINE · 1.0` style label below the symbol. If the chart accidentally has V2 already, switch back to V1 for the baseline capture.

- [ ] **Step 2: Capture a full analyze bundle against V1**

Run: `./bin/tv analyze --out tests/migration/v1-baseline.bundle.json`
Expected: file written, ~120-150 KB. Bundle contains `engine.meta.schema: 1`.

- [ ] **Step 3: Snapshot the engine shape**

Run: `jq '.engine | keys, .engine.meta, (.engine.fvgs[0] // {}), (.engine.structures[0] // {}), (.engine.levels[0] // {}), .engine.quality' tests/migration/v1-baseline.bundle.json > tests/migration/v1-engine-shape.txt`
Expected: text file listing engine sub-keys, meta shape, and a representative row per type.

- [ ] **Step 4: Commit baseline**

```bash
git add tests/migration/v1-baseline.bundle.json tests/migration/v1-engine-shape.txt
git commit -m "$(cat <<'EOF'
test: capture ICT Engine V1 baseline for V2 migration

V1 bundle + per-row-type shape snapshot. Used as the structural diff target when V2 lands.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Load V2 + capture V2 emit

**Files:**
- Create: `tests/migration/v2-baseline.bundle.json`
- Create: `tests/migration/v2-engine-shape.txt`
- Create: `docs/research/ict-engine-v2-schema.md`

- [ ] **Step 1: Swap V1 for V2 in TradingView**

User-side step. In the in-app webview, open Indicators, remove `ICT Engine V1`, add `ICT Engine V2`. Wait 10s for chart to redraw with V2's emit visible.

- [ ] **Step 2: Capture V2 bundle**

Run: `./bin/tv analyze --out tests/migration/v2-baseline.bundle.json`
Expected: file written. May error or contain `engine: null` / sparse rows — that's the bug we're fixing.

- [ ] **Step 3: Snapshot V2 shape**

Run: `jq '.engine | keys, .engine.meta, (.engine.fvgs[0] // {}), (.engine.structures[0] // {}), (.engine.levels[0] // {}), .engine.quality, (.engine.swings[0] // {}), (.engine.sweeps[0] // {}), (.engine.bprs[0] // {}), (.engine.pools[0] // {})' tests/migration/v2-baseline.bundle.json > tests/migration/v2-engine-shape.txt`
Expected: text file showing V2's engine output.

- [ ] **Step 4: Inspect raw Pine output if engine block is empty**

If `engine` is null or empty rows, the parser silently dropped V2's rows. Capture raw Pine via:

Run: `./bin/tv data pine-tables --study-filter "ICT Engine" --verbose > tests/migration/v2-raw-pine.txt`
Expected: raw table rows V2 emits — these are what the parser needs to learn.

- [ ] **Step 5: Write schema diff document**

Create `docs/research/ict-engine-v2-schema.md`. Content template:

```markdown
# ICT Engine V1 → V2 Schema Diff

Captured 2026-05-28 from chart state immediately after V1→V2 swap.

## Schema marker
- V1: `engine.meta.schema = 1`
- V2: `engine.meta.schema = <observed value>`

## Row types
| Row type | V1 fields | V2 fields | Notes |
|---|---|---|---|
| `levels` | name, level, broken_swing_ms, confirmed_ms, displacement | <list V2 fields> | <renamed? added? removed?> |
| `fvgs` | <list> | <list> | |
| `structures` | <list> | <list> | |
| `swings` | <list> | <list> | |
| `sweeps` | <list> | <list> | |
| `bprs` | <list> | <list> | |
| `pools` | <list> | <list> | |
| `quality` | range_3h, has_chop, atr_14, atr_17 | <list> | |
| `meta` | <list> | <list> | |

## New row types in V2 (if any)
<list>

## Removed row types from V1 (if any)
<list>

## Field type changes
<list any V1-num that became V2-string or vice versa>

## Parser implications
- New row-type marker handlers needed
- Renamed-field mappings
- Type coercions
```

Fill in from the captured `v1-engine-shape.txt` and `v2-engine-shape.txt` + the raw Pine output if relevant.

- [ ] **Step 6: Commit diff doc + V2 artifacts**

```bash
git add tests/migration/v2-baseline.bundle.json tests/migration/v2-engine-shape.txt tests/migration/v2-raw-pine.txt docs/research/ict-engine-v2-schema.md
git commit -m "$(cat <<'EOF'
docs: capture ICT Engine V2 schema diff vs V1

V2 baseline bundle + raw Pine output + diff doc with row-by-row field mapping.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Failing parser test for V2 schema marker

**Files:**
- Modify: `tests/ict-engine-parser.test.js` (add V2 tests)
- Reference: `docs/research/ict-engine-v2-schema.md`

- [ ] **Step 1: Add failing test for V2 schema marker recognition**

Append to `tests/ict-engine-parser.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIctEngineTable } from '../cli/lib/ict-engine-parser.js';
import { readFileSync } from 'node:fs';

test('parser: V2 schema marker recognized', () => {
  const bundle = JSON.parse(readFileSync('tests/migration/v2-baseline.bundle.json', 'utf8'));
  const raw = bundle.indicators.find((i) => /ICT Engine/i.test(i.name))?.values?.tables?.[0];
  assert.ok(raw, 'expected ICT Engine table in indicators');
  const parsed = parseIctEngineTable(raw);
  assert.equal(parsed.meta.schema, 2, 'schema must read as 2 from V2 emit');
  assert.equal(parsed.meta.schema_supported, true);
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `node --test tests/ict-engine-parser.test.js`
Expected: FAIL — current parser sees `schema=2` as unsupported, returns `schema_supported: false`.

- [ ] **Step 3: Commit failing test**

```bash
git add tests/ict-engine-parser.test.js
git commit -m "$(cat <<'EOF'
test: failing test for V2 schema marker recognition

Parser must accept engine.meta.schema=2 alongside =1. Currently rejects.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update parser to accept V2 schema marker

**Files:**
- Modify: `cli/lib/ict-engine-parser.js`

- [ ] **Step 1: Find the schema check**

Run: `grep -n "schema_supported\|schema ===\|schema !==" cli/lib/ict-engine-parser.js`
Expected: a line like `out.schema_supported = (out.meta.schema === 1)` or similar.

- [ ] **Step 2: Widen the supported set**

Edit the line found above to accept both schemas:

```javascript
// Was: out.meta.schema_supported = (out.meta.schema === 1);
out.meta.schema_supported = (out.meta.schema === 1 || out.meta.schema === 2);
```

- [ ] **Step 3: Run the test, verify PASS**

Run: `node --test tests/ict-engine-parser.test.js`
Expected: PASS.

- [ ] **Step 4: Run full unit suite**

Run: `npm run test:unit`
Expected: all pass (no regression).

- [ ] **Step 5: Commit**

```bash
git add cli/lib/ict-engine-parser.js
git commit -m "$(cat <<'EOF'
feat(parser): accept ICT Engine V2 schema marker (schema=2)

Parser now treats schema=1 OR schema=2 as supported. V2 row handlers added in subsequent tasks.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: V2 row-type handlers per diff doc

**Files:**
- Modify: `cli/lib/ict-engine-parser.js`
- Modify: `tests/ict-engine-parser.test.js`
- Reference: `docs/research/ict-engine-v2-schema.md`

This task is repeated once per row type that V2 changed. For each row type from the diff doc:

- [ ] **Step 1: Write a failing test capturing the V2 row's parsed shape**

For each row type identified in the schema diff (`levels`, `fvgs`, `structures`, etc.), append a test that asserts the parsed row has all expected V2 fields with correct types. Use a representative V2 row pulled from `v2-baseline.bundle.json`.

Pattern (replace `<row_type>` and `<fields>` with the actual diff content):

```javascript
test('parser: V2 <row_type> rows have <new_field>', () => {
  const bundle = JSON.parse(readFileSync('tests/migration/v2-baseline.bundle.json', 'utf8'));
  const raw = bundle.indicators.find((i) => /ICT Engine/i.test(i.name)).values.tables[0];
  const parsed = parseIctEngineTable(raw);
  const row = parsed.<row_type>[0];
  assert.ok(row, 'expected at least one <row_type> row from V2 emit');
  assert.equal(typeof row.<new_field_a>, '<type>');
  assert.equal(typeof row.<new_field_b>, '<type>');
});
```

- [ ] **Step 2: Run, verify FAIL** (parser drops or mistypes the new field).

- [ ] **Step 3: Implement V2 handler**

In `cli/lib/ict-engine-parser.js`, locate the `levels` / `fvgs` / `structures` / etc. row handler. Add V2-specific field parsing inside a `schema === 2` branch:

```javascript
// Inside parseRow() or the row-type dispatch
if (out.meta.schema === 2 && type === '<row_type>') {
  out.<row_type>.push({
    // V1 fields (carry forward)
    name: fields.name,
    level: numOrNull(fields.level),
    // V2-new fields
    <new_field_a>: numOrNull(fields.<new_field_a>),
    <new_field_b>: String(fields.<new_field_b> ?? ''),
  });
  return;
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit per row type**

```bash
git add cli/lib/ict-engine-parser.js tests/ict-engine-parser.test.js
git commit -m "$(cat <<'EOF'
feat(parser): V2 <row_type> handler

Per schema diff (docs/research/ict-engine-v2-schema.md): V2's <row_type> rows carry <new_fields>. Parser now populates them on schema=2 bundles.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

Repeat for each row type whose schema changed between V1 and V2.

---

## Task 7: Surface V2-new fields in compute-engine-gates.js

**Files:**
- Modify: `cli/lib/compute-engine-gates.js`
- Reference: `docs/research/ict-engine-v2-schema.md`

- [ ] **Step 1: For each V2-new field that should reach `gates.engine.*`, identify the gate path**

Read `docs/research/ict-engine-v2-schema.md`. For each new V2 field, decide:
- Is it gate-worthy (consumers will want it)? Yes → add to gates output.
- Is it purely internal? No → leave in `engine.*` only, don't promote.

- [ ] **Step 2: Write a failing test asserting the new gate field**

In `tests/compute-engine-gates.test.js`, add a test that runs `computeEngineGates` against the V2 fixture and asserts the new field is on the gates path.

```javascript
test('gates: V2 <new_field> surfaces under engine.<gate_path>', () => {
  const bundle = JSON.parse(readFileSync('tests/migration/v2-baseline.bundle.json', 'utf8'));
  const gates = computeEngineGates(bundle);
  assert.equal(typeof gates.engine.<gate_path>.<new_field>, '<type>');
});
```

- [ ] **Step 3: Run, verify FAIL.**

- [ ] **Step 4: Add gate emission**

In `compute-engine-gates.js`, wherever the corresponding row is read, also copy the new field into the gates output. Keep V1 behaviour intact (no field on V1 bundles).

- [ ] **Step 5: Run, verify PASS.**

- [ ] **Step 6: Commit per field set**

```bash
git add cli/lib/compute-engine-gates.js tests/compute-engine-gates.test.js
git commit -m "$(cat <<'EOF'
feat(gates): surface V2 <new_field> at engine.<gate_path>

Allows walker engine + brief turn to consume V2-new evidence without re-parsing the raw indicator.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Bump schema in engine.meta + ensure consumers don't break

**Files:**
- Modify: `cli/lib/compute-engine-gates.js` (if it sets `engine.meta.schema`)
- Modify: `cli/lib/ict-engine-parser.js` (if applicable)

- [ ] **Step 1: Confirm `engine.meta.schema = 2` shows up in the bundle for V2 captures**

Run: `./bin/tv analyze --out /tmp/v2-check.json && jq '.engine.meta.schema, .engine.meta.schema_supported' /tmp/v2-check.json`
Expected: `2` and `true`.

- [ ] **Step 2: Run smoke fixtures to confirm V1 fixtures (still in `tests/fixtures/`) parse cleanly with new parser**

Run: `npm run smoke:fixtures`
Expected: PASS — existing V1 fixtures continue to parse + cite cleanly because the V2 branches are gated on `schema === 2`.

- [ ] **Step 3: Commit if any consumer-side coercion needed**

If a downstream consumer (e.g., a renderer expecting V1-only field names) breaks, fix and commit. Otherwise skip the commit.

---

## Task 9: Refresh tests/fixtures against V2 chart

**Files:**
- Modify: each `tests/fixtures/*.bundle.json` file
- Audit: corresponding `*.expected.md` files

- [ ] **Step 1: List existing fixtures**

Run: `ls tests/fixtures/*.bundle.json`
Expected: list of paired fixtures (e.g., `001-current.bundle.json`).

- [ ] **Step 2: For each fixture, re-capture against V2**

For fixture `NNN-<label>`:
1. Ensure chart is at the symbol + timeframe + replay state the fixture intended (note: `expected.md` describes the original conditions — match them).
2. Run: `./bin/tv analyze --out tests/fixtures/NNN-<label>.bundle.json --overwrite`
3. Diff: `git diff tests/fixtures/NNN-<label>.bundle.json | head -50` — sanity check the schema changed but the substantive levels/zones are in similar positions.

- [ ] **Step 3: Run citation verifier against each refreshed fixture**

Run: `npm run smoke:fixtures`
Expected: each fixture's `expected.md` cited paths still resolve in the V2 bundle. If a citation now points at a renamed field, FAIL.

- [ ] **Step 4: For any failed fixture, update `expected.md` citations to match V2 paths**

Find the V2 equivalent of any V1 citation path. Update `expected.md` accordingly. Do NOT change the analysis prose or verdict — only the JSON paths in citations.

- [ ] **Step 5: Re-run, verify all PASS**

Run: `npm run smoke:fixtures`
Expected: all fixtures PASS.

- [ ] **Step 6: Commit fixture refresh**

```bash
git add tests/fixtures/
git commit -m "$(cat <<'EOF'
test(fixtures): refresh paired fixtures against ICT Engine V2

Bundles re-captured against V2-loaded chart. Citation paths updated where V2 renamed a field. No verdicts changed.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Verify citation paths in scripts/verify-citations.js

**Files:**
- Inspect: `scripts/verify-citations.js`

- [ ] **Step 1: Run the verifier against every fixture**

Run: `node scripts/verify-citations.js tests/fixtures/*.expected.md`
Expected: 0 errors. If any errors, walk back to Task 9 step 4 for the affected fixture.

- [ ] **Step 2: If the verifier script itself needed an update**

Only if a deep path-resolution rule changed (e.g., V2 uses arrays where V1 used objects), patch the verifier. Otherwise skip.

---

## Task 11: Manual smoke test end-to-end

- [ ] **Step 1: Restart Electron**

Run: `npm run dev` (in `app/` directory).

- [ ] **Step 2: Confirm boot — verify the engine bundle is V2-shape**

In the Electron app, open the chart. Wait for the bar-close detector heartbeat to fire (~60s). Open the dev tools console.

Run: `await window.api.status.lastBar()` (or equivalent) — expect a sane response.

Open a terminal: `./bin/tv analyze --out /tmp/smoke.json && jq '.engine.meta.schema, .engine.levels | length, .engine.fvgs | length, .engine.structures | length, .engine.quality' /tmp/smoke.json`
Expected: schema=2, non-zero counts for levels/fvgs/structures, non-null quality.

- [ ] **Step 3: Manually fire a brief turn**

In the app's CLAUDE popover, type "run brief" (or trigger via PREP panel's RUN BRIEF NOW button). Watch the activity stream — turn should complete without parse errors.

- [ ] **Step 4: Read the resulting brief**

Open the PREP popover. Confirm:
- HTF bias displays
- Levels populated
- No "engine missing" or "schema unsupported" warnings

- [ ] **Step 5: Document smoke result**

If clean, no commit. If issues, walk back to whichever task introduced the problem.

---

## Task 12: Document V2 in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` — add a line in the "decision log" table for the V2 migration

- [ ] **Step 1: Append a decision-log row**

Open `CLAUDE.md`, find the architecture decisions table. Append a row dated 2026-05-28:

```markdown
| 2026-05-28 | ICT Engine V2 parser migration | Parser updated to recognize `engine.meta.schema=2`. V2 schema diff documented at `docs/research/ict-engine-v2-schema.md`. Existing V1-shape consumer code remains correct; V2-new fields surfaced at `gates.engine.<path>.<field>` for downstream consumers (walker engine, brief turn). User must load `ICT Engine V2` indicator in TradingView before next session. Fixtures refreshed; citations resolve. Spec: [docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md](docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md). Plan: [docs/superpowers/plans/2026-05-28-ict-engine-v2-migration.md](docs/superpowers/plans/2026-05-28-ict-engine-v2-migration.md). |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude.md): record ICT Engine V2 migration decision

Closes PR0 of the walker-engine spec. V2 is now the supported schema; V1 still parses for back-compat.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Push branch + open PR

- [ ] **Step 1: Push**

Run: `git push -u origin feat/ict-engine-v2-migration`
Expected: branch pushed.

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: ICT Engine V2 parser migration (PR0 of walker-engine spec)" --body "$(cat <<'EOF'
## Summary
- Parser accepts `engine.meta.schema=2` alongside `=1`
- V2 row-type handlers added per `docs/research/ict-engine-v2-schema.md`
- New V2 fields surfaced at `gates.engine.<path>.<field>`
- Fixtures refreshed against V2; citations resolve
- User must load `ICT Engine V2` in TradingView before next session

## Test plan
- [ ] `npm run test:unit` clean
- [ ] `npm run smoke:fixtures` clean
- [ ] Manual smoke: Electron boots, bar-close emits, brief turn completes
- [ ] PREP panel renders HTF bias + levels with no schema warnings

Closes PR0 of [docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md](https://github.com/ghxstofnq/claude-tradingview-analyser/blob/feat/ict-engine-v2-migration/docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md). PR1 (walker engine) depends on this.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done criteria

- All tests pass: `npm run test:unit` + `npm run smoke:fixtures`
- Manual smoke: V2 bundle reports schema=2, brief turn completes against V2, PREP renders
- Branch pushed, PR opened
- CLAUDE.md decision row appended
