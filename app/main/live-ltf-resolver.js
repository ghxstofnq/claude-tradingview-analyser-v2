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
  const latestOf = (arr) => arr.reduce(
    (a, b) => ((b?.confirmed_ms ?? 0) >= (a?.confirmed_ms ?? 0) ? b : a),
    null,
  );
  // The open verdict judges the break against the structure standing AS OF
  // the window — post-window structures must not rewrite the open read.
  const inWindowSwing = latestOf(swingStructs.filter((s) => (s?.confirmed_ms ?? 0) <= window.endMs));
  let verdict = resolveOpenReaction({
    htf_bias: htfBias,
    sweeps: gates?.pillar1?.sweeps ?? [],
    swing_structure: inWindowSwing,
    window,
    overnight_targets: overnightTargetsForSession(session),
  });
  // §2.3 + user ruling 2026-06-12: a quiet open leaves the LTF bias
  // PENDING, not the day untradeable — the first swing-tier structure
  // event after the window EARNS the day its direction. Cap stays B:
  // §7 Step 7 counts a neutral overnight as one weaker element even when
  // the late direction aligns with HTF. Stateless per-bar recompute means
  // the LATEST post-window swing structure naturally wins.
  let lateDirection = false;
  if (!verdict.ltf_bias) {
    const postWindowStruct = latestOf(swingStructs.filter((s) =>
      (s?.confirmed_ms ?? 0) > window.endMs && (s?.confirmed_ms ?? 0) <= ms));
    const structBias = postWindowStruct?.dir === "bear" ? "bearish"
      : postWindowStruct?.dir === "bull" ? "bullish" : null;
    if (structBias) {
      const aligned = structBias === htfBias;
      verdict = {
        ...verdict,
        interaction: "late_direction",
        ltf_bias: structBias,
        htf_ltf_alignment: aligned ? "aligned" : "divergent",
        is_retrace_day: !aligned,
        grade_cap: "B",
        cite: "gates.engine.pillar3.structures_by_tier.swing[latest]",
      };
      lateDirection = true;
    }
  }
  // §2.3 "never marries a bias" + §7 Step 5 (MSS = the LTF turning): a
  // SWING-tier MSS confirming AFTER the open window, against the current
  // bias, realigns the day to the structure's direction.
  let realigned = false;
  const postWindowMss = latestOf(swingStructs.filter((s) =>
    s?.event === "mss" && (s?.confirmed_ms ?? 0) > window.endMs && (s?.confirmed_ms ?? 0) <= ms));
  if (postWindowMss && verdict.ltf_bias) {
    const structBias = postWindowMss.dir === "bear" ? "bearish" : postWindowMss.dir === "bull" ? "bullish" : null;
    if (structBias && structBias !== verdict.ltf_bias) {
      const aligned = structBias === htfBias;
      verdict = {
        ...verdict,
        interaction: "mss_realignment",
        ltf_bias: structBias,
        htf_ltf_alignment: aligned ? "aligned" : "divergent",
        is_retrace_day: !aligned,
        grade_cap: aligned ? "A+" : "B",
        cite: "gates.engine.pillar3.structures_by_tier.swing[latest mss]",
      };
      realigned = true;
    }
  }
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
    source: realigned ? "deterministic-resolver:realigned"
      : lateDirection ? "deterministic-resolver:late-direction"
      : "deterministic-resolver",
    cite: verdict.cite,
    interaction: verdict.interaction,
    level: verdict.level,
  };
}
