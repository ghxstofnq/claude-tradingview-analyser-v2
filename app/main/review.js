// Read-only views for REVIEW mode — walks state/session/<date>/<session>/
// folders, folds trades.jsonl events into trade records, and computes
// per-session stats. Pure reader; no writes.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SESSION_ROOT = path.join(REPO_ROOT, "state", "session");

const SESSION_PRIORITY = { "ny-pm": 3, "ny-am": 2, "london": 1 };

async function readJsonOrNull(p) {
  try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return null; }
}

async function readJsonlOrEmpty(p) {
  try {
    const txt = await fs.readFile(p, "utf8");
    return txt.trim().split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return { _raw: l }; }
    });
  } catch { return []; }
}

// List every session folder on disk, descending (most-recent first).
export async function listSessionFolders() {
  let dates;
  try { dates = await fs.readdir(SESSION_ROOT); } catch { return []; }
  dates = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

  const out = [];
  for (const date of dates) {
    let entries;
    try { entries = await fs.readdir(path.join(SESSION_ROOT, date)); } catch { continue; }
    for (const s of ["ny-am", "ny-pm", "london"]) {
      if (entries.includes(s)) out.push({ date, session: s });
    }
  }
  out.sort((a, b) =>
    b.date.localeCompare(a.date) || (SESSION_PRIORITY[b.session] - SESSION_PRIORITY[a.session])
  );
  return out;
}

// Fold trades.jsonl events into final trade records. Mirrors foldOpenTrades
// in trade-outcomes.js but returns ALL trades (closed and open).
function foldAllTrades(events) {
  const byId = new Map();
  for (const ev of events) {
    if (ev.type === "accept") {
      byId.set(ev.id, { ...ev, state: "pending_entry", tp1_hit: false, r_realized: 0 });
    } else if (ev.type === "outcome") {
      const t = byId.get(ev.id);
      if (!t) continue;
      if (ev.status === "FILLED") {
        t.state = "filled";
        t.fill_price = ev.fill_price;
        t.filled_ts = ev.ts;
      } else if (ev.status === "TP1_HIT") {
        t.tp1_hit = true;
        t.r_realized = (t.r_realized || 0) + (ev.r_realized || 0);
      } else if (["TP2_HIT", "STOPPED", "INVALIDATED"].includes(ev.status)) {
        t.state = "closed";
        t.outcome = ev.status;
        t.r_realized = (t.r_realized || 0) + (ev.r_realized || 0);
        t.closed_ts = ev.ts;
      }
    }
  }
  return [...byId.values()];
}

function computeStats(setups, events) {
  const trades = foldAllTrades(events);
  let wins = 0, losses = 0, totalR = 0;
  for (const t of trades) {
    // Strategy semantics: TP1-hit = win (even if the runner stopped at BE
    // afterward). A trade closed without ever hitting TP1 is a loss.
    if (t.tp1_hit) wins += 1;
    else if (t.state === "closed") losses += 1;
    totalR += t.r_realized || 0;
  }
  const noTrade = setups.filter((s) => s.grade === "no-trade").length;
  return {
    setups: setups.length,
    accepted: events.filter((e) => e.type === "accept").length,
    rejected: events.filter((e) => e.type === "reject").length,
    no_trade: noTrade,
    wins,
    losses,
    net_r: Number(totalR.toFixed(2)),
  };
}

// Full journal for one session.
export async function getJournalFor({ date, session }) {
  const dir = path.join(SESSION_ROOT, date, session);
  const [brief, summary, setups, tradeEvents] = await Promise.all([
    readJsonOrNull(path.join(dir, "brief.json")),
    readJsonOrNull(path.join(dir, "summary.json")),
    readJsonlOrEmpty(path.join(dir, "setups.jsonl")),
    readJsonlOrEmpty(path.join(dir, "trades.jsonl")),
  ]);
  const trades = foldAllTrades(tradeEvents);
  // Setups that produced a trade — match by setup_id on accept events.
  const acceptedSetupIds = new Set(
    tradeEvents.filter((e) => e.type === "accept").map((e) => e.setup_id).filter(Boolean)
  );
  const rejectedSetupIds = new Set(
    tradeEvents.filter((e) => e.type === "reject").map((e) => e.setup_id).filter(Boolean)
  );
  const setupsAnnotated = setups.map((s) => ({
    ...s,
    _disposition: acceptedSetupIds.has(s.id) ? "accepted"
                : rejectedSetupIds.has(s.id) ? "rejected"
                : s.grade === "no-trade"     ? "no-trade"
                : "ignored",
  }));
  const stats = computeStats(setups, tradeEvents);
  return { date, session, brief, summary, setups: setupsAnnotated, trades, stats };
}

// Library: thin per-session stats, descending. Default 20 rows.
export async function getLibrary({ limit = 20 } = {}) {
  const folders = await listSessionFolders();
  const top = folders.slice(0, limit);
  return Promise.all(top.map(async (f) => {
    const j = await getJournalFor(f);
    return {
      date: f.date,
      session: f.session,
      grade: j.brief?.pillar_grade || null,
      stats: j.stats,
    };
  }));
}

// Default REVIEW landing page = the most-recent session that has anything
// in it (brief, summary, setups, or trades). Falls back to most-recent folder.
export async function getDefaultJournal() {
  const folders = await listSessionFolders();
  for (const f of folders) {
    const j = await getJournalFor(f);
    if (j.brief || j.summary || j.setups.length || j.trades.length) return j;
  }
  return folders[0] ? getJournalFor(folders[0]) : null;
}
