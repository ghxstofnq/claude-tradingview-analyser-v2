// live-ltf-resolver — deterministic LTF-bias fallback for the LIVE chain.
//
// 2026-06-12 London (first live session on the rebuilt pipeline): the LLM
// catch-up turn that writes ltf-bias.md died on an auth error, and every
// live bar blocked on missing_ltf_bias — the exact June failure mode. The
// open-reaction verdict is computable from evidence the engine already
// emits (the backtest engine has used this resolver since PR #20), so the
// live chain must never depend on an LLM turn for it.
//
// Strategy authority: §2.3 / §7 Step 4 via cli/lib/open-reaction-resolver.js.
// Pre-window bars return null — the chain stays honestly blocked until the
// minute-15 boundary, mirroring live ltf-bias.md timing and the backtest.

import { resolveOpenReaction, overnightTargetsForSession } from "../../cli/lib/open-reaction-resolver.js";
import { computeEntryModelPriority } from "../../cli/lib/entry-model-priority.js";
import { openReactionWindowMs } from "./backtest-engine.js";
import { biasFromDraw } from "./backtest-context.js";

function etDateOf(ts) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  // en-CA gives YYYY-MM-DD
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Derive the LTF-bias context for a live bar from the current scan bundle +
 * the session brief. Returns null before the open-reaction boundary or when
 * no HTF bias can be derived (no brief draw) — callers keep their existing
 * (blocked) behavior in those cases.
 */
export function deriveLtfBiasContext({ bundle, brief, session, eventTs } = {}) {
  const date = etDateOf(eventTs);
  if (!date || !session) return null;
  const window = openReactionWindowMs({ date, session });
  const ms = Date.parse(eventTs);
  if (!Number.isFinite(ms) || ms < window.resolveMs) return null;

  const htfBias = biasFromDraw(brief?.primary_draw) ?? null;
  if (!htfBias) return null;

  const gates = bundle?.gates?.engine ?? {};
  const swingStructs = gates?.pillar3?.structures_by_tier?.swing ?? [];
  const swingStructure = swingStructs.reduce(
    (a, b) => ((b?.confirmed_ms ?? 0) >= (a?.confirmed_ms ?? 0) ? b : a),
    null,
  );
  const verdict = resolveOpenReaction({
    htf_bias: htfBias,
    sweeps: gates?.pillar1?.sweeps ?? [],
    swing_structure: swingStructure,
    window,
    overnight_targets: overnightTargetsForSession(session),
  });
  const p3 = gates?.pillar3 ?? {};
  const priority = computeEntryModelPriority({
    pillar2_verdict: brief?.pillar2_verdict ?? null,
    htf_ltf_alignment: verdict.htf_ltf_alignment,
    ltf_bias: verdict.ltf_bias,
    failure_swings: p3.failure_swings ?? [],
    most_recent_structure: p3.most_recent_structure ?? null,
    inverted_fvg_present: (p3.fvgs ?? []).some((f) => f?.state === "inverted"),
  });

  return {
    bias: verdict.ltf_bias,
    htf_ltf_alignment: verdict.htf_ltf_alignment,
    is_retrace_day: verdict.is_retrace_day,
    entry_model_priority: priority.priority,
    grade_cap: verdict.grade_cap,
    source: "deterministic-resolver",
    cite: verdict.cite,
    interaction: verdict.interaction,
    level: verdict.level,
  };
}
