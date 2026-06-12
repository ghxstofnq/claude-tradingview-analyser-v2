/**
 * open-reaction-resolver.js — deterministic NY-open reaction verdict.
 *
 * Strategy authority: docs/strategy/trading-strategy-2026.md
 *   §2.3  LTF bias — NY open flexibility (reaction to overnight H/L decides
 *         today's direction; extension day vs retrace day).
 *   §7 Step 4: break + rejection in HTF-draw direction → LTF aligns (A+
 *         potential); break + continuation against HTF draw → retrace day.
 *   §2.4  Divergent days are "conviction but not A+" → cap B.
 *   §7 Step 7: neutral overnight (no interaction) is a B-grade weakener.
 *
 * Pure function over engine sweep rows — no clocks, no I/O. The engine's
 * sweep rows already carry the wick-break + `rejected` (close back through)
 * verdicts, so no bar math happens here (CLAUDE.md constraint #7).
 */

const OVERNIGHT_TARGETS = new Set(['AS.H', 'AS.L', 'LO.H', 'LO.L']);

function isHighLevel(name) {
  return /\.H$/.test(name);
}

export function resolveOpenReaction({
  htf_bias,
  sweeps = [],
  swing_structure = null,
  window = {},
  overnight_targets = OVERNIGHT_TARGETS,
} = {}) {
  const targets = overnight_targets instanceof Set ? overnight_targets : new Set(overnight_targets);
  const { startMs = -Infinity, endMs = Infinity } = window;

  const interactions = sweeps.filter((s) =>
    targets.has(s?.target) &&
    Number.isFinite(s?.swept_ms) &&
    s.swept_ms >= startMs &&
    s.swept_ms < endMs
  );

  if (interactions.length === 0) {
    return {
      interaction: 'none',
      level: null,
      ltf_bias: null,
      htf_ltf_alignment: 'unclear',
      is_retrace_day: false,
      grade_cap: 'B',
      cite: 'gates.engine.pillar1.sweeps (none in open window)',
    };
  }

  // §2.3: "let NY open reaction confirm or challenge it" — latest wins.
  const last = interactions.reduce((a, b) => (b.swept_ms >= a.swept_ms ? b : a));
  const high = isHighLevel(last.target);
  const rejected = last.rejected === true;

  // Rejection flips direction at the level; continuation keeps the break
  // direction. High-break continuation → bullish; rejected → bearish.
  let interaction = rejected ? 'rejection' : 'continuation';
  let dir = high
    ? (rejected ? 'bearish' : 'bullish')
    : (rejected ? 'bullish' : 'bearish');
  let cite = `gates.engine.pillar1.sweeps[target=${last.target}]`;

  // §7 Step 4: "More importantly: What is the reaction after that break?"
  // A break whose direction opposes the standing SWING-tier structure (the
  // engine's own real-vs-internal separation) is a failed break — the
  // structure, not the break, sets the bias. Sweep rejections are direct
  // §7-Step-4 evidence and are never overridden.
  const structDir = swing_structure?.dir === 'bear' ? 'bearish'
    : swing_structure?.dir === 'bull' ? 'bullish' : null;
  if (!rejected && structDir && structDir !== dir) {
    interaction = 'failed_break';
    dir = structDir;
    cite = `gates.engine.pillar3.structures_by_tier.swing[latest] vs sweeps[target=${last.target}]`;
  }

  const aligned = htf_bias === dir;

  return {
    interaction,
    level: last.target,
    ltf_bias: dir,
    htf_ltf_alignment: aligned ? 'aligned' : 'divergent',
    is_retrace_day: !aligned,
    grade_cap: aligned ? 'A+' : 'B',
    cite,
  };
}
