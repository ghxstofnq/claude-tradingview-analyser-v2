#!/usr/bin/env node
// Compares tests/.tmp-prompt-snapshots/<purpose>.txt (OLD composed prompts,
// captured by scripts/snapshot-prompts.js before the kernel split) against
// the NEW live loadSystemPrompt(purpose) output. Reports per-purpose trigram
// overlap. Acceptance: ≥80% (chat/review/wrap legitimately drop ~90% of
// content; trigram overlap measures "did every 3-char window in the new
// prompt come verbatim from the old prompt?" — i.e. no fabrication).
//
// Run AFTER the kernel split is in place. The snapshot files should already
// exist on disk from scripts/snapshot-prompts.js (run pre-split).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";
import { joinSystemPrompt } from "../app/main/prompt-composer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.resolve(__dirname, "..", "tests", ".tmp-prompt-snapshots");

const PURPOSES = ["chat", "review", "wrap", "brief", "bar-close", "catch-up"];

function overlapPercent(newText, oldText) {
  // For each 3-char window in `newText`, check whether it appears in `oldText`.
  // Robust to whitespace + reordering; cheap to compute.
  if (!newText.length || !oldText.length) return 0;
  const tris = new Set();
  for (let i = 0; i < oldText.length - 2; i++) tris.add(oldText.slice(i, i + 3));
  let hits = 0;
  let total = 0;
  for (let i = 0; i < newText.length - 2; i++) {
    total++;
    if (tris.has(newText.slice(i, i + 3))) hits++;
  }
  return (hits / total) * 100;
}

async function main() {
  console.log("purpose      | OLD chars | NEW chars | delta    | trigram overlap");
  console.log("-------------+-----------+-----------+----------+----------------");
  let allPass = true;
  for (const purpose of PURPOSES) {
    const oldPath = path.join(SNAPSHOT_DIR, `${purpose}.txt`);
    const oldText = await fs.readFile(oldPath, "utf8");
    const newText = joinSystemPrompt(await loadSystemPrompt(purpose));
    const overlap = overlapPercent(newText, oldText);
    const delta = newText.length - oldText.length;
    const sign = delta >= 0 ? "+" : "";
    const ok = overlap >= 80;
    if (!ok) allPass = false;
    console.log(
      `${purpose.padEnd(12)} | ${String(oldText.length).padStart(9)} | ${String(newText.length).padStart(9)} | ${(sign + delta).padStart(8)} | ${overlap.toFixed(1)}%${ok ? "" : " ← below 80%"}`
    );
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
