# Webview Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the project's TradingView analysis surface from the standalone TradingView Desktop app (CDP port 9223) to the in-app `<webview>` already present in `TvChart.jsx`. After this plan ships, the in-app webview is the single TradingView surface.

**Architecture:** Add one Electron command-line switch (`--remote-debugging-port=9223`). Electron then exposes all its renderer processes (including the webview) via CDP on 9223. The CLI's existing tab-discovery in `packages/core/tab.js` already filters targets by the `tradingview.com/chart` URL pattern, so it picks up the webview's tab automatically — no `packages/core` rewrite needed. The TV Desktop auto-launch helper in `packages/core/health.js` gets retired since the in-app webview is now the default surface.

**Tech Stack:** Electron (existing), Node.js, `node --test` test runner, Chrome DevTools Protocol (existing CDP wiring in `packages/core/connection.js`).

**Branch:** `feat/webview-migration` (already created off `main`; spec committed at `3a57427`).

---

## File Structure

**Created:**
- `scripts/diff-bundle.js` — CLI script that structurally compares two `./bin/tv analyze --out` bundles. Pure functions exported for testing.
- `tests/diff-bundle.test.js` — unit tests for `compareBundles` and its helpers.
- `tests/migration/desktop-baseline.json` — frozen baseline bundle captured on TV Desktop before the migration. Committed.
- `tests/migration/webview-baseline.json` — baseline bundle captured on the in-app webview after the migration. Committed for record (small file).
- `tests/migration/.gitkeep` — ensures the directory exists when both baselines are absent.

**Modified:**
- `app/electron-main.js` — add `app.commandLine.appendSwitch("remote-debugging-port", "9223")` before `app.whenReady()`.
- `packages/core/health.js` — remove the `launch` helper and its platform candidate-paths. Remove now-unused `existsSync`, `execSync`, `spawn` imports.
- `packages/core/tab.js` — line 63 — rewrite the error message that misleadingly references `tv_launch` (an MCP tool name CLAUDE.md constraint #2 forbids referencing).
- `cli/commands/health.js` — remove the `tv launch` CLI registration (it wraps `health.launch` which we're deleting).
- `package.json` — line 6 — update the description to drop the "locked to CDP 9223" framing.
- `CLAUDE.md` — rewrite hard constraint #1 wording and add a new architecture-decision row documenting this migration.

---

## Task 1: Capture the Desktop baseline (USER ACTION)

**Files:**
- Create: `tests/migration/desktop-baseline.json`
- Create: `tests/migration/.gitkeep`

**This task requires the user.** TradingView Desktop must be running on `--remote-debugging-port=9223` with the user's normal chart (MNQ1! or MES1!, ICT Engine indicator loaded). The Electron app should NOT be running (port conflict).

- [ ] **Step 1: Confirm starting state**

Run: `git status` and `git branch --show-current`
Expected: branch is `feat/webview-migration`; working tree clean (or only has the spec committed at 3a57427).

- [ ] **Step 2: Create the migration directory**

```bash
mkdir -p tests/migration
touch tests/migration/.gitkeep
```

- [ ] **Step 3: Confirm TV Desktop is running on 9223**

Run: `curl -s http://localhost:9223/json/list | head -5`
Expected: JSON output listing one or more page targets, including at least one with URL matching `tradingview.com/chart`. If the response is empty or connection refused, TV Desktop is not running on 9223 — launch it manually before continuing.

- [ ] **Step 4: Capture the Desktop baseline**

```bash
./bin/tv analyze --out tests/migration/desktop-baseline.json
```

Expected: command completes in ~10–15 seconds (full multi-TF sweep); creates `tests/migration/desktop-baseline.json` (~150–250 KB). If the command errors, TV Desktop's chart is misconfigured (missing ICT Engine, wrong symbol, etc.) — fix and retry.

- [ ] **Step 5: Sanity-check the baseline**

```bash
node -e "const b = require('./tests/migration/desktop-baseline.json'); console.log('symbol=', b.chart?.symbol, 'tf=', b.chart?.resolution, 'engine_schema=', b.engine?.schema, 'has_pillar3=', !!b.gates?.engine?.pillar3);"
```
Expected output: `symbol= MNQ1! tf= 1 engine_schema= 1 has_pillar3= true` (symbol/tf will vary by user's chart state, but `engine_schema= 1` and `has_pillar3= true` are required — those tell us the ICT Engine indicator is loaded and parsed correctly).

- [ ] **Step 6: Commit the baseline + placeholder**

```bash
git add tests/migration/desktop-baseline.json tests/migration/.gitkeep
git commit -m "$(cat <<'EOF'
test(migration): freeze TV Desktop analyze-bundle baseline

Captured pre-migration on TV Desktop running --remote-debugging-port=9223.
Used by scripts/diff-bundle.js (next task) as the reference for the
webview-vs-desktop loss-free check during verification.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Write failing tests for `scripts/diff-bundle.js`

**Files:**
- Create: `tests/diff-bundle.test.js`

The diff-bundle script needs to structurally compare two analyze-bundle JSON objects, allowing 0.25pt drift on numeric fields and skipping known-volatile paths (timestamps, emit times). Write the tests first.

- [ ] **Step 1: Write the test file**

Create `tests/diff-bundle.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compareBundles, isVolatilePath } from "../scripts/diff-bundle.js";

test("identical bundles report ok with no issues", () => {
  const a = { quote: { last: 29800.25 }, chart: { symbol: "MNQ1!" } };
  const b = { quote: { last: 29800.25 }, chart: { symbol: "MNQ1!" } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("number drift within 0.25pt tolerance passes", () => {
  const a = { quote: { last: 29800.25 } };
  const b = { quote: { last: 29800.50 } }; // +0.25pt — at threshold
  const result = compareBundles(a, b);
  assert.equal(result.ok, true);
});

test("number drift exceeding 0.25pt tolerance fails", () => {
  const a = { quote: { last: 29800.25 } };
  const b = { quote: { last: 29801.00 } }; // +0.75pt
  const result = compareBundles(a, b);
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].kind, "number-drift");
  assert.equal(result.issues[0].path, "quote.last");
});

test("missing key in b is reported", () => {
  const a = { quote: { last: 29800.25, bid: 29800.00 } };
  const b = { quote: { last: 29800.25 } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].kind, "missing-key");
  assert.equal(result.issues[0].path, "quote.bid");
});

test("extra key in b is reported", () => {
  const a = { quote: { last: 29800.25 } };
  const b = { quote: { last: 29800.25, extra: 1 } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].kind, "extra-key");
  assert.equal(result.issues[0].path, "quote.extra");
});

test("type mismatch (number vs string) is reported", () => {
  const a = { quote: { last: 29800.25 } };
  const b = { quote: { last: "29800.25" } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].kind, "type-mismatch");
});

test("array length mismatch is reported", () => {
  const a = { bars: [1, 2, 3] };
  const b = { bars: [1, 2] };
  const result = compareBundles(a, b);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].kind, "array-length");
  assert.equal(result.issues[0].path, "bars");
});

test("string mismatch is reported", () => {
  const a = { chart: { symbol: "MNQ1!" } };
  const b = { chart: { symbol: "MES1!" } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].kind, "string-mismatch");
});

test("nested arrays compared element-wise", () => {
  const a = { bars: [{ close: 29800 }, { close: 29810 }] };
  const b = { bars: [{ close: 29800.10 }, { close: 29810.20 }] }; // both within 0.25
  const result = compareBundles(a, b);
  assert.equal(result.ok, true);
});

test("volatile top-level timestamp is skipped", () => {
  const a = { timestamp: "2026-05-27T14:32:00.000Z", quote: { last: 29800 } };
  const b = { timestamp: "2026-05-27T14:32:45.000Z", quote: { last: 29800 } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, true);
});

test("volatile nested emit_ms is skipped", () => {
  const a = { gates: { engine: { meta: { emit_ms: 1779836400000 } } } };
  const b = { gates: { engine: { meta: { emit_ms: 1779836460000 } } } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, true);
});

test("volatile path emit_age_seconds is skipped", () => {
  const a = { gates: { engine: { meta: { emit_age_seconds: 12 } } } };
  const b = { gates: { engine: { meta: { emit_age_seconds: 47 } } } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, true);
});

test("isVolatilePath matches documented volatile patterns", () => {
  assert.equal(isVolatilePath("timestamp"), true);
  assert.equal(isVolatilePath("gates.engine.meta.emit_ms"), true);
  assert.equal(isVolatilePath("gates.engine.meta.emit_age_seconds"), true);
  assert.equal(isVolatilePath("gates.engine.meta.stale"), true);
  assert.equal(isVolatilePath("gates.session.timestamp_et"), true);
  assert.equal(isVolatilePath("candidates.meta.timestamp_ms"), true);
  assert.equal(isVolatilePath("candidates.meta.bar_close_ms"), true);
  assert.equal(isVolatilePath("quote.last"), false);
  assert.equal(isVolatilePath("chart.symbol"), false);
});

test("null/undefined handled correctly", () => {
  const a = { engine_by_tf: null };
  const b = { engine_by_tf: null };
  assert.equal(compareBundles(a, b).ok, true);

  const c = { engine_by_tf: null };
  const d = { engine_by_tf: { daily: {} } };
  assert.equal(compareBundles(c, d).ok, false);
});

test("two identical real fixture bundles compare ok", () => {
  // Self-compare guards against the diff falsely flagging real bundle shapes.
  // Uses an existing fixture so we exercise the full nested shape, not toys.
  const bundle = JSON.parse(
    fs.readFileSync(path.resolve("tests/fixtures/001-current.bundle.json"), "utf8")
  );
  const copy = JSON.parse(JSON.stringify(bundle));
  const result = compareBundles(bundle, copy);
  assert.equal(result.ok, true, `unexpected issues: ${JSON.stringify(result.issues.slice(0, 3))}`);
});
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
node --test tests/diff-bundle.test.js
```
Expected: all tests fail with `Cannot find module '../scripts/diff-bundle.js'` or similar — `diff-bundle.js` doesn't exist yet.

---

## Task 3: Implement `scripts/diff-bundle.js`

**Files:**
- Create: `scripts/diff-bundle.js`

- [ ] **Step 1: Write the implementation**

Create `scripts/diff-bundle.js`:

```js
#!/usr/bin/env node
// scripts/diff-bundle.js — structural compare of two `./bin/tv analyze --out` bundles.
//
// Used during the webview migration to confirm the in-app webview produces an
// analyze bundle structurally identical to the one TV Desktop produces for the
// same chart state. Numeric fields tolerate 0.25pt drift (TV web↔desktop data
// feed precision). Timestamps and emission-age fields are skipped because
// they always differ between captures taken seconds apart.
//
// Exports pure functions for unit testing. The bottom of the file is the CLI.

import fs from "node:fs";

const DEFAULT_TOLERANCE = 0.25;

// Paths that always differ between two captures of the same chart state.
// Each pattern is matched against the dot-joined property path (e.g.
// "gates.engine.meta.emit_ms"). Listed explicitly — no wildcards beyond
// what's encoded here — so volatility is auditable.
const VOLATILE_PATHS = [
  /^timestamp$/,
  /^gates\.engine\.meta\.emit_ms$/,
  /^gates\.engine\.meta\.emit_age_seconds$/,
  /^gates\.engine\.meta\.stale$/,
  /^gates\.session\.timestamp_et$/,
  /^candidates\.meta\.timestamp_ms$/,
  /^candidates\.meta\.bar_close_ms$/,
  /^baseline_meta\.captured_at$/,
  /^baseline_meta\.age_seconds$/,
];

export function isVolatilePath(path) {
  return VOLATILE_PATHS.some((re) => re.test(path));
}

export function compareBundles(a, b, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const issues = [];
  walk(a, b, "", issues, tolerance);
  return { ok: issues.length === 0, issues };
}

function walk(a, b, path, issues, tolerance) {
  if (isVolatilePath(path)) return;

  // null/undefined handling — both null is fine, mismatch is a type-mismatch issue.
  if (a === null || b === null || a === undefined || b === undefined) {
    if (a === b) return;
    issues.push({ path, kind: "type-mismatch", expected: a, actual: b });
    return;
  }

  // Type check first.
  const ta = Array.isArray(a) ? "array" : typeof a;
  const tb = Array.isArray(b) ? "array" : typeof b;
  if (ta !== tb) {
    issues.push({ path, kind: "type-mismatch", expected: a, actual: b });
    return;
  }

  if (ta === "array") {
    if (a.length !== b.length) {
      issues.push({
        path,
        kind: "array-length",
        expected: a.length,
        actual: b.length,
      });
      return;
    }
    for (let i = 0; i < a.length; i++) {
      walk(a[i], b[i], `${path}[${i}]`, issues, tolerance);
    }
    return;
  }

  if (ta === "object") {
    const aKeys = new Set(Object.keys(a));
    const bKeys = new Set(Object.keys(b));
    for (const k of aKeys) {
      if (!bKeys.has(k)) {
        issues.push({
          path: path ? `${path}.${k}` : k,
          kind: "missing-key",
          expected: a[k],
          actual: undefined,
        });
      }
    }
    for (const k of bKeys) {
      if (!aKeys.has(k)) {
        issues.push({
          path: path ? `${path}.${k}` : k,
          kind: "extra-key",
          expected: undefined,
          actual: b[k],
        });
      }
    }
    for (const k of aKeys) {
      if (bKeys.has(k)) {
        walk(a[k], b[k], path ? `${path}.${k}` : k, issues, tolerance);
      }
    }
    return;
  }

  if (ta === "number") {
    if (!Number.isFinite(a) && !Number.isFinite(b)) return; // NaN === NaN
    if (Math.abs(a - b) > tolerance) {
      issues.push({
        path,
        kind: "number-drift",
        expected: a,
        actual: b,
        delta: b - a,
      });
    }
    return;
  }

  if (ta === "string") {
    if (a !== b) {
      issues.push({ path, kind: "string-mismatch", expected: a, actual: b });
    }
    return;
  }

  if (ta === "boolean") {
    if (a !== b) {
      issues.push({ path, kind: "type-mismatch", expected: a, actual: b });
    }
    return;
  }
}

// ---------------------------- CLI ----------------------------
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [, , aPath, bPath] = process.argv;
  if (!aPath || !bPath) {
    console.error("usage: scripts/diff-bundle.js <baseline.json> <new.json>");
    process.exit(2);
  }
  const a = JSON.parse(fs.readFileSync(aPath, "utf8"));
  const b = JSON.parse(fs.readFileSync(bPath, "utf8"));
  const { ok, issues } = compareBundles(a, b);
  if (ok) {
    console.log(`PASS: ${aPath} ≈ ${bPath} (no structural differences, all numbers within 0.25pt)`);
    process.exit(0);
  }
  console.log(`FAIL: ${issues.length} issue(s) found`);
  for (const issue of issues.slice(0, 50)) {
    if (issue.kind === "number-drift") {
      console.log(`  ${issue.kind}  ${issue.path}: ${issue.expected} → ${issue.actual} (Δ${issue.delta?.toFixed(4)})`);
    } else {
      console.log(`  ${issue.kind}  ${issue.path}: ${JSON.stringify(issue.expected)} vs ${JSON.stringify(issue.actual)}`);
    }
  }
  if (issues.length > 50) console.log(`  … and ${issues.length - 50} more`);
  process.exit(1);
}
```

- [ ] **Step 2: Run tests and confirm they pass**

```bash
node --test tests/diff-bundle.test.js
```
Expected: all 14 tests pass.

- [ ] **Step 3: Sanity-check: self-diff Desktop baseline**

```bash
node scripts/diff-bundle.js tests/migration/desktop-baseline.json tests/migration/desktop-baseline.json
```
Expected: `PASS: tests/migration/desktop-baseline.json ≈ tests/migration/desktop-baseline.json (no structural differences, all numbers within 0.25pt)` and exit code 0. Self-compare proves the diff script doesn't false-positive on the real bundle shape.

- [ ] **Step 4: Commit**

```bash
git add scripts/diff-bundle.js tests/diff-bundle.test.js
git commit -m "$(cat <<'EOF'
test(diff-bundle): structural bundle diff with 0.25pt numeric tolerance

scripts/diff-bundle.js exports pure compareBundles() + isVolatilePath() and
wraps them in a CLI for the webview migration verification. Skips a small
explicit list of always-different paths (timestamps, engine emit times).

+14 unit tests covering identical bundles, drift within/over tolerance,
missing/extra keys, type/array-length mismatches, volatile-path skipping,
and a self-compare against tests/fixtures/001-current.bundle.json so the
shape of a real bundle is exercised.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Apply the Electron CDP switch

**Files:**
- Modify: `app/electron-main.js` (lines 1–22 area — add the switch before `app.whenReady()`)

- [ ] **Step 1: Edit electron-main.js**

The current top of the file is:

```js
import { app, BrowserWindow, powerMonitor } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initSdk } from "./main/sdk.js";
// ... more imports ...
import { startTradeTickerWatchdog } from "./main/trade-ticker-watchdog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const isDev = !app.isPackaged;
```

Use the Edit tool to add one new statement immediately after `const isDev = !app.isPackaged;`:

```js
const isDev = !app.isPackaged;

// Expose this Electron process (including all renderer processes — the
// in-app TradingView <webview> in TvChart.jsx) over CDP on port 9223.
// The CLI's tab-discovery in packages/core/tab.js filters by URL pattern
// "tradingview.com/chart" and so picks the webview's target automatically.
// MUST run before app.whenReady() — Chromium reads command-line switches at startup.
app.commandLine.appendSwitch("remote-debugging-port", "9223");
```

- [ ] **Step 2: Verify the file parses**

```bash
node --check app/electron-main.js
```
Expected: no output (means OK). If it throws a SyntaxError, the edit broke something.

- [ ] **Step 3: Do NOT commit yet**

The next 4 tasks complete the migration code change. We commit them all together as one atomic change so reverts are clean.

---

## Task 5: Remove the `launch` helper from `packages/core/health.js`

**Files:**
- Modify: `packages/core/health.js` (delete lines 162–254 — the entire `launch` function)

- [ ] **Step 1: Delete the launch function**

Use the Edit tool to remove this exact block from `packages/core/health.js` (starting at line 162):

```js
export async function launch({ port, kill_existing } = {}) {
  const cdpPort = port || 9222;
  const killFirst = kill_existing !== false;
  const platform = process.platform;

  const pathMap = {
    darwin: [
      '/Applications/TradingView.app/Contents/MacOS/TradingView',
      `${process.env.HOME}/Applications/TradingView.app/Contents/MacOS/TradingView`,
    ],
    win32: [
      `${process.env.LOCALAPPDATA}\\TradingView\\TradingView.exe`,
      `${process.env.PROGRAMFILES}\\TradingView\\TradingView.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\TradingView\\TradingView.exe`,
    ],
    linux: [
      '/opt/TradingView/tradingview',
      '/opt/TradingView/TradingView',
      `${process.env.HOME}/.local/share/TradingView/TradingView`,
      '/usr/bin/tradingview',
      '/snap/tradingview/current/tradingview',
    ],
  };

  let tvPath = null;
  const candidates = pathMap[platform] || pathMap.linux;
  for (const p of candidates) {
    if (p && existsSync(p)) { tvPath = p; break; }
  }

  if (!tvPath) {
    try {
      const cmd = platform === 'win32' ? 'where TradingView.exe' : 'which tradingview';
      tvPath = execSync(cmd, { timeout: 3000 }).toString().trim().split('\n')[0];
      if (tvPath && !existsSync(tvPath)) tvPath = null;
    } catch { /* ignore */ }
  }

  if (!tvPath && platform === 'darwin') {
    try {
      const found = execSync('mdfind "kMDItemFSName == TradingView.app" | head -1', { timeout: 5000 }).toString().trim();
      if (found) {
        const candidate = `${found}/Contents/MacOS/TradingView`;
        if (existsSync(candidate)) tvPath = candidate;
      }
    } catch { /* ignore */ }
  }

  if (!tvPath) {
    throw new Error(`TradingView not found on ${platform}. Searched: ${candidates.join(', ')}. Launch manually with: /path/to/TradingView --remote-debugging-port=${cdpPort}`);
  }

  if (killFirst) {
    try {
      if (platform === 'win32') execSync('taskkill /F /IM TradingView.exe', { timeout: 5000 });
      else execSync('pkill -f TradingView', { timeout: 5000 });
      await new Promise(r => setTimeout(r, 1500));
    } catch { /* may not be running */ }
  }

  // ELECTRON_RUN_AS_NODE makes the Electron binary behave as Node, which rejects
  // --remote-debugging-port as an unknown flag and exits silently. Scrub it.
  const { ELECTRON_RUN_AS_NODE, ...cleanEnv } = process.env;
  const child = spawn(tvPath, [`--remote-debugging-port=${cdpPort}`], { detached: true, stdio: 'ignore', env: cleanEnv });
  child.unref();

  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const http = await import('http');
      const ready = await new Promise((resolve) => {
        http.get(`http://localhost:${cdpPort}/json/version`, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', () => resolve(null));
      });
      if (ready) {
        const info = JSON.parse(ready);
        return {
          success: true, platform, binary: tvPath, pid: child.pid,
          cdp_port: cdpPort, cdp_url: `http://localhost:${cdpPort}`,
          browser: info.Browser, user_agent: info['User-Agent'],
        };
      }
    } catch { /* retry */ }
  }

  return {
    success: true, platform, binary: tvPath, pid: child.pid, cdp_port: cdpPort, cdp_ready: false,
    warning: 'TradingView launched but CDP not responding yet. It may still be loading. Try tv_health_check in a few seconds.',
  };
}
```

- [ ] **Step 2: Remove the now-unused imports**

Edit the top of `packages/core/health.js` from:

```js
import { getClient, getTargetInfo, evaluate } from './connection.js';
import { existsSync } from 'fs';
import { execSync, spawn } from 'child_process';
```

to:

```js
import { getClient, getTargetInfo, evaluate } from './connection.js';
```

(`existsSync`, `execSync`, `spawn` were only used by the deleted `launch` function.)

- [ ] **Step 3: Verify the file parses**

```bash
node --check packages/core/health.js
```
Expected: no output (means OK).

- [ ] **Step 4: Verify nothing else imports `launch` from health**

```bash
grep -rn "health.*launch\|launch.*from.*health" cli/ packages/ 2>/dev/null | grep -v node_modules
```
Expected: only matches in `cli/commands/health.js` (the CLI registration we're about to remove in the next task) and possibly comments. No other consumer should reference `health.launch`.

---

## Task 6: Remove the `tv launch` CLI command

**Files:**
- Modify: `cli/commands/health.js` (delete lines 9–19 — the `register('launch', ...)` block)

- [ ] **Step 1: Edit the file**

Current content of `cli/commands/health.js`:

```js
import { register } from '../router.js';
import * as core from '@tvmcp/core/health';

register('status', {
  description: 'Check CDP connection to TradingView',
  handler: () => core.healthCheck(),
});

register('launch', {
  description: 'Launch TradingView with CDP enabled',
  options: {
    port: { type: 'string', short: 'p', description: 'CDP port (default 9222)' },
    'no-kill': { type: 'boolean', description: 'Do not kill existing instances' },
  },
  handler: (opts) => core.launch({
    port: opts.port ? Number(opts.port) : undefined,
    kill_existing: !opts['no-kill'],
  }),
});
```

Replace with:

```js
import { register } from '../router.js';
import * as core from '@tvmcp/core/health';

register('status', {
  description: 'Check CDP connection to TradingView',
  handler: () => core.healthCheck(),
});
```

- [ ] **Step 2: Verify**

```bash
node --check cli/commands/health.js
```
Expected: no output.

- [ ] **Step 3: Verify `tv launch` no longer registers**

```bash
./bin/tv --help 2>&1 | grep -i launch
```
Expected: no matches. (The router only knows about commands that registered themselves.)

---

## Task 7: Fix the misleading error message in `packages/core/tab.js`

**Files:**
- Modify: `packages/core/tab.js` line 63

- [ ] **Step 1: Edit**

Current line 63:

```js
    throw new Error('Cannot close the last tab. Use tv_launch to restart TradingView instead.');
```

Replace with:

```js
    throw new Error('Cannot close the last tab. Open a new tab in the in-app webview (Cmd+T while focused on the chart pane) before closing the last one.');
```

- [ ] **Step 2: Verify**

```bash
node --check packages/core/tab.js
```
Expected: no output.

---

## Task 8: Update `package.json` description

**Files:**
- Modify: `package.json` line 6

- [ ] **Step 1: Edit**

Current line 6:

```json
  "description": "TradingView chart analyzer driven by Claude. CLI-only, locked to CDP 9223.",
```

Replace with:

```json
  "description": "TradingView chart analyzer driven by Claude. CLI talks to the in-app webview over CDP (port 9223).",
```

- [ ] **Step 2: Verify it's still valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('./package.json', 'utf8'))"
```
Expected: no output (parsing succeeded).

---

## Task 9: Commit the migration code change

The 5 file edits from Tasks 4–8 together form one atomic migration. Commit them as a single commit so revert is one operation.

- [ ] **Step 1: Stage the files by name**

```bash
git add app/electron-main.js packages/core/health.js packages/core/tab.js cli/commands/health.js package.json
```

- [ ] **Step 2: Confirm exactly 5 files staged**

```bash
git status --short
```
Expected: exactly 5 lines starting with `M ` for the files listed above. If anything else is staged, unstage it (`git reset <file>`).

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(webview): retire TV Desktop dependency; route CLI to in-app webview

Adds `app.commandLine.appendSwitch("remote-debugging-port", "9223")` to
electron-main.js so the in-app Electron process exposes its renderers
(including the TradingView <webview> in TvChart.jsx) over CDP on 9223.

The CLI's tab-discovery (packages/core/tab.js:18) already filters CDP
targets by the `tradingview.com/chart` URL pattern, so it picks up the
webview's target automatically — no packages/core rewrite needed.

Removed:
- packages/core/health.js — `launch` helper that spawned the TV Desktop
  binary with `--remote-debugging-port=9222` (note: 9222, the wrong port
  for this project) plus its platform candidate-path lookup and the
  unused fs/child_process imports.
- cli/commands/health.js — `tv launch` CLI command (wrapped the deleted
  helper).

Fixed:
- packages/core/tab.js:63 — error message no longer references the
  `tv_launch` MCP tool name (CLAUDE.md constraint #2 forbids referencing
  MCP tools); points users to the in-app webview instead.

Updated:
- package.json description — drops "locked to CDP 9223" framing in
  favor of "CLI talks to the in-app webview over CDP (port 9223)".

CLAUDE.md hard-constraint rewording and the decision-row entry land in a
follow-up commit after webview-baseline + smoke fixtures + npm test all
pass.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Capture webview baseline + run diff (USER ACTION)

**Files:**
- Create: `tests/migration/webview-baseline.json`

**This task requires the user.** TV Desktop must be killed/quit (port 9223 free). The Electron app is launched fresh from the feature branch so the new debug-port switch takes effect. The in-app webview should be loaded with the same chart state (symbol, TF) as when the Desktop baseline was captured.

- [ ] **Step 1: Quit TV Desktop**

User action: fully quit TradingView Desktop. Verify port 9223 is free:

```bash
curl -s http://localhost:9223/json/list
```
Expected: connection refused, OR if it returns JSON, you didn't fully quit TV Desktop. Force-quit if needed.

- [ ] **Step 2: Launch the Electron app from the feature branch**

```bash
cd app && npm run dev
```
(or whichever start command the user uses — `npm start`, `npm run start`, etc. The key thing is it boots from `feat/webview-migration` so the new `commandLine.appendSwitch` runs.)

Wait for the app to fully load (chart visible in the webview, ICT Engine drawn).

- [ ] **Step 3: Confirm CDP is exposed by Electron now**

In a separate terminal:

```bash
curl -s http://localhost:9223/json/list | python3 -m json.tool | head -40
```
Expected: JSON listing one or more targets. At least one target should have `"url"` matching `https://www.tradingview.com/chart/...` — that's the webview.

- [ ] **Step 4: Capture the webview baseline**

```bash
./bin/tv analyze --out tests/migration/webview-baseline.json
```
Expected: same shape as the Desktop baseline. ~150–250 KB file. If it errors with "no chart tab found", the webview hasn't fully loaded the chart yet — wait 5 seconds and retry.

- [ ] **Step 5: Run the diff**

```bash
node scripts/diff-bundle.js tests/migration/desktop-baseline.json tests/migration/webview-baseline.json
```
Expected: `PASS: ... (no structural differences, all numbers within 0.25pt)` and exit code 0.

If FAIL: read the issue list. Acceptable categories that might appear and need adjustment:
- A handful of new fields in the webview bundle that aren't in the Desktop bundle (TradingView Web may emit a field the Desktop version doesn't). Treat as a small follow-up: add that path to `VOLATILE_PATHS` if it's expected to differ, or investigate the underlying difference.
- Numeric drifts >0.25pt on `quote.last` or one of the bar OHLC fields. The Desktop and Web feeds CAN differ on a 1m bar that's actively forming. Re-capture both baselines closer together in time (within 5 seconds of each other) and re-run. If the drift persists, this is a real regression — stop and investigate.

- [ ] **Step 6: Commit the webview baseline**

```bash
git add tests/migration/webview-baseline.json
git commit -m "$(cat <<'EOF'
test(migration): freeze webview analyze-bundle baseline

Captured post-migration with the Electron app exposing CDP on 9223 via
the new commandLine.appendSwitch. scripts/diff-bundle.js confirms this
baseline is structurally identical to the Desktop baseline (all numeric
fields within 0.25pt).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Run smoke fixtures + unit test suite

- [ ] **Step 1: Run smoke fixtures**

```bash
npm run smoke:fixtures
```
Expected: `PASS: 16/16 checks across 8 fixture(s)` (or whatever the current fixture count is — the count should match what `main` shows, since no fixtures changed).

If it fails: the migration broke fixture parsing. Stop and investigate before continuing.

- [ ] **Step 2: Run the unit test suite**

```bash
cd app && npm test
cd ..
```
Expected: `tests <N> · pass <N-1> · fail 1` where the one failure is the pre-existing `tvAlertCreate` test (per CLAUDE.md decision row 2026-05-27 PR 2 — "pre-existing `tvAlertCreate` failure on `main` is unchanged"). Any OTHER failure is a regression caused by the migration.

- [ ] **Step 3: Run the diff-bundle test suite specifically**

```bash
node --test tests/diff-bundle.test.js
```
Expected: all 14 tests pass.

- [ ] **Step 4: No commit needed**

This task only runs verifications; nothing is modified.

---

## Task 12: User-verifies — full live session + manual probes (USER ACTION)

**This task requires the user.** Cannot be performed by the plan executor — it requires watching the app run live for a session and clicking through TV UI manually.

- [ ] **Step 1: Run one full live session on the new backend**

Pick an upcoming session (NY AM or NY PM). Launch the Electron app from the feature branch, switch to LIVE mode, and let it run through:
- brief turn (auto-fires ~30 min before session)
- open_reaction phase (first 15 min of the session)
- entry_hunt phase (rest of the session)
- session_wrap turn (~5 min after session end)

Acceptance: the session completes end-to-end with no thrown errors visible in the Electron console (Cmd+Opt+I → Console). Bar-close detector heartbeats normally (check `state/session/detector-heartbeat.json` — the `last_emit_ms` should advance ~every 60 seconds). The session is NOT required to produce actual tradable setups — only to run cleanly through every phase.

If any thrown error appears in the console: capture the stack trace and stop. Do not proceed to PR.

- [ ] **Step 2: Manual probe — Alerts**

In the PREP panel, arm a bell on a key level by clicking the ○ bell icon next to a level. Wait for price to reach that level (or pick a level close to current price for a quick test). Verify the alert fires in the app (toast + entry in the alerts cell on the top bar).

- [ ] **Step 3: Manual probe — Replay**

From a terminal (with the app still running):

```bash
./bin/tv replay start --from 2026-05-20
./bin/tv replay status
./bin/tv replay step
./bin/tv replay stop
```
Expected: each command returns `success: true` JSON. The chart in the webview visibly enters replay mode (toolbar appears, can step bars), then exits cleanly.

- [ ] **Step 4: Manual probe — Drawings**

```bash
./bin/tv draw shape --kind horizontal_line --price 29800 --label "test-line"
./bin/tv draw list
./bin/tv draw clear --label "test-line"
```
Expected: a horizontal line at 29800 appears on the chart, is listed by `draw list`, and disappears after `draw clear`.

- [ ] **Step 5: Manual probe — Multi-tab**

In the webview, open a second tradingview.com chart tab (Cmd+T or click "+" if visible). Then:

```bash
./bin/tv tab list
./bin/tv tab switch --index 0
./bin/tv tab switch --index 1
```
Expected: `tab list` shows both tabs; `tab switch` brings each to front in the webview.

- [ ] **Step 6: Document any issues found**

If any probe failed, write a short note to share with the implementer (or fix the underlying issue if obvious). Do not proceed to PR until all 5 manual checks pass.

- [ ] **Step 7: No commit needed**

This task only verifies; nothing is modified.

---

## Task 13: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (line 25 — hard constraint #1 wording; bottom of architecture decisions table — new row)

- [ ] **Step 1: Rewrite hard constraint #1**

Find this exact text in `CLAUDE.md`:

```markdown
1. **CDP port 9223 only. Never 9222.** The vendored CLI under `cli/` has its core (`packages/core/connection.js`, `packages/core/tab.js`) hardcoded to 9223. Do not invoke upstream `~/tradingview-mcp-ict` from this project — that copy targets 9222 and is used by other projects on this machine.
```

Replace with:

```markdown
1. **Default backend is the in-app webview on Electron's debug port 9223.** Since the 2026-05-27 webview migration, the Electron app exposes CDP on port 9223 via `app.commandLine.appendSwitch("remote-debugging-port", "9223")` in `electron-main.js`. The in-app TradingView `<webview>` (in `TvChart.jsx`) is the analysis target. TV Desktop on 9223 is a manual fallback only — do not auto-launch it. Never invoke upstream `~/tradingview-mcp-ict` from this project — that copy targets 9222 and is used by other projects on this machine.
```

- [ ] **Step 2: Append the architecture-decision row**

Find the most recent row in the `## Architecture decisions` table (the one ending with `... Closes the 3-PR prompt-engineering series. Spec: [...]. Plan: [...]. |`). Add a new row right after it:

```markdown
| 2026-05-27 | Webview migration — retire TV Desktop dependency, single TradingView surface | The CLI was talking to TradingView Desktop (CDP 9223, separate native process), while the in-app `<webview>` in `TvChart.jsx` sat alongside as a display-only second surface. Two TradingView instances, one source of truth. Architectural simplification + unlocks the future Backtest page (paused brainstorm) by routing all chart access through the embedded webview — gives the dashboard layout design freedom. **This PR:** one-line `app.commandLine.appendSwitch("remote-debugging-port", "9223")` in `app/electron-main.js` exposes the Electron process (incl. webviews) over CDP on 9223. The CLI's tab-discovery in `packages/core/tab.js:18` already filters CDP targets by the `tradingview.com/chart` URL pattern, so it picks up the webview's target automatically — no `packages/core` rewrite needed. Removed: `launch` helper from `packages/core/health.js` (was spawning TV Desktop with `--remote-debugging-port=9222` — the wrong port for this project anyway) + unused `fs`/`child_process` imports + the `tv launch` CLI command in `cli/commands/health.js`. Fixed: `packages/core/tab.js:63` error message no longer references the `tv_launch` MCP tool name (CLAUDE.md constraint #2 forbids referencing MCP tools). User-side: one-time setup inside the webview (sign in, load saved layout incl. ICT Engine, set as default) — user-verified working before migration. **Verification:** new `scripts/diff-bundle.js` structurally compares two `./bin/tv analyze --out` bundles with 0.25pt numeric tolerance + skip-list for volatile paths (timestamps, emit times); +14 unit tests in `tests/diff-bundle.test.js`. Pre-migration baseline at `tests/migration/desktop-baseline.json`, post-migration baseline at `tests/migration/webview-baseline.json` — diff PASS (schema identical, all numbers within 0.25pt). Smoke fixtures 16/16. `npm test` clean modulo pre-existing `tvAlertCreate` failure. Manual probes: alerts arm/fire, replay start/step/stop, drawings draw/list/clear, multi-tab list/switch — all pass on the webview backend. Live session — one full NY session run cleanly through brief → open_reaction → entry_hunt → wrap with no thrown errors. **Rollback:** `git revert <migration-commit>` + relaunch TV Desktop manually with `--remote-debugging-port=9223`. Zero state migration — both backends consume `state/` files identically. Spec: [docs/superpowers/specs/2026-05-27-webview-migration-design.md](docs/superpowers/specs/2026-05-27-webview-migration-design.md). Plan: [docs/superpowers/plans/2026-05-27-webview-migration.md](docs/superpowers/plans/2026-05-27-webview-migration.md). |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude.md): document webview migration in hard constraints + decisions

Rewords hard constraint #1 to reflect the new default backend (in-app
webview on Electron's debug port 9223 — not TV Desktop on 9223). Adds an
architecture-decision row covering: what changed, why, what was removed,
how it's verified, and the rollback path.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Push branch + open PR

- [ ] **Step 1: Check the branch state**

```bash
git log --oneline main..HEAD
```
Expected: 4–5 commits on this branch:
- spec commit (`docs(spec): webview migration design …`)
- desktop baseline commit
- diff-bundle commit
- migration code change commit
- webview baseline commit
- CLAUDE.md commit

If anything else is in the log, investigate before pushing.

- [ ] **Step 2: Push to origin**

```bash
git push -u origin feat/webview-migration
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "feat(webview): retire TV Desktop dependency; route CLI to in-app webview" --body "$(cat <<'EOF'
## Summary

- Migrates TradingView analysis surface from the standalone TV Desktop app to the in-app `<webview>` already present in `TvChart.jsx`. One Electron command-line switch (`--remote-debugging-port=9223`) exposes the webview's CDP target; the existing CLI tab-discovery filter (URL pattern `tradingview.com/chart`) picks it up automatically — no `packages/core` rewrite.
- Retires the `launch` helper in `packages/core/health.js` + the `tv launch` CLI command + the misleading `tv_launch` reference in `packages/core/tab.js`.
- New: `scripts/diff-bundle.js` structurally compares two analyze bundles with 0.25pt tolerance on numeric fields. Loss-free verification baselined against `tests/migration/desktop-baseline.json` → `tests/migration/webview-baseline.json` shows PASS.
- Spec: [docs/superpowers/specs/2026-05-27-webview-migration-design.md](docs/superpowers/specs/2026-05-27-webview-migration-design.md). Plan: [docs/superpowers/plans/2026-05-27-webview-migration.md](docs/superpowers/plans/2026-05-27-webview-migration.md). Unlocks the paused Backtest page brainstorm.

## Test plan

- [x] `node --test tests/diff-bundle.test.js` — 14/14 pass
- [x] `node scripts/diff-bundle.js tests/migration/desktop-baseline.json tests/migration/webview-baseline.json` — PASS (schema identical, all numbers within 0.25pt)
- [x] `npm run smoke:fixtures` — 16/16
- [x] `cd app && npm test` — clean (modulo pre-existing `tvAlertCreate` failure unchanged from `main`)
- [x] One full live NY session — completes through brief → open_reaction → entry_hunt → wrap with no thrown errors
- [x] Manual probes — alerts arm/fire, replay start/step/stop, drawings draw/list/clear, multi-tab list/switch — all pass on the webview backend
- [x] CLAUDE.md updated — hard constraint #1 reworded + architecture decision row added

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Open it in the browser to confirm the diff is what you expect (5 file edits + 4 new files + spec + plan + CLAUDE.md + 2 baseline JSONs).

- [ ] **Step 4: Return the PR URL**

Print the PR URL for the user.
