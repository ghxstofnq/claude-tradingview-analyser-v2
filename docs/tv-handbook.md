# TV Handbook

Quick reference for every `./bin/tv` command. The CLI talks to TradingView Desktop over CDP on port 9225 (`packages/core/connection.js` `CDP_PORT = 9225`).

Prerequisites: Electron app running. Signed in to TradingView Web in the webview. Chart loaded with desired symbol + indicators (ICT Engine V1 for analysis).

All commands return JSON to stdout. `success: false` ⇒ stderr + exit 1.

---

## Health / discovery

```bash
./bin/tv status                            # check CDP connection
./bin/tv discover                          # which TradingView API paths are reachable
./bin/tv ui-state                          # current UI panels/buttons
```

## Chart state

```bash
./bin/tv state                             # symbol + TF + studies + entity IDs
./bin/tv symbol                            # get current symbol
./bin/tv symbol MNQ1!                      # set symbol (positional)
./bin/tv timeframe                         # get current TF
./bin/tv timeframe 5                       # set TF (1, 5, 15, 60, 240, D, W)
./bin/tv type                              # get chart type
./bin/tv type Candles                      # set chart type
./bin/tv info                              # symbol metadata (tick size, session, etc.)
./bin/tv search AAPL                       # symbol search
./bin/tv range                             # get visible range
./bin/tv range --from 1735689600 --to 1735776000   # set range (unix seconds)
./bin/tv scroll 2025-01-15                 # scroll to date
```

## Quotes + bars

```bash
./bin/tv quote                             # real-time price snapshot
./bin/tv ohlcv                             # last 100 bars at current TF
./bin/tv ohlcv -n 500                      # 500 bars (max)
./bin/tv ohlcv -s                          # summary stats only (no bars)
```

## Indicator values

```bash
./bin/tv values                            # live values from data window (RSI, MACD, EMA, etc.)
```

## Pine indicator output (lines / labels / tables / boxes)

```bash
./bin/tv data lines                        # all horizontal price levels from Pine line.new()
./bin/tv data lines -f "ICT Engine"        # filter by indicator name substring
./bin/tv data labels                       # text annotations
./bin/tv data labels -n 100                # max 100 labels per study (default 50)
./bin/tv data tables                       # table.new() rows
./bin/tv data boxes                        # price zones from box.new()
./bin/tv data lines -v                     # include raw payload
```

## Indicators (add / remove / toggle / set)

```bash
./bin/tv indicator add "Relative Strength Index"
./bin/tv indicator add "Bollinger Bands" -i '{"length":50}'
./bin/tv indicator list                    # via tv state (studies array)
./bin/tv indicator remove <entity_id>
./bin/tv indicator toggle <entity_id> --hidden
./bin/tv indicator toggle <entity_id> --visible
./bin/tv indicator set <entity_id> -i '{"length":21}'
./bin/tv indicator get <entity_id>         # inputs + metadata
```

## Strategy / backtest data (when a strategy is on the chart)

```bash
./bin/tv data strategy                     # net P&L, win rate, max drawdown, etc.
./bin/tv data trades                       # trade list
./bin/tv data trades -n 50                 # cap to last 50
./bin/tv data equity                       # equity curve
./bin/tv data depth                        # order book / DOM
./bin/tv data indicator <entity_id>        # inputs + metadata for one indicator
```

## Drawings

```bash
./bin/tv draw shape -t horizontal_line -p 30050
./bin/tv draw shape -t trend_line -p 30000 --time 1735689600 --price2 30100 --time2 1735776000
./bin/tv draw shape -t rectangle -p 30000 --time 1735689600 --price2 30100 --time2 1735776000
./bin/tv draw shape -t text -p 30050 --time 1735689600 --text "support"
./bin/tv draw shape -t horizontal_line -p 30050 --overrides '{"linecolor":"#ff0000"}'
./bin/tv draw list                         # all drawings + entity IDs
./bin/tv draw get <entity_id>              # properties of one drawing
./bin/tv draw remove <entity_id>           # delete one drawing
./bin/tv draw clear                        # remove all drawings
```

## Alerts

Creation goes via REST API to `pricealerts.tradingview.com/create_alert` (since the 2026-05-28 webview migration). List + delete still work the same way.

```bash
./bin/tv alert list                        # all active alerts
./bin/tv alert create -p 30050 -m "MNQ break"
./bin/tv alert create -p 30050 -m "label" -c crossing   # condition: crossing|greater_than|less_than
./bin/tv alert delete --id 4797818488      # delete single by alert_id
./bin/tv alert delete --all                # delete all (destructive)
```

Drift: TV may round the requested price to the symbol's tick. Response includes `drift` (delta) and `drift_warning` when non-zero.

## Replay

```bash
./bin/tv replay start --from 2025-05-20              # start at a date (YYYY-MM-DD)
./bin/tv replay start -d 2025-05-20                  # alias for --from
./bin/tv replay start --from 2025-05-20 --at 09:30   # anchor to NY AM open (HH:MM ET, DST-aware)
./bin/tv replay status                               # is replay active? current bar time?
./bin/tv replay step                                 # advance one bar
./bin/tv replay autoplay -s 500                      # toggle autoplay; speed = ms delay (lower = faster)
./bin/tv replay stop                                 # exit replay back to realtime
./bin/tv replay trade buy                            # paper-trade in replay (buy, sell, close)
```

Date-only behavior: a bare `--from YYYY-MM-DD` is interpreted by JS as **midnight UTC**, which is 8 PM ET *the prior day*. Use `--at HH:MM` to anchor to an ET wall-clock time (09:30 = NY AM open, 13:30 = London close, etc.). TV snaps to the bar whose open is at or just before the requested instant — so `--at 09:30` on a 1m chart lands you on the 09:29 ET bar (the bar that closes *at* 09:30).

## Screenshots

```bash
./bin/tv screenshot                        # full chart, default filename
./bin/tv screenshot -r chart -o my-shot    # region: full|chart|strategy_tester
```

## Layouts

```bash
./bin/tv layout list                       # all saved layouts on your account
./bin/tv layout switch <name-or-id>        # load a saved layout
```

## Tabs

```bash
./bin/tv tab list                          # all open tradingview.com/chart tabs
./bin/tv tab new                           # open a new tab
./bin/tv tab close                         # close current tab (fails if last tab)
./bin/tv tab switch --index 0              # switch to tab by index
```

## Panes (multi-pane layouts)

```bash
./bin/tv pane list                         # panes in current layout
./bin/tv pane layout 2v                    # grid: s, 2h, 2v, 2x2, 4, 6, 8
./bin/tv pane focus --index 0              # focus pane by index
./bin/tv pane symbol --index 1 MES1!       # set symbol on a specific pane
```

## Watchlist

```bash
./bin/tv watchlist get                     # symbols in current watchlist
./bin/tv watchlist add NQ1!
```

## Pine Script editor

```bash
./bin/tv pine list                         # saved scripts on account
./bin/tv pine new                          # create blank script (positional: indicator|strategy|library)
./bin/tv pine open "My Script"             # open a saved script by name
./bin/tv pine get                          # source of currently-open script (WARN: can be 200KB+)
./bin/tv pine set -f script.pine           # load source from file
echo "indicator('hi') plot(close)" | ./bin/tv pine set    # or from stdin
./bin/tv pine compile                      # smart compile + check errors
./bin/tv pine raw-compile                  # just click the button
./bin/tv pine check -f script.pine         # server-side compile (no chart needed)
./bin/tv pine analyze -f script.pine       # offline static analysis
./bin/tv pine errors                       # current compile errors
./bin/tv pine console                      # log output
./bin/tv pine save                         # Ctrl+S
```

## Streams (JSONL, line-per-event)

Long-running. Use Ctrl+C to stop.

```bash
./bin/tv stream quote                      # ticks (OHLCV per bar)
./bin/tv stream quote -i 1000              # poll interval ms (default 300)
./bin/tv stream bars                       # last-bar updates (new bar or price change)
./bin/tv stream bar-close                  # ONE line per closed bar (1m + 5m tag). Time-aligned.
./bin/tv stream values                     # indicator values (RSI etc.)
./bin/tv stream lines -f "ICT Engine"      # Pine line.new() levels
./bin/tv stream labels -f "ICT Engine"     # Pine label.new() annotations
./bin/tv stream tables                     # Pine table.new() rows
./bin/tv stream all                        # all panes at once
```

## Analyze bundle (the big one)

`./bin/tv analyze` returns one JSON object: chart state + quote + multi-TF OHLCV + parsed ICT Engine evidence table + deterministic gates (session + 3 pillars). See [CLAUDE.md](../CLAUDE.md) for the bundle schema and the cite-or-reject discipline.

```bash
./bin/tv analyze                                                    # full multi-TF, stdout
./bin/tv analyze --out state/last-analyze.json                      # write to file
./bin/tv analyze --pillar3-only                                     # current-TF only (~0.4s)
./bin/tv analyze --pillar3-only --baseline state/baseline.json      # current-TF fresh + cached HTF
./bin/tv analyze --pair "MNQ1!,MES1!"                               # dual-symbol bundle
./bin/tv analyze --pair "MNQ1!,MES1!" --baseline state/mnq.json --baseline-secondary state/mes.json
./bin/tv analyze --scan-tf 5 --pillar3-only                         # briefly switch chart to 5m for the scan
```

`--pillar3-only` = current TF only (no chart flashing). `--baseline <path>` = reuse HTF data from a previously-captured full bundle. The pair runs both symbols.

## Trades (outcome tracking)

```bash
./bin/tv trades list                       # currently open trades
./bin/tv trades show <trade_id>            # all events for one trade
./bin/tv trades tick --session state/session/2025-05-28/ny-am --bar '{"high":30100,"low":29900,"ts":"..."}'
```

## UI automation (escape hatches)

Use sparingly — DOM-fragile across TV updates.

```bash
./bin/tv ui click -b aria-label -v "Create alert"
./bin/tv ui click -b data-name -v "panel-toggle"
./bin/tv ui click -b text -v "Add to chart"
./bin/tv ui hover -b aria-label -v "Replay"
./bin/tv ui keyboard Escape                # press a key
./bin/tv ui keyboard t --meta              # Cmd+T
./bin/tv ui keyboard a --ctrl --shift      # Ctrl+Shift+A
./bin/tv ui type "MNQ1!"                   # type text into focused input
./bin/tv ui scroll down -a 500             # scroll the chart
./bin/tv ui find "alert"                   # find elements by text/aria/css
./bin/tv ui find -s css ".chart-container" # CSS-strategy search
./bin/tv ui eval '1+1'                     # run JS in page context (sync only; promises won't await)
./bin/tv ui panel --open watchlist         # toggle a side panel
./bin/tv ui fullscreen                     # toggle fullscreen
./bin/tv ui mouse 800 400                  # click at x,y
./bin/tv ui mouse 800 400 --right          # right-click
./bin/tv ui mouse 800 400 --double         # double-click
```

## TUI dashboard

```bash
make dash                                  # build the Go binary (one-time)
./bin/tv dash                              # live oversight TUI in a separate terminal
```

Quit with `q` / `Esc` / `Ctrl-C`. Reads from disk only — never touches CDP.

---

## Notes

- All commands speak CDP to port 9225 (TradingView Desktop's debug port). If TradingView Desktop is closed, every command errors with `CDP connection failed`. Start it first.
- `tv ui eval` is **synchronous** — returned promises are not awaited. For async fetch tests, write the result to `window.__foo` and read it back in a second eval call.
- `tv pine get` can return 200KB+ for complex scripts. Avoid unless you intend to edit.
- File output: pass `--out <path>` to `tv analyze` for bundles too large to pipe.
- All scripts respect `state/` as the only writable location. Never read or write `~/.tradingview-mcp/`.
