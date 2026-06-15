// app/main/execution/tranche-exec.js
// Pure mapping from a tranche open / grader transition to the broker actions
// needed on a netting account. Mechanism (M0 spike 2026-06-15 confirmed):
// independent per-tranche STANDALONE stop+limit orders (NOT the position
// auto-bracket, which merges). The resting orders perform the stop/TP exits;
// the engine only acts for the A+ break-even move and the 16:00 close.
//
// The runtime (added with the bar-close wiring) executes these actions via the
// adapter and records the resulting order ids on the tranche so a later
// transition can reference its own stop/limit/sibling.

// A+ runs to TP2 (when there's room); everything else banks at TP1.
function runnerTp(grade, tp1, tp2) {
  return grade === "A+" && tp2 != null && Number.isFinite(Number(tp2)) ? tp2 : tp1;
}

// Opening a tranche: entry at market, plus its OWN standalone stop and limit.
export function brokerActionsForTranche({ side, grade, contracts, entry, stop, tp1, tp2, symbol }) {
  const exitSide = side === "long" ? "sell" : "buy";
  return [
    { kind: "entry", type: "market", side, contracts, symbol, entry },
    { kind: "stop", type: "stop", side: exitSide, contracts, symbol, price: stop },
    { kind: "limit", type: "limit", side: exitSide, contracts, symbol, price: runnerTp(grade, tp1, tp2) },
  ];
}

// A grader transition → the broker action(s) for that tranche.
export function brokerActionsForTransition({ status, grade, entry, side, contracts, symbol, stopOrderId, limitOrderId, siblingOrderId }) {
  if (status === "TP1_HIT") {
    // A+ runner: slide that tranche's stop to break-even. B already exits via
    // its resting TP1 limit — nothing to do.
    return grade === "A+" ? [{ kind: "modify_stop", orderId: stopOrderId, price: entry }] : [];
  }
  if (status === "STOPPED" || status === "TP2_HIT") {
    // One leg filled → cancel the resting sibling so it doesn't open a position.
    return siblingOrderId != null ? [{ kind: "cancel", orderId: siblingOrderId }] : [];
  }
  if (status === "CLOSED_EOD") {
    const acts = [{ kind: "close", side, contracts, symbol }];
    if (stopOrderId != null) acts.push({ kind: "cancel", orderId: stopOrderId });
    if (limitOrderId != null) acts.push({ kind: "cancel", orderId: limitOrderId });
    return acts;
  }
  return [];
}
