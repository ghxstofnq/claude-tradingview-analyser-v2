# ORDERS popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ORDERS topbar popover — a manual market-order ticket that sizes from the per-trade risk in Settings + the live ICT structure, auto-picks (or accepts a typed/dropdown) stop, offers untaken session/PD/PW draws as TP, shows R:R and the current position, places to the confirmed account, and flattens in one tap.

**Architecture:** Main process owns all order math and the engine read (one tested source of truth); the renderer is a display surface over three IPC calls (`orderContext` / `orderPreview` / `placeManual`). The auto-stop + draws are gathered from a `tv analyze --pillar3-only` bundle's engine gates; sizing reuses one shared `sizeFromStop` (also used by the tranche manager); placement reuses the existing guardrails + confirmed-account routing.

**Tech Stack:** Node ESM, Electron main + preload, React renderer (Vite, no Vitest — renderer logic tested as pure helpers via `node --test`), `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-06-16-orders-popover-design.md`

**Working dir:** the worktree at `.claude/worktrees/sad-liskov-717397`, branch `feat/orders-popover`. Never run `npm test` in the main checkout (memory: tests-pollute-live-state).

---

### Task 0: Worktree test/build setup

**Files:** none (env only)

- [ ] **Step 1: Make node_modules available in the worktree** (the full suite + Vite build need it; pure `node --test` files don't, but later tasks do).

Run:
```bash
[ -e node_modules ] || ln -s /Users/anasqatanani/Documents/claude-tradingview-analyser-v2/node_modules node_modules
node --test tests/manual-order.test.js 2>/dev/null; echo "ok (expected: no test file yet)"
```
Expected: the symlink exists (or is created); the node --test line errors because the file doesn't exist yet — that's fine, it just proves the runner works.

---

### Task 1: Shared `sizeFromStop` + delegate the tranche manager

**Files:**
- Create: `app/main/execution/sizing-core.js`
- Modify: `app/main/execution/tranche-manager.js:148-157` (sizePacket delegates)
- Test: `tests/sizing-core.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/sizing-core.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sizeFromStop, pointValue, tickSize } from "../app/main/execution/sizing-core.js";

// Oracle = the ORIGINAL tranche-manager.sizePacket formula, inlined.
function oracle({ symbol, entry, stop, target }) {
  const pv = String(symbol || "").startsWith("MES") ? 5 : 2;
  const stopPts = Math.abs(Number(entry) - Number(stop));
  if (!(stopPts > 0)) return { contracts: 0, riskUsd: 0, withinTolerance: false };
  const riskPerC = stopPts * pv;
  const contracts = Math.max(1, Math.round(target / riskPerC));
  const riskUsd = Math.round(contracts * riskPerC);
  return { contracts, riskUsd, withinTolerance: Math.abs(riskUsd - target) <= 50 };
}

describe("sizing-core", () => {
  it("pointValue + tickSize", () => {
    assert.equal(pointValue("MNQ1!"), 2);
    assert.equal(pointValue("MES1!"), 5);
    assert.equal(tickSize("MNQ1!"), 0.25);
  });

  it("MNQ: 60pt stop, $120 risk → 1 contract @ $120, within tolerance", () => {
    const s = sizeFromStop({ symbol: "MNQ1!", entry: 21000, stop: 20940, riskUsd: 120 });
    assert.equal(s.contracts, 1);
    assert.equal(s.actualRiskUsd, 120);
    assert.equal(s.withinTolerance, true);
  });

  it("MNQ: tight 10pt stop, $120 risk → 6 contracts ($120)", () => {
    const s = sizeFromStop({ symbol: "MNQ1!", entry: 21000, stop: 20990, riskUsd: 120 });
    assert.equal(s.contracts, 6);
    assert.equal(s.actualRiskUsd, 120);
    assert.equal(s.withinTolerance, true);
  });

  it("MNQ: huge 500pt stop → 1 contract, $1000 risk, NOT within tolerance", () => {
    const s = sizeFromStop({ symbol: "MNQ1!", entry: 21000, stop: 20500, riskUsd: 120 });
    assert.equal(s.contracts, 1);
    assert.equal(s.actualRiskUsd, 1000);
    assert.equal(s.withinTolerance, false);
  });

  it("zero/invalid stop distance → 0c, not tradable", () => {
    const s = sizeFromStop({ symbol: "MNQ1!", entry: 21000, stop: 21000, riskUsd: 120 });
    assert.deepEqual(s, { contracts: 0, stopPts: 0, actualRiskUsd: 0, withinTolerance: false });
  });

  it("parity: matches the original sizePacket formula across a grid", () => {
    for (const symbol of ["MNQ1!", "MES1!"]) {
      for (const stopPts of [3, 7, 10, 25, 60, 120, 333, 500]) {
        for (const target of [120, 240, 60]) {
          const entry = 21000, stop = entry - stopPts;
          const got = sizeFromStop({ symbol, entry, stop, riskUsd: target });
          const exp = oracle({ symbol, entry, stop, target });
          assert.equal(got.contracts, exp.contracts, `${symbol} ${stopPts} ${target} contracts`);
          assert.equal(got.actualRiskUsd, exp.riskUsd, `${symbol} ${stopPts} ${target} risk`);
          assert.equal(got.withinTolerance, exp.withinTolerance, `${symbol} ${stopPts} ${target} tol`);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/sizing-core.test.js`
Expected: FAIL — cannot find module `sizing-core.js`.

- [ ] **Step 3: Create `sizing-core.js`**

```js
// app/main/execution/sizing-core.js
// One source of truth for size-from-stop math, shared by the manual ORDERS
// ticket and the tranche manager. Pure, no IO. The Math.max(1) floor +
// withinTolerance (±$50, whole contract) reproduce the original
// tranche-manager.sizePacket exactly — see tests/sizing-core.test.js parity.

export function pointValue(symbol) {
  return String(symbol || "").startsWith("MES") ? 5 : 2; // MES $5/pt, MNQ $2/pt
}
export function tickSize(/* symbol */) {
  return 0.25; // MNQ / MES tick
}

export function sizeFromStop({ symbol, entry, stop, riskUsd } = {}) {
  const pv = pointValue(symbol);
  const stopPts = Math.abs(Number(entry) - Number(stop));
  const target = Number(riskUsd);
  if (!(stopPts > 0) || !(target > 0)) {
    return { contracts: 0, stopPts: 0, actualRiskUsd: 0, withinTolerance: false };
  }
  const contracts = Math.max(1, Math.round(target / (stopPts * pv)));
  const actualRiskUsd = Math.round(contracts * stopPts * pv);
  return {
    contracts,
    stopPts,
    actualRiskUsd,
    withinTolerance: contracts >= 1 && Math.abs(actualRiskUsd - target) <= 50,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/sizing-core.test.js`
Expected: PASS (all cases incl. parity grid).

- [ ] **Step 5: Delegate `tranche-manager.sizePacket` to the shared sizer**

In `app/main/execution/tranche-manager.js`, add the import at the top of the file (with the other imports):
```js
import { sizeFromStop } from "./sizing-core.js";
```
Replace the `sizePacket` body (lines ~148-157) with:
```js
    sizePacket: (packet, cfg) => {
      const target = cfg.guards?.defaultRisk ?? 120;
      const s = sizeFromStop({ symbol: packet.symbol, entry: packet.entry, stop: packet.stop, riskUsd: target });
      return { contracts: s.contracts, riskUsd: s.actualRiskUsd, withinTolerance: s.withinTolerance };
    },
```
(Leave the local `pointValue` helper in tranche-manager.js — `openRiskUsd` still uses it.)

- [ ] **Step 6: Run the tranche manager's existing tests to confirm no regression**

Run: `node --test tests/tranche-manager.test.js tests/tranche-runtime.test.js tests/tranche-lifecycle.test.js`
Expected: PASS (sizePacket output is byte-identical to before).

- [ ] **Step 7: Commit**

```bash
git add app/main/execution/sizing-core.js app/main/execution/tranche-manager.js tests/sizing-core.test.js
git commit -m "feat(execution): shared sizeFromStop core; tranche sizePacket delegates" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: `manual-order.js` — gathering + decisions

**Files:**
- Create: `app/main/execution/manual-order.js`
- Test: `tests/manual-order.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/manual-order.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  structuralStopCandidates, untakenDraws, stopSideOptions,
  pickAutoStop, tpDrawsForSide, rr, buildOrderPreview,
} from "../app/main/execution/manual-order.js";

// Minimal bundle: price 21000. Structure: swing low 20940, swing high 21080,
// leg low 20970, leg high 21090, session NYAM.L 20900 / NYAM.H 21120.
// Untaken draws: above [NYAM.H 21120, EQH 21150], below [NYAM.L 20900, EQL 20850].
function bundle() {
  return {
    chart: { symbol: "MNQ1!" },
    quote: { last: 21000 },
    gates: { engine: {
      pillar3: { swings: {
        swing: [{ price: 20940, is_high: false, swept: false }, { price: 21080, is_high: true, swept: false }],
        internal: [],
      } },
      pillar2: { current_tf: { leg_high: 21090, leg_low: 20970 } },
      pillar1: {
        session_levels: {
          NYAM_L: { name: "NYAM.L", price: 20900, swept: false },
          NYAM_H: { name: "NYAM.H", price: 21120, swept: false },
        },
        untaken_buy_side_above: [{ name: "NYAM.H", price: 21120 }],
        untaken_pools_above: [{ kind: "eqh", price: 21150 }],
        untaken_sell_side_below: [{ name: "NYAM.L", price: 20900 }],
        untaken_pools_below: [{ kind: "eql", price: 20850 }],
      },
    } },
  };
}

describe("manual-order gathering", () => {
  it("structuralStopCandidates pulls swings + session levels + leg extremes", () => {
    const c = structuralStopCandidates(bundle());
    const prices = c.map((x) => x.price).sort((a, b) => a - b);
    assert.deepEqual(prices, [20900, 20940, 20970, 21080, 21090, 21120]);
  });
  it("untakenDraws splits + sorts (above asc, below desc), deduped", () => {
    const d = untakenDraws(bundle());
    assert.deepEqual(d.above.map((x) => x.price), [21120, 21150]);
    assert.deepEqual(d.below.map((x) => x.price), [20900, 20850]);
  });
  it("empty/garbage bundle → empty", () => {
    assert.deepEqual(structuralStopCandidates({}), []);
    assert.deepEqual(untakenDraws({}), { above: [], below: [] });
  });
});

describe("manual-order decisions", () => {
  const c = () => structuralStopCandidates(bundle());

  it("auto stop BUY = nearest level below entry minus 2-tick buffer", () => {
    // nearest below 21000 is leg_low 20970 → 20970 - 0.5 = 20969.5
    const s = pickAutoStop({ side: "buy", entry: 21000, candidates: c(), symbol: "MNQ1!" });
    assert.equal(s.price, 20969.5);
    assert.equal(s.levelPrice, 20970);
  });
  it("auto stop SELL = nearest level above entry plus 2-tick buffer", () => {
    // nearest above 21000 is swing_high 21080 → 21080 + 0.5 = 21080.5
    const s = pickAutoStop({ side: "sell", entry: 21000, candidates: c(), symbol: "MNQ1!" });
    assert.equal(s.price, 21080.5);
    assert.equal(s.levelPrice, 21080);
  });
  it("no candidate on the stop side → null", () => {
    const only = [{ kind: "swing_high", price: 21080, ref: "x" }];
    assert.equal(pickAutoStop({ side: "buy", entry: 21000, candidates: [], symbol: "MNQ1!" }), null);
    assert.equal(pickAutoStop({ side: "sell", entry: 21200, candidates: only, symbol: "MNQ1!" }), null);
  });
  it("stopSideOptions are side-filtered + nearest-first + buffered", () => {
    const opts = stopSideOptions({ side: "buy", entry: 21000, candidates: c(), symbol: "MNQ1!" });
    assert.deepEqual(opts.map((o) => o.levelPrice), [20970, 20940, 20900]);
    assert.equal(opts[0].stopPrice, 20969.5);
  });
  it("tpDrawsForSide BUY = above-entry only", () => {
    const d = untakenDraws(bundle());
    const tps = tpDrawsForSide({ side: "buy", entry: 21000, draws: d });
    assert.deepEqual(tps.map((x) => x.price), [21120, 21150]);
  });
  it("rr computes reward:risk to 1dp", () => {
    assert.equal(rr({ side: "buy", entry: 21000, stop: 20970, tp: 21120 }), 4);
    assert.equal(rr({ side: "buy", entry: 21000, stop: 20970, tp: null }), null);
  });
});

describe("buildOrderPreview", () => {
  const c = () => structuralStopCandidates(bundle());
  const d = () => untakenDraws(bundle());

  it("clean BUY: auto stop, sized, R:R when TP typed", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: null, typedTp: 21120, riskUsd: 120 });
    assert.equal(p.block, null);
    assert.equal(p.stop, 20969.5);
    assert.equal(p.stopSource, "leg_low");
    assert.ok(p.contracts >= 1);
    assert.equal(p.tp, 21120);
    assert.ok(p.rr > 0);
    assert.ok(p.tpDraws.length >= 1 && p.tpDraws[0].rr != null);
  });
  it("typed stop overrides auto", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: 20950, typedTp: null, riskUsd: 120 });
    assert.equal(p.stop, 20950);
    assert.equal(p.stopSource, "typed");
  });
  it("block no_stop when nothing beyond entry and none typed", () => {
    const p = buildOrderPreview({ side: "buy", entry: 19000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: null, typedTp: null, riskUsd: 120 });
    assert.equal(p.block, "no_stop");
  });
  it("block stop_wrong_side when typed stop is above entry on a long", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: 21050, typedTp: null, riskUsd: 120 });
    assert.equal(p.block, "stop_wrong_side");
  });
  it("block no_size when even 1 contract busts tolerance (huge stop)", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: 20500, typedTp: null, riskUsd: 120 });
    assert.equal(p.block, "no_size");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/manual-order.test.js`
Expected: FAIL — cannot find module `manual-order.js`.

- [ ] **Step 3: Create `manual-order.js`**

```js
// app/main/execution/manual-order.js
// Pure logic for the ORDERS manual ticket. No IO. Gathers structural stop
// candidates + untaken draws from a tv analyze bundle's engine gates, then
// computes the auto-stop, the TP draw list, sizing (sizing-core), and R:R.
import { sizeFromStop, tickSize } from "./sizing-core.js";

export const STOP_BUFFER_TICKS = 2; // place the stop this many ticks beyond the level
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const isLong = (side) => side === "buy" || side === "long";
function roundToTick(v, tick) { const t = tick || 0.25; return Math.round(v / t) * t; }

export function structuralStopCandidates(bundle) {
  const eng = bundle?.gates?.engine;
  if (!eng) return [];
  const out = [];
  const swings = eng.pillar3?.swings ?? {};
  for (const tier of ["swing", "internal"]) {
    const arr = swings[tier] ?? [];
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i]; const price = num(s?.price);
      if (price == null) continue;
      out.push({ kind: s.is_high ? "swing_high" : "swing_low", price, name: s.is_high ? "swing high" : "swing low", swept: s.swept === true, ref: `gates.engine.pillar3.swings.${tier}[${i}]` });
    }
  }
  const levels = eng.pillar1?.session_levels ?? {};
  for (const [key, lv] of Object.entries(levels)) {
    const price = num(lv?.price); if (price == null) continue;
    const name = String(lv?.name ?? key);
    out.push({ kind: name.endsWith("H") ? "session_level_high" : name.endsWith("L") ? "session_level_low" : "session_level", price, name, swept: lv?.swept === true, ref: `gates.engine.pillar1.session_levels.${key}` });
  }
  const q = eng.pillar2?.current_tf ?? {};
  if (num(q.leg_high) != null) out.push({ kind: "leg_high", price: num(q.leg_high), name: "leg high", ref: "gates.engine.pillar2.current_tf.leg_high" });
  if (num(q.leg_low) != null) out.push({ kind: "leg_low", price: num(q.leg_low), name: "leg low", ref: "gates.engine.pillar2.current_tf.leg_low" });
  return out;
}

export function untakenDraws(bundle) {
  const p1 = bundle?.gates?.engine?.pillar1 ?? {};
  const above = [], below = [];
  const pushUniq = (arr, item) => { if (item.price != null && !arr.some((x) => x.price === item.price)) arr.push(item); };
  (p1.untaken_buy_side_above ?? []).forEach((l, i) => pushUniq(above, { name: String(l?.name ?? "level"), price: num(l?.price), kind: "session_level", ref: `gates.engine.pillar1.untaken_buy_side_above[${i}]` }));
  (p1.untaken_pools_above ?? []).forEach((p, i) => pushUniq(above, { name: "EQH pool", price: num(p?.price), kind: "pool", ref: `gates.engine.pillar1.untaken_pools_above[${i}]` }));
  (p1.untaken_sell_side_below ?? []).forEach((l, i) => pushUniq(below, { name: String(l?.name ?? "level"), price: num(l?.price), kind: "session_level", ref: `gates.engine.pillar1.untaken_sell_side_below[${i}]` }));
  (p1.untaken_pools_below ?? []).forEach((p, i) => pushUniq(below, { name: "EQL pool", price: num(p?.price), kind: "pool", ref: `gates.engine.pillar1.untaken_pools_below[${i}]` }));
  above.sort((a, b) => a.price - b.price);
  below.sort((a, b) => b.price - a.price);
  return { above, below };
}

// structural levels on the stop side (below for long, above for short),
// nearest-first, each with the buffered stopPrice the picker would use.
export function stopSideOptions({ side, entry, candidates, symbol }) {
  const e = num(entry); if (e == null || !Array.isArray(candidates)) return [];
  const tick = tickSize(symbol); const buf = STOP_BUFFER_TICKS * tick; const long = isLong(side);
  const beyond = candidates.filter((c) => (long ? c.price < e : c.price > e));
  beyond.sort((a, b) => (long ? b.price - a.price : a.price - b.price));
  return beyond.map((c) => ({ kind: c.kind, name: c.name, levelPrice: c.price, stopPrice: roundToTick(long ? c.price - buf : c.price + buf, tick), ref: c.ref }));
}

export function pickAutoStop({ side, entry, candidates, symbol }) {
  const opts = stopSideOptions({ side, entry, candidates, symbol });
  if (!opts.length) return null;
  const o = opts[0];
  return { price: o.stopPrice, levelPrice: o.levelPrice, kind: o.kind, name: o.name, ref: o.ref };
}

export function tpDrawsForSide({ side, entry, draws }) {
  const e = num(entry); if (e == null || !draws) return [];
  return isLong(side) ? (draws.above ?? []).filter((d) => d.price > e) : (draws.below ?? []).filter((d) => d.price < e);
}

export function rr({ side, entry, stop, tp }) {
  const e = num(entry), s = num(stop), t = num(tp);
  if (e == null || s == null || t == null) return null;
  const risk = Math.abs(e - s); if (!(risk > 0)) return null;
  return Math.round((Math.abs(t - e) / risk) * 10) / 10;
}

export function buildOrderPreview({ side, entry, symbol, candidates, draws, typedStop, typedTp, riskUsd }) {
  const e = num(entry); const long = isLong(side);
  const auto = pickAutoStop({ side, entry: e, candidates, symbol });
  const typed = num(typedStop);
  const stop = typed != null ? typed : (auto?.price ?? null);
  const stopSource = typed != null ? "typed" : (auto ? auto.kind : null);
  const stopOptions = stopSideOptions({ side, entry: e, candidates, symbol });
  const tp = num(typedTp);
  const tpDraws = tpDrawsForSide({ side, entry: e, draws }).map((d) => ({ ...d, rr: rr({ side, entry: e, stop, tp: d.price }) }));

  let block = null;
  if (e == null) block = "no_price";
  else if (stop == null) block = "no_stop";
  else if (long ? stop >= e : stop <= e) block = "stop_wrong_side";

  let sizing = { contracts: 0, stopPts: 0, actualRiskUsd: 0, withinTolerance: false };
  if (!block) { sizing = sizeFromStop({ symbol, entry: e, stop, riskUsd }); if (!sizing.withinTolerance) block = "no_size"; }

  return {
    symbol, side, entry: e,
    stop, stopSource, stopAuto: auto, stopOptions,
    tp: tp ?? null, tpDraws,
    riskUsd: num(riskUsd),
    contracts: sizing.contracts, stopPts: sizing.stopPts, actualRiskUsd: sizing.actualRiskUsd, withinTolerance: sizing.withinTolerance,
    rr: rr({ side, entry: e, stop, tp }),
    block,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/manual-order.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/execution/manual-order.js tests/manual-order.test.js
git commit -m "feat(execution): manual-order pure logic — auto stop, TP draws, sizing, R:R" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: `order-context.js` — live structure + price reader

**Files:**
- Create: `app/main/execution/order-context.js`
- Test: `tests/order-context.test.js`

- [ ] **Step 1: Write the failing test** (covers the pure `parseBundle` path via an injected reader, so no CDP/CLI is needed)

```js
// tests/order-context.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseBundle } from "../app/main/execution/order-context.js";

function bundle() {
  return {
    chart: { symbol: "MNQ1!" },
    quote: { last: 21000 },
    gates: { engine: {
      pillar3: { swings: { swing: [{ price: 20940, is_high: false, swept: false }], internal: [] } },
      pillar2: { current_tf: { leg_high: 21090, leg_low: 20970 } },
      pillar1: {
        session_levels: { NYAM_L: { name: "NYAM.L", price: 20900, swept: false } },
        untaken_buy_side_above: [{ name: "NYAM.H", price: 21120 }],
        untaken_sell_side_below: [{ name: "NYAM.L", price: 20900 }],
        untaken_pools_above: [], untaken_pools_below: [],
      },
    } },
  };
}

describe("order-context.parseBundle", () => {
  it("extracts symbol, price, candidates, draws", () => {
    const ctx = parseBundle(bundle(), "test");
    assert.equal(ctx.symbol, "MNQ1!");
    assert.equal(ctx.price, 21000);
    assert.ok(ctx.candidates.length >= 3);
    assert.deepEqual(ctx.draws.above.map((x) => x.price), [21120]);
    assert.equal(ctx.stale, false);
    assert.equal(ctx.source, "test");
  });
  it("missing engine → stale", () => {
    const ctx = parseBundle({ chart: { symbol: "MNQ1!" }, quote: { last: 21000 } }, "test");
    assert.equal(ctx.stale, true);
    assert.deepEqual(ctx.candidates, []);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/order-context.test.js`
Expected: FAIL — cannot find module / export `parseBundle`.

- [ ] **Step 3: Create `order-context.js`**

```js
// app/main/execution/order-context.js
// Fresh structure + price for the ORDERS ticket. Prefers a recent
// state/last-scan.json (the live loop writes it during sessions); else runs an
// on-demand `analyze --pillar3-only` against the analysis chart (TV Desktop
// 9225). Caches the last good context in memory for the pure preview path.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./config.js";
import { structuralStopCandidates, untakenDraws } from "./manual-order.js";

const LAST_SCAN = path.join(REPO_ROOT, "state", "last-scan.json");
const ORDERS_SCAN = path.join(REPO_ROOT, "state", "orders-scan.json");

let _cache = null;

export function parseBundle(bundle, source) {
  const symbol = bundle?.chart?.symbol ?? null;
  const price = Number.isFinite(Number(bundle?.quote?.last)) ? Number(bundle.quote.last) : null;
  return {
    symbol, price,
    candidates: structuralStopCandidates(bundle),
    draws: untakenDraws(bundle),
    ts: Date.now(),
    source,
    stale: !bundle?.gates?.engine,
  };
}

function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }

export async function getOrderContext({ maxAgeMs = 30_000 } = {}) {
  // 1) recent last-scan from the live loop
  try {
    if (existsSync(LAST_SCAN) && Date.now() - statSync(LAST_SCAN).mtimeMs < maxAgeMs) {
      const b = readJson(LAST_SCAN);
      if (b?.gates?.engine) { _cache = parseBundle(b, "last-scan"); return _cache; }
    }
  } catch { /* fall through */ }
  // 2) on-demand pillar3-only analyze against the analysis chart
  try {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, "cli", "index.js"), "analyze", "--pillar3-only", "--out", ORDERS_SCAN], { cwd: REPO_ROOT, timeout: 15_000, encoding: "utf8" });
    if (r.status === 0) {
      const b = readJson(ORDERS_SCAN);
      if (b) { _cache = parseBundle(b, "fresh-analyze"); return _cache; }
    }
  } catch { /* fall through */ }
  // 3) last good cache, marked stale
  if (_cache) return { ..._cache, stale: true };
  return { symbol: null, price: null, candidates: [], draws: { above: [], below: [] }, ts: Date.now(), source: "none", stale: true };
}

export function cachedOrderContext() { return _cache; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/order-context.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/execution/order-context.js tests/order-context.test.js
git commit -m "feat(execution): order-context reader — live structure + price for the ticket" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: IPC handlers + preload + renderer adapter

**Files:**
- Modify: `app/main/ipc-execution.js` (3 handlers)
- Modify: `app/preload.cjs:95-113` (3 methods on the execution group)
- Modify: `app/renderer/src/execution/executionAdapter.js` (3 methods)

- [ ] **Step 1: Add the three IPC handlers**

In `app/main/ipc-execution.js`, inside `registerExecutionIpc()` (after the `execution:config` handler), add:
```js
  // ORDERS popover — manual market-order ticket. orderContext pulls fresh
  // structure + price (cached); orderPreview is pure over the cache; placeManual
  // re-fetches fresh, re-validates, runs guardrails, and places to the confirmed
  // account. All math lives here (single source of truth).
  ipcMain.handle("execution:orderContext", async (_e, arg = {}) => {
    try {
      const { getOrderContext } = await import("./execution/order-context.js");
      return { ok: true, context: await getOrderContext(arg) };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  ipcMain.handle("execution:orderPreview", async (_e, arg = {}) => {
    try {
      const { cachedOrderContext } = await import("./execution/order-context.js");
      const { buildOrderPreview } = await import("./execution/manual-order.js");
      const ctx = cachedOrderContext();
      if (!ctx) return { ok: false, error: "no_context" };
      const riskUsd = arg.riskUsd ?? readExecConfig().guards?.defaultRisk ?? 120;
      const preview = buildOrderPreview({ side: arg.side, entry: ctx.price, symbol: ctx.symbol, candidates: ctx.candidates, draws: ctx.draws, typedStop: arg.typedStop, typedTp: arg.typedTp, riskUsd });
      return { ok: true, preview, context: ctx };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  ipcMain.handle("execution:placeManual", async (_e, arg = {}) => {
    try {
      const { getOrderContext } = await import("./execution/order-context.js");
      const { buildOrderPreview } = await import("./execution/manual-order.js");
      const ctx = await getOrderContext({ maxAgeMs: 5_000 });
      const riskUsd = arg.riskUsd ?? readExecConfig().guards?.defaultRisk ?? 120;
      const preview = buildOrderPreview({ side: arg.side, entry: ctx.price, symbol: ctx.symbol, candidates: ctx.candidates, draws: ctx.draws, typedStop: arg.typedStop, typedTp: arg.typedTp, riskUsd });
      if (preview.block) return { ok: false, blocked: true, code: preview.block, preview };
      const gate = await guarded({ hasStop: preview.stop != null, sizing: { withinTolerance: preview.withinTolerance, contracts: preview.contracts, actualRisk: preview.actualRiskUsd }, guards: readExecConfig().guards });
      if (!gate.ok) return { ok: false, blocked: true, ...gate, preview };
      const result = await tvAdapter.placeOrder({ symbol: ctx.symbol, side: arg.side, type: "market", entry: ctx.price, stop: preview.stop, tp: preview.tp ?? undefined, contracts: preview.contracts });
      return { ok: true, result, preview };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
```

- [ ] **Step 2: Expose them in preload**

In `app/preload.cjs`, inside the `execution: { ... }` group (alongside `place`, `flatten`), add:
```js
    orderContext(opts) { return ipcRenderer.invoke("execution:orderContext", opts || {}); },
    orderPreview(p) { return ipcRenderer.invoke("execution:orderPreview", p); },
    placeManual(p) { return ipcRenderer.invoke("execution:placeManual", p); },
```

- [ ] **Step 3: Add them to the renderer adapter**

In `app/renderer/src/execution/executionAdapter.js`, add to the `executionAdapter` object:
```js
  orderContext: (p) => call("orderContext", p),
  orderPreview: (p) => call("orderPreview", p),
  placeManual: (p) => call("placeManual", p),
```

- [ ] **Step 4: Sanity-check the main bundle imports cleanly** (no test — just parse)

Run: `node --check app/main/ipc-execution.js && node --check app/main/execution/order-context.js && echo OK`
Expected: `OK` (no syntax errors).

- [ ] **Step 5: Commit**

```bash
git add app/main/ipc-execution.js app/preload.cjs app/renderer/src/execution/executionAdapter.js
git commit -m "feat(execution): IPC + bridge for ORDERS — orderContext/orderPreview/placeManual" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: `Orders.helpers.js` — renderer formatters

**Files:**
- Create: `app/renderer/src/Orders.helpers.js`
- Test: `tests/orders-helpers.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/orders-helpers.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDrawOption, formatStopSource, routingLabel, blockMessage } from "../app/renderer/src/Orders.helpers.js";

describe("orders helpers", () => {
  it("formatDrawOption: name · price · R", () => {
    assert.equal(formatDrawOption({ name: "NYAM.H", price: 21120, rr: 4 }), "NYAM.H · 21120 · 4R");
    assert.equal(formatDrawOption({ name: "EQH pool", price: 21150.25, rr: null }), "EQH pool · 21150.25");
  });
  it("formatStopSource maps kind to label", () => {
    assert.equal(formatStopSource("leg_low"), "leg low");
    assert.equal(formatStopSource("swing_high"), "swing high");
    assert.equal(formatStopSource("session_level_low"), "session level");
    assert.equal(formatStopSource("typed"), "typed");
    assert.equal(formatStopSource(null), "—");
  });
  it("routingLabel from account gate", () => {
    assert.equal(routingLabel({ confirmed: { id: "9256021", type: "paper" }, gate: { route: true } }), "paper · 9256021");
    assert.equal(routingLabel({ confirmed: null, gate: { route: false, needsConfirm: true } }), "confirm account");
    assert.equal(routingLabel({ confirmed: { id: "1", type: "live" }, gate: { route: false } }), "live blocked");
  });
  it("blockMessage is human", () => {
    assert.match(blockMessage("no_stop"), /stop/i);
    assert.match(blockMessage("stop_wrong_side"), /side/i);
    assert.match(blockMessage("no_size"), /size|\$50/i);
    assert.equal(blockMessage(null), "");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/orders-helpers.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `Orders.helpers.js`**

```js
// app/renderer/src/Orders.helpers.js
// Pure formatters for the ORDERS popover. No React — unit-tested via node --test.

export function formatDrawOption(d) {
  const r = d?.rr != null ? ` · ${d.rr}R` : "";
  return `${d?.name ?? "level"} · ${d?.price}${r}`;
}

const STOP_LABEL = {
  leg_low: "leg low", leg_high: "leg high",
  swing_low: "swing low", swing_high: "swing high",
  session_level_low: "session level", session_level_high: "session level", session_level: "session level",
  typed: "typed",
};
export function formatStopSource(kind) {
  if (!kind) return "—";
  return STOP_LABEL[kind] ?? kind;
}

export function routingLabel({ confirmed, gate } = {}) {
  if (confirmed && gate?.route) return `${confirmed.type} · ${confirmed.id}`;
  if (confirmed?.type === "live" && !gate?.route) return "live blocked";
  return "confirm account";
}

const BLOCK = {
  no_price: "No live price — refresh the structure read.",
  no_stop: "No stop — pick a level or type one.",
  stop_wrong_side: "Stop is on the wrong side of entry.",
  no_size: "No whole-contract size lands within $50 of your risk.",
};
export function blockMessage(code) { return code ? (BLOCK[code] ?? code) : ""; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/orders-helpers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/Orders.helpers.js tests/orders-helpers.test.js
git commit -m "test(execution): ORDERS renderer formatters + tests" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: `OrdersPopover.jsx` + App wiring + CSS

**Files:**
- Create: `app/renderer/src/OrdersPopover.jsx`
- Modify: `app/renderer/src/App.jsx` (import + render `<OrdersCell/>`, add `o` hotkey)
- Modify: `app/renderer/src/app.css` (a few `.orders-*` rules)

- [ ] **Step 1: Create `OrdersPopover.jsx`**

```jsx
// app/renderer/src/OrdersPopover.jsx
// ORDERS — manual market-order ticket. Sizes from the per-trade risk in Settings
// + live ICT structure; auto-picks the stop (typed/dropdown override); TP from
// untaken session/PD/PW draws; shows R:R + current position; places to the
// confirmed account; one-tap Flatten. All math in main (execution:order*).
import React, { useState, useEffect, useRef, useCallback } from "react";
import { executionAdapter } from "./execution/executionAdapter.js";
import { formatDrawOption, formatStopSource, routingLabel, blockMessage } from "./Orders.helpers.js";

const fmt = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));

function OrdersBody({ onToast }) {
  const [ctx, setCtx] = useState(null);
  const [acct, setAcct] = useState(null);
  const [pos, setPos] = useState(null);
  const [side, setSide] = useState("buy");
  const [typedStop, setTypedStop] = useState("");
  const [typedTp, setTypedTp] = useState("");
  const [risk, setRisk] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const debounce = useRef(null);

  const loadContext = useCallback(async (refresh = false) => {
    const r = await executionAdapter.orderContext({ refresh });
    if (r?.ok) setCtx(r.context);
  }, []);

  // on mount: context + account gate + risk default + position
  useEffect(() => {
    loadContext(false);
    window.api?.execution?.account?.get?.().then((r) => { if (r?.ok) setAcct(r); });
    window.api?.execution?.config?.get?.().then((r) => { if (r?.ok) setRisk(r.config?.guards?.defaultRisk ?? 120); });
  }, [loadContext]);

  // poll position
  useEffect(() => {
    let live = true;
    const tick = async () => { const r = await executionAdapter.state(); if (live && r?.ok) setPos(r.state?.position ?? null); };
    tick(); const id = setInterval(tick, 2000);
    return () => { live = false; clearInterval(id); };
  }, []);

  // recompute preview (debounced) whenever inputs change and a context exists
  useEffect(() => {
    if (!ctx || risk == null) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const r = await executionAdapter.orderPreview({
        side,
        typedStop: typedStop === "" ? null : Number(typedStop),
        typedTp: typedTp === "" ? null : Number(typedTp),
        riskUsd: Number(risk),
      });
      if (r?.ok) setPreview(r.preview);
    }, 150);
    return () => clearTimeout(debounce.current);
  }, [ctx, side, typedStop, typedTp, risk]);

  const place = async () => {
    setBusy(true);
    try {
      const r = await executionAdapter.placeManual({
        side,
        typedStop: typedStop === "" ? null : Number(typedStop),
        typedTp: typedTp === "" ? null : Number(typedTp),
        riskUsd: Number(risk),
      });
      onToast(r?.ok ? `ORDER SENT · ${side.toUpperCase()} ${preview?.contracts}c ${ctx?.symbol}` : `BLOCKED · ${r?.code ? blockMessage(r.code) : (r?.message || r?.error || "rejected")}`);
    } finally { setBusy(false); }
  };
  const flatten = async () => {
    const r = await executionAdapter.flatten({ symbol: ctx?.symbol });
    onToast(r?.ok ? `FLATTEN SENT · ${ctx?.symbol}` : `FLATTEN FAILED · ${r?.error || ""}`);
  };

  const routable = acct?.gate?.route === true;
  const blocked = preview?.block;
  const canPlace = routable && !blocked && !busy && preview?.contracts >= 1;

  return (
    <div className="orders-body">
      {/* position line */}
      <div className="orders-pos">
        {pos ? (
          <span>{pos.side?.toUpperCase()} {pos.qty} {pos.symbol} @ {fmt(pos.avgFill)} · uPnL {pos.uPnlUsd != null ? `$${fmt(pos.uPnlUsd)}` : "—"}</span>
        ) : <span className="dim">flat</span>}
      </div>

      {/* symbol + routing */}
      <div className="orders-row">
        <span className="lbl">SYMBOL</span>
        <span className="val">{ctx?.symbol ?? "—"}{ctx?.stale ? <span className="warn"> · structure stale</span> : null}</span>
        <span className="spacer" />
        <span className={"route " + (routable ? "ok" : "bad")}>{routingLabel(acct || {})}</span>
        <span className="pill ghost" onClick={() => loadContext(true)}>↻</span>
      </div>

      {/* side */}
      <div className="orders-row">
        <span className="lbl">SIDE</span>
        <span className={"pill " + (side === "buy" ? "on green" : "")} onClick={() => setSide("buy")}>BUY</span>
        <span className={"pill " + (side === "sell" ? "on red" : "")} onClick={() => setSide("sell")}>SELL</span>
        <span className="spacer" />
        <span className="lbl">PRICE</span><span className="val">{fmt(ctx?.price)}</span>
      </div>

      {/* stop */}
      <div className="orders-row">
        <span className="lbl">STOP</span>
        <input className="num" placeholder={preview?.stopAuto ? String(preview.stopAuto.price) : "type stop"} value={typedStop} onChange={(e) => setTypedStop(e.target.value)} />
        <select className="sel" value="" onChange={(e) => { if (e.target.value !== "") setTypedStop(e.target.value); }}>
          <option value="">{preview?.stopSource ? `auto: ${formatStopSource(preview.stopSource)} ${fmt(preview.stop)}` : "pick level…"}</option>
          {(preview?.stopOptions ?? []).map((o, i) => (
            <option key={i} value={o.stopPrice}>{formatStopSource(o.kind)} {fmt(o.levelPrice)} → {fmt(o.stopPrice)}</option>
          ))}
        </select>
        {typedStop !== "" && <span className="pill ghost" onClick={() => setTypedStop("")}>auto</span>}
      </div>

      {/* tp */}
      <div className="orders-row">
        <span className="lbl">TP</span>
        <input className="num" placeholder="optional" value={typedTp} onChange={(e) => setTypedTp(e.target.value)} />
        <select className="sel" value="" onChange={(e) => { if (e.target.value !== "") setTypedTp(e.target.value); }}>
          <option value="">pick draw…</option>
          {(preview?.tpDraws ?? []).map((d, i) => (
            <option key={i} value={d.price}>{formatDrawOption(d)}</option>
          ))}
        </select>
        {typedTp !== "" && <span className="pill ghost" onClick={() => setTypedTp("")}>clear</span>}
      </div>

      {/* risk + size + rr */}
      <div className="orders-row">
        <span className="lbl">RISK $</span>
        <input className="num" value={risk ?? ""} onChange={(e) => setRisk(e.target.value === "" ? "" : Number(e.target.value))} />
        <span className="spacer" />
        <span className="lbl">SIZE</span>
        <span className={"val " + (preview?.withinTolerance ? "" : "warn")}>{preview?.contracts ?? "—"}c · ${fmt(preview?.actualRiskUsd)}</span>
        <span className="lbl">R:R</span><span className="val">{preview?.rr != null ? `${preview.rr}R` : "—"}</span>
      </div>

      {/* block banner */}
      {blocked && <div className="orders-block">{blockMessage(blocked)}</div>}
      {!routable && <div className="orders-block">Account not routable — confirm an account in Settings.</div>}

      {/* actions */}
      <div className="orders-actions">
        <button className={"pill big " + (side === "buy" ? "green" : "red")} disabled={!canPlace} onClick={place}>
          PLACE {side.toUpperCase()}{preview?.contracts >= 1 ? ` ${preview.contracts}c` : ""}
        </button>
        <button className="pill big" disabled={!pos} onClick={flatten}>FLATTEN</button>
      </div>
    </div>
  );
}

export function OrdersCell() {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  useEffect(() => {
    const onOpen = (e) => {
      if (e.detail?.which === "orders") setOpen((o) => !o);
      if (e.detail?.which === "all-close") setOpen(false);
    };
    window.addEventListener("topbar:open-cell", onOpen);
    return () => window.removeEventListener("topbar:open-cell", onOpen);
  }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3000); return () => clearTimeout(id); }, [toast]);

  return (
    <div className={"cell pop-cell" + (open ? " open" : "")}
         onClick={(e) => { if (e.target.closest(".bt-popover")) return; setOpen((o) => !o); }}>
      <span className="k">ORDERS</span>
      {open && (
        <div className="bt-popover orders-pop" onClick={(e) => e.stopPropagation()}>
          <div className="head">
            <span className="t">ORDERS · manual ticket</span>
            <span className="spacer" style={{ flex: 1 }} />
            <span className="x" onClick={() => setOpen(false)}>×</span>
          </div>
          <div className="body">
            <OrdersBody onToast={setToast} />
            {toast && <div className="orders-toast">{toast}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into App.jsx**

In `app/renderer/src/App.jsx`:
- Add the import near the other Cell imports (after line 20 `import { ChatCell } ...`):
```js
import { OrdersCell } from "./OrdersPopover.jsx";
```
- Render it next to `<ChatCell .../>` (line ~275):
```jsx
        <ChatCell chats={chats} />
        <OrdersCell />
```
- Add the `o` hotkey in the keydown switch (after the `review` case, ~line 336):
```js
      else if (e.key === "o" || e.key === "O") which = "orders";
```

- [ ] **Step 3: Add CSS**

Append to `app/renderer/src/app.css`:
```css
/* ORDERS popover */
.orders-pop { width: 420px; }
.orders-body { display: flex; flex-direction: column; gap: 8px; padding: 4px 2px; }
.orders-pos { font-size: 12px; opacity: 0.9; padding: 4px 6px; background: var(--surface-2, #1a1a1a); border-radius: 4px; }
.orders-pos .dim { opacity: 0.5; }
.orders-row { display: flex; align-items: center; gap: 8px; }
.orders-row .lbl { font-size: 10px; letter-spacing: 0.06em; opacity: 0.6; min-width: 42px; }
.orders-row .val { font-size: 12px; font-variant-numeric: tabular-nums; }
.orders-row .val.warn, .orders-row .warn { color: #e0a200; }
.orders-row .spacer { flex: 1; }
.orders-row .num { width: 90px; background: var(--surface-2, #141414); border: 1px solid var(--border, #333); color: inherit; padding: 3px 6px; border-radius: 4px; font-variant-numeric: tabular-nums; }
.orders-row .sel { flex: 1; background: var(--surface-2, #141414); border: 1px solid var(--border, #333); color: inherit; padding: 3px 6px; border-radius: 4px; }
.orders-row .route.ok { color: #36c08a; }
.orders-row .route.bad { color: #e05a5a; }
.orders-block { font-size: 11px; color: #e0a200; background: rgba(224,162,0,0.08); border: 1px solid rgba(224,162,0,0.3); padding: 5px 8px; border-radius: 4px; }
.orders-actions { display: flex; gap: 8px; margin-top: 4px; }
.pill.big { flex: 1; padding: 8px; justify-content: center; }
.pill.big.green { background: #15402f; color: #4fd3a0; }
.pill.big.red { background: #421c1c; color: #e88; }
.pill.big:disabled { opacity: 0.4; cursor: not-allowed; }
.orders-toast { margin-top: 8px; font-size: 12px; text-align: center; padding: 6px; background: var(--surface-2, #1a1a1a); border-radius: 4px; }
```
(If `.pill`, `.pill.on`, `.pill.green/.red`, `.pill.ghost` already exist with different definitions, keep the existing ones and only add the `.pill.big*` + `.orders-*` rules — do not redefine `.pill`.)

- [ ] **Step 4: Compile-check the renderer (JSX transform)**

There is no `build` npm script — the app runs via vite dev + electron (`app/package.json`). To confirm the new JSX compiles, run a vite build pass:

Run: `cd app && npx vite build --outDir /tmp/orders-vite-check; cd ..`
Expected: the build completes (all JSX transformed). Ignore any electron-runtime externalization warnings — a *syntax* error in `OrdersPopover.jsx` would fail the transform. If `vite build` isn't configured for this app, fall back to launching `npm --prefix app run dev` and confirming the renderer loads with no console error mentioning ORDERS (then stop it).

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/OrdersPopover.jsx app/renderer/src/App.jsx app/renderer/src/app.css
git commit -m "feat(execution): ORDERS popover UI — ticket, draws dropdowns, R:R, flatten" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Full suite + final verification + PR

**Files:** none (verification)

- [ ] **Step 1: Run the full unit suite in the worktree**

Run: `npm test`
Expected: all green except the known pre-existing failures noted on `main` (e.g. `LLM provider selection` / `rotateMetricsFile` / `tvAlertCreate` — confirm the count of failures matches `main`, i.e. no NEW failures from this branch).

- [ ] **Step 2: Run the citation smoke (must be unaffected — no analyze schema change)**

Run: `npm run smoke:fixtures`
Expected: PASS (same count as before).

- [ ] **Step 3: Push + open the PR**

```bash
git push -u origin feat/orders-popover
gh pr create --title "feat(execution): ORDERS popover — manual market-order ticket" --body "$(cat <<'EOF'
## What

A new ORDERS topbar popover beside CHAT — a manual market-order ticket for discretionary trades.

- Sizes from the per-trade risk in Settings + live ICT structure (one shared `sizeFromStop`, also used by the tranche manager).
- Auto-picks the stop from nearest structure (2-tick buffer); a stop-draws dropdown or a typed value overrides.
- TP from a dropdown of untaken session/PD/PW draws (+ liquidity pools) beyond entry on the target side; or typed; or blank for stop-only.
- Shows R:R, current position, inline risk override; one-tap Flatten.
- Reuses the existing guardrails (valid stop · size in tolerance · per-trade max · daily halt) and confirmed-account routing — paper now, same ticket goes live once a live account is armed.

## Where

All order math lives in main (`sizing-core.js`, `manual-order.js`, `order-context.js`) behind three IPC calls (`orderContext` / `orderPreview` / `placeManual`); the renderer (`OrdersPopover.jsx` + `Orders.helpers.js`) is display only.

## Tests

`sizing-core` (incl. parity vs the original sizePacket), `manual-order` (auto-stop/draws/sizing/R:R/block reasons), `order-context` parsing, `orders-helpers` formatters. Full suite green (modulo pre-existing failures); smoke fixtures unchanged.

## Out of scope (v1)

Limit/typed-entry orders; BE/trail management (stays in LIVE); live placement (blocked until the deferred live-discovery spike + sign-off).

Spec: `docs/superpowers/specs/2026-06-16-orders-popover-design.md`
Plan: `docs/superpowers/plans/2026-06-16-orders-popover.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Post-merge paper smoke (manual, after deploy)** — after the PR merges and the app is pulled + restarted, the trader opens ORDERS on a paper account: pick BUY, confirm the auto-stop fills from structure and SIZE shows contracts, pick a TP draw and confirm R:R updates, PLACE, verify the paper position appears (and the stop/TP on the chart), then FLATTEN. This is the real broker-fill verification that unit tests can't cover.

---

## Notes for the implementer

- **Worktree only.** Run every test/build from `.claude/worktrees/sad-liskov-717397`, never the main checkout.
- **`analyze --pillar3-only`** drives TV Desktop on CDP 9225 — it must be running with the debug flag, else `getOrderContext` falls back to a stale cache and the stop field stays empty (the trader types one). This is the intended degraded path.
- **Single instrument.** ORDERS follows the analysis chart's symbol; the order is placed for that symbol. Keep the analysis chart on what you're trading.
- **No analyze schema change** — `smoke:fixtures` and the citation verifier are untouched.
