/**
 * last-bar.js — single-bar confirmation facts from an OHLCV bar.
 *
 * Bar-derived, not engine-derived: the ICT Engine emits structure/levels/FVGs
 * but not a raw last-bar OHLC. These facts are pre-computed so the LLM never
 * does candle arithmetic (CLAUDE.md constraint #7); strategy §5 / §7 step 6
 * confirmation discipline reads them. Pure — no CDP, no I/O.
 */

/**
 * Confirmation facts for the most recent bar of a `last_5_bars` array.
 * @param {Array|undefined} last5     OHLCV bars; the last element is "the bar"
 * @param {number|undefined} quoteTime  unix seconds — for the staleness check
 * @returns {{bar: object|null, age_seconds: number|null}}
 */
/**
 * Drop the still-forming (current, incomplete) candle from a `last_5_bars`
 * array so confirmation facts read the just-CLOSED bar — matching the backtest
 * tape recorder (`closedBarsOnly` in cli/lib/tape-recorder.js). A live capture
 * always includes the in-progress candle as the last element (O=H=L=C, ~0
 * volume); building `confirmation.last_bar` off that flat doji means the walker
 * can never read a real confirmation candle (and the bridge's in-current-bar
 * window anchors to the wrong bar), so live surfaces nothing. Root cause found
 * 2026-06-17 — see docs/intent/live-confirmation-surfacing.md.
 *
 * Guarded: only drops when the last bar's period has NOT elapsed relative to
 * `quoteTime` (i.e. it is genuinely still forming). When the timing can't be
 * verified, keeps the array unchanged — never drops a real closed bar.
 * @param {Array|undefined} last5
 * @param {number|undefined} quoteTime  unix seconds of the latest tick
 * @returns {Array}
 */
export function dropFormingBar(last5, quoteTime) {
  if (!Array.isArray(last5) || last5.length < 2) return Array.isArray(last5) ? last5.slice() : [];
  const last = last5[last5.length - 1];
  const prev = last5[last5.length - 2];
  const tf = Number(last.time) - Number(prev.time); // bar spacing (seconds)
  const qt = Number(quoteTime);
  if (!(tf > 0) || !Number.isFinite(qt)) return last5.slice(); // can't verify → keep
  const isForming = qt - Number(last.time) < tf; // last bar's period hasn't closed yet
  return isForming ? last5.slice(0, -1) : last5.slice();
}

export function lastBarFacts(last5, quoteTime) {
  if (!Array.isArray(last5) || last5.length === 0) return { bar: null, age_seconds: null };
  const lb = last5[last5.length - 1];
  const range = lb.high - lb.low;
  const body = Math.abs(lb.close - lb.open);
  const bodyRatio = range > 0 ? Math.round((body / range) * 100) / 100 : 0;
  let direction;
  if (bodyRatio < 0.1) direction = 'doji';
  else if (lb.close > lb.open) direction = 'bullish';
  else if (lb.close < lb.open) direction = 'bearish';
  else direction = 'doji';
  const closePos = range > 0 ? Math.round(((lb.close - lb.low) / range) * 100) / 100 : 0.5;
  return {
    bar: {
      time: lb.time,
      open: lb.open,
      high: lb.high,
      low: lb.low,
      close: lb.close,
      body_ratio: bodyRatio,
      direction,
      range: Math.round(range * 100) / 100,
      close_position_in_range: closePos,
    },
    age_seconds: quoteTime && lb.time ? quoteTime - lb.time : null,
  };
}
