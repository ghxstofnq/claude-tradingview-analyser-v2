# /tv-alerts — create / list / delete TradingView price alerts

Manage price alerts on TV Desktop (CDP 9225) via `./bin/tv`. Alerts are read-only signals — never
a substitute for placing/testing orders.

## Commands
- `./bin/tv alert list` — current alerts.
- `./bin/tv alert create -p <price> -c <crossing|greater_than|less_than>` — `condition` defaults to
  `crossing`.
- `./bin/tv alert delete <id>` — remove one.

## Gotcha — the create REST call (do not "fix" it)
`create` POSTs to `https://pricealerts.tradingview.com/create_alert` from the page context (TV's
cookies ride along — the same endpoint TV's own "Create alert" button hits, found via a
fetch-interceptor probe). **Do NOT set `Content-Type: application/json`.** TV's UI omits it, which
makes the request a "simple" CORS request (body sent as `text/plain`, no preflight). Setting the
header triggers a CORS preflight that TV's server rejects, surfacing as `TypeError: Failed to fetch`.
The server parses the body as JSON regardless of the header. (Handled in `packages/core/alerts.js` —
don't reintroduce the header.)

## Notes
- `delete` is DOM-verified (TV Web has no matching delete REST), so the editor/alerts UI must be
  reachable.
- Do NOT place trades (paper or live) to "test" anything — the user places orders; verify with
  unit tests / read-only inspection ([[never-place-trades-to-test]]).
