# Strategy Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the brief → open_reaction → entry_hunt → wrap phases into a precise, machine-readable chain so each phase emits structured handoffs the next mechanically consumes — plus add a slim `brief_digest` to the bundle so HTF data deep in the dual-symbol `pair` block is no longer unreachable.

**Architecture:** Three new pure helpers (`brief-digest`, `sizing`, `entry-model-priority`) compute structured outputs from the bundle / strategy spec / live state. The two existing surface tools (`surface_session_brief`, `surface_ltf_bias`) gain new Zod fields for the structured handoffs. `session-memory.writeBrief` re-renders `pillar1.md` / `pillar2.md` comparatively from per-symbol JSON. The analyze prompt gets four phase rewrites (`brief`, `open_reaction`, `entry_hunt`, new `catch_up`) plus a routing entry. The renderer surfaces a `chain_status` chip. Tests cover all three helpers + schema refinements + fixtures.

**Tech Stack:** Node 20 (ESM), `node:test` runner, Zod (already used by the SDK), Electron 32 main + React renderer, Chrome DevTools Protocol on port 9223 (existing).

**Spec:** [`docs/superpowers/specs/2026-05-26-strategy-chain-design.md`](../specs/2026-05-26-strategy-chain-design.md)

---

## File map

**Create:**
- `cli/lib/brief-digest.js` — pure function: bundle → slim per-symbol digest.
- `cli/lib/sizing.js` — pure function: `{day_of_week, grade, memory_overrides}` → `{r_size, factors, cites, override_reason}`.
- `cli/lib/entry-model-priority.js` — pure function: open-reaction inputs → `{priority, reason, cite}`.
- `docs/strategy/sizing-table.md` — canonical day×grade sizing table.
- `tests/brief-digest.test.js` — unit tests for digest builder.
- `tests/sizing.test.js` — unit tests for sizing helper.
- `tests/entry-model-priority.test.js` — unit tests for priority resolver.
- `tests/catch-up.test.js` — unit tests for catch-up detection.
- `tests/fixtures/004-brief-digest.bundle.json` — paired bundle with `brief_digest` field.
- `tests/fixtures/004-brief-digest.expected.md` — hand-graded expected reading.
- `tests/fixtures/005-divergent-ny-open.bundle.json` — bundle with HTF/LTF clash.
- `tests/fixtures/005-divergent-ny-open.expected.md` — expected divergent reading.

**Modify:**
- `cli/commands/analyze.js` — call `buildBriefDigest` + emit on bundle when `--pair`.
- `app/main/sdk.js` — `surface_session_brief` + `surface_ltf_bias` Zod additions.
- `app/main/tools/surface.js` — cross-validate `no_trade_reason` + `entry_model_priority`.
- `app/main/session-memory.js` — stash per-symbol payloads; `renderPillar1Md` / `renderPillar2Md` comparative.
- `app/main/prompts/analyze.md` — rewrite four phases + add `chain_status` rules.
- `.claude/commands/analyze.md` — mirror prompt changes.
- `app/main/bar-close.js` — route to `catch_up` phase when ltf-bias.md missing after 09:45 ET.
- `app/renderer/src/Prep.jsx` — render `chain_status` chip + `primary_draw` cite tooltip.
- `CLAUDE.md` — decision row + updated `analyze` recipe.
- `tests/brief-flow.test.js` — extend with `no_trade_reason` validation + comparative `pillar1.md` tests.

---

## Task 1: brief-digest pure builder — TDD

**Files:**
- Create: `cli/lib/brief-digest.js`
- Create: `tests/brief-digest.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/brief-digest.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBriefDigest } from '../cli/lib/brief-digest.js';

function sampleSymbolBundle() {
  return {
    bars_by_tf: {
      daily: { change_pct: '16.28%', range: 7034.5 },
      h4:    { change_pct: '7.07%',  range: 2380.75 },
      h1:    { change_pct: '3.27%',  range: 1199 },
    },
    engine_by_tf: {
      daily: {
        fvgs: [],
        bprs: [],
        structures: [{ event: 'mss', dir: 'bull', level: 26564.5, displacement: true, tier: 'swing', validation: 'break', confirmed_ms: 1776153600000 }],
        quality: { range_3h: null, range_quality: null, displacement: 'na', candle: 'normal', atr_14: null, atr_17: null },
      },
      h4: {
        fvgs: [
          { kind: 'fvg', dir: 'bull', top: 29800, bottom: 29760, ce: 29780, disp_score: 0.74, took_liq: true, state: 'fresh', size_quality: 'large', reacted: false, reaction_dir: 'none' },
          { kind: 'ifvg', dir: 'bull', top: 27350, bottom: 27301, ce: 27325, disp_score: 0.64, took_liq: false, state: 'invalidated', size_quality: 'tiny', reacted: true, reaction_dir: 'bull' },
        ],
        bprs: [{ dir: 'bull', top: 29774, bottom: 29769, took_liq: false, reacted: false, state: 'fresh' }],
        structures: [{ event: 'bos', dir: 'bull', level: 29783.75, displacement: true, tier: 'internal', validation: 'break', confirmed_ms: 1779788400000 }],
        quality: { range_3h: 71.5, range_quality: 'tight', displacement: 'acceptable', candle: 'doji_wick', atr_14: 180.25, atr_17: 188.75 },
      },
      h1: {
        fvgs: [],
        bprs: [],
        structures: [{ event: 'mss', dir: 'bear', level: 29888.75, displacement: false, tier: 'internal', validation: 'sweep', confirmed_ms: 1779836400000 }],
        quality: { range_3h: 156.5, range_quality: 'good', displacement: 'clean', candle: 'doji_wick', atr_14: 62, atr_17: 64.75 },
      },
    },
    gates: {
      engine: {
        pillar1: {
          session_levels: { PDH: { name: 'PDH', price: 29397, state: 'taken', swept: true }, AS_L: { name: 'AS_L', price: 29770.5, state: 'untaken', swept: false } },
          sweeps: [{ target: 'AS_L', price: 29770.5, side: 'sell', rejected: true, swept_ms: 1779832800000 }],
          untaken_pools_above: [{ kind: 'eqh', side: 'buy', price: 30000, swept: false }],
          untaken_pools_below: [],
        },
        pillar2: {
          current_tf: { range_3h: 71.5, range_quality: 'tight', displacement: 'acceptable', candle: 'doji_wick', atr_14: 180.25, atr_17: 188.75 },
          m5:  { range_3h: 40, range_quality: 'tight', displacement: 'weak', candle: 'normal' },
          m15: { range_3h: 110.75, range_quality: 'tight', displacement: 'weak', candle: 'doji_wick' },
        },
        price_context: {
          last: 29801.25,
          inside_fvgs: [{ kind: 'fvg', dir: 'bull', top: 29804, bottom: 29794.25, ce: 29799.25 }],
          inside_bprs: [],
          nearest_opposing_fvg_above: null,
          nearest_opposing_fvg_below: null,
        },
        pillar3: { most_recent_structure: { event: 'bos', dir: 'bull', level: 29804.75, displacement: true, confirmed_ms: 1779785460000 } },
      },
    },
  };
}

test('buildBriefDigest returns null when no pair block present', () => {
  const out = buildBriefDigest({ chart: {}, gates: {} });
  assert.equal(out, null);
});

test('buildBriefDigest emits one section per symbol in pair', () => {
  const bundle = {
    pair: {
      primary: 'MNQ1!', secondary: 'MES1!',
      symbols: { 'MNQ1!': sampleSymbolBundle(), 'MES1!': sampleSymbolBundle() },
      leader_evidence: { primary_disp_score: 0.74, secondary_disp_score: 0.41, margin: 0.33, threshold: 0.1, reason: 'primary_higher_disp_score' },
    },
  };
  const out = buildBriefDigest(bundle);
  assert.ok(out.symbols['MNQ1!']);
  assert.ok(out.symbols['MES1!']);
  assert.equal(out.leader_evidence.reason, 'primary_higher_disp_score');
});

test('digest.htf carries momentum + ranked top_fvgs/top_bprs + recent_structures + quality per TF', () => {
  const bundle = {
    pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': sampleSymbolBundle(), 'MES1!': sampleSymbolBundle() }, leader_evidence: { reason: 'primary_higher_disp_score' } },
  };
  const out = buildBriefDigest(bundle);
  const h4 = out.symbols['MNQ1!'].htf.h4;
  assert.equal(h4.change_pct, '7.07%');
  assert.equal(h4.range, 2380.75);
  // Top-ranked FVG should be the fresh+took_liq+high-disp one, not the invalidated tiny one.
  assert.equal(h4.top_fvgs[0].state, 'fresh');
  assert.equal(h4.top_fvgs[0].took_liq, true);
  assert.equal(h4.top_fvgs[0].disp_score, 0.74);
  assert.ok(h4.top_fvgs[0].cite.startsWith('engine_by_tf.h4.fvgs'));
  // BPR present.
  assert.equal(h4.top_bprs[0].top, 29774);
  // Recent structures: latest by confirmed_ms.
  assert.equal(h4.recent_structures[0].event, 'bos');
  assert.equal(h4.recent_structures[0].dir, 'bull');
  // Quality block.
  assert.equal(h4.quality.range_quality, 'tight');
  assert.equal(h4.quality.displacement, 'acceptable');
});

test('digest.pillar1 carries session_levels, sweeps, untaken_pools', () => {
  const bundle = { pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': sampleSymbolBundle(), 'MES1!': sampleSymbolBundle() }, leader_evidence: {} } };
  const p1 = buildBriefDigest(bundle).symbols['MNQ1!'].pillar1;
  assert.equal(p1.session_levels.PDH.price, 29397);
  assert.equal(p1.sweeps[0].rejected, true);
  assert.equal(p1.untaken_pools_above[0].price, 30000);
});

test('digest.pillar2 carries current_tf + m5 + m15 quality objects', () => {
  const bundle = { pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': sampleSymbolBundle(), 'MES1!': sampleSymbolBundle() }, leader_evidence: {} } };
  const p2 = buildBriefDigest(bundle).symbols['MNQ1!'].pillar2;
  assert.equal(p2.current_tf.candle, 'doji_wick');
  assert.equal(p2.m5.range_3h, 40);
  assert.equal(p2.m15.candle, 'doji_wick');
});

test('digest.ltf_context carries inside zones + nearest opposing FVG + most_recent_structure', () => {
  const bundle = { pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': sampleSymbolBundle(), 'MES1!': sampleSymbolBundle() }, leader_evidence: {} } };
  const ltf = buildBriefDigest(bundle).symbols['MNQ1!'].ltf_context;
  assert.equal(ltf.inside_fvgs[0].ce, 29799.25);
  assert.equal(ltf.most_recent_structure.event, 'bos');
});

test('top_fvgs ranks by (state=fresh DESC, took_liq DESC, disp_score DESC) and caps at 3', () => {
  const symBundle = sampleSymbolBundle();
  // Push 5 FVGs into h4 with mixed shapes.
  symBundle.engine_by_tf.h4.fvgs = [
    { kind: 'fvg', dir: 'bull', top: 1, bottom: 0, ce: 0.5, disp_score: 0.1, took_liq: false, state: 'invalidated', size_quality: 'tiny', reacted: false, reaction_dir: 'none' },
    { kind: 'fvg', dir: 'bear', top: 2, bottom: 1, ce: 1.5, disp_score: 0.9, took_liq: true,  state: 'fresh', size_quality: 'normal', reacted: false, reaction_dir: 'none' },
    { kind: 'fvg', dir: 'bull', top: 3, bottom: 2, ce: 2.5, disp_score: 0.5, took_liq: false, state: 'fresh', size_quality: 'normal', reacted: false, reaction_dir: 'none' },
    { kind: 'fvg', dir: 'bull', top: 4, bottom: 3, ce: 3.5, disp_score: 0.8, took_liq: true,  state: 'filled', size_quality: 'large', reacted: true, reaction_dir: 'bull' },
    { kind: 'fvg', dir: 'bull', top: 5, bottom: 4, ce: 4.5, disp_score: 0.7, took_liq: false, state: 'fresh', size_quality: 'normal', reacted: false, reaction_dir: 'none' },
  ];
  const bundle = { pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': symBundle, 'MES1!': sampleSymbolBundle() }, leader_evidence: {} } };
  const ranked = buildBriefDigest(bundle).symbols['MNQ1!'].htf.h4.top_fvgs;
  assert.equal(ranked.length, 3);
  // Fresh + took_liq + disp 0.9 wins.
  assert.equal(ranked[0].disp_score, 0.9);
  // Then fresh + no took_liq sorted by disp_score: 0.7, 0.5.
  assert.equal(ranked[1].disp_score, 0.7);
  assert.equal(ranked[2].disp_score, 0.5);
});

test('cite paths use the per-TF prefix (engine_by_tf.<tf>.fvgs/bprs/structures)', () => {
  const bundle = { pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': sampleSymbolBundle(), 'MES1!': sampleSymbolBundle() }, leader_evidence: {} } };
  const h4 = buildBriefDigest(bundle).symbols['MNQ1!'].htf.h4;
  assert.match(h4.top_fvgs[0].cite, /^engine_by_tf\.h4\.fvgs\[\d+\]$/);
  assert.match(h4.top_bprs[0].cite, /^engine_by_tf\.h4\.bprs\[\d+\]$/);
  assert.match(h4.recent_structures[0].cite, /^engine_by_tf\.h4\.structures\[\d+\]$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/brief-digest.test.js`
Expected: All tests fail with `Cannot find module '../cli/lib/brief-digest.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `cli/lib/brief-digest.js`:

```js
/**
 * brief-digest.js — build a slim per-symbol digest from a paired bundle.
 *
 * Solves the 2026-05-26 Read-window problem: the full pair block sits at
 * chars 140k-420k of the bundle, past the Read tool's effective limit.
 * The digest pulls forward only the fields the brief needs (HTF momentum,
 * top-ranked FVGs/BPRs/structures, Pillar 2 quality, overnight context),
 * costing ~7-15KB per symbol vs 152KB. Surfaced as `bundle.brief_digest`
 * — top-level, accessible in the first read.
 *
 * Pure function. No I/O. Cited paths use the `engine_by_tf.<tf>.*` prefix
 * so the model can cite directly from the digest's `cite` field.
 *
 * Strategy authority: docs/strategy/trading-strategy-2026.md §7 steps 1-3.
 * Spec: docs/superpowers/specs/2026-05-26-strategy-chain-design.md §2.1.
 */

const HTF_TFS = ['daily', 'h4', 'h1'];
const TOP_N = 3;

/** Rank FVGs by (state=fresh DESC, took_liq DESC, disp_score DESC). */
function rankFvgs(fvgs) {
  const score = (f) => {
    const freshBit = f.state === 'fresh' ? 2 : (f.state === 'ce_tapped' || f.state === 'inverted' ? 1 : 0);
    const liqBit = f.took_liq ? 1 : 0;
    return freshBit * 100 + liqBit * 10 + (typeof f.disp_score === 'number' ? f.disp_score : 0);
  };
  return (fvgs || []).slice().sort((a, b) => score(b) - score(a));
}

/** Rank BPRs by (state=fresh DESC, took_liq DESC). No disp_score on BPRs. */
function rankBprs(bprs) {
  const score = (b) => (b.state === 'fresh' ? 2 : 0) + (b.took_liq ? 1 : 0);
  return (bprs || []).slice().sort((a, b) => score(b) - score(a));
}

/** Latest structures by confirmed_ms DESC. */
function recentStructures(structures, n = 2) {
  return (structures || [])
    .slice()
    .sort((a, b) => (b.confirmed_ms || 0) - (a.confirmed_ms || 0))
    .slice(0, n);
}

function htfBlockForSymbol(symBundle, sym) {
  const out = {};
  for (const tf of HTF_TFS) {
    const bars = symBundle?.bars_by_tf?.[tf] || {};
    const engineTf = symBundle?.engine_by_tf?.[tf] || {};
    const rankedFvgs = rankFvgs(engineTf.fvgs).slice(0, TOP_N);
    const rankedBprs = rankBprs(engineTf.bprs).slice(0, TOP_N);
    const recent = recentStructures(engineTf.structures, 2);
    out[tf] = {
      change_pct: bars.change_pct ?? null,
      range: bars.range ?? null,
      top_fvgs: rankedFvgs.map((f, i) => {
        const idx = (engineTf.fvgs || []).indexOf(f);
        return { ...f, cite: `engine_by_tf.${tf}.fvgs[${idx}]` };
      }),
      top_bprs: rankedBprs.map((b) => {
        const idx = (engineTf.bprs || []).indexOf(b);
        return { ...b, cite: `engine_by_tf.${tf}.bprs[${idx}]` };
      }),
      recent_structures: recent.map((s) => {
        const idx = (engineTf.structures || []).indexOf(s);
        return { ...s, cite: `engine_by_tf.${tf}.structures[${idx}]` };
      }),
      quality: engineTf.quality
        ? { ...engineTf.quality, cite: `engine_by_tf.${tf}.quality` }
        : null,
    };
  }
  return out;
}

function pillar1ForSymbol(symBundle) {
  const p1 = symBundle?.gates?.engine?.pillar1 || {};
  return {
    session_levels: p1.session_levels || {},
    sweeps: p1.sweeps || [],
    untaken_pools_above: (p1.untaken_pools_above || []).slice(0, TOP_N),
    untaken_pools_below: (p1.untaken_pools_below || []).slice(0, TOP_N),
  };
}

function pillar2ForSymbol(symBundle) {
  const p2 = symBundle?.gates?.engine?.pillar2 || {};
  return {
    current_tf: p2.current_tf || null,
    m5: p2.m5 || null,
    m15: p2.m15 || null,
  };
}

function ltfContextForSymbol(symBundle) {
  const pc = symBundle?.gates?.engine?.price_context || {};
  const p3 = symBundle?.gates?.engine?.pillar3 || {};
  return {
    inside_fvgs: pc.inside_fvgs || [],
    inside_bprs: pc.inside_bprs || [],
    nearest_opposing_fvg_above: pc.nearest_opposing_fvg_above ?? null,
    nearest_opposing_fvg_below: pc.nearest_opposing_fvg_below ?? null,
    most_recent_structure: p3.most_recent_structure ?? null,
  };
}

/**
 * buildBriefDigest(bundle) → digest | null
 *
 * Returns null when there is no `pair` block (single-symbol bundles don't
 * need a digest — the model reads top-level fields directly).
 */
export function buildBriefDigest(bundle) {
  const pair = bundle?.pair;
  if (!pair?.symbols) return null;
  const symbols = {};
  for (const sym of Object.keys(pair.symbols)) {
    const sb = pair.symbols[sym];
    symbols[sym] = {
      htf: htfBlockForSymbol(sb, sym),
      pillar1: pillar1ForSymbol(sb),
      pillar2: pillar2ForSymbol(sb),
      ltf_context: ltfContextForSymbol(sb),
    };
  }
  return {
    symbols,
    leader_evidence: pair.leader_evidence || {},
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/brief-digest.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/brief-digest.js tests/brief-digest.test.js
git commit -m "feat(digest): add brief-digest pure builder

Slim per-symbol digest of HTF momentum + ranked FVGs/BPRs/structures +
pillar1/pillar2 + ltf_context. Surfaces at bundle.brief_digest so the
brief turn doesn't have to read deep into the pair block (chars
140k-420k, unreachable through Read tool).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Wire brief-digest into analyze.js

**Files:**
- Modify: `cli/commands/analyze.js`

- [ ] **Step 1: Find the bundle assembly point**

Run: `grep -n "return bundle;" cli/commands/analyze.js`
Expected: shows lines ~212 and ~846 (single-symbol and pair paths).

- [ ] **Step 2: Add brief-digest import + call at top of analyze.js**

Modify the imports section of `cli/commands/analyze.js`. Find the existing `import { computeEngineGates }` line and add the digest import on the next line:

```js
import { buildBriefDigest } from '../lib/brief-digest.js';
```

Find the line `return bundle;` near line 846 (inside the pair-handling path) and replace with:

```js
      // Brief digest — slim per-symbol summary at the top of the bundle so the
      // brief turn doesn't have to read deep into pair.symbols.* (chars 140k+,
      // past Read tool's effective window). Only emitted when --pair is set.
      const digest = buildBriefDigest(bundle);
      if (digest) bundle.brief_digest = digest;
      return bundle;
```

- [ ] **Step 3: Run smoke fixtures to verify nothing broke**

Run: `npm run smoke:fixtures`
Expected: 6/6 checks pass (existing fixtures don't have `brief_digest`, but they have `pair` only in 002 — verify no regression).

- [ ] **Step 4: Run a real capture to verify brief_digest appears**

Run: `./bin/tv analyze --pair MNQ1!,MES1! --out /tmp/digest-smoke.json && jq 'has("brief_digest"), (.brief_digest.symbols | keys)' /tmp/digest-smoke.json`
Expected: `true` then `["MES1!", "MNQ1!"]`.

(Skip this step if TV isn't running; the unit tests cover the logic.)

- [ ] **Step 5: Commit**

```bash
git add cli/commands/analyze.js
git commit -m "feat(analyze): emit brief_digest at top of paired bundle

Adds bundle.brief_digest when --pair is set so the brief turn reads
HTF data from the slim digest instead of pair.symbols.* (which sits
past the Read tool's effective window).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: sizing helper + strategy table — TDD

**Files:**
- Create: `cli/lib/sizing.js`
- Create: `docs/strategy/sizing-table.md`
- Create: `tests/sizing.test.js`

- [ ] **Step 1: Write the strategy table doc**

Create `docs/strategy/sizing-table.md`:

```markdown
# Sizing Table

Canonical sizing rules for Lanto's strategy (§6 + §7 step 7).

Sizing is `base_r × day_factor × grade_factor`.

| Day | base R | factor |
|---|---|---|
| Mon | 0.75 | 0.5 |
| Tue | 0.75 | 1.0 |
| Wed | 0.75 | 1.0 |
| Thu | 0.75 | 1.0 |
| Fri | 0.75 | 0.5 |

Grade adjustment:
- A+ × 1.0
- B  × 0.5

Memory overrides live in `state/memory/USER.md`. If USER.md contains a
matching rule (e.g. "skip PCE Wednesdays"), the helper returns
`r_size: 0` with `override_reason` set.
```

- [ ] **Step 2: Write the failing tests**

Create `tests/sizing.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSize } from '../cli/lib/sizing.js';

test('Tuesday A+ → base 0.75 × day 1.0 × grade 1.0 = 0.75', () => {
  const r = computeSize({ day_of_week: 'Tue', grade: 'A+' });
  assert.equal(r.r_size, 0.75);
  assert.equal(r.day_factor, 1.0);
  assert.equal(r.grade_factor, 1.0);
  assert.equal(r.base_r, 0.75);
  assert.equal(r.override_reason, null);
});

test('Tuesday B → base 0.75 × 1.0 × 0.5 = 0.375', () => {
  const r = computeSize({ day_of_week: 'Tue', grade: 'B' });
  assert.equal(r.r_size, 0.375);
});

test('Monday A+ → 0.375 (Mon discount)', () => {
  const r = computeSize({ day_of_week: 'Mon', grade: 'A+' });
  assert.equal(r.r_size, 0.375);
  assert.equal(r.day_factor, 0.5);
});

test('Friday B → 0.1875 (Fri discount × B discount)', () => {
  const r = computeSize({ day_of_week: 'Fri', grade: 'B' });
  assert.equal(r.r_size, 0.1875);
});

test('no-trade grade → r_size 0', () => {
  const r = computeSize({ day_of_week: 'Tue', grade: 'no-trade' });
  assert.equal(r.r_size, 0);
  assert.equal(r.grade_factor, 0);
});

test('memory_overrides string mentioning skip + day matches → r_size 0', () => {
  const r = computeSize({ day_of_week: 'Wed', grade: 'A+', memory_overrides: 'Trader skips PCE Wednesdays' });
  assert.equal(r.r_size, 0);
  assert.equal(r.override_reason, 'Trader skips PCE Wednesdays');
});

test('memory_overrides without a matching rule does not override', () => {
  const r = computeSize({ day_of_week: 'Tue', grade: 'A+', memory_overrides: 'Trader prefers tight stops' });
  assert.equal(r.r_size, 0.75);
  assert.equal(r.override_reason, null);
});

test('cites include strategy.sizing-table and memory.USER when memory was checked', () => {
  const r = computeSize({ day_of_week: 'Tue', grade: 'A+', memory_overrides: '' });
  assert.deepEqual(r.cites.sort(), ['memory.USER', 'strategy.sizing-table']);
});

test('cites omit memory.USER when no memory_overrides passed', () => {
  const r = computeSize({ day_of_week: 'Tue', grade: 'A+' });
  assert.deepEqual(r.cites, ['strategy.sizing-table']);
});

test('unknown day defaults to factor 1.0 (treat as Tue-Thu)', () => {
  const r = computeSize({ day_of_week: 'Sat', grade: 'A+' });
  assert.equal(r.r_size, 0.75);
  assert.equal(r.day_factor, 1.0);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/sizing.test.js`
Expected: All tests fail with module-not-found.

- [ ] **Step 4: Write the implementation**

Create `cli/lib/sizing.js`:

```js
/**
 * sizing.js — compute trade size in R from day-of-week × grade × overrides.
 *
 * Pure function. No LLM arithmetic (CLAUDE.md #7). The model cites the
 * cite paths verbatim; this helper produces the numbers.
 *
 * Strategy authority: docs/strategy/sizing-table.md
 * Spec: docs/superpowers/specs/2026-05-26-strategy-chain-design.md §4.5
 */

const BASE_R = 0.75;
const DAY_FACTORS = { Mon: 0.5, Tue: 1.0, Wed: 1.0, Thu: 1.0, Fri: 0.5 };
const GRADE_FACTORS = { 'A+': 1.0, B: 0.5, 'no-trade': 0 };

/**
 * Check the memory text for a "skip" rule matching this day of week.
 * Returns the matching line (used as override_reason) or null.
 */
function findSkipRule(memoryText, day) {
  if (typeof memoryText !== 'string' || !memoryText) return null;
  const dayLong = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' }[day];
  for (const raw of memoryText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!/skip/i.test(line)) continue;
    // Match either the abbreviation (Tue) or the long form (Tuesday).
    if (new RegExp(`\\b${day}\\b`, 'i').test(line)) return line;
    if (dayLong && new RegExp(`\\b${dayLong}\\b`, 'i').test(line)) return line;
  }
  return null;
}

export function computeSize({ day_of_week, grade, memory_overrides } = {}) {
  const day_factor = DAY_FACTORS[day_of_week] ?? 1.0;
  const grade_factor = GRADE_FACTORS[grade] ?? 0;
  const cites = ['strategy.sizing-table'];
  if (memory_overrides !== undefined) cites.push('memory.USER');
  const override = findSkipRule(memory_overrides, day_of_week);
  if (override) {
    return {
      r_size: 0,
      day_factor,
      grade_factor,
      base_r: BASE_R,
      cites,
      override_reason: override,
    };
  }
  return {
    r_size: BASE_R * day_factor * grade_factor,
    day_factor,
    grade_factor,
    base_r: BASE_R,
    cites,
    override_reason: null,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/sizing.test.js`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/lib/sizing.js docs/strategy/sizing-table.md tests/sizing.test.js
git commit -m "feat(sizing): add pure sizing helper + strategy table

Computes r_size = base_r × day_factor × grade_factor. No LLM
arithmetic. Memory overrides (memory.USER.md) can zero out the size
when the trader has flagged a skip rule (e.g. 'skip PCE Wednesdays').
Brief and entry-hunt both call this helper and cite the strategy
table + memory as sources.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: entry-model-priority pure resolver — TDD

**Files:**
- Create: `cli/lib/entry-model-priority.js`
- Create: `tests/entry-model-priority.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/entry-model-priority.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEntryModelPriority } from '../cli/lib/entry-model-priority.js';

test('pillar2 poor → undecided regardless of alignment', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'poor',
    htf_ltf_alignment: 'aligned',
    failure_swings: [{ event: 'mss', validation: 'sweep' }],
  });
  assert.equal(r.priority, 'undecided');
  assert.match(r.reason, /pillar2/i);
});

test('divergent → MSS (LTF reversal at HTF level)', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'divergent',
  });
  assert.equal(r.priority, 'MSS');
  assert.match(r.reason, /divergent/i);
});

test('aligned + recent failure_swing → MSS', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'aligned',
    failure_swings: [{ event: 'mss', validation: 'sweep', confirmed_ms: 1779785460000 }],
    most_recent_structure: null,
    inverted_fvg_present: false,
  });
  assert.equal(r.priority, 'MSS');
  assert.match(r.cite, /failure_swings/);
});

test('aligned + recent BoS in bias direction (no failure_swing) → Trend', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'aligned',
    ltf_bias: 'bullish',
    failure_swings: [],
    most_recent_structure: { event: 'bos', dir: 'bull', confirmed_ms: 1779785460000 },
    inverted_fvg_present: false,
  });
  assert.equal(r.priority, 'Trend');
  assert.match(r.cite, /most_recent_structure/);
});

test('aligned + BoS in WRONG direction → undecided (not Trend, direction mismatch)', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'aligned',
    ltf_bias: 'bullish',
    failure_swings: [],
    most_recent_structure: { event: 'bos', dir: 'bear' },
    inverted_fvg_present: false,
  });
  assert.equal(r.priority, 'undecided');
});

test('aligned + opposing FVG flipped (state=inverted) → Inversion', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'aligned',
    ltf_bias: 'bullish',
    failure_swings: [],
    most_recent_structure: null,
    inverted_fvg_present: true,
  });
  assert.equal(r.priority, 'Inversion');
  assert.match(r.cite, /fvgs.*inverted/);
});

test('aligned with no obvious signal → undecided', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'aligned',
    failure_swings: [],
    most_recent_structure: null,
    inverted_fvg_present: false,
  });
  assert.equal(r.priority, 'undecided');
});

test('unclear alignment → undecided', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'unclear',
  });
  assert.equal(r.priority, 'undecided');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/entry-model-priority.test.js`
Expected: All tests fail with module-not-found.

- [ ] **Step 3: Write the implementation**

Create `cli/lib/entry-model-priority.js`:

```js
/**
 * entry-model-priority.js — pure resolver for which of MSS / Trend /
 * Inversion to walk first at entry_hunt time.
 *
 * Inputs: open-reaction phase facts (pillar2_verdict, htf_ltf_alignment,
 * ltf_bias) + engine-derived signals (failure_swings, most_recent_structure,
 * inverted_fvg_present).
 *
 * Output: { priority: 'MSS'|'Trend'|'Inversion'|'undecided', reason: str,
 *           cite: str }. The `cite` field names the path the LLM should
 * also include verbatim in `surface_ltf_bias.priority_reason`.
 *
 * Spec: docs/superpowers/specs/2026-05-26-strategy-chain-design.md §3.4
 */

export function computeEntryModelPriority({
  pillar2_verdict,
  htf_ltf_alignment,
  ltf_bias,
  failure_swings = [],
  most_recent_structure = null,
  inverted_fvg_present = false,
} = {}) {
  if (pillar2_verdict === 'poor') {
    return { priority: 'undecided', reason: 'pillar2 poor — quality gates trumps entry model', cite: 'pillar2_verdict' };
  }
  if (htf_ltf_alignment === 'divergent') {
    return { priority: 'MSS', reason: 'divergent — LTF reversal at HTF level', cite: 'htf_ltf_alignment=divergent' };
  }
  if (htf_ltf_alignment === 'aligned') {
    if (failure_swings.length > 0) {
      return { priority: 'MSS', reason: 'aligned + recent failure_swing (mss+sweep)', cite: 'failure_swings[0]' };
    }
    if (most_recent_structure?.event === 'bos' && most_recent_structure?.dir) {
      const dir = most_recent_structure.dir;
      const biasMatches = (ltf_bias === 'bullish' && dir === 'bull') || (ltf_bias === 'bearish' && dir === 'bear');
      if (biasMatches) {
        return { priority: 'Trend', reason: `aligned + BoS in bias direction (${dir})`, cite: 'most_recent_structure' };
      }
    }
    if (inverted_fvg_present) {
      return { priority: 'Inversion', reason: 'aligned + opposing FVG just flipped (state=inverted)', cite: 'fvgs[where state=inverted]' };
    }
    return { priority: 'undecided', reason: 'aligned but no obvious entry model signal', cite: 'none' };
  }
  // htf_ltf_alignment === 'unclear' or anything else
  return { priority: 'undecided', reason: 'alignment unclear', cite: 'htf_ltf_alignment' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/entry-model-priority.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/entry-model-priority.js tests/entry-model-priority.test.js
git commit -m "feat(priority): pure resolver for entry_model_priority

Decision tree: pillar2 poor → undecided; divergent → MSS; aligned →
MSS (failure_swing) / Trend (BoS in bias dir) / Inversion (opposing
FVG flipped) / undecided. Called from surface_ltf_bias as a
cross-check on the model's chosen priority.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: surface_session_brief Zod additions

**Files:**
- Modify: `app/main/sdk.js`

- [ ] **Step 1: Locate surface_session_brief Zod definition**

Run: `grep -n "surface_session_brief" app/main/sdk.js | head -5`
Expected: shows the `tool(` registration around line 528.

- [ ] **Step 2: Add the new fields**

In `app/main/sdk.js`, find the `surface_session_brief` Zod object (currently has `session`, `symbol`, `brief`, `htf_bias`, `overnight`, `key_levels`, `pillar_grade`, `pillars`, `plan`, `scenarios`, `anchored_target`, `anchored_stop`, `sizing_note`).

Add these new fields **inside the Zod object** (alongside the existing fields, before the `}` closing the object):

```js
        primary_draw: z.object({
          tf: z.enum(['daily', 'h4', 'h1']),
          kind: z.enum(['fvg', 'bpr', 'ifvg']),
          dir: z.enum(['bull', 'bear']),
          top: z.number().finite(),
          bottom: z.number().finite(),
          ce: z.number().finite(),
          disp_score: z.number().finite(),
          took_liq: z.boolean(),
          state: z.enum(['fresh', 'ce_tapped', 'filled', 'inverted', 'invalidated']),
          cite: z.string().refine((s) => /engine_by_tf\.(daily|h4|h1)\.(fvgs|bprs)/.test(s), {
            message: "primary_draw.cite must point at engine_by_tf.<tf>.fvgs[N] or .bprs[N]",
          }),
        }).optional().describe("The chosen primary HTF PD array — anchor for the day. From brief_digest.symbols.<sym>.htf.<tf>.top_fvgs/top_bprs."),
        htf_destination: z.string().optional().describe('Free-string: "above 30000 buy-side" / "below 29400 sell-side" / "balanced". One sentence.'),
        overnight_block: z.object({
          asia: z.object({ high: z.number(), low: z.number(), state: z.enum(['extended', 'swept', 'untaken']), cite: z.string() }).optional(),
          london: z.object({ high: z.number(), low: z.number(), state: z.enum(['extended', 'swept', 'untaken']), cite: z.string() }).optional(),
          untaken_above: z.array(z.object({ name: z.string(), price: z.number(), cite: z.string() })).optional(),
          untaken_below: z.array(z.object({ name: z.string(), price: z.number(), cite: z.string() })).optional(),
          overnight_verdict: z.enum(['extending_htf', 'retracing_htf', 'consolidating']).optional(),
          path_to_destination: z.string().optional(),
        }).optional().describe("Structured overnight context handoff — populated by brief, consumed by open_reaction + entry_hunt."),
        htf_quality: z.object({
          h4: z.object({ range_quality: z.string(), displacement: z.string(), candle: z.string(), cite: z.string() }).optional(),
          h1: z.object({ range_quality: z.string(), displacement: z.string(), candle: z.string(), cite: z.string() }).optional(),
        }).optional().describe("HTF Pillar 2 quality verdict for h4 + h1. Strategy §3 step 3."),
        pillar2_verdict: z.enum(['good', 'marginal', 'poor']).optional().describe("Final P2 verdict for the session. Gates entry_hunt — 'poor' → stand aside."),
        no_trade_reason: z.enum(['data_gap', 'engine_stale', 'pillar2_poor', 'htf_unclear', 'session_closed']).optional().describe("Required iff pillar_grade==='no-trade'. Drives the hard-vs-soft short-circuit downstream."),
        chain_status: z.enum(['clean', 'degraded:data_gap', 'degraded:engine_stale', 'degraded:htf_unclear', 'degraded:pillar2_poor']).optional().describe('chain_status: clean for normal, degraded:<reason> when the brief had to fall back.'),
```

- [ ] **Step 3: Run the unit tests to verify Zod still parses**

Run: `npm run test:unit 2>&1 | tail -15`
Expected: All existing tests still pass (139/139 from PR #60).

- [ ] **Step 4: Commit**

```bash
git add app/main/sdk.js
git commit -m "feat(schema): surface_session_brief gains primary_draw + overnight + htf_quality + chain fields

Adds the structured handoff fields the spec requires: primary_draw
(anchor for entire chain), overnight_block (verdict + untaken
draws), htf_quality (h4/h1 displacement), pillar2_verdict (gate),
no_trade_reason (drives hard-vs-soft short-circuit), chain_status.
All optional for backwards-compat with PR #60.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: surface_ltf_bias Zod additions

**Files:**
- Modify: `app/main/sdk.js`

- [ ] **Step 1: Locate surface_ltf_bias Zod definition**

Run: `grep -n "surface_ltf_bias" app/main/sdk.js | head -5`
Expected: shows the `tool(` registration around line 495.

- [ ] **Step 2: Add new fields to the Zod object**

In `app/main/sdk.js`, find the `surface_ltf_bias` Zod object. Add these fields:

```js
        leader: z.string().optional().describe("The chosen leader symbol (mirrors pair-decision.json) when in dual-symbol mode."),
        htf_ltf_alignment: z.enum(['aligned', 'divergent', 'unclear']).optional().describe("Did NY's reaction align with the brief's HTF bias?"),
        is_retrace_day: z.boolean().optional().describe("True when divergent + HTF draw still untouched. Caps grade at B."),
        entry_model_priority: z.enum(['MSS', 'Trend', 'Inversion', 'undecided']).optional().describe("Mechanically computed from htf_ltf_alignment × engine signals. See cli/lib/entry-model-priority.js."),
        priority_reason: z.string().optional().describe("One-line cite for the priority decision (e.g. 'failure_swings[0]')."),
        grade_cap: z.enum(['A+', 'B']).optional().describe("Max grade entry_hunt can surface this session. divergent → B."),
        chain_status: z.enum(['clean', 'degraded:leader_inconclusive', 'degraded:no_fvgs_in_window', 'degraded:secondary_missing', 'divergent', 'backfilled:open_reaction']).optional(),
```

- [ ] **Step 3: Run the unit tests**

Run: `npm run test:unit 2>&1 | tail -10`
Expected: All existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add app/main/sdk.js
git commit -m "feat(schema): surface_ltf_bias gains leader + alignment + priority + chain fields

Adds the open-reaction handoff fields: leader (mirrors pair-decision),
htf_ltf_alignment, is_retrace_day, entry_model_priority,
priority_reason, grade_cap (caps to B on divergent), chain_status.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: surface.js cross-validation — no_trade_reason + entry_model_priority

**Files:**
- Modify: `app/main/tools/surface.js`

- [ ] **Step 1: Locate surfaceSessionBrief**

Run: `grep -n "surfaceSessionBrief\|surfaceLtfBias\|computeEntryModelPriority" app/main/tools/surface.js`
Expected: shows surfaceSessionBrief around line 196 + surfaceLtfBias if defined.

- [ ] **Step 2: Add no_trade_reason cross-validation to surfaceSessionBrief**

In `app/main/tools/surface.js`, find this block (added in PR #60):

```js
  if (payload.pillar_grade === "B" && Array.isArray(payload.pillars)) {
    const weakOrFail = payload.pillars.filter((p) => p.status === "weak" || p.status === "fail").length;
    ...
```

Add **above** that block:

```js
  // no_trade_reason cross-validation. The chain depends on this to route
  // hard (data/engine/closed) vs soft (chop/htf_unclear) short-circuits.
  if (payload.pillar_grade === "no-trade" && !payload.no_trade_reason) {
    throw new Error(
      `surface_session_brief: pillar_grade "no-trade" requires no_trade_reason ` +
      `(one of: data_gap, engine_stale, pillar2_poor, htf_unclear, session_closed). ` +
      `Without it, downstream phases can't route hard vs soft short-circuit.`,
    );
  }
  if (payload.pillar_grade !== "no-trade" && payload.no_trade_reason) {
    throw new Error(
      `surface_session_brief: no_trade_reason set ("${payload.no_trade_reason}") ` +
      `but pillar_grade is "${payload.pillar_grade}" — reason only valid with no-trade grade.`,
    );
  }
```

- [ ] **Step 3: Find or add surfaceLtfBias + cross-validate entry_model_priority**

If `surfaceLtfBias` already exists in `app/main/tools/surface.js`, find it. Otherwise the `surface_ltf_bias` tool registration in `sdk.js` calls a writer in this file — check what it currently does (likely a simple write).

Add **inside** `surfaceLtfBias` (or wherever the ltf_bias handler is) a cross-check against the helper:

```js
import { computeEntryModelPriority } from "../../../cli/lib/entry-model-priority.js";

// ... inside surfaceLtfBias(payload):

  // Cross-check entry_model_priority matches the deterministic resolver.
  // Catches model errors silently violating the decision tree.
  if (payload.entry_model_priority !== undefined) {
    const expected = computeEntryModelPriority({
      pillar2_verdict: payload.pillar2_verdict,
      htf_ltf_alignment: payload.htf_ltf_alignment,
      ltf_bias: payload.ltf_bias,
      failure_swings: payload.failure_swings_present ? [{ event: 'mss', validation: 'sweep' }] : [],
      most_recent_structure: payload.most_recent_structure || null,
      inverted_fvg_present: !!payload.inverted_fvg_present,
    });
    if (expected.priority !== payload.entry_model_priority && payload.entry_model_priority !== 'undecided') {
      // Don't throw — log + override. The model's "undecided" is always honored.
      // eslint-disable-next-line no-console
      console.warn(`[surface.ltf_bias] entry_model_priority mismatch: got "${payload.entry_model_priority}", expected "${expected.priority}". Reason: ${expected.reason}. Honoring model's choice but flagging.`);
    }
  }
```

If `surfaceLtfBias` doesn't exist, add this as part of writing the handler. The tool was registered in PR #57/58 era — verify with `grep -n 'surface_ltf_bias' app/main/sdk.js` and check the handler body.

- [ ] **Step 4: Run the tests to verify nothing broke**

Run: `npm run test:unit 2>&1 | tail -10`
Expected: All existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add app/main/tools/surface.js
git commit -m "feat(surface): cross-validate no_trade_reason + entry_model_priority

Brief: throws when pillar_grade=no-trade without a no_trade_reason
(downstream chain needs it to route hard vs soft short-circuit).
Also throws when no_trade_reason is set with a non-no-trade grade.

LTF: cross-checks entry_model_priority against the deterministic
resolver. Mismatches log a warning but honor the model's choice
(undecided is always honored).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: brief-flow tests for new schema validations

**Files:**
- Modify: `tests/brief-flow.test.js`

- [ ] **Step 1: Add no_trade_reason validation tests**

Append to `tests/brief-flow.test.js`, after the existing `grade semantics` describe block:

```js
describe("brief flow — no_trade_reason cross-validation", () => {
  const baseValid = {
    session: "ny-am",
    symbol: "MNQ1!",
    brief: "headline",
    htf_bias: [
      { tf: "DAILY", bias: "NEUTRAL", note: "n (engine_by_tf.daily.structures[0])" },
      { tf: "4H", bias: "MIXED", note: "n (engine_by_tf.h4.structures[0])" },
      { tf: "1H", bias: "BULLISH", note: "n (engine_by_tf.h1.structures[0])" },
    ],
    overnight: [],
    key_levels: [],
    pillars: [
      { name: "Draw & Bias", status: "weak", elements: [{ name: "HTF", status: "weak" }] },
      { name: "Price-Action Quality", status: "weak", elements: [{ name: "range", status: "weak" }] },
    ],
    plan: "p",
    scenarios: [{ condition: "c", action: "a" }],
    anchored_target: "1 (path)",
    anchored_stop: "1 (path)",
    sizing_note: "0.5 R (memory.USER)",
  };

  it("rejects pillar_grade='no-trade' without no_trade_reason", async () => {
    const { surfaceSessionBrief } = await import("../app/main/tools/surface.js");
    await assert.rejects(
      () => surfaceSessionBrief({ ...baseValid, pillar_grade: "no-trade" }),
      /no_trade_reason/i,
    );
  });

  it("accepts pillar_grade='no-trade' WITH no_trade_reason", async () => {
    const { surfaceSessionBrief } = await import("../app/main/tools/surface.js");
    // Doesn't actually write — we just check the validation passes BEFORE the write would happen.
    // Use a session that won't pollute (the test cleanup is best-effort).
    try {
      const r = await surfaceSessionBrief({ ...baseValid, pillar_grade: "no-trade", no_trade_reason: "pillar2_poor" });
      assert.equal(r.ok, true);
    } finally {
      // Best-effort cleanup of any files written under today's session.
      // (state/ is gitignored; if cleanup fails the next test run isolates itself.)
    }
  });

  it("rejects no_trade_reason set with non-no-trade grade", async () => {
    const { surfaceSessionBrief } = await import("../app/main/tools/surface.js");
    await assert.rejects(
      () => surfaceSessionBrief({ ...baseValid, pillar_grade: "B", no_trade_reason: "pillar2_poor" }),
      /reason only valid with no-trade/i,
    );
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `node --test tests/brief-flow.test.js`
Expected: all new tests pass. (The "accepts no-trade with reason" test may write files under today's ny-am folder — clean up after if so.)

- [ ] **Step 3: Clean up any test pollution**

If the second test wrote files, remove them:

```bash
TODAY=$(TZ=America/New_York date +%Y-%m-%d)
rm -f "/Users/anasqatanani/Documents/claude-tradingview-analyser/state/session/$TODAY/ny-am/brief"* "/Users/anasqatanani/Documents/claude-tradingview-analyser/state/session/$TODAY/ny-am/pillars.md" "/Users/anasqatanani/Documents/claude-tradingview-analyser/state/session/$TODAY/ny-am/pillar1.md" "/Users/anasqatanani/Documents/claude-tradingview-analyser/state/session/$TODAY/ny-am/pillar2.md" 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add tests/brief-flow.test.js
git commit -m "test(brief-flow): no_trade_reason cross-validation tests

Three new cases: reject no-trade without reason, accept no-trade
with reason, reject reason set on non-no-trade grade.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: session-memory.js — stash per-symbol payloads + comparative rendering

**Files:**
- Modify: `app/main/session-memory.js`

- [ ] **Step 1: Locate writeBrief + renderPillar1Md**

Run: `grep -n "writeBrief\|renderPillar1Md\|renderPillar2Md" app/main/session-memory.js`
Expected: shows the function definitions.

- [ ] **Step 2: Modify writeBrief to re-render comparatively from per-symbol JSON on disk**

Replace the existing `writeBrief` body in `app/main/session-memory.js`. Keep imports and exports — only swap the function body. The new logic:
1. Write the per-symbol JSON as today.
2. Write `brief.json` mirror (primary only) as today.
3. Re-render `pillar1.md` / `pillar2.md` by reading EVERY `brief-<sym>.json` that exists on disk for this dir.

Find the existing `writeBrief` function (currently around lines 54-98) and replace with:

```js
export async function writeBrief(dir, payload) {
  await fs.mkdir(dir, { recursive: true });
  const json = JSON.stringify(payload, null, 2);
  if (payload.symbol) {
    await writeAtomic(path.join(dir, `brief-${payload.symbol}.json`), json);
    if (payload.symbol === PAIR_PRIMARY) {
      await writeAtomic(path.join(dir, "brief.json"), json);
      try {
        const sourceBundle = await fs.readFile(SOURCE_BUNDLE, "utf8");
        await writeAtomic(path.join(dir, "brief-bundle.json"), sourceBundle);
      } catch { /* no source bundle — skip snapshot */ }
    }
  } else {
    await writeAtomic(path.join(dir, "brief.json"), json);
    try {
      const sourceBundle = await fs.readFile(SOURCE_BUNDLE, "utf8");
      await writeAtomic(path.join(dir, "brief-bundle.json"), sourceBundle);
    } catch { /* no source bundle — skip snapshot */ }
  }

  // Comparative rendering. Read ALL per-symbol brief-<sym>.json files that
  // exist in this dir, render them together. Single-symbol mode (no symbol
  // on payload) just uses the payload itself. This means after MNQ's call
  // pillars.md has only the MNQ section; after MES's call it has both.
  const perSymbolPayloads = await loadAllPerSymbolBriefs(dir, payload);
  const pillar1Md = renderPillar1Md(perSymbolPayloads);
  const pillar2Md = renderPillar2Md(perSymbolPayloads);
  await writeAtomic(
    path.join(dir, "pillars.md"),
    `${pillar1Md}\n\n---\n\n${pillar2Md}\n`,
  );
  await writeAtomic(path.join(dir, "pillar1.md"), pillar1Md);
  await writeAtomic(path.join(dir, "pillar2.md"), pillar2Md);
}

/**
 * Load every brief-<symbol>.json under `dir`, plus the legacy brief.json
 * mirror as a fallback for single-symbol mode. Returns an array of
 * payloads in canonical (primary first, secondary second) order.
 */
async function loadAllPerSymbolBriefs(dir, currentPayload) {
  // If the current payload has no symbol, it's single-symbol mode — just use it.
  if (!currentPayload?.symbol) return [currentPayload];
  const out = [];
  for (const sym of [PAIR_PRIMARY, PAIR_SECONDARY]) {
    if (sym === currentPayload.symbol) {
      out.push(currentPayload);
      continue;
    }
    try {
      const txt = await fs.readFile(path.join(dir, `brief-${sym}.json`), "utf8");
      out.push(JSON.parse(txt));
    } catch { /* missing — skip */ }
  }
  return out;
}
```

- [ ] **Step 3: Replace renderPillar1Md / renderPillar2Md with comparative versions**

Find `renderPillar1Md` (currently single-payload, around line 151). Replace with:

```js
function renderPillar1Md(payloads) {
  // payloads is an array. Single-symbol mode: array with 1 entry.
  // Dual-symbol mode: array with primary + secondary (in order).
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return "---\n---\n\n# Pillar 1 — Draw & Bias\n\n_no brief data_\n";
  }
  const first = payloads[0];
  const session = first.session || "";
  const phase = `pre_session_${(session || "ny-am").replace("-", "_")}`;
  const graded = first.ts || new Date().toISOString();
  const symbols = payloads.map((p) => p.symbol).filter(Boolean);
  // Frontmatter: per-symbol structured handoffs under symbol keys (lowercased).
  // Each symbol's frontmatter carries primary_draw, overnight_verdict,
  // path_to_destination, no_trade_reason — read by downstream phases.
  const frontKey = (sym) => (sym || "primary").toLowerCase().replace(/[!1]/g, "");
  const symbolSections = payloads.map((p) => {
    const k = frontKey(p.symbol);
    const primary_draw = p.primary_draw ? `\n    primary_draw:\n      tf: ${p.primary_draw.tf}\n      kind: ${p.primary_draw.kind}\n      dir: ${p.primary_draw.dir}\n      top: ${p.primary_draw.top}\n      bottom: ${p.primary_draw.bottom}\n      ce: ${p.primary_draw.ce}\n      state: ${p.primary_draw.state}\n      cite: ${p.primary_draw.cite}` : "";
    const overnight_verdict = p.overnight_block?.overnight_verdict ? `\n    overnight_verdict: ${p.overnight_block.overnight_verdict}` : "";
    const path_to_destination = p.overnight_block?.path_to_destination ? `\n    path_to_destination: "${p.overnight_block.path_to_destination}"` : "";
    const htf_destination = p.htf_destination ? `\n    htf_destination: "${p.htf_destination}"` : "";
    const pillar_grade = p.pillar_grade ? `\n    pillar_grade: ${p.pillar_grade}` : "";
    const no_trade_reason = p.no_trade_reason ? `\n    no_trade_reason: ${p.no_trade_reason}` : "";
    const chain_status = p.chain_status ? `\n    chain_status: ${p.chain_status}` : "";
    return `  ${k}:${primary_draw}${htf_destination}${overnight_verdict}${path_to_destination}${pillar_grade}${no_trade_reason}${chain_status}`;
  }).join("\n");

  // Body sections: one per symbol with the existing prose shape.
  const bodySections = payloads.map((p) => {
    const sym = p.symbol || "primary";
    const bias = (p.htf_bias || []).map((b) => `- **${b.tf}** — ${b.bias}: ${b.note}`).join("\n");
    const overnight = (p.overnight || []).map((o) => `- ${o.k}: ${o.v}`).join("\n");
    const levels = (p.key_levels || []).map((l) => `- ${l.name}: ${l.price} (${l.state})`).join("\n");
    return `## ${sym}\n\n### HTF Bias\n${bias || "_no HTF bias provided_"}\n\n### Primary HTF Draw\n- target: ${p.anchored_target || "_n/a_"}\n- structural stop ref: ${p.anchored_stop || "_n/a_"}\n\n### Overnight Summary\n${overnight || "_no overnight context provided_"}\n\n### Key Levels\n${levels || "_no levels provided_"}\n\n### Plan\n${p.plan || "_no plan provided_"}\n\n### Verdict\n- pillar_grade: ${p.pillar_grade || "pending"}`;
  }).join("\n\n");

  return `---
session: ${session}
phase: ${phase}
symbols: [${symbols.map((s) => `"${s}"`).join(", ")}]
graded_at: ${graded}
${symbolSections}
---

# Pillar 1 — Draw & Bias

${bodySections}
`;
}
```

Find `renderPillar2Md` and replace similarly (find it just below; same shape — per-symbol pillar2 sections):

```js
function renderPillar2Md(payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return "---\n---\n\n# Pillar 2 — Price Action Quality\n\n_no brief data_\n";
  }
  const first = payloads[0];
  const session = first.session || "";
  const phase = `pre_session_${(session || "ny-am").replace("-", "_")}`;
  const graded = first.ts || new Date().toISOString();
  const symbols = payloads.map((p) => p.symbol).filter(Boolean);
  const frontKey = (sym) => (sym || "primary").toLowerCase().replace(/[!1]/g, "");
  const symbolSections = payloads.map((p) => {
    const k = frontKey(p.symbol);
    const verdict = p.pillar2_verdict ? `\n    pillar2_verdict: ${p.pillar2_verdict}` : "";
    const chain_status = p.chain_status ? `\n    chain_status: ${p.chain_status}` : "";
    return `  ${k}:${verdict}${chain_status}`;
  }).join("\n");

  const bodySections = payloads.map((p) => {
    const sym = p.symbol || "primary";
    const p2 = (p.pillars || []).find((pp) => /quality/i.test(pp.name || ""));
    const elements = (p2?.elements || []).map((el) => `- ${el.name}: ${el.status}`).join("\n");
    return `## ${sym}\n\n### Quality elements\n${elements || "_no elements_"}\n\n### Verdict\n- status: ${p2?.status || "pending"}\n- pillar2_verdict: ${p.pillar2_verdict || "pending"}`;
  }).join("\n\n");

  return `---
session: ${session}
phase: ${phase}
symbols: [${symbols.map((s) => `"${s}"`).join(", ")}]
graded_at: ${graded}
${symbolSections}
---

# Pillar 2 — Price Action Quality

${bodySections}
`;
}
```

- [ ] **Step 4: Run brief-flow tests to verify rendering**

Run: `node --test tests/brief-flow.test.js`
Expected: existing tests still pass (the file-content assertions still match `# Pillar 1 — Draw & Bias` and `# Pillar 2 — Price-Action Quality` — verify).

If a test fails because the file content shape changed, update the assertion to match the new structure (e.g. `assert.match(pillars, /## MNQ1!/)` instead of just `/Pillar 1/`).

- [ ] **Step 5: Commit**

```bash
git add app/main/session-memory.js
git commit -m "feat(memory): comparative pillar1/pillar2 rendering from per-symbol briefs

writeBrief now re-renders pillar1.md + pillar2.md from every
brief-<sym>.json on disk, with per-symbol sections in the body and
structured handoff fields (primary_draw, overnight_verdict,
path_to_destination, pillar_grade, no_trade_reason, chain_status)
in frontmatter under mnq:/mes: keys. Single-symbol mode unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: brief-flow test — comparative pillar1.md after both surface calls

**Files:**
- Modify: `tests/brief-flow.test.js`

- [ ] **Step 1: Add the dual-symbol rendering test**

Append to `tests/brief-flow.test.js`:

```js
describe("brief flow — dual-symbol comparative pillar1.md", () => {
  const SECONDARY_BRIEF = {
    session: "ny-am",
    symbol: "MES1!",
    brief: "MES headline",
    htf_bias: [
      { tf: "DAILY", bias: "BULLISH", note: "n (engine_by_tf.daily.structures[0])" },
      { tf: "4H", bias: "BULLISH", note: "n (engine_by_tf.h4.structures[0])" },
      { tf: "1H", bias: "MIXED", note: "n (engine_by_tf.h1.structures[0])" },
    ],
    overnight: [{ k: "Asia range", v: "20 pts" }],
    key_levels: [{ name: "PDH", price: 6500, state: "untaken" }],
    pillar_grade: "B",
    pillars: [
      { name: "Draw & Bias", status: "pass", elements: [{ name: "HTF", status: "pass" }] },
      { name: "Price-Action Quality", status: "weak", elements: [{ name: "range", status: "weak" }] },
    ],
    plan: "MES plan",
    anchored_target: "6500 (PDH)",
    anchored_stop: "6450 (Asia low)",
    sizing_note: "0.5 R (memory.USER)",
  };

  it("after writing both per-symbol briefs, pillar1.md contains both sections", async () => {
    const { writeBrief } = await import("../app/main/session-memory.js");
    const dir = path.join(SANDBOX, "dual");
    await writeBrief(dir, { ...VALID_PRIMARY_BRIEF, ts: "2026-05-26T13:00:00Z" });
    await writeBrief(dir, { ...SECONDARY_BRIEF, ts: "2026-05-26T13:00:00Z" });

    const pillar1 = await fs.readFile(path.join(dir, "pillar1.md"), "utf8");
    // Both symbol sections should be present.
    assert.match(pillar1, /## MNQ1!/);
    assert.match(pillar1, /## MES1!/);
    // Frontmatter should have per-symbol keys (lowercased without ! or 1).
    assert.match(pillar1, /\n  mnq:/);
    assert.match(pillar1, /\n  mes:/);
  });

  it("after writing only the primary, pillar1.md has only MNQ section", async () => {
    const { writeBrief } = await import("../app/main/session-memory.js");
    const dir = path.join(SANDBOX, "primary-only");
    await writeBrief(dir, { ...VALID_PRIMARY_BRIEF, ts: "2026-05-26T13:00:00Z" });

    const pillar1 = await fs.readFile(path.join(dir, "pillar1.md"), "utf8");
    assert.match(pillar1, /## MNQ1!/);
    assert.doesNotMatch(pillar1, /## MES1!/);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `node --test tests/brief-flow.test.js`
Expected: All tests pass including the two new ones.

- [ ] **Step 3: Commit**

```bash
git add tests/brief-flow.test.js
git commit -m "test(brief-flow): comparative pillar1.md after both surface calls

Verifies dual-symbol mode: after MNQ + MES surface calls,
pillar1.md has both ## MNQ1! and ## MES1! sections and per-symbol
mnq:/mes: keys in frontmatter. Single-symbol still works.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: analyze.md — rewrite `<phase name="brief">` to cite brief_digest

**Files:**
- Modify: `app/main/prompts/analyze.md`

- [ ] **Step 1: Locate current brief phase**

Run: `grep -n '<phase name="brief">\|</phase>' app/main/prompts/analyze.md | head -10`
Expected: shows the existing brief block (added in PR #60).

- [ ] **Step 2: Replace the brief phase**

Find the existing `<phase name="brief">...</phase>` block in `app/main/prompts/analyze.md` and replace its CONTENTS with this. (Keep the opening `<phase name="brief">` and closing `</phase>` tags.)

```
**Goal:** publish the PREP-panel SESSION BRIEF for one or both symbols. Fires once per session, 30-60 min before the session opens. Trader reads this live during the open; tight, cited, consistent.

**What this phase produces:** one (or two, for `--pair`) call to `surface_session_brief`. No `pillar1.md` / `pillar2.md` writes — `writeBrief` renders those from the surface call's payload.

**Required action:**

1. **Capture.** Call `mcp__tv__tv_analyze_full` with the pair param from the user message (`pair="MNQ1!,MES1!"` in dual-symbol mode). Wait for it to land, then `Read state/last-analyze.json`.

2. **Use `brief_digest`, not the pair block.** The bundle now carries a top-level `brief_digest.symbols.<sym>` with everything the brief needs. Cite from there. The full `pair.symbols.<sym>` block lives past the Read window and CANNOT be relied on — if the digest is absent (single-symbol mode), cite from the top-level fields instead.

3. **For each symbol** in `brief_digest.symbols` (loop over both for `--pair`), walk the steps below. Cite from `brief_digest.symbols.<sym>.*`.

### Step 1 — HTF Bias (Daily / 4H / 1H)

Walk each TF by name. Pull engine-backed signals **at that TF**:

- `brief_digest.symbols.<sym>.htf.<tf>.change_pct` — momentum sign for that TF.
- `brief_digest.symbols.<sym>.htf.<tf>.top_fvgs[0..2]` — best PD arrays at that TF (ranked by state=fresh, took_liq, disp_score).
- `brief_digest.symbols.<sym>.htf.<tf>.top_bprs[0..2]` — BPRs at that TF.
- `brief_digest.symbols.<sym>.htf.<tf>.recent_structures[0..1]` — most recent `event` (`bos`/`mss`) with `dir`.

For each TF emit `{tf, bias, note}`:
- `bias`: `BULLISH | BEARISH | MIXED | NEUTRAL`. `MIXED` = signs disagree across momentum + structure. `NEUTRAL` = both signals flat / absent.
- `note`: one short sentence that **cites at least one path under `brief_digest.symbols.<sym>.htf.<tf>`** for the row's exact TF. Wrong-TF citations are bugs — never cite `engine.structures[*]` (current chart TF) inside a 4H or 1H bias note.

If `brief_digest.symbols.<sym>.htf.<tf>` is missing or empty (e.g. engine had no rows for that TF), say `bias: NEUTRAL` and the note cites the absence (`"top_fvgs and recent_structures both empty"`). Never invent a directional bias without a per-TF citation.

### Step 2 — Pick the Primary HTF PD Array

From `brief_digest.symbols.<sym>.htf.{daily,h4,h1}.top_fvgs` + `top_bprs`, pick ONE with the highest `disp_score × took_liq` AND state ∈ {fresh, ce_tapped, inverted}. This is the **primary draw** — anchor for everything downstream.

Surface as `primary_draw` in the tool call:
```
primary_draw: {
  tf: "h4",
  kind: "fvg",
  dir: "bull",
  top, bottom, ce: <numbers>,
  disp_score: <number>,
  took_liq: true,
  state: "fresh",
  cite: "engine_by_tf.h4.fvgs[2]"
}
htf_destination: "above 30000 buy-side"  # or "below 29400 sell-side" / "balanced"
```

Strategy §2.1: "He prefers 4H PD arrays when possible because they tend to be cleaner and more tradable intraday." Default to h4 when h4 and h1 are tied.

### Step 3 — Overnight & Session Correlation

Read `brief_digest.symbols.<sym>.pillar1.*`. Walk session levels: PWH, PWL, PDH, PDL, AS_H, AS_L, LO_H, LO_L, NYAM_H, NYAM_L. For each: cite state (taken/untaken) from `pillar1.session_levels.<name>.state`.

Walk `pillar1.sweeps[]`. Sweeps with `rejected: true` are failure-swing reversals — surface them; they're the strongest cue.

Walk `pillar1.untaken_pools_above[0..2]` + `untaken_pools_below[0..2]` — equal-H/L liquidity (strategy §2.1 draw-target liquidity).

Surface as `overnight_block`:
```
overnight_block: {
  asia: { high, low, state: "extended"|"swept"|"untaken", cite },
  london: { high, low, state, cite },
  untaken_above: [{name, price, cite}, ...],
  untaken_below: [{name, price, cite}, ...],
  overnight_verdict: "extending_htf" | "retracing_htf" | "consolidating",
  path_to_destination: "clear" | "capped_by_<level>" | "contradicted_by_<level>"
}
```

`path_to_destination`: between current price and `primary_draw`, what's in the way? "clear" = no untaken HTF level blocking; "capped_by_<name>" = a level must break first; "contradicted_by_<name>" = a level reached above/below the draw would flip the read.

### Step 4 — Pillar 2 Quality

Read `brief_digest.symbols.<sym>.pillar2.{current_tf, m5, m15}` + `brief_digest.symbols.<sym>.htf.h4.quality` + `brief_digest.symbols.<sym>.htf.h1.quality`. Cite each.

Surface as `htf_quality` + `pillar2_verdict`:
```
htf_quality: {
  h4: { range_quality, displacement, candle, cite: "engine_by_tf.h4.quality" },
  h1: { range_quality, displacement, candle, cite: "engine_by_tf.h1.quality" }
}
pillar2_verdict: "good" | "marginal" | "poor"
```

Strategy §3: "4H/1H candles show real displacement and decent-sized PD arrays."

### Step 5 — Deterministic Grade

| Grade | Rule |
|---|---|
| `A+` | HTF agrees across ≥2 of D/4H/1H with cited evidence AND ≥1 untaken HTF draw remains AND Pillar 2 `range_quality=good` + `displacement∈{clean,acceptable}` + `candle≠doji_wick`. |
| `B` | Pillars 1+2 align with EXACTLY ONE weaker element. |
| `no-trade` | ≥2 weak/missing elements, OR any HTF TF NEUTRAL because data wasn't read, OR `gates.engine.meta.stale: true`. Must set `no_trade_reason`. |

`no_trade_reason` enum — required when `pillar_grade=no-trade`:
- `data_gap` — bundle missing fields that should be present
- `engine_stale` — `gates.engine.meta.stale: true`
- `pillar2_poor` — chop / low quality (soft short-circuit — open-reaction can still recover)
- `htf_unclear` — HTF TFs all NEUTRAL or contradictory (soft)
- `session_closed` — market closed / non-trading day

### Step 6 — Scenarios

Build 2-4 IF/THEN. Each `condition` and `action` must cite a level from `brief_digest.symbols.<sym>.ltf_context.*` or `pillar1.session_levels.*`.

### Step 7 — Sizing Note

Use the sizing helper output. The user message will not pre-compute it; you must include the sizing call result as a citation. Format: `"0.75 R · Tue standard (strategy.sizing-table)"` or `"0.5 R · A+ but Mon-reduced (strategy.sizing-table, memory.USER)"`. Cite must contain `(strategy...)` or `(memory.USER)`.

### Step 8 — Self-check before surface_session_brief

- For each `htf_bias` row, the `note` cites at least one path at that TF: `brief_digest.symbols.<sym>.htf.<tf>` or sub-paths. Wrong-TF cites are bugs.
- `primary_draw.cite` matches `/engine_by_tf\.(daily|h4|h1)\.(fvgs|bprs)/`.
- Every numeric price in `brief`, scenarios, `anchored_target`, `anchored_stop` is followed by `(json.path)`.
- No arithmetic in prose. Ranges/deltas come from `brief_digest.*.range` or you write `n/a`.
- `pillar_grade` matches the deterministic rule.
- `key_levels[].name` uses canonical engine names (no parenthetical state suffixes).
- If `pillar_grade=no-trade`, `no_trade_reason` is set.
- The brief doesn't contradict itself — no "counter-HTF" scenarios when HTF wasn't captured.
- `chain_status: clean` unless something was degraded.

If any check fails, fix the payload, then call `surface_session_brief`.

### Tool call

End with one `surface_session_brief` call per symbol — twice in `--pair`. Skip `surface_setup` / `surface_no_trade`.
```

- [ ] **Step 3: Sanity-check the prompt file still parses**

Run: `npm run smoke:fixtures`
Expected: 6/6 still pass. (No regression — the existing fixtures don't exercise the brief flow.)

- [ ] **Step 4: Commit**

```bash
git add app/main/prompts/analyze.md
git commit -m "feat(prompt): rewrite brief phase to cite brief_digest + step-by-step

7-step walk per symbol: HTF bias per-TF with strict per-TF citations,
primary_draw pick, overnight + path_to_destination, Pillar 2 with
HTF quality, deterministic grade with no_trade_reason enum,
scenarios, sizing note with cite. Self-check before tool call.

The brief now consumes brief_digest (top-level, reachable) instead
of pair.symbols.* (past Read window). Closes the 2026-05-26 honest-
no-trade root cause.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: analyze.md — rewrite `<phase name="open_reaction">` with leader logic + entry_model_priority

**Files:**
- Modify: `app/main/prompts/analyze.md`

- [ ] **Step 1: Replace the open_reaction phase**

Find `<phase name="open_reaction">...</phase>` and replace contents with:

```
**Goal:** First 15 min of NY (or NY PM). Read brief's handoffs, watch live engine, decide leader + LTF bias at minute 14.

**Required reads first:**
- `<sdir>/pillar1.md` frontmatter → `mnq:` + `mes:` sections with `primary_draw`, `htf_destination`, `path_to_destination`, `pillar_grade`, `no_trade_reason`.
- `<sdir>/pillar2.md` frontmatter → `pillar2_verdict` per symbol.

### Brief = no-trade gate (do this FIRST)

Branch on `pillar_grade` from pillar1.md:

| Grade | `no_trade_reason` | Behavior |
|---|---|---|
| `A+` / `B` | n/a | Normal flow below |
| `no-trade` | `data_gap` / `engine_stale` / `session_closed` | **Hard skip.** Write `open-reaction.md` with `chain_status: degraded:brief_no_trade_hard`, no ltf-bias.md write, no leader decision. Surface `surface_no_trade("brief no-trade: <reason>")`. Stop. |
| `no-trade` | `pillar2_poor` / `htf_unclear` | **Soft observe.** Continue to leader decision; at minute 14 write `ltf-bias.md` with `ltf_bias: stand_aside`, `chain_status: degraded:brief_no_trade_soft`. The model may flag in chat if conditions clearly recovered (doji_wick→engulfing + clean displacement). |

### Minutes 0-13 — per-bar observation

Read `gates.engine.confirmation.last_bar`, `gates.engine.pillar1.sweeps`, `gates.engine.most_recent_structure`, `pair.leader_evidence`.

Append to `<sdir>/open-reaction.md`:

```markdown
## Latest read (<timestamp>, +<minutes_into_phase>m)
MNQ disp_score=<n> (pair.leader_evidence.primary_disp_score) vs MES <n> (...secondary...), margin=<n>, threshold=<n>.
What each symbol did vs path_to_destination: <one sentence>.
```

### Minute 14 — DECISION (the two parallel writes)

#### A) Leader decision

Read `pair.leader_evidence` once more. Resolve leader:

| `reason` | Leader | `chain_status` |
|---|---|---|
| `primary_higher_disp_score` (margin ≥ threshold) | primary | `clean` |
| `secondary_higher_disp_score` (margin ≥ threshold) | secondary | `clean` |
| `inconclusive_margin_below_threshold` | **primary (default)** | `degraded:leader_inconclusive` |
| `no_fvgs_created_in_window` | **primary (default)** | `degraded:no_fvgs_in_window` |
| `secondary_engine_missing` | primary | `degraded:secondary_missing` |

Call `surface_leader_decision` with the chosen leader + evidence + reason verbatim from `pair.leader_evidence`.

#### B) LTF bias finalization

Computed on the chosen leader, using its `pillar1.<leader>` section + live engine.

Compute `entry_model_priority` from this decision tree:
```
if pillar2_verdict == "poor":            → "undecided"
elif htf_ltf_alignment == "divergent":   → "MSS" (LTF reversal at HTF level)
elif htf_ltf_alignment == "aligned":
   if recent failure_swings (mss+sweep): → "MSS"
   elif recent BoS in bias direction:    → "Trend"
   elif opposing FVG state=inverted:     → "Inversion"
   else:                                 → "undecided"
elif htf_ltf_alignment == "unclear":     → "undecided"
```

The `surface_ltf_bias` handler will cross-check this against `cli/lib/entry-model-priority.js`. Mismatches log a warning; the model's choice wins (but undecided is always honored).

Call `surface_ltf_bias` with:
```
{
  leader: "MNQ1!" (or whichever),
  ltf_bias: bullish | bearish | mixed | stand_aside,
  htf_ltf_alignment: aligned | divergent | unclear,
  is_retrace_day: true | false,    // divergent + HTF draw still untouched
  entry_model_priority: MSS | Trend | Inversion | undecided,
  priority_reason: "<one-line cite, e.g. 'failure_swings[0]'>",
  grade_cap: A+ | B,               // B if divergent (HTF/LTF clash)
  chain_status: clean | degraded:<reason> | divergent
}
```

### Divergence handling (HTF/LTF clash)

If `htf_ltf_alignment: divergent`:
- `ltf_bias` follows NY reaction direction
- `is_retrace_day: true`
- `grade_cap: B` (entry_hunt cannot surface A+ this session)
- `pillar1.<leader>.primary_draw` stays valid as end-of-day runner target
- `chain_status: divergent`

### Self-check before tool calls

- Leader decision uses verbatim `pair.leader_evidence.reason`
- `entry_model_priority` matches the decision tree
- `grade_cap` is `B` if and only if `htf_ltf_alignment == divergent`
- Backfill case (caught up after window) → `chain_status: backfilled:open_reaction` + `grade_cap: B`

If any check fails, fix the payload, then call `surface_leader_decision` + `surface_ltf_bias`.
```

- [ ] **Step 2: Run smoke fixtures**

Run: `npm run smoke:fixtures`
Expected: 6/6 pass.

- [ ] **Step 3: Commit**

```bash
git add app/main/prompts/analyze.md
git commit -m "feat(prompt): rewrite open_reaction phase with leader logic + entry_model_priority

Explicit brief = no-trade gate (hard vs soft per reason). Minute-14
leader decision with full reason table. surface_ltf_bias with
entry_model_priority computed mechanically from htf_ltf_alignment +
engine signals. Divergence handling caps grade at B and preserves
primary_draw as end-of-day runner.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: analyze.md — rewrite `<phase name="entry_hunt">` chain preamble

**Files:**
- Modify: `app/main/prompts/analyze.md`

- [ ] **Step 1: Locate entry_hunt phase**

Run: `grep -n '<phase name="entry_hunt">' app/main/prompts/analyze.md`

- [ ] **Step 2: Insert the chain-preamble at the top of the phase body**

In `app/main/prompts/analyze.md`, find `<phase name="entry_hunt">` and immediately after that line, BEFORE the existing "**Goal:**" line, insert this preamble block:

```
### Chain preamble (do this BEFORE walking any model)

Leader-first read order so per-symbol gates apply to the right symbol:

```
1. Read pair-decision.json   → leader = <symbol>|null.
                               If null and pair-decision missing → route to <phase name="catch_up">.
2. Read pillar1.md           → brief.<leader>.pillar_grade + brief.<leader>.no_trade_reason.
                               If pillar_grade == "no-trade":
                                 - data_gap / engine_stale / session_closed → surface_no_trade verbatim, stop
                                 - pillar2_poor / htf_unclear → continue (ltf-bias's stand_aside gates below)
3. Read pillar1.md (mnq/mes section MATCHING leader) → primary_draw + path_to_destination + untaken_above/below.
4. Read pillar2.md frontmatter → pillar2_verdict.
                               If "poor" AND ltf_bias hasn't overridden → surface_no_trade.
5. Read ltf-bias.md          → ltf_bias, htf_ltf_alignment, is_retrace_day, entry_model_priority, grade_cap.
                               If ltf_bias == "stand_aside" → surface_no_trade, stop.
6. Read engine bundle (current TF, single-symbol on leader after short-circuit).
```

Emit a chat fact line per read with the `chain_status` from each file.

### Primary-draw validity (runtime check)

After step 3, check current state of `primary_draw`:

| `primary_draw.state` (live lookup at `primary_draw.cite`) | Behavior |
|---|---|
| `fresh` / `ce_tapped` / `inverted` | Still valid as anchor. Use as tp2_cite. |
| `filled` | Consumed; treat as continuation reference. |
| `invalidated` | Draw failed. Drop tp2_cite to the nearest untaken HTF level from `pillar1.<leader>.untaken_above` or `untaken_below`. Note in setup payload: `"grade_cap_reason": "primary_draw_invalidated"`. |

### Walking entry models with priority

After the chain preamble passes:
```
priority = ltf-bias.entry_model_priority
if priority != "undecided":
    walk(priority) first
    if all components present → emit setup with grade ≤ grade_cap, done
    else → walk other two models in fallback order
if priority == "undecided":
    walk all three models, pick the one with most components present
```

### Setup payload — chain closure

When emitting `surface_setup`, include explicit chain references:
```
{
  model: "Trend"|"MSS"|"Inversion",
  side: "long"|"short",
  leader_ref: "MNQ1!" (or active symbol),
  primary_draw_ref: "pillar1.<leader>.primary_draw",
  ltf_bias_ref: "ltf-bias.ltf_bias",
  entry: <num>, entry_cite: <path>,
  stop: <num>, stop_cite: <path>,
  tp1: <num>, tp1_cite: <path>,
  tp2: <num>, tp2_cite: "pillar1.<leader>.primary_draw.top" | "pillar1.<leader>.untaken_above[0].price" | <other HTF cite>,
  grade: "A+"|"B" (≤ grade_cap),
  grade_cap_reason: "divergent_ltf_overrode_htf" | "primary_draw_invalidated" | null,
  sizing: { r_size, day_factor, grade_factor, cite: "strategy.sizing-table + memory.USER" }
}
```

`tp2_cite` should reference the brief's identified primary_draw whenever still valid — closes the chain.
```

(Keep all existing per-model component walks below the chain preamble. The preamble augments — doesn't replace.)

- [ ] **Step 3: Run smoke fixtures**

Run: `npm run smoke:fixtures`
Expected: 6/6 pass.

- [ ] **Step 4: Commit**

```bash
git add app/main/prompts/analyze.md
git commit -m "feat(prompt): entry_hunt chain preamble + primary_draw validity + setup chain closure

6-step deterministic preamble reads pair-decision → pillar1 (with
no-trade branching) → pillar2 → ltf-bias → engine. Runtime check
on primary_draw state. Setup payload carries chain refs so tp2
closes back to the brief's primary_draw. Component walks unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 14: analyze.md — add `<phase name="catch_up">` block

**Files:**
- Modify: `app/main/prompts/analyze.md`

- [ ] **Step 1: Find where to add the new phase**

Run: `grep -n '<phase name="post_session">' app/main/prompts/analyze.md`
Expected: shows the post_session phase. Insert the new catch_up phase just before it.

- [ ] **Step 2: Add the catch_up phase block**

Immediately before `<phase name="post_session">` in `app/main/prompts/analyze.md`, insert:

```
<phase name="catch_up">

**Goal:** synthesize a missed `open_reaction` after the window has passed (NY open ≥ 09:45 ET but `ltf-bias.md` doesn't exist). Best-effort backfill so entry_hunt has the chain.

**Triggered by:** the bar-close router when (a) `ltf-bias.md` is missing, (b) `pillar1.md` exists, (c) current ET time is past the open-reaction window (09:45 NY AM / 13:45 NY PM).

**Required reads:**
- `pillar1.md` frontmatter → both symbols' `primary_draw` + `pillar_grade`.
- Live bundle including `pair.leader_evidence` (if `pair` present).

**Behavior:**

1. Run the leader decision + LTF bias synthesis exactly like `<phase name="open_reaction">` Minute 14, but on data that's drifted past the actual open.

2. Compute `backfill_lag_minutes` = (now ET) − (window start). Include in frontmatter.

3. Write `ltf-bias.md` with:
```yaml
---
phase: open_reaction_<session>_complete
finalized_at: <now>
backfilled: true
backfill_lag_minutes: <int>
leader: <chosen>
ltf_bias: <bullish|bearish|mixed|stand_aside>
htf_ltf_alignment: <aligned|divergent|unclear>
is_retrace_day: <bool>
entry_model_priority: <MSS|Trend|Inversion|undecided>
priority_reason: <one-line>
grade_cap: B                  # catch-up ALWAYS caps at B (we didn't see the actual open)
chain_status: backfilled:open_reaction
---
```

4. Also call `surface_leader_decision` (writes pair-decision.json) so subsequent `tv analyze --pair` short-circuits.

5. Chat output flags the backfill: "Backfilled open-reaction at <ET> (<lag>min late). Grade capped at B for this session."

After this fires, subsequent bars route to `<phase name="entry_hunt">` normally.

### Self-check

- `grade_cap: B` is mandatory (no A+ in backfilled sessions).
- `backfilled: true` and `backfill_lag_minutes` set.
- `chain_status: backfilled:open_reaction`.
- Both `surface_leader_decision` AND `surface_ltf_bias` fired in this turn.

</phase>

```

- [ ] **Step 3: Also update the phase routing table at the top**

Find the "Phase routing" or similar table near the start of `app/main/prompts/analyze.md` and add the catch_up row:

```
| `catch_up_ny_am`, `catch_up_ny_pm` | Backfill ltf-bias.md + pair-decision.json after a missed open-reaction window. Grade always capped at B. |
```

- [ ] **Step 4: Run smoke fixtures**

Run: `npm run smoke:fixtures`
Expected: 6/6 pass.

- [ ] **Step 5: Commit**

```bash
git add app/main/prompts/analyze.md
git commit -m "feat(prompt): add catch_up phase for backfilling missed open-reaction

New phase synthesizes ltf-bias.md + pair-decision.json from the
current bundle when the trader returns after 09:45 ET / 13:45 ET.
Always caps grade at B. Chat output flags the backfill explicitly.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 15: analyze.md — chain_status enum in rules

**Files:**
- Modify: `app/main/prompts/analyze.md`

- [ ] **Step 1: Locate the <rules> block**

Run: `grep -n '<rules>' app/main/prompts/analyze.md`

- [ ] **Step 2: Add the chain_status rule**

Inside the `<rules>` block, add as the final numbered rule:

```
8. **chain_status emission.** Every surface tool call (brief, ltf_bias, leader_decision) sets `chain_status`. Enum values:
   - `clean` — all inputs read, all outputs structured
   - `degraded:<reason>` — output produced with a caveat (e.g. `degraded:leader_inconclusive`, `degraded:brief_no_trade_soft`)
   - `backfilled:<phase>` — synthesized after the fact (catch_up only)
   - `divergent` — open_reaction found HTF/LTF clash
   - `stale:<minutes>` — upstream output older than N min vs the bar this phase fired on
```

- [ ] **Step 3: Run smoke fixtures**

Run: `npm run smoke:fixtures`
Expected: 6/6 pass.

- [ ] **Step 4: Commit**

```bash
git add app/main/prompts/analyze.md
git commit -m "feat(prompt): document chain_status enum in rules

Every surface tool call gets a chain_status field. Enum covers
clean / degraded:<r> / backfilled:<phase> / divergent / stale:<min>.
Wrap reads these for the chain audit.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 16: .claude/commands/analyze.md mirror

**Files:**
- Modify: `.claude/commands/analyze.md`

- [ ] **Step 1: Mirror the four phase rewrites + catch_up + chain_status rule**

For each of the four phases (`brief`, `open_reaction`, `entry_hunt`, `catch_up`) and the `<rules>` chain_status addition, apply the same edits to `.claude/commands/analyze.md` as Tasks 11-15 applied to `app/main/prompts/analyze.md`.

Use a diff between the two files to verify:
```bash
diff app/main/prompts/analyze.md .claude/commands/analyze.md | head -100
```

Acceptable differences: small wording variations from past drift. The new phases and chain_status rule must be present in both.

- [ ] **Step 2: Run smoke fixtures**

Run: `npm run smoke:fixtures`
Expected: 6/6 pass.

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/analyze.md
git commit -m "feat(slash): mirror analyze prompt rewrites in CLI slash command

Brief / open_reaction / entry_hunt / catch_up + chain_status enum
all mirrored.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 17: bar-close.js — route to catch_up when ltf-bias.md missing

**Files:**
- Modify: `app/main/bar-close.js`
- Create: `tests/catch-up.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/catch-up.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRouteToCatchUp } from '../app/main/bar-close.js';

describe('catch-up routing', () => {
  test('NY AM before 09:45 ET, no ltf-bias.md → normal flow (not catch-up)', () => {
    const r = shouldRouteToCatchUp({
      sessionPhase: 'open_reaction_ny_am',
      minutesIntoPhase: 5,
      pillar1Exists: true,
      ltfBiasExists: false,
    });
    assert.equal(r, false);
  });

  test('NY AM after 09:45 ET (post window), no ltf-bias.md, pillar1 exists → catch-up', () => {
    const r = shouldRouteToCatchUp({
      sessionPhase: 'entry_hunt_ny_am',
      minutesIntoPhase: 30,
      pillar1Exists: true,
      ltfBiasExists: false,
    });
    assert.equal(r, true);
  });

  test('NY AM after window, ltf-bias.md exists → normal flow (not catch-up)', () => {
    const r = shouldRouteToCatchUp({
      sessionPhase: 'entry_hunt_ny_am',
      minutesIntoPhase: 30,
      pillar1Exists: true,
      ltfBiasExists: true,
    });
    assert.equal(r, false);
  });

  test('No pillar1.md → not catch-up (different problem, entry_hunt surfaces brief_missing)', () => {
    const r = shouldRouteToCatchUp({
      sessionPhase: 'entry_hunt_ny_am',
      minutesIntoPhase: 30,
      pillar1Exists: false,
      ltfBiasExists: false,
    });
    assert.equal(r, false);
  });

  test('NY PM after 13:45, no ltf-bias.md, pillar1 exists → catch-up', () => {
    const r = shouldRouteToCatchUp({
      sessionPhase: 'entry_hunt_ny_pm',
      minutesIntoPhase: 30,
      pillar1Exists: true,
      ltfBiasExists: false,
    });
    assert.equal(r, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/catch-up.test.js`
Expected: All tests fail (function not exported yet).

- [ ] **Step 3: Add the helper to bar-close.js**

In `app/main/bar-close.js`, near the top exports, add:

```js
/**
 * Should this bar-close turn route into <phase name="catch_up"> instead
 * of the regular phase? True iff:
 * - We're past the open-reaction window (entry_hunt phase or later)
 * - pillar1.md exists (brief did fire)
 * - ltf-bias.md does NOT exist (open-reaction never ran or didn't finalize)
 *
 * The model will then run the backfill phase to synthesize ltf-bias.md +
 * pair-decision.json before continuing to entry_hunt.
 */
export function shouldRouteToCatchUp({ sessionPhase, minutesIntoPhase, pillar1Exists, ltfBiasExists }) {
  if (ltfBiasExists) return false;
  if (!pillar1Exists) return false;
  // Past the open-reaction window for NY AM or NY PM.
  if (sessionPhase === 'entry_hunt_ny_am' || sessionPhase === 'entry_hunt_ny_pm') return true;
  if (sessionPhase === 'post_ny_am' || sessionPhase === 'post_ny_pm') return true;
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/catch-up.test.js`
Expected: All 5 tests PASS.

- [ ] **Step 5: Wire it into the bar-close handler**

Find the main per-bar handler in `app/main/bar-close.js` (where the per-turn user prompt is composed — search for `phase:` or `userTurn`). Add the catch-up check before the prompt composition:

```js
// Check whether this bar-close should route into catch_up phase. If so,
// inject a directive into the user prompt so the model runs the backfill.
import { existsSync } from 'node:fs';
// ... (where the per-bar handler runs)

const pillar1Path = path.join(sdir, 'pillar1.md');
const ltfBiasPath = path.join(sdir, 'ltf-bias.md');
const isCatchUp = shouldRouteToCatchUp({
  sessionPhase: gates.session.phase,
  minutesIntoPhase: gates.session.minutes_into_phase,
  pillar1Exists: existsSync(pillar1Path),
  ltfBiasExists: existsSync(ltfBiasPath),
});

// When in catch-up mode, prepend a directive into the user prompt.
const catchUpPrefix = isCatchUp
  ? `**ROUTING:** This bar-close is in CATCH-UP mode — open-reaction window was missed. Follow <phase name="catch_up"> in the system prompt: backfill ltf-bias.md + pair-decision.json from current bundle, cap grade at B, then surface_no_trade for this bar (next bar will route normally).\n\n`
  : '';
```

Then prepend `catchUpPrefix` to the existing user prompt text where it's composed for the bar-close turn.

- [ ] **Step 6: Run all tests to verify**

Run: `npm run test:unit 2>&1 | tail -10`
Expected: All tests pass including the new catch-up tests.

- [ ] **Step 7: Commit**

```bash
git add app/main/bar-close.js tests/catch-up.test.js
git commit -m "feat(bar-close): route to catch_up phase when open-reaction missed

shouldRouteToCatchUp(): true iff past open-rxn window, pillar1.md
exists, ltf-bias.md doesn't. Per-bar handler prepends a routing
directive into the user prompt so the model backfills before
continuing. 5 unit tests cover the matrix.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 18: Prep.jsx — render chain_status chip + primary_draw cite tooltip

**Files:**
- Modify: `app/renderer/src/Prep.jsx`

- [ ] **Step 1: Add chain_status chip helper**

In `app/renderer/src/Prep.jsx`, after the `normalizeLevelName` helper, add:

```js
// Small status chip for chain_status. Cleaner than a colored border —
// the trader needs to know whether the brief ran cleanly at a glance.
function ChainStatusChip({ status }) {
  if (!status || status === 'clean') return null;
  const color = status.startsWith('degraded:') || status === 'divergent'
    ? 'var(--amber, #d4a657)'
    : status.startsWith('backfilled:')
    ? 'var(--amber, #d4a657)'
    : status.startsWith('stale:')
    ? 'var(--red, #c0473e)'
    : 'var(--label)';
  return (
    <span style={{
      display: 'inline-block',
      marginLeft: 8,
      padding: '1px 6px',
      border: `1px solid ${color}`,
      color,
      fontSize: 9,
      letterSpacing: '.1em',
      textTransform: 'uppercase',
      borderRadius: 2,
    }}>{status}</span>
  );
}
```

- [ ] **Step 2: Render the chip in the SESSION BRIEF panel title**

Find the `<Panel title={...}>` for the SESSION BRIEF and update its `right=` prop OR append the chip to the title:

```jsx
<Panel title={`SESSION BRIEF · ${SESSION_LABEL[brief.session] || ""}${selectedSymbol ? ` · ${selectedSymbol}` : ""}`}
       right={
         <span style={{ display: 'flex', alignItems: 'center' }}>
           <ChainStatusChip status={brief.chain_status} />
           <RefreshButton status={status} onClick={refresh} age={ageMs} briefTs={brief.ts} />
         </span>
       }>
```

- [ ] **Step 3: Add primary_draw tooltip in HTF BIAS or KEY LEVELS**

Locate the HTF BIAS panel rendering. Below it (or in a new small panel), render the primary_draw if present:

```jsx
{brief.primary_draw && (
  <Panel title="PRIMARY HTF DRAW">
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <span className="k">{brief.primary_draw.tf.toUpperCase()} {brief.primary_draw.kind} {brief.primary_draw.dir}</span>
      <span className="v" style={{ paddingLeft: 14 }}>
        {formatPx(brief.primary_draw.bottom)} – {formatPx(brief.primary_draw.top)}
        <span style={{ marginLeft: 8, color: 'var(--label)', fontSize: 11 }}>
          disp_score {brief.primary_draw.disp_score} · {brief.primary_draw.state}
        </span>
      </span>
    </div>
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <span className="k">DEST</span>
      <span className="v" style={{ paddingLeft: 14, color: 'var(--prose)' }}>{brief.htf_destination || '—'}</span>
    </div>
  </Panel>
)}
```

- [ ] **Step 4: Verify in the running app (skip if not running)**

If the app is up:
- Refresh the PREP page
- If the brief includes `chain_status: degraded:*`, the chip shows in the SESSION BRIEF title bar in amber.
- If the brief includes `primary_draw`, the PRIMARY HTF DRAW panel renders.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/Prep.jsx
git commit -m "feat(prep): render chain_status chip + PRIMARY HTF DRAW panel

ChainStatusChip shows non-clean states in amber/red on the SESSION
BRIEF title. New PRIMARY HTF DRAW panel surfaces the brief's anchor
PD array with its dimensions + disp_score + state + htf_destination
text. Only renders when fields are present.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 19: Fixture 004 — paired bundle with brief_digest

**Files:**
- Create: `tests/fixtures/004-brief-digest.bundle.json`
- Create: `tests/fixtures/004-brief-digest.expected.md`

- [ ] **Step 1: Generate the fixture by extending fixture 002**

Run:

```bash
node -e "
const bundle = require('./tests/fixtures/002-paired-mnq-mes.bundle.json');
const { buildBriefDigest } = require('./cli/lib/brief-digest.js');
const digest = buildBriefDigest(bundle);
bundle.brief_digest = digest;
require('fs').writeFileSync('./tests/fixtures/004-brief-digest.bundle.json', JSON.stringify(bundle, null, 2));
console.log('digest size:', JSON.stringify(digest).length, 'bytes');
"
```

If the cli/lib uses ESM-only syntax, use this instead:

```bash
node --input-type=module -e "
import bundleJson from './tests/fixtures/002-paired-mnq-mes.bundle.json' with { type: 'json' };
import { buildBriefDigest } from './cli/lib/brief-digest.js';
import fs from 'node:fs';
const bundle = JSON.parse(JSON.stringify(bundleJson));
bundle.brief_digest = buildBriefDigest(bundle);
fs.writeFileSync('./tests/fixtures/004-brief-digest.bundle.json', JSON.stringify(bundle, null, 2));
console.log('digest size:', JSON.stringify(bundle.brief_digest).length, 'bytes');
"
```

Expected: prints "digest size: ~5000-15000 bytes" and writes the fixture.

- [ ] **Step 2: Create the expected.md hand-graded reading**

Create `tests/fixtures/004-brief-digest.expected.md`:

```markdown
# Expected reading — paired bundle with brief_digest

## What this fixture exercises

A dual-symbol bundle with `brief_digest` populated. The verifier checks
that citations in this expected.md resolve through the brief_digest
paths.

## Sample citations (hand-graded, verify mechanically)

(Fill in 5-8 citations from the bundle. Pick paths that show:
1. `brief_digest.symbols.MNQ1!.htf.h4.top_fvgs[0].top` — a real number
2. `brief_digest.symbols.MNQ1!.htf.h4.recent_structures[0].level` — a real number
3. `brief_digest.symbols.MNQ1!.pillar1.session_levels.PDH.price` — a real number
4. `brief_digest.symbols.MES1!.htf.daily.change_pct` — a real string
5. `brief_digest.leader_evidence.reason` — a real string)

Use `jq` to read values:
```bash
jq '.brief_digest.symbols["MNQ1!"].htf.h4.top_fvgs[0].top' tests/fixtures/004-brief-digest.bundle.json
```

Then write the cites in this file like:
- Primary draw top: 29804 (brief_digest.symbols.MNQ1!.htf.h4.top_fvgs[0].top)
- Daily momentum: "16.28%" (brief_digest.symbols.MNQ1!.htf.daily.change_pct)
```

After writing the template, fill in actual values from the captured bundle using `jq` queries.

- [ ] **Step 3: Update scripts/verify-citations.js to handle brief_digest paths**

Run: `grep -n "engine_by_tf\|brief_digest" scripts/verify-citations.js | head -10`

The verifier should already handle arbitrary dotted/bracketed JSON paths. If `brief_digest.symbols["MNQ1!"].htf.h4.*` resolves cleanly, no change needed. If not, fix the path resolver.

Test: `node scripts/verify-citations.js tests/fixtures/004-brief-digest.expected.md tests/fixtures/004-brief-digest.bundle.json`
Expected: OK: N citation(s) verified.

- [ ] **Step 4: Add fixture to smoke**

If `scripts/smoke-fixtures.js` discovers fixtures by glob, no change needed. Otherwise add `004-brief-digest` to its fixture list.

Run: `npm run smoke:fixtures`
Expected: 7/7 pass (was 6/6 + new fixture).

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/004-brief-digest.bundle.json tests/fixtures/004-brief-digest.expected.md
git commit -m "test(fixture): 004 paired bundle with brief_digest

Extends fixture 002 with the computed brief_digest. expected.md
hand-grades citations through the new digest paths. Smoke now
covers the brief-digest-aware brief reading.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 20: Fixture 005 — divergent NY open

**Files:**
- Create: `tests/fixtures/005-divergent-ny-open.bundle.json`
- Create: `tests/fixtures/005-divergent-ny-open.expected.md`

- [ ] **Step 1: Build the fixture**

This fixture exercises the open_reaction divergence case. Build it by hand-editing fixture 004 (or another paired bundle) to make HTF bullish but recent 1m structure bearish:

Run:
```bash
cp tests/fixtures/004-brief-digest.bundle.json tests/fixtures/005-divergent-ny-open.bundle.json
```

Then edit `005-divergent-ny-open.bundle.json` to:
- Set `.brief_digest.symbols.MNQ1!.ltf_context.most_recent_structure` to `{event: "mss", dir: "bear", level: <some price below current>, ...}`.
- Keep HTF bullish in `.brief_digest.symbols.MNQ1!.htf.h4.recent_structures[0]`.

Easier: use `jq` to surgically swap one field:

```bash
jq '.brief_digest.symbols["MNQ1!"].ltf_context.most_recent_structure = {event: "mss", dir: "bear", level: 29400, displacement: true, confirmed_ms: 1779840000000, tier: "internal", validation: "sweep", is_reclaimed: false}' tests/fixtures/004-brief-digest.bundle.json > tests/fixtures/005-divergent-ny-open.bundle.json
```

- [ ] **Step 2: Hand-grade expected.md**

Create `tests/fixtures/005-divergent-ny-open.expected.md`:

```markdown
# Expected reading — divergent NY open

This fixture exercises the HTF/LTF clash case. HTF is bullish; recent 1m
structure went bearish (mss bear at 29400). The expected reading is:
- htf_ltf_alignment: divergent
- ltf_bias: bearish
- is_retrace_day: true
- grade_cap: B
- entry_model_priority: MSS
- primary_draw stays valid as runner target

Cites:
- HTF bullish bos: 29804.75 (brief_digest.symbols.MNQ1!.htf.h4.recent_structures[0].level)
- LTF bear mss: 29400 (brief_digest.symbols.MNQ1!.ltf_context.most_recent_structure.level)

(Fill in 3-5 more cites from the bundle.)
```

- [ ] **Step 3: Run smoke**

Run: `npm run smoke:fixtures`
Expected: 8/8 pass.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/005-divergent-ny-open.bundle.json tests/fixtures/005-divergent-ny-open.expected.md
git commit -m "test(fixture): 005 divergent NY open (HTF bullish + LTF bearish)

Exercises the open_reaction divergence path: grade caps at B,
is_retrace_day=true, entry_model_priority=MSS, primary_draw stays
valid as end-of-day runner.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 21: session-wrap.js — chain_audit block in summary.md

**Files:**
- Modify: `app/main/session-wrap.js`

- [ ] **Step 1: Locate the summary write**

Run: `grep -n "summary.md\|wrap\|writeSummary" app/main/session-wrap.js | head -10`

- [ ] **Step 2: Update the summary rendering to include chain_audit**

In the wrap turn's prompt (in `app/main/session-wrap.js`), update the summary template to require a `chain_audit` frontmatter block:

```yaml
---
session: ny-am
date: 2026-05-26
wrapped_at: <gates.session.timestamp_et>
chain_audit:
  brief: { fired_at, primary_draw, htf_destination, pillar_grade, chain_status, no_trade_reason }
  open_reaction: { fired_at, leader, ltf_bias, htf_ltf_alignment, grade_cap, chain_status, backfilled }
  entry_hunt: { setups_count, fired_setups, max_grade_reached, chain_status }
  outcome: { setups_won, setups_lost, total_r, primary_draw_reached: bool }
---
```

Modify the prompt that asks for `surface_session_summary` to include reading + emitting this chain_audit block. Specifically, find the wrap prompt body and add a step:

```
Before writing summary.md, read:
- <sdir>/pillar1.md frontmatter → brief.primary_draw, brief.htf_destination, brief.pillar_grade, brief.chain_status
- <sdir>/ltf-bias.md frontmatter → open_reaction.leader, ltf_bias, htf_ltf_alignment, grade_cap, chain_status, backfilled
- <sdir>/setups.jsonl → count + outcomes
- engine bundle quote.last → did price reach primary_draw?

Emit a `chain_audit:` block in the summary.md frontmatter with these structured facts. The bias_picture paragraph should narratively explain what the chain produced (brief said X, NY did Y, entry-hunt fired Z, hit/missed W).
```

- [ ] **Step 3: Run any wrap-related tests + smoke**

Run: `npm run test:unit 2>&1 | tail -10 && npm run smoke:fixtures 2>&1 | tail -5`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add app/main/session-wrap.js
git commit -m "feat(wrap): chain_audit block in summary.md frontmatter

Wrap prompt now reads pillar1.md + ltf-bias.md + setups.jsonl
frontmatter and emits a chain_audit block summarizing what the
chain produced. Tomorrow's brief reads this via <recent_sessions>
for cross-day pattern detection.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 22: CLAUDE.md — decision row + updated analyze recipe

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a decision row**

Find the decision table in `CLAUDE.md` (it ends with the most recent date 2026-05-26 entries). Append:

```
| 2026-05-26 | Strategy chain (brief → open_reaction → entry_hunt → wrap) | Soft-handoff chain: each phase emits structured frontmatter; downstream phases mechanically consume. New top-level `brief_digest` field at the start of paired bundles (~5-15KB per symbol vs 152KB) fixes the "HTF unreachable through Read" bug. New pure helpers: `cli/lib/brief-digest.js` (ranks top FVGs/BPRs/structures + quality + pillar context per symbol), `cli/lib/sizing.js` (day × grade → R, with memory.USER override), `cli/lib/entry-model-priority.js` (decision tree from alignment + engine signals). Two surface tools gain new Zod fields: `surface_session_brief` gets `primary_draw`, `overnight_block`, `htf_quality`, `pillar2_verdict`, `no_trade_reason`, `chain_status`. `surface_ltf_bias` gets `leader`, `htf_ltf_alignment`, `is_retrace_day`, `entry_model_priority`, `grade_cap`, `chain_status`. Pillar1.md / pillar2.md become comparative (per-symbol mnq/mes sections) and re-render from disk on each surface call. Four prompt phases rewritten with explicit step walks + self-checks. New `<phase name="catch_up">` backfills missed open-reaction. Plan: docs/superpowers/plans/2026-05-26-strategy-chain-implementation.md. Spec: docs/superpowers/specs/2026-05-26-strategy-chain-design.md. |
```

- [ ] **Step 2: Update the analyze recipe section to mention brief_digest**

Find the "The `analyze` recipe" section (or "## The `analyze` recipe"). Add a note about brief_digest near the top:

```
**Brief digest.** When `--pair` is set, the bundle gains a top-level
`brief_digest.symbols.<sym>.{htf, pillar1, pillar2, ltf_context}` block
(~5-15KB per symbol). This is the field the brief turn reads — it's
slim enough to fit in Read's first chunk, unlike the full pair block
(304KB total, unreachable past chars 140k). The digest is computed in
`cli/lib/brief-digest.js` and ranks top FVGs/BPRs/structures by
(state=fresh DESC, took_liq DESC, disp_score DESC) per TF.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): strategy chain decision row + brief_digest in analyze recipe

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 23: Final smoke + tests + commit + push + PR

**Files:** none (verification only)

- [ ] **Step 1: Full unit test run**

Run: `npm run test:unit 2>&1 | tail -15`
Expected: All tests pass. Should be ≥ 150 (139 from PR #60 + new ones from this PR).

- [ ] **Step 2: Smoke fixtures**

Run: `npm run smoke:fixtures 2>&1 | tail -10`
Expected: 8/8 pass (6 + 2 new fixtures).

- [ ] **Step 3: Check git status + diff stat**

Run: `git status --short && git log --oneline main..HEAD`
Expected: shows the per-task commits from Tasks 1-22.

- [ ] **Step 4: Push**

Run: `git push -u origin <current-branch>`

Capture the URL printed by GitHub.

- [ ] **Step 5: Open PR**

Run:

```bash
gh pr create --title "feat(chain): strategy chain — brief_digest + structured handoffs + catch_up" --body "$(cat <<'EOF'
## Summary

Wires the brief → open_reaction → entry_hunt → wrap phases into a precise machine-readable chain, plus adds a slim brief_digest to fix the 2026-05-26 "HTF unreachable" root cause.

Spec: [docs/superpowers/specs/2026-05-26-strategy-chain-design.md](docs/superpowers/specs/2026-05-26-strategy-chain-design.md)
Plan: [docs/superpowers/plans/2026-05-26-strategy-chain-implementation.md](docs/superpowers/plans/2026-05-26-strategy-chain-implementation.md)

## Changes

- **brief_digest** at top of paired bundles. ~5-15KB per symbol vs 152KB. Reachable through Read.
- **Three pure helpers:** `brief-digest`, `sizing`, `entry-model-priority` — all TDD with unit tests.
- **Schema additions** to `surface_session_brief` (primary_draw, overnight_block, htf_quality, pillar2_verdict, no_trade_reason, chain_status) and `surface_ltf_bias` (leader, htf_ltf_alignment, is_retrace_day, entry_model_priority, grade_cap, chain_status).
- **Comparative pillar1.md/pillar2.md** rendering — per-symbol mnq/mes sections re-rendered from disk on each surface call.
- **Four phase rewrites:** brief (7-step walk + primary_draw pick), open_reaction (minute-14 leader + entry_model_priority resolver + divergence handling), entry_hunt (6-step chain preamble + primary_draw validity + chain-closure tp2_cite), new catch_up (backfill missed open-reaction, caps at B).
- **Catch-up routing** in bar-close.js when ltf-bias.md missing past 09:45 ET.
- **chain_audit block** in summary.md frontmatter — tomorrow's brief reads it for cross-day pattern detection.
- **Renderer:** chain_status chip + PRIMARY HTF DRAW panel on PREP.
- **Tests:** brief-digest (8), sizing (10), entry-model-priority (7), catch-up (5), brief-flow extensions. Plus fixtures 004 (paired with digest) + 005 (divergent NY).

## Strategy mapping

Every change traces to a strategy section. See spec §"Strategy authority".

## Test plan

- [x] `npm run test:unit` — all pass
- [x] `npm run smoke:fixtures` — 8/8
- [ ] Live verify next London brief: should produce a digest-cited brief with chain_status=clean
- [ ] Force-replay scenario: archive ltf-bias.md mid-NY-AM, watch catch_up kick in

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Report the PR URL**

The `gh pr create` output is the PR URL. Save it for the conversation.

---

## Self-review

After completing all tasks, verify:

1. **Spec coverage** — every spec section (§Architecture, §Brief phase, §Open-reaction, §Entry-hunt, §Catch-up, §Wrap, §Failure modes, §Testing) has at least one task. ✓
2. **No placeholders** — all tasks contain complete code, exact commands, expected outputs.
3. **Type consistency** — `chain_status` enum identical across surface tools and frontmatter. `entry_model_priority` enum identical across helper, schema, prompt.
4. **TDD** — every code-bearing task has test → fail → implement → pass → commit.
