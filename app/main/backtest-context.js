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

/**
 * HTF bias fallback from the primary draw zone alone. Doc-corrected
 * precedence (user Q2 ruling 2026-06-12; full chain in the payload's
 * htf_bias_dir, which buildContext consumes first):
 *   1. Observed reaction off the zone — §2.1 step 3.
 *   2. The zone is a destination — §2.3: today's path points toward it
 *      (below price → bearish path, above → bullish).
 *   3. Legacy fallback: the zone's direction.
 */
export function biasFromDraw(draw) {
  if (!draw) return null;
  const asBias = (d) => {
    const s = String(d ?? "").toLowerCase();
    if (s.startsWith("bear")) return "bearish";
    if (s.startsWith("bull")) return "bullish";
    return null;
  };
  if (draw.reacted && asBias(draw.reaction_dir)) return asBias(draw.reaction_dir);
  // Doc correction (user Q2, 2026-06-12): creation direction removed —
  // §2.3 calls an unreacted zone a DESTINATION; the path toward it is the
  // bias. Reaction evidence (zone or level sweeps) lives in the payload's
  // htf_bias_dir, consumed by buildContext before this fallback.
  if (draw.position === "below_price") return "bearish";
  if (draw.position === "above_price") return "bullish";
  return asBias(draw.dir);
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
        htfBias: ltf.bias ?? brief?.htf_bias_dir ?? biasFromDraw(draw),
        htfDraw: brief?.htf_destination ?? null,
        primaryDraw: draw ?? null,
      },
      pillar2: {
        // Deterministic verdict enum is good|marginal|poor ('fail' kept for
        // legacy LLM briefs). 'poor' must fail the fold's pillar gate —
        // otherwise pillar2_poor no-trade days trade right through it.
        status: /^(fail|poor)$/i.test(String(brief?.pillar2_verdict ?? "pass")) ? "fail" : "pass",
        verdict: brief?.pillar2_verdict ?? null,
      },
    },
    untaken_targets: {
      untaken_above: brief?.overnight_block?.untaken_above ?? [],
      untaken_below: brief?.overnight_block?.untaken_below ?? [],
    },
    brief_digest: {
      htf_destination: {
        // Corrected HTF bias first (matches the brief's htf_bias_dir + the
        // traded side); biasFromDraw is the legacy zone-position fallback that
        // read uptrends as bearish — kept only when no bias is available.
        dir: (brief?.htf_bias_dir ?? biasFromDraw(draw)) === "bearish" ? "below" : "above",
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
    // Strategy §2.3: LTF bias is DECIDED by the NY open reaction — before
    // the open window completes there is no LTF bias, only the HTF draw
    // (kept in session_state.pillar1.htfBias). The backtest engine resolves
    // the open-reaction leg deterministically at the minute-15 boundary
    // (cli/lib/open-reaction-resolver.js) and upgrades this context; until
    // then alignment is honestly unclear and the grade caps at B.
    ltf: {
      bias: null,
      htf_ltf_alignment: "unclear",
      is_retrace_day: false,
      entry_model_priority: "undecided",
      grade_cap: "B",
    },
  });
}
