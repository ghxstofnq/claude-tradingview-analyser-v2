// app/main/execution/cdp-webview.js
// Minimal CDP client pinned to the in-app TradingView <webview> on port 9223
// (type:"webview"). Distinct from packages/core (9225 analysis) so order
// work never touches the analysis backend. `evaluate` runs JS in the page
// context — order placement/modify/close POST through it (tv-adapter,
// tradovate-adapter).
import http from "node:http";
import WebSocket from "ws";

const PORT = 9223;

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

export async function evaluate(expr) {
  const t = await findWebviewTarget();
  if (!t) throw new Error("TV webview target not found on CDP 9223");
  return new Promise((resolve, reject) => {
    const s = new WebSocket(t.webSocketDebuggerUrl);
    let id = 1;
    s.on("open", () => s.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } })));
    s.on("message", (m) => {
      const o = JSON.parse(m);
      if (o.id === id) { s.close(); o.exceptionDetails ? reject(new Error(JSON.stringify(o.exceptionDetails))) : resolve(o.result?.result?.value); }
    });
    s.on("error", reject);
  });
}
