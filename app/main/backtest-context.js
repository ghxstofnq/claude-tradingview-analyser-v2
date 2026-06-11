// backtest-context — session context for the deterministic backtest engine.
//
// The recording loop (cli/lib/tape-recorder.js#recordEntries) needs the same
// per-session context the live chain reads from disk: leader, ltf bias,
// pillar state, untaken targets, brief digest. Two sources, in precedence
// order:
//   1. loadDayContext — the day actually ran live: read its brief.json +
//      ltf-bias.md from state/session/<date>/<session>/. Replaying a
//      recorded day through the chain is the primary regression use.
//   2. contextFromBriefPayloads — no day state: the engine runs the
//      deterministic brief at the replay anchor and synthesizes a context
//      from its payloads. grade_cap is forced to B — same rule as the live
//      catch_up backfill (chain_status backfilled:* caps at B), because the
//      open-reaction leg never ran.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SESSION_ROOT = path.join(REPO_ROOT, "state", "session");

const HARD_NO_TRADE = new Set(["data_gap", "engine_stale", "session_closed"]);

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

function parseFrontmatter(txt) {
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_\-.]+):\s*"?([^"#]*?)"?\s*$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

function drawPrice(draw) {
  if (!draw) return null;
  for (const key of ["top", "price", "ce", "bottom"]) {
    if (Number.isFinite(draw[key])) return draw[key];
  }
  return null;
}

function biasFromDraw(draw) {
  const dir = String(draw?.dir ?? "").toLowerCase();
  if (dir.startsWith("bear")) return "bearish";
  if (dir.startsWith("bull")) return "bullish";
  return null;
}

function buildContext({ session, leader, brief, ltf }) {
  const draw = brief?.primary_draw ?? null;
  return {
    session,
    leader,
    ltf_bias_context: {
      bias: ltf.bias,
      htf_ltf_alignment: ltf.htf_ltf_alignment,
      is_retrace_day: ltf.is_retrace_day === true || ltf.is_retrace_day === "true",
      entry_model_priority: ltf.entry_model_priority,
      grade_cap: ltf.grade_cap,
    },
    session_state: {
      pillar1: {
        status: brief?.pillar_grade === "no-trade" ? "fail" : "pass",
        htfBias: ltf.bias ?? biasFromDraw(draw),
        htfDraw: brief?.htf_destination ?? null,
        primaryDraw: draw ?? null,
      },
      pillar2: {
        status: String(brief?.pillar2_verdict ?? "pass").toLowerCase() === "fail" ? "fail" : "pass",
        verdict: brief?.pillar2_verdict ?? null,
      },
    },
    untaken_targets: {
      untaken_above: brief?.overnight_block?.untaken_above ?? [],
      untaken_below: brief?.overnight_block?.untaken_below ?? [],
    },
    brief_digest: {
      htf_destination: {
        dir: biasFromDraw(draw) === "bearish" ? "below" : "above",
        price: drawPrice(draw),
        cite: draw?.cite ?? "brief.primary_draw",
      },
      primary_draw: {
        name: draw ? `${draw.tf ?? ""} ${draw.kind ?? "draw"}`.trim() : "brief draw",
        price: drawPrice(draw),
        cite: draw?.cite ?? "brief.primary_draw",
      },
    },
  };
}

/**
 * Context from a day that ran live. Requires BOTH the brief and the
 * ltf-bias handoff — without them the chain would block every bar anyway
 * (missing_ltf_bias etc.), so the engine falls back to the direct brief.
 */
export async function loadDayContext({ date, session, sessionRoot = DEFAULT_SESSION_ROOT }) {
  const dir = path.join(sessionRoot, date, session);
  let ltf;
  try {
    ltf = parseFrontmatter(await fs.readFile(path.join(dir, "ltf-bias.md"), "utf8"));
  } catch {
    return null;
  }
  if (!ltf.bias && !ltf.leader) return null;

  const leader = ltf.leader ?? null;
  let brief = null;
  const candidates = [leader ? `brief-${leader}.json` : null, "brief.json"].filter(Boolean);
  for (const name of candidates) {
    try { brief = await readJson(path.join(dir, name)); break; } catch { /* next */ }
  }
  if (!brief) return null;

  return buildContext({
    session,
    leader: leader ?? brief.symbol ?? null,
    brief,
    ltf: {
      bias: ltf.bias ?? null,
      htf_ltf_alignment: ltf.htf_ltf_alignment ?? null,
      is_retrace_day: ltf.is_retrace_day,
      entry_model_priority: ltf.entry_model_priority ?? "undecided",
      grade_cap: ltf.grade_cap ?? "B",
    },
  });
}

/**
 * Synthetic context from deterministic brief payloads (no day state).
 * Returns null when no payload carries a usable draw, or when the leading
 * payload is a hard no-trade (data_gap and friends) — the run must report
 * the gap, not trade through it.
 */
export function contextFromBriefPayloads({ session, payloads = [] }) {
  const lead = payloads.find((p) => p?.primary_draw) ?? null;
  if (!lead) return null;
  if (lead.pillar_grade === "no-trade" && HARD_NO_TRADE.has(lead.no_trade_reason)) return null;

  return buildContext({
    session,
    leader: lead.symbol ?? null,
    brief: lead,
    ltf: {
      bias: biasFromDraw(lead.primary_draw),
      htf_ltf_alignment: "aligned",
      is_retrace_day: false,
      entry_model_priority: "undecided",
      // The open-reaction leg never ran for this day — cap at B, same as
      // the live catch_up backfill rule.
      grade_cap: "B",
    },
  });
}
