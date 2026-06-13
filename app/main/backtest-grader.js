// app/main/backtest-grader.js
// Pure function — given an open trade and the latest closed bar, returns
// the grading outcome. Conservative rule on intra-bar conflict: if a single
// bar's high/low straddles both stop and tp1, assume stop hit first.
//
// Trade shape: { side: "long"|"short", entry, stop, tp1 }
// Bar shape:   { high, low }
// Returns:     { outcome: "pending" }
//              | { outcome: "stop_hit", exit, conflict_bar: bool }
//              | { outcome: "tp1_hit",  exit, conflict_bar: bool }

export function gradeOpenTrade(trade, bar) {
  const { side, stop, tp1 } = trade;
  const { high, low } = bar;

  if (side === "long") {
    const stopHit = low <= stop;
    const tpHit = high >= tp1;
    if (stopHit && tpHit) return { outcome: "stop_hit", exit: stop, conflict_bar: true };
    if (stopHit) return { outcome: "stop_hit", exit: stop, conflict_bar: false };
    if (tpHit) return { outcome: "tp1_hit", exit: tp1, conflict_bar: false };
    return { outcome: "pending" };
  }
  if (side === "short") {
    const stopHit = high >= stop;
    const tpHit = low <= tp1;
    if (stopHit && tpHit) return { outcome: "stop_hit", exit: stop, conflict_bar: true };
    if (stopHit) return { outcome: "stop_hit", exit: stop, conflict_bar: false };
    if (tpHit) return { outcome: "tp1_hit", exit: tp1, conflict_bar: false };
    return { outcome: "pending" };
  }
  throw new Error(`gradeOpenTrade: unknown side: ${side}`);
}

// A+ runner phase (user ruling 2026-06-13): once an A+ trade tags TP1, its
// stop moves to break-even (entry) and the FULL position runs for TP2. From
// then on it can only: hit TP2 (win, R off the ORIGINAL risk), come back to
// entry (the BE stop → 0R scratch), or be force-closed at 16:00. No partial
// bank at TP1 — the whole position rides. Conservative on a conflict bar:
// break-even is checked first (adverse outcome assumed). orig_stop carries the
// original risk so R is measured from it, not the moved BE stop.
export function gradeRunner(trade, bar) {
  const { side, entry, tp2 } = trade;
  const origStop = Number.isFinite(Number(trade.orig_stop)) ? Number(trade.orig_stop) : Number(trade.stop);
  const risk = Math.abs(Number(entry) - origStop);
  const { high, low } = bar;
  const rTo = (px) => (Number.isFinite(risk) && risk > 0
    ? Number(((side === "long" ? Number(px) - Number(entry) : Number(entry) - Number(px)) / risk).toFixed(2))
    : 0);
  if (side === "long") {
    if (low <= entry) return { outcome: "closed_be", exit: entry, realized_r: 0, conflict_bar: high >= tp2 };
    if (high >= tp2) return { outcome: "tp2_hit", exit: tp2, realized_r: rTo(tp2), conflict_bar: false };
    return { outcome: "pending" };
  }
  if (side === "short") {
    if (high >= entry) return { outcome: "closed_be", exit: entry, realized_r: 0, conflict_bar: low <= tp2 };
    if (low <= tp2) return { outcome: "tp2_hit", exit: tp2, realized_r: rTo(tp2), conflict_bar: false };
    return { outcome: "pending" };
  }
  throw new Error(`gradeRunner: unknown side: ${side}`);
}

// End-of-day forced close (user ruling 2026-06-13): a trade still open at
// 16:00 ET is closed at the market — the final bar's close — booking whatever
// it is. It is neither a TP1 nor a stop hit, so realized_r is the SIGNED
// multiple (the close can sit in profit OR loss). The same rule resolves an
// AM trade carried into PM that still hasn't hit a level by 16:00. A runner
// uses its ORIGINAL stop for the risk denominator (its live stop is at BE).
export function closeAtMarket(trade, bar) {
  const { side, entry } = trade;
  const stop = Number.isFinite(Number(trade.orig_stop)) ? Number(trade.orig_stop) : Number(trade.stop);
  const exit = bar.close;
  const risk = Math.abs(Number(entry) - Number(stop));
  const signed = side === "long" ? Number(exit) - Number(entry) : Number(entry) - Number(exit);
  const realized_r = Number.isFinite(risk) && risk > 0 ? Number((signed / risk).toFixed(2)) : 0;
  return { outcome: "closed_1600", exit, realized_r, conflict_bar: false };
}
