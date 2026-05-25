// Deterministic trade-outcome inference.
//
// Given a list of open trades and the latest bar's OHLC, returns
// { transitions, updated } describing what changed:
//   transitions: [{id, ts, status, ...}]  — append these to trades.jsonl
//   updated:     [trade]                  — refreshed in-memory state
//
// Comparisons only. No arithmetic on prices — constraint #7.
//
// Same-bar edge case (entry-and-stop in one bar): conservative — FILLED
// first, then STOPPED. Never both filled-and-TP1-hit in the same bar
// (we don't have intra-bar time resolution).

export function tickTrades(trades, bar) {
  const transitions = [];
  const updated = [];

  for (const t of trades) {
    if (t.state === "pending_entry") {
      const crossedEntry = inRange(bar, t.entry);
      const crossedInval = t.side === "long"
        ? bar.low <= t.invalidation
        : bar.high >= t.invalidation;

      if (crossedEntry) {
        transitions.push({ id: t.id, ts: bar.ts, status: "FILLED", fill_price: t.entry });
        const filled = { ...t, state: "filled" };

        // Same-bar tie-break: if the bar ALSO took out the stop, FILLED→STOPPED.
        const sameBarStop = t.side === "long"
          ? bar.low <= t.stop
          : bar.high >= t.stop;
        if (sameBarStop) {
          transitions.push({ id: t.id, ts: bar.ts, status: "STOPPED", r_realized: -1 });
          updated.push({ ...filled, state: "closed", outcome: "STOPPED" });
          continue;
        }
        updated.push(filled);
        continue;
      }
      if (crossedInval) {
        transitions.push({ id: t.id, ts: bar.ts, status: "INVALIDATED" });
        updated.push({ ...t, state: "closed", outcome: "INVALIDATED" });
        continue;
      }
      updated.push(t);
      continue;
    }

    if (t.state === "filled") {
      const hitTP1 = t.side === "long" ? bar.high >= t.tp1 : bar.low <= t.tp1;
      const hitStop = t.side === "long" ? bar.low <= t.stop : bar.high >= t.stop;
      // Same-bar TP1+stop ambiguity: previously the code unconditionally
      // favored TP1 (overstated P&L). Use bar.open as a heuristic — if
      // open is closer to TP1 than to stop, price likely moved toward
      // TP1 first; otherwise toward stop. Bar.open required (added to
      // bar shape in bar-close.js). If missing, fall back to STOPPED
      // (conservative — assume the bad outcome).
      //
      // GAP-OPEN GUARD (#4 from self-audit): if the bar OPENS past the
      // stop (gap-down for long / gap-up for short), the trader's stop
      // executes at the gap-open price — the bar never had a chance to
      // hit TP1 first. Force STOPPED regardless of TP1 hit.
      let tp1First = true;
      if (hitTP1 && hitStop && !t.tp1_hit) {
        const openPastStop = typeof bar.open === "number" && Number.isFinite(bar.open)
          ? (t.side === "long" ? bar.open <= t.stop : bar.open >= t.stop)
          : false;
        if (openPastStop) {
          tp1First = false;     // gap blew past stop — definitely STOPPED
        } else if (typeof bar.open === "number" && Number.isFinite(bar.open)) {
          const distToTP1 = Math.abs(bar.open - t.tp1);
          const distToStop = Math.abs(bar.open - t.stop);
          tp1First = distToTP1 < distToStop;
        } else {
          tp1First = false;     // conservative fallback
        }
      }

      const hitTP2 = t.side === "long" ? bar.high >= t.tp2 : bar.low <= t.tp2;
      if (t.side === "long") {
        if (hitTP1 && !t.tp1_hit && tp1First) {
          transitions.push({ id: t.id, ts: bar.ts, status: "TP1_HIT", r_realized: rMultiple(t, t.tp1) });
          // Runner: stop moves to break-even.
          const next = { ...t, tp1_hit: true, stop: t.entry };
          if (bar.high >= t.tp2) {
            transitions.push({ id: t.id, ts: bar.ts, status: "TP2_HIT", r_realized: rMultiple(t, t.tp2) });
            updated.push({ ...next, state: "closed", outcome: "TP2_HIT" });
          } else {
            updated.push(next);
          }
          continue;
        }
        // Runner phase: tp1 already hit on a prior bar — look for TP2
        // or the BE-stop. Was a real bug: TP2 only fired same-bar as
        // TP1, never later. A trade that hit TP1 then ran to TP2 on the
        // next bar got stuck in "filled (runner)" forever.
        if (t.tp1_hit && hitTP2) {
          transitions.push({ id: t.id, ts: bar.ts, status: "TP2_HIT", r_realized: rMultiple(t, t.tp2) });
          updated.push({ ...t, state: "closed", outcome: "TP2_HIT" });
          continue;
        }
        if (hitStop) {
          transitions.push({ id: t.id, ts: bar.ts, status: "STOPPED", r_realized: rMultiple(t, t.stop) });
          updated.push({ ...t, state: "closed", outcome: "STOPPED" });
          continue;
        }
      } else {
        // short, symmetric
        if (hitTP1 && !t.tp1_hit && tp1First) {
          transitions.push({ id: t.id, ts: bar.ts, status: "TP1_HIT", r_realized: rMultiple(t, t.tp1) });
          const next = { ...t, tp1_hit: true, stop: t.entry };
          if (bar.low <= t.tp2) {
            transitions.push({ id: t.id, ts: bar.ts, status: "TP2_HIT", r_realized: rMultiple(t, t.tp2) });
            updated.push({ ...next, state: "closed", outcome: "TP2_HIT" });
          } else {
            updated.push(next);
          }
          continue;
        }
        // Runner phase (short symmetric — same TP2-after-prior-bar bug).
        if (t.tp1_hit && hitTP2) {
          transitions.push({ id: t.id, ts: bar.ts, status: "TP2_HIT", r_realized: rMultiple(t, t.tp2) });
          updated.push({ ...t, state: "closed", outcome: "TP2_HIT" });
          continue;
        }
        if (hitStop) {
          transitions.push({ id: t.id, ts: bar.ts, status: "STOPPED", r_realized: rMultiple(t, t.stop) });
          updated.push({ ...t, state: "closed", outcome: "STOPPED" });
          continue;
        }
      }
      updated.push(t);
      continue;
    }
    updated.push(t);
  }
  return { transitions, updated };
}

// Fold a trades.jsonl event log into the set of open trades (state ≠ closed).
export function foldOpenTrades(events) {
  const byId = new Map();
  for (const ev of events) {
    if (ev.type === "accept") {
      byId.set(ev.id, { ...ev, state: "pending_entry" });
    } else if (ev.type === "outcome") {
      const t = byId.get(ev.id);
      if (!t) continue;
      if (ev.status === "FILLED") t.state = "filled";
      else if (ev.status === "TP1_HIT") { t.tp1_hit = true; t.stop = t.entry; }
      else if (["TP2_HIT", "STOPPED", "INVALIDATED"].includes(ev.status)) {
        t.state = "closed";
        t.outcome = ev.status;
      }
    }
  }
  return [...byId.values()].filter((t) => t.state !== "closed");
}

function inRange(bar, price) {
  return bar.high >= price && bar.low <= price;
}

function rMultiple(t, exitPrice) {
  const entry = Number(t.entry);
  const stop = Number(t.stop);
  const exit = Number(exitPrice);
  // Guard against bad input — string prices, NaN, or entry === stop.
  // Returning null surfaces the problem (UI shows "—" instead of "0R")
  // instead of silently lying that the trade made zero profit.
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(exit)) return null;
  const risk = Math.abs(entry - stop);
  if (risk === 0) return null;
  const move = t.side === "long" ? (exit - entry) : (entry - exit);
  return Number((move / risk).toFixed(2));
}
