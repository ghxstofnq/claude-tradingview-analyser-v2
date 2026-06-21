# /deploy-pine — deploy a Pine engine change to the live on-chart study

Run this EVERY time you edit `pine/ict-engine.pine` (or any on-chart Pine script) and the live chart must run it. The on-chart study is the system's ONLY data source — a botched deploy can blind it (see CLAUDE.md decisions row 2026-06-21 "Pine deploy — the CORRECT procedure"). The CLI now does the right thing (`tv pine compile` clicks "Update on chart"); this skill's job is to never skip the verify, and to recover cleanly if it didn't land.

All commands are `./bin/tv` (CLI only — never MCP). TV Desktop on CDP 9225.

## Preconditions
- TV Desktop reachable: `curl -s --max-time 4 http://127.0.0.1:9225/json/version` returns JSON.
- Markets CLOSED or no live session active — the deploy re-runs the indicator.
- Source compiles: `./bin/tv pine check --file pine/ict-engine.pine` → `"compiled": true, "error_count": 0`. Fix errors before deploying.
- Record the baseline: `./bin/tv pine list` count, and `./bin/tv data tables | grep -c "ICT ENGINE"` (study count) — you'll compare after.

## Deploy (in order — the verify is not optional)
1. **Open + confirm linked.** `./bin/tv pine open "ICT Engine"` MUST return `"success": true`. If it fails, it now retries 3×; if it STILL fails, STOP — proceeding leaves the editor unlinked from the on-chart script, so set/save hit a disconnected buffer and `save` spawns a duplicate SAVED script.
2. **Set the new source.** `./bin/tv pine set --file pine/ict-engine.pine` → `"success": true`, `lines_set` matches the file.
3. **Apply.** `./bin/tv pine compile` → expect `"button_clicked": "Update on chart"` (or "Save and add to chart") and `"study_added": false`. If it reports `"Add to chart"` or `"study_added": true`, you duplicated → go to **Recovery**.
4. **Save.** `./bin/tv pine save` → `"action": "Ctrl+S_dispatched"` (in-place). `"saved_with_dialog"` means the editor was UNLINKED and you just created a duplicate saved script → go to **Recovery** and clean up the duplicate by hand.

## Verify (mandatory — this is the step that's been skipped before)
Wait a few seconds for the indicator to recompute, then:
- **New field KEYS present.** `./bin/tv data tables --study-filter "ICT Engine"` and grep the changed/added field's KEY (e.g. `c1o=`), NOT a numeric value. New fields read `NaN` on zones formed BEFORE the reload — only zones formed after get real values, so verify by key presence, never by a number.
- **Exactly one study.** `./bin/tv data tables | grep -c "ICT ENGINE"` → `1`.
- **No new saved script.** `./bin/tv pine list` count unchanged from baseline.

If all three pass, you're done.

## Recovery (Update-on-chart didn't apply, or you duplicated the study)
1. Get study ids — evaluate `window.TradingViewApi._activeChartWidgetWV.value().getAllStudies()` (a small node script importing `packages/core/connection.js`'s `evaluate`) → `[{id,name},...]`.
2. Click the add button — evaluate: click `button[title="Add to chart"]` (visible). It adds a fresh instance with the editor's current (new) code.
3. Confirm the NEW instance emits the new field keys (`tv data tables`), then `./bin/tv indicator remove <old-id>` for the stale one.
4. Re-verify: 1 study, new keys present.

## Notes
- There is NO CLI to delete a SAVED script. A duplicate saved script from a botched save (e.g. a second "ICT Engine V3") is harmless to the running system (the on-chart study uses the original), but must be deleted by hand in TV's Pine script list if you want it gone.
- TV labels its editor buttons via the `title` ATTRIBUTE, not textContent — this is why the old tooling missed them; don't reintroduce textContent-only button searches.
