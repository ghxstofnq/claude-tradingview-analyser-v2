// surface_setup / surface_no_trade / surface_session_brief — tools Claude
// calls to push structured output to the UI. Main captures the call,
// persists to disk, and forwards to the renderer via IPC.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activeSessionDir, currentSession } from "../sessions.js";
import { writePairDecision } from "../../../cli/lib/pair-decision.js";
import { writeBrief, readMemory, writeAtomic } from "../session-memory.js";
import { PAIR_PRIMARY, PAIR_SECONDARY } from "../config.js";
import { record as recordMetric } from "../metrics.js";

// Symbols allowed in surface_session_brief.symbol. Anything else is a typo /
// hallucination and should fail loudly rather than write a brief-XYZ.json
// that no UI reads. Keep in sync with config.js.
const VALID_BRIEF_SYMBOLS = new Set([PAIR_PRIMARY, PAIR_SECONDARY]);

// Brief-usefulness signal: when a setup fires during a session, was its
// price grounded in the brief's key levels? If most setups ignore the
// brief, the brief content isn't earning its cost. ±0.5pt tolerance
// catches "stop at 21487 vs PDH 21487.25" without flagging unrelated.
const BRIEF_PRICE_TOLERANCE = 0.5;

async function recordSetupVsBrief(setup) {
  try {
    const dir = await activeSessionDir();
    const briefJson = await fs.readFile(path.join(dir, "brief.json"), "utf8");
    const brief = JSON.parse(briefJson);
    const levelPrices = (brief.key_levels || [])
      .map((l) => l.price)
      .filter((p) => typeof p === "number" && Number.isFinite(p));
    if (levelPrices.length === 0) {
      recordMetric({ kind: "brief-usefulness", event: "no_levels", session: brief.session });
      return;
    }
    const setupPrices = [setup.entry, setup.stop, setup.tp1, setup.tp2]
      .filter((p) => typeof p === "number" && Number.isFinite(p));
    const matched = setupPrices.some((sp) =>
      levelPrices.some((bp) => Math.abs(sp - bp) <= BRIEF_PRICE_TOLERANCE)
    );
    recordMetric({
      kind: "brief-usefulness",
      event: matched ? "setup_cited_brief_level" : "setup_no_brief_overlap",
      session: brief.session,
    });
  } catch {
    // No brief on disk — nothing to compare. Skip silently.
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

let _send = null;
export function setSurfaceSink(sendFn) { _send = sendFn; }

// Shared persist helper for tools that write {baseName}.json (+ optional
// {baseName}.md). Atomic via session-memory.writeAtomic — readers never
// see a partial file. Tools with custom shapes (setups.jsonl append,
// pair-decision.json) skip this and use their own writers.
async function persistRecord(dir, baseName, record, mdRenderer) {
  const json = JSON.stringify(record, null, 2);
  await writeAtomic(path.join(dir, `${baseName}.json`), json);
  if (mdRenderer) {
    await writeAtomic(path.join(dir, `${baseName}.md`), mdRenderer(record));
  }
}

// Centralized tool_call IPC emission. Every surface tool ends with one.
function emitToolCall(name, payload) {
  _send?.("chat:tool_call", { name, payload });
}

// #5 Multi-setup detector. If two surface_setup calls fire within
// SETUP_WINDOW_MS, Claude is iterating mid-turn — earlier ones get
// lost from activeSetup state (only the latest is shown). Log a warning
// so we know it happened; the data is on disk via setups.jsonl.
const SETUP_WINDOW_MS = 60_000;
let _lastSetupTs = 0;
let _setupsInWindow = 0;

// #11 Current setup mirror — main owns the canonical "active setup"
// state so the renderer can re-hydrate when EntryHunt remounts (e.g.
// after a PREP↔LIVE flip). Was: activeSetup state lived only in the
// EntryHunt useChat hook; mode switch destroyed it.
let _currentSetup = null;
let _currentNoTradeReason = null;
export function getCurrentSurfaceState() {
  return { setup: _currentSetup, noTradeReason: _currentNoTradeReason };
}

export async function surfaceSetup(payload) {
  const dir = await activeSessionDir();
  const file = path.join(dir, "setups.jsonl");
  const id = payload.id || `S-${Date.now().toString(36)}`;
  const record = { ...payload, id, ts: new Date().toISOString() };
  // Append (not atomic-via-rename — appendFile is its own atomicity story
  // for jsonl logs; partial line at crash time, but never a torn record).
  await fs.appendFile(file, JSON.stringify(record) + "\n", "utf8");
  emitToolCall("surface_setup", record);
  // Mirror to main-side state so the renderer can re-hydrate on remount.
  _currentSetup = record;
  _currentNoTradeReason = null;

  const now = Date.now();
  if (now - _lastSetupTs < SETUP_WINDOW_MS) {
    _setupsInWindow += 1;
    // eslint-disable-next-line no-console
    console.warn(`[surface] multi-setup detected: ${_setupsInWindow + 1} setups within ${SETUP_WINDOW_MS / 1000}s — UI shows only the latest. All persisted to setups.jsonl.`);
    _send?.("app:error", {
      source: "surface_setup",
      level: "warn",
      message: `Multi-setup: ${_setupsInWindow + 1} setups in ${SETUP_WINDOW_MS / 1000}s — only latest shown`,
    });
  } else {
    _setupsInWindow = 0;
  }
  _lastSetupTs = now;

  // Brief-usefulness telemetry: did this setup's prices overlap any of
  // the brief's key_levels? Fire-and-forget; failure doesn't affect
  // the surface. Aggregate via the metrics file to answer "is the brief
  // actually informing Claude's bar-close decisions?"
  recordSetupVsBrief(payload).catch(() => {});
  return { ok: true, id };
}

export async function surfaceNoTrade({ reason }) {
  emitToolCall("surface_no_trade", { reason });
  _currentSetup = null;
  _currentNoTradeReason = reason;
  return { ok: true };
}

// Called when the trader accepts/rejects a setup — clears the mirror
// so a remount doesn't re-show an already-acted-on setup.
export function clearCurrentSurfaceState() {
  _currentSetup = null;
  _currentNoTradeReason = null;
}

// Resolve the per-brief folder explicitly from payload.session — NOT from the
// active session clock. The london brief fires at 02:00 ET, before
// activeSessionDir() considers london active (its window starts at 03:00),
// so a clock-derived dir would land in ny-am/ and getBriefForToday("london")
// would never find it.
async function briefDirFor(session) {
  const { date } = currentSession();
  const dir = path.join(REPO_ROOT, "state", "session", date, session);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// Persist the session brief. If `payload.symbol` is set (dual-symbol mode,
// PAIR_PRIMARY / PAIR_SECONDARY), the brief writes to brief-<symbol>.json
// alongside the legacy brief.json (which mirrors whichever was written last
// for review/journal backward compat). Without `symbol`, writes brief.json
// only — preserving single-symbol behavior.
//
// Renderer side picks: useSessionBrief prefers per-symbol files when
// available, falling back to brief.json.
export async function surfaceSessionBrief(payload) {
  // Validate symbol against the pair allow-list. Without this, Claude can
  // hallucinate symbol="MNQ" (no !) and the file lands as brief-MNQ.json
  // — invisible to the UI, no error.
  if (payload.symbol && !VALID_BRIEF_SYMBOLS.has(payload.symbol)) {
    throw new Error(
      `surface_session_brief: symbol "${payload.symbol}" not in pair allow-list ` +
      `[${[...VALID_BRIEF_SYMBOLS].join(", ")}]`,
    );
  }
  // Consistency check: A+ requires at least 2 pillars (P1 + P2; P3 is
  // pending pre-session). Schema-level Zod can't easily enforce this, but
  // a runtime check stops "A+ with empty pillars" from rendering an empty
  // panel under a confident header.
  if (payload.pillar_grade === "A+" && (!Array.isArray(payload.pillars) || payload.pillars.length < 2)) {
    throw new Error(
      `surface_session_brief: pillar_grade "A+" requires at least 2 pillars; ` +
      `got ${payload.pillars?.length ?? 0}`,
    );
  }
  const dir = await briefDirFor(payload.session);
  const ts = new Date().toISOString();
  const record = { ...payload, ts };
  // session-memory.writeBrief handles atomic writes (.tmp + rename) and
  // the brief.json mirror policy (PRIMARY only, not last-written).
  await writeBrief(dir, record);
  // prep:brief_updated is the UI-facing event; chat:tool_call is the
  // generic transcript event. Emit both — they serve different consumers.
  _send?.("prep:brief_updated", record);
  emitToolCall("surface_session_brief", record);
  return { ok: true };
}

// ---------- open-reaction.md ----------
//
// Running log written during the first 15 minutes of NY. Each call appends a
// new read; we persist the canonical list to open-reaction.json and re-render
// the markdown view from it. Latest snapshot at top, older below.
export async function surfaceOpenReaction(payload) {
  const dir = await activeSessionDir();
  const jsonFile = path.join(dir, "open-reaction.json");
  const ts = new Date().toISOString();

  let reads = [];
  try {
    reads = JSON.parse(await fs.readFile(jsonFile, "utf8")) || [];
  } catch {}
  const newRead = {
    ts,
    minutes_into_phase: payload.minutes_into_phase ?? null,
    latest_read: payload.latest_read,
    bias_direction: payload.bias_direction,
    watching: payload.watching,
  };
  reads.unshift(newRead);   // newest first
  // Atomic — open-reaction.md is read by the bar-close per-bar memory
  // loader, same race as pillar1/pillar2. Use writeAtomic via persistRecord
  // for the markdown; the JSON is written first (it's the source of truth).
  await writeAtomic(jsonFile, JSON.stringify(reads, null, 2));
  await writeAtomic(path.join(dir, "open-reaction.md"), renderOpenReactionMd({ ...payload, reads, ts }));
  emitToolCall("surface_open_reaction", newRead);
  return { ok: true };
}

function renderOpenReactionMd({ session, reads, ts }) {
  const [latest, ...prior] = reads;
  const phase = `open_reaction_${(session || "ny-am").replace("-", "_")}`;
  const head = `---
phase: ${phase}
updated_at: ${ts}
minutes_into_phase: ${latest?.minutes_into_phase ?? "n/a"}
---

# Open Reaction

## Latest read (${latest?.ts || ts}, +${latest?.minutes_into_phase ?? "?"}m)
${latest?.latest_read || "_no read_"}

## Bias direction so far
${latest?.bias_direction || "_unclear_"}

## What I'm watching
${latest?.watching || "_n/a_"}
`;
  if (!prior.length) return head;
  const priorBlock = prior
    .map((r) => `### ${r.ts} (+${r.minutes_into_phase ?? "?"}m) — ${r.bias_direction || "unclear"}\n${r.latest_read || ""}`)
    .join("\n\n");
  return `${head}
---
## Previous reads
${priorBlock}
`;
}

// ---------- ltf-bias.md ----------
//
// Finalized LTF bias, written at +14m of the open-reaction window. JSON
// sidecar is the source of truth for the renderer; markdown is the human view.
export async function surfaceLtfBias(payload) {
  const dir = await activeSessionDir();
  const record = { ...payload, ts: new Date().toISOString() };
  await persistRecord(dir, "ltf-bias", record, renderLtfBiasMd);
  emitToolCall("surface_ltf_bias", record);
  return { ok: true };
}

function renderLtfBiasMd(record) {
  const phase = `open_reaction_${(record.session || "ny-am").replace("-", "_")}_complete`;
  return `---
phase: ${phase}
finalized_at: ${record.ts}
---

# LTF Bias (post-NY-open)

- ltf_bias: ${record.ltf_bias || "stand_aside"}
- htf_ltf_alignment: ${record.htf_ltf_alignment || "unclear"}

## Reasoning
${record.reasoning || "_no reasoning provided_"}
`;
}

// ---------- summary.md ----------
//
// Session wrap, written shortly after the session closes. Resolves to the
// folder of the just-completed session via payload.session — not the active
// clock, which by then has rolled to inter-session/idle.
export async function surfaceSessionSummary(payload) {
  const dir = await briefDirFor(payload.session);
  const record = { ...payload, ts: new Date().toISOString() };
  await persistRecord(dir, "summary", record, renderSummaryMd);
  emitToolCall("surface_session_summary", record);
  return { ok: true };
}

function renderSummaryMd(record) {
  const { date } = currentSession();
  const watch = (record.watch_next_session || []).map((w) => `- ${w}`).join("\n");
  return `---
session: ${record.session || ""}
date: ${date}
wrapped_at: ${record.ts}
---

# Session Summary — ${record.session || ""}, ${date}

## Bias picture
${record.bias_picture || "_no bias picture provided_"}

## What happened
${record.what_happened || "_no narrative provided_"}

## Watch next session
${watch || "- _no watchlist provided_"}
`;
}

// Persist the leader decision for a dual-symbol session at minute 14 of the
// open-reaction phase. Once this file exists, tv analyze --pair short-
// circuits to single-symbol on the leader for the rest of the session.
export async function surfaceLeaderDecision(payload) {
  const { primary, secondary, leader, evidence, reason, session } = payload;
  if (!primary || !secondary) throw new Error("surface_leader_decision requires primary and secondary");
  if (!session) throw new Error("surface_leader_decision requires session ('london' | 'ny-am' | 'ny-pm')");
  const { date } = currentSession();
  const sessionDir = await briefDirFor(session);    // creates the folder on demand
  const record = {
    date,
    session,
    primary,
    secondary,
    leader: leader || null,
    decided_at: new Date().toISOString(),
    evidence: evidence || null,
    reason: reason || null,
  };
  await writePairDecision(sessionDir, record);
  emitToolCall("surface_leader_decision", record);
  return { ok: true, leader: record.leader };
}

// Read this session's memory files so a wrap turn (or any caller) can build a
// context block. Delegates to session-memory.readMemory. Kept as a re-export
// here for backward compat with existing callers (session-wrap).
export async function readSessionMemoryFor(session) {
  const dir = await briefDirFor(session);
  return readMemory(dir, { tailBars: 20, tailSetups: 20 });
}
