// persistent-memory — cross-day memory that survives across app restarts.
//
// Two char-capped Markdown files in state/memory/:
//   USER.md   — trader profile (preferences, schedule, instruments traded)
//   MEMORY.md — cross-day market lessons + agent observations
//
// Modeled on the Hermes Agent memory architecture
// (docs/research/hermes-memory-architecture.md). Key invariants:
//
//  1. Files are CHARACTER-capped, not token-capped. Survives model swaps.
//  2. Entries are joined by §\n (section sign + newline). Multiline-safe.
//  3. Atomic writes via tempfile + rename — readers always see a complete
//     file. Reuses session-memory.js's writeAtomic.
//  4. Frozen snapshot: load() captures the current state into _snapshot.
//     formatForSystemPrompt() returns the frozen view, NOT the live view.
//     Mid-session writes update disk + live state but the snapshot stays
//     until the next load(). This is what lets the SDK keep the upstream
//     prefix cache warm across many turns.
//  5. External-drift detection: before any write, if the on-disk content
//     wouldn't round-trip through our parser/serializer OR a single parsed
//     entry exceeds the char cap, refuse the write and back up to
//     <file>.bak.<ts>. Prevents silently clobbering a hand-edit or
//     sister-process write.
//  6. NOT distinct from app/main/session-memory.js — that module handles
//     INTRA-day per-session files (pillar1.md, brief.json, etc.). This
//     module handles CROSS-day persistent memory. Different concern,
//     different store, different lifecycle.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeAtomic } from "./session-memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_BASE_DIR = path.join(REPO_ROOT, "state", "memory");

// §\n delimiter — same as Hermes. § is unlikely in trader-side content;
// the trailing newline keeps entries readable when rendered.
const ENTRY_DELIMITER = "\n§\n";

const SEPARATOR = "═".repeat(46);

// ─────────────────────────────────────────────────────────────────────
// Backtest context — when set, writers short-circuit and return
// {success:true, suppressed:true, run_id} without mutating disk. Reads
// (formatForSystemPrompt, load) are unaffected. This is what makes
// backtest runs repeatable: a second run of the same session produces
// the same result as the first, since memory is read-only during a run.
// ─────────────────────────────────────────────────────────────────────
let _backtestContext = null;

export function setBacktestContext(ctx) {
  _backtestContext = ctx;
}

export function clearBacktestContext() {
  _backtestContext = null;
}

export function inBacktest() {
  return _backtestContext !== null;
}

function _suppressedResult(target) {
  return {
    success: true,
    suppressed: true,
    run_id: _backtestContext?.runId ?? null,
    target,
    reason: "backtest_context_active",
  };
}

/**
 * Decode a target name to its filename. Throws on invalid targets so the
 * tool boundary surfaces a clean error.
 */
function fileFor(baseDir, target) {
  if (target === "user") return path.join(baseDir, "USER.md");
  if (target === "memory") return path.join(baseDir, "MEMORY.md");
  throw new Error(`invalid target: ${target}`);
}

/**
 * Parse a stored file into a list of entries. No locking — atomic writes
 * mean readers either see the old file or the new file, never a partial.
 */
function parseFile(raw) {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(ENTRY_DELIMITER)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

/**
 * Serialize entries back to file content. Round-trip:
 *   serialize(parse(raw)) === raw  for any file written by this module.
 * That round-trip identity is the basis for external-drift detection.
 */
function serializeEntries(entries) {
  return entries.join(ENTRY_DELIMITER);
}

/**
 * Render one target's snapshot block for the system prompt. Returns the
 * empty string when there are no entries — so the SDK can omit the entire
 * <persistent_memory> block on a fresh project rather than rendering an
 * empty section.
 */
function renderBlock(target, entries, charLimit) {
  if (!entries || entries.length === 0) return "";
  const content = serializeEntries(entries);
  const current = content.length;
  const pct = Math.min(100, Math.floor((current / charLimit) * 100));
  const usage = `${pct}% — ${current.toLocaleString()}/${charLimit.toLocaleString()} chars`;
  const header =
    target === "user"
      ? `USER PROFILE (who the trader is) [${usage}]`
      : `MEMORY (cross-day notes) [${usage}]`;
  return `${SEPARATOR}\n${header}\n${SEPARATOR}\n${content}`;
}

export class PersistentMemory {
  /**
   * @param {object} opts
   * @param {string} [opts.baseDir] — directory holding USER.md / MEMORY.md.
   *   Defaults to <repo-root>/state/memory.
   * @param {number} [opts.memoryCharLimit] — char cap for MEMORY.md.
   * @param {number} [opts.userCharLimit] — char cap for USER.md.
   */
  constructor({
    baseDir = DEFAULT_BASE_DIR,
    memoryCharLimit = 2000,
    userCharLimit = 1500,
  } = {}) {
    this.baseDir = baseDir;
    this.memoryCharLimit = memoryCharLimit;
    this.userCharLimit = userCharLimit;
    this.memoryEntries = [];
    this.userEntries = [];
    // Frozen snapshot used by formatForSystemPrompt. Updated only by load().
    // Mid-session add/replace/remove updates entries + disk but NOT this.
    this._snapshot = { memory: "", user: "" };
  }

  _entriesFor(target) {
    return target === "user" ? this.userEntries : this.memoryEntries;
  }

  _setEntries(target, entries) {
    if (target === "user") this.userEntries = entries;
    else this.memoryEntries = entries;
  }

  _charLimitFor(target) {
    return target === "user" ? this.userCharLimit : this.memoryCharLimit;
  }

  /**
   * Read both files from disk, populate entries arrays, and capture the
   * frozen system-prompt snapshot. Called by the SDK at the start of each
   * userTurn so the snapshot is fresh-per-turn but byte-stable across the
   * turn's many message exchanges.
   *
   * Safe to call repeatedly. Missing files = empty store.
   */
  async load() {
    await this._ensureDir();
    this.memoryEntries = await this._readEntries(fileFor(this.baseDir, "memory"));
    this.userEntries = await this._readEntries(fileFor(this.baseDir, "user"));
    // Dedupe — first occurrence wins.
    this.memoryEntries = [...new Set(this.memoryEntries)];
    this.userEntries = [...new Set(this.userEntries)];
    // Capture frozen snapshot.
    this._snapshot = {
      memory: renderBlock("memory", this.memoryEntries, this.memoryCharLimit),
      user: renderBlock("user", this.userEntries, this.userCharLimit),
    };
  }

  /**
   * Return the frozen snapshot block for one target, or null if empty.
   * Never reflects mid-turn writes — that's the contract that keeps the
   * upstream prefix cache warm.
   */
  formatForSystemPrompt(target) {
    const block = this._snapshot[target];
    return block && block.length > 0 ? block : null;
  }

  /**
   * Return the full <persistent_memory> block for system-prompt injection.
   * Combines user + memory snapshots with a fence and a system note that
   * tells the model how to treat the contents. Returns the empty string
   * when both stores are empty — caller should omit the entire injection
   * in that case.
   */
  formatBlockForSystemPrompt() {
    const userBlock = this.formatForSystemPrompt("user");
    const memoryBlock = this.formatForSystemPrompt("memory");
    if (!userBlock && !memoryBlock) return "";
    const body = [userBlock, memoryBlock].filter(Boolean).join("\n\n");
    return [
      "<persistent_memory>",
      "[System note: the following is persistent memory carried across trading days. Treat as authoritative reference about the trader and recurring market patterns. Apply contextually — these are facts, not standing orders.]",
      "",
      body,
      "</persistent_memory>",
    ].join("\n");
  }

  /**
   * add — append a new entry. Returns the standard result shape.
   * Refuses on duplicate entries or cap overflow.
   */
  async add(target, content) {
    if (_backtestContext) return _suppressedResult(target);
    const trimmed = (content || "").trim();
    if (!trimmed) {
      return {
        success: false,
        error: "content cannot be empty",
      };
    }
    if (target !== "memory" && target !== "user") {
      return {
        success: false,
        error: `invalid target '${target}' — use 'memory' or 'user'`,
      };
    }

    const driftBak = await this._detectExternalDrift(target);
    if (driftBak) return this._driftError(target, driftBak);

    // Reload live state under the drift-check, so we don't clobber a write
    // that landed between this caller's last read and now.
    await this._reloadLiveStateFor(target);

    const entries = this._entriesFor(target);
    if (entries.includes(trimmed)) {
      return this._successResponse(target, "entry already exists (no duplicate added)");
    }

    const charLimit = this._charLimitFor(target);
    const newEntries = [...entries, trimmed];
    const newTotal = serializeEntries(newEntries).length;
    if (newTotal > charLimit) {
      const current = serializeEntries(entries).length;
      return {
        success: false,
        error:
          `${target} memory at ${current.toLocaleString()}/${charLimit.toLocaleString()} chars. ` +
          `adding this entry (${trimmed.length} chars) would exceed the limit. ` +
          `replace or remove existing entries first.`,
        current_entries: entries,
        usage: `${current.toLocaleString()}/${charLimit.toLocaleString()}`,
      };
    }

    this._setEntries(target, newEntries);
    await this._save(target);
    return this._successResponse(target, "entry added");
  }

  /**
   * replace — find entry containing old_text (unique substring), replace it.
   * Refuses on ambiguous match or cap overflow.
   */
  async replace(target, oldText, newContent) {
    if (_backtestContext) return _suppressedResult(target);
    const oldTrim = (oldText || "").trim();
    const newTrim = (newContent || "").trim();
    if (!oldTrim) return { success: false, error: "old_text cannot be empty" };
    if (!newTrim) {
      return {
        success: false,
        error: "content cannot be empty (use action='remove' to delete entries)",
      };
    }
    if (target !== "memory" && target !== "user") {
      return { success: false, error: `invalid target '${target}'` };
    }

    const driftBak = await this._detectExternalDrift(target);
    if (driftBak) return this._driftError(target, driftBak);
    await this._reloadLiveStateFor(target);

    const entries = this._entriesFor(target);
    const matches = entries
      .map((e, i) => [i, e])
      .filter(([, e]) => e.includes(oldTrim));

    if (matches.length === 0) {
      return { success: false, error: `no entry matched '${oldTrim}'` };
    }
    if (matches.length > 1) {
      // OK only if all matched entries are byte-identical; otherwise force the
      // model to be more specific.
      const unique = new Set(matches.map(([, e]) => e));
      if (unique.size > 1) {
        return {
          success: false,
          error: `multiple entries matched '${oldTrim}' — be more specific`,
          matches: matches.map(([, e]) => (e.length > 80 ? e.slice(0, 80) + "..." : e)),
        };
      }
    }

    const idx = matches[0][0];
    const charLimit = this._charLimitFor(target);
    const testEntries = [...entries];
    testEntries[idx] = newTrim;
    const newTotal = serializeEntries(testEntries).length;
    if (newTotal > charLimit) {
      return {
        success: false,
        error:
          `replacement would put ${target} memory at ${newTotal.toLocaleString()}/${charLimit.toLocaleString()} chars. ` +
          "shorten the new content or remove other entries first.",
      };
    }

    this._setEntries(target, testEntries);
    await this._save(target);
    return this._successResponse(target, "entry replaced");
  }

  /**
   * remove — delete the entry containing old_text. Ambiguity rules match
   * replace.
   */
  async remove(target, oldText) {
    if (_backtestContext) return _suppressedResult(target);
    const oldTrim = (oldText || "").trim();
    if (!oldTrim) return { success: false, error: "old_text cannot be empty" };
    if (target !== "memory" && target !== "user") {
      return { success: false, error: `invalid target '${target}'` };
    }

    const driftBak = await this._detectExternalDrift(target);
    if (driftBak) return this._driftError(target, driftBak);
    await this._reloadLiveStateFor(target);

    const entries = this._entriesFor(target);
    const matches = entries
      .map((e, i) => [i, e])
      .filter(([, e]) => e.includes(oldTrim));

    if (matches.length === 0) {
      return { success: false, error: `no entry matched '${oldTrim}'` };
    }
    if (matches.length > 1) {
      const unique = new Set(matches.map(([, e]) => e));
      if (unique.size > 1) {
        return {
          success: false,
          error: `multiple entries matched '${oldTrim}' — be more specific`,
          matches: matches.map(([, e]) => (e.length > 80 ? e.slice(0, 80) + "..." : e)),
        };
      }
    }

    const idx = matches[0][0];
    const next = [...entries];
    next.splice(idx, 1);
    this._setEntries(target, next);
    await this._save(target);
    return this._successResponse(target, "entry removed");
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  async _ensureDir() {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async _readEntries(absPath) {
    try {
      const raw = await fs.readFile(absPath, "utf8");
      return parseFile(raw);
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  async _reloadLiveStateFor(target) {
    const absPath = fileFor(this.baseDir, target);
    const fresh = await this._readEntries(absPath);
    this._setEntries(target, [...new Set(fresh)]);
  }

  async _save(target) {
    const absPath = fileFor(this.baseDir, target);
    const entries = this._entriesFor(target);
    const content = serializeEntries(entries);
    await this._ensureDir();
    await writeAtomic(absPath, content);
  }

  /**
   * Detect external drift in the on-disk file. Two signals:
   *   1. Round-trip mismatch: parsing then re-serializing doesn't yield
   *      identical bytes (rare but cheap to check).
   *   2. Entry-size overflow: any single parsed entry exceeds the char
   *      cap — i.e. some other writer appended free-form content into
   *      what our parser will treat as one entry.
   *
   * On detected drift, snapshot the file to <file>.bak.<ts> and return
   * that path. Caller refuses the mutation. Returns null when the file
   * looks tool-shaped.
   */
  async _detectExternalDrift(target) {
    const absPath = fileFor(this.baseDir, target);
    let raw;
    try {
      raw = await fs.readFile(absPath, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
    if (!raw.trim()) return null;

    const parsed = parseFile(raw);
    const roundtrip = serializeEntries(parsed);
    const charLimit = this._charLimitFor(target);
    const maxEntryLen = parsed.length === 0 ? 0 : Math.max(...parsed.map((e) => e.length));

    const drift = raw.trim() !== roundtrip || maxEntryLen > charLimit;
    if (!drift) return null;

    const ts = Math.floor(Date.now() / 1000);
    const bakPath = `${absPath}.bak.${ts}`;
    try {
      await fs.writeFile(bakPath, raw, "utf8");
    } catch (err) {
      return `${bakPath} (BACKUP FAILED: ${err.code || err.message})`;
    }
    return bakPath;
  }

  _driftError(target, bakPath) {
    return {
      success: false,
      error:
        `refusing to write ${target} memory: file on disk has content that wouldn't ` +
        `round-trip through this module (likely a hand-edit or sister-process write). ` +
        `a snapshot was saved to ${bakPath}. resolve the drift first — either rewrite ` +
        `the file as a clean §-delimited list of entries (each under ${this._charLimitFor(target)} chars), ` +
        `or move the extra content out — then retry.`,
      drift_backup: bakPath,
    };
  }

  _successResponse(target, message) {
    const entries = this._entriesFor(target);
    const content = serializeEntries(entries);
    const current = content.length;
    const limit = this._charLimitFor(target);
    const pct = limit > 0 ? Math.min(100, Math.floor((current / limit) * 100)) : 0;
    return {
      success: true,
      target,
      entries,
      usage: `${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars`,
      entry_count: entries.length,
      message,
    };
  }
}

// Singleton — the SDK uses one shared instance keyed to <repo>/state/memory/.
// Constructed lazily on first access so tests can construct their own with
// a custom baseDir without conflict.
let _singleton = null;
export function getPersistentMemory() {
  if (!_singleton) _singleton = new PersistentMemory();
  return _singleton;
}

// Test-only: reset the singleton so each test starts clean.
export function _resetSingletonForTests() {
  _singleton = null;
}
