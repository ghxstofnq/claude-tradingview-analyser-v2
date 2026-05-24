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

- **2026-05-24** — Alert create flow rewritten: opens the right dialog button (lowercase `Create alert`), uses CDP keystrokes to type the price (synthetic events don't update TV's framework state), presses Enter to commit. Wrapper now propagates failures + drift warnings. ([#37](https://github.com/ghxstofnq/claude-tradingview-analyser/pull/37))
- **2026-05-24** — UI-scraped delete path proven live for both per-alert and delete-all. Pattern: open Alerts widgetbar tab → click `[data-name="alert-delete-button"]` on the row → click `[data-qa-id="yes-btn"]` to confirm. TV Desktop's actual delete traffic runs through Electron main-process and is invisible to renderer-level CDP — REST endpoints (`/delete_alert` etc.) don't exist as public POST.
- **2026-05-24** — `docs/tradingview-cookbook.md` created.

---

## Conventions

- **CDP port 9223 only.** All CLI commands connect to TradingView Desktop on `localhost:9223`. Port 9222 is for sibling projects — never touch it from here.
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

All interactions tunnel through Chrome DevTools Protocol on port 9223. The connection module exposes:

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
./bin/tv alert create --price 21528.50 --message "PDH"
```

Under the hood (see [`packages/core/alerts.js`](../packages/core/alerts.js)):

1. Click `[aria-label="Create alert"]` (lowercase `a` — case-sensitive!) to open the dialog.
2. Walk up from the title span `[class*="textPrefix-"]` containing `"Create alert"` to the dialog root (the root has a `[class*="submitBtn-"]` button).
3. `input.focus()` + `input.select()` via JS.
4. Backspace to clear, then type the price one character at a time via `client.Input.dispatchKeyEvent` (real keystrokes — synthetic events don't update TV's framework state).
5. Press Enter — commits the typed value into TV's model **and** submits.
6. Wait ~1.8s, then list-diff to verify.

**Returns:** `{success, alert_id, requested_price, created_price, drift, drift_warning, message, source}`.

**Gotchas:**
- TV's auto-generated message shows the **rounded** display price (e.g. "MES1! Crossing 11,111.00") but the alert's actual trigger price preserves your input (11111.11). The trigger fires at the precise value.
- Fractional ticks can sometimes drift — `drift_warning` is set when `created_price !== requested_price`. Renderer is notified via `app:error` IPC with `level: "warn"`.
- The dialog has a `[data-qa-id="alert-message-button"]` tab that exposes `textarea#alert-message` for custom messages. We don't currently fill this — TV uses the auto-message — but the selectors are documented for when we add it.

#### `tv alert delete --all`

```bash
./bin/tv alert delete --all
```

**Current behavior is incomplete** — the existing CLI just opens the alerts manager's context menu and waits for manual confirmation. There is no TV "Remove all alerts" header button.

The **working pattern** (proven 2026-05-24, used to clear 329 alerts via script) is:

1. Click `[data-name="alerts"]` to open the Alerts widgetbar tab.
2. For each row, click `[data-name="alert-delete-button"]`.
3. Wait ~380ms for the confirm dialog.
4. Click `[data-qa-id="yes-btn"]`.
5. Wait ~500ms for sync.
6. Loop until no more `[data-name="alert-delete-button"]` elements exist.

Rate: ~1 delete per 900ms with good timing, ~50% success rate at 280ms timing. At 380ms timing the rate climbs to ~85%.

**Per-alert delete (not yet wired into the CLI):** locate the row whose ID matches the target `alert_id`, then click that row's delete button + confirm. The Alerts tab renders one button group per row.

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
