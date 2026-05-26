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
