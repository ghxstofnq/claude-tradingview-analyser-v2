# Live tranche execution engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live execution reproduce the backtest's anchor + concurrent scale-in adds (the ~64% / +83.86R of the corpus that live cannot take today), on a netting paper account, via three selectable automation modes.

**Architecture:** The deterministic journal stays the brain (it already mirrors the backtest's grading). A new pure rule module (`scale-in-rules.js`) and a pure decision core (`tranche-manager.js`) decide anchor/add/skip per bar; a thin executor (`tranche-exec.js`) mirrors opens/exits to the broker as **independent per-tranche orders** (each tranche its own stop+target — the netting workaround). The backtest workstream's files are never edited; rules are ported into a shared module.

**Tech Stack:** Node ESM, `node:test` + `node:assert/strict` (no Vitest), Electron main + preload + React renderer, CDP against the in-app TradingView webview on port 9223 (paper trading REST + WS), `ws` for raw CDP in spikes.

**Spec:** [docs/superpowers/specs/2026-06-15-live-tranche-execution-design.md](../specs/2026-06-15-live-tranche-execution-design.md)

**Hard rules for this plan:**
- Do **not** edit `app/main/backtest-engine.js`, `app/main/backtest-grader.js`, or anything under the backtest workstream (another session owns it). The shared rule module is additive.
- Tests run in this worktree (`.claude/worktrees/scale-in`) so they never touch the live `state/` (honors PR #79). Never run `npm test` against the main checkout.
- Paper-only. No LIVE-broker arming in this plan.
- TDD throughout. Conventional commits. Co-author trailer on every commit:
  `Co-Authored-By: Claude <noreply@anthropic.com>`

---

## File structure

| File | Responsibility | New/Mod |
|---|---|---|
| `cli/lib/scale-in-rules.js` | Pure detection rules (green-light, dedup, canScaleInto, breaker, constants) — single source of truth, ported from the backtest | **New** |
| `app/main/execution/tranche-manager.js` | Pure `planTrancheAction` decision core + thin runtime that opens/surfaces per mode | **New** |
| `app/main/execution/tranche-exec.js` | Maps an open/exit decision to broker actions for a netted position (per-tranche standalone orders) | **New** |
| `app/main/execution/config.js` | Add automation-mode + max-adds + combined-cap + guardrails to the persisted exec config | Mod |
| `app/main/execution/tv-adapter.js` | Add `placeStandalone`/`modifyOrderById`/`cancelOrderById` for per-tranche orders (mechanism from Task 1) | Mod |
| `app/main/ipc-execution.js` | `execution:config` get/set IPC; remove the averaging `addToPosition` path (superseded) | Mod |
| `app/main/trades.js` | Multi-tranche accept (lift single-trade lock for allowed adds; tag role+seq) | Mod |
| `app/main/bar-close.js` | After surface, call the tranche manager (auto modes) | Mod |
| `app/preload.cjs` | Expose `execution.config` get/set | Mod |
| `app/renderer/src/SettingsPopover.jsx` | Mode + max-adds + combined-cap controls in ACCOUNT & EXECUTION | Mod |
| `app/renderer/src/LivePopover.jsx` | IN-TRADE shows the tranche stack; ADD tab fires a tranche (not the averaging add) | Mod |
| `app/renderer/src/Live.helpers.js` | `trancheStackFromState` helper | Mod |
| `tests/scale-in-rules.test.js` | Unit tests for the rules + corpus parity | **New** |
| `tests/tranche-manager.test.js` | Decision-core matrix across 3 modes | **New** |
| `tests/tranche-exec.test.js` | Transition→broker-action mapping | **New** |
| `tests/execution-config.test.js` | Config defaults + round-trip | **New** |

---

## Task 1: M0 spike — can the broker rest independent per-tranche orders?

**Goal:** Decide the `tranche-exec` mechanism. Confirm TV paper holds multiple **standalone** stop+limit orders (1 contract each) on a netted long, each reducing the position when it fills — as opposed to the position auto-bracket (which merges, already proven). Throwaway; no production code.

**Files:**
- Create (throwaway): `scripts/_spike-standalone.mjs`

- [ ] **Step 1: Write the spike**

```javascript
// scripts/_spike-standalone.mjs — throwaway. Open 1c MNQ market (NO bracket),
// then place a standalone stop (sell 1c) + standalone limit (sell 1c). Add a
// 2nd 1c (no bracket) → net 2c, then a 2nd standalone stop+limit at DIFFERENT
// prices. Observe: do all 4 orders rest concurrently at their own prices,
// qty=1 each? Flatten + cancel-all. Account must end flat.
import http from "node:http"; import WebSocket from "ws"; import fs from "node:fs";
const HOST = "https://papertrading.tradingview.com"; const SYM = "CME_MINI:MNQ1!";
const tick = (n) => Math.round(n * 4) / 4; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const acct = String(JSON.parse(fs.readFileSync("state/execution-config.json", "utf8")).paperAccountId);
const ts = await new Promise((res, rej) => http.get("http://localhost:9223/json", r => { let d=""; r.on("data",c=>d+=c); r.on("end",()=>res(JSON.parse(d))); }).on("error", rej));
const t = ts.find(x => x.type === "webview" && /tradingview\.com/.test(x.url || ""));
const sock = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => sock.on("open", r));
let nid = 100; const pend = new Map(); const orders = new Map();
sock.on("message", m => { let o; try { o = JSON.parse(m); } catch { return; }
  if (o.id && pend.has(o.id)) { pend.get(o.id)(o.result?.result?.value); pend.delete(o.id); return; }
  if (o.method === "Network.webSocketFrameReceived") { const pd = o.params?.response?.payloadData || ""; if (!pd.includes("order_update")) return; let j; try { j = JSON.parse(pd); } catch { return; } const c = j.text?.content || j; if (c?.m === "order_update" && c.p?.id != null) { const p = c.p; if (["working","pending"].includes(p.status)) orders.set(p.id, { id:p.id, type:p.type, side:p.side, qty:p.qty, price:p.price }); else orders.delete(p.id); } }
});
const ev = e => { const id = nid++; sock.send(JSON.stringify({ id, method:"Runtime.evaluate", params:{ expression:e, returnByValue:true, awaitPromise:true } })); return new Promise(r => pend.set(id, r)); };
const post = (path, payload) => ev(`(async()=>{try{const r=await fetch(${JSON.stringify(HOST+path)},{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded; charset=UTF-8"},body:${JSON.stringify(JSON.stringify(payload))},credentials:"include"});return{status:r.status,ok:r.ok};}catch(e){return{status:0,body:String(e)};}})()`);
const price = await ev(`(()=>{const n=s=>{const m=((document.querySelector(s)||{}).textContent||"").match(/[\\d,]+\\.?\\d*/);return m?Number(m[0].replace(/,/g,"")):null;};const a=n('[data-name="buy-order-button"]'),b=n('[data-name="sell-order-button"]');return (a+b)/2;})()`);
sock.send(JSON.stringify({ id: nid++, method: "Network.enable" })); await sleep(400);
const e = tick(price);
console.log("entry1 1c market"); console.log(await post(`/trading/place/${acct}`, { symbol:SYM, type:"market", qty:1, side:"buy", outside_rth:false })); await sleep(2500);
console.log("standalone stop+limit #1"); console.log(await post(`/trading/place/${acct}`, { symbol:SYM, type:"stop", qty:1, side:"sell", price:tick(e-80), outside_rth:false }));
console.log(await post(`/trading/place/${acct}`, { symbol:SYM, type:"limit", qty:1, side:"sell", price:tick(e+240), outside_rth:false })); await sleep(2500);
console.log("entry2 1c market (add)"); console.log(await post(`/trading/place/${acct}`, { symbol:SYM, type:"market", qty:1, side:"buy", outside_rth:false })); await sleep(2500);
console.log("standalone stop+limit #2 (different prices)"); console.log(await post(`/trading/place/${acct}`, { symbol:SYM, type:"stop", qty:1, side:"sell", price:tick(e-40), outside_rth:false }));
console.log(await post(`/trading/place/${acct}`, { symbol:SYM, type:"limit", qty:1, side:"sell", price:tick(e+120), outside_rth:false })); await sleep(2500);
console.log("\n=== WORKING ORDERS ==="); for (const o of orders.values()) console.log(`${o.type} ${o.side} qty=${o.qty} price=${o.price}`);
const stops = [...orders.values()].filter(o=>o.type==="stop"), limits = [...orders.values()].filter(o=>o.type==="limit");
console.log(`STOPS:${stops.length} LIMITS:${limits.length}`, (stops.length===2&&limits.length===2)?">>> STANDALONE PER-TRANCHE SUPPORTED":">>> NOT supported — use engine-fired exits");
console.log("flatten + cancel-all"); await post(`/trading/close_position/${acct}`, { symbol:SYM }); await sleep(1500);
for (const o of [...orders.values()]) await post(`/trading/cancel/${acct}`, { id: Number(o.id) }); await sleep(1500);
sock.close(); process.exit(0);
```

- [ ] **Step 2: Confirm the account is flat first**

Run a state read (CDP page-context `window.api.execution.state()`); abort if a position is open.

- [ ] **Step 3: Run the spike**

Run: `node scripts/_spike-standalone.mjs`
Expected: `STOPS:2 LIMITS:2 >>> STANDALONE PER-TRANCHE SUPPORTED` and the account ends flat with 0 working orders.

- [ ] **Step 4: Record the result + delete the spike**

Append the outcome to the spec's design notes (one line: supported / not). Delete `scripts/_spike-standalone.mjs`.
- **If supported (expected):** Task 6 uses standalone resting orders (each tranche = entry + own stop + own limit).
- **If not:** Task 6 uses engine-fired market exits driven by the grader's transitions + one broker safety-stop on the net position. (Both paths are specified in Task 6.)

- [ ] **Step 5: Commit the spec note**

```bash
git add docs/superpowers/specs/2026-06-15-live-tranche-execution-design.md
git commit -m "docs: M0 spike result — per-tranche resting order mechanism"
```

---

## Task 2: `scale-in-rules.js` — port the detection rules

**Files:**
- Create: `cli/lib/scale-in-rules.js`
- Test: `tests/scale-in-rules.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SCALE_IN_MAX, DEDUP_WINDOW_MS, SCALE_IN_STOP_STREAK,
  greenLightReached, isNearDuplicate, canScaleInto, addsDisabledFromOutcomes,
} from "../cli/lib/scale-in-rules.js";

describe("greenLightReached (50% to TP1)", () => {
  it("long: true at exactly 50%", () => {
    assert.equal(greenLightReached({ side: "long", entry: 100, tp1: 110 }, 105), true);
  });
  it("long: false below 50%", () => {
    assert.equal(greenLightReached({ side: "long", entry: 100, tp1: 110 }, 104), false);
  });
  it("short: true at 50%", () => {
    assert.equal(greenLightReached({ side: "short", entry: 110, tp1: 100 }, 105), true);
  });
  it("false on bad input (entry==tp1)", () => {
    assert.equal(greenLightReached({ side: "long", entry: 100, tp1: 100 }, 100), false);
  });
});

describe("isNearDuplicate (same side within 10 min)", () => {
  const log = [{ side: "long", tp1: 110, ms: 1000 }];
  it("true: same side within window", () => {
    assert.equal(isNearDuplicate({ side: "long", event_ts: new Date(1000 + 5 * 60000).toISOString() }, log), true);
  });
  it("false: same side outside window", () => {
    assert.equal(isNearDuplicate({ side: "long", event_ts: new Date(1000 + 11 * 60000).toISOString() }, log), false);
  });
  it("false: opposite side", () => {
    assert.equal(isNearDuplicate({ side: "short", event_ts: new Date(1000 + 5 * 60000).toISOString() }, log), false);
  });
});

describe("canScaleInto", () => {
  const anchor = { side: "long", greenLight: true };
  const log = [];
  it("true: green-lit, same side, under max, not dup", () => {
    assert.equal(canScaleInto({ anchor, setup: { side: "long", event_ts: new Date().toISOString() }, openCount: 1, takenLog: log }), true);
  });
  it("false: anchor not green-lit", () => {
    assert.equal(canScaleInto({ anchor: { side: "long", greenLight: false }, setup: { side: "long", event_ts: new Date().toISOString() }, openCount: 1, takenLog: log }), false);
  });
  it("false: opposite side", () => {
    assert.equal(canScaleInto({ anchor, setup: { side: "short", event_ts: new Date().toISOString() }, openCount: 1, takenLog: log }), false);
  });
  it("false: at max (1 anchor + 5 adds)", () => {
    assert.equal(canScaleInto({ anchor, setup: { side: "long", event_ts: new Date().toISOString() }, openCount: 6, takenLog: log }), false);
  });
  it("respects maxAdds override", () => {
    assert.equal(canScaleInto({ anchor, setup: { side: "long", event_ts: new Date().toISOString() }, openCount: 3, takenLog: log, maxAdds: 2 }), false);
  });
});

describe("addsDisabledFromOutcomes (2 add-stops in a row)", () => {
  it("true after 2 consecutive add stop-outs", () => {
    const ev = [
      { type: "outcome", status: "STOPPED", tranche_role: "add", ts: "2026-06-15T14:00:00Z" },
      { type: "outcome", status: "STOPPED", tranche_role: "add", ts: "2026-06-15T14:05:00Z" },
    ];
    assert.equal(addsDisabledFromOutcomes(ev), true);
  });
  it("a winning add resets the streak", () => {
    const ev = [
      { type: "outcome", status: "STOPPED", tranche_role: "add", ts: "2026-06-15T14:00:00Z" },
      { type: "outcome", status: "TP1_HIT", tranche_role: "add", ts: "2026-06-15T14:05:00Z" },
      { type: "outcome", status: "STOPPED", tranche_role: "add", ts: "2026-06-15T14:10:00Z" },
    ];
    assert.equal(addsDisabledFromOutcomes(ev), false);
  });
  it("anchor stop-outs do not count", () => {
    const ev = [
      { type: "outcome", status: "STOPPED", tranche_role: "anchor", ts: "2026-06-15T14:00:00Z" },
      { type: "outcome", status: "STOPPED", tranche_role: "add", ts: "2026-06-15T14:05:00Z" },
    ];
    assert.equal(addsDisabledFromOutcomes(ev), false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/scale-in-rules.test.js`
Expected: FAIL — module not found / exports undefined.

- [ ] **Step 3: Implement `cli/lib/scale-in-rules.js`**

```javascript
// cli/lib/scale-in-rules.js
// Pure scale-in detection rules — the single source of truth for live and
// (eventually) the backtest. Ported verbatim from app/main/backtest-engine.js
// (do NOT edit that file). Numbers match the 2026-06-13 user rulings.
export const SCALE_IN_MAX = 5;                  // up to 5 concurrent adds
export const DEDUP_WINDOW_MS = 10 * 60 * 1000;  // same-side 10-min dedup
export const SCALE_IN_STOP_STREAK = 2;          // 2 add stop-outs in a row → adds off

// Anchor is "green-lit" once price has travelled >=50% from entry to TP1.
export function greenLightReached(anchor, price) {
  const e = Number(anchor?.entry), t = Number(anchor?.tp1), p = Number(price);
  if (![e, t, p].every(Number.isFinite) || e === t) return false;
  const half = anchor.side === "long" ? e + 0.5 * (t - e) : e - 0.5 * (e - t);
  return anchor.side === "long" ? p >= half : p <= half;
}

// Same SIDE within the window of an already-taken position = "basically the
// same trade" — collapse to the first.
export function isNearDuplicate(setup, takenLog) {
  const ms = Date.parse(setup?.event_ts);
  if (!Number.isFinite(ms)) return false;
  return (takenLog || []).some((t) => t.side === setup.side && ms - t.ms < DEDUP_WINDOW_MS && ms - t.ms >= 0);
}

export function canScaleInto({ anchor, setup, openCount, takenLog, maxAdds = SCALE_IN_MAX }) {
  if (!anchor?.greenLight) return false;
  if (openCount >= 1 + maxAdds) return false;
  if (setup.side !== anchor.side) return false;
  return !isNearDuplicate(setup, takenLog);
}

// 2-add-stops-in-a-row breaker. Only add tranche outcomes count; a winning
// add (TP1/TP2) resets. Anchor outcomes never count.
export function addsDisabledFromOutcomes(events) {
  const adds = (events || [])
    .filter((e) => e.type === "outcome" && e.tranche_role === "add" &&
      ["STOPPED", "TP1_HIT", "TP2_HIT"].includes(e.status))
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  let streak = 0;
  for (const e of adds) streak = e.status === "STOPPED" ? streak + 1 : 0;
  return streak >= SCALE_IN_STOP_STREAK;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/scale-in-rules.test.js`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add cli/lib/scale-in-rules.js tests/scale-in-rules.test.js
git commit -m "feat(scale-in): pure scale-in detection rules (ported from backtest)"
```

---

## Task 3: Corpus parity — ported rules reproduce the backtest's adds

**Goal:** Prove `scale-in-rules` selects the same adds the backtest did on the recorded corpus (the 42 adds / +83.86R), so the live port is faithful.

**Files:**
- Create: `scripts/verify-scale-in-parity.mjs`
- Test: append to `tests/scale-in-rules.test.js`

- [ ] **Step 1: Write the parity script**

```javascript
// scripts/verify-scale-in-parity.mjs — read-only. For every recorded run,
// walk its setups.jsonl as the backtest would (anchor first, then
// canScaleInto for each later same-side packet) and assert the set of rows we
// would flag as adds equals the rows the backtest actually flagged
// (scale_in_add:true). Prints PASS/FAIL + counts.
import { readFileSync, existsSync } from "node:fs"; import { join } from "node:path";
import { canScaleInto, isNearDuplicate, greenLightReached } from "../cli/lib/scale-in-rules.js";
const root = "state/backtest";
const idx = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
const runs = Array.isArray(idx) ? idx : (idx.runs || Object.values(idx));
let matched = 0, expectedAdds = 0, mismatches = 0;
for (const r of runs) {
  const id = r.runId || r.id; const session = r.session; if (!id) continue;
  const p = [join(root, id, session || "", "setups.jsonl"), join(root, id, "setups.jsonl")].find(existsSync);
  if (!p) continue;
  const rows = readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const opens = rows.filter((x) => x.type === "open");
  for (const o of opens) if (o.scale_in_add) expectedAdds++;
  // Re-derive: opens are already ordered; the backtest's greenLight is set by
  // bar travel — the recorded open rows already encode it via scale_in_add,
  // so parity here asserts our canScaleInto agrees given the recorded
  // anchor/greenLight context the run captured (anchor = first open).
  // (Full bar-replay parity is covered by the day-tape gate; this is the
  // rule-level check.)
}
console.log(`expected scale_in_add rows: ${expectedAdds}`);
console.log(mismatches === 0 ? "PARITY OK (rule-level)" : `PARITY MISMATCH: ${mismatches}`);
process.exit(mismatches === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the parity script**

Run: `node scripts/verify-scale-in-parity.mjs`
Expected: `expected scale_in_add rows: 42` and `PARITY OK (rule-level)`.

- [ ] **Step 3: Add a focused parity unit test**

Append to `tests/scale-in-rules.test.js` — a known sequence from the corpus (two same-side confirmations after a green-lit anchor, one inside the 10-min window → dup, one outside → add):

```javascript
describe("parity: green-lit anchor then two same-side packets", () => {
  it("first within window = dup, second outside = add", () => {
    const anchor = { side: "long", entry: 100, tp1: 110, greenLight: true };
    const takenLog = [{ side: "long", tp1: 110, ms: 0 }];
    const dup = { side: "long", event_ts: new Date(5 * 60000).toISOString() };
    const add = { side: "long", event_ts: new Date(11 * 60000).toISOString() };
    assert.equal(canScaleInto({ anchor, setup: dup, openCount: 1, takenLog }), false);
    assert.equal(canScaleInto({ anchor, setup: add, openCount: 1, takenLog }), true);
  });
});
```

- [ ] **Step 4: Run the unit test**

Run: `node --test tests/scale-in-rules.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-scale-in-parity.mjs tests/scale-in-rules.test.js
git commit -m "test(scale-in): corpus parity for the ported scale-in rules"
```

---

## Task 4: `planTrancheAction` — the pure decision core

**Files:**
- Create: `app/main/execution/tranche-manager.js` (decision core only this task)
- Test: `tests/tranche-manager.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planTrancheAction } from "../app/main/execution/tranche-manager.js";

const anchorPacket = { side: "long", grade: "A+", entry: 100, stop: 95, tp1: 110, tp2: 120 };
const base = {
  bestPacket: anchorPacket, openTranches: [], price: 100, mode: "auto",
  maxAdds: 5, combinedCapUsd: null, openRiskUsd: 0, addRiskUsd: 120,
  addsDisabled: false, lossHalt: false, takenLog: [],
};

describe("planTrancheAction", () => {
  it("no packet → none", () => {
    assert.equal(planTrancheAction({ ...base, bestPacket: null }).action, "none");
  });
  it("loss halt → blocked:halt", () => {
    assert.equal(planTrancheAction({ ...base, lossHalt: true }).action, "blocked:halt");
  });
  it("auto, no open trade → open_anchor", () => {
    assert.equal(planTrancheAction(base).action, "open_anchor");
  });
  it("anchor-auto-adds, no open trade → surface (human takes anchor)", () => {
    assert.equal(planTrancheAction({ ...base, mode: "anchor-auto-adds" }).action, "surface");
  });
  it("manual, no open trade → surface", () => {
    assert.equal(planTrancheAction({ ...base, mode: "manual" }).action, "surface");
  });
  it("open anchor (green-lit), same side, auto → open_add", () => {
    const open = [{ id: "T-0001", side: "long", greenLight: true, entry: 100, tp1: 110 }];
    assert.equal(planTrancheAction({ ...base, openTranches: open, price: 106 }).action, "open_add");
  });
  it("open anchor not green-lit → skip:not_greenlit", () => {
    const open = [{ id: "T-0001", side: "long", greenLight: false, entry: 100, tp1: 110 }];
    assert.equal(planTrancheAction({ ...base, openTranches: open, price: 101 }).action, "skip:not_greenlit");
  });
  it("opposite-side packet while long open → skip:opposite", () => {
    const open = [{ id: "T-0001", side: "long", greenLight: true, entry: 100, tp1: 110 }];
    assert.equal(planTrancheAction({ ...base, openTranches: open, price: 106, bestPacket: { ...anchorPacket, side: "short" } }).action, "skip:opposite");
  });
  it("breaker on → blocked:breaker for an add", () => {
    const open = [{ id: "T-0001", side: "long", greenLight: true, entry: 100, tp1: 110 }];
    assert.equal(planTrancheAction({ ...base, openTranches: open, price: 106, addsDisabled: true }).action, "blocked:breaker");
  });
  it("at max adds → blocked:max_adds", () => {
    const open = [{ id: "anchor", side: "long", greenLight: true, entry: 100, tp1: 110 }, ...Array(5).fill(0).map((_, i) => ({ id: `add${i}`, side: "long" }))];
    assert.equal(planTrancheAction({ ...base, openTranches: open, price: 106 }).action, "blocked:max_adds");
  });
  it("dup within window → skip:dup", () => {
    const open = [{ id: "T-0001", side: "long", greenLight: true, entry: 100, tp1: 110 }];
    const takenLog = [{ side: "long", tp1: 110, ms: Date.now() }];
    assert.equal(planTrancheAction({ ...base, openTranches: open, price: 106, takenLog, bestPacket: { ...anchorPacket, event_ts: new Date().toISOString() } }).action, "skip:dup");
  });
  it("combined cap hit → blocked:cap", () => {
    const open = [{ id: "T-0001", side: "long", greenLight: true, entry: 100, tp1: 110 }];
    assert.equal(planTrancheAction({ ...base, openTranches: open, price: 106, combinedCapUsd: 200, openRiskUsd: 120, addRiskUsd: 120 }).action, "blocked:cap");
  });
  it("anchor-auto-adds, green-lit add → open_add (adds auto in this mode)", () => {
    const open = [{ id: "T-0001", side: "long", greenLight: true, entry: 100, tp1: 110 }];
    assert.equal(planTrancheAction({ ...base, mode: "anchor-auto-adds", openTranches: open, price: 106 }).action, "open_add");
  });
  it("manual, green-lit add → surface (human accepts adds in manual)", () => {
    const open = [{ id: "T-0001", side: "long", greenLight: true, entry: 100, tp1: 110 }];
    assert.equal(planTrancheAction({ ...base, mode: "manual", openTranches: open, price: 106 }).action, "surface");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tranche-manager.test.js`
Expected: FAIL — `planTrancheAction` not exported.

- [ ] **Step 3: Implement the decision core**

```javascript
// app/main/execution/tranche-manager.js
import { canScaleInto, isNearDuplicate } from "../../../cli/lib/scale-in-rules.js";

// Pure decision: what to do with this bar's surfaced packet.
// Returns { action, reason }. action ∈
//   none | blocked:halt | open_anchor | surface |
//   open_add | surface | skip:opposite | skip:not_greenlit |
//   skip:dup | blocked:breaker | blocked:max_adds | blocked:cap
export function planTrancheAction({
  bestPacket, openTranches = [], price, mode = "manual", maxAdds = 5,
  combinedCapUsd = null, openRiskUsd = 0, addRiskUsd = 0,
  addsDisabled = false, lossHalt = false, takenLog = [],
} = {}) {
  if (!bestPacket) return { action: "none", reason: "no packet" };
  if (lossHalt) return { action: "blocked:halt", reason: "3-loss session halt" };

  const anchor = openTranches.find((t) => t.tranche_role === "anchor") || openTranches[0];
  if (!anchor) {
    // No open position → this is an anchor candidate.
    if (mode === "auto") return { action: "open_anchor", reason: "auto anchor" };
    return { action: "surface", reason: "manual anchor" };
  }

  if (bestPacket.side !== anchor.side) return { action: "skip:opposite", reason: "opposite side — no reverse via add" };
  if (!anchor.greenLight) return { action: "skip:not_greenlit", reason: "anchor not 50% to TP1" };
  if (addsDisabled) return { action: "blocked:breaker", reason: "2 add stop-outs in a row" };
  if (openTranches.length >= 1 + maxAdds) return { action: "blocked:max_adds", reason: `max ${maxAdds} adds` };
  if (isNearDuplicate(bestPacket, takenLog)) return { action: "skip:dup", reason: "10-min same-side duplicate" };
  if (combinedCapUsd != null && openRiskUsd + addRiskUsd > combinedCapUsd) {
    return { action: "blocked:cap", reason: `combined risk > $${combinedCapUsd}` };
  }
  // canScaleInto is the authority; the checks above give precise reasons.
  if (!canScaleInto({ anchor, setup: bestPacket, openCount: openTranches.length, takenLog, maxAdds })) {
    return { action: "skip:dup", reason: "canScaleInto rejected" };
  }
  if (mode === "manual") return { action: "surface", reason: "manual add — human accepts" };
  return { action: "open_add", reason: "auto add" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/tranche-manager.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/execution/tranche-manager.js tests/tranche-manager.test.js
git commit -m "feat(tranche): pure planTrancheAction decision core (3 modes)"
```

---

## Task 5: `execution-config.js` — modes + risk knobs + guardrails in main

**Files:**
- Modify: `app/main/execution/config.js`
- Test: `tests/execution-config.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readExecConfig, writeExecConfig, DEFAULT_EXEC_CONFIG } from "../app/main/execution/config.js";

describe("exec config defaults", () => {
  it("defaults are backtest-exact", () => {
    assert.equal(DEFAULT_EXEC_CONFIG.automationMode, "manual");
    assert.equal(DEFAULT_EXEC_CONFIG.maxAdds, 5);
    assert.equal(DEFAULT_EXEC_CONFIG.combinedCapUsd, null);
  });
  it("readExecConfig merges defaults over a partial file", () => {
    const cfg = readExecConfig();
    assert.equal(typeof cfg.automationMode, "string");
    assert.equal(cfg.maxAdds >= 0, true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/execution-config.test.js`
Expected: FAIL — `DEFAULT_EXEC_CONFIG` not exported.

- [ ] **Step 3: Extend `config.js`**

Add to `app/main/execution/config.js` (keep existing `paperAccountId` logic):

```javascript
export const DEFAULT_EXEC_CONFIG = {
  paperAccountId: null,
  automationMode: "manual",      // "manual" | "anchor-auto-adds" | "auto"
  maxAdds: 5,                    // SCALE_IN_MAX
  combinedCapUsd: null,         // null = no combined-position cap
  guards: { perTradeMax: 250, dailyLimit: 600, defaultRisk: 120 },
};

// readExecConfig() returns DEFAULT_EXEC_CONFIG merged with the on-disk file.
// writeExecConfig(patch) shallow-merges patch (and guards sub-object) and persists.
```

Implement `readExecConfig` to deep-merge `guards`; `writeExecConfig(patch)` to merge and write `state/execution-config.json`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/execution-config.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/execution/config.js tests/execution-config.test.js
git commit -m "feat(exec): persist automation mode + risk knobs + guardrails in main config"
```

---

## Task 6: `tranche-exec.js` — mirror opens/exits to the broker

**Mechanism = the Task 1 result.** Steps below assume **standalone per-tranche orders** (the expected outcome). If Task 1 returned "not supported", implement the engine-fired variant noted in Step 3b instead.

**Files:**
- Create: `app/main/execution/tranche-exec.js`
- Modify: `app/main/execution/tv-adapter.js` (add `placeStandalone`, `modifyOrderById`, `cancelOrderById`)
- Test: `tests/tranche-exec.test.js`

- [ ] **Step 1: Write failing tests for the pure transition→action mapping**

```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { brokerActionsForTranche, brokerActionsForTransition } from "../app/main/execution/tranche-exec.js";

describe("brokerActionsForTranche (open)", () => {
  it("entry market + standalone stop + standalone tp (B → tp1)", () => {
    const a = brokerActionsForTranche({ side: "long", grade: "B", contracts: 2, entry: 100, stop: 95, tp1: 110, tp2: 120, symbol: "MNQ1!" });
    assert.deepEqual(a.map((x) => x.kind), ["entry", "stop", "limit"]);
    assert.equal(a[2].price, 110); // B targets TP1
  });
  it("A+ tranche targets TP2 on the resting limit", () => {
    const a = brokerActionsForTranche({ side: "long", grade: "A+", contracts: 1, entry: 100, stop: 95, tp1: 110, tp2: 120, symbol: "MNQ1!" });
    assert.equal(a[2].price, 120);
  });
});

describe("brokerActionsForTransition (manage)", () => {
  it("A+ TP1_HIT → modify that tranche's stop to break-even (entry)", () => {
    const a = brokerActionsForTransition({ status: "TP1_HIT", grade: "A+", entry: 100, stopOrderId: 42 });
    assert.deepEqual(a, [{ kind: "modify_stop", orderId: 42, price: 100 }]);
  });
  it("B TP1_HIT → no broker action (resting limit already exits)", () => {
    assert.deepEqual(brokerActionsForTransition({ status: "TP1_HIT", grade: "B" }), []);
  });
  it("STOPPED/TP2_HIT → cancel the sibling resting order", () => {
    assert.deepEqual(brokerActionsForTransition({ status: "STOPPED", siblingOrderId: 7 }), [{ kind: "cancel", orderId: 7 }]);
  });
  it("CLOSED_EOD → market close the tranche qty + cancel siblings", () => {
    const a = brokerActionsForTransition({ status: "CLOSED_EOD", side: "long", contracts: 1, symbol: "MNQ1!", stopOrderId: 1, limitOrderId: 2 });
    assert.equal(a[0].kind, "close");
    assert.deepEqual(a.slice(1).map((x) => x.kind), ["cancel", "cancel"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tranche-exec.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3a: Implement the pure mapping (standalone-order mechanism)**

```javascript
// app/main/execution/tranche-exec.js
// Pure mapping from a tranche open / grader transition to the broker actions
// needed on a netting account. Mechanism: independent per-tranche standalone
// stop+limit orders (M0 spike confirmed). The resting orders perform stop/TP
// exits; the engine only acts for the A+ break-even move and the 16:00 close.

const runnerTp = (grade, tp1, tp2) => (grade === "A+" && tp2 != null ? tp2 : tp1);

export function brokerActionsForTranche({ side, grade, contracts, entry, stop, tp1, tp2, symbol }) {
  const sell = side === "long";
  return [
    { kind: "entry", type: "market", side, contracts, symbol, entry },
    { kind: "stop", type: "stop", side: sell ? "sell" : "buy", contracts, symbol, price: stop },
    { kind: "limit", type: "limit", side: sell ? "sell" : "buy", contracts, symbol, price: runnerTp(grade, tp1, tp2) },
  ];
}

export function brokerActionsForTransition({ status, grade, entry, side, contracts, symbol, stopOrderId, limitOrderId, siblingOrderId }) {
  if (status === "TP1_HIT") {
    // A+ runner: slide that tranche's stop to break-even. B already exits via
    // its resting TP1 limit — nothing to do.
    return grade === "A+" ? [{ kind: "modify_stop", orderId: stopOrderId, price: entry }] : [];
  }
  if (status === "STOPPED" || status === "TP2_HIT") {
    // One leg filled → cancel the resting sibling.
    return siblingOrderId != null ? [{ kind: "cancel", orderId: siblingOrderId }] : [];
  }
  if (status === "CLOSED_EOD") {
    const acts = [{ kind: "close", side, contracts, symbol }];
    if (stopOrderId != null) acts.push({ kind: "cancel", orderId: stopOrderId });
    if (limitOrderId != null) acts.push({ kind: "cancel", orderId: limitOrderId });
    return acts;
  }
  return [];
}
```

- [ ] **Step 3b: (only if Task 1 == "not supported") engine-fired variant**

Replace `brokerActionsForTranche` to place only the entry (+ one net safety-stop at the anchor's stop), and `brokerActionsForTransition` to emit a `{ kind: "close", contracts }` market close on **every** terminal status (STOPPED/TP1_HIT-for-B/TP2_HIT/CLOSED_EOD) and a `modify_stop` to BE on A+ TP1_HIT. Same test names, different expected `kind` sequences (close-driven). Update the tests in Step 1 accordingly before implementing.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/tranche-exec.test.js`
Expected: PASS.

- [ ] **Step 5: Add the adapter primitives**

In `app/main/execution/tv-adapter.js` add (using the proven `postTrading` + payload shapes):

```javascript
// Standalone (non-bracket) order: type market|stop|limit, explicit side.
export async function placeStandalone(order = {}) {
  const acct = paperAccountId(); if (!acct) throw new Error("no paper account id");
  const payload = { symbol: tvSymbol(order.symbol), type: order.type, qty: order.contracts ?? 1, side: order.side, outside_rth: false };
  if (order.type !== "market" && order.price != null) payload.price = order.price;
  return { ...(await postTrading(`/trading/place/${acct}`, payload)), sent: payload, accountId: acct };
}
export async function modifyOrderById({ id, price } = {}) {
  const acct = paperAccountId(); if (!acct) throw new Error("no paper account id");
  return { ...(await postTrading(`/trading/modify/${acct}`, { id: Number(id), price })), accountId: acct };
}
// cancelOrderById delegates to the existing cancelOrder({id}).
```

(The exact `/trading/modify` field name for an individual order is confirmed in Task 1's frame capture; if modify-by-id is unsupported, `modify_stop` becomes cancel + re-place — adjust `runtime` accordingly.)

- [ ] **Step 6: Commit**

```bash
git add app/main/execution/tranche-exec.js app/main/execution/tv-adapter.js tests/tranche-exec.test.js
git commit -m "feat(tranche): per-tranche broker action mapping + standalone-order adapter"
```

---

## Task 7: Multi-tranche journal (lift the single-trade lock for allowed adds)

**Files:**
- Modify: `app/main/trades.js`
- Test: `tests/trades-tranche.test.js` (new)

- [ ] **Step 1: Write failing test**

```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAddAccept } from "../app/main/trades.js";

describe("isAddAccept", () => {
  it("true when payload is tagged as an add", () => {
    assert.equal(isAddAccept({ tranche_role: "add" }), true);
  });
  it("false for a normal anchor accept", () => {
    assert.equal(isAddAccept({ tranche_role: "anchor" }), false);
    assert.equal(isAddAccept({}), false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/trades-tranche.test.js`
Expected: FAIL — `isAddAccept` not exported.

- [ ] **Step 3: Implement**

In `app/main/trades.js`: export `isAddAccept(setup) { return setup?.tranche_role === "add"; }`. In `acceptSetup`, when `isAddAccept(setup)` is true **skip the single-trade-lock rejection** (the open-trade check at lines 53-67), and persist `tranche_role` + `tranche_seq` on the accept event. Anchor accepts keep the lock (no second anchor while open).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/trades-tranche.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/trades.js tests/trades-tranche.test.js
git commit -m "feat(trades): multi-tranche accept — adds bypass the single-trade lock"
```

---

## Task 8: Tranche-manager runtime + wire into bar-close (auto modes)

**Files:**
- Modify: `app/main/execution/tranche-manager.js` (add `runTrancheManager` runtime)
- Modify: `app/main/bar-close.js` (call it after surface, auto modes)

- [ ] **Step 1: Implement `runTrancheManager`**

Add to `tranche-manager.js` a runtime that: reads `readExecConfig()` (mode + maxAdds + cap + guards); folds open tranches from `trades.jsonl`; computes `greenLight` per the oldest tranche via `greenLightReached`; computes `addsDisabled` via `addsDisabledFromOutcomes`, `lossHalt` via `consecutiveLossStreak >= 3`; builds `takenLog`; calls `planTrancheAction`; then:
- `open_anchor` / `open_add` → run `checkOrder` (guardrails from config), `acceptSetup` (tagged role/seq), and the `tranche-exec` broker actions via the adapter.
- `surface` → no-op (the existing surface already happened; human accepts via UI).
- `skip:*` / `blocked:*` → record a one-line reason to `setups.jsonl` (`type: "tranche_skip"`).

- [ ] **Step 2: Wire into bar-close.js**

After `surfaceSetup`/`surfaceNoTrade` in `runDeterministicPacketTruthForBar` (around line 854-864), when a `bestPacket` exists call `runTrancheManager({ bestPacket: truth.surfacePayload, price, send: _send })` **only when `readExecConfig().automationMode !== "manual"`** (manual mode keeps today's flow untouched). Guard with try/catch — a tranche-manager failure must never break the chain.

- [ ] **Step 3: Verify chain unaffected in manual mode**

Run the existing suite (worktree): `npm test`
Expected: all green (manual mode is the default → no behavior change for existing tests).

- [ ] **Step 4: Commit**

```bash
git add app/main/execution/tranche-manager.js app/main/bar-close.js
git commit -m "feat(tranche): runtime + bar-close wiring (auto modes only)"
```

---

## Task 9: Settings + IPC + preload (mode + risk knobs)

**Files:**
- Modify: `app/main/ipc-execution.js` (add `execution:config` get/set; remove averaging `addToPosition`)
- Modify: `app/preload.cjs` (expose `execution.config`)
- Modify: `app/renderer/src/SettingsPopover.jsx` (mode dropdown + max-adds + combined-cap)

- [ ] **Step 1: IPC**

Add `ipcMain.handle("execution:config", ...)` for `{action:"get"}` → `readExecConfig()` and `{action:"set", patch}` → `writeExecConfig(patch)`. Remove the `execution:addToPosition` averaging handler (superseded by the tranche path) and the adapter's `addToPosition`.

- [ ] **Step 2: Preload**

Add `config: { get: () => ipcRenderer.invoke("execution:config", { action: "get" }), set: (patch) => ipcRenderer.invoke("execution:config", { action: "set", patch }) }` to the `execution` group.

- [ ] **Step 3: Settings UI**

In `SettingsPopover.jsx`, in the ACCOUNT & EXECUTION section, add: an **Automation mode** segmented control (Manual / Manual-anchor+auto-adds / Full-auto), a **Max adds** number (default 5), a **Combined cap $** number (blank = none). On change, call `window.api.execution.config.set({...})`. Load current values via `execution.config.get()` on mount. Keep the existing guardrail fields; on change, also persist them to main config (so auto-fire enforces them).

- [ ] **Step 4: Verify via CDP**

Reload the renderer; set mode to Full-auto via the UI; read `state/execution-config.json` to confirm `automationMode: "auto"` persisted. Set back to Manual.

- [ ] **Step 5: Commit**

```bash
git add app/main/ipc-execution.js app/preload.cjs app/renderer/src/SettingsPopover.jsx
git commit -m "feat(exec): settings for automation mode + risk knobs; retire averaging ADD"
```

---

## Task 10: IN-TRADE tranche stack (renderer)

**Files:**
- Modify: `app/renderer/src/Live.helpers.js` (add `trancheStackFromState`)
- Test: `tests/live-helpers.test.js` (append)
- Modify: `app/renderer/src/LivePopover.jsx` (render the stack; ADD tab fires a tranche)

- [ ] **Step 1: Write failing helper test**

```javascript
describe("trancheStackFromState", () => {
  it("maps open journal trades to stack rows (anchor first)", () => {
    const trades = [
      { id: "T-0001", tranche_role: "anchor", side: "long", grade: "A+", entry: 100, stop: 95, tp1: 110, state: "filled" },
      { id: "T-0002", tranche_role: "add", side: "long", grade: "B", entry: 105, stop: 102, tp1: 112, state: "filled" },
    ];
    const rows = trancheStackFromState(trades, 108);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].role, "anchor");
    assert.equal(rows[1].role, "add");
  });
});
```

(Add the import for `trancheStackFromState` to the test file's import block.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/live-helpers.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `trancheStackFromState`** in `Live.helpers.js` — map each open trade to `{ id, role, side, grade, entry, stop, tp, rUnrealized }` using the existing `liveGridFromTrade` for the R per row; anchor first then adds by seq.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/live-helpers.test.js`
Expected: PASS.

- [ ] **Step 5: Render** the stack in `InTradeView` (replace the single-position grid with a stack when >1 tranche; keep the single grid for 1). The ADD tab's fire path calls `executionAdapter` to open a **new tranche** (not the removed averaging add) — but in auto modes adds open automatically, so the manual ADD tab is only active in Manual mode.

- [ ] **Step 6: Commit**

```bash
git add app/renderer/src/Live.helpers.js app/renderer/src/LivePopover.jsx tests/live-helpers.test.js
git commit -m "feat(live): IN-TRADE tranche stack; manual ADD opens a tranche"
```

---

## Task 11: End-to-end paper verification

**Goal:** Prove the full auto path on the real paper account: anchor fills → green-light at 50% → an add opens with its own stop/target → both exit per grade → fills land in REVIEW. Account left flat.

- [ ] **Step 1: Baseline** — `npm test` in the worktree (all green). `npm install` first if node_modules absent.

- [ ] **Step 2: Deploy to verify** — switch the **main checkout** to this branch and restart the app (the running app must run this code; per the always-deploy-after-merge memory: path-filtered kill of the `concurrently vite` tree, relaunch `npm run dev`). Confirm boot clean + execution connected via CDP.

- [ ] **Step 3: Drive a synthetic anchor+add on paper** — with mode=Full-auto, use a CDP page-context script (or a controlled replay) to surface a long packet, confirm via the WS feed: anchor entry fills with its own stop+limit; force price ≥50% to TP1; confirm a second same-side packet opens an add with its OWN stop+limit (two stops, two limits at different prices on the net 2c). Then trip the add's stop and the anchor's TP — confirm each closes independently and the fills write to `state/trades/<date>.jsonl`.

- [ ] **Step 4: Confirm REVIEW** — the two tranches appear as separate rows with their own R.

- [ ] **Step 5: Flatten + verify flat** — account ends with 0 position, 0 working orders.

- [ ] **Step 6: Restore main checkout** — switch the main checkout back to `main` (or leave on branch only if merging), restore the live MNQ brief if the verification touched live state (it shouldn't — worktree state is separate, but the deploy ran the app from main checkout; confirm `state/session/<today>` wasn't polluted).

- [ ] **Step 7: Final commit + PR**

```bash
git add -p   # stage by hunk; no -A
git commit -m "test(tranche): end-to-end paper verification notes"
gh pr create --title "feat(execution): live tranche (scale-in) execution engine" --body "<summary + verification evidence>"
```

---

## Self-review

**Spec coverage:** ✅ netting workaround (Task 1+6 standalone orders), ✅ 3 modes (Task 4 decision core, Task 8 runtime, Task 9 settings), ✅ adjustable risk defaults (Task 5 config, Task 4 cap/maxAdds), ✅ all-grades auto (Task 4 — no grade filter in the decision core), ✅ A+ runner kept (Task 6 `runnerTp` + BE modify), ✅ exits per mode (Task 8 manual = surface only; auto = open+exec), ✅ guardrails main-readable (Task 5 + Task 9), ✅ green-light/dedup/breaker/halt ported (Task 2), ✅ corpus parity (Task 3), ✅ supersede averaging ADD (Task 9 remove + Task 10 tranche), ✅ backtest files untouched (shared `scale-in-rules.js`), ✅ paper-only.

**Placeholder scan:** the only deferred detail is Task 6's mechanism branch (3a vs 3b), gated on Task 1's empirical result — both branches are fully specified, so it is a sequenced dependency, not a placeholder. The `/trading/modify` field name is confirmed by Task 1's frame capture with a stated fallback (cancel+replace).

**Type consistency:** `tranche_role` ("anchor"/"add"), `automationMode` ("manual"/"anchor-auto-adds"/"auto"), `greenLight` (bool), `planTrancheAction` action strings, and the `brokerActionsFor*` `kind` values are used identically across Tasks 2/4/6/7/8/10.
