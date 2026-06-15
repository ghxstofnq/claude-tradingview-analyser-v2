// app/main/execution/tranche-manager.js
// Tranche manager — decides what to do with each bar's surfaced packet, across
// the three automation modes. The pure decision core (planTrancheAction) is
// unit-tested here; the runtime that talks to the journal + broker is added in
// a later task. Detection rules are the shared, backtest-parity module.
import { canScaleInto, isNearDuplicate } from "../../../cli/lib/scale-in-rules.js";

// Pure decision: what to do with this bar's surfaced packet.
// Returns { action, reason }. action ∈
//   none | blocked:halt | open_anchor | surface |
//   open_add | skip:opposite | skip:not_greenlit | skip:dup |
//   blocked:breaker | blocked:max_adds | blocked:cap
export function planTrancheAction({
  bestPacket, openTranches = [], price, mode = "manual", maxAdds = 5,
  combinedCapUsd = null, openRiskUsd = 0, addRiskUsd = 0,
  addsDisabled = false, lossHalt = false, takenLog = [],
} = {}) {
  if (!bestPacket) return { action: "none", reason: "no packet" };
  if (lossHalt) return { action: "blocked:halt", reason: "3-loss session halt" };

  const anchor = openTranches.find((t) => t.tranche_role === "anchor") || openTranches[0];
  if (!anchor) {
    // No open position → this is an anchor candidate.
    if (mode === "auto") return { action: "open_anchor", reason: "auto anchor" };
    return { action: "surface", reason: "manual anchor" };
  }

  if (bestPacket.side !== anchor.side) return { action: "skip:opposite", reason: "opposite side — no reverse via add" };
  if (!anchor.greenLight) return { action: "skip:not_greenlit", reason: "anchor not 50% to TP1" };
  if (addsDisabled) return { action: "blocked:breaker", reason: "2 add stop-outs in a row" };
  if (openTranches.length >= 1 + maxAdds) return { action: "blocked:max_adds", reason: `max ${maxAdds} adds` };
  if (isNearDuplicate(bestPacket, takenLog)) return { action: "skip:dup", reason: "10-min same-side duplicate" };
  if (combinedCapUsd != null && openRiskUsd + addRiskUsd > combinedCapUsd) {
    return { action: "blocked:cap", reason: `combined risk > $${combinedCapUsd}` };
  }
  // canScaleInto is the authority; the checks above give precise reasons.
  if (!canScaleInto({ anchor, setup: bestPacket, openCount: openTranches.length, takenLog, maxAdds })) {
    return { action: "skip:dup", reason: "canScaleInto rejected" };
  }
  if (mode === "manual") return { action: "surface", reason: "manual add — human accepts" };
  return { action: "open_add", reason: "auto add" };
}
