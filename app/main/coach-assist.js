// app/main/coach-assist.js — on-demand weekly coach narration.
//
// Track 2 §2b item 2 (docs/intent/2026-07-10-unified-goal.md). When the trader
// clicks COACH on the Review page, this fires ONE Claude turn (purpose "coach")
// that reads a deterministic performance digest over the last N recorded
// sessions and writes a short coaching read to state/review/coach.md. It is:
//
//   • on-demand only — no scheduler; the renderer's IPC verb triggers it;
//   • pure prose — the "coach" purpose maps to an empty tool list (no surface_*,
//     no trade, no analyze); it authors only the coach.md narrative;
//   • number-safe — all figures are computed in coach-digest.js; the prompt
//     forbids inventing any number not present verbatim in the digest;
//   • fresh session every run — resetSession("coach") before the turn, so a
//     re-click never resumes stale context;
//   • in-flight guarded — a second click while a turn is running is rejected
//     (no queue pileup); the renderer disables the button meanwhile;
//   • off the trade path — it reads recorded outcomes only and touches no
//     execution / walker / gate code.
//
// LLM down / turn failure → NO file is written (an absent coach.md means the
// card simply doesn't render); the caller surfaces the error via app:error.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { userTurn, isClaudeAuthBlocked, resetSession } from "./sdk.js";
import { record as recordMetric } from "./metrics.js";
import { extractMarkedSection } from "./prose-section.js";
import { buildCoachDigest, hashDigest } from "./coach-digest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// Hard cap on the coach turn. On-demand + user-initiated, so a generous but
// bounded budget — a hung turn just means no narration and a surfaced error.
const COACH_TURN_TIMEOUT_MS = 60_000;
// Number of recent sessions the digest spans by default.
export const COACH_DEFAULT_SESSIONS = 10;
// The Markdown heading the coach turn ends under — sliced with the shared
// extractMarkedSection (same discipline as #239's ## CRITIQUE).
const COACH_MARKER = "COACH";

// Resolve state/review/coach.md under the current state root (GOFNQ_STATE_DIR
// aware, so a test write lands where readCoachRaw reads and never touches live
// state/). Cross-session by design — it lives beside the session tree, NOT in
// any one session folder.
function coachDir() {
  const root = process.env.GOFNQ_STATE_DIR || path.join(REPO_ROOT, "state");
  return path.join(root, "review");
}
export function coachFilePath() {
  return path.join(coachDir(), "coach.md");
}

// Tolerant read — missing / unreadable / empty → null (never throws). Backs the
// Review page's coach getter: absent → no card.
export async function readCoachRaw() {
  try {
    const txt = await fs.readFile(coachFilePath(), "utf8");
    return txt.trim() ? txt : null;
  } catch {
    return null;
  }
}

// Deterministic digest → prompt text. Pure. Embeds the digest as JSON so the
// model reads real, code-computed figures and this code never guesses field
// names. The trailing instruction restates the number discipline inline.
export function buildCoachContext(digest) {
  const json = safeJson(digest);
  return [
    "Review the trader's recent trading sessions and write a short coaching read.",
    "",
    "You receive a DETERMINISTIC performance digest below. Every number in it was",
    "computed in code — you must not produce any number that is not present",
    "verbatim in this digest. Reference figures by naming them, or use no numbers.",
    "",
    "DIGEST (the only numbers you may reference):",
    json,
    "",
    "Write 3-6 plain-English sentences: the equity trend, patterns across the",
    "sessions (models, grades, faithfulness, chain health, discrepancies), what to",
    "keep, and what to watch. Retrospective only — no advice for future positions.",
    "End with your read under a final heading that is EXACTLY this line, alone:",
    "",
    `## ${COACH_MARKER}`,
  ].join("\n");
}

function safeJson(v) {
  try { return v == null ? "null" : JSON.stringify(v, null, 2); } catch { return "null"; }
}

// Assemble coach.md (frontmatter + body). Pure. Returns null when there is no
// prose to persist (so the caller writes no file and the card doesn't render).
export function buildCoachFile({ text, provider, digest_hash, ts }) {
  const body = String(text ?? "").trim();
  if (!body) return null;
  return [
    "---",
    `ts: ${ts || new Date().toISOString()}`,
    `provider: ${provider || "claude"}`,
    `digest_hash: ${digest_hash || ""}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

// Default persister — best-effort disk write of the assembled coach.md.
async function persistCoach(contents) {
  await fs.mkdir(coachDir(), { recursive: true });
  const p = coachFilePath();
  await fs.writeFile(p, contents, "utf8");
  return p;
}

// ── In-flight gate ──────────────────────────────────────────────────────────
// A tiny single-slot mutex: one coach turn at a time. tryAcquire() returns
// false when a turn is already running (the caller rejects the re-click without
// firing a second turn). Pure + injectable for tests; a module singleton backs
// the production generateCoach.
export function createInFlightGate() {
  let busy = false;
  return {
    busy: () => busy,
    tryAcquire: () => (busy ? false : ((busy = true), true)),
    release: () => { busy = false; },
  };
}

const _gate = createInFlightGate();
export function isCoachInFlight() { return _gate.busy(); }

/**
 * generateCoach({ journals, limit, deps }) — build the digest, fire the coach
 * turn, slice the `## COACH` section, persist coach.md. Returns a structured
 * result the IPC handler forwards to the renderer:
 *
 *   { ok: true,  coach, path, digest_hash }             on success
 *   { ok: false, error, inFlight?, skipped? }           on any failure
 *
 * Never throws. Deps are injectable for tests (turn / persist / gate / metric /
 * auth-check / clock).
 */
export async function generateCoach({
  journals = [],
  limit = COACH_DEFAULT_SESSIONS,
  turn = userTurn,
  persist = persistCoach,
  reset = resetSession,
  metric = recordMetric,
  isAuthBlocked = isClaudeAuthBlocked,
  gate = _gate,
  now = () => new Date().toISOString(),
  timeoutMs = COACH_TURN_TIMEOUT_MS,
} = {}) {
  // Reject a re-click while a turn is running — no queue pileup, no second turn.
  if (!gate.tryAcquire()) {
    return { ok: false, error: "a coach read is already in progress", inFlight: true };
  }
  try {
    if (isAuthBlocked && isAuthBlocked()) {
      metric?.({ kind: "coach", event: "skipped", reason: "claude_auth_blocked" });
      return { ok: false, error: "Claude is unavailable — try again once it reconnects", skipped: true };
    }

    const digest = buildCoachDigest(journals, { limit });
    const digest_hash = hashDigest(digest);
    const text = buildCoachContext(digest);

    // Fresh session per read — never resume a prior coach turn.
    try { reset?.("coach"); } catch { /* best-effort */ }

    metric?.({ kind: "coach", event: "started", sessions: digest.n_sessions });

    let out = "";
    let errored = false;
    let errMessage = null;
    let timedOut = false;
    let usage = null;
    let provider = "claude";
    await turn({
      purpose: "coach",
      text,
      timeoutMs,
      onEvent: (ev) => {
        if (!ev) return;
        if (ev.provider) provider = ev.provider;
        if (ev.type === "chunk" && typeof ev.text === "string") out += ev.text;
        else if (ev.type === "usage") usage = ev.usage;
        else if (ev.type === "error") {
          errored = true;
          errMessage = ev.message || errMessage;
          if (ev.kind === "timeout") timedOut = true;
        }
      },
    });

    // Slice only the `## COACH` section — discard any pre-read preamble. No
    // marker (or an errored turn) → nothing to persist → no file → no card.
    const read = errored ? null : extractMarkedSection(out, COACH_MARKER);
    const contents = read ? buildCoachFile({ text: read, provider, digest_hash, ts: now() }) : null;
    if (!contents) {
      if (timedOut) metric?.({ kind: "coach", event: "timeout", usage });
      else metric?.({ kind: "coach", event: "failed", reason: errored ? (errMessage || undefined) : "empty", usage });
      return { ok: false, error: errMessage || "the coach read came back empty — try again" };
    }

    let p = null;
    try {
      p = await persist(contents);
    } catch (err) {
      metric?.({ kind: "coach", event: "failed", reason: `write:${err?.message || err}`, usage });
      return { ok: false, error: `could not save the coach read: ${err?.message || err}` };
    }

    metric?.({ kind: "coach", event: "succeeded", sessions: digest.n_sessions, usage });
    return { ok: true, coach: contents, path: p, digest_hash };
  } catch (err) {
    metric?.({ kind: "coach", event: "failed", reason: String(err?.message || err) });
    return { ok: false, error: String(err?.message || err) };
  } finally {
    gate.release();
  }
}
