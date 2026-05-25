// trade-ticker — deterministic outcome tracking on every bar event.
//
// #65 Extracted from bar-close.js so the per-bar orchestration file
// is just orchestration. tickOpenTrades + the session-end audit live
// here; bar-close.js calls into us via tick() and audit().

import fs from "node:fs/promises";
import path from "node:path";
import { activeSessionDir } from "./sessions.js";
import { tickTrades, foldOpenTrades } from "../../cli/lib/trade-outcomes.js";

let _send = null;
let _lastWarnedKey = null;

export function setTickerSink(send) { _send = send; }

/**
 * tickOpenTrades — fold open trades from disk, tick them against the
 * latest bar OHLC, persist any state transitions back as outcome
 * events. Called by the bar-close handler on every bar event.
 */
export async function tickOpenTrades(ev) {
  if (!ev?.ohlc) return;
  const dir = await activeSessionDir();
  const file = path.join(dir, "trades.jsonl");
  let txt = "";
  try { txt = await fs.readFile(file, "utf8"); } catch { return; }
  const events = txt.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const open = foldOpenTrades(events);
  if (!open.length) return;

  // bar.open is required for the same-bar TP1+stop heuristic — fall
  // back gracefully if the detector didn't include it.
  const bar = {
    open: ev.ohlc.open,
    high: ev.ohlc.high,
    low: ev.ohlc.low,
    ts: ev.ts,
  };
  const { transitions } = tickTrades(open, bar);
  for (const tr of transitions) {
    await fs.appendFile(file, JSON.stringify({ type: "outcome", ...tr }) + "\n", "utf8");
    _send?.("trade:outcome", tr);
  }
}

/**
 * maybeWarnSessionEndedWithOpenTrades — call once when the bar handler
 * sees phase === "off". Warns the trader if any trades are still open
 * AND writes session-end-audit.json with a summary of the day's
 * setups, accepts/rejects, outcomes, and any still-open trades.
 *
 * Idempotent per (date, session) — won't fire repeatedly as bars keep
 * arriving in the off phase.
 */
export async function maybeWarnSessionEndedWithOpenTrades() {
  const dir = await activeSessionDir();
  if (_lastWarnedKey === dir) return;
  try {
    const txt = await fs.readFile(path.join(dir, "trades.jsonl"), "utf8");
    const events = txt.trim().split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    const open = foldOpenTrades(events);
    if (open.length > 0) {
      const ids = open.map((t) => t.id).join(", ");
      // eslint-disable-next-line no-console
      console.warn(`[trade-ticker] session ended with ${open.length} open trade(s): ${ids}`);
      _send?.("app:error", {
        source: "trade-ticker",
        level: "warn",
        message: `Session ended with ${open.length} open trade(s): ${ids}. Tracker continues but no Claude reasoning.`,
      });
    }
    await writeSessionEndAudit(dir, events, open);
  } catch { /* no trades file or all closed */ }
  _lastWarnedKey = dir;
}

async function writeSessionEndAudit(dir, events, openTrades) {
  try {
    const setupsFile = path.join(dir, "setups.jsonl");
    let setupsTxt = "";
    try { setupsTxt = await fs.readFile(setupsFile, "utf8"); } catch {}
    const setups = setupsTxt.trim().split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    const accepted = events.filter((e) => e.type === "accept");
    const rejected = events.filter((e) => e.type === "reject");
    const outcomes = events.filter((e) => e.type === "outcome");
    const audit = {
      ts: new Date().toISOString(),
      setups_total: setups.length,
      setups_by_grade: setups.reduce((acc, s) => {
        const g = s.grade || "?";
        acc[g] = (acc[g] || 0) + 1;
        return acc;
      }, {}),
      accepted: accepted.length,
      rejected: rejected.length,
      outcomes_by_status: outcomes.reduce((acc, o) => {
        const s = o.status || "?";
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {}),
      open_at_close: openTrades.map((t) => ({
        id: t.id,
        side: t.side,
        grade: t.grade,
        entry: t.entry,
        state: t.state,
      })),
    };
    await fs.writeFile(path.join(dir, "session-end-audit.json"), JSON.stringify(audit, null, 2), "utf8");
    // eslint-disable-next-line no-console
    console.log(`[trade-ticker] wrote session-end audit: ${audit.setups_total} setups, ${audit.accepted} accepted, ${audit.open_at_close.length} open at close`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[trade-ticker] session-end audit failed", err?.message || err);
  }
}
