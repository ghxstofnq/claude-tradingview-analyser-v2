# Trading Workstation v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build v1 of the Trading Workstation Electron app — the vertical slice through trades. The trader can run PREP, LIVE (with auto bar-close reads), accept/reject setup cards, and see live trade outcomes — all in one window with the embedded TradingView.

**Architecture:** Electron with two processes. **Main** hosts the Claude Agent SDK, supervises the bar-close detector subprocess, runs the alert poller, and shells out to `./bin/tv` for one-shot tool calls. **Renderer** is React + Vite with the designer's prototype JSX directly ported; the chart on the left is an Electron `<webview>` pointing at `tradingview.com` (broker-connected). A separate TradingView Desktop on CDP 9223 remains as the headless analysis target — the existing CLI + analysis pipeline is reused untouched.

**Tech Stack:** Electron, Vite, React (JS/JSX), `@anthropic-ai/claude-agent-sdk`, Node `child_process`, `node --test`. Existing project: ESM, npm workspaces, `./bin/tv` CLI on CDP port 9223.

**Reference docs (read first):**
- [docs/superpowers/specs/2026-05-23-trading-workstation-implementation-design.md](../specs/2026-05-23-trading-workstation-implementation-design.md) — implementation spec (source of truth for this plan)
- [docs/superpowers/specs/2026-05-22-trading-workstation-design.md](../specs/2026-05-22-trading-workstation-design.md) — UI design spec
- [docs/superpowers/specs/2026-05-22-trading-workstation-usage-workflow.md](../specs/2026-05-22-trading-workstation-usage-workflow.md) — usage workflow
- [CLAUDE.md](../../../CLAUDE.md) — project rules: CDP port 9223 only, CLI-only (no MCP tools), prose-first reasoning, no LLM arithmetic, cite-or-reject, grade enum `A+ | B | no-trade`
- Designer's prototype: `~/Downloads/Claude trading agent (5)/` — source JSX/CSS for the direct port (do not copy `tweaks-panel.jsx` — prototyping scaffolding, dropped)

**Build branch:** all work goes on `feat/electron-app` (created in Task 1.1). Sub-branches per phase are optional; one branch is fine for v1.

---

## File map

### New top-level `app/` package

```
app/
  package.json                  Electron + Vite + React + Agent SDK deps
  .gitignore                    node_modules, dist
  vite.config.js                Vite + React plugin
  electron-main.js              Electron entry; creates BrowserWindow
  main/
    sdk.js                      Agent SDK init; the long-running session
    ipc.js                      ipcMain.handle wiring for renderer→main requests
    bar-close.js                spawns ./bin/tv stream bar-close; reads JSONL
    alerts.js                   polls tv alert list; diffs against snapshot
    health.js                   computes loop + alert health state
    sessions.js                 active session folder (ny-am / ny-pm / london)
    paths.js                    state path helpers
    prompts/
      analyze.md                copied from .claude/commands/analyze.md
    tools/
      tv-analyze.js             tv_analyze_full, tv_analyze_fast
      tv-alerts.js              tv_alert_create, tv_alert_list
      surface.js                surface_setup, surface_no_trade
  renderer/
    index.html
    src/
      main.jsx                  React entry; mounts <App/>
      api.js                    wraps preload's exposed IPC API
      App.jsx                   top bar + mode switch (ported from app.jsx)
      Prep.jsx                  ported from prep.jsx
      Live.jsx                  ported from live.jsx
      Review.jsx                ported from review.jsx
      Shared.jsx                Panel/Row/Grade/Btn/SectionHead (ported from shared.jsx)
      TvChart.jsx               embedded webview wrapper (ported from tv-chart.jsx)
      app.css                   ported from prototype
      hooks/
        useChat.js              streamed chat state
        useTrades.js            trades + outcome events
        useAlerts.js            armed + fired alerts
        useHealth.js            loop + alert health
        useMode.js              PREP/LIVE/REVIEW + suggested mode
  preload.js                    Electron preload — exposes safe API to renderer
  tests/
    ipc-tools.test.js           main-process tool wrappers (mocked)
```

### Additions to existing `cli/`

```
cli/
  commands/
    trades.js                   NEW. tv trades tick / list / show
  lib/
    trade-outcomes.js           NEW. core outcome inference module
    sizing.js                   NEW. grade + day-of-week → prescribed size
tests/                          existing dir — add unit tests here
  trade-outcomes.test.js
  sizing.test.js
```

---

## Phase 1 — Shell (≈2 days)

Goal: Electron window opens, designer's prototype renders end-to-end with mock data, mode switch flips PREP/LIVE/REVIEW.

### Task 1.1: Create build branch + scaffold app/ package

**Files:**
- Create: `app/package.json`
- Create: `app/.gitignore`

- [ ] **Step 1: Create the feature branch**

Run:
```bash
git checkout -b feat/electron-app main
```

- [ ] **Step 2: Create the directory structure**

Run:
```bash
mkdir -p app/main/tools app/main/prompts app/renderer/src/hooks app/tests
```

- [ ] **Step 3: Write app/package.json**

```json
{
  "name": "trading-workstation",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "electron-main.js",
  "scripts": {
    "dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
    "vite": "vite",
    "electron": "electron .",
    "test": "node --test tests/*.test.js"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "electron": "^32.0.0",
    "vite": "^5.4.0",
    "@vitejs/plugin-react": "^4.3.0",
    "concurrently": "^9.0.0",
    "wait-on": "^8.0.0"
  }
}
```

Note: `@anthropic-ai/claude-agent-sdk` version may differ — confirm against the Agent SDK docs and adjust.

- [ ] **Step 4: Write app/.gitignore**

```
node_modules/
dist/
out/
```

- [ ] **Step 5: Install deps**

Run:
```bash
cd app && npm install
```

Expected: dependencies installed; `node_modules/` populated.

- [ ] **Step 6: Commit**

```bash
git add app/package.json app/.gitignore
git commit -m "feat(app): bootstrap Electron + Vite + React package"
```

### Task 1.2: Vite config + renderer entry

**Files:**
- Create: `app/vite.config.js`
- Create: `app/renderer/index.html`
- Create: `app/renderer/src/main.jsx`

- [ ] **Step 1: Write vite.config.js**

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve("renderer"),
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: path.resolve("dist/renderer"),
    emptyOutDir: true,
  },
});
```

- [ ] **Step 2: Write renderer/index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Trading Workstation</title>
    <link rel="stylesheet" href="./src/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Write renderer/src/main.jsx (placeholder)**

```jsx
import React from "react";
import { createRoot } from "react-dom/client";

const root = createRoot(document.getElementById("root"));
root.render(<div style={{ padding: 24, color: "#e3b341", fontFamily: "monospace" }}>
  TRADING WORKSTATION · BOOT
</div>);
```

- [ ] **Step 4: Smoke-test the renderer alone**

Run:
```bash
cd app && npm run vite
```

Open `http://localhost:5173` in a browser. Expected: amber "TRADING WORKSTATION · BOOT" text on dark background. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add app/vite.config.js app/renderer/index.html app/renderer/src/main.jsx
git commit -m "feat(app): Vite + React renderer entry"
```

### Task 1.3: Electron main entry

**Files:**
- Create: `app/electron-main.js`
- Create: `app/preload.js`

- [ ] **Step 1: Write electron-main.js**

```js
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: "#0a0c10",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
    show: false,
  });
  win.once("ready-to-show", () => win.show());

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "dist/renderer/index.html"));
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

- [ ] **Step 2: Write preload.js (stub for now)**

```js
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // IPC methods fill in across later tasks.
});
```

- [ ] **Step 3: Smoke-test full dev mode**

Run:
```bash
cd app && npm run dev
```

Expected: Vite starts, then Electron window opens with the amber boot text. Close the window.

- [ ] **Step 4: Commit**

```bash
git add app/electron-main.js app/preload.js
git commit -m "feat(app): Electron main + preload bootstrap"
```

### Task 1.4: Port app.css

**Files:**
- Create: `app/renderer/src/app.css` (copy of prototype `app.css`)

- [ ] **Step 1: Copy the prototype's app.css verbatim**

```bash
cp "/Users/anasqatanani/Downloads/Claude trading agent (5)/app.css" app/renderer/src/app.css
```

- [ ] **Step 2: Smoke-test that styles load**

Run `npm run dev`. Reload. The boot text style should change (CSS now loaded). Stop.

- [ ] **Step 3: Commit**

```bash
git add app/renderer/src/app.css
git commit -m "feat(app): port prototype app.css"
```

### Task 1.5: Port Shared.jsx (Panel, Row, Grade, Btn, etc.)

**Files:**
- Create: `app/renderer/src/Shared.jsx`

The prototype's `shared.jsx` uses global React (`/* global React */`) and assigns components to `window`. The ported version uses ESM imports and named exports.

- [ ] **Step 1: Read the prototype source**

Source: `/Users/anasqatanani/Downloads/Claude trading agent (5)/shared.jsx`

- [ ] **Step 2: Write app/renderer/src/Shared.jsx**

Copy the prototype's `shared.jsx`, with these changes:
- Replace `/* global React */` and the destructuring `const { useState } = React` with `import React, { useState } from "react";` at top.
- Remove all `window.XYZ = XYZ` lines at bottom.
- Add named exports for every component the file defines (`Panel`, `Row`, `Grade`, `Btn`, `SectionHead`, `TradeCard`, `PillarsPanel` — confirm by reading the file).

Example pattern:
```jsx
import React, { useState } from "react";

export function Panel({ title, right, children }) { /* ...exact prototype body... */ }
export function Row({ k, v, tone }) { /* ... */ }
// ...
```

- [ ] **Step 3: Smoke-test by referencing one component**

Temporarily import `Panel` in `main.jsx` and render:
```jsx
import { Panel } from "./Shared.jsx";
// ... <Panel title="SMOKE">hello</Panel>
```

Run `npm run dev`. Expected: a panel-styled container with "SMOKE" header. Revert the smoke change to `main.jsx`.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/Shared.jsx
git commit -m "feat(app): port shared components (Panel, Row, Grade, ...)"
```

### Task 1.6: Port Prep.jsx (with mock data)

**Files:**
- Create: `app/renderer/src/Prep.jsx`

- [ ] **Step 1: Read the prototype source**

Source: `/Users/anasqatanani/Downloads/Claude trading agent (5)/prep.jsx`

- [ ] **Step 2: Write app/renderer/src/Prep.jsx**

Copy the prototype's `prep.jsx` with these changes:
- Add `import React from "react";` at top; remove `/* global */` comment and any destructuring of React.
- Replace global component references (e.g., `Panel`, `Row`, `Grade`) with named imports from `./Shared.jsx`.
- Remove the trailing `window.PrepWorkstation = PrepWorkstation;` line.
- Export the component: `export function PrepWorkstation() { ... }`.
- Leave the mock data hardcoded as in the prototype (HTF bias, key levels, Pillar 1+2 grade, Claude's plan). These get replaced with real data in later phases.

- [ ] **Step 3: Commit**

```bash
git add app/renderer/src/Prep.jsx
git commit -m "feat(app): port PrepWorkstation with mock data"
```

### Task 1.7: Port Live.jsx (with mock data)

**Files:**
- Create: `app/renderer/src/Live.jsx`

- [ ] **Step 1: Port from prototype `live.jsx`**

Same transformation as Task 1.6: ESM imports, named exports, drop window assignments, keep mock data.

Source: `/Users/anasqatanani/Downloads/Claude trading agent (5)/live.jsx`

Export: `export function LiveWorkstation()`.

- [ ] **Step 2: Commit**

```bash
git add app/renderer/src/Live.jsx
git commit -m "feat(app): port LiveWorkstation with mock data"
```

### Task 1.8: Port Review.jsx (with mock data)

**Files:**
- Create: `app/renderer/src/Review.jsx`

- [ ] **Step 1: Port from prototype `review.jsx`**

Same transformation. Keep all the mock data (trades, rejected setups, library entries, lessons).

Source: `/Users/anasqatanani/Downloads/Claude trading agent (5)/review.jsx`

Export: `export function ReviewWorkstation()`.

- [ ] **Step 2: Commit**

```bash
git add app/renderer/src/Review.jsx
git commit -m "feat(app): port ReviewWorkstation with mock data"
```

### Task 1.9: Port TvChart.jsx (chart embed)

**Files:**
- Create: `app/renderer/src/TvChart.jsx`

The prototype embeds tradingview.com via the `tv.js` widget. For Phase 1 we keep that pattern (no Electron `<webview>` yet — that's Phase 2). The widget loads from the public TradingView CDN inside a normal iframe.

- [ ] **Step 1: Port from prototype `tv-chart.jsx`**

Source: `/Users/anasqatanani/Downloads/Claude trading agent (5)/tv-chart.jsx`

Transformations: ESM imports, named exports `TradingViewChart` and `TvSignInBanner`.

- [ ] **Step 2: Commit**

```bash
git add app/renderer/src/TvChart.jsx
git commit -m "feat(app): port TradingView widget chart"
```

### Task 1.10: Port App.jsx (top bar + mode switch)

**Files:**
- Create: `app/renderer/src/App.jsx`
- Modify: `app/renderer/src/main.jsx`

- [ ] **Step 1: Read the prototype source**

Source: `/Users/anasqatanani/Downloads/Claude trading agent (5)/app.jsx`

The prototype's `app.jsx` contains the top bar, mode switch, chart frame, workstation panel, alerts state, toggleArm/armFromPrice logic, and the toast. All of it ports.

- [ ] **Step 2: Write App.jsx**

Copy the prototype's `app.jsx` with these changes:
- ESM imports replacing globals: `import React, { useState, useEffect, useRef } from "react";`
- Import workstations: `import { PrepWorkstation } from "./Prep.jsx";` etc.
- Import shared: `import { Panel, Row, Grade, Btn } from "./Shared.jsx";`
- Import chart: `import { TradingViewChart, TvSignInBanner } from "./TvChart.jsx";`
- **Do not port `tweaks-panel.jsx`** — it's prototyping scaffolding, not part of the app. Remove any references.
- Strip any `window.App = App` line.
- Export: `export function App() { ... }`.

- [ ] **Step 3: Wire App.jsx into main.jsx**

Replace `main.jsx`:
```jsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
```

- [ ] **Step 4: Smoke-test all three modes**

Run `npm run dev`. Expected: app boots into PREP. Click LIVE — workstation switches to Live's panels. Click REVIEW — switches to Review. Click PREP — returns. Chart placeholder visible on left.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/App.jsx app/renderer/src/main.jsx
git commit -m "feat(app): port App shell with mode switch (PREP/LIVE/REVIEW)"
```

### Task 1.11: Phase 1 smoke pass

- [ ] **Step 1: Manual smoke**

Run `npm run dev`. Confirm:
- Window opens at 1440×900.
- Top bar shows mode switch + status cluster.
- PREP mode renders the Morning Brief panels with mock data.
- LIVE mode renders the workstation rail with mock setups.
- REVIEW mode renders the session journal with mock trades.
- Switching modes works without errors.
- No tweaks-panel visible (scaffolding stripped).

- [ ] **Step 2: Tag the milestone**

```bash
git tag phase-1-shell
```

---

## Phase 2 — Chart (≈0.5 day)

Goal: Replace the in-iframe TradingView widget with a real Electron `<webview>` pointing at `tradingview.com`, broker-connected.

### Task 2.1: Swap TradingView widget for <webview>

**Files:**
- Modify: `app/renderer/src/TvChart.jsx`

- [ ] **Step 1: Replace the widget-based chart with a webview**

Rewrite `TvChart.jsx`:

```jsx
import React, { useEffect, useRef, useState } from "react";

export function TradingViewChart({ symbol = "MNQ1!" }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    const onReady = () => setReady(true);
    wv.addEventListener("dom-ready", onReady);
    return () => wv.removeEventListener("dom-ready", onReady);
  }, []);

  // The webview needs `webpreferences="contextIsolation=yes"` and a persistent
  // partition so the login session survives app restarts.
  return (
    <div style={{ position: "absolute", inset: 0, background: "#0b0e13" }}>
      <webview
        ref={ref}
        src={`https://www.tradingview.com/chart/?symbol=CME_MINI%3A${encodeURIComponent(symbol)}`}
        partition="persist:tradingview"
        allowpopups="true"
        style={{ width: "100%", height: "100%", display: "inline-flex" }}
      />
      {!ready && (
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
          color: "#5f6670", fontFamily: "monospace", fontSize: 11,
        }}>
          TRADINGVIEW · LOADING
        </div>
      )}
    </div>
  );
}

export function TvSignInBanner() {
  // Keep the prototype's sign-in banner component as a no-op placeholder
  // (the persistent webview handles login on first run; banner unused for now).
  return null;
}
```

- [ ] **Step 2: Smoke-test the webview**

Run `npm run dev`. Expected: the left half shows the TradingView chart loaded from tradingview.com. First run: not signed in.

- [ ] **Step 3: Commit**

```bash
git add app/renderer/src/TvChart.jsx
git commit -m "feat(app): embed real tradingview.com via persistent <webview>"
```

### Task 2.2: Sign-in flow

**Files:**
- (No code changes; documentation step.)

- [ ] **Step 1: First-run sign-in**

Inside the running app's webview, navigate to the sign-in link and log in to the trader's TradingView account (which has the broker connection). Because `partition="persist:tradingview"` is set, the session survives app restarts.

- [ ] **Step 2: Verify session persistence**

Quit the app (Cmd+Q). Run `npm run dev` again. The chart should load logged in (broker panel visible).

- [ ] **Step 3: Verify broker order panel**

In the embedded chart, open the broker's order panel (TradingView's right rail). Confirm it shows the trader's broker connection — this is the *execution surface* per the usage workflow.

### Task 2.3: Phase 2 smoke

- [ ] **Step 1: Manual smoke**

Run `npm run dev`. Confirm:
- Chart loads at tradingview.com.
- User is signed in (state persisted from Task 2.2).
- Broker order panel reachable inside the webview.

- [ ] **Step 2: Tag the milestone**

```bash
git tag phase-2-chart
```

---

## Phase 3 — Claude basic (≈2-3 days)

Goal: type a message in the chat panel, get a streamed reply from Claude. No tools yet.

### Task 3.1: Copy the analyze.md system prompt

**Files:**
- Create: `app/main/prompts/analyze.md`

- [ ] **Step 1: Copy the slash command body**

```bash
cp .claude/commands/analyze.md app/main/prompts/analyze.md
```

- [ ] **Step 2: Commit**

```bash
git add app/main/prompts/analyze.md
git commit -m "feat(app): copy analyze prompt into app's main process"
```

### Task 3.2: Agent SDK init module

**Files:**
- Create: `app/main/sdk.js`

The exact Agent SDK API may differ; verify against `code.claude.com/docs/en/agent-sdk/typescript` at implementation time. The shape below assumes the SDK exposes a `query()` (or equivalent) returning an async iterator of events, plus a `tools` registration mechanism.

- [ ] **Step 1: Write app/main/sdk.js**

```js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lazy-loaded once at app start.
let _systemPrompt = null;
let _tools = [];
let _onEvent = null;

export async function initSdk({ tools = [], onEvent }) {
  _systemPrompt = await fs.readFile(
    path.join(__dirname, "prompts", "analyze.md"),
    "utf8",
  );
  _tools = tools;
  _onEvent = onEvent;
  // The Agent SDK instance itself is created lazily per turn — most SDKs
  // expose a query/session API rather than a long-lived constructed object.
  // If the SDK requires explicit init/connect, do it here.
}

export async function userTurn({ text, sessionContext }) {
  // sessionContext: { phase, et_now, accepted_trades_summary, ... }
  // Composes: system prompt + brief context line + the user message.
  // Calls the SDK; pipes streaming chunks and tool calls to _onEvent.
  // PSEUDOCODE — fill in against the real SDK API at implementation time:
  //
  //   const sdk = require("@anthropic-ai/claude-agent-sdk");
  //   const session = sdk.createSession({ systemPrompt: _systemPrompt, tools: _tools });
  //   for await (const ev of session.send({ role: "user", content: text, context: sessionContext })) {
  //     _onEvent(ev);   // ev: { type: "chunk", text } | { type: "tool_call", name, args } | { type: "turn_complete" }
  //   }
}

export async function autoTurn({ phase, tf, ts }) {
  // Used by the bar-close loop. Same internals as userTurn, message phrased differently.
  const text = `A new ${tf} bar just closed at ${ts}. Phase: ${phase}. Take your read.`;
  return userTurn({ text, sessionContext: { phase, ts } });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/main/sdk.js
git commit -m "feat(app): Agent SDK init module (pseudocode for real API)"
```

### Task 3.3: IPC handler module

**Files:**
- Create: `app/main/ipc.js`
- Modify: `app/electron-main.js`
- Modify: `app/preload.js`

- [ ] **Step 1: Write app/main/ipc.js**

```js
import { ipcMain } from "electron";
import { userTurn } from "./sdk.js";

export function registerIpc(win) {
  const send = (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  ipcMain.handle("chat:send_message", async (_evt, { text, sessionContext }) => {
    // Fire the turn; events flow back via onEvent callback registered at SDK init.
    await userTurn({ text, sessionContext });
    return { ok: true };
  });

  return { send };
}
```

- [ ] **Step 2: Wire IPC + SDK in electron-main.js**

Modify `electron-main.js`. After `app.whenReady().then(createWindow)`, hook up:

```js
import { initSdk } from "./main/sdk.js";
import { registerIpc } from "./main/ipc.js";

app.whenReady().then(async () => {
  const win = createWindow();              // return the window from createWindow
  const ipc = registerIpc(win);
  await initSdk({
    tools: [],                              // populated in Phase 4
    onEvent: (ev) => {
      if (ev.type === "chunk") ipc.send("chat:chunk", ev);
      else if (ev.type === "tool_call") ipc.send("chat:tool_call", ev);
      else if (ev.type === "turn_complete") ipc.send("chat:turn_complete", ev);
    },
  });
});
```

Update `createWindow` to `return win` at the end.

- [ ] **Step 3: Expose the safe IPC API in preload.js**

```js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  chat: {
    send(text, sessionContext) {
      return ipcRenderer.invoke("chat:send_message", { text, sessionContext });
    },
    onChunk(cb) { ipcRenderer.on("chat:chunk", (_e, ev) => cb(ev)); },
    onToolCall(cb) { ipcRenderer.on("chat:tool_call", (_e, ev) => cb(ev)); },
    onTurnComplete(cb) { ipcRenderer.on("chat:turn_complete", (_e, ev) => cb(ev)); },
  },
});
```

- [ ] **Step 4: Commit**

```bash
git add app/main/ipc.js app/electron-main.js app/preload.js
git commit -m "feat(app): IPC bridge between renderer and main"
```

### Task 3.4: useChat hook (renderer)

**Files:**
- Create: `app/renderer/src/hooks/useChat.js`

- [ ] **Step 1: Write the hook**

```js
import { useEffect, useRef, useState } from "react";

export function useChat() {
  const [feed, setFeed] = useState([]);       // [{id, role, kind, text, time}]
  const [streamingId, setStreamingId] = useState(null);
  const counterRef = useRef(0);

  useEffect(() => {
    const onChunk = (ev) => {
      setFeed((prev) => {
        if (!streamingId) return prev;
        return prev.map((m) => m.id === streamingId
          ? { ...m, text: (m.text || "") + ev.text }
          : m);
      });
    };
    const onTurnComplete = () => setStreamingId(null);
    window.api.chat.onChunk(onChunk);
    window.api.chat.onTurnComplete(onTurnComplete);
  }, [streamingId]);

  async function send(text) {
    const userId = `m-${++counterRef.current}`;
    const replyId = `m-${++counterRef.current}`;
    setFeed((prev) => [
      ...prev,
      { id: userId, role: "trader", kind: "message", text, time: new Date() },
      { id: replyId, role: "claude", kind: "reply", text: "", time: new Date() },
    ]);
    setStreamingId(replyId);
    await window.api.chat.send(text, {});
  }

  return { feed, send };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/renderer/src/hooks/useChat.js
git commit -m "feat(app): useChat hook for streamed chat state"
```

### Task 3.5: Wire chat panel in Live.jsx

**Files:**
- Modify: `app/renderer/src/Live.jsx`

- [ ] **Step 1: Replace the mock conversation feed with real chat state**

Identify the conversation panel inside `Live.jsx` (was using hardcoded mock messages in the prototype). Replace its `messages` mock with the `useChat` hook:

```jsx
import { useChat } from "./hooks/useChat.js";
// inside LiveWorkstation:
const { feed, send } = useChat();
// render feed instead of mock messages
// add a small input box at the bottom of the chat panel with onSubmit calling send()
```

(The exact JSX changes depend on the prototype's structure — the chat panel is the upper ~60% of the LIVE workstation rail per design spec §6.2.)

- [ ] **Step 2: Manual smoke**

Run `npm run dev`. Switch to LIVE. Type "hello" in the chat input. Expected: your message appears immediately; Claude's reply streams in chunk by chunk.

- [ ] **Step 3: Commit**

```bash
git add app/renderer/src/Live.jsx
git commit -m "feat(app): wire chat panel to live Claude conversation"
```

### Task 3.6: Phase 3 smoke

- [ ] **Step 1: Type-and-reply round trip**

Confirm:
- Renderer can send via IPC.
- Main forwards to SDK.
- SDK streams chunks back through onEvent.
- Renderer accumulates chunks into the chat feed.
- "Turn complete" event finalizes the message.

- [ ] **Step 2: Tag the milestone**

```bash
git tag phase-3-claude-basic
```

---

## Phase 4 — Claude tools + surfacing (≈2 days)

Goal: Claude can call `tv_analyze_full`, `tv_analyze_fast`, `tv_alert_create`, `tv_alert_list`, `surface_setup`, `surface_no_trade`. Setup cards render in the workstation rail.

### Task 4.1: Tool wrapper for tv_analyze_full / fast

**Files:**
- Create: `app/main/tools/tv-analyze.js`
- Create: `app/tests/ipc-tools.test.js`

- [ ] **Step 1: Write the failing test**

```js
// app/tests/ipc-tools.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { tvAnalyzeFull, tvAnalyzeFast } from "../main/tools/tv-analyze.js";

test("tvAnalyzeFull invokes ./bin/tv analyze --out and resolves with path", async (t) => {
  // Use a stub via dependency injection (see Step 3 — implementation accepts a `spawn` injection).
  const calls = [];
  const fakeSpawn = (cmd, args) => {
    calls.push({ cmd, args });
    return { on: (event, cb) => event === "close" && setImmediate(() => cb(0)) };
  };
  const res = await tvAnalyzeFull({}, { spawn: fakeSpawn, outPath: "/tmp/x.json" });
  assert.equal(res.path, "/tmp/x.json");
  assert.ok(calls[0].args.includes("--out"));
  assert.ok(calls[0].args.includes("/tmp/x.json"));
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
cd app && npm test
```

Expected: failure (module doesn't exist yet).

- [ ] **Step 3: Implement tvAnalyzeFull and tvAnalyzeFast**

```js
// app/main/tools/tv-analyze.js
import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const TV_BIN = path.join(REPO_ROOT, "bin", "tv");

function runTv(args, { spawn = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(TV_BIN, args, { cwd: REPO_ROOT });
    proc.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`tv ${args.join(" ")} exited ${code}`)));
  });
}

export async function tvAnalyzeFull(_input, opts = {}) {
  const outPath = opts.outPath || path.join(REPO_ROOT, "state", "last-analyze.json");
  await runTv(["analyze", "--out", outPath], opts);
  return { path: outPath };
}

export async function tvAnalyzeFast({ baseline } = {}, opts = {}) {
  const outPath = opts.outPath || path.join(REPO_ROOT, "state", "last-scan.json");
  const args = ["analyze", "--pillar3-only", "--out", outPath];
  if (baseline) args.push("--baseline", baseline);
  await runTv(args, opts);
  return { path: outPath };
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
cd app && npm test
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/main/tools/tv-analyze.js app/tests/ipc-tools.test.js
git commit -m "feat(app): tv_analyze_full and tv_analyze_fast tool wrappers"
```

### Task 4.2: Tool wrappers for tv_alert_create / list

**Files:**
- Create: `app/main/tools/tv-alerts.js`
- Modify: `app/tests/ipc-tools.test.js`

- [ ] **Step 1: Write failing tests**

Add to `ipc-tools.test.js`:

```js
import { tvAlertCreate, tvAlertList } from "../main/tools/tv-alerts.js";

test("tvAlertCreate passes price and label to ./bin/tv alert create", async () => {
  const calls = [];
  const fakeSpawn = (cmd, args) => {
    calls.push(args);
    return { on: (e, cb) => e === "close" && setImmediate(() => cb(0)) };
  };
  await tvAlertCreate({ price: 21540.25, label: "PDH" }, { spawn: fakeSpawn });
  const a = calls[0];
  assert.ok(a.includes("alert"));
  assert.ok(a.includes("create"));
  assert.ok(a.includes("21540.25"));
  assert.ok(a.includes("PDH"));
});

test("tvAlertList captures stdout JSON", async () => {
  const fakeSpawn = () => ({
    stdout: { on: (e, cb) => e === "data" && setImmediate(() => cb(Buffer.from('[{"id":"1"}]'))) },
    on: (e, cb) => e === "close" && setImmediate(() => cb(0)),
  });
  const res = await tvAlertList({}, { spawn: fakeSpawn });
  assert.deepEqual(res, [{ id: "1" }]);
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement tvAlertCreate, tvAlertList**

```js
// app/main/tools/tv-alerts.js
import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const TV_BIN = path.join(REPO_ROOT, "bin", "tv");

function runTvCapture(args, { spawn = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(TV_BIN, args, { cwd: REPO_ROOT });
    let buf = "";
    proc.stdout?.on("data", (chunk) => { buf += chunk.toString(); });
    proc.on("close", (code) => code === 0 ? resolve(buf) : reject(new Error(`tv ${args.join(" ")} exited ${code}`)));
  });
}

export async function tvAlertCreate({ price, label }, opts = {}) {
  await runTvCapture(["alert", "create", String(price), label], opts);
  return { ok: true };
}

export async function tvAlertList(_input, opts = {}) {
  const out = await runTvCapture(["alert", "list", "--json"], opts);
  return JSON.parse(out);
}
```

(Verify the actual `tv alert list` output format and adjust the flag.)

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add app/main/tools/tv-alerts.js app/tests/ipc-tools.test.js
git commit -m "feat(app): tv_alert_create and tv_alert_list tool wrappers"
```

### Task 4.3: Surface tools (surface_setup, surface_no_trade)

**Files:**
- Create: `app/main/tools/surface.js`

These don't shell out — they're renderer-pushing tools. When Claude calls them, main captures the payload and pushes it to the renderer as a `chat:tool_call` IPC event, AND persists the setup to `setups.jsonl`.

- [ ] **Step 1: Write app/main/tools/surface.js**

```js
import fs from "node:fs/promises";
import path from "node:path";
import { activeSessionDir } from "../sessions.js";   // implemented in Task 5.3

let _send = null;
export function setSurfaceSink(sendFn) { _send = sendFn; }

export async function surfaceSetup(payload) {
  const dir = await activeSessionDir();
  const file = path.join(dir, "setups.jsonl");
  const line = JSON.stringify({ ...payload, ts: new Date().toISOString() });
  await fs.appendFile(file, line + "\n", "utf8");
  if (_send) _send("chat:tool_call", { name: "surface_setup", payload });
  return { ok: true, id: payload.id || null };
}

export async function surfaceNoTrade({ reason }) {
  if (_send) _send("chat:tool_call", { name: "surface_no_trade", payload: { reason } });
  return { ok: true };
}
```

- [ ] **Step 2: Add a stub for activeSessionDir for Phase 4 use**

Until Task 5.3 lands, create a minimal version of `sessions.js`:

```js
// app/main/sessions.js
import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export async function activeSessionDir() {
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getHours();
  // Crude session label by ET hour — refined in Task 5.3.
  const session = hour < 12 ? "ny-am" : hour < 16 ? "ny-pm" : "london";
  const dir = path.join(REPO_ROOT, "state", "session", today, session);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/main/tools/surface.js app/main/sessions.js
git commit -m "feat(app): surface_setup and surface_no_trade tools"
```

### Task 4.4: Register tools with the SDK

**Files:**
- Modify: `app/main/sdk.js`
- Modify: `app/electron-main.js`

- [ ] **Step 1: Wire tools into SDK init**

In `electron-main.js`, build the tool list and pass it to `initSdk`:

```js
import { tvAnalyzeFull, tvAnalyzeFast } from "./main/tools/tv-analyze.js";
import { tvAlertCreate, tvAlertList } from "./main/tools/tv-alerts.js";
import { surfaceSetup, surfaceNoTrade, setSurfaceSink } from "./main/tools/surface.js";

// inside app.whenReady().then(async () => { ... }):
const tools = [
  { name: "tv_analyze_full", description: "Run the full multi-TF analysis sweep. Returns {path}.", input_schema: { type: "object", properties: {} }, handler: tvAnalyzeFull },
  { name: "tv_analyze_fast", description: "Fast 1-bar poll, reusing the baseline. Returns {path}.", input_schema: { type: "object", properties: { baseline: { type: "string" } } }, handler: tvAnalyzeFast },
  { name: "tv_alert_create", description: "Create a TradingView price alert.", input_schema: { type: "object", properties: { price: { type: "number" }, label: { type: "string" } }, required: ["price", "label"] }, handler: tvAlertCreate },
  { name: "tv_alert_list", description: "List TradingView alerts.", input_schema: { type: "object", properties: {} }, handler: tvAlertList },
  { name: "surface_setup", description: "Surface a graded setup to the UI as a card.", input_schema: { /* full setup schema */ }, handler: surfaceSetup },
  { name: "surface_no_trade", description: "Mark the current period as no-trade.", input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] }, handler: surfaceNoTrade },
];

setSurfaceSink((channel, payload) => ipc.send(channel, payload));
await initSdk({ tools, onEvent: /* same as before */ });
```

The exact tool registration format depends on the Agent SDK API — adjust at implementation time.

- [ ] **Step 2: Commit**

```bash
git add app/electron-main.js app/main/sdk.js
git commit -m "feat(app): register tv_* and surface_* tools with the Agent SDK"
```

### Task 4.5: Render setup cards from chat:tool_call

**Files:**
- Modify: `app/renderer/src/hooks/useChat.js`
- Modify: `app/renderer/src/Live.jsx`

- [ ] **Step 1: Capture tool calls in useChat**

Extend `useChat.js` to listen for `chat:tool_call` and add card items to the feed:

```js
// inside the existing useEffect:
window.api.chat.onToolCall((ev) => {
  setFeed((prev) => [
    ...prev,
    { id: `tc-${++counterRef.current}`, role: "claude", kind: ev.name, payload: ev.payload, time: new Date() },
  ]);
});
```

- [ ] **Step 2: Render setup cards in the workstation rail**

In `Live.jsx`, find the workstation rail / setups area. When a feed item's `kind === "surface_setup"`, render a setup card (use the existing `TradeCard` or a new `SetupCard` from `Shared.jsx`) populated from `payload`. Items with `kind === "surface_no_trade"` render as a no-trade marker.

- [ ] **Step 3: Manual smoke**

Run the app. In the chat, ask Claude: "Run a fresh analysis and surface any setup you see." Claude should call `tv_analyze_full`, then (if a setup applies) call `surface_setup`. Card appears.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/hooks/useChat.js app/renderer/src/Live.jsx
git commit -m "feat(app): render setup cards from surface_setup tool calls"
```

### Task 4.6: Phase 4 smoke + milestone

- [ ] **Step 1: End-to-end manual smoke**

Confirm:
- Claude can be asked to read the chart; tool call to `tv_analyze_full` succeeds; bundle written to disk.
- Claude reads the bundle, reasons in prose (streamed), and either calls `surface_setup` or `surface_no_trade`.
- Setup card appears in the workstation rail.
- No-trade marker appears when appropriate.

**This is the "Workbench day-one" milestone.** The trader can already use the app for PREP + manual LIVE.

- [ ] **Step 2: Tag the milestone**

```bash
git tag phase-4-tools
```

---

## Phase 5 — Live loop (≈1-2 days)

Goal: in LIVE mode, the bar-close detector subprocess streams events into Claude as automatic turns. Health pill in the topbar reflects the loop's state.

### Task 5.1: Active-session resolver

**Files:**
- Modify: `app/main/sessions.js`

Replace the crude hour-based session label with the project's existing session-phase logic.

- [ ] **Step 1: Rewrite app/main/sessions.js**

```js
import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

// ET clock helper — uses Intl.DateTimeFormat for the New York zone.
function nyParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(date);
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

export function currentSession() {
  const { date, hour, minute, weekday } = nyParts();
  let session = "idle";
  if (weekday !== "Sat" && weekday !== "Sun") {
    const m = hour * 60 + minute;
    if (m >= 9 * 60 + 30 && m < 12 * 60) session = "ny-am";
    else if (m >= 13 * 60 && m < 16 * 60) session = "ny-pm";
    else if (m >= 3 * 60 && m < 6 * 60) session = "london";
  }
  return { date, session, et_hour: hour, et_minute: minute, weekday };
}

export async function activeSessionDir() {
  const { date, session } = currentSession();
  const dir = path.join(REPO_ROOT, "state", "session", date, session === "idle" ? "ny-am" : session);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/main/sessions.js
git commit -m "feat(app): ET-clock-based session resolver"
```

### Task 5.2: Bar-close detector bridge

**Files:**
- Create: `app/main/bar-close.js`

- [ ] **Step 1: Write the bridge**

```js
import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { autoTurn } from "./sdk.js";
import { currentSession } from "./sessions.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const TV_BIN = path.join(REPO_ROOT, "bin", "tv");

let _proc = null;
let _send = null;
let _onBar = null;
let _restartTimer = null;
let _backoffMs = 1000;

export function startDetector({ send, onBar }) {
  _send = send;
  _onBar = onBar;
  spawnOnce();
}

export function stopDetector() {
  clearTimeout(_restartTimer);
  _restartTimer = null;
  if (_proc) {
    _proc.kill("SIGTERM");
    _proc = null;
  }
}

function spawnOnce() {
  _proc = spawn(TV_BIN, ["stream", "bar-close"], { cwd: REPO_ROOT });
  const rl = readline.createInterface({ input: _proc.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    handleBar(ev);
  });
  _proc.on("exit", (code) => {
    _send?.("health:update", { detector: code === 0 ? "stopped" : "down" });
    // backoff restart up to 30s — supervisor pattern
    if (_restartTimer === null) {
      _restartTimer = setTimeout(() => {
        _backoffMs = Math.min(_backoffMs * 2, 30_000);
        _restartTimer = null;
        spawnOnce();
      }, _backoffMs);
    }
  });
  _send?.("health:update", { detector: "running" });
}

async function handleBar(ev) {
  _onBar?.(ev);                          // for outcome tick + UI feed
  const { session } = currentSession();
  const phase = phaseFor(session, ev);
  if (phase === "off") return;
  await autoTurn({ phase, tf: ev.tf, ts: ev.ts });
}

function phaseFor(session, ev) {
  if (session === "idle") return "off";
  // 09:30-09:45 ET = open_reaction; thereafter = entry_hunt.
  const t = new Date(ev.ts);
  const ny = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(t);
  const hh = Number(ny.find((p) => p.type === "hour").value);
  const mm = Number(ny.find((p) => p.type === "minute").value);
  const mins = hh * 60 + mm;
  if (session === "ny-am") return mins < 9*60+45 ? "open_reaction" : "entry_hunt";
  if (session === "ny-pm") return mins < 13*60+15 ? "open_reaction" : "entry_hunt";
  if (session === "london") return mins < 3*60+15 ? "open_reaction" : "entry_hunt";
  return "off";
}
```

- [ ] **Step 2: Commit**

```bash
git add app/main/bar-close.js
git commit -m "feat(app): bar-close detector subprocess bridge with auto-restart"
```

### Task 5.3: Wire start/stop on mode switch

**Files:**
- Modify: `app/main/ipc.js`
- Modify: `app/preload.js`
- Modify: `app/renderer/src/App.jsx`
- Modify: `app/electron-main.js`

- [ ] **Step 1: Add mode:switch IPC**

In `app/main/ipc.js` add:

```js
import { startDetector, stopDetector } from "./bar-close.js";

ipcMain.handle("mode:switch", async (_evt, { mode }) => {
  if (mode === "LIVE") startDetector({ send, onBar: (ev) => send("bar:close", ev) });
  else stopDetector();
  return { ok: true };
});
```

- [ ] **Step 2: Expose in preload**

```js
mode: {
  switch(mode) { return ipcRenderer.invoke("mode:switch", { mode }); },
  onBarClose(cb) { ipcRenderer.on("bar:close", (_e, ev) => cb(ev)); },
},
```

- [ ] **Step 3: Call mode:switch from App.jsx**

Find the mode switch handler in `App.jsx`. After updating the local mode state, call `window.api.mode.switch(newMode)`.

- [ ] **Step 4: Manual smoke**

Switch to LIVE during market hours (or stub the session resolver locally to fake it). Detector should start, and bar-close events (one per minute) should print to the dev console and trigger Claude turns.

- [ ] **Step 5: Commit**

```bash
git add app/main/ipc.js app/preload.js app/renderer/src/App.jsx app/electron-main.js
git commit -m "feat(app): start/stop bar-close detector on mode switch"
```

### Task 5.4: Baseline freshness refresh

**Files:**
- Modify: `app/main/bar-close.js`

- [ ] **Step 1: Add baseline-staleness check before each turn**

```js
import fs from "node:fs/promises";
import { tvAnalyzeFull } from "./tools/tv-analyze.js";

const BASELINE = path.join(REPO_ROOT, "state", "baseline.json");
let _refreshing = false;

async function maybeRefreshBaseline() {
  if (_refreshing) return;
  try {
    const stat = await fs.stat(BASELINE);
    const ageSec = (Date.now() - stat.mtimeMs) / 1000;
    if (ageSec < 900) return;
  } catch { /* missing file → refresh */ }
  _refreshing = true;
  try { await tvAnalyzeFull({}, { outPath: BASELINE }); }
  finally { _refreshing = false; }
}

// In handleBar(ev), call maybeRefreshBaseline() before autoTurn().
```

- [ ] **Step 2: Commit**

```bash
git add app/main/bar-close.js
git commit -m "feat(app): refresh baseline.json when older than 15 minutes"
```

### Task 5.5: Health module + topbar pill

**Files:**
- Create: `app/main/health.js`
- Create: `app/renderer/src/hooks/useHealth.js`
- Modify: `app/renderer/src/App.jsx`

- [ ] **Step 1: Write app/main/health.js**

```js
import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const HEARTBEAT = path.join(REPO_ROOT, "state", "session", "detector-heartbeat.json");

let _lastTurnAt = 0;
let _send = null;

export function startHealthMonitor(send) {
  _send = send;
  setInterval(tick, 2000);
}

export function markTurnCompleted() {
  _lastTurnAt = Date.now();
}

async function tick() {
  let hbAge = Infinity;
  try {
    const stat = await fs.stat(HEARTBEAT);
    hbAge = (Date.now() - stat.mtimeMs) / 1000;
  } catch {}
  const turnLag = (Date.now() - _lastTurnAt) / 1000;
  let state = "healthy";
  if (hbAge > 90) state = "down";
  else if (hbAge > 30 || turnLag > 90) state = "stale";
  _send?.("health:update", { loop: state, heartbeat_age_s: hbAge });
}
```

- [ ] **Step 2: Wire startHealthMonitor in electron-main.js**

```js
import { startHealthMonitor, markTurnCompleted } from "./main/health.js";
// inside whenReady block:
startHealthMonitor(ipc.send);
// in the onEvent callback, when ev.type === "turn_complete": markTurnCompleted();
```

- [ ] **Step 3: useHealth hook**

```js
// app/renderer/src/hooks/useHealth.js
import { useEffect, useState } from "react";

export function useHealth() {
  const [health, setHealth] = useState({ loop: "off" });
  useEffect(() => {
    window.api.health?.onUpdate?.((ev) => setHealth((h) => ({ ...h, ...ev })));
  }, []);
  return health;
}
```

(Also add `health: { onUpdate(cb) { ipcRenderer.on("health:update", (_e, ev) => cb(ev)); } }` to preload.)

- [ ] **Step 4: Render the pill in App.jsx topbar**

In the topbar status cluster, add a pill that colours green/yellow/red based on `useHealth().loop`.

- [ ] **Step 5: Commit**

```bash
git add app/main/health.js app/renderer/src/hooks/useHealth.js app/preload.js app/renderer/src/App.jsx app/electron-main.js
git commit -m "feat(app): loop-health monitor + topbar pill"
```

### Task 5.6: Phase 5 smoke + milestone

- [ ] **Step 1: Live-session manual smoke**

Switch to LIVE during market hours (or simulate via local detector with fake JSONL). Confirm:
- Detector starts; bar-close lines flow into main.
- Each bar triggers a Claude turn.
- Per-bar reads stream into the chat panel.
- Baseline refreshes every ~15 min.
- Health pill is green; goes yellow if detector pauses, red if it crashes.

- [ ] **Step 2: Tag the milestone**

```bash
git tag phase-5-live-loop
```

---

## Phase 6 — Trade tracking (≈2-3 days)

Goal: Accept/Reject controls work, `trades.jsonl` writes, outcome inference runs on every bar close, taken-trade cards update live.

### Task 6.1: Sizing module + tests

**Files:**
- Create: `cli/lib/sizing.js`
- Create: `tests/sizing.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/sizing.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeFor } from "../cli/lib/sizing.js";

test("A+ Tue returns full size", () => {
  assert.equal(sizeFor({ grade: "A+", dow: "Tue" }).contracts, 2);
});

test("A+ Fri reduced", () => {
  assert.equal(sizeFor({ grade: "A+", dow: "Fri" }).contracts, 1);
});

test("B Wed at half of A+", () => {
  assert.equal(sizeFor({ grade: "B", dow: "Wed" }).contracts, 1);
});

test("no-trade returns zero contracts", () => {
  assert.equal(sizeFor({ grade: "no-trade", dow: "Tue" }).contracts, 0);
});
```

(Numbers above are placeholders — replace with the actual strategy rules from `docs/strategy/trading-strategy-2026.md` Step 7 when reading at implementation time.)

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test:unit
```

- [ ] **Step 3: Implement sizing.js**

```js
// cli/lib/sizing.js
// Per docs/strategy/trading-strategy-2026.md §7 step 7.
// Mon/Fri reduced. A+ full size; B half size; no-trade zero.

const TABLE = {
  "A+": { Mon: 1, Tue: 2, Wed: 2, Thu: 2, Fri: 1 },
  "B":  { Mon: 0, Tue: 1, Wed: 1, Thu: 1, Fri: 0 },
};

export function sizeFor({ grade, dow }) {
  if (grade === "no-trade") return { contracts: 0, dollar_risk: 0, label: "no-trade" };
  const row = TABLE[grade];
  if (!row) throw new Error(`unknown grade ${grade}`);
  const contracts = row[dow] ?? 0;
  return {
    contracts,
    // dollar_risk estimate left as a placeholder — needs symbol-specific tick value
    // (e.g. MNQ = $2/tick) and the stop-distance from the setup. Computed at accept-time
    // in trades subsystem, not here.
    dollar_risk: null,
    label: contracts === 0 ? "no-trade" : `${contracts}c`,
  };
}
```

(Confirm and refine the table against the strategy doc at implementation time.)

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add cli/lib/sizing.js tests/sizing.test.js
git commit -m "feat(cli): sizing module — grade + DOW → contracts"
```

### Task 6.2: trade-outcomes module + tests

**Files:**
- Create: `cli/lib/trade-outcomes.js`
- Create: `tests/trade-outcomes.test.js`

- [ ] **Step 1: Write failing tests covering each transition**

```js
// tests/trade-outcomes.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { tickTrades } from "../cli/lib/trade-outcomes.js";

const baseLong = {
  id: "T-1", side: "long", state: "pending_entry",
  entry: 100, stop: 95, tp1: 110, tp2: 120, invalidation: 90,
};

test("pending → FILLED when bar crosses entry", () => {
  const out = tickTrades([baseLong], { high: 101, low: 99, ts: "T" });
  assert.equal(out.transitions[0].status, "FILLED");
});

test("pending → INVALIDATED when bar crosses invalidation", () => {
  const out = tickTrades([baseLong], { high: 92, low: 89, ts: "T" });
  assert.equal(out.transitions[0].status, "INVALIDATED");
});

test("filled long → TP1_HIT pulls stop to BE", () => {
  const trade = { ...baseLong, state: "filled" };
  const out = tickTrades([trade], { high: 111, low: 105, ts: "T" });
  assert.equal(out.transitions[0].status, "TP1_HIT");
  // Updated trade state shows stop pulled to entry
  assert.equal(out.updated[0].stop, 100);
});

test("filled long → STOPPED when bar.low ≤ stop", () => {
  const trade = { ...baseLong, state: "filled" };
  const out = tickTrades([trade], { high: 101, low: 94, ts: "T" });
  assert.equal(out.transitions[0].status, "STOPPED");
});

test("same-bar entry-and-stop → FILLED then STOPPED (conservative)", () => {
  const out = tickTrades([baseLong], { high: 102, low: 94, ts: "T" });
  assert.equal(out.transitions[0].status, "FILLED");
  assert.equal(out.transitions[1].status, "STOPPED");
});

test("short symmetric — pending → FILLED when bar.low ≤ entry", () => {
  const short = { ...baseLong, side: "short", entry: 100, stop: 105, tp1: 90, tp2: 80, invalidation: 110 };
  const out = tickTrades([short], { high: 101, low: 99, ts: "T" });
  assert.equal(out.transitions[0].status, "FILLED");
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test:unit
```

- [ ] **Step 3: Implement tickTrades**

```js
// cli/lib/trade-outcomes.js
//
// Pure logic, no I/O. Given a list of open trades and the latest bar's OHLC,
// returns { transitions, updated } describing what changed.
// Transitions: array of {id, ts, status, ...details}.
// Updated: array of mutated trade objects (state, stop after BE move, etc.).

export function tickTrades(trades, bar) {
  const transitions = [];
  const updated = [];

  for (const t of trades) {
    if (t.state === "pending_entry") {
      const crossedEntry = crosses(bar, t.entry);
      const crossedInval = t.side === "long"
        ? bar.low <= t.invalidation
        : bar.high >= t.invalidation;

      // Same-bar tie-break: prefer entry FIRST, then check stop/inval against
      // the filled state. Strategy is conservative — entry assumed at planned price.
      if (crossedEntry) {
        transitions.push({ id: t.id, ts: bar.ts, status: "FILLED", fill_price: t.entry });
        const filled = { ...t, state: "filled" };
        // Now check if the SAME bar also took out the stop:
        if (t.side === "long" && bar.low <= t.stop) {
          transitions.push({ id: t.id, ts: bar.ts, status: "STOPPED", r_realized: -1 });
          updated.push({ ...filled, state: "closed", outcome: "STOPPED" });
        } else if (t.side === "short" && bar.high >= t.stop) {
          transitions.push({ id: t.id, ts: bar.ts, status: "STOPPED", r_realized: -1 });
          updated.push({ ...filled, state: "closed", outcome: "STOPPED" });
        } else {
          updated.push(filled);
        }
        continue;
      }
      if (crossedInval) {
        transitions.push({ id: t.id, ts: bar.ts, status: "INVALIDATED" });
        updated.push({ ...t, state: "closed", outcome: "INVALIDATED" });
        continue;
      }
      updated.push(t);
      continue;
    }

    if (t.state === "filled") {
      if (t.side === "long") {
        if (bar.high >= t.tp1 && !t.tp1_hit) {
          transitions.push({ id: t.id, ts: bar.ts, status: "TP1_HIT", r_realized: rMultiple(t, t.tp1) });
          // pull stop to BE for the runner
          const next = { ...t, tp1_hit: true, stop: t.entry };
          if (bar.high >= t.tp2) {
            transitions.push({ id: t.id, ts: bar.ts, status: "TP2_HIT", r_realized: rMultiple(t, t.tp2) });
            updated.push({ ...next, state: "closed", outcome: "TP2_HIT" });
          } else {
            updated.push(next);
          }
          continue;
        }
        if (bar.low <= t.stop) {
          transitions.push({ id: t.id, ts: bar.ts, status: "STOPPED", r_realized: rMultiple(t, t.stop) });
          updated.push({ ...t, state: "closed", outcome: "STOPPED" });
          continue;
        }
      } else {
        // short symmetric
        if (bar.low <= t.tp1 && !t.tp1_hit) {
          transitions.push({ id: t.id, ts: bar.ts, status: "TP1_HIT", r_realized: rMultiple(t, t.tp1) });
          const next = { ...t, tp1_hit: true, stop: t.entry };
          if (bar.low <= t.tp2) {
            transitions.push({ id: t.id, ts: bar.ts, status: "TP2_HIT", r_realized: rMultiple(t, t.tp2) });
            updated.push({ ...next, state: "closed", outcome: "TP2_HIT" });
          } else {
            updated.push(next);
          }
          continue;
        }
        if (bar.high >= t.stop) {
          transitions.push({ id: t.id, ts: bar.ts, status: "STOPPED", r_realized: rMultiple(t, t.stop) });
          updated.push({ ...t, state: "closed", outcome: "STOPPED" });
          continue;
        }
      }
      updated.push(t);
      continue;
    }

    updated.push(t);
  }
  return { transitions, updated };
}

function crosses(bar, price) {
  return bar.high >= price && bar.low <= price;
}

function rMultiple(t, exitPrice) {
  const risk = Math.abs(t.entry - t.stop);
  if (risk === 0) return 0;
  const move = t.side === "long" ? (exitPrice - t.entry) : (t.entry - exitPrice);
  return Number((move / risk).toFixed(2));
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test:unit
```

- [ ] **Step 5: Commit**

```bash
git add cli/lib/trade-outcomes.js tests/trade-outcomes.test.js
git commit -m "feat(cli): trade-outcomes module — deterministic outcome inference"
```

### Task 6.3: tv trades command

**Files:**
- Create: `cli/commands/trades.js`
- Modify: `cli/router.js` (or wherever commands are registered)

- [ ] **Step 1: Write the command**

```js
// cli/commands/trades.js
import fs from "node:fs/promises";
import path from "node:path";
import { tickTrades } from "../lib/trade-outcomes.js";

export async function trades({ args }) {
  const sub = args._[0];
  if (sub === "tick") return tickCmd(args);
  if (sub === "list") return listCmd(args);
  if (sub === "show") return showCmd(args);
  console.error("usage: tv trades <tick|list|show> [--session <dir>]");
  process.exit(2);
}

async function readTradesFile(sessionDir) {
  const file = path.join(sessionDir, "trades.jsonl");
  try {
    const txt = await fs.readFile(file, "utf8");
    return txt.trim().split("\n").map((l) => JSON.parse(l));
  } catch { return []; }
}

function foldOpenTrades(events) {
  const byId = new Map();
  for (const ev of events) {
    if (ev.type === "accept") byId.set(ev.id, { ...ev, state: "pending_entry" });
    else if (ev.type === "outcome") {
      const t = byId.get(ev.id);
      if (!t) continue;
      if (ev.status === "FILLED") t.state = "filled";
      else if (["STOPPED", "TP1_HIT", "TP2_HIT", "INVALIDATED"].includes(ev.status) && t.state !== "closed") {
        // only close on terminal outcomes (TP1_HIT alone doesn't close — runner continues)
        if (ev.status !== "TP1_HIT") { t.state = "closed"; t.outcome = ev.status; }
        else { t.tp1_hit = true; t.stop = t.entry; }
      }
    }
  }
  return [...byId.values()].filter((t) => t.state !== "closed");
}

async function tickCmd(args) {
  const sessionDir = args.session || process.env.SESSION_DIR;
  if (!sessionDir) { console.error("--session <dir> required"); process.exit(2); }
  const barJson = JSON.parse(args.bar || process.env.BAR || "{}");
  const events = await readTradesFile(sessionDir);
  const openTrades = foldOpenTrades(events);
  const { transitions, updated } = tickTrades(openTrades, barJson);
  const file = path.join(sessionDir, "trades.jsonl");
  for (const t of transitions) {
    const line = JSON.stringify({ type: "outcome", ...t });
    await fs.appendFile(file, line + "\n", "utf8");
  }
  console.log(JSON.stringify({ transitions, updated }, null, 2));
}

async function listCmd(args) {
  const sessionDir = args.session || process.env.SESSION_DIR;
  const events = await readTradesFile(sessionDir);
  console.log(JSON.stringify(foldOpenTrades(events), null, 2));
}

async function showCmd(args) {
  const sessionDir = args.session || process.env.SESSION_DIR;
  const id = args._[1];
  const events = await readTradesFile(sessionDir);
  console.log(JSON.stringify(events.filter((e) => e.id === id), null, 2));
}
```

- [ ] **Step 2: Register in cli/router.js**

Locate the command registration pattern in `cli/router.js` and add:
```js
import { trades } from "./commands/trades.js";
// inside the command map / dispatch:
"trades": trades,
```

- [ ] **Step 3: Smoke-test**

```bash
mkdir -p /tmp/sess
echo '{"type":"accept","id":"T-1","side":"long","entry":100,"stop":95,"tp1":110,"tp2":120,"invalidation":90}' > /tmp/sess/trades.jsonl
./bin/tv trades tick --session /tmp/sess --bar '{"high":111,"low":99,"ts":"X"}'
```

Expected: a `TP1_HIT` transition printed; the trades.jsonl now has two lines.

- [ ] **Step 4: Commit**

```bash
git add cli/commands/trades.js cli/router.js
git commit -m "feat(cli): tv trades tick / list / show"
```

### Task 6.4: trade:accept / trade:reject IPC

**Files:**
- Modify: `app/main/ipc.js`
- Modify: `app/preload.js`
- Create: `app/main/trades.js`

- [ ] **Step 1: Write app/main/trades.js**

```js
import fs from "node:fs/promises";
import path from "node:path";
import { activeSessionDir } from "./sessions.js";
import { sizeFor } from "../../cli/lib/sizing.js";

let _seq = 0;
async function genTradeId() {
  _seq += 1;
  return `T-${String(_seq).padStart(4, "0")}`;
}

function dowFromDate(d = new Date()) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

export async function acceptSetup({ setup, send }) {
  const dir = await activeSessionDir();
  const file = path.join(dir, "trades.jsonl");
  const id = await genTradeId();
  const size = sizeFor({ grade: setup.grade, dow: dowFromDate() });
  const event = {
    type: "accept",
    id,
    setup_id: setup.id,
    ts: new Date().toISOString(),
    side: setup.direction,
    model: setup.model,
    grade: setup.grade,
    entry: setup.entry,
    stop: setup.stop,
    tp1: setup.tp1,
    tp2: setup.tp2,
    invalidation: setup.invalidation,
    rr: setup.rr,
    size,
  };
  await fs.appendFile(file, JSON.stringify(event) + "\n", "utf8");
  send?.("trade:accepted", event);
  return event;
}

export async function rejectSetup({ setupId, reason }) {
  const dir = await activeSessionDir();
  const file = path.join(dir, "trades.jsonl");
  const event = { type: "reject", setup_id: setupId, ts: new Date().toISOString(), reason };
  await fs.appendFile(file, JSON.stringify(event) + "\n", "utf8");
  return event;
}
```

- [ ] **Step 2: Add IPC handlers**

In `app/main/ipc.js`:
```js
import { acceptSetup, rejectSetup } from "./trades.js";

ipcMain.handle("trade:accept", async (_e, { setup }) => acceptSetup({ setup, send }));
ipcMain.handle("trade:reject", async (_e, { setupId, reason }) => rejectSetup({ setupId, reason }));
```

- [ ] **Step 3: Expose in preload**

```js
trade: {
  accept(setup) { return ipcRenderer.invoke("trade:accept", { setup }); },
  reject(setupId, reason) { return ipcRenderer.invoke("trade:reject", { setupId, reason }); },
  onAccepted(cb) { ipcRenderer.on("trade:accepted", (_e, ev) => cb(ev)); },
  onOutcome(cb) { ipcRenderer.on("trade:outcome", (_e, ev) => cb(ev)); },
},
```

- [ ] **Step 4: Commit**

```bash
git add app/main/trades.js app/main/ipc.js app/preload.js
git commit -m "feat(app): trade:accept and trade:reject IPC + writers"
```

### Task 6.5: Wire per-bar outcome tick into bar-close

**Files:**
- Modify: `cli/lib/trade-outcomes.js`
- Modify: `cli/commands/trades.js`
- Modify: `app/main/bar-close.js`

To stay DRY, move `foldOpenTrades` into the library first, then consume it from both the CLI command and the main process.

- [ ] **Step 1: Extract foldOpenTrades into cli/lib/trade-outcomes.js**

In `cli/lib/trade-outcomes.js`, add and export the function (same body as the local helper currently inside `cli/commands/trades.js`):

```js
export function foldOpenTrades(events) {
  const byId = new Map();
  for (const ev of events) {
    if (ev.type === "accept") byId.set(ev.id, { ...ev, state: "pending_entry" });
    else if (ev.type === "outcome") {
      const t = byId.get(ev.id);
      if (!t) continue;
      if (ev.status === "FILLED") t.state = "filled";
      else if (ev.status === "TP1_HIT") { t.tp1_hit = true; t.stop = t.entry; }
      else if (["TP2_HIT", "STOPPED", "INVALIDATED"].includes(ev.status)) {
        t.state = "closed";
        t.outcome = ev.status;
      }
    }
  }
  return [...byId.values()].filter((t) => t.state !== "closed");
}
```

- [ ] **Step 2: Update cli/commands/trades.js to import the lib version**

Remove the local `foldOpenTrades` definition in `cli/commands/trades.js`; import it:
```js
import { tickTrades, foldOpenTrades } from "../lib/trade-outcomes.js";
```

- [ ] **Step 3: Add tickOpenTrades to app/main/bar-close.js (BEFORE autoTurn in handleBar)**

```js
import fs from "node:fs/promises";
import { tickTrades, foldOpenTrades } from "../../cli/lib/trade-outcomes.js";
import { activeSessionDir } from "./sessions.js";

async function tickOpenTrades(ev, send) {
  const dir = await activeSessionDir();
  const file = path.join(dir, "trades.jsonl");
  let events = [];
  try {
    const txt = await fs.readFile(file, "utf8");
    events = txt.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return; }
  const open = foldOpenTrades(events);
  if (!open.length) return;
  const { transitions } = tickTrades(open, { high: ev.ohlc.high, low: ev.ohlc.low, ts: ev.ts });
  for (const tr of transitions) {
    await fs.appendFile(file, JSON.stringify({ type: "outcome", ...tr }) + "\n", "utf8");
    send?.("trade:outcome", tr);
  }
}

// Insert at top of handleBar (before autoTurn):
await tickOpenTrades(ev, _send);
```

- [ ] **Step 4: Run the unit tests to confirm the refactor didn't break anything**

```bash
npm run test:unit
```

Expected: existing trade-outcomes tests still pass.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/trade-outcomes.js cli/commands/trades.js app/main/bar-close.js
git commit -m "feat(app): tick open-trade outcomes on every bar close"
```

### Task 6.6: Setup card Accept/Reject buttons

**Files:**
- Modify: `app/renderer/src/Shared.jsx` (or `Live.jsx`, wherever the setup card lives)

- [ ] **Step 1: Add Accept and Reject button handlers**

In the setup card component, wire the existing `[ ACCEPT ]` button to:
```jsx
onClick={() => window.api.trade.accept(setup).then((trade) => onAccepted(trade))}
```

And the `[ REJECT ]` button to:
```jsx
onClick={() => window.api.trade.reject(setup.id, "").then(() => onRejected(setup.id))}
```

The parent component (`Live.jsx`) tracks the setup → trade transformation: on accept, find the setup feed item and replace it visually with a "taken trade" card.

- [ ] **Step 2: useTrades hook**

```js
// app/renderer/src/hooks/useTrades.js
import { useEffect, useState } from "react";

export function useTrades() {
  const [trades, setTrades] = useState({});      // {id: trade}

  useEffect(() => {
    window.api.trade.onAccepted((trade) => {
      setTrades((prev) => ({ ...prev, [trade.id]: { ...trade, state: "pending_entry" } }));
    });
    window.api.trade.onOutcome((ev) => {
      setTrades((prev) => {
        const t = prev[ev.id];
        if (!t) return prev;
        const next = { ...t };
        if (ev.status === "FILLED") next.state = "filled";
        else if (ev.status === "TP1_HIT") { next.tp1_hit = true; next.stop = t.entry; }
        else if (["TP2_HIT", "STOPPED", "INVALIDATED"].includes(ev.status)) { next.state = "closed"; next.outcome = ev.status; next.r_realized = ev.r_realized; }
        return { ...prev, [ev.id]: next };
      });
    });
  }, []);

  return { trades };
}
```

- [ ] **Step 3: Render taken-trade cards in workstation rail**

Use the existing prototype `TradeCard` component (from `Shared.jsx`) to render the active trades from `useTrades().trades`.

- [ ] **Step 4: Manual smoke**

Run the app. In LIVE mode, prompt Claude to surface a setup, then click Accept. Confirm:
- The setup card transforms into a taken-trade card.
- Sizing is visible.
- As bars close, the outcome ticker fires; if the bar's high crosses TP1, the card flips to "TP1 HIT" and stop displays as BE.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/Shared.jsx app/renderer/src/Live.jsx app/renderer/src/hooks/useTrades.js
git commit -m "feat(app): Accept/Reject + taken-trade card + live outcome updates"
```

### Task 6.7: Phase 6 smoke + milestone

- [ ] **Step 1: Vertical-slice end-to-end smoke**

Confirm:
- Setup → Accept → trades.jsonl line written.
- Bar close → outcome tick runs → trade card updates.
- TP1, STOPPED, INVALIDATED transitions all visible.
- Sizing populates correctly per grade × DOW.

**This is the v1 complete milestone.** Trading subsystem works end-to-end.

- [ ] **Step 2: Tag the milestone**

```bash
git tag phase-6-trade-tracking
```

---

## Phase 7 — Fired alerts (≈1 day)

Goal: alerts armed in TradingView fire visibly inside the app.

### Task 7.1: Alert poll module

**Files:**
- Create: `app/main/alerts.js`

- [ ] **Step 1: Write app/main/alerts.js**

```js
import { tvAlertList } from "./tools/tv-alerts.js";

let _timer = null;
let _snapshot = new Map();      // id → status
let _send = null;
let _started = false;

export function startAlertPolling({ send, mode }) {
  _send = send;
  _started = true;
  scheduleNext(modeToCadence(mode));
}

export function stopAlertPolling() {
  _started = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

export function setMode(mode) {
  if (!_started) return;
  if (_timer) clearTimeout(_timer);
  scheduleNext(modeToCadence(mode));
}

function modeToCadence(mode) {
  if (mode === "LIVE") return 5000;
  if (mode === "PREP") return 30_000;
  return null;       // off
}

function scheduleNext(ms) {
  if (ms === null) return;
  _timer = setTimeout(tick, ms);
}

async function tick() {
  try {
    const list = await tvAlertList({});
    if (_snapshot.size === 0) {
      // Initial snapshot — populate without firing.
      for (const a of list) _snapshot.set(a.id, a.status);
    } else {
      for (const a of list) {
        const prev = _snapshot.get(a.id);
        if (prev === "armed" && a.status === "triggered") {
          _send?.("alert:fired", {
            id: a.id, price: a.price, label: a.label,
            fired_at: new Date().toISOString(),
          });
        }
        _snapshot.set(a.id, a.status);
      }
    }
    _send?.("health:update", { alerts: "healthy" });
  } catch {
    _send?.("health:update", { alerts: "down" });
  } finally {
    scheduleNext(modeToCadence(currentMode()));
  }
}

let _currentMode = "PREP";
function currentMode() { return _currentMode; }
export function recordMode(mode) { _currentMode = mode; }
```

- [ ] **Step 2: Wire start/stop on mode switch in ipc.js**

In `mode:switch` handler:
```js
import { startAlertPolling, stopAlertPolling, setMode, recordMode } from "./alerts.js";

// On any mode switch:
recordMode(mode);
if (mode === "LIVE" || mode === "PREP") {
  if (!_alertsStarted) { startAlertPolling({ send, mode }); _alertsStarted = true; }
  else setMode(mode);
} else {
  stopAlertPolling();
  _alertsStarted = false;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/main/alerts.js app/main/ipc.js
git commit -m "feat(app): poll-and-diff alert fired-detection"
```

### Task 7.2: Render alert:fired in UI

**Files:**
- Create: `app/renderer/src/hooks/useAlerts.js`
- Modify: `app/renderer/src/App.jsx`
- Modify: `app/preload.js`

- [ ] **Step 1: Expose alert events in preload**

```js
alert: {
  onFired(cb) { ipcRenderer.on("alert:fired", (_e, ev) => cb(ev)); },
  arm(price, label) { return ipcRenderer.invoke("alert:arm", { price, label }); },
},
```

(Add the `alert:arm` IPC handler in `ipc.js` that calls `tvAlertCreate`.)

- [ ] **Step 2: useAlerts hook**

```js
// app/renderer/src/hooks/useAlerts.js
import { useEffect, useState } from "react";

export function useAlerts() {
  const [fired, setFired] = useState([]);
  useEffect(() => {
    window.api.alert.onFired((ev) => {
      setFired((prev) => [{ ...ev, id: `${ev.id}-${ev.fired_at}` }, ...prev].slice(0, 20));
    });
  }, []);
  return { fired, arm: (p, l) => window.api.alert.arm(p, l) };
}
```

- [ ] **Step 3: Render the toast + feed**

Use the existing prototype `AlertToast` component for the toast. For the feed, add a compact list in the topbar dropdown or a side panel slot.

- [ ] **Step 4: Manual smoke**

Arm an alert via Claude (`tv_alert_create`) or the renderer (`window.api.alert.arm`). Watch TradingView's alert panel. When the price triggers, the alert flips to "triggered" — within 5 seconds, the app's toast and feed should fire.

- [ ] **Step 5: Commit**

```bash
git add app/preload.js app/main/ipc.js app/renderer/src/hooks/useAlerts.js app/renderer/src/App.jsx
git commit -m "feat(app): render fired alerts (toast + feed)"
```

### Task 7.3: Phase 7 smoke + milestone

- [ ] **Step 1: End-to-end manual smoke**

Confirm:
- Arming via PREP key-level row works.
- Arming via Claude's prose-price-click works.
- Arming via Claude's tool works.
- All three converge on `tv alert create` (verify in `tv alert list`).
- When a level triggers, the toast appears and the feed updates within ~5s.
- App-launch initial snapshot does NOT fire events for already-triggered alerts.

- [ ] **Step 2: Tag**

```bash
git tag phase-7-alerts
```

---

## Phase 8 — Polish (≈1-2 days)

### Task 8.1: ET-clock mode suggestions

**Files:**
- Create: `app/renderer/src/hooks/useMode.js`
- Modify: `app/renderer/src/App.jsx`

- [ ] **Step 1: useMode hook**

```js
// app/renderer/src/hooks/useMode.js
import { useEffect, useState } from "react";

export function useMode(initial = "PREP") {
  const [mode, setMode] = useState(initial);
  const [suggested, setSuggested] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const sug = suggestModeFromClock();
      setSuggested(sug);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  return { mode, setMode, suggested };
}

function suggestModeFromClock() {
  const ny = nyTime();
  if (ny.minutes >= 9*60+25 && ny.minutes < 12*60) return "LIVE";
  if (ny.minutes >= 12*60 && ny.minutes < 13*60) return "REVIEW";
  if (ny.minutes >= 13*60 && ny.minutes < 16*60) return "LIVE";
  if (ny.minutes >= 16*60 && ny.minutes < 17*60) return "REVIEW";
  return "PREP";
}

function nyTime() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour").value);
  const m = Number(parts.find((p) => p.type === "minute").value);
  return { minutes: h * 60 + m };
}
```

- [ ] **Step 2: Render the suggestion in App.jsx**

In the mode-switch UI, if `suggested && suggested !== mode`, highlight the suggested mode button with a subtle indicator (e.g., a pulse). Click commits the switch.

- [ ] **Step 3: Commit**

```bash
git add app/renderer/src/hooks/useMode.js app/renderer/src/App.jsx
git commit -m "feat(app): suggest mode based on ET clock"
```

### Task 8.2: Keyboard shortcuts

**Files:**
- Modify: `app/renderer/src/App.jsx`

- [ ] **Step 1: Add global key handler**

```jsx
useEffect(() => {
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "1") setMode("PREP");
    if ((e.metaKey || e.ctrlKey) && e.key === "2") setMode("LIVE");
    if ((e.metaKey || e.ctrlKey) && e.key === "3") setMode("REVIEW");
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      document.querySelector("[data-chat-input]")?.focus();
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

Add `data-chat-input` attribute to the chat input element in `Live.jsx`.

- [ ] **Step 2: Commit**

```bash
git add app/renderer/src/App.jsx app/renderer/src/Live.jsx
git commit -m "feat(app): keyboard shortcuts (Cmd-1/2/3, / to focus chat)"
```

### Task 8.3: Error toasts

**Files:**
- Modify: `app/main/sdk.js`
- Modify: `app/main/ipc.js`
- Modify: `app/preload.js`
- Modify: `app/renderer/src/App.jsx`

- [ ] **Step 1: Emit error events from main on tool failures**

Wrap each tool handler call in a try/catch; on error, send `app:error` IPC event.

```js
ipc.send("app:error", { source: "tool", name: toolName, message: err.message });
```

- [ ] **Step 2: Add error: { onError } in preload**

```js
error: { onError(cb) { ipcRenderer.on("app:error", (_e, ev) => cb(ev)); } },
```

- [ ] **Step 3: Render error toasts**

In `App.jsx`, listen for errors and show a small red toast in the topbar that auto-dismisses after 5s.

- [ ] **Step 4: Commit**

```bash
git add app/main/sdk.js app/main/ipc.js app/preload.js app/renderer/src/App.jsx
git commit -m "feat(app): error toasts for main-side failures"
```

### Task 8.4: Crash-resume of the SDK session

**Files:**
- Modify: `app/main/sdk.js`

The Agent SDK may already handle this automatically. If not:

- [ ] **Step 1: Persist session id + conversation log**

After each `turn_complete`, write the SDK's session id to `state/session/<date>/<session>/sdk-session.json`. On `initSdk`, if that file exists for today's session, resume from it.

(Exact API depends on the Agent SDK — leave a TODO comment if the SDK's resume mechanism isn't documented.)

- [ ] **Step 2: Commit**

```bash
git add app/main/sdk.js
git commit -m "feat(app): persist + resume SDK session across crashes"
```

### Task 8.5: Dev-mode smoke checklist

**Files:**
- Create: `app/SMOKE.md`

- [ ] **Step 1: Write app/SMOKE.md**

```markdown
# Trading Workstation — dev-mode smoke checklist

Run `cd app && npm run dev` and walk through:

- [ ] Window opens at 1440×900 dark theme
- [ ] Top bar: ET clock, session phase, mode switch, killzone countdown, loop pill
- [ ] PREP mode renders Morning Brief; key levels click → arm alert option
- [ ] LIVE mode shows chart 70% / workstation 30%; chat panel + setup rail
- [ ] Type a message → Claude streams a reply
- [ ] Ask Claude to read the chart → tool call to tv_analyze_full → bundle written
- [ ] Setup surfaced → card appears in workstation
- [ ] Click Accept → taken-trade card appears, sizing shown
- [ ] Wait for a bar close → outcome tick runs (verify trades.jsonl grew if relevant)
- [ ] Switch to REVIEW (it's still mock data in v1)
- [ ] Switch out of LIVE → bar-close detector exits
- [ ] Alert fired in TradingView → toast appears within 5s
- [ ] Quit + relaunch → TradingView webview stays logged in
```

- [ ] **Step 2: Commit**

```bash
git add app/SMOKE.md
git commit -m "docs(app): dev-mode smoke checklist"
```

### Task 8.6: Phase 8 smoke + final v1 tag

- [ ] **Step 1: Run through SMOKE.md**

Tick all items.

- [ ] **Step 2: Tag v1**

```bash
git tag trading-workstation-v1
```

- [ ] **Step 3: Optional — open a PR**

```bash
git push -u origin feat/electron-app
gh pr create --title "feat: Trading Workstation v1 (vertical slice)" --body "$(cat <<'EOF'
## Summary
Vertical slice of the Trading Workstation: Electron window with embedded TradingView (broker-connected), Claude Agent SDK in main, automatic bar-close loop in LIVE mode, setup cards with Accept/Reject, trades.jsonl with bar-close-inferred outcomes, fired-alert detection.

## Phases
- Phase 1 · Shell (tag: phase-1-shell)
- Phase 2 · Chart (tag: phase-2-chart)
- Phase 3 · Claude basic (tag: phase-3-claude-basic)
- Phase 4 · Tools (tag: phase-4-tools)
- Phase 5 · Live loop (tag: phase-5-live-loop)
- Phase 6 · Trade tracking (tag: phase-6-trade-tracking)
- Phase 7 · Alerts (tag: phase-7-alerts)
- Phase 8 · Polish (tag: trading-workstation-v1)

## Test plan
- [ ] Walk through `app/SMOKE.md` end to end
- [ ] `npm test` in `app/` passes
- [ ] `npm run smoke:fixtures` in repo root passes (no regressions in the existing CLI)

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes (for the engineer)

**Spec coverage:** every section of the implementation design (§2-12) is realised by a task here. The §16 still-open items from the UI design spec (REVIEW, packaging, broker reconciler) are explicitly deferred per Phase 11 of the spec — not covered in this plan by design.

**Verification cadence:** each phase ends with a smoke task and a git tag. If a phase's smoke fails, fix forward — don't move to the next phase.

**Known judgement calls during execution:**
1. Exact Agent SDK API names (Task 3.2). The plan's pseudocode is illustrative; consult `code.claude.com/docs/en/agent-sdk/typescript` and adjust the `userTurn` shape, the tool registration format, and the event names.
2. Sizing table numbers (Task 6.1). Placeholder values; read `docs/strategy/trading-strategy-2026.md` Step 7 and fill in the real table.
3. `tv alert list` output schema (Task 4.2). The plan assumes `--json` flag; verify against the CLI's actual flag set.
4. Same-bar entry-and-TP edge case (Task 6.2). Documented choice: filled first, then check stop/inval on the SAME bar; never both entry-and-TP-hit in one bar.
5. Process supervision: detector auto-restart with exponential backoff to 30s (Task 5.2). Surface a "loop down" banner if it stays down for > 60s.
