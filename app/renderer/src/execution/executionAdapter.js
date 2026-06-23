// executionAdapter — thin wrapper over window.api.execution.* (real IPC).
// The main process runs guardrails before any place and drives the in-app
// TradingView webview. Placement still no-ops at the BROKER level until the
// M0 mechanism spike lands — main returns a structured {ok:false} for those,
// which the LIVE ticket already handles. Account mode (PAPER/LIVE) is
// ephemeral renderer UI state; arming retargets the adapter once live wiring
// exists. CLAUDE.md #2 reversal is governed by the execution-engine spec.

const call = (verb, payload) =>
  window.api?.execution?.[verb]?.(payload) ??
  Promise.resolve({ ok: false, error: "execution IPC unavailable" });

export const executionAdapter = {
  placeOrder: (p) => call("place", p),
  flatten: (p) => call("flatten", p),
  panic: (p) => call("panic", p),
  moveStopToBE: (p) => call("moveStopToBE", p),
  trail: (p) => call("trail", p),
  cancel: (p) => call("cancel", p),
  // ORDERS manual ticket: fresh structure+price, pure preview, validated place.
  orderContext: (p) => call("orderContext", p),
  orderPreview: (p) => call("orderPreview", p),
  placeManual: (p) => call("placeManual", p),
  state: () => call("state"),
  // Account mode is renderer UI state for now (set in Settings); these are
  // where the engine will retarget the broker account post-spike.
  armLive: () => ({ ok: true, stub: true }),
  returnToPaper: () => ({ ok: true, stub: true }),
};
