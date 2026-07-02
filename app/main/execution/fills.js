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
// `account` scopes the sum so a halt on one account is never charged another's:
//   - null/omitted → all accounts (back-compat).
//   - string → matches a fill's specific `accountId`, falling back to the broker
//     `account` label ("paper"/"tradovate") for fills written before per-account
//     ids (back-compat with the label-scoping callers).
//   - { id, broker } → matches this account's id, AND ALSO counts any fill of
//     the same broker that carries NO accountId. A fill written before the id
//     was learned used to be silently excluded from the id-scoped halt, so the
//     halt under-counted and traded past the limit (audit C14). Under-counting a
//     loss halt risks unbounded loss; counting an ambiguous same-broker fill only
//     halts slightly early — the fail-safe direction.
export function dayRealizedLossUsd(fills = [], account = null) {
  let matches;
  if (account == null) {
    matches = () => true;
  } else if (typeof account === "object") {
    const id = account.id == null ? null : String(account.id);
    const broker = account.broker == null ? null : String(account.broker);
    matches = (f) => {
      const fid = f?.accountId == null ? null : String(f.accountId);
      if (id != null && fid === id) return true;
      if (fid == null && broker != null && String(f?.account) === broker) return true;
      return false;
    };
  } else {
    const key = String(account);
    matches = (f) => String(f?.accountId ?? f?.account) === key;
  }
  const loss = fills.filter(matches).reduce((s, f) => s + Math.min(0, Number(f?.actual?.usd) || 0), 0);
  return Math.abs(loss);
}

// Group fills by their `account` label → { [account]: fill[] }. Unlabelled
// fills bucket under "unknown" so they're never silently merged into a real
// account's record.
export function fillsByAccount(fills = []) {
  const out = {};
  for (const f of fills) {
    const key = f?.account || "unknown";
    (out[key] ||= []).push(f);
  }
  return out;
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
