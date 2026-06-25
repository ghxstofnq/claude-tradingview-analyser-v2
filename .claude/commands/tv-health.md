# /tv-health — preflight TradingView before any analysis / replay / deploy

Run this FIRST, before trusting any read from the chart. The 2026-06-22 session burned
~30 min because the on-chart engine had silently reverted to schema-2 and nothing checked.
A page reload (every replay / record-tape) restores the engine from the saved layout, so
re-run this after any reload. All commands `./bin/tv` (CLI only). TV Desktop on CDP 9225.

## Checks — all must pass
1. **CDP reachable:** `curl -s --max-time 4 http://127.0.0.1:9225/json/version` returns JSON.
   If not, relaunch TV Desktop:
   `osascript -e 'quit app "TradingView"'` then `open -a TradingView --args --remote-debugging-port=9225`.
2. **CLI connected:** `./bin/tv status` → success.
3. **Correct engine on chart (the one that bites):** read `getAllStudies()` filtered to
   `/ICT Engine/i` — expect **exactly one** study named **"ICT Engine V5"**. Parse its table
   (`parseIctEngineTable(findIctEngineRows(data.getPineTables()))`) and confirm
   **`meta.schema === 4`** AND a `structures[]` row carries **`disp_pts`** (proves the live
   schema-4 code, not a stale schema-2 instance). Two studies, wrong name, or schema≠4 → the
   reads are wrong; fix via **/deploy-pine** (Persistence section) before continuing.
4. **Extended hours locked:** `chart.getState().session === "extended"` (overnight Asia/London
   only exists in ETH). If not, `chart.setExtendedHours(true)`.
5. **Live readiness (only before MNQ/MES trading):** `./bin/tv live-check --session <s>` →
   no blockers.

## Why it matters
The on-chart study is the system's ONLY data source. It can revert to old code on a reload
without any error — checks 3+4 catch that. A green check 3 is the difference between grading
on the faithful engine and silently grading on stale schema-2 evidence.

Related: [[deploy-pine-persistence-gotcha]], [[worktree-shared-core-symlink]].
