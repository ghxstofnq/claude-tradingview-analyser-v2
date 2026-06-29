import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The human-facing /analyze slash command must not ship the dead phase blocks
// that were removed from the app prompt: pre_session was replaced by the brief
// turn, and entry_hunt_legacy_DISABLED is the pre-detector workflow kept off.
const cmd = readFileSync(
  fileURLToPath(new URL("../.claude/commands/analyze.md", import.meta.url)),
  "utf8",
);

test("/analyze command has no dead phase blocks", () => {
  assert.doesNotMatch(cmd, /<phase name="pre_session">/, "ships dead pre_session block");
  assert.doesNotMatch(cmd, /<phase name="entry_hunt_legacy_DISABLED">/, "ships dead entry_hunt_legacy_DISABLED block");
});
