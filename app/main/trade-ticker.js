// trade-ticker — deterministic outcome tracking on every bar event.
//
// #65 Extracted from bar-close.js so the per-bar orchestration file
// is just orchestration. tickOpenTrades + the session-end audit live
// here; bar-close.js calls into us via tick() and audit().

import fs from "node:fs/promises";
import path from "node:path";
import { activeSessionDir } from "./sessions.js";
import { tickTrades, foldOpenTrades, closeTradesAtEod } from "../../cli/lib/trade-outcomes.js";
import { parseJsonlTolerant } from "../../cli/lib/jsonl.js";

// 4:00 PM ET cash close — any trade still open at/after this minute is
// force-closed at market (user ruling 2026-06-13).
const EOD_CLOSE_MIN = 16 * 60;
function etMinutesOf(ts) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts));
  const hh = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const mm = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return hh * 60 + mm;
}

let _send = null;
let _lastWarnedKey = null;

// #1 Per-trade dedup of recent transitions. Detector and watchdog can
// both call tickOpenTrades in overlapping windows. Without dedup, the
// same TP1_HIT could fire from each path (the file ends up with two
// outcome events; foldOpenTrades absorbs both, but trade:outcome IPC
// double-fires and metrics.jsonl counts the same hit twice). Cache:
// trade_id → { status, ts }. Skip if same status fired within
// DEDUP_WINDOW_MS.
const DEDUP_WINDOW_MS = 30_000;
const _recentTransitions = new Map();
function alreadyEmitted(tradeId, status) {
  const prev = _recentTransitions.get(tradeId);
  if (!prev) return false;
  return prev.status === status && (Date.now() - prev.ts) < DEDUP_WINDOW_MS;
}
function markEmitted(tradeId, status) {
  _recentTransitions.set(tradeId, { status, ts: Date.now() });
  // Opportunistic sweep — entries older than the window are useless.
  // Keeps the Map bounded across a long-running session with many
  // trades (otherwise it grows once per trade for the app lifetime).
  if (_recentTransitions.size > 50) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [id, rec] of _recentTransitions) {
      if (rec.ts < cutoff) _recentTransitions.delete(id);
    }
  }
}

// #7 mtime-gated read cache for trades.jsonl. Watchdog reads this file
// every 30s; if it hasn't changed since the last read, return the
// cached fold rather than re-parsing.
let _cachedFile = null;
let _cachedMtime = 0;
let _cachedEvents = null;

export function setTickerSink(send) { _send = send; }

/**
 * tickOpenTrades — fold open trades from disk, tick them against the
 * latest bar OHLC, persist any state transitions back as outcome
 * events. Single entry point called from BOTH the bar-close handler
 * (detector path) and the watchdog (polled-quote path) — dedup ensures
 * neither double-writes if they overlap.
 *
 * opts.source: tagged on outcome events so audits can tell which
 * path fired ("detector" | "watchdog"). Defaults to "detector".
 */
export async function tickOpenTrades(ev, opts = {}) {
  if (!ev?.ohlc) return;
  const source = opts.source || "detector";
  const dir = await activeSessionDir();
  const file = path.join(dir, "trades.jsonl");

  // mtime-gated read cache (#7) — if the file hasn't changed since
  // last call AND we're inside the cache window, reuse parsed events.
  let events;
  try {
    const stat = await fs.stat(file);
    if (file === _cachedFile && stat.mtimeMs === _cachedMtime && _cachedEvents) {
      events = _cachedEvents;
    } else {
      const txt = await fs.readFile(file, "utf8");
      // Tolerant parse (C20): a torn tail line must not throw here — that
      // silently returned and halted ALL stop/TP/EOD outcome tracking.
      const parsed = parseJsonlTolerant(txt);
      events = parsed.records;
      if (parsed.dropped > 0) {
        _send?.("app:error", { source: "trade-ticker", level: "error", message: `trades.jsonl: ${parsed.dropped} corrupt line(s) skipped while ticking open trades` });
      }
      _cachedFile = file;
      _cachedMtime = stat.mtimeMs;
      _cachedEvents = events;
    }
  } catch { return; }
  const open = foldOpenTrades(events);
  if (!open.length) return;

  const bar = {
    open: ev.ohlc.open,
    high: ev.ohlc.high,
    low: ev.ohlc.low,
    ts: ev.ts,
  };
  const { transitions } = tickTrades(open, bar);
  for (const tr of transitions) {
    // #1 Dedup: skip the write+IPC if the same status fired for this
    // trade in the dedup window. The other path will have already
    // written it.
    if (alreadyEmitted(tr.id, tr.status)) {
      // eslint-disable-next-line no-console
      console.log(`[trade-ticker] dedup: ${tr.id} ${tr.status} already emitted within ${DEDUP_WINDOW_MS}ms`);
      continue;
    }
    markEmitted(tr.id, tr.status);
    await fs.appendFile(file, JSON.stringify({ type: "outcome", source, ...tr }) + "\n", "utf8");
    // Bust the cache after a write so the next read picks up the new event.
    _cachedMtime = 0;
    _send?.("trade:outcome", tr);
    await applyTrancheExitSafe(tr);
  }
}

// Mirror a grader transition to the broker for an auto-mode tranche (A+ BE
// move, cancel the resting sibling, EOD close). Self-skips non-tranche trades
// (no standalone order markers) so manual/position-bracket trades are
// untouched. Never let an execution error break outcome tracking.
async function applyTrancheExitSafe(tr) {
  try {
    const { applyTrancheExit } = await import("./execution/tranche-exec.js");
    await applyTrancheExit(tr);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[trade-ticker] applyTrancheExit failed", err?.message || err);
  }
}

/**
 * maybeForceCloseAtEod — at/after 16:00 ET, force-close any trade still
 * open at the NY cash close (user ruling 2026-06-13). Filled positions
 * exit at the bar's close; resting orders are cancelled. Once a trade is
 * written closed it folds out of the open set, so this never re-fires.
 * Called every bar by bar-close.js; the ET gate makes it inert pre-16:00.
 */
export async function maybeForceCloseAtEod(ev) {
  if (!ev?.ts || !ev?.ohlc || etMinutesOf(ev.ts) < EOD_CLOSE_MIN) return;
  const dir = await activeSessionDir();
  const file = path.join(dir, "trades.jsonl");
  let events;
  try {
    const txt = await fs.readFile(file, "utf8");
    // Tolerant parse (C20): a torn line must not skip the 16:00 force-close.
    const parsed = parseJsonlTolerant(txt);
    events = parsed.records;
    if (parsed.dropped > 0) {
      _send?.("app:error", { source: "trade-ticker", level: "error", message: `trades.jsonl: ${parsed.dropped} corrupt line(s) skipped during EOD force-close` });
    }
  } catch { return; }
  const open = foldOpenTrades(events);
  if (!open.length) return;
  const bar = { close: ev.ohlc.close, ts: ev.ts };
  const { transitions } = closeTradesAtEod(open, bar);
  for (const tr of transitions) {
    if (alreadyEmitted(tr.id, tr.status)) continue;
    markEmitted(tr.id, tr.status);
    await fs.appendFile(file, JSON.stringify({ type: "outcome", source: "eod-close", ...tr }) + "\n", "utf8");
    _cachedMtime = 0;
    // eslint-disable-next-line no-console
    console.log(`[trade-ticker] 16:00 ET force-close: ${tr.id} ${tr.status}${tr.exit != null ? ` @ ${tr.exit}` : ""}`);
    _send?.("trade:outcome", tr);
    await applyTrancheExitSafe(tr);
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
