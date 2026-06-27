# /tv-drawings — draw / list / clear shapes on the chart

Mark levels and zones on the chart (TV Desktop, CDP 9225) for verification or to show the user —
a display aid, NOT analysis input (the Pine evidence table is the source of truth).

## Commands
- `./bin/tv draw shape -t horizontal_line -p <price>` — a level line.
- `./bin/tv draw shape -t trend_line -p <p1> --time <t1> --price2 <p2> --time2 <t2>` — a line.
- `./bin/tv draw shape -t rectangle -p <p1> --time <t1> --price2 <p2> --time2 <t2>` — a zone box.
- `./bin/tv draw shape -t text -p <price> --time <t> --text "..."` — a text label.
- `--overrides '<json>'` — style overrides on any shape.
- `./bin/tv draw list` · `draw get <id>` · `draw remove <id>` · `draw clear` (removes **ALL** drawings).

## Notes
- Times are **unix seconds**.
- `draw clear` is destructive (wipes every drawing) — prefer `remove <id>` unless you mean all.
- Don't clutter the user's chart; clean up verification drawings when done.
