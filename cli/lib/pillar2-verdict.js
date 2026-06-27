/**
 * pillar2-verdict.js — Pillar 2 price-action quality verdict (good|marginal|poor).
 *
 * "You can never outrade bad price." (PRICE 27:25) Pillar 2 is the MASTER GATE:
 * a `poor` verdict stands the session aside regardless of bias. docs/strategy/price-action.md.
 *
 * PRIMARY signal = directional COHERENCE (engine field `coherence`, an efficiency
 * ratio = net move / gross path travelled). Added 2026-06-23 after calibration
 * showed the engine's clean-bar `displacement` count gets price quality BACKWARDS:
 * a two-sided whipsaw (oracle 06-17 — sold, ~85% bounce, sold) prints clean-bodied
 * bars in BOTH directions, so `displacement` reads "clean" and the day looks good,
 * when it is exactly the stand-aside chop. Coherence captures follow-through: low =
 * round-trip/whipsaw (poor), high = clean directional delivery (good). It is
 * TF-dependent in magnitude (finer TF = more path wiggle = lower ratio), so it is
 * read off the 15m row — follow-through is a higher-TF judgment anyway.
 *
 * Verified on the oracle (2026-06-23, 15m trailing median): 06-16 good ~0.81,
 * 06-18 marginal ~0.39, 06-17 poor ~0.23.
 *
 * Engine quality-row enums (cli/lib/ict-engine-parser.js, pine/ict-engine.pine):
 *   range_quality: na | good | tight
 *   displacement : na | clean | acceptable | weak     (bar decisiveness — fallback only)
 *   candle       : engulfing | normal | doji_wick
 *   regime       : displacement | consolidation
 *   coherence    : 0..1 efficiency ratio (na until the window fills)
 */

const STATUS = { good: 'pass', marginal: 'weak', poor: 'fail' };

// Directional-coherence bands, read off the 15m row (see header). Calibration
// knobs — tuned against the oracle, revisit as the golden set grows.
const COH_GOOD = 0.55; // >= -> clean follow-through
const COH_POOR = 0.30; // <= -> two-sided / whipsaw (stand aside)

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Fallback per-row read (used only when no coherence field is present — older
 * captures / pre-coherence test fixtures). One schema-4 quality row →
 * 'good' | 'marginal' | 'poor' | null. null = not enough bars (na/na).
 */
export function rowVerdict(q) {
  if (!q) return null;
  const range = q.range_quality;
  const disp = q.displacement;
  const candle = q.candle;
  if ((range === 'na' || range == null) && (disp === 'na' || disp == null)) return null;

  // Hard stand-aside (master gate) — "good price displaces, bad price
  // consolidates". Any one of these is decisive: a tight 3h range (the verbatim
  // "28pt/3h = stand aside" test, PRICE 30:12), no displacement at all, or
  // two-sided doji delivery without decisive displacement.
  if (range === 'tight') return 'poor';
  if (disp === 'weak') return 'poor';
  if (candle === 'doji_wick' && disp !== 'clean') return 'poor';

  const displacing = q.regime === 'displacement'
    || (q.regime == null && (disp === 'clean' || disp === 'acceptable') && range === 'good');
  if (displacing && candle !== 'doji_wick') return 'good';

  return 'marginal';
}

/**
 * Session verdict. A tight 3h range vetoes on its own (dead environment). The
 * primary read is the 15m directional coherence; when it is absent (older
 * capture / fixture) fall back to the per-row displacement/candle aggregation.
 *
 * @param {{m5?:object, m15?:object, current_tf?:object}} pillar2
 * @returns {{verdict:'good'|'marginal'|'poor', status:'pass'|'weak'|'fail'}}
 */
export function pillar2Verdict({ m5, m15, current_tf } = {}) {
  const ltf = [m5, m15].filter(Boolean);
  const rows = ltf.length ? ltf : [current_tf].filter(Boolean);
  if (!rows.length) return { verdict: 'poor', status: 'fail' };

  // A tight 3h range is a macro stand-aside — vetoes even if a TF still shows a
  // clean bar (the whole environment is a micro-chop band; 28pt/3h, PRICE 30:12).
  if (rows.some((r) => r?.range_quality === 'tight')) return { verdict: 'poor', status: STATUS.poor };

  // PRIMARY: directional coherence off the 15m row — the follow-through tell the
  // clean-bar displacement count gets backwards (oracle 06-17 whipsaw).
  const coh = num(m15?.coherence);
  if (coh != null) {
    const verdict = coh <= COH_POOR ? 'poor' : coh >= COH_GOOD ? 'good' : 'marginal';
    return { verdict, status: STATUS[verdict] };
  }

  // FALLBACK (no 15m coherence): per-row displacement/candle. All graded rows
  // poor → stand aside (06-17); all clean → good; a mix → marginal (06-18).
  const verdicts = rows.map(rowVerdict).filter((v) => v != null);
  if (!verdicts.length) return { verdict: 'poor', status: 'fail' };
  const verdict = verdicts.every((v) => v === 'poor') ? 'poor'
    : verdicts.every((v) => v === 'good') ? 'good'
      : 'marginal';
  return { verdict, status: STATUS[verdict] };
}
