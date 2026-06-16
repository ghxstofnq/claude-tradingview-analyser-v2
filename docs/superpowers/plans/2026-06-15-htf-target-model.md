# HTF Target Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add HTF (1H/4H) swing highs/lows, opposing-FVG fills (edge chosen by distance/R:R), and a per-instrument psych round-level fallback to the deterministic target pool, so TP1/TP2 reflect the real HTF draw (§7 Step 7).

**Architecture:** Two new pure modules (psych grid + HTF target extraction) feed a new `context.htfTargets`; `execution-packet.js`'s `targetPool`/`selectTp1`/`selectTp2` merge them with the existing intraday pool and fall back to psych levels when overhead is empty. Same code path for live and backtest.

**Tech stack:** ES modules, `node --test`. Pure functions so no Electron/CDP in tests.

**Spec:** [docs/superpowers/specs/2026-06-15-htf-target-model-design.md](2026-06-15-htf-target-model-design.md). Defaults locked by user 2026-06-15: reuse existing R-floors; TP2 tie-break = nearest clearing runner R.

---

### Task 1: Per-instrument psych grid

**Files:**
- Create: `app/main/strategy/walkers/psych-levels.js`
- Test: `tests/psych-levels.test.js`

- [ ] **Step 1 — failing test** (`tests/psych-levels.test.js`):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { psychGridFor, psychLevelsAbove, psychLevelsBelow } from "../app/main/strategy/walkers/psych-levels.js";

test("psychGridFor — per-instrument minor/major; uncalibrated → null", () => {
  assert.deepEqual(psychGridFor("MNQ1!"), { minor: 50, major: 100 });
  assert.deepEqual(psychGridFor("MES1!"), { minor: 5, major: 10 });
  assert.equal(psychGridFor("CL1!"), null);
});

test("psychLevelsAbove — minor-grid levels strictly above price, ascending, tagged", () => {
  const v = psychLevelsAbove("MNQ1!", 31090, 3);
  assert.deepEqual(v.map((x) => x.price), [31100, 31150, 31200]);
  assert.equal(v[0].grid, "minor");
  assert.equal(v.find((x) => x.price % 100 === 0).grid, "major"); // 31100,31200 are also major
  assert.equal(v[0].source, "psych");
});

test("psychLevelsBelow — strictly below, descending", () => {
  const v = psychLevelsBelow("MES1!", 7207, 2);
  assert.deepEqual(v.map((x) => x.price), [7205, 7200]);
});

test("uncalibrated symbol → empty", () => {
  assert.deepEqual(psychLevelsAbove("CL1!", 100, 3), []);
});
```

- [ ] **Step 2 — run, expect fail** (`node --test tests/psych-levels.test.js` → module not found).

- [ ] **Step 3 — implement** (`app/main/strategy/walkers/psych-levels.js`):

```js
// Per-instrument psychological round-level grid. NQ family steps 50/100;
// ES family 5/10 (≈1/10th, scaling with price). Uncalibrated symbols → null
// (mirrors pillar2-thresholds' "don't guess" posture). User ruling 2026-06-15.
const GRIDS = {
  "MNQ1!": { minor: 50, major: 100 },
  "NQ1!":  { minor: 50, major: 100 },
  "MES1!": { minor: 5,  major: 10 },
  "ES1!":  { minor: 5,  major: 10 },
};

export function psychGridFor(symbol) {
  return GRIDS[String(symbol ?? "").toUpperCase()] ?? null;
}

function tag(price, grid) {
  return { price, source: "psych", grid: price % grid.major === 0 ? "major" : "minor" };
}

export function psychLevelsAbove(symbol, price, count = 4) {
  const grid = psychGridFor(symbol);
  if (!grid || !Number.isFinite(price)) return [];
  const out = [];
  let lvl = Math.floor(price / grid.minor) * grid.minor;
  while (out.length < count) {
    lvl += grid.minor;
    if (lvl > price) out.push(tag(lvl, grid));
  }
  return out;
}

export function psychLevelsBelow(symbol, price, count = 4) {
  const grid = psychGridFor(symbol);
  if (!grid || !Number.isFinite(price)) return [];
  const out = [];
  let lvl = Math.ceil(price / grid.minor) * grid.minor;
  while (out.length < count) {
    lvl -= grid.minor;
    if (lvl < price) out.push(tag(lvl, grid));
  }
  return out;
}
```

- [ ] **Step 4 — run, expect pass.**
- [ ] **Step 5 — commit:** `git add app/main/strategy/walkers/psych-levels.js tests/psych-levels.test.js && git commit` (`feat(strategy): per-instrument psych-level grid`).

---

### Task 2: HTF target extraction (swings + opposing-FVG edges)

**Files:**
- Create: `app/main/strategy/walkers/htf-targets.js`
- Test: `tests/htf-targets.test.js`

`extractHtfTargets(engineByTf, { price })` → `{ above: [...], below: [...] }`, each candidate `{ price, source: 'htf_swing'|'fvg_fill', tf, edge?, name, cite }`. Swings: `engine_by_tf.h1/h4.structures` where `is_high` (above) / `!is_high` (below), unswept. Opposing FVGs: for `above`, bearish FVGs (`dir==='bear'`) not filled → 3 rows (near/CE/far edge). Bull FVG geometry: top/bottom + `ce` (engine emits `ce`; fall back to midpoint).

- [ ] **Step 1 — failing test** (`tests/htf-targets.test.js`):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHtfTargets, fvgEdges } from "../app/main/strategy/walkers/htf-targets.js";

test("fvgEdges — bearish FVG above expands to near/CE/far (ascending for a long approach)", () => {
  const e = fvgEdges({ top: 31000, bottom: 30900, ce: 30950, dir: "bear" }, "above");
  assert.deepEqual(e.map((x) => [x.edge, x.price]), [["near", 30900], ["ce", 30950], ["far", 31000]]);
});

test("extractHtfTargets — HTF swing highs (unswept) + bearish FVG fills above price", () => {
  const engineByTf = {
    h4: {
      structures: [
        { level: 30896, is_high: true, swept: false },
        { level: 30700, is_high: true, swept: true },   // swept → excluded
        { level: 30500, is_high: false, swept: false },  // a low → goes below
      ],
      fvgs: [
        { top: 31000, bottom: 30900, ce: 30950, dir: "bear", state: "fresh" }, // opposing for a long
        { top: 30600, bottom: 30550, ce: 30575, dir: "bull", state: "fresh" }, // same-dir → not an above target
      ],
    },
    h1: { structures: [], fvgs: [] },
  };
  const { above, below } = extractHtfTargets(engineByTf, { price: 30750 });
  const ap = above.map((t) => t.price).sort((a, b) => a - b);
  assert.ok(ap.includes(30896));            // unswept 4H swing high
  assert.ok(ap.includes(30900) && ap.includes(30950) && ap.includes(31000)); // bearish FVG edges
  assert.ok(!ap.includes(30700));           // swept swing excluded
  assert.ok(below.some((t) => t.price === 30500)); // 4H swing low below
});

test("filled FVG excluded", () => {
  const eByTf = { h4: { structures: [], fvgs: [{ top: 31000, bottom: 30900, ce: 30950, dir: "bear", state: "filled" }] }, h1: {} };
  assert.equal(extractHtfTargets(eByTf, { price: 30750 }).above.length, 0);
});
```

- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement** (`app/main/strategy/walkers/htf-targets.js`):

```js
// Extract HTF (1H/4H) draw targets from engine_by_tf: unswept swing highs/lows
// + opposing-FVG fills (bearish gaps above / bullish gaps below), each gap
// expanded to near/CE/far candidate prices. Pure; side filtering happens in
// the packet builder. Strategy §2.1 + §7 Step 7. unfilled/unswept only.
const HTF_TFS = ["h1", "h4"];
const FILLED = new Set(["filled", "mitigated", "inverted"]);

export function fvgEdges(fvg, side) {
  const top = Number(fvg.top), bottom = Number(fvg.bottom);
  const ce = Number.isFinite(Number(fvg.ce)) ? Number(fvg.ce) : (top + bottom) / 2;
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return [];
  // For a long approaching a bearish gap above: near = bottom (proximal),
  // far = top (full fill). For a short approaching a bullish gap below:
  // near = top, far = bottom. CE is the midpoint either way.
  const near = side === "above" ? bottom : top;
  const far = side === "above" ? top : bottom;
  return [
    { edge: "near", price: near },
    { edge: "ce", price: ce },
    { edge: "far", price: far },
  ].map((e) => ({ ...e, source: "fvg_fill" }));
}

export function extractHtfTargets(engineByTf = {}, { price } = {}) {
  const above = [], below = [];
  if (!Number.isFinite(price)) return { above, below };
  for (const tf of HTF_TFS) {
    const eng = engineByTf?.[tf] ?? {};
    for (const s of eng.structures ?? []) {
      if (s?.swept === true) continue;
      const lvl = Number(s?.level);
      if (!Number.isFinite(lvl)) continue;
      const cite = `engine_by_tf.${tf}.structures`;
      if (s.is_high && lvl > price) above.push({ price: lvl, source: "htf_swing", tf, name: s.name ?? `${tf}_swing_high`, cite });
      if (!s.is_high && lvl < price) below.push({ price: lvl, source: "htf_swing", tf, name: s.name ?? `${tf}_swing_low`, cite });
    }
    for (const f of eng.fvgs ?? []) {
      if (FILLED.has(String(f?.state ?? ""))) continue;
      const dir = String(f?.dir ?? "");
      const cite = `engine_by_tf.${tf}.fvgs`;
      // Opposing gap above for a long = bearish; below for a short = bullish.
      if (dir === "bear" && Number(f.bottom) > price) {
        for (const e of fvgEdges(f, "above")) above.push({ ...e, tf, name: `${tf}_bear_fvg`, cite });
      }
      if (dir === "bull" && Number(f.top) < price) {
        for (const e of fvgEdges(f, "below")) below.push({ ...e, tf, name: `${tf}_bull_fvg`, cite });
      }
    }
  }
  return { above, below };
}
```

- [ ] **Step 4 — run, expect pass.**
- [ ] **Step 5 — commit** (`feat(strategy): extract HTF swing + opposing-FVG targets`).

---

### Task 3: Thread HTF targets into the strategy context

**Files:**
- Modify: `app/main/bar-close.js` (`buildStrategyBundleForRuntime`, ~line 1155)
- Modify: `app/main/strategy/context/build-strategy-context.js` (`buildPillar1`, ~line 46)
- Test: `tests/htf-targets.test.js` (extend) or `tests/strategy/context/*.test.js`

- [ ] **Step 1 — failing test** (extend `tests/htf-targets.test.js`): assert that given a bundle with `engine_by_tf`, `buildStrategyContext` exposes `context.pillar1.htfTargets.{above,below}`. (Import `buildStrategyContext`; construct a minimal valid bundle with `market/session/engine/engine_by_tf`.)

- [ ] **Step 2 — run, expect fail.**

- [ ] **Step 3 — implement:**

In `buildStrategyBundleForRuntime` (bar-close.js), after the `engine.pillar1` assignment, add (price from `bundle.quote?.last`):

```js
  // HTF draw targets (1H/4H swings + opposing-FVG fills) — fed from the
  // multi-TF engine carried by the baseline-merged scan. Null on slim polls
  // (engine_by_tf absent); the packet builder treats absence as "no HTF pool".
  engine.pillar1.htfTargets = bundle.engine_by_tf
    ? extractHtfTargets(bundle.engine_by_tf, { price: bundle.quote?.last ?? null })
    : { above: [], below: [] };
```

Add the import at top of bar-close.js: `import { extractHtfTargets } from "./strategy/walkers/htf-targets.js";`

In `build-strategy-context.js` `buildPillar1`, thread it through:

```js
    untakenTargets: p1.untakenTargets ?? lockedP1.untakenTargets ?? { above: [], below: [] },
    htfTargets: p1.htfTargets ?? { above: [], below: [] },
```

- [ ] **Step 4 — run, expect pass.** Also run the existing context suite: `node --test tests/strategy/context/*.test.js`.
- [ ] **Step 5 — commit** (`feat(strategy): expose context.pillar1.htfTargets`).

---

### Task 4: Merge HTF + psych into the target pool and TP1/TP2 selection

**Files:**
- Modify: `app/main/strategy/walkers/execution-packet.js` (`targetPool` ~33, `validTargets` ~294, `selectTp1` ~319, `selectTp2` ~334)
- Test: `tests/execution-packet-targets.test.js` (new)

- [ ] **Step 1 — failing test** (`tests/execution-packet-targets.test.js`): build a `context` with intraday + htfTargets + (separately) empty-overhead, call the exported selection (expose `selectTp1`/`selectTp2`/`targetPool` via an `export const __test`), assert:
  - HTF 4H swing becomes TP2 when a nearer intraday swing is TP1.
  - Opposing-FVG near edge = TP1 / far edge = TP2 when the gap is the only nearby draw.
  - When all pools empty above entry → psych minor = TP1, major = TP2 (MNQ).
  - TP2 strictly beyond TP1; TP1 clears ~1.5R.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { __test } from "../app/main/strategy/walkers/execution-packet.js";
const { targetPool, selectTp1, selectTp2 } = __test;

const ctx = (over) => ({ market: "MNQ1!", pillar1: { untakenTargets: { above: [], below: [] }, htfTargets: { above: [], below: [] } }, pillar3: { structuralStops: [] }, ...over });

test("HTF 4H swing is TP2 behind a nearer 1m swing TP1 (long)", () => {
  const c = ctx({
    pillar3: { structuralStops: [{ kind: "swing_high", price: 30800, swept: false }] },
    pillar1: { untakenTargets: { above: [], below: [] }, htfTargets: { above: [{ price: 30896, source: "htf_swing", tf: "h4" }], below: [] } },
  });
  const tp1 = selectTp1(c, "long", 30727.75, 30688.75);
  const tp2 = selectTp2(c, "long", 30727.75, 30688.75, tp1.price);
  assert.equal(tp1.price, 30800);
  assert.equal(tp2.price, 30896);
});

test("psych fallback when overhead empty (MNQ 50/100)", () => {
  const c = ctx({});            // no intraday, no htf
  const tp1 = selectTp1(c, "long", 31090, 31070);   // risk 20
  const tp2 = selectTp2(c, "long", 31090, 31070, tp1.price);
  assert.equal(tp1.price % 50, 0);
  assert.equal(tp2.price % 100, 0);
  assert.ok(tp2.price > tp1.price);
});
```

- [ ] **Step 2 — run, expect fail.**

- [ ] **Step 3 — implement.** Replace `targetPool` to merge htfTargets and expand nothing here (FVG edges already expanded in Task 2); add a psych fallback inside `validTargets`; keep `selectTp1`/`selectTp2` logic but source from the wider pool. Concretely:

```js
function targetPool(context, side) {
  const targets = context?.pillar1?.untakenTargets ?? {};
  const htf = context?.pillar1?.htfTargets ?? {};
  const dirKey = side === "long" ? "above" : "below";
  const levels = (targets[dirKey] ?? []).map((t) => ({ ...t, target_class: "level" }));
  const htfRows = (htf[dirKey] ?? []).map((t) => ({
    ...t,
    // FVG fills + HTF swings are HTF-draw class; FVG edges keep their `edge`.
    target_class: t.source === "fvg_fill" ? "fvg" : "htf",
  }));
  const kinds = INTRADAY_TARGET_KINDS[side] ?? new Set();
  const pivots = (context?.pillar3?.structuralStops ?? context?.pillar3?.structural_stops ?? [])
    .filter((s) => kinds.has(String(s?.kind ?? "")) && s?.swept !== true)
    .map((s) => ({ ...s, name: s.name ?? s.kind, target_class: "intraday" }));
  return [...levels, ...htfRows, ...pivots];
}
```

Add a psych fallback used by `validTargets`:

```js
function psychFallback(context, side, entry) {
  const sym = context?.market;
  const lvls = side === "long" ? psychLevelsAbove(sym, entry, 4) : psychLevelsBelow(sym, entry, 4);
  return lvls.map((l) => ({ ...l, name: `psych_${l.grid}`, target_class: "psych", cite: "psych_grid" }));
}

function validTargets(context, side, entry, stop) {
  let pool = targetPool(context, side);
  let valid = pool
    .map((t) => ({ ...t, price: numberOrNull(t?.price ?? t?.level) }))
    .filter((t) => t.price != null && targetIsCorrectSide(t, entry, side))
    .map((t) => ({ ...t, rMultiple: computeRMultiple({ entry, stop, target: t.price }) }))
    .filter((t) => t.rMultiple != null);
  if (valid.length === 0) {           // empty overhead → price discovery
    valid = psychFallback(context, side, entry)
      .filter((t) => targetIsCorrectSide(t, entry, side))
      .map((t) => ({ ...t, rMultiple: computeRMultiple({ entry, stop, target: t.price }) }))
      .filter((t) => t.rMultiple != null);
  }
  return valid.sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
}
```

Update `selectTp1` (TP1 = nearest clearing floor; intraday swing ≥2R preferred, else level/htf/psych ≥1.5R; weekly excluded; for a `fvg`-class TP1 the near/CE/far rows are already distinct candidates so the floor naturally picks the shallowest that clears it):

```js
function selectTp1(context, side, entry, stop) {
  const all = validTargets(context, side, entry, stop).filter((t) => !isWeeklyDraw(t));
  const candidates = all.length ? all : validTargets(context, side, entry, stop);
  const swing = candidates.find((t) => t.target_class === "intraday" && t.rMultiple >= 2.0);
  if (swing) return swing;
  const floored = candidates.find((t) => t.rMultiple >= 1.5);   // nearest level/htf/fvg/psych ≥1.5R
  return floored ?? candidates[0] ?? null;
}
```

`selectTp2`: nearest beyond TP1 preferring the HTF draw (user tie-break = nearest clearing runner R), **except** when TP1 is itself an FVG edge — then TP2 must be that same gap's **far edge** (full fill), per the spec's "near → far off one gap." To match the same gap, tag each FVG edge with a `zone` id in `fvgEdges` (`zone: \`${bottom}-${top}\``) so the rows are linkable:

```js
function selectTp2(context, side, entry, stop, tp1) {
  const tp1Price = tp1?.price ?? tp1;          // accept the TP1 row or a bare price
  if (tp1Price == null) return null;
  const beyond = validTargets(context, side, entry, stop)
    .filter((t) => Math.abs(t.price - entry) > Math.abs(tp1Price - entry));
  // Same-gap full fill: if TP1 is an FVG edge, TP2 = that gap's far edge.
  if (tp1?.target_class === "fvg" && tp1?.zone) {
    const farSame = beyond.find((t) => t.target_class === "fvg" && t.zone === tp1.zone && t.edge === "far");
    if (farSame) return farSame;
  }
  // Else prefer the HTF draw (htf swing / fvg full-fill / session level); else nearest beyond.
  return beyond.find((t) => t.target_class === "htf" || t.target_class === "fvg" || t.target_class === "level")
    ?? beyond[0] ?? null;
}
```

`selectTp1` returns the full candidate **row** (not just a price) so `selectTp2` can read `tp1.zone`/`tp1.target_class`; callers that pass `tp1Price` still work via the `?? tp1` fallback. Add `zone` to each row in `fvgEdges`: `{ ...e, source: "fvg_fill", zone: \`${bottom}-${top}\` }`.

Add imports at top of `execution-packet.js`:
`import { psychLevelsAbove, psychLevelsBelow } from "./psych-levels.js";`
and an `export const __test = { targetPool, selectTp1, selectTp2 };` at the bottom.

- [ ] **Step 4 — run, expect pass.**
- [ ] **Step 5 — commit** (`feat(strategy): HTF + psych targets in TP1/TP2 selection`).

---

### Task 5: Regression — today's run, replay corpus, tapes

**Files:** none new (verification only).

- [ ] **Step 1** — `GOFNQ_STATE_DIR=$(mktemp -d) node --test tests/*.test.js tests/strategy/**/*.test.js` — full suite green.
- [ ] **Step 2** — `npm run smoke:fixtures` — 22/22 (no bundle-shape change expected).
- [ ] **Step 3** — re-fold today's AM run with the new code: `node scripts/refold-run.js 20260615-205627-am-2026-06-15` (or `scripts/run-backtest-headless.js 2026-06-15 ny-am`). **Confirm** the A+ Inversion long now carries TP2 ≈ the 4H swing high (~30896) or the opposing-FVG fill — NOT tp1==tp2==30800.
- [ ] **Step 4** — `npm run replay` + `npm run tapes`. Any changed expectation = strategy behavior shift → present the diff to the user for hand sign-off before updating the frozen expectation (these gate live).
- [ ] **Step 5 — commit** any fixture/tape expectation updates separately (`test:`), with the sign-off noted in the message.

---

### Task 6: PR

- [ ] Push `feat/htf-target-model`; PR referencing the spec + plan; body notes it changes live + backtest targets, lists the regression evidence (today's run TP2 fixed, corpus deltas signed off).
