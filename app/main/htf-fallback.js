// htf-fallback — Pillar 1 HTF-bias fallback for a neutral open.
//
// Strategy §2.4 / §7 Step 7: a NEUTRAL NY-AM open (the open reaction never
// resolves an LTF bias AND no post-window swing structure earns one) is still a
// B trade in the HTF direction ("conviction trade but not A+ ... he will still
// trade, lower conviction"; "B = one weaker element, e.g. neutral overnight"),
// NOT a stand-aside. The chain otherwise hard-blocks the whole session on
// missing_ltf_bias (bar-close evaluateStrategyChainReadiness) — ~45% of sessions.
//
// Fold-verified on the MNQ corpus (2026-06-20): NY-AM only, no delay → +15.1R,
// win-rate 44.7%→46.0%, no extra -3R days. PM neutral opens are usually chop
// (folded NET-worse) so the fallback is NY-AM only. The HTF direction is only
// trusted when nothing else resolved — a later structure (late_direction /
// realignment) always wins because callers apply this ONLY when ltf_bias is null.
//
// Single source of truth so the live resolver (live-ltf-resolver.js) and the
// backtest fold (backtest-engine.js) — two parallel implementations of the §2.3
// open read — can never drift on this rule.

const FALLBACK_SESSIONS = new Set(["ny-am"]);

/**
 * The HTF-fallback verdict patch, or null when it does not apply.
 * @param {object} p
 * @param {string} p.htfBias    HTF bias — 'bullish'/'bearish' or 'above'/'below'.
 * @param {string} p.session    session label.
 * @param {number} p.ms         the bar's timestamp (ms).
 * @param {number} p.windowEndMs open-reaction window end (minute 30).
 */
export function htfFallbackVerdict({ htfBias, session, ms, windowEndMs } = {}) {
  if (process.env.GOFNQ_P1_HTF_FALLBACK === "0") return null; // opt-out (default on)
  if (!FALLBACK_SESSIONS.has(session)) return null;
  if (!Number.isFinite(ms) || !Number.isFinite(windowEndMs) || ms <= windowEndMs) return null;
  const norm = /bull|above/i.test(String(htfBias)) ? "bullish"
    : /bear|below/i.test(String(htfBias)) ? "bearish" : null;
  if (!norm) return null;
  return {
    interaction: "htf_fallback",
    ltf_bias: norm,
    htf_ltf_alignment: "unclear", // honest: no observed NY reaction → deriveGrade keeps it B
    is_retrace_day: false,
    grade_cap: "B",
    cite: "session_state.pillar1.htfBias",
  };
}
