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
      if (t.side === "long") {
        if (bar.high >= t.tp1 && !t.tp1_hit) {
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
        if (bar.low <= t.stop) {
          transitions.push({ id: t.id, ts: bar.ts, status: "STOPPED", r_realized: rMultiple(t, t.stop) });
          updated.push({ ...t, state: "closed", outcome: "STOPPED" });
          continue;
        }
      } else {
        // short, symmetric
        if (bar.low <= t.tp1 && !t.tp1_hit) {
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
        if (bar.high >= t.stop) {
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
  const risk = Math.abs(t.entry - t.stop);
  if (risk === 0) return 0;
  const move = t.side === "long" ? (exitPrice - t.entry) : (t.entry - exitPrice);
  return Number((move / risk).toFixed(2));
}
