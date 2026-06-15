# Execution Engine Implementation Plan (Phase 0 — foundation + M0 spike)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the mechanism-independent, zero-real-money-risk foundation of the execution engine (guardrails, fill records, webview CDP client, IPC + renderer adapter wiring), then run the M0 spike that decides the order-placement mechanism. Order placement itself (M2+) is planned separately AFTER M0, because its real code depends on the spike result.

**Architecture:** Dashboard renderer (LIVE ticket) → IPC `execution:*` → main-process modules under `app/main/execution/` → drive the in-app TradingView `<webview>` over CDP 9223. Sizing + guardrails are pure; fills append to `state/trades/<date>.jsonl`; placement/read go through a webview CDP client distinct from the 9225 analysis path.

**Tech Stack:** Node ESM, `node --test`, Electron main/preload/renderer IPC, raw CDP over `ws` to the 9223 webview target.

**Spec:** [docs/superpowers/specs/2026-06-15-execution-engine-design.md](../specs/2026-06-15-execution-engine-design.md)

**Branch:** `feat/execution-engine` (off main; isolated from the backtest session).

**Safety invariant for Phase 0:** NOTHING in this phase places, modifies, or cancels an order. Placement verbs are stubbed to throw `NOT_IMPLEMENTED_UNTIL_M0`. The only TV interaction is the read-only spike (M0) and read-only `readState` (planned post-M0).

---

## File Structure

- `app/main/execution/guardrails.js` (new) — pure pre-fire gate. One responsibility: decide if an order may fire.
- `app/main/execution/fills.js` (new) — pure-ish fill-record I/O. Append/read `state/trades/<date>.jsonl` + day-loss rollup. Takes an explicit `tradesDir` (DI) so it's unit-testable.
- `app/main/execution/cdp-webview.js` (new) — CDP client pinned to the 9223 `type:"webview"` target: `findWebviewTarget()`, `evaluate(expr)`. Read-only this phase.
- `app/main/execution/tv-adapter.js` (new) — adapter skeleton implementing the UI interface; placement verbs throw `NOT_IMPLEMENTED_UNTIL_M0`; `brokerConnected()` reports whether a broker is linked (read via cdp-webview).
- `app/main/ipc-execution.js` (new) — registers `execution:*` IPC handlers over the adapter + guardrails + fills.
- `app/renderer/src/execution/executionAdapter.js` (modify) — replace the console.warn stub with `window.api.execution.*` calls.
- `app/preload.js` (modify) — expose `window.api.execution`.
- `scripts/spike-tv-paper.mjs` (new, M0) — manual spike harness: capture webview network + DOM around one hand-placed paper order.
- Tests: `tests/execution-guardrails.test.js`, `tests/execution-fills.test.js`.

---

## Task 1: Guardrails module (pure pre-fire gate)

**Files:**
- Create: `app/main/execution/guardrails.js`
- Test: `tests/execution-guardrails.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/execution-guardrails.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOrder } from "../app/main/execution/guardrails.js";

const ok = { contracts: 3, actualRisk: 111, withinTolerance: true };
const guards = { perTradeMax: 250, dailyLimit: 600 };

describe("checkOrder", () => {
  it("passes a valid order with a stop, in-tolerance size, under max, under daily loss", () => {
    assert.deepEqual(checkOrder({ hasStop: true, sizing: ok, guards, dayState: { realizedLossUsd: 0 } }), { ok: true });
  });
  it("blocks when there is no stop", () => {
    const r = checkOrder({ hasStop: false, sizing: ok, guards, dayState: { realizedLossUsd: 0 } });
    assert.equal(r.ok, false); assert.equal(r.code, "NO_STOP");
  });
  it("blocks when no whole-micro size fits within tolerance", () => {
    const r = checkOrder({ hasStop: true, sizing: { contracts: 0, actualRisk: 0, withinTolerance: false }, guards, dayState: { realizedLossUsd: 0 } });
    assert.equal(r.ok, false); assert.equal(r.code, "SIZE");
  });
  it("blocks when computed risk exceeds the per-trade max", () => {
    const r = checkOrder({ hasStop: true, sizing: { contracts: 6, actualRisk: 300, withinTolerance: true }, guards, dayState: { realizedLossUsd: 0 } });
    assert.equal(r.ok, false); assert.equal(r.code, "OVER_MAX");
  });
  it("blocks new entries once the daily loss limit is reached", () => {
    const r = checkOrder({ hasStop: true, sizing: ok, guards, dayState: { realizedLossUsd: 600 } });
    assert.equal(r.ok, false); assert.equal(r.code, "DAILY_HALT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/execution-guardrails.test.js`
Expected: FAIL — `Cannot find module '.../guardrails.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// app/main/execution/guardrails.js
// Pure pre-fire gate. Orders fire immediately on accept (no per-order
// confirm), so this is THE safety gate. Returns {ok:true} or
// {ok:false, code, message}. No I/O — caller passes sizing + day state.
export function checkOrder({ hasStop, sizing, guards, dayState } = {}) {
  const G = guards || {};
  if (!hasStop) {
    return { ok: false, code: "NO_STOP", message: "No valid stop — cannot size or bracket the order." };
  }
  if (!sizing || sizing.withinTolerance !== true || (sizing.contracts ?? 0) < 1) {
    return { ok: false, code: "SIZE", message: "No whole micro-contract count lands within $50 of the target risk." };
  }
  if (G.perTradeMax != null && sizing.actualRisk > G.perTradeMax) {
    return { ok: false, code: "OVER_MAX", message: `Computed risk $${sizing.actualRisk} exceeds the $${G.perTradeMax} per-trade ceiling.` };
  }
  if (G.dailyLimit != null && (dayState?.realizedLossUsd ?? 0) >= G.dailyLimit) {
    return { ok: false, code: "DAILY_HALT", message: `Daily loss limit $${G.dailyLimit} reached — new entries locked until next session.` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/execution-guardrails.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/main/execution/guardrails.js tests/execution-guardrails.test.js
git commit -m "feat(execution): pure pre-fire guardrails gate"
```

---

## Task 2: Fill records (append/read + day-loss rollup)

**Files:**
- Create: `app/main/execution/fills.js`
- Test: `tests/execution-fills.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/execution-fills.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFill, readFills, dayRealizedLossUsd } from "../app/main/execution/fills.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fills-")); });

describe("fills", () => {
  it("appends then reads a record round-trip for a date", () => {
    const rec = { account: "paper", symbol: "MNQ1!", side: "long", actual: { r: 1.6, usd: 320 } };
    appendFill(dir, "2026-06-15", rec);
    const back = readFills(dir, "2026-06-15");
    assert.equal(back.length, 1);
    assert.equal(back[0].symbol, "MNQ1!");
    assert.ok(back[0].ts, "appendFill stamps ts");
  });
  it("returns [] for a date with no file", () => {
    assert.deepEqual(readFills(dir, "2026-01-01"), []);
  });
  it("sums realized losses (positive $ number) for the daily halt", () => {
    appendFill(dir, "2026-06-15", { actual: { usd: -200 } });
    appendFill(dir, "2026-06-15", { actual: { usd: 120 } });
    appendFill(dir, "2026-06-15", { actual: { usd: -150 } });
    assert.equal(dayRealizedLossUsd(readFills(dir, "2026-06-15")), 350);
  });
});

process.on("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/execution-fills.test.js`
Expected: FAIL — `Cannot find module '.../fills.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// app/main/execution/fills.js
// Append-only fill/outcome records, one JSONL file per date under
// <tradesDir>/<date>.jsonl. tradesDir is injected (the IPC layer passes the
// real state path) so this is unit-testable. Each record: planned vs actual
// (fill, exit type, real R + $, account PAPER|LIVE, held). REVIEW reads these.
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function fillPath(tradesDir, date) { return join(tradesDir, `${date}.jsonl`); }

export function appendFill(tradesDir, date, record) {
  if (!existsSync(tradesDir)) mkdirSync(tradesDir, { recursive: true });
  const rec = { ts: new Date().toISOString(), ...record };
  appendFileSync(fillPath(tradesDir, date), JSON.stringify(rec) + "\n");
  return rec;
}

export function readFills(tradesDir, date) {
  const p = fillPath(tradesDir, date);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// Daily realized LOSS as a positive $ number (for the daily-halt guardrail).
export function dayRealizedLossUsd(fills = []) {
  const loss = fills.reduce((s, f) => s + Math.min(0, Number(f?.actual?.usd) || 0), 0);
  return Math.abs(loss);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/execution-fills.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/main/execution/fills.js tests/execution-fills.test.js
git commit -m "feat(execution): fill-record append/read + daily-loss rollup"
```

---

## Task 3: Webview CDP client (read-only) + adapter skeleton

**Files:**
- Create: `app/main/execution/cdp-webview.js`
- Create: `app/main/execution/tv-adapter.js`

> No unit test: this connects to a live CDP target (the running webview). It's exercised by the M0 spike + manual run, not `node --test`. Keep the logic thin so there's little to test in isolation.

- [ ] **Step 1: Write `cdp-webview.js`**

```js
// app/main/execution/cdp-webview.js
// Minimal CDP client pinned to the in-app TradingView <webview> on port 9223
// (type:"webview"). Distinct from packages/core (9225 analysis) so order
// work never touches the analysis backend. Read-only this phase.
import http from "node:http";
import WebSocket from "ws";

const PORT = 9223;

function listTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}/json`, (r) => {
      let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

export async function findWebviewTarget() {
  const ts = await listTargets();
  // The TradingView chart webview — type webview, tradingview.com URL.
  return ts.find((t) => t.type === "webview" && /tradingview\.com/.test(t.url || "")) || null;
}

export async function evaluate(expr) {
  const t = await findWebviewTarget();
  if (!t) throw new Error("TV webview target not found on CDP 9223");
  return new Promise((resolve, reject) => {
    const s = new WebSocket(t.webSocketDebuggerUrl);
    let id = 1;
    s.on("open", () => s.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } })));
    s.on("message", (m) => {
      const o = JSON.parse(m);
      if (o.id === id) { s.close(); o.exceptionDetails ? reject(new Error(JSON.stringify(o.exceptionDetails))) : resolve(o.result?.result?.value); }
    });
    s.on("error", reject);
  });
}
```

- [ ] **Step 2: Write `tv-adapter.js` (placement stubbed until M0)**

```js
// app/main/execution/tv-adapter.js
// Execution adapter against the in-app TradingView webview, paper-first.
// Phase 0: only read-only capabilities are real. Placement verbs throw
// NOT_IMPLEMENTED_UNTIL_M0 — the M0 spike decides the mechanism, then a
// follow-up plan implements them. Safety: no order can be placed yet.
import { evaluate, findWebviewTarget } from "./cdp-webview.js";

const NOT_YET = "execution placement not implemented — gated on the M0 mechanism spike";

export async function brokerConnected() {
  // A broker/Paper-Trading connection shows a real account-manager with an
  // account row. Heuristic, refined in M1. Returns boolean.
  try {
    return await evaluate(`(() => {
      const am = document.querySelector('[class*="accountManager"] [class*="account"], [data-name="account-manager"]');
      const txt = (document.body.innerText || '');
      return !!am && /paper|account|balance|\\$[0-9]/i.test(txt);
    })()`);
  } catch { return false; }
}

export async function readState() {
  // Read-only position/orders/balance from the account-manager DOM.
  // Real parsing lands in M1 against a connected paper account; until then
  // report the connection state so the UI can show "connect Paper Trading".
  const connected = await brokerConnected();
  return { connected, position: null, workingOrders: [], balance: null };
}

export async function placeOrder() { throw new Error(NOT_YET); }
export async function flatten() { throw new Error(NOT_YET); }
export async function panic() { throw new Error(NOT_YET); }
export async function moveStopToBE() { throw new Error(NOT_YET); }
export async function trail() { throw new Error(NOT_YET); }
export async function cancel() { throw new Error(NOT_YET); }
export async function addToPosition() { throw new Error(NOT_YET); }

export const tvAdapter = { brokerConnected, readState, placeOrder, flatten, panic, moveStopToBE, trail, cancel, addToPosition, findWebviewTarget };
```

- [ ] **Step 3: Sanity-check it loads (no live CDP needed)**

Run: `node -e "import('./app/main/execution/tv-adapter.js').then(m => console.log('loaded', Object.keys(m.tvAdapter).join(',')))"`
Expected: `loaded brokerConnected,readState,placeOrder,...`

- [ ] **Step 4: Commit**

```bash
git add app/main/execution/cdp-webview.js app/main/execution/tv-adapter.js
git commit -m "feat(execution): read-only webview CDP client + adapter skeleton (placement stubbed)"
```

---

## Task 4: IPC + preload + renderer adapter wrapper

**Files:**
- Create: `app/main/ipc-execution.js`
- Modify: `app/preload.js` (add `execution` to the exposed `api`)
- Modify: `app/renderer/src/execution/executionAdapter.js` (stub → IPC calls)
- Modify: `app/main/*` main entry that registers IPC (wire `registerExecutionIpc`)

- [ ] **Step 1: Write `ipc-execution.js`**

```js
// app/main/ipc-execution.js
// execution:* IPC. Place/flatten/panic run guardrails first (place) and
// delegate to the adapter; state is read-only. Placement is gated on M0, so
// these return the adapter's NOT_IMPLEMENTED error as a structured result
// rather than throwing across IPC.
import { ipcMain } from "electron";
import { tvAdapter } from "./execution/tv-adapter.js";
import { checkOrder } from "./execution/guardrails.js";
import { readFills, dayRealizedLossUsd } from "./execution/fills.js";
import { join } from "node:path";

// tradesDir resolver — state/trades under the project state root.
function tradesDir() { return join(process.cwd(), "state", "trades"); }
function today() { return new Date().toISOString().slice(0, 10); }

async function guarded(payload) {
  const fills = readFills(tradesDir(), today());
  const dayState = { realizedLossUsd: dayRealizedLossUsd(fills) };
  return checkOrder({ hasStop: payload?.hasStop, sizing: payload?.sizing, guards: payload?.guards, dayState });
}

export function registerExecutionIpc() {
  ipcMain.handle("execution:state", async () => {
    try { return { ok: true, state: await tvAdapter.readState() }; }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  ipcMain.handle("execution:place", async (_e, payload) => {
    const gate = await guarded(payload);
    if (!gate.ok) return { ok: false, blocked: true, ...gate };
    try { return { ok: true, result: await tvAdapter.placeOrder(payload) }; }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  for (const verb of ["flatten", "panic", "moveStopToBE", "trail", "cancel", "addToPosition"]) {
    ipcMain.handle(`execution:${verb}`, async (_e, payload) => {
      try { return { ok: true, result: await tvAdapter[verb](payload) }; }
      catch (e) { return { ok: false, error: String(e?.message || e) }; }
    });
  }
}
```

- [ ] **Step 2: Wire `registerExecutionIpc()` into the main IPC setup**

Find where the other `register*Ipc` / `ipcMain.handle` setup runs (e.g. `app/main/ipc.js` or `app/electron-main.js`), import `registerExecutionIpc`, and call it alongside the existing registrations.

Run: `grep -rn "registerBacktestIpc\|ipcMain.handle(\"prep:get\"" app/main/*.js app/electron-main.js | head`
Then add the import + call next to the existing ones.

- [ ] **Step 3: Expose `execution` in preload**

In `app/preload.js`, add to the `api` object:

```js
execution: {
  state: () => ipcRenderer.invoke("execution:state"),
  place: (payload) => ipcRenderer.invoke("execution:place", payload),
  flatten: (payload) => ipcRenderer.invoke("execution:flatten", payload),
  panic: (payload) => ipcRenderer.invoke("execution:panic", payload),
  moveStopToBE: (payload) => ipcRenderer.invoke("execution:moveStopToBE", payload),
  trail: (payload) => ipcRenderer.invoke("execution:trail", payload),
  cancel: (payload) => ipcRenderer.invoke("execution:cancel", payload),
  addToPosition: (payload) => ipcRenderer.invoke("execution:addToPosition", payload),
},
```

- [ ] **Step 4: Replace the renderer stub with IPC calls**

```js
// app/renderer/src/execution/executionAdapter.js
// Thin wrapper over window.api.execution.* (real IPC). Placement still
// no-ops at the broker level until M0 lands the mechanism — main returns a
// structured {ok:false} for those, which the LIVE ticket already handles.
const call = (verb, payload) => window.api?.execution?.[verb]?.(payload) ?? Promise.resolve({ ok: false, error: "execution IPC unavailable" });

export const executionAdapter = {
  placeOrder: (p) => call("place", p),
  flatten: (p) => call("flatten", p),
  panic: (p) => call("panic", p),
  moveStopToBE: (p) => call("moveStopToBE", p),
  trail: (p) => call("trail", p),
  cancel: (p) => call("cancel", p),
  addToPosition: (p) => call("addToPosition", p),
  state: () => call("state"),
  armLive: () => ({ ok: true }),       // account mode is renderer UI state (ephemeral)
  returnToPaper: () => ({ ok: true }),
};
```

- [ ] **Step 5: Verify the app still boots + IPC responds (live, CDP 9223 page target)**

Restart the app (it loads new main-process code). Then via CDP on the dashboard page (`:5173`):
Run an eval: `await window.api.execution.state()`
Expected: `{ ok: true, state: { connected: false, position: null, workingOrders: [], balance: null } }` (connected:false until Paper Trading is linked).

- [ ] **Step 6: Commit**

```bash
git add app/main/ipc-execution.js app/preload.js app/renderer/src/execution/executionAdapter.js app/main/ipc.js
git commit -m "feat(execution): execution:* IPC + preload + renderer adapter (guardrails-gated, placement stubbed)"
```

---

## Task 5 (M0): Order-placement mechanism spike

> **GATE:** requires the user to have connected "Paper Trading" in the in-app TradingView trade panel. Until then `brokerConnected()` returns false and this task cannot run. This is a discovery task, not TDD — its deliverable is a documented mechanism + a decision (A network-replay vs B DOM), which unblocks the Phase-2 placement plan.

**Files:**
- Create: `scripts/spike-tv-paper.mjs`

- [ ] **Step 1: Confirm the broker is connected**

Run: `node -e "import('./app/main/execution/tv-adapter.js').then(async m => console.log('connected:', await m.brokerConnected()))"`
Expected: `connected: true`. If false, stop — the user must connect Paper Trading first.

- [ ] **Step 2: Write the spike harness**

`scripts/spike-tv-paper.mjs` connects to the 9223 webview target, enables `Network`, logs every request/websocket frame for ~60s while the operator (a) opens the order ticket and (b) places ONE small paper order with an SL + TP, then (c) flattens it. It also dumps the account-manager DOM before/after. Output: a transcript file `state/spike/tv-paper-<ts>.json` (network frames + DOM snapshots).

- [ ] **Step 3: Run the spike (operator places one manual paper order)**

Run: `node scripts/spike-tv-paper.mjs`
The operator places + flattens one paper order during the capture window.

- [ ] **Step 4: Analyze + decide**

Inspect the transcript: did the order go out as a replayable REST/websocket message (path A) or only via DOM events (path B)? Record the chosen mechanism + the exact request/selectors in `docs/superpowers/specs/2026-06-15-execution-engine-design.md` under a new "M0 spike result" section, and commit.

- [ ] **Step 5: Commit the findings**

```bash
git add scripts/spike-tv-paper.mjs docs/superpowers/specs/2026-06-15-execution-engine-design.md
git commit -m "spike(execution): TV Paper Trading placement mechanism — findings + decision"
```

---

## Phase 2 (post-M0, separate plan)

Once M0 records the mechanism, write `docs/superpowers/plans/2026-06-15-execution-engine-phase2.md` covering: `readState()` DOM parse (M1, fixture-tested), `placeOrder` entry+OCO bracket (M2), `flatten`+`panic` (M3), fill capture → `fills.appendFill` (M4), then BE/TRAIL/CANCEL/ADD (M5), plus the CLAUDE.md #2 + decisions-log update. These tasks' exact code is unknowable until M0, so they are intentionally NOT written here (no placeholders).

---

## Self-Review

**Spec coverage:** sizing (reused), guardrails (Task 1), fills→REVIEW records (Task 2), webview CDP isolation (Task 3), adapter interface + account/arm hooks (Task 3/4), IPC + UI wiring (Task 4), M0 spike + mechanism decision (Task 5), constraint-#2 update (deferred to Phase 2 with placement, as the spec lists it a milestone deliverable). Placement/in-trade/fills-integration are Phase 2 (gated on M0) — explicitly deferred, not dropped.

**Placeholder scan:** no TBD/TODO; Phase 2 deferral is a real spike dependency, not a placeholder; every Phase-0 code step shows complete code.

**Type consistency:** `sizing` shape `{contracts, actualRisk, withinTolerance}` consistent across guardrails test/impl + IPC; `checkOrder` codes (NO_STOP/SIZE/OVER_MAX/DAILY_HALT) consistent; fills `{actual:{usd}}` used by `dayRealizedLossUsd` + the guardrails `dayState.realizedLossUsd` it feeds; adapter verb names match across tv-adapter, ipc-execution loop, preload, and renderer wrapper.
