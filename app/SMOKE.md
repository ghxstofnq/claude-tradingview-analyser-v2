# Trading Workstation — dev-mode smoke checklist

Run from the repo root:

```bash
cd app && npm run dev
```

## Pre-launch

- [ ] TradingView Desktop is running with `--remote-debugging-port=9223` (this is the analysis target — separate from the in-app webview).
- [ ] You're signed into Claude Code locally (`claude --version` returns ok).

## Window + chrome

- [ ] Window opens at ~1440×900 dark theme.
- [ ] Top bar shows: identity, mode switch (PREP / LIVE / REVIEW), symbol switcher, ET clock, phase pill, killzone pill, ALERTS chip, LOOP pill, theme toggle.
- [ ] Cmd/Ctrl + 1 / 2 / 3 flips modes from the keyboard.
- [ ] Pressing `/` focuses the chat input.

## PREP

- [ ] Boots into PREP. Morning Brief panels render (HTF bias, overnight context, key levels, pre-session grade, Claude's plan).
- [ ] Clicking the ○ bell on a key level → arms an alert (verify with `./bin/tv alert list` in a separate terminal).

## LIVE — chat

- [ ] Chart pane shows the TradingView webview pointing at tradingview.com (signed in, broker-connected).
- [ ] Type a question in the `> ask claude...` input → Claude streams a reply chunk by chunk.
- [ ] Ask: *"Run a full analysis and surface a setup if you see one."*
  - [ ] Claude calls `tv_analyze_full`, reasons in prose, cites prices with JSON paths.
  - [ ] At the end of the turn, calls either `surface_setup` or `surface_no_trade`.
  - [ ] UI flips from `[ WATCHING ]` to either a setup card or `[ NO-TRADE ]` with the reason.

## LIVE — trade tracking

- [ ] When a setup card is up, click **[ ACCEPT ]**.
  - [ ] Card flips to a taken-trade card with sizing displayed.
  - [ ] `state/session/<today>/<session>/trades.jsonl` contains a new `accept` line.
- [ ] Click **[ REJECT ]** on a setup → setup disappears; a `reject` line is appended.

## LIVE — live loop (market hours only)

- [ ] Bar-close detector spawns on mode → live (terminal: `[bar-close] spawning detector`).
- [ ] Per-bar reads stream into the chat feed automatically.
- [ ] Taken trades update their outcome (TP1 HIT / STOPPED / etc.) as bars close.
- [ ] Loop pill: green when keeping up, yellow when lagging, red if detector dies.

## Alerts

- [ ] Click a price in Claude's prose (italic `<em>`) → arms an alert at that price.
- [ ] In TradingView's alert panel, manually trigger one → toast pops within 5s, ALERTS chip count increments, AlertsPopover shows the fire.

## REVIEW

- [ ] Switch to REVIEW. Mock session journal renders (REVIEW mode itself is deferred past v1 — UI is in place, real data wiring is next major phase).

## Quit + relaunch

- [ ] Quit (Cmd+Q), `npm run dev` again.
- [ ] TradingView webview stays logged in (persistent partition).
- [ ] No crash on launch.

## Known v1 gaps (by design)

- REVIEW mode renders mock data only.
- Outcome ticker requires the bar-close detector → markets open.
- Disarming a locally-tracked alert does not delete the TradingView alert.
- No packaging / DMG — runs from source.
- Broker reconciler not in v1.
