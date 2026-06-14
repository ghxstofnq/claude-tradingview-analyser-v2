// executionAdapter — STUB. No broker writes yet. The execution-engine spec
// (built second) implements these against TradingView, paper-first. Until then
// every order control no-ops with a console warning so the UI is fully built
// and clickable without any broker code. CLAUDE.md constraint #2 (no broker
// writes) is still in force until that spec lands.

const NOT_WIRED = "execution not wired yet — order controls are stubbed (paper-first engine pending)";

function stub(name) {
  // eslint-disable-next-line no-console
  console.warn(`[executionAdapter] ${name}: ${NOT_WIRED}`);
  return { ok: false, stub: true, message: NOT_WIRED };
}

export const executionAdapter = {
  placeOrder: () => stub("placeOrder"),
  flatten: () => stub("flatten"),
  moveStopToBE: () => stub("moveStopToBE"),
  panic: () => stub("panic"),
  trail: () => stub("trail"),
  cancel: () => stub("cancel"),
  addToPosition: () => stub("addToPosition"),
  // Account mode is UI state for now (set directly in Settings); these hooks are
  // where the engine will retarget the broker account.
  armLive: () => ({ ok: true, stub: true }),
  returnToPaper: () => ({ ok: true, stub: true }),
};
