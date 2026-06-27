# /tv-layout — layouts, panes, and tabs

Manage the chart workspace (TV Desktop, CDP 9225) via `./bin/tv`.

## Layouts
- `./bin/tv layout list` — saved layouts.
- `./bin/tv layout switch <name|id>` — switch layout.

## Panes (multi-chart grid in one layout)
- `./bin/tv pane list` — panes in the current layout.
- `./bin/tv pane layout <s | 2h | 2v | 2x2 | 4 | 6 | 8>` — set the grid.
- `./bin/tv pane focus <index>` — focus a pane.
- `./bin/tv pane symbol --index <i> --symbol <SYM>` — set a pane's symbol.
- For **MES + MNQ side-by-side** (SMT), use a `2v`/`2h` grid, one symbol per pane.

## Tabs
- `./bin/tv tab list | new | close | switch <index>`.

## Persistence + caution
- Layout changes (panes, studies) only **durably persist** when the layout is saved
  (`saveChartToServer()`); a page reload restores the last saved layout. This is the same
  mechanism behind the engine-revert trap — see /deploy-pine.
- Analysis / replay / Pine all run on the single TV Desktop chart (9225). Don't reconfigure the
  user's working layout without a reason, and restore it when done.
