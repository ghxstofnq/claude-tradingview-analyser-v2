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
