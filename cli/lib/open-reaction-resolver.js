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
 * sweep rows carry the wick-break + `rejected` (close back through)
 * verdicts; since 2026-06-13 the resolver ALSO reads the window's own 1m
 * closes (GXNQ ruling, June 11 open: LO.H broke 09:51, closes returned
 * under the level 09:57/09:59 inside the window, yet the engine flag
 * stayed false and the day resolved long). A window close back through the
 * swept level IS the §7-Step-4 rejection, flag or no flag.
 */

const OVERNIGHT_TARGETS = new Set(['AS.H', 'AS.L', 'LO.H', 'LO.L']);

// §2.4 + §3 divergent-clean gate: a retrace (divergent) trade is lower-conviction
// and demands a CLEAN open rejection. If price ACCEPTED the swept break for this
// many window closes before fading back through, the retrace signal is weak →
// stand aside. Threshold calibrated on the May-June corpus: acceptance of 1-4
// bars still reversed reliably (May 25 +5.85R, May 29 +11.92R — both 4-bar
// reclaims), while >= 5 bars failed (May 22, May 14 @9). Gating at >= 5 catches
// the two genuine accept-then-fade losers without harming the 4-bar winners that
// a tighter cut (4) discarded. Frozen June 8-12 = 60.08R at every threshold.
const ACCEPT_BARS_MAX = 5;

/**
 * §2.2: "One session creates liquidity, another delivers into it." The PM
 * open reacts to the MORNING session's high/low, so NYAM.H/L join the
 * target set for ny-pm. ny-am / london read the overnight set.
 */
export function overnightTargetsForSession(session) {
  if (session === 'ny-pm') {
    return new Set([...OVERNIGHT_TARGETS, 'NYAM.H', 'NYAM.L']);
  }
  return new Set(OVERNIGHT_TARGETS);
}

function isHighLevel(name) {
  return /\.H$/.test(name);
}

function sweepRejected(sweep, closes, endMs, ignoreEngineFlag = false) {
  // The engine's `rejected` flag has no timestamp and can MATURE after the open
  // window closes (a wick-rejection the engine confirms minutes later). The
  // backtest never sees that — it freezes the open read at minute 30. Live
  // recomputes every bar, so post-window it would pick up the matured flag and
  // flip a frozen verdict (2026-06-01 PM: bullish at +30m → bearish at +33m).
  // ignoreEngineFlag lets the live post-window recompute rely ONLY on the
  // window-confined closes (now full-coverage via window-closes.js), matching
  // the backtest's frozen verdict. In-window resolution still trusts the flag.
  if (!ignoreEngineFlag && sweep?.rejected === true) return true;
  const level = Number(sweep?.price);
  if (!Number.isFinite(level)) return false;
  const high = isHighLevel(String(sweep?.target ?? ''));
  return closes.some((c) =>
    Number.isFinite(c?.time_ms) && Number.isFinite(c?.close)
    && c.time_ms > sweep.swept_ms && c.time_ms <= endMs
    && (high ? c.close < level : c.close > level));
}

// Lanto (How-I-Develop-Daily-Bias class, ~26:46–31:26): a sustained counter-HTF
// move is a DISPLACED CONTINUATION — not a weak accept-then-fade — when the break
// direction carries displacement. "Displacement is key… recognize what a
// retracement is versus a reversal… you have to see mass displacement." The
// accept-bars heuristic alone can't separate a strong trend (holds the break for
// many bars because it's genuinely delivering) from a weak fade. A displaced
// MSS/BoS in the BREAK direction, confirmed inside the open window, IS that
// signal — and Lanto reads displacement, not the engine's swing/internal tier,
// so any tier counts. Behind GOFNQ_DIVERGENT_DISPLACED_CONTINUATION (default off)
// pending a corpus fold: the accept-bars gate earns real R killing weak retrace
// shorts, so this must keep that while letting a displaced trend break through.
function hasDisplacedContinuation(structures, dir, startMs, endMs) {
  if (process.env.GOFNQ_DIVERGENT_DISPLACED_CONTINUATION !== '1') return false;
  if (!Array.isArray(structures)) return false;
  return structures.some((s) => {
    if (!s || s.displacement !== true) return false;
    if (s.event !== 'mss' && s.event !== 'bos') return false;
    const sDir = s.dir === 'bear' ? 'bearish' : s.dir === 'bull' ? 'bullish' : null;
    if (sDir !== dir) return false;
    const ms = Number(s.confirmed_ms);
    return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
  });
}

export function resolveOpenReaction({
  htf_bias,
  sweeps = [],
  swing_structure = null,
  window = {},
  overnight_targets = OVERNIGHT_TARGETS,
  window_closes = [],
  in_window_structures = [],
  ignore_engine_rejected_flag = false,
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
  const rejected = sweepRejected(last, Array.isArray(window_closes) ? window_closes : [], endMs, ignore_engine_rejected_flag);

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

  // §2.4 + §3 divergent-clean gate: a DIVERGENT (retrace) trade is lower-conviction,
  // so it demands a CLEAN rejection. "accept-bars" = how many window closes held the
  // BREAK direction before the first close back through. A clean liquidity-grab
  // reverses inside 4 bars; an "accept-then-fade" held the break >= ACCEPT_BARS_MAX
  // (5) bars then faded late — a weak retrace signal that stands aside (May 14: HTF
  // bull, LO.H accepted 9 bars then faded → wrong retrace shorts; May 22 likewise).
  // Clean divergent reclaims are kept (June 11 PM / June 12: 1 bar; May 19 PM; and
  // the May 25 / May 29 4-bar reclaims that ran +5.85R / +11.92R). ALIGNED days are
  // NEVER gated (June 9: aligned shorts, 11 accept-bars, the +37.73R day — the HTF
  // backs them).
  if (!aligned) {
    const lvl = Number(last.price);
    let acceptBars = 0;
    const ordered = (Array.isArray(window_closes) ? window_closes : [])
      .filter((c) => Number.isFinite(c?.time_ms) && Number.isFinite(c?.close)
        && c.time_ms > last.swept_ms && c.time_ms <= endMs)
      .sort((a, b) => a.time_ms - b.time_ms);
    for (const c of ordered) {
      if (high ? c.close > lvl : c.close < lvl) acceptBars++; else break;
    }
    if (acceptBars >= ACCEPT_BARS_MAX) {
      if (!hasDisplacedContinuation(in_window_structures, dir, startMs, endMs)) {
        return {
          interaction: 'divergent_weak_rejection',
          level: last.target,
          ltf_bias: null,
          htf_ltf_alignment: 'unclear',
          is_retrace_day: false,
          grade_cap: 'B',
          cite: `${cite} (divergent + accept_bars=${acceptBars} → weak retrace, stand aside)`,
        };
      }
      // Displaced counter-HTF continuation — Lanto trades the direction price
      // delivered (a 2/3 = B day), not the HTF lean. Fall through to the
      // directional return at the break direction, capped B (§2.3 retrace day).
      interaction = 'displaced_continuation';
      cite = `${cite} (divergent + accept_bars=${acceptBars} but displaced ${dir} continuation → trade B)`;
    }
  }

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
