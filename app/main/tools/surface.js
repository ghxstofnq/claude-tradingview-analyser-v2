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
let _currentNoTrade = null;
export function getCurrentSurfaceState() {
  return { setup: _currentSetup, noTradeReason: _currentNoTradeReason, noTrade: _currentNoTrade };
}

// ============================================================================
// Deterministic-packet audit. The walker chain is the only setup producer
// (single-brain, 2026-06-12); the old detector-candidate validator was
// removed with the cli/lib/setup-detector.js live injection. Any caller of
// surface_setup during a bar-close turn is audited against the chain's
// packet for that bar — the LLM narrates, it cannot redefine the trade.
// ============================================================================

let _currentDeterministicPacket = null;
export function setCurrentDeterministicPacket(packet) {
  _currentDeterministicPacket = packet ?? null;
}
export function clearTurnAuditState() {
  _currentDeterministicPacket = null;
}

export function validateSetupAgainstDeterministicPacket(payload, packet) {
  const errors = [];
  if (!packet || packet.status !== 'executable' || packet.finalVerdict !== 'manual_candidate') {
    throw new Error('surface_setup: no executable deterministic packet is active. Use surface_no_trade instead.');
  }
  const checks = [
    ['model', payload.model, packet.model],
    ['side', payload.side, packet.side],
    ['grade', payload.grade, packet.grade],
    ['entry', payload.entry, packet.entry?.price],
    ['stop', payload.stop, packet.stop?.price],
    ['tp1', payload.tp1, packet.tp1?.price],
  ];
  for (const [labelName, actual, expected] of checks) {
    if (typeof expected === 'number') {
      if (!Number.isFinite(actual) || Math.abs(actual - expected) >= 0.01) errors.push(`${labelName} ${actual} does not match deterministic packet ${expected}`);
    } else if (actual !== expected) {
      errors.push(`${labelName} ${actual} does not match deterministic packet ${expected}`);
    }
  }
  if (errors.length) throw new Error(`surface_setup deterministic packet validation failed: ${errors.join('; ')}`);
}


export async function surfaceSetup(payload) {
  // #32 A+ requires pillar_breakdown — these setups carry the most risk
  // and the trader needs the alignment view. Reject A+ without it
  // so Claude retries with the missing field.
  if (payload.grade === "A+" && (!Array.isArray(payload.pillar_breakdown) || payload.pillar_breakdown.length < 2)) {
    throw new Error("surface_setup: grade A+ requires pillar_breakdown with at least 2 pillars");
  }
  // Deterministic audit: when the walker chain produced a packet for this
  // bar, any surfaced setup must match it exactly. Strict (reject) mode —
  // the chain decides; callers narrate.
  if (_currentDeterministicPacket) {
    validateSetupAgainstDeterministicPacket(payload, _currentDeterministicPacket);
  }
  const dir = await activeSessionDir();
  const file = path.join(dir, "setups.jsonl");
  const id = payload.id || `S-${Date.now().toString(36)}`;
  const record = { ...payload, id, ts: new Date().toISOString() };

  // #43 Snapshot the slim bundle Claude analyzed for this setup. The
  // live state/last-scan.slim.json gets overwritten constantly; if the
  // trader (or auditor) wants to know "what data did Claude see when
  // setup S-Xyz fired", this is the only way to reproduce it.
  try {
    const slimPath = path.join(REPO_ROOT, "state", "last-scan.slim.json");
    const slim = await fs.readFile(slimPath, "utf8");
    const snapshotsDir = path.join(dir, "setup-bundles");
    await fs.mkdir(snapshotsDir, { recursive: true });
    await writeAtomic(path.join(snapshotsDir, `${id}.json`), slim);
  } catch { /* no slim bundle yet — skip snapshot */ }
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

export async function surfaceNoTrade({
  reason,
  evaluationStatus,
  blockers,
  sourceHealth,
  strategyChainStatus,
  evidenceRefs,
  eventTimeUtc,
} = {}) {
  if (_currentDeterministicPacket?.status === 'executable' && _currentDeterministicPacket?.finalVerdict === 'manual_candidate') {
    throw new Error('surface_no_trade: executable deterministic packet is active. Use surface_setup with the deterministic packet values; no-trade would hide packet truth.');
  }
  // #19 If a surface_setup just fired in this turn, surface_no_trade
  // would race with it — UI shows whichever lands last. The setup is
  // the higher-value signal; ignore no_trade if a setup is live and
  // less than the same-turn window old.
  const recentSetupMs = _lastSetupTs ? Date.now() - _lastSetupTs : Infinity;
  if (_currentSetup && recentSetupMs < SETUP_WINDOW_MS) {
    // eslint-disable-next-line no-console
    console.warn(`[surface] surface_no_trade("${reason}") suppressed — surface_setup ${Math.round(recentSetupMs/1000)}s ago wins`);
    _send?.("app:error", {
      source: "surface_no_trade",
      level: "warn",
      message: `no_trade suppressed: setup still in play (${Math.round(recentSetupMs/1000)}s old)`,
    });
    return { ok: true, suppressed: true };
  }
  const noTradeRecord = {
    reason,
    ...(evaluationStatus ? { evaluationStatus } : {}),
    ...(Array.isArray(blockers) ? { blockers } : {}),
    ...(sourceHealth ? { sourceHealth } : {}),
    ...(strategyChainStatus ? { strategyChainStatus } : {}),
    ...(Array.isArray(evidenceRefs) ? { evidenceRefs } : {}),
    ...(eventTimeUtc ? { eventTimeUtc } : {}),
  };
  emitToolCall("surface_no_trade", noTradeRecord);
  const dir = await activeSessionDir();
  await fs.appendFile(path.join(dir, "no-trades.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...noTradeRecord }) + "\n", "utf8");
  _currentSetup = null;
  _currentNoTradeReason = reason;
  _currentNoTrade = noTradeRecord;
  return { ok: true };
}

// Called when the trader accepts/rejects a setup — clears the mirror
// so a remount doesn't re-show an already-acted-on setup.
export function clearCurrentSurfaceState() {
  _currentSetup = null;
  _currentNoTradeReason = null;
  _currentNoTrade = null;
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
  // no_trade_reason cross-validation. The chain depends on this to route
  // hard (data/engine/closed) vs soft (chop/htf_unclear) short-circuits.
  if (payload.pillar_grade === "no-trade" && !payload.no_trade_reason) {
    throw new Error(
      `surface_session_brief: pillar_grade "no-trade" requires no_trade_reason ` +
      `(one of: data_gap, engine_stale, pillar2_poor, htf_unclear, session_closed). ` +
      `Without it, downstream phases can't route hard vs soft short-circuit.`,
    );
  }
  if (payload.pillar_grade !== "no-trade" && payload.no_trade_reason) {
    throw new Error(
      `surface_session_brief: no_trade_reason set ("${payload.no_trade_reason}") ` +
      `but pillar_grade is "${payload.pillar_grade}" — reason only valid with no-trade grade.`,
    );
  }
  // chain_status auto-derive when model omits it. The brief observably
  // forgets to set it (optional in Zod). Derive from pillar_grade +
  // no_trade_reason so the audit field is never null:
  //   no-trade + reason → "degraded:<reason>"
  //   anything else     → "clean"
  if (!payload.chain_status) {
    payload.chain_status = payload.no_trade_reason
      ? `degraded:${payload.no_trade_reason}`
      : "clean";
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
  // Grade semantics: B means EXACTLY ONE weaker element across Pillars 1+2.
  // Two pillars marked weak/fail → the grade should be no-trade. Observed
  // 2026-05-26: London brief surfaced pillar_grade=B with Pillar 1=weak +
  // Pillar 2=weak, contradicting CLAUDE.md constraint #9. Reject here so
  // the next turn re-grades correctly.
  if (payload.pillar_grade === "B" && Array.isArray(payload.pillars)) {
    const weakOrFail = payload.pillars.filter((p) => p.status === "weak" || p.status === "fail").length;
    if (weakOrFail >= 2) {
      throw new Error(
        `surface_session_brief: pillar_grade "B" with ${weakOrFail} weak/fail pillars — ` +
        `B requires exactly one weaker element. Per CLAUDE.md #9, two or more weak/missing → no-trade. ` +
        `Either re-grade as no-trade, or strengthen the cited evidence to lift a pillar from weak to pass.`,
      );
    }
  }
  // Grade semantics: A+ rejects ANY weak/fail pillar. A+ means all elements
  // aligned. Mixed pillar statuses + A+ grade is internally inconsistent.
  if (payload.pillar_grade === "A+" && Array.isArray(payload.pillars)) {
    const weakOrFail = payload.pillars.filter((p) => p.status === "weak" || p.status === "fail").length;
    if (weakOrFail >= 1) {
      throw new Error(
        `surface_session_brief: pillar_grade "A+" with ${weakOrFail} weak/fail pillar(s) — ` +
        `A+ requires every pillar to be 'pass'. Downgrade to B (one weak) or no-trade (two+ weak).`,
      );
    }
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
// #53 Dedup guard. Claude can call surface_open_reaction twice in one
// turn (retries, iterations). Same minutes_into_phase + bias within
// 30s = same read; suppress to keep open-reaction.json terse.
const OPEN_REACTION_DEDUP_MS = 30_000;
let _lastOpenReaction = { ts: 0, key: null };

export async function surfaceOpenReaction(payload) {
  const dedupeKey = `${payload.minutes_into_phase}-${payload.bias_direction}`;
  const sinceLast = Date.now() - _lastOpenReaction.ts;
  if (_lastOpenReaction.key === dedupeKey && sinceLast < OPEN_REACTION_DEDUP_MS) {
    // eslint-disable-next-line no-console
    console.warn(`[surface] open-reaction dedup: "${dedupeKey}" ${Math.round(sinceLast/1000)}s ago`);
    return { ok: true, deduped: true };
  }
  _lastOpenReaction = { ts: Date.now(), key: dedupeKey };

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

// Resolve the actual phase from the ET clock + session window, not just
// the session arg. Observed live 2026-05-26 NY PM 13:09 ET: model called
// surface_open_reaction(session="ny-pm") 21 min BEFORE the actual open
// at 13:30 ET, and the file got phase=open_reaction_ny_pm. Downstream
// consumers (entry_hunt preamble, wrap) read this as "open-reaction
// happened" when really it's pre-session observation.
function actualPhaseForSession(session) {
  const sess = (session || "ny-am").replace("-", "_");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  const m = get("hour") * 60 + get("minute");
  // Session windows (ET):
  //  ny-am:  pre 08:00-09:30 | open_reaction 09:30-09:45 | entry_hunt 09:45-12:00 | post 12:00+
  //  ny-pm:  pre 12:00-13:30 | open_reaction 13:30-13:45 | entry_hunt 13:45-16:00 | post 16:00+
  //  london: pre 01:00-03:00 | open_reaction 03:00-03:15 | entry_hunt 03:15-06:00 | post 06:00+
  const windows = {
    ny_am:  { open: 9 * 60 + 30,  rxnEnd: 9 * 60 + 45,  postStart: 12 * 60 },
    ny_pm:  { open: 13 * 60 + 30, rxnEnd: 13 * 60 + 45, postStart: 16 * 60 },
    london: { open: 3 * 60,        rxnEnd: 3 * 60 + 15,  postStart: 6 * 60 },
  };
  const w = windows[sess];
  if (!w) return `open_reaction_${sess}`;          // unknown session — fallback to old behavior
  if (m < w.open)         return `pre_session_${sess}`;
  if (m < w.rxnEnd)       return `open_reaction_${sess}`;
  if (m < w.postStart)    return `entry_hunt_${sess}`;
  return `post_${sess}`;
}

function renderOpenReactionMd({ session, reads, ts }) {
  const [latest, ...prior] = reads;
  const phase = actualPhaseForSession(session);
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
  // Cross-check entry_model_priority against the deterministic resolver.
  // Catches model errors silently violating the decision tree. We don't
  // throw — the model's "undecided" is always honored — but we log a
  // warning when the picked priority doesn't match what the inputs imply.
  if (payload.entry_model_priority !== undefined && payload.entry_model_priority !== "undecided") {
    try {
      const { computeEntryModelPriority } = await import("../../../cli/lib/entry-model-priority.js");
      const expected = computeEntryModelPriority({
        pillar2_verdict: payload.pillar2_verdict,
        htf_ltf_alignment: payload.htf_ltf_alignment,
        ltf_bias: payload.ltf_bias,
        failure_swings: payload.failure_swings_present ? [{ event: "mss", validation: "sweep" }] : [],
        most_recent_structure: payload.most_recent_structure || null,
        inverted_fvg_present: !!payload.inverted_fvg_present,
      });
      if (expected.priority !== payload.entry_model_priority) {
        // eslint-disable-next-line no-console
        console.warn(
          `[surface.ltf_bias] entry_model_priority mismatch: got "${payload.entry_model_priority}", ` +
          `expected "${expected.priority}" (reason: ${expected.reason}). ` +
          `Honoring model's choice but flagging.`,
        );
      }
    } catch (err) {
      // Resolver import or call failed — don't block the surface.
      // eslint-disable-next-line no-console
      console.warn(`[surface.ltf_bias] entry_model_priority cross-check skipped: ${err?.message || err}`);
    }
  }
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
  // Codex wrap commentary (applied by runDirectSessionWrap when the codex
  // CLI is available) landed only in summary.json — REVIEW renders this md,
  // so the analysis was invisible (observed 2026-06-12 London wrap).
  const codex = record.codex_analysis;
  const codexBlock = codex?.commentary
    ? `
## Analysis (Codex commentary)
${codex.commentary}
${(codex.risk_challenges || []).length ? `\n**Risk challenges:**\n${codex.risk_challenges.map((r) => `- ${r}`).join("\n")}` : ""}
${codex.confidence_note ? `\n_${codex.confidence_note}_` : ""}
`
    : "";
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
${codexBlock}
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

export const __test = { renderSummaryMd };
