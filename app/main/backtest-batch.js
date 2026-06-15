// backtest-batch — expand a range/symbol/session study into per-session jobs,
// and run them over the existing single-session engine (modeled on
// scripts/fold-week.mjs). expandJobs is pure + tested; runBatch is the thin
// orchestrator wired in the BACKTEST UI slice (S4).

const SYMS = { mnq: ["MNQ1!"], mes: ["MES1!"], both: ["MNQ1!", "MES1!"] };

// Inclusive weekday dates between two YYYY-MM-DD strings (skips Sat/Sun).
export function weekdaysBetween(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return out;
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// { symbol: 'mnq'|'mes'|'both', from, to, sessions: ['ny-am','ny-pm','london'] }
//   → [{ date, session, symbol }] for every (weekday × session × symbol).
export function expandJobs({ symbol = "both", from, to, sessions = [] } = {}) {
  const syms = SYMS[String(symbol).toLowerCase()] || SYMS.both;
  const dates = weekdaysBetween(from, to);
  const jobs = [];
  for (const date of dates) {
    for (const session of sessions) {
      for (const s of syms) jobs.push({ date, session, symbol: s });
    }
  }
  return jobs;
}
