# /tv-indicators — add / remove / configure chart studies

Manage indicators on the chart (TV Desktop, CDP 9225) via `./bin/tv`. NOT for deploying the ICT
Engine — that's **/deploy-pine** (this skill is for other studies / cleanup).

## Commands
- `./bin/tv indicator add "<Full Name>" [-i '<json inputs>']` — **use FULL names**
  ("Relative Strength Index", not "RSI"). Returns the new entity id + `new_study_count`.
- `./bin/tv indicator remove <entity_id>` — remove by id. Get ids from `getAllStudies()` or the
  study list in `tv data tables`.
- `./bin/tv indicator toggle <id> --visible | --hidden` — show/hide.
- `./bin/tv indicator set <id> -i '{"length":50}'` — change inputs.
- `./bin/tv indicator get <id>` — info + current inputs.

## The engine + duplicate cleanup
- The ICT Engine is the system's ONLY data source — never remove it without a replacement, and
  never `add` a new version this way (use /deploy-pine).
- If `getAllStudies()` filtered to `/ICT Engine/i` shows **more than one**, that's the duplicate
  trap — remove the stale id and confirm exactly one study emits **schema 4** (run /tv-health).
- `chart.symbol()` is exchange-prefixed (`CME_MINI:MES1!`) — strip `^[A-Z_]+:` when matching.
