// Trade-decision writer — appends accept/reject events to the active
// session's trades.jsonl. Outcomes are appended by the per-bar ticker
// in bar-close.js (not here).

import fs from "node:fs/promises";
import path from "node:path";
import { activeSessionDir } from "./sessions.js";
import { sizeFor, dayOfWeek } from "../../cli/lib/sizing.js";

let _seq = 0;
function nextTradeId() {
  _seq += 1;
  return `T-${String(_seq).padStart(4, "0")}`;
}

// Resync the sequence counter from the highest existing T-NNNN id in the
// current session file. Idempotent — safe to call repeatedly.
async function syncSeq() {
  try {
    const dir = await activeSessionDir();
    const txt = await fs.readFile(path.join(dir, "trades.jsonl"), "utf8");
    for (const line of txt.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        const m = /^T-(\d+)$/.exec(ev.id || "");
        if (m) _seq = Math.max(_seq, Number(m[1]));
      } catch {}
    }
  } catch {}
}

// In-flight accept guard. Two near-simultaneous IPC calls for the same
// setup (double-click on the Accept button) would otherwise create two
// trades for one setup. Resolves once the appendFile + IPC emit complete.
const _acceptInFlight = new Set();

// A scale-in add is tagged tranche_role:"add" by the tranche manager (or the
// manual ADD path). Adds open concurrently with the anchor; everything else is
// a single-position anchor subject to the single-trade lock.
export function isAddAccept(setup) {
  return setup?.tranche_role === "add";
}

export async function acceptSetup({ setup, send }) {
  await syncSeq();
  const dir = await activeSessionDir();
  const file = path.join(dir, "trades.jsonl");

  // #2 Dedup by setup.id. If a second call comes in for the same setup
  // before the first finishes, reject as duplicate. setup.id can be
  // missing — in that case we synthesize a dedupe key from price+side
  // so accidental double-click still gets caught.
  const dedupeKey = setup.id || `${setup.direction}-${setup.entry}-${setup.stop}`;
  if (_acceptInFlight.has(dedupeKey)) {
    return { error: "duplicate accept ignored", dedupeKey };
  }
  _acceptInFlight.add(dedupeKey);

  // #4 Single-trade enforcement — ANCHORS only. A scale-in add
  // (tranche_role:"add") is allowed to open concurrently with the anchor;
  // that is the tranche engine's whole purpose. tranche_seq = how many trades
  // are already open (anchor=0, first add=1, …).
  let trancheSeq = 0;
  try {
    const existing = await fs.readFile(file, "utf8").catch(() => "");
    const events = existing.trim().split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    const { foldOpenTrades } = await import("../../cli/lib/trade-outcomes.js");
    const open = foldOpenTrades(events);
    trancheSeq = open.length;
    if (!isAddAccept(setup) && open.length > 0) {
      _acceptInFlight.delete(dedupeKey);
      return { error: `cannot accept — trade ${open[0].id} is still open`, openTradeId: open[0].id };
    }
  } catch (err) {
    _acceptInFlight.delete(dedupeKey);
    throw err;
  }

  try {
    const id = nextTradeId();
    const size = sizeFor({ grade: setup.grade, dow: dayOfWeek() });
    // #47 setup_id was nullable — broke setup→trade linkage in journal
    // stats ("which % of A+ setups got accepted"). If the caller didn't
    // pass one, the renderer didn't have it — but surface_setup now
    // always writes an id to setups.jsonl, so reject the accept with a
    // diagnostic if the caller's payload is missing it.
    if (!setup.id) {
      _acceptInFlight.delete(dedupeKey);
      return { error: "accept payload missing setup.id — cannot link to setups.jsonl entry" };
    }
    const event = {
      type: "accept",
      id,
      setup_id: setup.id,
      ts: new Date().toISOString(),
      side: setup.direction,
      model: setup.model,
      grade: setup.grade,
      entry: setup.entry,
      stop: setup.stop,
      tp1: setup.tp1,
      tp2: setup.tp2,
      // Nearest intraday objective — the green-light add-timing anchor. Carried
      // so foldOpenTrades surfaces it on the anchor for greenLightReached
      // (backtest parity). Null when the packet has no intraday ref.
      greenlight_ref: setup.greenlight_ref ?? null,
      invalidation: setup.invalidation,
      rr: setup.rr ?? null,
      size,
      tranche_role: isAddAccept(setup) ? "add" : "anchor",
      tranche_seq: trancheSeq,
    };
    await fs.appendFile(file, JSON.stringify(event) + "\n", "utf8");
    send?.("trade:accepted", event);
    return event;
  } finally {
    _acceptInFlight.delete(dedupeKey);
  }
}

export async function rejectSetup({ setupId, reason, send }) {
  const dir = await activeSessionDir();
  const file = path.join(dir, "trades.jsonl");
  const event = {
    type: "reject",
    setup_id: setupId || null,
    ts: new Date().toISOString(),
    reason: reason || "",
  };
  await fs.appendFile(file, JSON.stringify(event) + "\n", "utf8");
  send?.("trade:rejected", event);
  return event;
}
