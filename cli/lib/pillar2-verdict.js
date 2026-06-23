/**
 * pillar2-verdict.js — Pillar 2 price-action quality verdict (good|marginal|poor).
 *
 * "You can never outrade bad price." (PRICE 27:25) Pillar 2 is the MASTER GATE:
 * a `poor` verdict stands the session aside regardless of bias (it gates Pillars
 * 1 & 3 — bad price into confirmation makes the entry model and the draw
 * unreliable too). docs/strategy/price-action.md.
 *
 * Rebuilt 2026-06-23 (Stage B). The old verdict regex-matched /poor|chop|doji/
 * against the quality row, but the schema-4 engine enums never contain those
 * words for the two stand-aside cases — range_quality:"tight" (the verbatim
 * "28pt/3h = stand aside" test, PRICE 30:12) and displacement:"weak" (the
 * two-sided no-displacement chop, oracle 06-17) — so both were silently ignored
 * and the hard stand-aside never fired. This reads the enums directly.
 *
 * Engine quality-row enums (cli/lib/ict-engine-parser.js, pine/ict-engine.pine):
 *   range_quality: na | good | tight
 *   displacement : na | clean | acceptable | weak
 *   candle       : engulfing | normal | doji_wick
 *   regime       : displacement | consolidation   (engine's own combined read:
 *                  displacement iff clean/acceptable disp AND good range)
 */

const STATUS = { good: 'pass', marginal: 'weak', poor: 'fail' };

/**
 * One schema-4 quality row → 'good' | 'marginal' | 'poor' | null.
 * null = not enough bars yet (na/na) — defer to bias / LLM judgment.
 */
export function rowVerdict(q) {
  if (!q) return null;
  const range = q.range_quality;
  const disp = q.displacement;
  const candle = q.candle;
  if ((range === 'na' || range == null) && (disp === 'na' || disp == null)) return null;

  // Hard stand-aside (master gate) — "good price displaces, bad price
  // consolidates" (price-action.md). Any one of these is decisive:
  //  - a tight 3h range (the verbatim "28pt/3h = stand aside" test, PRICE 30:12)
  //  - no displacement at all (displacement weak)
  //  - two-sided doji delivery without decisive displacement (oracle 06-17)
  if (range === 'tight') return 'poor';
  if (disp === 'weak') return 'poor';
  if (candle === 'doji_wick' && disp !== 'clean') return 'poor';

  // Clean displacing price: decisive displacement on a healthy range, delivery
  // not doji. Trust an explicit regime when the engine ships one; otherwise
  // derive it from the primitives (regime := clean/acceptable disp AND good range).
  const displacing = q.regime === 'displacement'
    || (q.regime == null && (disp === 'clean' || disp === 'acceptable') && range === 'good');
  if (displacing && candle !== 'doji_wick') return 'good';

  // Between — e.g. acceptable displacement on a non-good (but not tight) range,
  // or clean displacement undercut by a doji candle.
  return 'marginal';
}

/**
 * Session verdict from the authoritative 5m/15m rows (§7 Step 3 grades quality
 * on 5m/15m candle anatomy). Falls back to the current-TF row only when both LTF
 * rows are absent (degraded / pillar3-only capture). `poor` on ANY graded LTF
 * row stands the session aside — bad price on the entry TF is decisive — so a
 * single tight-range or chop read vetoes. No quality data → conservative `poor`.
 *
 * @param {{m5?:object, m15?:object, current_tf?:object}} pillar2
 * @returns {{verdict:'good'|'marginal'|'poor', status:'pass'|'weak'|'fail'}}
 */
export function pillar2Verdict({ m5, m15, current_tf } = {}) {
  const graded = (r) => rowVerdict(r) != null;
  const ltf = [m5, m15].filter(graded);
  const rows = ltf.length ? ltf : [current_tf].filter(graded);
  if (!rows.length) return { verdict: 'poor', status: 'fail' };

  // A tight 3h range is a macro stand-aside — it vetoes on its own even if one
  // TF still prints a clean bar (the verbatim "28pt/3h = stand aside" test,
  // PRICE 30:12; the whole environment is a micro-chop band).
  if (rows.some((r) => r.range_quality === 'tight')) return { verdict: 'poor', status: STATUS.poor };

  // Otherwise bad price needs the dominant LTF delivery to be bad. ALL graded
  // rows poor → stand aside (oracle 06-17 — two-sided, no clean fast entry). A
  // mix, where one TF still displaces cleanly, is marginal not a veto (oracle
  // 06-18 — "some displacement but sloppy" = a tradeable B, downsized).
  const verdicts = rows.map(rowVerdict);
  const verdict = verdicts.every((v) => v === 'poor') ? 'poor'
    : verdicts.every((v) => v === 'good') ? 'good'
      : 'marginal';
  return { verdict, status: STATUS[verdict] };
}
