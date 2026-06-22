# /tv-data — read price, bars, indicator values, and Pine evidence

Read from the chart (TV Desktop, CDP 9225) via `./bin/tv`. For a full multi-TF analysis bundle
use **/analyze** (wraps all of this + gates); use this skill for targeted reads.

## Commands
- `./bin/tv quote` — real-time `{last, ohlc, volume, time}`.
- `./bin/tv ohlcv -n <count> [-s]` — bars. **ALWAYS pass `-s/--summary`** unless you truly need
  every bar (raw output is huge). Max 500.
- `./bin/tv values` — current data-window values of visible indicators.
- `./bin/tv data tables -f "ICT Engine"` — the engine's evidence table (rows of `type | k=v|...`).
  Also `data lines|labels|boxes -f <study>` for line/label/box outputs, and
  `data strategy|trades|equity|depth`. **Always `-f/--filter`** to target one study.

## The engine evidence table
- Parse: `parseIctEngineTable(findIctEngineRows(data.getPineTables()))` → schema-4 object
  (`levels, sweeps, fvgs, bprs, swings, structures, quality`, incl. `overnight_dir`,
  `or_high/low`, `regime`, `range_vs_normal`, per-structure `disp_pts`, per-zone `wick_tapped`).
- **Confirm `meta.schema === 4`** before trusting it — a stale schema-2 read means the wrong
  engine is live (run /tv-health).

## Discipline (CLAUDE.md — non-negotiable)
- **Cite-or-reject (#6):** every price in any analysis cites a real JSON path —
  `29172.75 (quote.last)`, `29302.75 (engine.fvgs[2].top)`. No rounded/approximate prices.
- **No LLM arithmetic (#7):** distances, R:R, ATR, ranges are computed in code and live in the
  JSON. Read numbers; never produce one.
- **Screenshots never feed analysis (#5):** read the evidence table, not an image.
