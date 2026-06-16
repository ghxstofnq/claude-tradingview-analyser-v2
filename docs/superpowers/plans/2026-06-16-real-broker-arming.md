# Real-broker arming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route orders to the *active* TradingView account (paper or live), gate any account switch behind a deliberate confirm, persist the confirmed account across restarts, and pause live auto-fire on boot until one tap — all inert for live until a discovery spike + sign-off.

**Architecture:** A pure account-gate core decides route/confirm from `{active, confirmed}`; the adapter picks host+id from the confirmed account instead of a hardcoded paper host; the auto path additionally checks a boot live-auto-pause flag. Config gains a persisted `confirmedAccount` + `liveHost` (null until the spike). No live order is possible until `liveHost` is configured by the deferred discovery spike.

**Tech Stack:** Node ESM, `node:test` + `node:assert/strict`, Electron main + preload + React renderer, CDP webview (paper REST/WS).

**Spec:** [docs/superpowers/specs/2026-06-16-real-broker-arming-design.md](../specs/2026-06-16-real-broker-arming-design.md)

**Hard rules:**
- Ships **paper-only / inert for live**: `liveHost` stays null, so `targetFor` returns null for live and routing is blocked. No real order until the deferred discovery spike + explicit sign-off.
- Do NOT edit `backtest-engine.js` or backtest files.
- Run tests in this worktree (`.claude/worktrees/scale-in`), never the main checkout (PR #79).
- TDD. Conventional commits. Trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility | New/Mod |
|---|---|---|
| `app/main/execution/account-gate.js` | Pure `resolveAccountGate` + `autoFireAllowed` + `targetFor` | **New** |
| `app/main/execution/active-account.js` | `getActiveAccount()` — read active account (id+type+name) | **New** |
| `app/main/execution/config.js` | Add `confirmedAccount` (persisted), `liveHost`, `paperHost` | Mod |
| `app/main/execution/trading-feed.js` | Capture account type + name (additive) | Mod |
| `app/main/execution/tv-adapter.js` | Host+id from confirmed account; gate-check before send | Mod |
| `app/main/execution/tranche-manager.js` | Auto path checks gate + live-auto-pause | Mod |
| `app/main/ipc-execution.js` | `execution:account` / `confirmAccount` / `resumeAuto` IPC | Mod |
| `app/preload.cjs` | Expose `account.*` + `resumeAuto` | Mod |
| `app/renderer/src/SettingsPopover.jsx` | Active/confirmed display + confirm UI + resume-auto | Mod |
| `app/renderer/src/Account.helpers.js` | Keep `armReady`; replace boot-to-paper with persistence | Mod |
| `tests/account-gate.test.js` | Pure gate + targetFor + autoFire tests | **New** |
| `tests/execution-config.test.js` | confirmedAccount/liveHost defaults + persistence | Mod |

**Shapes (consistent across tasks):**
- account: `{ id: string, type: "paper"|"live", name: string }`
- `resolveAccountGate({active, confirmed})` → `{ route, needsConfirm, level, reason }` (`level` ∈ `"live"|"paper"|null`)
- `autoFireAllowed({confirmed, autoResumed})` → boolean
- `targetFor(confirmed, config)` → `{ host, accountId } | null`

---

## Task 1: `account-gate.js` — the pure core

**Files:** Create `app/main/execution/account-gate.js`; Test `tests/account-gate.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAccountGate, autoFireAllowed, targetFor } from "../app/main/execution/account-gate.js";

const paper = { id: "9256021", type: "paper", name: "InnerCircleG" };
const live = { id: "L-1", type: "live", name: "Tradovate Live" };

describe("resolveAccountGate", () => {
  it("no active account → do not route", () => {
    assert.deepEqual(resolveAccountGate({ active: null, confirmed: paper }), { route: false, needsConfirm: false, level: null, reason: "no_active_account" });
  });
  it("active matches confirmed → route", () => {
    assert.deepEqual(resolveAccountGate({ active: paper, confirmed: paper }), { route: true, needsConfirm: false, level: null, reason: null });
  });
  it("paper switch → confirm at paper level", () => {
    const g = resolveAccountGate({ active: { ...paper, id: "9256099" }, confirmed: paper });
    assert.equal(g.route, false); assert.equal(g.needsConfirm, true); assert.equal(g.level, "paper");
  });
  it("switch into live → confirm at live level", () => {
    const g = resolveAccountGate({ active: live, confirmed: paper });
    assert.equal(g.route, false); assert.equal(g.needsConfirm, true); assert.equal(g.level, "live");
  });
  it("no confirmed yet → first active needs confirm", () => {
    const g = resolveAccountGate({ active: paper, confirmed: null });
    assert.equal(g.needsConfirm, true); assert.equal(g.level, "paper");
  });
});

describe("autoFireAllowed (boot live-auto-pause)", () => {
  it("paper auto always allowed", () => {
    assert.equal(autoFireAllowed({ confirmed: paper, autoResumed: false }), true);
  });
  it("live auto blocked until resumed", () => {
    assert.equal(autoFireAllowed({ confirmed: live, autoResumed: false }), false);
    assert.equal(autoFireAllowed({ confirmed: live, autoResumed: true }), true);
  });
  it("no confirmed → not allowed", () => {
    assert.equal(autoFireAllowed({ confirmed: null, autoResumed: true }), false);
  });
});

describe("targetFor", () => {
  it("paper → paper host + id", () => {
    assert.deepEqual(targetFor(paper, { paperHost: "https://papertrading.tradingview.com", liveHost: null }), { host: "https://papertrading.tradingview.com", accountId: "9256021" });
  });
  it("live with liveHost → live host + id", () => {
    assert.deepEqual(targetFor(live, { paperHost: "p", liveHost: "https://live.example" }), { host: "https://live.example", accountId: "L-1" });
  });
  it("live without liveHost → null (cannot route live)", () => {
    assert.equal(targetFor(live, { paperHost: "p", liveHost: null }), null);
  });
  it("no confirmed → null", () => {
    assert.equal(targetFor(null, { paperHost: "p", liveHost: "l" }), null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/account-gate.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `account-gate.js`**

```javascript
// app/main/execution/account-gate.js
// Pure account-routing gate. The engine follows the ACTIVE TradingView account
// but only routes to the CONFIRMED one; any switch needs a deliberate confirm
// (live = serious). Live auto-fire is additionally paused on boot until resumed.

// Decide whether to route, or surface a confirm, given the active vs confirmed account.
export function resolveAccountGate({ active, confirmed } = {}) {
  if (!active) return { route: false, needsConfirm: false, level: null, reason: "no_active_account" };
  if (confirmed && active.id === confirmed.id) return { route: true, needsConfirm: false, level: null, reason: null };
  return { route: false, needsConfirm: true, level: active.type === "live" ? "live" : "paper", reason: "account_switch" };
}

// The AUTO path is allowed only for a confirmed account, and for LIVE only once
// the per-session resume tap has cleared the boot pause. Manual entries do NOT
// call this — they're gated by resolveAccountGate alone.
export function autoFireAllowed({ confirmed, autoResumed } = {}) {
  if (!confirmed) return false;
  if (confirmed.type === "live") return autoResumed === true;
  return true;
}

// Resolve the broker target (host + account id) for the confirmed account.
// Returns null for live until liveHost is configured (the discovery spike) —
// making accidental live routing impossible before then.
export function targetFor(confirmed, config = {}) {
  if (!confirmed) return null;
  if (confirmed.type === "paper") return { host: config.paperHost, accountId: confirmed.id };
  if (confirmed.type === "live") return config.liveHost ? { host: config.liveHost, accountId: confirmed.id } : null;
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/account-gate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/execution/account-gate.js tests/account-gate.test.js
git commit -m "feat(arming): pure account-gate (route/confirm + live-auto-pause + target)"
```

---

## Task 2: `config.js` — persisted confirmed account + hosts

**Files:** Modify `app/main/execution/config.js`; Test `tests/execution-config.test.js`

- [ ] **Step 1: Write the failing test** (append to `tests/execution-config.test.js`)

```javascript
import { mergeExecConfig, DEFAULT_EXEC_CONFIG } from "../app/main/execution/config.js";

describe("exec config — arming fields", () => {
  it("defaults: confirmedAccount null, liveHost null, paperHost set", () => {
    assert.equal(DEFAULT_EXEC_CONFIG.confirmedAccount, null);
    assert.equal(DEFAULT_EXEC_CONFIG.liveHost, null);
    assert.equal(DEFAULT_EXEC_CONFIG.paperHost, "https://papertrading.tradingview.com");
  });
  it("confirmedAccount persists through a merge (not wiped by an unrelated patch)", () => {
    const base = mergeExecConfig(DEFAULT_EXEC_CONFIG, { confirmedAccount: { id: "L-1", type: "live", name: "X" } });
    const out = mergeExecConfig(base, { maxAdds: 4 });
    assert.equal(out.confirmedAccount.id, "L-1");
    assert.equal(out.maxAdds, 4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/execution-config.test.js`
Expected: FAIL — defaults missing the new keys.

- [ ] **Step 3: Implement** — extend `DEFAULT_EXEC_CONFIG` in `config.js`:

```javascript
export const DEFAULT_EXEC_CONFIG = {
  paperAccountId: null,
  automationMode: "manual",
  maxAdds: 5,
  combinedCapUsd: null,
  guards: { perTradeMax: 250, dailyLimit: 600, defaultRisk: 120 },
  confirmedAccount: null,                                  // { id, type, name } — persisted across restarts
  liveHost: null,                                          // filled by the discovery spike; null = live blocked
  paperHost: "https://papertrading.tradingview.com",
};
```

(`mergeExecConfig`/`readExecConfig`/`writeExecConfig` already shallow-merge top-level keys, so `confirmedAccount`/`liveHost`/`paperHost` persist with no further change.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/execution-config.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/execution/config.js tests/execution-config.test.js
git commit -m "feat(arming): persisted confirmedAccount + liveHost/paperHost in exec config"
```

---

## Task 3: `active-account.js` — read the active account

**Files:** Create `app/main/execution/active-account.js`; Test `tests/account-gate.test.js` (append)

Until the discovery spike runs there is no live broker, so `type` is `"paper"` (the only host known). The id comes from the trading feed (self-healed) or the configured paper id; the name from the feed/DOM.

- [ ] **Step 1: Write the failing test** (append)

```javascript
import { deriveActiveAccount } from "../app/main/execution/account-gate.js";

describe("deriveActiveAccount", () => {
  it("uses feed accountId + name; type paper when no liveHost", () => {
    const a = deriveActiveAccount({ feed: { accountId: "9256021", accountName: "InnerCircleG" }, config: { paperAccountId: "9256021", liveHost: null } });
    assert.deepEqual(a, { id: "9256021", type: "paper", name: "InnerCircleG" });
  });
  it("falls back to configured paper id when feed has none", () => {
    const a = deriveActiveAccount({ feed: {}, config: { paperAccountId: "9256021", liveHost: null } });
    assert.equal(a.id, "9256021"); assert.equal(a.type, "paper");
  });
  it("returns null when no id anywhere", () => {
    assert.equal(deriveActiveAccount({ feed: {}, config: {} }), null);
  });
});
```

(`deriveActiveAccount` is the pure shaper; it lives in `account-gate.js` next to the other pure helpers. `active-account.js` is the thin runtime that feeds it live inputs.)

- [ ] **Step 2: Run to verify it fails** — `node --test tests/account-gate.test.js` → FAIL (export missing).

- [ ] **Step 3: Implement** — add to `account-gate.js`:

```javascript
// Shape the active account from live inputs. type is "live" only once a
// liveHost is configured AND the feed marks the account live (feed.accountType
// === "live"); otherwise "paper". Pure.
export function deriveActiveAccount({ feed = {}, config = {} } = {}) {
  const id = feed.accountId ?? config.paperAccountId ?? null;
  if (id == null) return null;
  const type = config.liveHost && feed.accountType === "live" ? "live" : "paper";
  return { id: String(id), type, name: feed.accountName ?? null };
}
```

Then create the thin runtime `app/main/execution/active-account.js`:

```javascript
// app/main/execution/active-account.js
// Runtime read of the active TradingView account → { id, type, name } | null.
// Pure shaping is in account-gate.deriveActiveAccount; this just supplies the
// live inputs (trading-feed state + exec config). Proactive read of the active
// account + its paper/live type on connect/switch is confirmed by the deferred
// discovery spike; until then type is always "paper".
import { getTradingState } from "./trading-feed.js";
import { readExecConfig } from "./config.js";
import { deriveActiveAccount } from "./account-gate.js";

export function getActiveAccount() {
  const feed = getTradingState();
  return deriveActiveAccount({ feed: { accountId: feed.accountId, accountName: feed.accountName, accountType: feed.accountType }, config: readExecConfig() });
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test tests/account-gate.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/execution/account-gate.js app/main/execution/active-account.js tests/account-gate.test.js
git commit -m "feat(arming): deriveActiveAccount + active-account runtime read"
```

---

## Task 4: trading-feed — capture account name + type

**Files:** Modify `app/main/execution/trading-feed.js`

- [ ] **Step 1:** In `handleContent`, when a frame carries account fields, capture name + type alongside the id (additive — `getTradingState` already returns `accountId`):

```javascript
// inside handleContent, where accountId is handled:
if (c.accountId) { state.accountId = String(c.accountId); rememberAccountId(c.accountId); }
if (p.accountName || c.accountName) state.accountName = p.accountName || c.accountName;
if (p.accountType || c.accountType) state.accountType = p.accountType || c.accountType; // "paper"|"live" when TV signals it
```

And add `accountName`/`accountType` to the `state` object init + the `getTradingState()` return.

- [ ] **Step 2: Verify the module still loads** — `node --check app/main/execution/trading-feed.js` → OK.

- [ ] **Step 3: Commit**

```bash
git add app/main/execution/trading-feed.js
git commit -m "feat(arming): trading-feed captures account name + type (additive)"
```

---

## Task 5: tv-adapter — target from the confirmed account + gate check

**Files:** Modify `app/main/execution/tv-adapter.js`

- [ ] **Step 1:** Replace the hardcoded `HOST` usage with a per-call target. Add a helper that resolves the target from config + active/confirmed and blocks when not routable:

```javascript
import { readExecConfig } from "./config.js";
import { getActiveAccount } from "./active-account.js";
import { resolveAccountGate, targetFor } from "./account-gate.js";

// Returns { host, accountId } to POST to, or throws a structured block when the
// active account isn't the confirmed one / live isn't configured.
function resolveTarget() {
  const cfg = readExecConfig();
  const active = getActiveAccount();
  const confirmed = cfg.confirmedAccount;
  const gate = resolveAccountGate({ active, confirmed });
  if (!gate.route) { const e = new Error(gate.reason || "account_not_confirmed"); e.blocked = gate; throw e; }
  const t = targetFor(confirmed, cfg);
  if (!t) { const e = new Error("live_endpoint_not_configured"); e.blocked = { route: false, reason: "live_endpoint_not_configured" }; throw e; }
  return t;
}
```

Change `postTrading(pathPart, payload)` to take the resolved `host` + `accountId` from `resolveTarget()` (each of `placeOrder`/`placeStandalone`/`flatten`/`cancelOrder`/`modifyPosition` calls `resolveTarget()` and uses `t.host` + `t.accountId` instead of `HOST` + `paperAccountId()`). Keep `HOST` only as the default `paperHost`.

- [ ] **Step 2: Verify** — `node --check app/main/execution/tv-adapter.js` → OK; existing `tests/*` that touch the adapter still green (`node --test tests/tranche-exec.test.js` — uses pure mapping, unaffected).

Note: with `confirmedAccount` defaulting to null, `resolveTarget` would block all orders. Task 7's IPC seeds `confirmedAccount` to the paper account on first run (so paper keeps working). Until then this task's adapter change is covered by Task 7's seeding — verify together at Task 9.

- [ ] **Step 3: Commit**

```bash
git add app/main/execution/tv-adapter.js
git commit -m "feat(arming): adapter routes to the confirmed account's host+id (gated)"
```

---

## Task 6: tranche-manager auto path — gate + live-auto-pause

**Files:** Modify `app/main/execution/tranche-manager.js`; Test `tests/tranche-runtime.test.js` (append)

- [ ] **Step 1: Write the failing test** (append) — the auto runtime must no-op when the gate blocks or live-auto is paused:

```javascript
import { autoFireAllowed } from "../app/main/execution/account-gate.js";
describe("runTrancheManager respects the account gate + live-auto-pause", () => {
  it("blocks auto when the gate says do not route", async () => {
    const { deps, calls } = makeDeps({ accountRoutable: () => ({ route: false, reason: "account_switch" }) });
    const r = await runTrancheManager({ bestPacket: anchorPacket, price: 100 }, deps);
    assert.equal(r.action, "blocked:account_switch");
    assert.equal(calls.accept.length, 0);
  });
  it("blocks auto when live-auto is paused on boot", async () => {
    const { deps, calls } = makeDeps({ autoAllowed: () => false });
    const r = await runTrancheManager({ bestPacket: anchorPacket, price: 100 }, deps);
    assert.equal(r.action, "blocked:live_auto_paused");
    assert.equal(calls.accept.length, 0);
  });
});
```

(Extend `makeDeps` with `accountRoutable: () => ({route:true})` and `autoAllowed: () => true` defaults.)

- [ ] **Step 2: Run to verify it fails** — `node --test tests/tranche-runtime.test.js` → FAIL.

- [ ] **Step 3: Implement** — in `runTrancheManager`, after reading config and BEFORE the open decision, add the two checks via DI deps (real deps wire to `account-gate` + the live-auto-resume flag):

```javascript
// account gate (auto path only — manual goes through the IPC path)
const gate = d.accountRoutable();
if (!gate.route) { await d.recordSkip(`blocked:${gate.reason}`); return { action: `blocked:${gate.reason}` }; }
if (!d.autoAllowed()) { await d.recordSkip("blocked:live_auto_paused"); return { action: "blocked:live_auto_paused" }; }
```

In `buildRealDeps`, add: `accountRoutable: () => resolveAccountGate({ active: getActiveAccount(), confirmed: readExecConfig().confirmedAccount })` and `autoAllowed: () => autoFireAllowed({ confirmed: readExecConfig().confirmedAccount, autoResumed: getAutoResumed() })` where `getAutoResumed()` reads the in-memory session flag (Task 7).

- [ ] **Step 4: Run to verify it passes** — `node --test tests/tranche-runtime.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main/execution/tranche-manager.js tests/tranche-runtime.test.js
git commit -m "feat(arming): auto path gated on account match + live-auto-pause"
```

---

## Task 7: IPC + preload — account state, confirm, resume-auto

**Files:** Modify `app/main/ipc-execution.js`, `app/preload.cjs`

- [ ] **Step 1: IPC.** In `ipc-execution.js` add an in-memory `autoResumed` (boot false) + a getter `getAutoResumed()` (export for Task 6's deps), and handlers:
  - `execution:account` (get) → `{ active: getActiveAccount(), confirmed: readExecConfig().confirmedAccount, gate: resolveAccountGate({active, confirmed}), autoResumed }`.
  - `execution:confirmAccount` `{ typed }` → confirm the active account: if `gate.level === "live"` require `armReady(typed)` (from a shared check) else allow; on success `writeExecConfig({ confirmedAccount: active })` and return the new state.
  - `execution:resumeAuto` → set `autoResumed = true`; return `{ ok: true }`.
  - **First-run seed:** on `registerExecutionIpc()`, if `readExecConfig().confirmedAccount == null` and a paper active account is known, seed `confirmedAccount = active` (paper) so paper routing keeps working out of the box.

- [ ] **Step 2: Preload.** Add to the `execution` group:

```javascript
account: {
  get() { return ipcRenderer.invoke("execution:account"); },
  confirm(typed) { return ipcRenderer.invoke("execution:confirmAccount", { typed }); },
  resumeAuto() { return ipcRenderer.invoke("execution:resumeAuto"); },
},
```

- [ ] **Step 3: Verify** — `node --check app/main/ipc-execution.js app/preload.cjs` → OK.

- [ ] **Step 4: Commit**

```bash
git add app/main/ipc-execution.js app/preload.cjs
git commit -m "feat(arming): account state/confirm/resume-auto IPC + preload"
```

---

## Task 8: Renderer — active/confirmed display, confirm UI, resume-auto

**Files:** Modify `app/renderer/src/SettingsPopover.jsx`, `app/renderer/src/Account.helpers.js`

- [ ] **Step 1: Account.helpers.** Keep `armReady`. Remove the boot-to-paper clear (the confirmed account now persists in main config); leave a comment that persistence + the boot live-auto-pause replace it.

- [ ] **Step 2: SettingsPopover.** Load `window.api.execution.account.get()` on mount + on a short poll. Render:
  - The **active** account (name · id · PAPER/LIVE) and whether it matches the confirmed one.
  - If `gate.needsConfirm`: a confirm panel — `level==="live"` → the existing type-"LIVE" input (`armReady`) calling `account.confirm(typed)`; `level==="paper"` → a one-click "Route to <name>" calling `account.confirm()`.
  - If `confirmed.type==="live"` and `!autoResumed`: a "LIVE auto paused — tap to resume" button calling `account.resumeAuto()`.
  - The PAPER/LIVE badge reflects the **confirmed** account.

- [ ] **Step 3: Verify via CDP 9223** (after deploy in Task 9): the settings popover shows the active paper account, confirmed matches, no pending confirm; reconfirming paper works; no live UI appears (no live broker).

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/SettingsPopover.jsx app/renderer/src/Account.helpers.js
git commit -m "feat(arming): settings show active/confirmed account + confirm + resume-auto"
```

---

## Task 9: Verify paper-only end-to-end + full suite

- [ ] **Step 1:** Full suite in the worktree (symlink node_modules first): `npm test` → all green.
- [ ] **Step 2: Deploy** to the main checkout on this branch (kill `concurrently vite`, pull/switch, restart) and confirm via CDP 9223: app boots, `execution.account.get()` returns the paper account as active+confirmed (seeded), a paper order still places + flattens (account left flat), and no live UI/routing is reachable (`liveHost` null → live target blocked).
- [ ] **Step 3: Commit** any fixes; open the PR.

```bash
gh pr create --title "feat(execution): real-broker arming plumbing (active-account follow + confirm-on-switch)" --body "<summary; inert for live until the discovery spike + sign-off>"
```

---

## Task 10 (DEFERRED — separate sign-off, NOT built here): live discovery spike

When a funded broker is connected: a read-only spike confirms the proactive active-account read + paper/live type signal + the live trading host, and writes `liveHost`. Only after that, with explicit user sign-off, can a live account be confirmed and a real order fire. **Not part of this plan's build.**

---

## Self-review

**Spec coverage:** ✅ follow active account (Task 3 deriveActiveAccount + Task 4 feed), ✅ confirm-on-switch gate (Task 1 resolveAccountGate + Task 7/8 UI), ✅ live=type-LIVE / paper=one-click (Task 7 confirm + Task 8 UI), ✅ persist confirmed across restarts (Task 2 config, no boot reset), ✅ boot live-auto-pause (Task 1 autoFireAllowed + Task 6 + Task 7 resumeAuto), ✅ route by confirmed host+id (Task 1 targetFor + Task 5), ✅ same guardrails (unchanged), ✅ hard gate / inert for live (liveHost null → targetFor null; Task 5/10), ✅ manual unaffected by live-auto-pause (Task 6 gates auto path only).

**Placeholder scan:** the live host/id values are intentionally null (the deferred spike fills them) — a designed state, not a placeholder. No TBD/vague steps.

**Type consistency:** account shape `{id,type,name}`, `resolveAccountGate`→`{route,needsConfirm,level,reason}`, `autoFireAllowed`, `targetFor`, `deriveActiveAccount`, `getActiveAccount` used identically across Tasks 1/3/5/6/7.
