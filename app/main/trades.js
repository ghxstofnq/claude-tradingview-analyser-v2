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

export async function acceptSetup({ setup, send }) {
  await syncSeq();
  const dir = await activeSessionDir();
  const file = path.join(dir, "trades.jsonl");
  const id = nextTradeId();
  const size = sizeFor({ grade: setup.grade, dow: dayOfWeek() });
  const event = {
    type: "accept",
    id,
    setup_id: setup.id || null,
    ts: new Date().toISOString(),
    side: setup.direction,
    model: setup.model,
    grade: setup.grade,
    entry: setup.entry,
    stop: setup.stop,
    tp1: setup.tp1,
    tp2: setup.tp2,
    invalidation: setup.invalidation,
    rr: setup.rr ?? null,
    size,
  };
  await fs.appendFile(file, JSON.stringify(event) + "\n", "utf8");
  send?.("trade:accepted", event);
  return event;
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
