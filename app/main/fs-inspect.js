// Inspect the project's state/ tree and expose paths + metadata to the
// renderer. Renderer uses this to drive the "Files" popover.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shell } from "electron";
import { currentSession } from "./sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

async function statSafe(p) {
  try { return await fs.stat(p); } catch { return null; }
}

async function lineCount(p) {
  try {
    const txt = await fs.readFile(p, "utf8");
    return txt.split("\n").filter((l) => l.trim()).length;
  } catch { return 0; }
}

async function describe(absPath, { countLines = false } = {}) {
  const st = await statSafe(absPath);
  if (!st) {
    return { path: absPath, exists: false, mtime_ms: null, size_bytes: 0, lines: null };
  }
  const lines = countLines ? await lineCount(absPath) : null;
  return {
    path: absPath,
    rel: path.relative(REPO_ROOT, absPath),
    exists: true,
    mtime_ms: st.mtimeMs,
    size_bytes: st.size,
    lines,
  };
}

export async function listSessionFiles() {
  const { date, session } = currentSession();
  const sess = session === "idle" ? "ny-am" : session;
  const sessionDir = path.join(REPO_ROOT, "state", "session", date, sess);
  const dayDir = path.join(REPO_ROOT, "state", "session", date);
  const stateDir = path.join(REPO_ROOT, "state");

  const files = await Promise.all([
    describe(path.join(sessionDir, "brief.json")),
    describe(path.join(sessionDir, "pillar1.md")),
    describe(path.join(sessionDir, "pillar2.md")),
    describe(path.join(sessionDir, "open-reaction.md")),
    describe(path.join(sessionDir, "ltf-bias.md")),
    describe(path.join(sessionDir, "summary.md")),
    describe(path.join(sessionDir, "setups.jsonl"), { countLines: true }),
    describe(path.join(sessionDir, "trades.jsonl"), { countLines: true }),
    describe(path.join(sessionDir, "bars.jsonl"), { countLines: true }),
    describe(path.join(sessionDir, "bars-5m.jsonl"), { countLines: true }),
    describe(path.join(dayDir, "bar-close-events.jsonl"), { countLines: true }),
    describe(path.join(stateDir, "last-analyze.json")),
    describe(path.join(stateDir, "last-scan.json")),
    describe(path.join(stateDir, "baseline.json")),
    describe(path.join(stateDir, "session", "detector-heartbeat.json")),
  ]);

  const labels = [
    "brief.json",
    "pillar1.md",
    "pillar2.md",
    "open-reaction.md",
    "ltf-bias.md",
    "summary.md",
    "setups.jsonl",
    "trades.jsonl",
    "bars.jsonl",
    "bars-5m.jsonl",
    "bar-close-events.jsonl",
    "last-analyze.json",
    "last-scan.json",
    "baseline.json",
    "detector-heartbeat.json",
  ];
  const groups = [
    "session", "session", "session", "session", "session", "session",
    "session", "session", "session", "session",
    "day", "state", "state", "state", "day",
  ];

  const items = files.map((f, i) => ({ ...f, label: labels[i], group: groups[i] }));
  return {
    session_dir: sessionDir,
    day_dir: dayDir,
    date,
    session: sess,
    files: items,
  };
}

export async function openPath(absPath) {
  // Electron's openPath returns "" on success or an error string.
  const errMsg = await shell.openPath(absPath);
  if (errMsg) throw new Error(errMsg);
  return { ok: true };
}

export function revealInFolder(absPath) {
  shell.showItemInFolder(absPath);
  return { ok: true };
}

const READ_LIMIT = 5 * 1024 * 1024;   // 5 MB hard cap for the in-app viewer

export async function readFileForViewer(absPath) {
  const st = await statSafe(absPath);
  if (!st) return { ok: false, error: "file not found" };
  if (st.size > READ_LIMIT) {
    return {
      ok: false,
      error: `file is ${(st.size / 1024 / 1024).toFixed(1)}MB — over the 5MB in-app viewer limit; use [ OPEN ] to view in your editor.`,
      size: st.size,
    };
  }
  const content = await fs.readFile(absPath, "utf8");
  return { ok: true, content, size: st.size, mtime_ms: st.mtimeMs };
}
