// scripts/spike-tv-paper.mjs — M0 placement-mechanism spike (read-only capture).
//
// Captures how TradingView's in-app webview sends a PAPER order so we can pick
// the engine's placement path: (A) replay a REST/websocket message, or
// (B) drive the DOM. THIS SCRIPT PLACES NOTHING — the operator places one
// small paper order (with SL + TP) by hand during the capture window; the
// script records the network frames + account-manager DOM around it.
//
// Prereq: connect "Paper Trading" in the in-app TradingView trade panel first
// (otherwise there's no broker to place against).
//
// Usage:  node scripts/spike-tv-paper.mjs [seconds=90]
//   1. run it
//   2. when it says CAPTURING, place ONE small paper order with a stop + TP
//   3. then FLATTEN it
//   4. it writes state/spike/tv-paper-<ts>.json — inspect to choose A vs B
import http from "node:http";
import WebSocket from "ws";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = 9223;
const SECONDS = Number(process.argv[2] || 90);
// Frames/requests whose URL or payload mention these are likely order traffic.
const TRADING_RE = /order|bracket|position|qty|quantity|side|\bbuy\b|\bsell\b|stop|takeprofit|take_profit|\btp\b|\bsl\b|place|execution|trade(?!view)/i;

function listTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}/json`, (r) => {
      let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

const DOM_SNAPSHOT = `(() => {
  const pick = document.querySelector('[class*="accountManager"], [data-name="account-manager"], [class*="trading"]');
  const html = pick ? pick.outerHTML.slice(0, 20000) : null;
  return JSON.stringify({ url: location.href, found: !!pick, html, bodyTextSample: (document.body.innerText||'').slice(0,1500) });
})()`;

async function main() {
  const ts = await listTargets();
  const t = ts.find((x) => x.type === "webview" && /tradingview\.com/.test(x.url || ""));
  if (!t) { console.error("No TradingView webview on CDP 9223. Is the app running?"); process.exit(1); }

  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const out = { startedAt: new Date().toISOString(), seconds: SECONDS, requests: [], wsFrames: [], domBefore: null, domAfter: null };
  let id = 1; const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === "Network.requestWillBeSent") {
      const r = m.params.request; const blob = (r.url || "") + " " + (r.postData || "");
      if (TRADING_RE.test(blob)) out.requests.push({ t: Date.now(), method: r.method, url: r.url, headers: r.headers, postData: r.postData });
    } else if (m.method === "Network.webSocketFrameSent" || m.method === "Network.webSocketFrameReceived") {
      const p = m.params.response?.payloadData || "";
      if (TRADING_RE.test(p)) out.wsFrames.push({ t: Date.now(), dir: m.method.endsWith("Sent") ? "sent" : "recv", payload: p.slice(0, 4000) });
    }
  });

  await new Promise((res) => ws.on("open", res));
  await send("Network.enable");
  await send("Runtime.enable");
  const before = await send("Runtime.evaluate", { expression: DOM_SNAPSHOT, returnByValue: true });
  out.domBefore = before?.result?.value;

  console.log(`\n*** CAPTURING for ${SECONDS}s ***`);
  console.log("Now: place ONE small PAPER order with a stop + take-profit, then FLATTEN it.\n");
  await new Promise((res) => setTimeout(res, SECONDS * 1000));

  const after = await send("Runtime.evaluate", { expression: DOM_SNAPSHOT, returnByValue: true });
  out.domAfter = after?.result?.value;
  ws.close();

  const dir = join(process.cwd(), "state", "spike");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `tv-paper-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nDone. ${out.requests.length} trading REST requests, ${out.wsFrames.length} trading WS frames captured.`);
  console.log(`Wrote ${file}`);
  console.log(out.requests.length > 0
    ? "→ REST traffic seen — path A (replay request) is likely viable."
    : out.wsFrames.length > 0
      ? "→ WS frames seen — path A via websocket (check if replayable) or fall back to B (DOM)."
      : "→ No order traffic matched — likely DOM-only; lean path B, or widen TRADING_RE and re-run.");
}

main().catch((e) => { console.error("spike failed:", e.message); process.exit(1); });
