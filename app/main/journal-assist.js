// app/main/journal-assist.js — LLM-drafted post-close journal note.
//
// Track 2 item 6 (docs/intent/2026-07-10-unified-goal.md §2b + §Full
// pre-approval). AFTER a trade close is durably recorded by journal.js (row +
// best-effort screenshot on disk), this module fires ONE best-effort Claude
// turn (purpose "journal") that drafts the one-line note the trader edits or
// accepts. It is:
//
//   • fire-and-forget — never blocks or delays recordClose (journal.js kicks it
//     off without awaiting; every failure path resolves to null, never throws);
//   • skipped silently when the LLM is unavailable (reuses the auth-blocked
//     circuit — isClaudeAuthBlocked);
//   • tool-less — the "journal" purpose exposes no surface_* / trade tools;
//   • off the trade path — it runs strictly after the close is on disk and
//     touches no execution / walker / gate code.
//
// VISION CARVE-OUT: the turn may attach the auto-journal screenshot as an image
// (CLAUDE.md constraint #5's named 2026-07-10 exception, scoped to post-close
// journaling only). If the screenshot is missing/unreadable, the turn ships
// text-only automatically.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { userTurn, isClaudeAuthBlocked } from "./sdk.js";
import { record as recordMetric } from "./metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// How long to let the (queued behind live turns) journal turn run before we
// give up. Best-effort: a timeout just means no draft, never a broken close.
const JOURNAL_TURN_TIMEOUT_MS = 90_000;

const MEDIA_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

// Read a repo-relative screenshot path into a base64 image attachment.
// Returns null on any problem (missing file, oversized, read error) — the turn
// then ships text-only. Capped so a corrupt/huge capture can't blow the turn.
export function readScreenshotAttachment(relPath, { root = REPO_ROOT, maxBytes = 6_000_000 } = {}) {
  if (!relPath || typeof relPath !== "string") return null;
  try {
    const abs = path.isAbsolute(relPath) ? relPath : path.join(root, relPath);
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) return null;
    const media_type = MEDIA_TYPES[path.extname(abs).toLowerCase()] || "image/png";
    return { data: fs.readFileSync(abs).toString("base64"), media_type };
  } catch {
    return null;
  }
}

// Compact, deterministic close context. Pure — no LLM, no arithmetic beyond
// labelling. Every number here comes straight off the journal row (which itself
// copies the fill verbatim, no recomputation). The planned packet is embedded
// as JSON so whatever the execution engine recorded — model, grade, levels,
// walker stage history — reaches the model without this code guessing field
// names.
export function buildCloseContext(row = {}) {
  const dir = row.side === "buy" ? "long" : row.side === "sell" ? "short" : "?";
  const sym = String(row.symbol ?? "?").replace(/1!$/, "");
  const lines = [
    "A trade just closed. Draft the trader's post-close journal note (1-2 sentences).",
    "",
    "CLOSE DATA (deterministic — the only numbers you may reference):",
    `- instrument: ${sym}   side: ${dir}   qty: ${row.qty ?? "?"}   account: ${row.account ?? "?"}`,
    `- planned entry: ${fmt(row.planned?.entry)}   planned stop: ${fmt(row.planned?.stop)}   planned target(s): ${fmtTargets(row.planned)}`,
    `- actual entry: ${fmt(row.entry)}   actual exit: ${fmt(row.exit)}`,
    `- realized R: ${fmt(row.r)}   realized $: ${fmt(row.usd)}   hold time (ms): ${fmt(row.heldMs)}`,
    `- planned packet (model / grade / levels / walker stages, verbatim): ${safeJson(row.planned)}`,
    "",
    "Write only the note text — plain English, no JSON, no new numbers, no trade advice.",
  ];
  return lines.join("\n");
}

function fmt(v) { return v === null || v === undefined ? "n/a" : String(v); }
function fmtTargets(planned) {
  if (!planned || typeof planned !== "object") return "n/a";
  const t = [planned.tp, planned.tp1, planned.tp2].filter((x) => x !== null && x !== undefined);
  return t.length ? t.join(" / ") : "n/a";
}
function safeJson(v) {
  try { return v == null ? "n/a" : JSON.stringify(v); } catch { return "n/a"; }
}

// Fire the best-effort journal turn and resolve the drafted note (trimmed,
// ≤300 chars) or null. Never throws. Dependency-injectable for tests.
export async function draftJournalNote(row, {
  turn = userTurn,
  isAuthBlocked = isClaudeAuthBlocked,
  readAttachment = readScreenshotAttachment,
  metric = recordMetric,
  timeoutMs = JOURNAL_TURN_TIMEOUT_MS,
} = {}) {
  try {
    if (isAuthBlocked && isAuthBlocked()) {
      metric?.({ kind: "journal", event: "skipped", reason: "claude_auth_blocked" });
      return null;
    }
    const text = buildCloseContext(row);
    const shot = readAttachment(row?.screenshot);
    const images = shot ? [shot] : null;
    metric?.({ kind: "journal", event: "started", image: !!shot });

    let out = "";
    let errored = false;
    await turn({
      purpose: "journal",
      text,
      images,
      timeoutMs,
      onEvent: (ev) => {
        if (ev?.type === "chunk" && typeof ev.text === "string") out += ev.text;
        if (ev?.type === "error") errored = true;
      },
    });

    const note = out.trim().replace(/\s+/g, " ").slice(0, 300);
    if (errored && !note) {
      metric?.({ kind: "journal", event: "failed" });
      return null;
    }
    if (!note) {
      metric?.({ kind: "journal", event: "failed", reason: "empty" });
      return null;
    }
    metric?.({ kind: "journal", event: "succeeded", image: !!shot });
    return note;
  } catch (err) {
    // Best-effort: any failure means no draft, never a thrown error into the
    // fire-and-forget caller.
    metric?.({ kind: "journal", event: "failed", reason: String(err?.message || err) });
    return null;
  }
}
