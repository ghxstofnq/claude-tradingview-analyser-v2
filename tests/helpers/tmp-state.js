// Self-cleaning temp dirs for tests. Creates a dir under os.tmpdir() and
// rmSync's every one it handed out when the process exits.
//
// Why: backtest tests pass a fresh mkdtemp stateDir to runBacktest and never
// delete it, so each run leaks a stateDir into /var/folders. Over a project's
// life that piled up to GBs (bt-engine-* alone reached 1.23G across 1,855
// dirs). node --test forks a process per file, so the exit hook fires per
// file and cleans that file's dirs.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const created = [];
let registered = false;

export function tmpStateDir(prefix = "tmp-state-") {
  if (!registered) {
    process.on("exit", () => {
      for (const d of created.splice(0)) {
        try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    });
    registered = true;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}
