# TradingView Cookbook

A living catalog of every TradingView interaction this project can do, and how each one works under the hood. Add to it whenever we discover a new technique or expose a new command.

This is the second-most useful file in the repo after `CLAUDE.md`. When something doesn't behave the way you expect against TradingView, the answer is almost always in here.

---

## How to update this doc

Every PR that adds, fixes, or changes a TradingView interaction should:

1. Add a one-line entry to the [Changelog](#changelog) at the top (date, what changed, link to PR).
2. Update or add the relevant **Cookbook** section with the new technique.
3. If a new pattern is reusable, add it to **Techniques**.

The PR description should include a line like `Updates: docs/tradingview-cookbook.md — alert section + Techniques`.

---

## Changelog

Most recent first. Entry format: `YYYY-MM-DD — short summary (#PR)`.

- **2026-05-25** — Dual-symbol scan (`tv analyze --pair MNQ1!,MES1!`) with code-side leader pick (`cli/lib/compute-leader.js`) and per-session lock (`pair-decision.json`). Surfaces the leader/laggard read during pre-session + the 15-min NY open reaction, then short-circuits to single-symbol on the leader for entry hunt. New MCP tool `surface_leader_decision`. ([design spec](superpowers/specs/2026-05-24-leader-laggard-dual-scan-design.md))
- **2026-05-24** — Per-alert delete shipped. Open the Alerts panel via **REAL CDP mouse click** (synthetic `.click()` opens the widget container but doesn't trigger the panel-populate logic). Retry up to 30s with sub-tab toggle nudges to give the panel time to render the row. Find the row by `alert.message` text, click its `[data-name="alert-delete-button"]`, click `[data-qa-id="yes-btn"]`. First call cold ~30s, subsequent calls warm <5s. Renderer's disarm flow now actually deletes the TV alert.
- **2026-05-24** — Alerts gain custom messages + working `delete --all`. Dialog selectors switched to the modern `[data-qa-id="alerts-create-edit-dialog"]` root (the `textPrefix-` markers from PR #37 are gone). **Important: set message FIRST, type price LAST** — navigating to the message sub-dialog loses any typed price, and TV's price model only commits on Enter while the price input is focused. Renderer arm-failure UX: optimistic add → revert if `{ok:false}`, drift warnings surface as toasts.
- **2026-05-24** — Alert create flow rewritten: opens the right dialog button (lowercase `Create alert`), uses CDP keystrokes to type the price (synthetic events don't update TV's framework state), presses Enter to commit. Wrapper now propagates failures + drift warnings. ([#37](https://github.com/ghxstofnq/claude-tradingview-analyser/pull/37))
- **2026-05-24** — `docs/tradingview-cookbook.md` created.

---

## Conventions

- **CDP port 9225 only.** All CLI commands connect to TradingView Desktop on `localhost:9225`. Port 9222 is for sibling projects — never touch it from here.
- **CLI only.** No `mcp__tradingview__*` tools. Everything goes through `./bin/tv ...`.
- **TV Desktop must be running and signed in.** Many endpoints require the page's session cookies; some controls only render once authenticated.

---

## Quick command reference

Run `./bin/tv <command> --help` for flags. Headline list:

| Command | What it does |
|---|---|
| `tv status` | Verify CDP is connected, report current symbol / TF |
| `tv launch` | Auto-launch TV Desktop with CDP enabled |
| `tv state` | Symbol, timeframe, chart type, all visible studies (call first when reading) |
| `tv discover` | Probe which JS API paths are available |
| `tv ui-state` | Snapshot which panels / buttons are open right now |
| `tv quote` | Real-time price snapshot for the active symbol |
| `tv ohlcv` | OHLCV bars at the chart's current TF |
| `tv values` | Numeric values from every visible indicator's data window |
| `tv data <kind>` | Pull lines / labels / tables / boxes / strategy results from Pine indicators |
| `tv info` / `tv search` | Symbol metadata and search |
| `tv symbol` / `tv timeframe` / `tv type` / `tv range` / `tv scroll` | Mutate the chart view |
| `tv indicator <add\|remove\|toggle\|set\|get>` | Manage studies on the chart |
| `tv pine <get\|set\|compile\|...>` | Pine Script development |
| `tv draw <shape\|list\|...>` | Drawing tools (lines, rectangles, text, etc.) |
| `tv alert <list\|create\|delete>` | Price alerts |
| `tv watchlist <get\|add>` | Watchlist contents |
| `tv layout <list\|switch>` | Saved chart layouts |
| `tv pane <list\|layout\|focus\|symbol>` | Multi-pane chart layouts |
| `tv tab <list\|new\|close\|switch>` | Browser-tab management |
| `tv screenshot` | Capture the chart, strategy tester, or full window |
| `tv replay <start\|step\|stop\|status\|autoplay\|trade>` | Strategy replay mode |
| `tv stream <quote\|bars\|bar-close\|values\|lines\|labels\|tables\|all>` | Long-running JSONL stream for live monitoring |
| `tv analyze` | The big one — bundles chart state + multi-TF bars + parsed ICT Engine table + deterministic gates into one JSON for Claude |
| `tv trades <tick\|list\|show>` | Trade tracking (uses outcomes-tick logic) |
| `tv dash` | Live oversight TUI (separate Go binary built with `make dash`) |
| `tv ui <click\|keyboard\|hover\|scroll\|find\|eval\|type\|panel\|fullscreen\|mouse>` | Low-level UI automation primitives |

---

## Techniques

These are the patterns we keep reusing. When you're building something new, check this list first.

### 1. CDP connection (`packages/core/connection.js`)

All interactions tunnel through Chrome DevTools Protocol on port 9225. The connection module exposes:

- **`evaluate(jsExpression)`** — run synchronous JS in the page context, return the result. Use for DOM reads + simple synchronous JS.
- **`evaluateAsync(promiseExpression)`** — run a Promise-returning expression, await it, return the resolved value. Use for `fetch()` and any awaited work.
- **`getClient()`** — returns the raw CDP client. Use when you need `Input.dispatchKeyEvent`, `Input.dispatchMouseEvent`, `Network.enable`, etc.

### 2. REST API via session cookies

Some TV state is reachable through `fetch()` from the page with `credentials: 'include'` (the page's TradingView session cookies). Example:

```js
fetch('https://pricealerts.tradingview.com/list_alerts', { credentials: 'include' })
  .then(r => r.json())
  .then(d => d.r)   // d.r is the list of alerts, d.s === 'ok' on success
```

The response format is `{s: 'ok'|'error', r: <result>, errmsg?: <string>}`.

**Caveats:**
- Only works if signed into TV.
- Only renderer-originated requests are accessible — TV Desktop's *write* traffic (create/delete alert) runs from the Electron main process and is invisible. See [Alerts](#alerts) for the full story.
- JSON `Content-Type` triggers CORS preflight and may fail; use `text/plain` or `application/x-www-form-urlencoded` for POST bodies when needed.

### 3. DOM scraping with class-prefix selectors

TradingView's classes are CSS-Modules with hashed suffixes (`button-OhqNVIYA`, `dialog-qyCw0PaN`). **The hash changes every release; the prefix is stable.** So match on `[class*="dialog-"]` instead of the full class name.

```js
// Bad — breaks next release:
document.querySelector('.dialog-qyCw0PaN')

// Good — stable across releases:
document.querySelector('[class*="dialog-"][class*="popup-"]')
```

Other stable selector types:
- `[data-name="..."]` (TV's own structural attributes — usually stable)
- `[data-qa-id="..."]` (TV's testing attributes — also stable)
- `[aria-label="..."]` (accessibility labels — fairly stable, **case-sensitive** — we got bit by this once: `"Create Alert"` vs `"Create alert"`)

### 4. CDP keystrokes for inputs that ignore synthetic events

**This is the most-important technique we have.** TV's framework binds inputs to an internal model that doesn't react to synthetic `dispatchEvent('input')` calls. Setting `input.value` updates the DOM but **not the model**, so when you submit the form the original (prefilled) value is used.

The fix: dispatch real keystrokes via CDP.

```js
const client = await getClient();

// 1. JS-focus the input (no mouse needed)
await evaluate(`document.querySelector('[selector]').focus(); document.querySelector('[selector]').select();`);

// 2. Backspace to clear
await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await client.Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });

// 3. Type each character
for (const c of '9999.99') {
  const isDigit = /\d/.test(c);
  const code = isDigit ? `Digit${c}` : 'Period';
  const vkc  = isDigit ? c.charCodeAt(0) : 190;
  await client.Input.dispatchKeyEvent({ type: 'keyDown', text: c, key: c, code, windowsVirtualKeyCode: vkc });
  await client.Input.dispatchKeyEvent({ type: 'keyUp',                key: c, code, windowsVirtualKeyCode: vkc });
}

// 4. Press Enter to commit + submit
await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await client.Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
```

Synthetic `dispatchEvent` updates the DOM value. CDP keystrokes update the **model**. Tell them apart by reading a related preview button (e.g. the auto-generated alert message) — if its text reflects the new value, the model updated.

### 5. List-diff verification

For mutating operations where the "did it work" signal is unreliable (DOM `success` flags, navigation away from the page, etc.), capture the list state before and after, diff to find the new entry:

```js
const preIds = new Set((await list()).alerts.map(a => a.alert_id));
// ... do the mutation ...
const post = await list();
const newAlerts = (post.alerts || []).filter(a => !preIds.has(a.alert_id));
```

Used by `packages/core/alerts.js:create()`.

### 6. Internal `TradingViewApi` access

`window.TradingViewApi` exposes a deep object tree with chart widgets, models, alert collections, replay controllers. Read-only data is accessible; write operations usually call into Electron main-process and aren't reachable.

Useful entry points:

```js
// Active chart's model
window.TradingViewApi._chartWidgetCollection._activeChartWidgetModel._value.m_model

// Alerts collection (read-only — getAlert(id), alerts(), sync())
window.TradingViewApi._chartWidgetCollection
  ._activeChartWidgetModel._value.m_model._alertsCollection.value()

// Connection / WebSocket telemetry
window.TradingViewApi._chartApiInstance._wsBackendConnection
```

Use `tv discover` to enumerate available paths.

### 7. WebSocket frames

TV uses a Socket.IO-style WebSocket at `wss://prodata.tradingview.com/socket.io/websocket` for live data + telemetry. Framing is `~m~<len>~m~<payload>`. The connection is initiated by TV; intercept by patching `WebSocket.prototype.send` and `WebSocket.prototype.onmessage`.

We don't currently use this for outgoing traffic — only for occasional sniffing while reverse-engineering.

---

## Cookbook

### Reading the chart

#### `tv state` — what's on the chart

Returns symbol, resolution, chart type, the list of attached studies (each with entity ID + name). Call this first to get IDs you'll need for `tv indicator set/remove`.

```bash
./bin/tv state
```

#### `tv quote` — current price

```bash
./bin/tv quote
# { last, open, high, low, close, volume, time, ... }
```

#### `tv ohlcv` — bar data

```bash
./bin/tv ohlcv                    # default summary
./bin/tv ohlcv --bars 200         # specify count
./bin/tv ohlcv --no-summary       # full bar list (rare — large output)
```

**Always pass `--summary` (default) unless you need individual bars.** Full bar lists can be 100KB+.

#### `tv values` — indicator values

Numeric value of every visible indicator's data window. Use after `tv state` to pair values with names.

```bash
./bin/tv values
```

#### `tv data <kind>` — Pine-emitted entities

Custom Pine indicators draw lines, labels, tables, boxes on the chart. These commands extract them as structured JSON:

```bash
./bin/tv data lines  --study-filter "Profiler"
./bin/tv data labels --study-filter "ICT Engine"
./bin/tv data tables --study-filter "Anchored Structures"
./bin/tv data boxes  --study-filter "FVG"
```

Always pass `--study-filter` if you know which indicator you want — without it, output can be enormous.

### Changing the chart

```bash
./bin/tv symbol MNQ1!
./bin/tv timeframe 5             # 1, 5, 15, 60, 240, D, W
./bin/tv type Candles            # Bars, Candles, Line, Area, ...
./bin/tv range --from 2026-01-01 --to 2026-05-01
./bin/tv scroll --to 2026-05-15
```

After mutating, expect ~200ms for the chart to settle before reading state again.

### Indicators

```bash
./bin/tv indicator add "Relative Strength Index"      # USE FULL NAME, not "RSI"
./bin/tv indicator remove <entity-id>                 # from tv state
./bin/tv indicator toggle <entity-id>                 # show/hide
./bin/tv indicator set <entity-id> length=20 source=close
./bin/tv indicator get <entity-id>
```

### Pine Script

```bash
./bin/tv pine list                                    # all scripts in your collection
./bin/tv pine new "My Script"                         # blank new script
./bin/tv pine open <name>                             # open existing
./bin/tv pine get                                     # current source (may be 200KB+ — avoid unless editing)
./bin/tv pine set < script.pine                       # inject from stdin
./bin/tv pine compile                                 # compile + report errors
./bin/tv pine errors
./bin/tv pine console                                 # log output
./bin/tv pine analyze                                 # syntax + soft check
./bin/tv pine save
```

`pine_smart_compile` (compile + check + auto-fixes) is the daily-driver verb.

### Drawing tools

```bash
./bin/tv draw shape horizontal_line --price 21528.50 --color amber
./bin/tv draw shape trend_line --from 2026-05-01:21400 --to 2026-05-15:21600
./bin/tv draw shape rectangle --top 21550 --bottom 21500 --from 2026-05-01 --to 2026-05-15
./bin/tv draw shape text --price 21528 --text "PDH"
./bin/tv draw list
./bin/tv draw remove <drawing-id>
./bin/tv draw clear
```

### Alerts

This is the biggest section because we've reverse-engineered it the hardest. Read carefully.

#### Architecture

| Path | Direction | Mechanism |
|---|---|---|
| List alerts | renderer → TV servers | GET `pricealerts.tradingview.com/list_alerts` with session cookies. **Works.** |
| Create alert | renderer → TV servers | **No public REST endpoint.** Mutation goes through TV's UI dialog. We DOM-scrape it. |
| Delete alert | renderer → TV servers | Same — UI scrape via the right widgetbar Alerts tab. |

The actual write traffic (create + delete) goes through TV Desktop's Electron main process via `net.request`, which is invisible to renderer-level CDP. Confirmed empirically — a renderer-side network listener captures zero non-GET traffic during a manual create or delete.

#### `tv alert list`

```bash
./bin/tv alert list
```

Returns the full alert list with structured data: `alert_id`, `symbol`, `message`, `condition.series[].value` (the trigger price), `active`, `create_time`, `last_fired`.

#### `tv alert create`

```bash
./bin/tv alert create --price 21528.50                    # auto-generated message
./bin/tv alert create --price 21528.50 --message "PDH"    # custom message
```

Under the hood (see [`packages/core/alerts.js`](../packages/core/alerts.js)):

1. Click `[aria-label="Create alert"]` (lowercase `a` — case-sensitive!) to open the dialog. Dialog root is `[data-qa-id="alerts-create-edit-dialog"]`.
2. **If a message is provided, set it FIRST:** click `[data-qa-id="alert-message-button"]` to open the message sub-dialog (`[data-qa-id="alerts-message-edit-dialog"]`). Focus `textarea#alert-message`, backspace to clear, type via CDP keystrokes, click that sub-dialog's `[data-qa-id="submit"]` to return.
3. Focus the dialog's only `input[type="text"]` (the price field — no id/name).
4. Backspace, then type the price via `client.Input.dispatchKeyEvent` (real keystrokes — synthetic events don't update TV's framework state).
5. **Press Enter** — commits the typed price into TV's model **and** submits. Don't click the submit button; the typed value gets reverted to market price if you do.
6. Wait ~1.8s, then list-diff to verify.

**Returns:** `{success, alert_id, requested_price, created_price, drift, drift_warning, message, message_set_attempted, message_set_success, source}`.

**Why message-before-price:** If you set the price first then navigate to the message sub-dialog, the price input blurs and TV reverts the typed value to the prefilled market price. The message sub-dialog can be entered and left freely; the price input only commits on Enter, so it must be typed *last*.

**Gotchas:**
- TV's auto-generated message shows the **rounded** display price (e.g. "MES1! Crossing 11,111.00") but the alert's actual trigger price preserves your input (11111.11). The trigger fires at the precise value.
- Fractional ticks can sometimes drift — `drift_warning` is set when `created_price !== requested_price`. Renderer surfaces this as an arm-warning toast in the workstation.
- The Enter-to-commit is what makes the typed value stick. `[data-qa-id="submit"]` click without first typing Enter creates an alert at the prefilled price.

#### `tv alert delete --all`

```bash
./bin/tv alert delete --all
```

Loops until no more `[data-name="alert-delete-button"]` elements exist:

1. `ensureAlertsPanelOpen()` — click `[data-name="alerts"]` to open the widgetbar Alerts tab, ensure the "Alerts" sub-tab is selected (vs "Log").
2. For each row, click `[data-name="alert-delete-button"]`.
3. Wait ~380ms for the confirm dialog (`[data-qa-id="yes-btn"]`).
4. Click yes.
5. Wait ~500ms for sync.
6. Repeat until no delete buttons remain.

Rate: ~1 delete per 900ms with good timing. Cleared 329 alerts in ~11.5 minutes in the proving run.

**Returns:** `{success, deleted, remaining, source}`.

#### `tv alert delete --id <alert_id>`

```bash
./bin/tv alert delete --id 4773177343
```

Per-alert delete by ID, via UI scraping:

1. `ensureAlertsPanelOpen()` — use a **REAL CDP mouse click** on `[data-name="alerts"]` (NOT `.click()` — TV's panel doesn't populate from synthetic clicks, only real mouse events trigger the render path).
2. Retry loop (up to 30s): poll for an `[data-name="alert-item-description"]` whose text matches `target.message`. Every 3rd attempt, toggle the "Log" / "Alerts" sub-tabs to nudge a re-render.
3. Once found, walk up from the description to the row container that holds `[data-name="alert-delete-button"]`, click it.
4. Wait ~400ms for the confirm dialog, click `[data-qa-id="yes-btn"]`.
5. Verify via list-diff.

**Returns:** `{success, deleted_id, attempts, elapsed_ms, source}`. On failure: `{success: false, reason, target_message, attempts}`.

**Timing:** first delete from a cold panel is ~30s. Subsequent deletes (panel warm) are <5s. The 30s timeout is conservative — most real deletes complete well within it.

**Why so slow on first call:** TV's alerts panel is lazy. The widget container exists immediately but it only renders rows after a real mouse click on the bell triggers TV's render path. Synthetic `.click()` opens the widget but the row list stays empty until something forces a layout pass.

**Workstation use:** the bell-off action calls `window.api.alert.disarm(id)` which routes here. Local bell state updates immediately (so the UI feels instant); the actual TV alert deletion runs in the background, with a warning toast if it fails (the local "off" is truth — the user wanted it off).

#### Workstation behavior

`window.api.alert.arm(price, label)` creates a real TV alert. The toggle-off action in the workstation is **local only** — it removes the bell dot from the UI but the TV alert lives on. The next periodic `tv alert delete --all` clears it.

#### Confirmed dead ends (don't re-investigate)

- POST `/delete_alert`, `/remove_alert`, `/delete`, `/remove` → all return `no_such_endpoint`.
- HTTP `DELETE /alert/{id}` → CORS preflight fails.
- `TradingViewApi._alertsCollection` exposes `getAlert(id)`, `alerts()`, observable events — **no `deleteAlert()` method**. The Alert object's `destroy()` only tears down the in-memory wrapper.
- WebSocket frame inspection during a manual delete shows only heartbeats — no alert mutation traffic.

### Panes, tabs, layouts, watchlist

```bash
./bin/tv pane list                                # all chart panes
./bin/tv pane layout 2v                           # s, 2h, 2v, 4, 6, 8
./bin/tv pane focus <pane-id>
./bin/tv pane symbol <pane-id> ES1!               # different symbol per pane

./bin/tv tab list
./bin/tv tab new MES1!
./bin/tv tab close <tab-id>
./bin/tv tab switch <tab-id>

./bin/tv layout list
./bin/tv layout switch <layout-name>

./bin/tv watchlist get
./bin/tv watchlist add MNQ1!
```

### Replay

```bash
./bin/tv replay start --from 2026-05-15:09:30
./bin/tv replay step                              # next bar
./bin/tv replay autoplay --speed 2
./bin/tv replay status
./bin/tv replay trade --side long --entry 21500 --stop 21480 --tp1 21540 --tp2 21580
./bin/tv replay stop
```

Replay drives the same chart as live mode — useful for testing strategy code against past data.

### Screenshots

```bash
./bin/tv screenshot --region chart                # just the chart pane
./bin/tv screenshot --region strategy_tester      # just the strategy panel
./bin/tv screenshot --region full                 # whole window
./bin/tv screenshot --out path/to/file.png
```

**Per CLAUDE.md hard constraint #5:** screenshots are for verification and tests only — never fed into analysis input. Multimodal hallucination risk.

### Streaming

`tv stream` blocks the process and prints one JSON event per line. Used by the bar-close detector:

```bash
./bin/tv stream bar-close                         # one event per closed bar; 5m close adds is_5m_close:true
./bin/tv stream quote                             # every tick
./bin/tv stream bars --tf 1                       # every closed bar at TF
./bin/tv stream values --study-filter "RSI"       # indicator value changes
./bin/tv stream all                               # firehose — quote + bars + values
```

Wired into the app at `app/main/bar-close.js`. Detector also writes a heartbeat to `state/session/detector-heartbeat.json` and persists every event to `state/session/<date>/bar-close-events.jsonl`.

### `tv analyze` — the big bundle

The headline command. Captures everything Claude needs in one structured object.

```bash
./bin/tv analyze                                  # full multi-TF sweep (~13s)
./bin/tv analyze --out state/last-analyze.json
./bin/tv analyze --pillar3-only                   # current TF only (~0.2s)
./bin/tv analyze --baseline state/baseline.json   # reuse a cached multi-TF capture
```

Output is one JSON object with:

- `chart` — symbol, resolution, chart type, studies
- `quote` — last price + OHLC + volume
- `bars` — OHLCV summary at the current TF + `last_5_bars`
- `bars_by_tf.{daily,h4,h1,m15,m5,m1}` — per-TF summaries
- `engine` — the parsed ICT Engine indicator output at the current TF (`levels`, `sweeps`, `fvgs`, `bprs`, `swings`, `structures`, `quality`)
- `engine_by_tf.{daily,h4,h1,m15,m5,m1}` — same parsed object per TF (HTF FVGs + HTF structure live here)
- `gates.session.*` — clock-based facts (phase, killzone, market state)
- `gates.engine.*` — engine-derived facts (pillar 1 levels, pillar 2 quality, pillar 3 FVGs/swings/structures)

See [`CLAUDE.md`](../CLAUDE.md) "Layout" + "The `analyze` recipe" sections for the full schema.

### Dual-symbol scans (`--pair`)

`tv analyze --pair <primary>,<secondary>` captures both symbols in one run. The chart's current symbol must equal one of the two — no silent chart swap.

```bash
# Full dual sweep (~30s — multi-TF on both symbols).
./bin/tv analyze --pair MNQ1!,MES1! --out state/last-analyze.json

# Fast dual poll with per-symbol baselines (~2-3s).
./bin/tv analyze --pair MNQ1!,MES1! \
  --pillar3-only \
  --baseline state/baseline-MNQ1!.json \
  --baseline-secondary state/baseline-MES1!.json \
  --out state/last-scan.json
```

**What gets captured per symbol:** chart state, quote, bars, bars_by_tf, engine, engine_by_tf, gates. Nested under `pair.symbols.<symbol>`. The top-level fields (`chart`, `quote`, `bars`, etc.) mirror the primary for backward compatibility with single-symbol consumers.

**Leader pick is code-side.** `cli/lib/compute-leader.js` is a pure function: takes both engine objects + the open-reaction window, returns the symbol with the higher max `disp_score` on FVGs created in the window. Threshold-gated (0.10 default) so close margins yield `leader: null, reason: "inconclusive_margin_below_threshold"`.

**Lifecycle.** During pre-session + the 15-min NY open reaction, every `tv analyze --pair` run captures both symbols and computes evidence. At minute 14, Claude (via the in-app `surface_leader_decision` MCP tool) writes `state/session/<date>/<session>/pair-decision.json`. Subsequent `tv analyze --pair` runs detect this file, switch the chart to the leader, and run a normal single-symbol capture for the rest of the session.

**Per-symbol baselines.** Use `--baseline state/baseline-MNQ1!.json --baseline-secondary state/baseline-MES1!.json` to keep the fast-poll path under ~3s. (The single `state/baseline.json` from before this change still works as a primary-only fallback.)

**Edge cases:**
- ICT Engine missing on the secondary → `pair.leader_evidence.reason: "secondary_engine_missing"`. Loud stderr warning. Entry hunt falls back to the primary.
- Chart on neither named symbol → CLI errors loudly; no silent swap.
- Pair-decision.json from a previous day → ignored as stale; treated as fresh session.

**Design + rationale:** [`docs/superpowers/specs/2026-05-24-leader-laggard-dual-scan-design.md`](superpowers/specs/2026-05-24-leader-laggard-dual-scan-design.md).

### Health + discovery

```bash
./bin/tv status                                   # CDP connection, current chart, target id
./bin/tv discover                                 # JS API paths available on window.TradingViewApi
./bin/tv ui-state                                 # which panels/tabs are open right now
```

`tv discover` is invaluable when reverse-engineering a new feature — shows you which `TradingViewApi.*` paths exist and what methods they have.

### Trade tracking

```bash
./bin/tv trades tick                              # apply latest bar to open trades
./bin/tv trades list                              # all trades in the active session
./bin/tv trades show <id>
```

Deterministic comparison — no LLM math. See `cli/lib/trade-outcomes.js`.

### UI primitives (`tv ui ...`)

Low-level building blocks. Useful when you need to interact with TV's UI directly and no higher-level command exists:

```bash
./bin/tv ui click --selector '[data-name="alerts"]'
./bin/tv ui keyboard --key Enter
./bin/tv ui type --selector 'input.foo' --text "hello"
./bin/tv ui hover --selector '...'
./bin/tv ui scroll --x 0 --y 200
./bin/tv ui find --selector '...'                 # is it on the page?
./bin/tv ui eval --js '...'                       # arbitrary evaluate()
./bin/tv ui panel --open                          # toggle the right widgetbar
./bin/tv ui fullscreen
./bin/tv ui mouse --x 500 --y 300 --button right --click
```

`tv ui type` does **synthetic** typing — fine for plain inputs, but **won't work for framework-bound inputs** (see Technique 4). For those, use CDP keystrokes directly from a custom script.

---

## When TradingView updates and things break

This is the inevitable failure mode. TV ships UI changes regularly. When something stops working:

1. **Read this doc's Techniques section first** to know what kind of selector you're dealing with.
2. **Use `tv discover` + `tv ui-state`** to see the live DOM.
3. **For DOM-scraped flows, start by inspecting the actual element you're targeting** — open the dialog, run a probe script that lists `[role="dialog"]`, `[class*="dialog-"]`, etc. The class-prefix selectors usually survive; the hash suffix doesn't.
4. **Check case-sensitivity on `aria-label`** — `"Create alert"` vs `"Create Alert"` was a real bug.
5. **For inputs, verify the model is actually updating** — read a preview element to confirm, not just `input.value`. See Technique 4.
6. **Add a Changelog entry once fixed**, even for one-character fixes.
