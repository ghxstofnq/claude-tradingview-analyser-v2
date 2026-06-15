// app/main/execution/tv-adapter.js
// Execution adapter against the in-app TradingView webview, paper-first.
// Phase 0: only read-only capabilities are real. Placement verbs throw
// NOT_IMPLEMENTED_UNTIL_M0 — the M0 spike decides the mechanism, then a
// follow-up plan implements them. Safety: no order can be placed yet.
import { evaluate, findWebviewTarget } from "./cdp-webview.js";

const NOT_YET = "execution placement not implemented — gated on the M0 mechanism spike";

export async function brokerConnected() {
  // A connected broker (incl. TV Paper Trading) renders the account-manager
  // shell + the order buttons, even when the bottom panel is COLLAPSED
  // (class js-hidden) — so detect by element presence, not visible text.
  // The order buttons alone exist as latent scaffolding on a chart with no
  // broker; requiring the accountManager too is what proves a connection.
  try {
    return await evaluate(`(() => {
      const am = document.querySelector('[class*="accountManager-"], .js-account-manager-header');
      const order = document.querySelector('[data-name="buy-order-button"], [data-name="sell-order-button"]');
      return !!(am && order);
    })()`);
  } catch { return false; }
}

export async function readState() {
  // Read-only snapshot from the account-manager DOM. Connection + account
  // name read via textContent (works even when the panel is collapsed).
  // Full position/order parsing lands in M1 against a live paper position.
  try {
    const snap = await evaluate(`(() => {
      const am = document.querySelector('[class*="accountManager-"], .js-account-manager-header');
      const order = document.querySelector('[data-name="buy-order-button"], [data-name="sell-order-button"]');
      const connected = !!(am && order);
      const nameEl = document.querySelector('[class*="accountName-"]');
      const account = nameEl ? (nameEl.textContent || "").trim().slice(0, 40) : null;
      const posRows = document.querySelectorAll('[data-name="Paper.positions-table"] tr, .positions tbody tr').length;
      return { connected, account, openPositionRows: posRows };
    })()`);
    return { connected: !!snap?.connected, account: snap?.account ?? null, position: null, openPositionRows: snap?.openPositionRows ?? 0, workingOrders: [], balance: null };
  } catch {
    return { connected: false, account: null, position: null, openPositionRows: 0, workingOrders: [], balance: null };
  }
}

export async function placeOrder() { throw new Error(NOT_YET); }
export async function flatten() { throw new Error(NOT_YET); }
export async function panic() { throw new Error(NOT_YET); }
export async function moveStopToBE() { throw new Error(NOT_YET); }
export async function trail() { throw new Error(NOT_YET); }
export async function cancel() { throw new Error(NOT_YET); }
export async function addToPosition() { throw new Error(NOT_YET); }

export const tvAdapter = { brokerConnected, readState, placeOrder, flatten, panic, moveStopToBE, trail, cancel, addToPosition, findWebviewTarget };
