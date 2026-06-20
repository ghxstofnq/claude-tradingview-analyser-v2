// window-closes — per-session accumulator of in-window 1m closes for the live
// open-reaction read.
//
// Live≠backtest open-read fix (2026-06-21): the backtest accumulates EVERY 1m
// close in the open window (minute 0..30) and feeds them to resolveOpenReaction;
// the live bundle only carries bars.last_5_bars (4-5 bars), so the live read saw
// a partial window and mis-counted the §7-Step-4 "accept-bars" — calling a weak
// rejection clean (live resolved bearish where the backtest, with the full
// window, stood aside; 2026-05-14 13:55). This module gives live the same full
// coverage: handleBar appends each closed 1m bar inside the window; the resolver
// callers read the accumulated set and pass it as windowClosesOverride.
//
// One {time_ms, close} per 1m bar; time_ms is the bar's CLOSE minute boundary
// (matches the backtest's open*1000+60000). Stored per session folder, so it is
// naturally scoped to one session and never bleeds across days.

import fs from "node:fs";
import path from "node:path";
import { openReactionWindowMs } from "./backtest-engine.js";

const FILE = "window-closes.json";

function etDateOf(eventTs) {
  const ms = Date.parse(eventTs);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function readWindowCloses(dir) {
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Append the just-closed 1m bar's close to the session's window-closes file when
 * it lands inside the open-reaction window. Idempotent per close-minute (deduped
 * by time_ms), so repeated handleBar calls on the same bar are safe. Returns the
 * accumulated array.
 */
export function appendWindowClose({ dir, eventTs, session, close }) {
  const out = readWindowCloses(dir);
  const date = etDateOf(eventTs);
  const closeNum = Number(close);
  if (!dir || !session || !date || !Number.isFinite(closeNum)) return out;
  const w = openReactionWindowMs({ date, session });
  // Round the emit ts to the minute → the bar's clean close boundary (the
  // detector emits ~1s after close); matches the backtest's open*1000+60000.
  const time_ms = Math.round(Date.parse(eventTs) / 60_000) * 60_000;
  if (!(time_ms > w.startMs && time_ms <= w.endMs)) return out;
  if (out.some((c) => c.time_ms === time_ms)) return out;
  out.push({ time_ms, close: closeNum });
  try { fs.writeFileSync(path.join(dir, FILE), JSON.stringify(out)); } catch { /* best-effort */ }
  return out;
}
