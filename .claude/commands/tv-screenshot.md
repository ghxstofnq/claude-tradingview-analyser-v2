# /tv-screenshot — capture a chart screenshot (VERIFICATION ONLY)

## Command
- `./bin/tv screenshot -r full | chart | strategy_tester [-o <name>]` → writes a PNG under
  `state/screenshots/`.

## HARD CONSTRAINT (CLAUDE.md #5) — read this every time
Screenshots are for **verification and tests ONLY**. They must **NEVER** feed analysis or
grading. Multimodal LLMs can answer correctly while barely using the image, so a screenshot
risks visual hallucination — read the deterministic Pine evidence table instead (**/tv-data**).

Legitimate uses: confirming a deploy's on-chart visuals after /deploy-pine, a test artifact,
or showing the user the current chart state. Never include a screenshot in an /analyze bundle,
an oracle grade, or any decision input.
