// Copy-contract tests (Task C2): safety-relevant UI text must match the actual
// mode + data, and the misleading literals must not creep back in. These assert
// both the pure copy helper AND the absence of the specific removed literals in
// the shell page sources.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { liveFooterCopy } from "../app/renderer/src/Live.helpers.js";
import { READINESS_ROW_META } from "../app/renderer/src/Readiness.helpers.js";
import { READINESS_ROW_IDS } from "../app/main/readiness.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

test("liveFooterCopy is mode-aware — AUTO never claims accept is required", () => {
  const auto = liveFooterCopy("auto");
  assert.match(auto, /AUTO/i);
  assert.match(auto, /automatically|without/i);
  assert.doesNotMatch(auto, /only after your accept/i, "AUTO must not say it fires only after accept");

  const manual = liveFooterCopy("manual");
  assert.match(manual, /accept/i);
  const suggest = liveFooterCopy("suggest");
  assert.match(suggest, /accept/i);

  // Unknown / missing mode falls back to the conservative manual copy.
  assert.equal(liveFooterCopy(undefined), liveFooterCopy("manual"));
  assert.equal(liveFooterCopy("bogus"), liveFooterCopy("manual"));
});

test("LivePage no longer hardcodes the misleading accept-only footer literal", () => {
  const src = read("app/renderer/src/shell/pages/LivePage.jsx");
  assert.doesNotMatch(src, /✓ fires only after your accept/, "the hardcoded footer literal must be gone");
  assert.match(src, /liveFooterCopy\(mode\)/, "footer must render mode-aware copy");
});

test("SystemPage IPC bridge row is a real probe, not a hardcoded ok literal", () => {
  const src = read("app/renderer/src/shell/pages/SystemPage.jsx");
  assert.doesNotMatch(src, /name="IPC bridge" value="ok"/, "IPC bridge must not be a hardcoded ok");
  assert.match(src, /_recv_at/, "IPC bridge must probe the real health round-trip timestamp");
});

test("SettingsPage risk sizing does not present the example stop as current risk", () => {
  const src = read("app/renderer/src/shell/pages/SettingsPage.jsx");
  // The old bare `const stopPts = 24.25;` fed the current-risk line — it must go.
  assert.doesNotMatch(src, /const stopPts = 24\.25;/, "bare current-risk stopPts literal must be gone");
  // The illustrative branch must be explicitly labelled as an example.
  assert.match(src, /EXAMPLE \(not current risk\)/, "the fallback must be labelled as an example");
  assert.match(src, /orderPreview/, "settings must prefer the real order preview");
});

test("readiness row ids stay in lock-step across main + renderer", () => {
  const rendererIds = READINESS_ROW_META.map((m) => m.id);
  assert.deepEqual(rendererIds, [...READINESS_ROW_IDS], "renderer row meta must match the reducer's rows exactly");
});

test("no shell page reintroduces a hardcoded green status literal without a source", () => {
  // Guard against the exact regressions C2 removed: a literal ok/connected value
  // paired with a green tone but no live source behind it.
  for (const p of [
    "app/renderer/src/shell/pages/SystemPage.jsx",
    "app/renderer/src/shell/pages/SettingsPage.jsx",
    "app/renderer/src/shell/pages/LivePage.jsx",
  ]) {
    const src = read(p);
    assert.doesNotMatch(src, /tone="ok"\s+name="[^"]+"\s+value="(ok|connected|healthy)"/,
      `${p} must not hardcode a green status value`);
  }
});
