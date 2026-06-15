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

// ── Per-trade R from a resolved trade's levels + outcome ─────────────────
// Code-computed (constraint #7 — Claude never produces a number): the R you'd
// book by rule, not an LLM figure. A TP1/TP2 hit books its true multiple
// |target-entry|/|entry-stop| (swing TP1s pay ≥2R), a stop books −1R, a
// break-even 0. Anything else (a 16:00 force-close, which can land either
// side of flat) defers to the grader's own code-computed realized_r.
export function computeTradeR({ entry, stop, tp1, tp2, outcome, realized_r } = {}) {
  const e = Number(entry), s = Number(stop);
  const risk = Math.abs(e - s);
  switch (outcome) {
    case "tp1_hit": return risk > 0 ? round2(Math.abs(Number(tp1) - e) / risk) : 0;
    case "tp2_hit": return risk > 0 ? round2(Math.abs(Number(tp2) - e) / risk) : 0;
    case "stop_hit": return -1;
    case "closed_be":
    case "be": return 0;
    default:
      return Number.isFinite(Number(realized_r)) ? round2(Number(realized_r)) : 0;
  }
}

// ── Pair a run's setups.jsonl into resolved trades ──────────────────────
// Joins every type:"open" row to its type:"outcome" row (open.id ↔
// outcome.setup_id) and emits one trade with a code-computed R. Open rows
// with no outcome (still pending at session end) are dropped, never
// fabricated. Carries grade/model/side/outcome + entry timestamp for cuts.
export function tradesFromSetups(setups = []) {
  const outcomeBy = new Map();
  for (const r of setups) {
    if (r && r.type === "outcome") outcomeBy.set(r.setup_id, r);
  }
  const trades = [];
  for (const open of setups) {
    if (!open || open.type !== "open") continue;
    const oc = outcomeBy.get(open.id);
    if (!oc) continue;
    trades.push({
      r: computeTradeR({
        entry: open.entry, stop: open.stop, tp1: open.tp1, tp2: open.tp2,
        outcome: oc.outcome, realized_r: oc.realized_r,
      }),
      grade: open.grade ?? null,
      model: open.model ?? null,
      side: open.side ?? null,
      outcome: oc.outcome,
      entry_ts: open.event_ts ?? open.ts ?? null,
    });
  }
  return trades;
}

const SESSION_LABEL = { "ny-am": "NY-AM", "ny-pm": "NY-PM", london: "LONDON" };

const OUTCOME_DISPLAY = {
  tp2_hit:     { k: "TP2 HIT",    tone: "green", order: 0 },
  tp1_hit:     { k: "TP1 HIT",    tone: "green", order: 1 },
  closed_be:   { k: "BREAK-EVEN", tone: "dim",   order: 2 },
  closed_1600: { k: "16:00 CLOSE", tone: "dim",  order: 3 },
  stop_hit:    { k: "STOP",       tone: "red",   order: 4 },
};

// Signed R with the designer's en-dash for negatives.
function sgnR(n) {
  const v = Number(n) || 0;
  return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(round2(v)).toFixed(1) + "R";
}

// ET clock half-hour bucket for an entry timestamp ("09:30–10:00").
// Uses the IANA zone so DST is handled; returns null on an unparseable ts.
function etHalfHourBucket(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const hm = d.toLocaleString("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  });
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const startMin = m < 30 ? 0 : 30;
  const endH = startMin === 30 ? (h + 1) % 24 : h;
  const endMin = startMin === 30 ? 0 : 30;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(h)}:${p(startMin)}–${p(endH)}:${p(endMin)}`;
}

// Session HTF/LTF-alignment verdict → the designer's bias-cut bucket label.
const ALIGN_LABEL = { aligned: "HTF-aligned", divergent: "Counter-trend", unclear: "Unclear" };

// byCut row → BreakdownCard row, sorted by expectancy descending.
function toBreakdown(cuts) {
  return cuts
    .map((c) => ({ k: c.key, exp: c.expectancy, win: c.winRate, n: c.n }))
    .sort((a, b) => b.exp - a.exp);
}

// ── buildAnalytics — assemble the dashboard `A` shape from run details ───
// Input: the array of { entry, setups } objects returned by backtest:get.
// Every figure is code-derived from paired open/outcome rows (constraints
// #6/#7). The bias-alignment cut uses the run's tracked open-reaction verdict
// (entry.open_reaction.htf_ltf_alignment) and is omitted — not faked — only
// when no run carries it. The equity series is the REAL per-trade cumulative R
// — the curve is drawn from data, not a seeded random walk.
export function buildAnalytics(runDetails = []) {
  const trades = [];
  const dates = [];
  for (const rd of runDetails) {
    const session = rd?.entry?.session ?? "unknown";
    const alignment = rd?.entry?.open_reaction?.htf_ltf_alignment ?? null;
    if (rd?.entry?.date) dates.push(rd.entry.date);
    for (const t of tradesFromSetups(rd?.setups ?? [])) {
      trades.push({ ...t, session, bias_alignment: alignment });
    }
  }

  const agg = aggregate(trades);
  const wins = trades.filter((t) => t.r > 0);
  const losses = trades.filter((t) => t.r < 0);
  const bes = trades.filter((t) => t.r === 0);
  const largestWin = wins.length ? round2(Math.max(...wins.map((t) => t.r))) : 0;

  // Session concentration — summed R + trade count per session, by R desc.
  const sessions = byCut(trades, (t) => SESSION_LABEL[t.session] ?? t.session)
    .map((c) => ({ k: c.key, r: c.cumR, n: c.n }))
    .sort((a, b) => b.r - a.r);

  // Outcome breakdown → display rows with tone + per-bucket R range.
  const ob = outcomeBreakdown(trades);
  const outcomes = Object.entries(ob)
    .map(([key, { n }]) => {
      const meta = OUTCOME_DISPLAY[key] ?? { k: key.toUpperCase(), tone: "dim", order: 9 };
      const rs = trades.filter((t) => t.outcome === key).map((t) => t.r);
      const lo = Math.min(...rs), hi = Math.max(...rs);
      const r_each = lo === hi ? sgnR(lo) : `${sgnR(lo)} → ${sgnR(hi)}`;
      return { meta, n, tone: meta.tone, r_each };
    })
    .sort((a, b) => a.meta.order - b.meta.order)
    .map((o) => ({ k: o.meta.k, n: o.n, tone: o.tone, r_each: o.r_each }));

  // Entry-time cut only if at least one trade carries a usable timestamp.
  const byTime = toBreakdown(byCut(
    trades.filter((t) => etHalfHourBucket(t.entry_ts)),
    (t) => etHalfHourBucket(t.entry_ts),
  ));

  // Bias-alignment cut from the run's tracked open-reaction verdict. Omitted
  // (undefined) when no run carries an alignment — never fabricated.
  const biasTrades = trades.filter((t) => ALIGN_LABEL[t.bias_alignment]);
  const byBias = biasTrades.length
    ? toBreakdown(byCut(biasTrades, (t) => ALIGN_LABEL[t.bias_alignment]))
    : undefined;

  const dateRange = dates.length
    ? `${dates.slice().sort()[0]} → ${dates.slice().sort().at(-1)}`
    : "";
  const window_label = [
    `${runDetails.length} SESSION${runDetails.length === 1 ? "" : "S"}`,
    dateRange,
  ].filter(Boolean).join(" · ");

  return {
    window_label,
    n_trades: agg.n,
    n_sessions: runDetails.length,
    cum_r: agg.cumR,
    expectancy: agg.expectancy,
    win_pct: agg.winRate,
    avg_win: agg.avgWin,
    avg_loss: agg.avgLoss,
    payoff: agg.payoff,
    win_n: wins.length,
    loss_n: losses.length,
    be_n: bes.length,
    best_session_r: sessions.length ? sessions[0].r : 0,
    worst_session_r: sessions.length ? sessions.at(-1).r : 0,
    largest_win_r: largestWin,
    max_drawdown_r: agg.maxDD,
    equity: agg.equity,
    by_grade: toBreakdown(byCut(trades, (t) => t.grade ?? "—")),
    by_model: toBreakdown(byCut(trades, (t) => t.model ?? "—")),
    by_time: byTime,
    ...(byBias ? { by_bias: byBias } : {}),
    sessions,
    outcomes,
  };
}
