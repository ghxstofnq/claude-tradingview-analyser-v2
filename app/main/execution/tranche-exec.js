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

import { runnerEligible } from "../../../cli/lib/trade-outcomes.js";

// Pure: given the [entry, stop, limit] placeStandalone results, decide whether
// the bracket is safe or the entry is NAKED (filled with no working protective
// stop). A bracket must be atomic — a naked entry is the worst money-path state
// (audit C13). `naked` is true when the entry placed OK but the stop leg did
// not come back working (rejected, or no order id). Also flags a broker auth
// loss (401/403) so the caller can halt new entries (audit C24).
export function evaluateBracketResults(results = []) {
  const idOf = (r) => { try { return Number(JSON.parse(r?.body).id); } catch { return null; } };
  const entryOk = results[0]?.ok === true;
  const stopOrderId = idOf(results[1]);
  const limitOrderId = idOf(results[2]);
  const stopOk = results[1]?.ok === true && Number.isFinite(stopOrderId);
  const authLost = results.some((r) => r?.status === 401 || r?.status === 403);
  return { entryOk, stopOk, stopOrderId, limitOrderId, naked: entryOk && !stopOk, authLost };
}

// app:error sink (wired from bar-close alongside the ticker sink) so broker
// rejections/failed exits surface to the operator instead of being swallowed.
let _send = null;
export function setExecutionSink(send) { _send = send; }

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

// A grader transition → the broker action(s) for that tranche. `runner` is the
// runner-eligibility of the trade (A+ with TP2 room) — it disambiguates a TP1
// tag: a runner uses TP1 as a break-even MILESTONE (move the stop, keep the
// TP2 limit); a non-runner (B, or A+ with no room) EXITS at its resting TP1
// limit, so its now-orphaned stop sibling must be cancelled (standalone orders
// are not an OCO pair — nothing auto-cancels).
export function brokerActionsForTransition({ status, runner, entry, side, contracts, symbol, stopOrderId, limitOrderId, siblingOrderId }) {
  if (status === "TP1_HIT") {
    if (runner) return [{ kind: "modify_stop", orderId: stopOrderId, price: entry }];
    return siblingOrderId != null ? [{ kind: "cancel", orderId: siblingOrderId }] : [];
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

// Resolve the standalone order ids for a tranche from the journal events
// (latest tranche_orders marker wins) and pick the sibling to cancel for the
// given outcome. Pure — returns the actions, or null when the tranche has no
// standalone orders (a manual/position-bracket trade — leave it to the broker).
export function planTrancheExit(transition, events) {
  const accept = events.find((e) => e.type === "accept" && e.id === transition.id);
  if (!accept) return null;
  const orders = [...events].reverse().find((e) => e.type === "tranche_orders" && e.setup_id === transition.id);
  if (!orders) return null; // not an auto-mode standalone tranche
  const runner = runnerEligible(accept);
  // Which resting order is now orphaned and must be cancelled:
  //   STOPPED → the stop filled → cancel the limit.
  //   TP2_HIT → the TP2 limit filled → cancel the stop.
  //   non-runner TP1_HIT → the TP1 limit filled → cancel the stop.
  //   runner TP1_HIT → milestone (BE move), no sibling cancel.
  const siblingOrderId = transition.status === "STOPPED" ? orders.limitOrderId
    : transition.status === "TP2_HIT" ? orders.stopOrderId
    : (transition.status === "TP1_HIT" && !runner) ? orders.stopOrderId
    : null;
  const actions = brokerActionsForTransition({
    status: transition.status, runner, entry: accept.entry, side: accept.side,
    contracts: Number(accept.size?.contracts ?? accept.size ?? 1) || 1, symbol: accept.symbol,
    stopOrderId: orders.stopOrderId, limitOrderId: orders.limitOrderId, siblingOrderId,
  });
  return { actions, accept, orders };
}

// Tradovate exit plan. Unlike the TV-paper standalone legs, a Tradovate tranche
// carries a NATIVE OCO bracket (SL+TP in the entry POST), so the broker itself
// cancels the sibling when one leg fills — there is no orphan to cancel. The
// only engine-driven actions left are the A+ runner's break-even stop move (at
// TP1) and the 16:00 flatten. Pure — returns the action list, or null when the
// tranche isn't a Tradovate standalone. modify_stop_be moves THIS tranche's own
// stop to ITS OWN entry: `price` is the break-even level (this tranche's entry)
// and `fromStop` is its original stop price, so with several adds open at once
// the right bracket's stop is moved — not whichever stop happens to be first.
export function planTradovateExit(transition, events) {
  const accept = events.find((e) => e.type === "accept" && e.id === transition.id);
  if (!accept) return null;
  const orders = [...events].reverse().find((e) => e.type === "tranche_orders" && e.setup_id === transition.id && e.broker === "tradovate");
  if (!orders) return null; // not a Tradovate tranche
  const actions = [];
  if (transition.status === "TP1_HIT" && runnerEligible(accept)) {
    actions.push({ kind: "modify_stop_be", price: accept.entry, fromStop: accept.stop });
  } else if (transition.status === "CLOSED_EOD") {
    actions.push({ kind: "flatten" }, { kind: "cancel_all" });
  }
  // STOPPED / TP2_HIT / non-runner TP1_HIT → the native OCO bracket self-manages.
  return { actions, accept, orders };
}

// Runtime: apply a grader transition's broker actions for an auto-mode tranche.
// IO injected so the planning is unit-tested without the app. modify_stop is a
// cancel+replace (modify-by-id is unverified); the replacement stop's new id is
// persisted so a later STOPPED cancels the right sibling.
export async function applyTrancheExit(transition, deps) {
  const d = deps || (await buildExitDeps());
  const events = await d.readEvents();
  // Tradovate tranche → native-bracket path (broker self-manages the OCO; we
  // only move the runner stop to BE and flatten at EOD via the Tradovate adapter).
  if (events.some((e) => e.type === "tranche_orders" && e.setup_id === transition.id && e.broker === "tradovate")) {
    const plan = planTradovateExit(transition, events);
    if (!plan || plan.actions.length === 0) return { skipped: true };
    for (const a of plan.actions) {
      if (a.kind === "modify_stop_be") await d.modifyTradovateStop({ stopPrice: a.price, matchStopPrice: a.fromStop });
      else if (a.kind === "flatten") await d.closeTradovatePosition({});
      else if (a.kind === "cancel_all") await d.cancelTradovateOrders();
    }
    return { applied: plan.actions, broker: "tradovate" };
  }
  const plan = planTrancheExit(transition, events);
  if (!plan) return { skipped: true };
  const exitSide = plan.accept.side === "long" ? "sell" : "buy";
  const contracts = Number(plan.accept.size?.contracts ?? plan.accept.size ?? 1) || 1;
  for (const a of plan.actions) {
    if (a.kind === "cancel") await d.cancelOrder(a.orderId);
    else if (a.kind === "close") await d.flatten(a.symbol);
    else if (a.kind === "modify_stop") {
      // Place the replacement BE stop FIRST and confirm its id before cancelling
      // the live stop — never open a naked-runner window (audit C12). If the new
      // stop fails to come back, keep the original stop, surface it, and flatten
      // to be safe rather than leave the runner unprotected.
      const newId = await d.placeStandalone({ symbol: plan.accept.symbol, type: "stop", side: exitSide, contracts, price: a.price });
      if (!Number.isFinite(newId)) {
        // Replacement BE stop failed to place. The ORIGINAL stop was never
        // cancelled, so the runner is still protected — the safe action is to
        // keep it and surface the error, NOT flatten (flatten=close_position
        // doesn't cancel the resting TP2 limit, which would then orphan-reverse
        // the position). A later real transition still manages it. (audit review)
        d.emitError?.({ level: "error", message: `BE stop replacement failed for ${transition.id} — original stop kept (runner still protected); leave/close manually if needed` });
        return { applied: plan.actions, error: "modify_stop_failed", stopKept: true };
      }
      await d.cancelOrder(a.orderId);
      await d.recordTrancheOrders({ setup_id: transition.id, stopOrderId: newId, limitOrderId: plan.orders.limitOrderId });
    }
  }
  return { applied: plan.actions };
}

async function buildExitDeps() {
  const sessions = await import("../sessions.js");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { tvAdapter } = await import("./tv-adapter.js");
  const { tradovateAdapter } = await import("./tradovate-adapter.js");
  const tradesFile = async () => path.join(await sessions.activeSessionDir(), "trades.jsonl");
  return {
    readEvents: async () => {
      try {
        const txt = await fs.readFile(await tradesFile(), "utf8");
        return txt.trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch { return []; }
    },
    // Adapter mutations inspect the broker ack and surface any rejection
    // (401/403 = auth lost) instead of silently ignoring it (audit C24).
    cancelOrder: async (id) => { const r = await tvAdapter.cancelOrder({ id }); if (r?.ok !== true) _send?.("app:error", { source: "tranche-exec", level: (r?.status === 401 || r?.status === 403) ? "error" : "warn", message: `cancel order ${id} failed (status ${r?.status ?? "?"})` }); return r; },
    flatten: async (symbol) => { const r = await tvAdapter.flatten({ symbol }); if (r?.ok !== true) _send?.("app:error", { source: "tranche-exec", level: "error", message: `flatten ${symbol} FAILED (status ${r?.status ?? "?"}) — position may still be open` }); return r; },
    placeStandalone: async (o) => { const r = await tvAdapter.placeStandalone(o); if (r?.ok !== true) _send?.("app:error", { source: "tranche-exec", level: "error", message: `place ${o.type} order failed (status ${r?.status ?? "?"})` }); try { return Number(JSON.parse(r.body).id); } catch { return null; } },
    emitError: (o) => _send?.("app:error", { source: "tranche-exec", ...o }),
    recordTrancheOrders: async (obj) => { await fs.appendFile(await tradesFile(), JSON.stringify({ type: "tranche_orders", ...obj, ts: new Date().toISOString() }) + "\n", "utf8"); },
    modifyTradovateStop: (a) => tradovateAdapter.modifyTradovateStop(a),
    closeTradovatePosition: (a) => tradovateAdapter.closeTradovatePosition(a),
    cancelTradovateOrders: () => tradovateAdapter.cancelTradovateOrders(),
  };
}
