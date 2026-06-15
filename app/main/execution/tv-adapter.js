// app/main/execution/tv-adapter.js
// Execution adapter against the in-app TradingView webview, paper-first.
// Phase 0: only read-only capabilities are real. Placement verbs throw
// NOT_IMPLEMENTED_UNTIL_M0 — the M0 spike decides the mechanism, then a
// follow-up plan implements them. Safety: no order can be placed yet.
import { evaluate, findWebviewTarget } from "./cdp-webview.js";

const NOT_YET = "execution placement not implemented — gated on the M0 mechanism spike";

export async function brokerConnected() {
  // A broker/Paper-Trading connection shows a real account-manager with an
  // account row. Heuristic, refined in M1. Returns boolean.
  try {
    return await evaluate(`(() => {
      const am = document.querySelector('[class*="accountManager"] [class*="account"], [data-name="account-manager"]');
      const txt = (document.body.innerText || '');
      return !!am && /paper|account|balance|\\$[0-9]/i.test(txt);
    })()`);
  } catch { return false; }
}

export async function readState() {
  // Read-only position/orders/balance from the account-manager DOM.
  // Real parsing lands in M1 against a connected paper account; until then
  // report the connection state so the UI can show "connect Paper Trading".
  const connected = await brokerConnected();
  return { connected, position: null, workingOrders: [], balance: null };
}

export async function placeOrder() { throw new Error(NOT_YET); }
export async function flatten() { throw new Error(NOT_YET); }
export async function panic() { throw new Error(NOT_YET); }
export async function moveStopToBE() { throw new Error(NOT_YET); }
export async function trail() { throw new Error(NOT_YET); }
export async function cancel() { throw new Error(NOT_YET); }
export async function addToPosition() { throw new Error(NOT_YET); }

export const tvAdapter = { brokerConnected, readState, placeOrder, flatten, panic, moveStopToBE, trail, cancel, addToPosition, findWebviewTarget };
