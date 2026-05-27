# Webview Migration — Design Spec

**Date:** 2026-05-27
**Status:** Approved (brainstorm) — pending spec review and writing-plans handoff
**Driver:** unlock the future Backtest page (paused brainstorm) by retiring the standalone TradingView Desktop dependency, and gain design freedom for charts rendered inside the app.

## Goal

Migrate the project's TradingView analysis surface from the standalone **TradingView Desktop app** (CDP port 9223) to the **in-app `<webview>`** that already exists in [TvChart.jsx](app/renderer/src/TvChart.jsx). After this migration, the in-app webview becomes the single TradingView surface for `claude-tradingview-analyser`: it's what the LLM analyzes, what the trader executes from, and what future features (Backtest) drive.

## Background — why this matters

- **One shared backend.** Today, the analysis pipeline talks to one TradingView instance (Desktop on 9223) while the user's eyes are partly on another (the embedded webview, currently visual-only). Two surfaces, one source of truth. User wants one.
- **Design freedom.** The future Backtest page needs to drive its own chart that the user can see inside the app. Routing that chart through the embedded webview (instead of the external Desktop app) means the dashboard layout is free to evolve.
- **Architectural simplification.** Retires the TV Desktop dependency, removes the auto-launch helper, simplifies the "two TV apps running" mental model.

User-verified preconditions:
- ✅ Broker connection works in TradingView Web (the webview surface).
- ✅ The user's saved layout + ICT Engine indicator load inside the webview after sign-in.

## Current architecture

```
Electron app  ──(spawns)──>  ./bin/tv subprocesses  ──(CDP)──>  TV Desktop on :9223
                                                                  (separate native process)
            ┌─ in-app webview at tradingview.com  ◄── display only, nothing reads from it
```

**Hard dependencies on port 9223** (verified by grep):
- `packages/core/connection.js:6` — `const CDP_PORT = 9223;` (hardcoded)
- `packages/core/tab.js:8` — same constant
- `packages/core/health.js` — TV Desktop auto-launch helper (spawns `TradingView --remote-debugging-port=9223`)
- All `./bin/tv <subcommand>` modules in `cli/commands/*.js` go through this
- `app/main/bar-close.js` spawns `./bin/tv stream bar-close` (which uses the CDP layer)

**TradingView JavaScript surfaces used** (verified by grep — same in Desktop and Web):
- `window.TradingViewApi._activeChartWidgetWV` — active chart widget
- `window.TradingViewApi._chartWidgetCollection` — for multi-pane
- `window.TradingViewApi._replayApi` — replay engine
- `window.TradingViewApi._alertService` — alerts
- `window.TradingViewApi.getSavedCharts` — layouts
- `window.TradingViewApi.searchSymbols` — symbol search
- `window.TradingView.bottomWidgetBar` — order panel

## Target architecture

```
Electron app  ──(spawns)──>  ./bin/tv subprocesses  ──(CDP)──>  Electron debug port :9223
              │                                                     │
              └──>  in-app webview at tradingview.com  ◄─────────────┘
                    (now the analysis target AND the trade execution surface)

TV Desktop:   not running by default. Installed but dormant. User can manually launch
              it for emergencies — CLI works against whichever process owns port 9223.
```

**Why this works without rewriting the CLI:**
The CLI's tab-discovery in [tab.js:18](packages/core/tab.js:18) already filters by URL pattern:
```js
.filter(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
```
When Electron exposes port 9223, the webview's CDP target appears in `/json/list`. The CLI's existing filter picks it up automatically. No packages/core rewrite needed.

## Design — three sections

### Section 1 — Code change (the migration itself)

**Add to `electron-main.js`** (one new line, near the top):
```js
import { app } from "electron";
app.commandLine.appendSwitch("remote-debugging-port", "9223");
```

This must run before `app.whenReady()`. It exposes the Electron process (including all webviews) over CDP on port 9223.

**Remove from `packages/core/health.js`:**
- The `launchTradingView` helper that spawns the Desktop binary with `--remote-debugging-port=9223`
- The platform-specific candidate-paths lookup that finds the Desktop app

**Update `packages/core/tab.js:62-63`:** the error message currently says "Use tv_launch to restart TradingView instead" — but `tv_launch` is not a CLI command (it's an MCP tool name the CLI shouldn't reference per CLAUDE.md constraint #2). Replace with a sensible suggestion like "Open a new tab in the in-app webview (Cmd+T while focused on the chart pane)."

**Update `package.json:6` description** — remove the "locked to CDP 9223" framing, since the architecture is now port-9223-via-Electron, not port-9223-of-TV-Desktop.

**Update `CLAUDE.md` hard constraint #1** — change wording from "CDP port 9223 only. Never 9222" to "Default backend is the in-app webview on Electron's debug port 9223. TV Desktop on 9223 is a manual fallback only — do not auto-launch it."

**Add an architecture decision row** to the CLAUDE.md table documenting this migration with the date and the migration commit.

### Section 2 — One-time user setup

After the code change ships, the user does this **once** inside the in-app webview (login persists across app restarts via `partition="persist:tradingview"`):

1. Sign in to TradingView inside the webview.
2. Load the saved layout from the Layouts menu (synced from the TradingView account).
3. Verify ICT Engine is on the chart (add from Indicators menu if missing).
4. Set this layout as the default.
5. Restart the app once; confirm the layout loads cleanly with the indicator visible.

**Already verified by the user.** This section is documented for the next person who runs the setup (e.g., on a new machine).

**Does not auto-migrate:**
- Drawings saved on Desktop charts — re-create in the webview if needed (or copy via Layout duplication).
- Alerts — TradingView alerts are account-scoped and should appear identically. Verify as part of the smoke test.
- Broker connection — re-authenticated automatically on first webview load (user confirmed working).

### Section 3 — Verification + rollback

**Verification plan, run in order:**

1. **Capture a baseline bundle on TV Desktop NOW** (before the migration commit lands):
   ```bash
   ./bin/tv analyze --out tests/migration/desktop-baseline.json
   ```
   Commit this file to the migration branch as a frozen reference.
2. **Apply the migration** to the feature branch.
3. **Capture an identical bundle on the webview:**
   ```bash
   ./bin/tv analyze --out tests/migration/webview-baseline.json
   ```
4. **Compare the two bundles** with a new `scripts/diff-bundle.js`. Acceptance: schema identical; every numeric field within 0.25pt (TV web↔desktop quote precision tolerance). Any structural difference (missing field, renamed key, different array length) is a fail.
5. **Run `npm run smoke:fixtures`** — must still pass 16/16.
6. **Run `npm test`** — must still pass (with the pre-existing `tvAlertCreate` failure unchanged).
7. **Run one full live session on the new backend** — NY AM or NY PM. Watch bar-close detector, brief, open-reaction, entry-hunt, wrap. Confirm the session completes end-to-end without thrown errors and the surfaces look right. The session is not required to produce actual setups — just to run cleanly through every phase.
8. **Manual probes of risk areas:**
   - **Alerts** — arm a bell on a level via the PREP panel, verify it fires when price reaches it.
   - **Replay** — `./bin/tv replay start --from <date>` works against the webview.
   - **Drawings** — `./bin/tv draw shape` renders correctly inside the webview.
   - **Multi-tab** — `./bin/tv tab list` / `tab switch` work if multiple tradingview.com chart tabs are open in the webview.

**Rollback plan:**

The change is one switch in `electron-main.js` plus a small deletion in `packages/core/health.js`. To roll back:
1. `git revert <migration-commit>`
2. Relaunch TV Desktop manually with `--remote-debugging-port=9223`
3. The CLI finds TV Desktop on 9223 as it always did

Zero state migration. Nothing on disk changes. Both backends consume the same `state/` files identically.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Webview↔Desktop quote precision drift (>0.25pt difference) on `quote.last` | Medium | Bundle diff (verification step 4) catches it. If real, investigate TV data-feed differences; may need wider tolerance on a per-field basis. |
| ICT Engine indicator emits on slight delay on first webview load → detector sees one stale bundle | Low | Acceptable if recoverable. Detector already handles `gates.engine.meta.stale === true` via wait-state. Verify on first session. |
| Webview's CDP target isn't discoverable via existing URL filter (e.g., URL renders differently than expected) | Low | Manual `curl http://localhost:9223/json/list` during verification step 3 confirms the target appears. If URL pattern differs, tweak `tab.js:18` filter. |
| Webview process model — Electron webviews live in a separate renderer process from the main window. Need to confirm CDP exposes the webview's process, not the main app's. | Low | Verification step 4 (the bundle diff) is the test. If we can capture a bundle, the model works. |
| Alert plumbing breaks (`app/main/alerts.js` talks to TV via CDP) | Low | Verification step 8a — fire an alert end-to-end. |

## Out of scope (deliberately)

- **The Backtest page.** Paused brainstorm; resumes after this migration ships and is verified. Decisions already captured for that brainstorm:
  - Engine: full pipeline, LLM in the loop
  - Scope: one session per run (NY AM / NY PM / London)
  - Trade decision: two modes — auto-accept + pause-on-surface
  - Layout: pending (was the open question when we paused)
- **Replacing the CLI's CDP transport with an IPC bridge.** Briefly considered; not needed — keeping CDP semantics gives us the existing CLI ~unchanged.
- **Multi-tab management improvements.** Out of scope. If multiple tradingview.com chart tabs are open in the webview, the existing `tab list` / `tab switch` semantics apply.
- **Mobile / packaged-app distribution concerns.** Out of scope.

## Acceptance criteria

The migration ships when ALL of the following pass:

- [ ] `npm run smoke:fixtures` returns 16/16
- [ ] `npm test` returns clean (modulo pre-existing `tvAlertCreate` failure)
- [ ] Bundle diff between Desktop baseline and webview baseline shows schema-identical and prices within 0.25pt across all numeric fields
- [ ] One full live session (NY AM or NY PM) runs end-to-end on the webview backend with no thrown errors
- [ ] All four manual probes (alerts / replay / drawings / multi-tab) pass
- [ ] CLAUDE.md updated: hard constraint #1 reworded + decision row added
- [ ] PR ships with: the code change, the diff-bundle script, the migration baseline files (in `tests/migration/`), and updated docs

## Repo conventions reminders (from CLAUDE.md)

- Feature branch + PR. Never push to main.
- Conventional Commits: `feat: / fix: / docs: / chore: / refactor: / test:`
- Stage files by name. No `git add -A`.
- Co-author tag: `Co-Authored-By: Claude <noreply@anthropic.com>`
- Never `--no-verify`, `--force`, `--amend` without explicit ask.
