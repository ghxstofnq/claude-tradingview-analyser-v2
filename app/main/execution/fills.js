// app/main/execution/fills.js
// Append-only fill/outcome records, one JSONL file per date under
// <tradesDir>/<date>.jsonl. tradesDir is injected (the IPC layer passes the
// real state path) so this is unit-testable. Each record: planned vs actual
// (fill, exit type, real R + $, account PAPER|LIVE, held). REVIEW reads these.
import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function fillPath(tradesDir, date) { return join(tradesDir, `${date}.jsonl`); }

export function appendFill(tradesDir, date, record) {
  if (!existsSync(tradesDir)) mkdirSync(tradesDir, { recursive: true });
  const rec = { ts: new Date().toISOString(), ...record };
  appendFileSync(fillPath(tradesDir, date), JSON.stringify(rec) + "\n");
  return rec;
}

export function readFills(tradesDir, date) {
  const p = fillPath(tradesDir, date);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// Daily realized LOSS as a positive $ number (for the daily-halt guardrail).
export function dayRealizedLossUsd(fills = []) {
  const loss = fills.reduce((s, f) => s + Math.min(0, Number(f?.actual?.usd) || 0), 0);
  return Math.abs(loss);
}

// All fills across every date file under tradesDir, oldest-first (by ts).
// Feeds REVIEW TRACK RECORD (cumulative real performance).
export function readAllFills(tradesDir) {
  if (!existsSync(tradesDir)) return [];
  const dates = readdirSync(tradesDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  const all = [];
  for (const f of dates) all.push(...readFills(tradesDir, f.replace(/\.jsonl$/, "")));
  return all.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}
