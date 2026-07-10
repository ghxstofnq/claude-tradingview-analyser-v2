// app/main/journal.js — auto-journal on trade close (plan 2026-07-09 Task 5).
//
// Every closed round-trip recorded by the fills store (paper WS feed +
// Tradovate poller both flow through appendFill) becomes one journal row:
// entry/exit/realized R/duration + a best-effort chart screenshot, persisted
// to the DAY's journal file with the session attributed the same way live
// writes are (sessions.resolveSessionFolder — idle closes land on the
// most-recently-closed session, never a blind ny-am).
//
// The screenshot is for the HUMAN reviewer only — it never feeds analysis
// (CLAUDE.md constraint #5 intact). The renderer gets a journal:close event to
// raise the dismissible "weakest pillar?" note prompt; addNote patches the row.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { currentSession, resolveSessionFolder, stateRoot } from "./sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

let _send = null;
export function setJournalSend(send) { _send = send; }

function dayDir(date) { return path.join(stateRoot(), "session", date); }
function journalPath(date) { return path.join(dayDir(date), "journal.jsonl"); }

// Best-effort chart screenshot via the CLI (one-shot — never a polling loop;
// TV Desktop 9225 is the analysis backend showing the traded instrument).
// Resolves to a repo-relative path or null; failures are silent by design.
function captureScreenshot(date, id) {
  return new Promise((resolve) => {
    const name = `journal-${id}`;
    const child = execFile("./bin/tv", ["screenshot", "-o", name], { cwd: REPO_ROOT, timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        // capture prints JSON with the written path; fall back to the
        // conventional screenshots dir if parsing fails.
        const m = String(stdout).match(/"(?:file_?path|path)"\s*:\s*"([^"]+)"/i);
        const src = m ? m[1] : path.join(REPO_ROOT, "screenshots", `${name}.png`);
        if (!fs.existsSync(src)) return resolve(null);
        const destDir = path.join(dayDir(date), "journal");
        fs.mkdirSync(destDir, { recursive: true });
        const dest = path.join(destDir, `${id}.png`);
        fs.renameSync(src, dest);
        resolve(path.relative(REPO_ROOT, dest));
      } catch { resolve(null); }
    });
    child.on("error", () => resolve(null));
  });
}

// Fill record → journal row. Pure; exported for tests.
export function buildJournalRow(fill, { date, session, id } = {}) {
  const a = fill?.actual ?? {};
  return {
    id: id ?? `jr-${Date.now()}`,
    ts: fill?.ts ?? new Date().toISOString(),
    date, session,
    account: fill?.account ?? "unknown",
    symbol: fill?.symbol ?? null,
    side: fill?.side ?? null,
    qty: fill?.qty ?? null,
    entry: a.entry ?? null,
    exit: a.exit ?? null,
    usd: a.usd ?? null,
    r: a.r ?? null,
    heldMs: a.heldMs ?? null,
    planned: fill?.planned ?? null,
    screenshot: null,
    note: null,
  };
}

// Called from the fills-store hook on every recorded close. Never throws into
// the trading feed.
export async function recordClose(fill) {
  try {
    const now = currentSession();
    // resolveSessionFolder attributes idle-time closes to the most-recently
    // closed session (and shifts the date across the midnight-ET window).
    const { date, folder: session } = resolveSessionFolder(now);
    const id = `jr-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const row = buildJournalRow(fill, { date, session, id });
    fs.mkdirSync(dayDir(date), { recursive: true });
    fs.appendFileSync(journalPath(date), JSON.stringify(row) + "\n");
    _send?.("journal:close", row);
    // Screenshot after the row exists (append-then-patch) so a capture failure
    // never loses the trade record.
    const shot = await captureScreenshot(date, id);
    if (shot) {
      patchRow(date, id, { screenshot: shot });
      _send?.("journal:close", { ...row, screenshot: shot });
    }
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function patchRow(date, id, patch) {
  const p = journalPath(date);
  const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
  const next = lines.map((l) => {
    try {
      const row = JSON.parse(l);
      return row.id === id ? JSON.stringify({ ...row, ...patch }) : l;
    } catch { return l; }
  });
  fs.writeFileSync(p, next.join("\n") + "\n");
}

// The trader's one-line note from the dismissible prompt ("weakest pillar?").
export function addNote({ date, id, note }) {
  try {
    if (!date || !id) return { ok: false, error: "missing date/id" };
    patchRow(date, id, { note: String(note ?? "").slice(0, 300) });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Rows for one day, optionally session-filtered (REVIEW's journal reader).
export function readJournal({ date, session = null } = {}) {
  try {
    const lines = fs.readFileSync(journalPath(date), "utf8").split("\n").filter(Boolean);
    const rows = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return session ? rows.filter((r) => r.session === session) : rows;
  } catch { return []; }
}
