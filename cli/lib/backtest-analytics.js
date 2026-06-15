// backtest-analytics — pure aggregation over a trade list. Feeds the BACKTEST
// ANALYTICS dashboard and REVIEW TRACK RECORD. No I/O. A "trade" is at least
// { r } and optionally { grade, model, side, outcome, account, bias_aligned }.
// Mirrors the math in scripts/analyze-patterns.mjs.

const round2 = (n) => Math.round(n * 100) / 100;

export function aggregate(trades = []) {
  const n = trades.length;
  const rs = trades.map((t) => Number(t.r) || 0);
  const cumR = round2(rs.reduce((s, v) => s + v, 0));
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const winRate = n ? Math.round((100 * wins.length) / n) : 0;
  const avgWin = wins.length ? round2(wins.reduce((s, v) => s + v, 0) / wins.length) : 0;
  const avgLoss = losses.length ? round2(losses.reduce((s, v) => s + v, 0) / losses.length) : 0;
  const expectancy = n ? round2(cumR / n) : 0;
  const payoff = avgLoss !== 0 ? round2(avgWin / Math.abs(avgLoss)) : 0;
  // equity curve + max drawdown
  let eq = 0, peak = 0, maxDD = 0;
  const equity = [];
  for (const r of rs) {
    eq = round2(eq + r);
    equity.push(eq);
    peak = Math.max(peak, eq);
    maxDD = Math.min(maxDD, round2(eq - peak));
  }
  return { n, cumR, winRate, expectancy, payoff, avgWin, avgLoss, maxDD: round2(maxDD), equity };
}

// Group trades by keyFn and aggregate each group → [{ key, ...stats }].
export function byCut(trades = [], keyFn) {
  const groups = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  return [...groups.entries()].map(([key, ts]) => ({ key, ...aggregate(ts) }));
}

// Outcome breakdown (tp2/tp1/closed/stop/be) — counts + summed R per outcome.
export function outcomeBreakdown(trades = []) {
  const out = {};
  for (const t of trades) {
    const k = t.outcome || "unknown";
    if (!out[k]) out[k] = { n: 0, r: 0 };
    out[k].n += 1;
    out[k].r = round2(out[k].r + (Number(t.r) || 0));
  }
  return out;
}
