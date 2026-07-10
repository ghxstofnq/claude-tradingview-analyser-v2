// app/main/coach-digest.js — deterministic performance digest for the weekly
// coach narrator (Track 2 §2b item 2, docs/intent/2026-07-10-unified-goal.md).
//
// Pure builder over the last N recorded session journals (the objects
// getJournalFor returns). EVERY number here is computed in code — the LLM that
// reads this digest produces no arithmetic (CLAUDE.md constraint #7). The coach
// prompt is told to reference only figures present verbatim in this digest.
//
// This module reads RECORDED OUTCOMES ONLY. It imports nothing from the walker
// / gate / strategy modules — it consumes journal folds via the same
// renderer-side review helpers the Review page already uses, so a session's
// discrepancy / chain / faithfulness read matches what the trader sees.

import {
  degradedChainStages,
  computeDiscrepancies,
  assignFillsToTrades,
} from "../renderer/src/Review.helpers.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Latest durable intent per decision_id — pure last-wins fold (mirrors the
// Review page's latestIntentByDecision, kept local so the digest never depends
// on renderer-only code paths).
function latestIntentByDecision(intents = []) {
  const m = new Map();
  for (const r of Array.isArray(intents) ? intents : []) {
    if (r && typeof r === "object" && r.decision_id) m.set(r.decision_id, r);
  }
  return m;
}

// Distinct entry-model names among a session's setups, upper-cased, order-
// preserving. Accepted setups first (they are what actually traded), then any
// other graded model that showed up.
function modelsForSession(setups = []) {
  const seen = new Set();
  const out = [];
  const push = (m) => {
    const v = String(m || "").trim().toUpperCase();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  for (const s of setups) if (s?._disposition === "accepted") push(s?.model);
  for (const s of setups) push(s?.model);
  return out;
}

// One compact row per session. Torn inputs (null journal, missing stats,
// missing arrays) degrade to zeros/nulls — never throw.
function sessionRow(journal) {
  const j = journal || {};
  const stats = j.stats || {};
  const wins = Number(stats.wins) || 0;
  const losses = Number(stats.losses) || 0;
  const net_r = round2(stats.net_r);
  const trades = wins + losses;
  // Session verdict from the equity contribution — win when net R is positive,
  // loss when negative, scratch when flat with trades, none when no trades ran.
  const outcome = trades === 0
    ? "no-trade"
    : net_r > 0 ? "win" : net_r < 0 ? "loss" : "scratch";

  // Chain health from the wrap frontmatter (summary.json chain_audit).
  const degraded = degradedChainStages(j.summary?.chain_audit);
  const chain_status = degraded.length ? "degraded" : "clean";

  // Broker/journal discrepancies where the evidence chain is present (#235):
  // join each folded trade to its fill + durable intent, then count kinds.
  let discrepancies = 0;
  const disc_kinds = {};
  try {
    const fillMap = assignFillsToTrades(j.trades || [], j.fills || []);
    const intentMap = latestIntentByDecision(j.intents);
    for (const t of j.trades || []) {
      if (!t) continue;
      const fill = fillMap.get(t.id) || null;
      const intent = t.decision_id ? intentMap.get(t.decision_id) || null : null;
      if (!fill && !intent) continue; // no evidence chain for this trade
      for (const d of computeDiscrepancies({ fill, intent, journalTrade: t, reconcile: null })) {
        discrepancies += 1;
        disc_kinds[d.kind] = (disc_kinds[d.kind] || 0) + 1;
      }
    }
  } catch {
    // Best-effort — a torn evidence read never sinks the digest.
    discrepancies = 0;
  }

  return {
    date: j.date || null,
    session: j.session || null,
    grade: j.brief?.pillar_grade || null,
    net_r,
    wins,
    losses,
    trades,
    outcome,
    models: modelsForSession(j.setups || []),
    setups: Number(stats.setups) || 0,
    accepted: Number(stats.accepted) || 0,
    gradable: Number(stats.gradable) || 0,
    faithful: Number(stats.faithful) || 0,
    chain_status,
    discrepancies,
    discrepancy_kinds: disc_kinds,
  };
}

// Longest / current win|loss streaks over a chronological (oldest→newest)
// sequence of session verdicts. A scratch or no-trade session breaks a streak
// (neither win nor loss) — it does not extend either direction.
function computeStreaks(chronoRows) {
  let longestWin = 0, longestLoss = 0;
  let runKind = null, runLen = 0;
  for (const r of chronoRows) {
    const kind = r.outcome === "win" ? "win" : r.outcome === "loss" ? "loss" : null;
    if (kind && kind === runKind) {
      runLen += 1;
    } else {
      runKind = kind;
      runLen = kind ? 1 : 0;
    }
    if (runKind === "win") longestWin = Math.max(longestWin, runLen);
    if (runKind === "loss") longestLoss = Math.max(longestLoss, runLen);
  }
  // `current` reflects the most-recent session's active run (from the tail).
  const current = runKind ? { kind: runKind, length: runLen } : { kind: "none", length: 0 };
  return { current, longest_win: longestWin, longest_loss: longestLoss };
}

/**
 * buildCoachDigest(journals, { limit }) — compact JSON digest over the most
 * recent `limit` sessions. `journals` is an array of getJournalFor objects,
 * MOST-RECENT FIRST (as getRecentJournals returns them).
 *
 * Pure. Torn-input tolerant. Returns a stable-shaped object with all numbers
 * pre-computed; the coach LLM turn narrates over it and invents no figures.
 */
export function buildCoachDigest(journals, { limit = 10 } = {}) {
  const src = (Array.isArray(journals) ? journals : []).filter(Boolean).slice(0, limit);
  const rows = src.map(sessionRow); // most-recent first
  const chrono = [...rows].reverse(); // oldest→newest for equity + streaks

  // Aggregates over the window.
  let wins = 0, losses = 0, cum_r = 0;
  let gradable = 0, faithful = 0;
  let clean = 0, degraded = 0, discrepancies = 0;
  const grade_counts = {};
  const model_counts = {};
  for (const r of rows) {
    wins += r.wins;
    losses += r.losses;
    cum_r = round2(cum_r + r.net_r);
    gradable += r.gradable;
    faithful += r.faithful;
    if (r.chain_status === "degraded") degraded += 1; else clean += 1;
    discrepancies += r.discrepancies;
    if (r.grade) grade_counts[r.grade] = (grade_counts[r.grade] || 0) + 1;
    for (const m of r.models) model_counts[m] = (model_counts[m] || 0) + 1;
  }
  const decided = wins + losses;

  // Chronological cumulative-R equity series — lets the coach describe the
  // trend without producing a number of its own.
  let running = 0;
  const equity = chrono.map((r) => {
    running = round2(running + r.net_r);
    return { date: r.date, session: r.session, cum_r: running };
  });

  const sessionR = rows.map((r) => r.net_r);

  return {
    n_sessions: rows.length,
    window: {
      from: chrono[0]?.date || null,
      to: chrono[chrono.length - 1]?.date || null,
    },
    sessions: rows, // most-recent first
    aggregate: {
      wins,
      losses,
      decided,
      trades: decided,
      win_rate: decided ? round2(wins / decided) : null,
      cum_r,
      best_session_r: sessionR.length ? Math.max(...sessionR) : null,
      worst_session_r: sessionR.length ? Math.min(...sessionR) : null,
    },
    streaks: computeStreaks(chrono),
    grade_counts,
    model_counts,
    faithfulness: {
      gradable,
      faithful,
      rate: gradable ? round2(faithful / gradable) : null,
    },
    chain: { clean, degraded },
    discrepancies: { total: discrepancies },
    equity,
  };
}

// hashDigest(digest) — short, stable, order-insensitive-to-JS-key-iteration
// hash of the digest content, used as coach.md's `digest_hash` frontmatter so a
// re-read can tell which digest a narration was generated from. Pure FNV-1a
// over a canonical JSON serialization (sorted keys). Not cryptographic.
export function hashDigest(digest) {
  const json = canonicalJson(digest);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}
