// Read the engine code_rev a recorded run's tape was captured under.
// Used by scripts/record-corpus.mjs --require-code-rev to make the resume
// skip-list rev-aware: a full corpus re-record after a Pine CODE_REV bump
// must NOT skip keys whose only "done" run carries the old rev.
import fs from "node:fs";
import path from "node:path";

// Returns the numeric code_rev of the run's first tape entry, or null when
// the tape is missing/unreadable/pre-stamp. Null reads as "not done" under
// a --require-code-rev filter — fail-safe toward re-recording.
export function tapeCodeRev(runDir, session) {
  try {
    const p = path.join(runDir, session, "tape.json");
    const tape = JSON.parse(fs.readFileSync(p, "utf8"));
    const entries = tape?.entries ?? [];
    for (const e of entries) {
      // Recorded tapes carry the engine bundle under inputs.bundle (the
      // certifier's accessor — corpus-certification.js validateTape); some
      // synthetic/test tapes carry engine at the entry root.
      const rev = e?.inputs?.bundle?.engine?.meta?.code_rev ?? e?.engine?.meta?.code_rev;
      if (Number.isFinite(rev)) return rev;
    }
    return null;
  } catch {
    return null;
  }
}
