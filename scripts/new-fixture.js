#!/usr/bin/env node
/**
 * new-fixture.js — scaffold a new regression fixture: pick the next id,
 * capture the current chart with `tv analyze`, and write an expected.md
 * template for hand-grading.
 *
 * Usage: npm run fixture:new -- <label>
 *   e.g. npm run fixture:new -- ny-open-mss
 *
 * Exit codes: 0 ok, 2 usage error, 1 capture failed.
 */
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const FIXTURES = 'tests/fixtures';

/** Next zero-padded fixture id given the existing fixture filenames. */
export function nextFixtureId(existingFiles) {
  const ids = existingFiles
    .map((f) => f.match(/^(\d+)-/))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const max = ids.length ? Math.max(...ids) : 0;
  return String(max + 1).padStart(3, '0');
}

function expectedTemplate(id, label) {
  return `# Fixture ${id} — Expected Analysis (${label})

**Bundle:** \`${id}-${label}.bundle.json\`
**Chart:** <symbol> @ <resolution>
**Bundle time:** <gates.session.timestamp_et>
**Session label:** <gates.session.label>

**Note to reviewer:** hand-grade this with \`docs/strategy/trading-strategy-2026.md §7\`.
Cite every price as \`<price> (<json.path>)\`. Delete this note when graded.

---

## Pillar 1 — Draw & Bias
TODO

## Pillar 2 — Price Action Quality
TODO

## Pillar 3 — Entry Model + Confirmation
TODO

## Grade
TODO

---

## Structured output

\`\`\`json
{
  "pillar1": { "htf_bias": null, "htf_draw": null, "overnight": null, "ny_reaction": null },
  "pillar2": { "range_acceptable": null, "displacement_present": null, "candle_quality": null, "verdict": null },
  "pillar3": { "entry_model": null, "confirmation_status": null },
  "trade": { "entry": null, "stop": null, "target_tp1": null, "target_tp2": null, "invalidation": null },
  "grade": null
}
\`\`\`
`;
}

function main() {
  const label = process.argv[2];
  if (!label || !/^[a-z0-9-]+$/.test(label)) {
    console.error('usage: npm run fixture:new -- <label>   (lower-case, digits, hyphens)');
    process.exit(2);
  }
  const id = nextFixtureId(readdirSync(FIXTURES));
  const bundlePath = join(FIXTURES, `${id}-${label}.bundle.json`);
  const expectedPath = join(FIXTURES, `${id}-${label}.expected.md`);

  console.log(`Capturing ${bundlePath} ...`);
  const res = spawnSync('./bin/tv', ['analyze', '--out', bundlePath], { stdio: 'inherit' });
  if (res.status !== 0 || !existsSync(bundlePath)) {
    console.error('capture failed — is TradingView Desktop running on CDP 9223?');
    process.exit(1);
  }
  writeFileSync(expectedPath, expectedTemplate(id, label));
  console.log(`Wrote ${expectedPath} — hand-grade it, then run: npm run smoke:fixtures`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
