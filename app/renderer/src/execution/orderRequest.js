// orderRequest — pure mapping from a surfaced setup + sizing into the
// canonical order payload sent over execution:place. Mechanism-independent
// (it's the INPUT to placeOrder, not the placement), so it's stable across
// the M0 spike outcome. Also carries the guardrail inputs (hasStop, sizing,
// guards) in the exact shape app/main/execution/guardrails.checkOrder reads,
// so the server-side gate mirrors the ticket.
export function buildOrderRequest({ setup, sizing, guards, account, symbol, type = "market" }) {
  const entry = Number(setup?.entry);
  const stop = Number(setup?.stop);
  const stopPts = Math.abs(entry - stop);
  const hasStop = Number.isFinite(entry) && Number.isFinite(stop) && stopPts > 0;
  return {
    side: setup?.side,
    type,
    symbol,
    account,
    contracts: sizing?.contracts ?? 0,
    entry: setup?.entry,
    stop: setup?.stop,
    tp: setup?.tp1,
    hasStop,
    sizing,
    guards,
  };
}
