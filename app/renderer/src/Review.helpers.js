// Pure helpers for Review.jsx — extracted so they can be unit-tested with
// `node --test`. Importing this file has no side effects.

// Format the grade value for the narrow ledger grade column.
// "no-trade" → "NO" (the full string wraps in the narrow column).
// Everything else passes through ("A+", "B").
export function formatGradeShort(grade) {
  if (grade === "no-trade") return "NO";
  if (grade == null) return "—";
  return String(grade);
}

// Derive the state string + tone for one ledger row.
// Inputs:
//   setup — annotated setup record from review.js getJournalFor
//   trade — matching folded trade (or null if not accepted)
// Output: { label, tone }
//   tone: "green" | "red" | "amber" | "blue" | "dim"
export function deriveLedgerState(setup, trade) {
  const disp = setup?._disposition;
  if (disp === "no-trade") return { label: "NO-TRADE", tone: "amber" };
  if (disp === "rejected") return { label: "REJECTED", tone: "red" };
  if (disp !== "accepted") return { label: "—", tone: "dim" };
  // Accepted — look at the matching trade outcome.
  const outcome = trade?.outcome;
  if (outcome === "TP1_HIT") return { label: "CONFIRMED · TP1", tone: "green" };
  if (outcome === "TP2_HIT") return { label: "CONFIRMED · TP2", tone: "green" };
  if (outcome === "STOPPED") return { label: "STOPPED", tone: "red" };
  if (outcome === "INVALIDATED") return { label: "INVALIDATED", tone: "red" };
  if (trade?.state === "pending_entry") return { label: "PENDING", tone: "blue" };
  if (trade?.state === "filled") return { label: "OPEN", tone: "blue" };
  return { label: "OPEN", tone: "blue" };
}

// Derive the reason string shown in the rightmost ledger column.
// For accepted rows the reason is short — the inline expansion carries
// the full TradeCard. For other rows we surface the no-trade / rejection
// reason so the trader can see why the row landed where it did.
export function deriveLedgerReason(setup, trade) {
  const disp = setup?._disposition;
  if (disp === "no-trade") {
    return setup.no_trade_reason || "no reason given";
  }
  if (disp === "rejected") {
    const r = setup._rejection_reason;
    return r && r.trim() ? r : "rejected · no reason given";
  }
  if (disp === "accepted") {
    const outcome = trade?.outcome;
    if (outcome === "STOPPED" || outcome === "INVALIDATED") {
      return outcome === "STOPPED" ? "stopped" : "invalidated";
    }
    // Default: a short label telling the trader the row is expandable.
    const model = setup.model || trade?.model || "";
    return model ? `${model} · click to expand` : "click to expand";
  }
  return "";
}

// Build the chronological ledger rows.
// Inputs:
//   setups — annotated array from review.js getJournalFor.
//   trades — folded trades array (from useReview.journal.trades).
// Output: [{ setup, trade, state, reason, expandable }]
//
// Rules:
//   - _disposition === "ignored" rows are suppressed.
//   - Rows are sorted by setup.ts ascending; setups missing ts keep
//     their insertion order at the front (defensive — pre-ts data).
//   - Only accepted rows are marked expandable.
//   - The matching trade is found by trade.setup_id === setup.id (when accepted).
export function buildLedger(setups = [], trades = []) {
  const tradesBySetupId = new Map();
  for (const t of trades) {
    if (t && t.setup_id) tradesBySetupId.set(t.setup_id, t);
  }
  const rows = (setups || [])
    .filter((s) => s && s._disposition !== "ignored")
    .map((s) => {
      const trade = s._disposition === "accepted"
        ? (tradesBySetupId.get(s.id) || null)
        : null;
      const state = deriveLedgerState(s, trade);
      const reason = deriveLedgerReason(s, trade);
      return {
        setup: s,
        trade,
        state,
        reason,
        expandable: s._disposition === "accepted" && !!trade,
      };
    });
  // Sort by ts ascending; missing ts keeps insertion order via stable sort.
  rows.sort((a, b) => {
    const ta = a.setup?.ts ? new Date(a.setup.ts).getTime() : Number.NEGATIVE_INFINITY;
    const tb = b.setup?.ts ? new Date(b.setup.ts).getTime() : Number.NEGATIVE_INFINITY;
    return ta - tb;
  });
  return rows;
}

// degradedChainStages — flatten a wrap's chain_audit into the stages that
// actually failed. Enum per CLAUDE.md rule 8: clean / degraded:<reason> /
// backfilled:<phase> / divergent / stale:<min>. Only degraded:* and stale:*
// are failures worth a red strip — divergent is a market verdict and
// backfilled means the chain recovered on its own.
// Honest TRACK RECORD summary over the session-library rows (no per-trade
// fabrication — every number is summed from real per-session totals).
// rows: [{ date, session, grade, total_r, stats:{setups,accepted} }].
// Returns the aggregates the designer's analytics hero/strip/concentration
// can honestly render. Per-trade cuts (expectancy/payoff/by-model) need a
// per-trade pipeline that doesn't exist yet, so they're deliberately absent.
export function buildTrackRecord(rows = []) {
  const r1 = (n) => Math.round(n * 10) / 10;
  // Per-session R lives in stats.net_r (the library row shape); total_r is a
  // forward-compat fallback. Every row is a real session — no-trade days
  // count as 0R sessions.
  const sessR = (r) => Number(r.stats?.net_r ?? r.total_r ?? 0) || 0;
  const list = (rows || []).filter(Boolean);
  const n = list.length;
  const cumR = r1(list.reduce((s, r) => s + sessR(r), 0));
  const wins = list.filter((r) => sessR(r) > 0);
  const losses = list.filter((r) => sessR(r) < 0);
  const best = list.reduce((m, r) => Math.max(m, sessR(r)), 0);
  const worst = list.reduce((m, r) => Math.min(m, sessR(r)), 0);
  const setupsTotal = list.reduce((s, r) => s + (r.stats?.setups || 0), 0);
  const acceptedTotal = list.reduce((s, r) => s + (r.stats?.accepted || 0), 0);

  const groupR = (keyFn) => {
    const m = new Map();
    for (const r of list) {
      const k = keyFn(r);
      const cur = m.get(k) || { k, r: 0, n: 0 };
      cur.r = r1(cur.r + sessR(r));
      cur.n += 1;
      m.set(k, cur);
    }
    return [...m.values()];
  };
  const sessLabel = (s) => ({ "ny-am": "NY-AM", "ny-pm": "NY-PM", london: "LONDON" })[s] || s || "—";
  const bySession = groupR((r) => sessLabel(r.session));
  const byGrade = groupR((r) => r.grade || "—");

  return {
    n_sessions: n,
    cum_r: cumR,
    avg_r: n ? r1(cumR / n) : 0,
    win_sessions: wins.length,
    loss_sessions: losses.length,
    win_pct: n ? Math.round((100 * wins.length) / n) : 0,
    best_r: r1(best),
    worst_r: r1(worst),
    setups_total: setupsTotal,
    accepted_total: acceptedTotal,
    by_session: bySession,
    by_grade: byGrade,
  };
}

// Real TRACK RECORD from actual execution fills (state/trades records).
// Each fill: { side, symbol, account, planned:{entry,stop,tp},
// actual:{entry,exit,usd,r,heldMs} }. Per-trade R is the realized R recorded
// at close (computed in code from realized $ ÷ risk — not fabricated).
export function buildTrackRecordFromFills(fills = []) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const list = (fills || []).filter((f) => f && f.actual && typeof f.actual.r === "number");
  const n = list.length;
  const rs = list.map((f) => f.actual.r);
  const usds = list.map((f) => Number(f.actual.usd) || 0);
  const cumR = r2(rs.reduce((s, v) => s + v, 0));
  const cumUsd = Math.round(usds.reduce((s, v) => s + v, 0));
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const winRate = n ? Math.round((100 * wins.length) / n) : 0;
  const avgWin = wins.length ? r2(wins.reduce((s, v) => s + v, 0) / wins.length) : 0;
  const avgLoss = losses.length ? r2(losses.reduce((s, v) => s + v, 0) / losses.length) : 0;
  const expectancy = n ? r2(cumR / n) : 0;
  const payoff = avgLoss !== 0 ? r2(avgWin / Math.abs(avgLoss)) : 0;
  let eq = 0, peak = 0, maxDD = 0;
  for (const r of rs) { eq = r2(eq + r); peak = Math.max(peak, eq); maxDD = Math.min(maxDD, r2(eq - peak)); }
  const best = rs.length ? r2(Math.max(...rs)) : 0;
  const worst = rs.length ? r2(Math.min(...rs)) : 0;
  return {
    n_trades: n, cum_r: cumR, cum_usd: cumUsd, win_pct: winRate,
    win_n: wins.length, loss_n: losses.length, avg_win: avgWin, avg_loss: avgLoss,
    expectancy, payoff, max_drawdown_r: r2(maxDD), best_r: best, worst_r: worst,
  };
}

export function degradedChainStages(chainAudit) {
  if (!chainAudit || typeof chainAudit !== "object") return [];
  const out = [];
  const visit = (node, prefix) => {
    if (!node || typeof node !== "object") return;
    const status = node.chain_status;
    if (typeof status === "string") {
      if (status.startsWith("degraded") || status.startsWith("stale")) {
        out.push({ stage: prefix, status });
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      visit(child, prefix ? `${prefix}.${key}` : key);
    }
  };
  visit(chainAudit, "");
  return out;
}
