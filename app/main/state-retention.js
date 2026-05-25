// state-retention — sweep old per-session folders.
//
// Each trading day creates state/session/<YYYY-MM-DD>/ with brief, wrap,
// pillar, ltf-bias, open-reaction, setups, trades, bar-close events, plus
// (now) a brief-bundle.json snapshot. That's ~1-5 MB per day. Without
// retention the directory grows without bound — months of dead folders
// the dashboard has to walk every refresh.
//
// Policy: keep RETENTION_DAYS of folders. Anything older gets fs.rm'd.
// Runs once on app boot — cheap and predictable.

import fs from "node:fs/promises";
import path from "node:path";

const RETENTION_DAYS = 30;

const DATE_FOLDER = /^\d{4}-\d{2}-\d{2}$/;

/**
 * sweepOldSessions — delete state/session/<YYYY-MM-DD>/ folders older
 * than RETENTION_DAYS.
 *
 * @param {string} repoRoot  absolute path to the project root
 * @returns {Promise<{deleted: number, kept: number}>}
 */
export async function sweepOldSessions(repoRoot) {
  const sessionsDir = path.join(repoRoot, "state", "session");
  let entries;
  try {
    entries = await fs.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return { deleted: 0, kept: 0 };  // no session dir yet — first run
  }

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let kept = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!DATE_FOLDER.test(entry.name)) continue;     // skip non-date entries
    const dirDate = Date.parse(entry.name + "T00:00:00Z");
    if (!Number.isFinite(dirDate)) { kept += 1; continue; }
    if (dirDate < cutoff) {
      try {
        await fs.rm(path.join(sessionsDir, entry.name), { recursive: true, force: true });
        deleted += 1;
      } catch {
        // best-effort; a single stuck folder shouldn't block boot
        kept += 1;
      }
    } else {
      kept += 1;
    }
  }
  return { deleted, kept };
}
