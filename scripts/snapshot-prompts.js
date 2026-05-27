#!/usr/bin/env node
// One-shot: render loadSystemPrompt(purpose) for each purpose against the
// CURRENT code and write the output to tests/.tmp-prompt-snapshots/<purpose>.txt.
// Used as the baseline for diff-prompt-shape.js after the kernel split.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "tests", ".tmp-prompt-snapshots");

const PURPOSES = ["chat", "review", "wrap", "brief", "bar-close", "catch-up"];

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const purpose of PURPOSES) {
    const prompt = await loadSystemPrompt(purpose);
    const outPath = path.join(OUT_DIR, `${purpose}.txt`);
    await fs.writeFile(outPath, prompt, "utf8");
    console.log(`wrote ${outPath} (${prompt.length} chars)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
