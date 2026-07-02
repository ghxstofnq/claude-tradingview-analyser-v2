// Regression for audit C22/C23: the CDP transports must have a deadline.
// Before the fix, a webview socket that accepted the connection but never
// replied left an order evaluate pending forever.
import test from "node:test";
import assert from "node:assert/strict";
import WS from "ws";
const WebSocketServer = WS.Server;
import { evaluateOnTarget, OrderTransportError } from "../app/main/execution/cdp-webview.js";
import { withTimeout, GuardError } from "../packages/core/guards.js";

function startServer(behavior) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const { port } = wss.address();
      resolve({ wss, url: `ws://127.0.0.1:${port}` });
    });
    wss.on("connection", (ws) => behavior(ws));
  });
}

test("evaluateOnTarget rejects with a typed timeout when the socket never replies", async () => {
  const { wss, url } = await startServer(() => { /* accept, never reply */ });
  try {
    await assert.rejects(
      evaluateOnTarget(url, "1+1", { timeoutMs: 200 }),
      (err) => err instanceof OrderTransportError && err.code === "timeout" && err.unknownOrderState === true,
    );
  } finally {
    wss.close();
  }
});

test("evaluateOnTarget rejects socket_closed when the webview drops the connection", async () => {
  const { wss, url } = await startServer((ws) => ws.close());
  try {
    await assert.rejects(
      evaluateOnTarget(url, "1+1", { timeoutMs: 2000 }),
      (err) => err instanceof OrderTransportError && err.code === "socket_closed",
    );
  } finally {
    wss.close();
  }
});

test("evaluateOnTarget resolves the value on a normal reply", async () => {
  const { wss, url } = await startServer((ws) => {
    ws.on("message", (m) => {
      const { id } = JSON.parse(m);
      ws.send(JSON.stringify({ id, result: { result: { value: 42 } } }));
    });
  });
  try {
    assert.equal(await evaluateOnTarget(url, "40+2", { timeoutMs: 2000 }), 42);
  } finally {
    wss.close();
  }
});

test("withTimeout rejects a never-settling promise with a GuardError('timeout')", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 100, "core.evaluate"),
    (err) => err instanceof GuardError && err.code === "timeout",
  );
});

test("withTimeout passes a fast promise through untouched", async () => {
  assert.equal(await withTimeout(Promise.resolve("ok"), 1000, "x"), "ok");
});
