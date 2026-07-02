// app/main/execution/cdp-webview.js
// Minimal CDP client pinned to the in-app TradingView <webview> on port 9223
// (type:"webview"). Distinct from packages/core (9225 analysis) so order
// work never touches the analysis backend. `evaluate` runs JS in the page
// context — order placement/modify/close POST through it (tv-adapter,
// tradovate-adapter).
import http from "node:http";
import WebSocket from "ws";

const PORT = 9223;
// Order-path deadline. A hung/closed webview socket previously left place/
// modify/close pending FOREVER (audit C22). On timeout the order state is
// UNKNOWN — callers must reconcile via readState/fills, never assume success.
const ORDER_TIMEOUT_MS = Number(process.env.TV_ORDER_TIMEOUT_MS) || 5000;

export class OrderTransportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OrderTransportError";
    this.code = code; // "timeout" | "socket_closed" | "unexpected_response"
    this.unknownOrderState = true; // signal: do NOT treat as placed or as flat
  }
}

function listTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}/json`, (r) => {
      let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

export async function findWebviewTarget() {
  const ts = await listTargets();
  // The TradingView chart webview — type webview, tradingview.com URL.
  return ts.find((t) => t.type === "webview" && /tradingview\.com/.test(t.url || "")) || null;
}

// Run one Runtime.evaluate over a given debugger URL with a hard deadline and
// full lifecycle handling (open/message/error/close/timeout). Extracted so the
// deadline + settle logic is unit-testable against a local ws server without a
// real TradingView. Every settle path clears the timer and closes the socket.
export function evaluateOnTarget(wsUrl, expr, { timeoutMs = ORDER_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(wsUrl);
    const id = 1;
    let settled = false;
    let timer = null;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { s.close(); } catch { /* noop */ }
      fn(arg);
    };
    timer = setTimeout(
      () => done(reject, new OrderTransportError("timeout", `order evaluate stalled (>${timeoutMs}ms)`)),
      timeoutMs,
    );
    s.on("open", () => s.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } })));
    s.on("message", (m) => {
      let o; try { o = JSON.parse(m); } catch (e) { return done(reject, e); }
      if (o.id === id) {
        if (o.exceptionDetails) done(reject, new Error(JSON.stringify(o.exceptionDetails)));
        else done(resolve, o.result?.result?.value);
      }
    });
    s.on("error", (e) => done(reject, e));
    s.on("unexpected-response", () => done(reject, new OrderTransportError("unexpected_response", "webview returned an unexpected HTTP response")));
    s.on("close", () => done(reject, new OrderTransportError("socket_closed", "webview socket closed before response")));
  });
}

export async function evaluate(expr) {
  const t = await findWebviewTarget();
  if (!t) throw new Error("TV webview target not found on CDP 9223");
  return evaluateOnTarget(t.webSocketDebuggerUrl, expr);
}
