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
//   • authors no surface / trade tools — the "journal" purpose maps to an empty
//     tool list (Read/Glob built-ins remain reachable but the turn needs none);
//   • lowest-priority — it fires after a short deferral so the immediate
//     post-close narration turn goes first, and runs under a 20s hard cap so it
//     can never hold the shared turn mutex long enough to defer the next bar's
//     fold by more than 20s;
//   • fresh session every draft — never resumes the prior conversation, so a
//     day of closes doesn't accumulate screenshots / context / cost;
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
import { userTurn, isClaudeAuthBlocked, resetSession } from "./sdk.js";
import { record as recordMetric } from "./metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// Hard cap on the journal turn. A cosmetic post-close note must never hold the
// shared turn mutex long enough to defer the next bar's narration fold — 20s is
// the worst-case deferral of a subsequent turn. A timeout just means no draft.
const JOURNAL_TURN_TIMEOUT_MS = 20_000;
// Yield the immediate post-close turn: wait a few seconds before firing so a
// bar-close / narration turn queued right at the close grabs the mutex first.
const JOURNAL_TURN_DEFER_MS = 4_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  reset = resetSession,
  metric = recordMetric,
  timeoutMs = JOURNAL_TURN_TIMEOUT_MS,
  deferMs = JOURNAL_TURN_DEFER_MS,
  wait = sleep,
} = {}) {
  try {
    if (isAuthBlocked && isAuthBlocked()) {
      metric?.({ kind: "journal", event: "skipped", reason: "claude_auth_blocked" });
      return null;
    }
    // Fresh session per draft — never resume prior closes (no screenshot /
    // context / cost accumulation across the day's trades).
    try { reset?.("journal"); } catch { /* best-effort */ }

    const text = buildCloseContext(row);
    const shot = readAttachment(row?.screenshot);
    const images = shot ? [shot] : null;
    metric?.({ kind: "journal", event: "started", image: !!shot });

    // Yield to the immediate post-close narration turn before contending for
    // the mutex (lowest-priority). The 20s cap bounds the rest.
    if (deferMs > 0) await wait(deferMs);

    let out = "";
    let errored = false;
    let timedOut = false;
    let usage = null;
    await turn({
      purpose: "journal",
      text,
      images,
      timeoutMs,
      onEvent: (ev) => {
        if (ev?.type === "chunk" && typeof ev.text === "string") out += ev.text;
        else if (ev?.type === "usage") usage = ev.usage;
        else if (ev?.type === "error") { errored = true; if (ev.kind === "timeout") timedOut = true; }
      },
    });

    const note = out.trim().replace(/\s+/g, " ").slice(0, 300);
    if (!note) {
      if (timedOut) metric?.({ kind: "journal", event: "timeout", usage });
      else metric?.({ kind: "journal", event: "failed", reason: errored ? undefined : "empty", usage });
      return null;
    }
    metric?.({ kind: "journal", event: "succeeded", image: !!shot, usage });
    return note;
  } catch (err) {
    // Best-effort: any failure means no draft, never a thrown error into the
    // fire-and-forget caller.
    metric?.({ kind: "journal", event: "failed", reason: String(err?.message || err) });
    return null;
  }
}
