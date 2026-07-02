// app/main/execution/tradovate-fills.js
// Records completed Tradovate round-trips into the fills store so REVIEW shows
// them (the trading-feed's recordRoundTrip is TV-paper-WS-only). Tradovate has
// no position WS, so this polls /positions to DETECT an open→flat transition,
// then reconstructs the just-closed round-trip from /executions — sign-correct
// and side-correct from the actual fills (no position-poll race).
import fs from "node:fs/promises";
import path from "node:path";
import { appendFill } from "./fills.js";
import { TRADES_DIR } from "./config.js";
import { activeBroker, getTradovate, tvRootOf } from "./tradovate.js";
import { readTradovatePositionSafe } from "./tradovate-adapter.js";
import { activeSessionDir } from "../sessions.js";
import { foldOpenTrades, closeTradesAtBrokerExit } from "../../../cli/lib/trade-outcomes.js";

const pointValue = (sym) => (/MES/.test(sym || "") ? 5 : 2);
const today = () => new Date().toISOString().slice(0, 10);
// Consecutive confirmed-flat reads required before booking a close — debounces
// a one-off flat read so a blip never books a phantom close (audit C11).
const FLAT_CONFIRM = 2;

// Dedup key for a booked round-trip so a re-poll can't double-record the same
// close (audit C11). closeMs is the natural key; fall back to exit/entry/qty.
export function roundTripKey(rt, instrument) {
  return `${rt?.closeMs ?? rt?.exit ?? "?"}:${instrument}:${rt?.qty ?? "?"}:${rt?.entry ?? "?"}`;
}

// Pure per-tick decision for the Tradovate fill poller. Keeps the error-vs-flat
// + debounce logic (the C11 fix) in one tested place; the runtime does only the
// executions fetch + dedup on a "reached_flat" verdict.
//   skip_read_error → read failed, do nothing (never infer flat)
//   track_open      → position present, reset the flat counter
//   idle            → flat and nothing open
//   await_confirm   → flat but not yet confirmed enough times
//   reached_flat    → confirmed flat with an open trade → book or clear
export function planTradovateFillTransition({ readOk, hasPosition, hasOpenTrade, flatReads = 0, flatConfirm = FLAT_CONFIRM }) {
  if (!readOk) return { action: "skip_read_error", flatReads };
  if (hasPosition) return { action: "track_open", flatReads: 0 };
  if (!hasOpenTrade) return { action: "idle", flatReads: 0 };
  const n = flatReads + 1;
  if (n < flatConfirm) return { action: "await_confirm", flatReads: n };
  return { action: "reached_flat", flatReads: 0 };
}

let _send = null;
export function setTradovateFillsSink(send) { _send = send; }

// Reconcile the journal setup-trade with the real broker exit: when the
// Tradovate position goes flat, close the matching open journal trade(s) at the
// REAL fill price. Without this the bar-simulator keeps grading the setup
// against its original stop and never learns the trader exited / hit BE.
async function reconcileJournalOnClose(rt, instrument) {
  try {
    const dir = await activeSessionDir();
    const file = path.join(dir, "trades.jsonl");
    const txt = await fs.readFile(file, "utf8").catch(() => "");
    if (!txt.trim()) return;
    const events = txt.trim().split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const open = foldOpenTrades(events);
    if (!open.length) return;
    const side = rt.side === "buy" ? "long" : "short";
    const { transitions } = closeTradesAtBrokerExit(open, { instrument, exit: rt.exit, side, rootOf: tvRootOf });
    for (const tr of transitions) {
      await fs.appendFile(file, JSON.stringify({ type: "outcome", source: "tradovate", ...tr }) + "\n", "utf8");
      _send?.("trade:outcome", tr);
    }
  } catch { /* reconcile best-effort — never break fill recording */ }
}

// Reconstruct the most-recently-closed round-trip for `instrument` from the
// executions list (newest-first; each {instrument,price,qty,side,time}). Walks
// newest→oldest accumulating signed qty until the net returns to zero — those
// fills are the round-trip. Realized $ = (sell notional − buy notional) × point
// value (Tradovate-exact, sign-correct). Pure. Returns
//   { side, qty, entry, exit, usd, openMs, closeMs } | null
export function reconstructLastRoundTrip(executions, instrument, pv) {
  const fills = (executions || []).filter((f) => (f.instrument || f.symbol) === instrument);
  if (!fills.length) return null;
  let net = 0; const window = [];
  for (const f of fills) {
    net += (f.side === "buy" ? 1 : -1) * Number(f.qty);
    window.push(f);
    if (net === 0) break;
  }
  if (net !== 0 || !window.length) return null; // no closed round-trip boundary
  const opener = window[window.length - 1], closer = window[0];
  const side = opener.side;
  let buyN = 0, sellN = 0, openN = 0, openQ = 0, closeN = 0, closeQ = 0;
  for (const f of window) {
    const q = Number(f.qty), p = Number(f.price);
    if (f.side === "buy") buyN += q * p; else sellN += q * p;
    if (f.side === side) { openN += q * p; openQ += q; } else { closeN += q * p; closeQ += q; }
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    side, qty: openQ,
    entry: openQ ? r2(openN / openQ) : Number(opener.price),
    exit: closeQ ? r2(closeN / closeQ) : Number(closer.price),
    usd: r2((sellN - buyN) * pv),
    openMs: opener.time ? opener.time * 1000 : null,
    closeMs: closer.time ? closer.time * 1000 : null,
  };
}

async function fetchExecutions() {
  const t = getTradovate();
  if (!t.host || !t.accountId || !t.token) return [];
  try {
    const r = await fetch(`${t.host}/accounts/${t.accountId}/executions?locale=en`, { headers: { authorization: `Bearer ${t.token}` } });
    const j = await r.json();
    return Array.isArray(j) ? j : (j?.d || []);
  } catch { return []; }
}

let openTrade = null;
let flatReads = 0;
const bookedKeys = new Set();
let timer = null, stopped = false;

async function tick() {
  if (stopped) return;
  try {
    if (activeBroker() !== "tradovate") { openTrade = null; flatReads = 0; return; }
    const res = await readTradovatePositionSafe();
    const plan = planTradovateFillTransition({ readOk: res.ok, hasPosition: !!res.position, hasOpenTrade: !!openTrade, flatReads });
    flatReads = plan.flatReads;
    if (plan.action === "skip_read_error") return; // transient failure — never infer flat (C11)
    if (plan.action === "track_open") { if (!openTrade) openTrade = { instrument: res.position.symbol, openedMs: Date.now() }; return; }
    if (plan.action === "idle" || plan.action === "await_confirm") return;
    // reached_flat: confirmed flat with an open trade → book the round-trip once.
    const rt = reconstructLastRoundTrip(await fetchExecutions(), openTrade.instrument, pointValue(openTrade.instrument));
    if (rt) {
      const key = roundTripKey(rt, openTrade.instrument);
      if (!bookedKeys.has(key)) {
        bookedKeys.add(key);
        try {
          appendFill(TRADES_DIR, today(), {
            account: "tradovate",
            accountId: getTradovate().accountId ?? null, // scope the daily halt to THIS Tradovate account
            symbol: openTrade.instrument, side: rt.side, qty: rt.qty,
            planned: { entry: rt.entry, stop: null, tp: null },
            actual: { entry: rt.entry, exit: rt.exit, usd: rt.usd, r: null, heldMs: rt.openMs && rt.closeMs ? rt.closeMs - rt.openMs : Date.now() - openTrade.openedMs },
          });
        } catch { /* fill record best-effort */ }
        await reconcileJournalOnClose(rt, openTrade.instrument);
      }
    }
    openTrade = null;
  } catch { /* poll best-effort */ }
}

export function startTradovateFillPoller({ intervalMs = 4000, send } = {}) {
  stopped = false;
  if (send) _send = send;
  if (timer) return;
  timer = setInterval(tick, intervalMs);
}
export function stopTradovateFillPoller() { stopped = true; if (timer) { clearInterval(timer); timer = null; } }
export function __resetTradovateFills() { openTrade = null; flatReads = 0; bookedKeys.clear(); }
