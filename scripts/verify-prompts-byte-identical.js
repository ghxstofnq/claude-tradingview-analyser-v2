#!/usr/bin/env node
// Compares the live loadSystemPrompt(purpose) output against the baseline
// snapshots in tests/.tmp-prompt-snapshots/. Exits 0 if every purpose is
// byte-identical; exits 1 listing any mismatches. Use after each partial
// extraction task to confirm loss-free.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";
import { joinSystemPrompt } from "../app/main/prompt-composer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.resolve(__dirname, "..", "tests", ".tmp-prompt-snapshots");
const PURPOSES = ["chat", "review", "wrap", "brief", "bar-close", "catch-up"];

async function main() {
  let allOk = true;
  for (const purpose of PURPOSES) {
    const oldPath = path.join(SNAPSHOT_DIR, `${purpose}.txt`);
    const oldText = await fs.readFile(oldPath, "utf8");
    const newText = joinSystemPrompt(await loadSystemPrompt(purpose));
    if (newText === oldText) {
      console.log(`${purpose.padEnd(12)} OK (${newText.length} chars)`);
    } else {
      allOk = false;
      const oldLen = oldText.length;
      const newLen = newText.length;
      let firstDiff = 0;
      while (firstDiff < Math.min(oldLen, newLen) && oldText[firstDiff] === newText[firstDiff]) {
        firstDiff++;
      }
      console.log(`${purpose.padEnd(12)} MISMATCH old=${oldLen} new=${newLen} first-diff-at=${firstDiff}`);
      const ctxOld = oldText.slice(Math.max(0, firstDiff - 30), firstDiff + 30);
      const ctxNew = newText.slice(Math.max(0, firstDiff - 30), firstDiff + 30);
      console.log(`  old: ${JSON.stringify(ctxOld)}`);
      console.log(`  new: ${JSON.stringify(ctxNew)}`);
    }
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
