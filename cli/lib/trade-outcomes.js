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

// A+ → TP2 (user ruling 2026-06-13): only A+ trades run past TP1, and only when
// TP2 sits beyond TP1 in the trade's direction. Everything else banks the full
// position at TP1. Mirrors isRunnerEligible in the backtest engine.
export function runnerEligible(t) {
  if (t?.grade !== "A+") return false;
  const t1 = Number(t.tp1), t2 = Number(t.tp2);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return false;
  return t.side === "long" ? t2 > t1 : t2 < t1;
}

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
      // R measured off the ORIGINAL risk for a runner (its live stop is at BE).
      const rOrig = (exit) => rMultiple({ ...t, stop: Number.isFinite(Number(t.orig_stop)) ? t.orig_stop : t.stop }, exit);

      // Fresh TP1 tag.
      if (hitTP1 && !t.tp1_hit && tp1First) {
        if (!runnerEligible(t)) {
          // B (or A+ with no runner room): bank the FULL position at TP1.
          transitions.push({ id: t.id, ts: bar.ts, status: "TP1_HIT", r_realized: rMultiple(t, t.tp1) });
          updated.push({ ...t, state: "closed", outcome: "TP1_HIT" });
          continue;
        }
        // A+ → TP2: TP1 tag moves the stop to break-even and the full position
        // runs for TP2 (no partial bank — R is realized only at TP2/BE/16:00).
        // TP1_HIT is a milestone (null R) that drives the stop-to-BE automation.
        transitions.push({ id: t.id, ts: bar.ts, status: "TP1_HIT", r_realized: null });
        const next = { ...t, tp1_hit: true, orig_stop: t.stop, stop: t.entry };
        if (hitTP2) {
          transitions.push({ id: t.id, ts: bar.ts, status: "TP2_HIT", r_realized: rMultiple(t, t.tp2) });
          updated.push({ ...next, state: "closed", outcome: "TP2_HIT" });
        } else {
          updated.push(next);
        }
        continue;
      }
      // A+ runner phase (TP1 already hit, stop at break-even).
      if (t.tp1_hit) {
        if (hitTP2) {
          transitions.push({ id: t.id, ts: bar.ts, status: "TP2_HIT", r_realized: rOrig(t.tp2) });
          updated.push({ ...t, state: "closed", outcome: "TP2_HIT" });
          continue;
        }
        if (hitStop) { // stop is at break-even → 0R scratch
          transitions.push({ id: t.id, ts: bar.ts, status: "STOPPED", r_realized: 0 });
          updated.push({ ...t, state: "closed", outcome: "STOPPED" });
          continue;
        }
        updated.push(t);
        continue;
      }
      // Pre-TP1 stop.
      if (hitStop) {
        transitions.push({ id: t.id, ts: bar.ts, status: "STOPPED", r_realized: rMultiple(t, t.stop) });
        updated.push({ ...t, state: "closed", outcome: "STOPPED" });
        continue;
      }
      updated.push(t);
      continue;
    }
    updated.push(t);
  }
  return { transitions, updated };
}

// 4:00 PM ET forced close (user ruling 2026-06-13): a trade still open at the
// NY cash close is exited at market — booking whatever it is — rather than
// held overnight. A filled position closes at the bar's close (signed R from
// its ORIGINAL risk, retained as orig_stop after a TP1 break-even move); a
// resting (unfilled) order is cancelled. Mirrors the backtest's closeAtMarket.
export function closeTradesAtEod(trades, bar) {
  const transitions = [];
  const updated = [];
  for (const t of trades) {
    if (t.state === "filled") {
      const riskStop = Number.isFinite(Number(t.orig_stop)) ? t.orig_stop : t.stop;
      transitions.push({
        id: t.id, ts: bar.ts, status: "CLOSED_EOD",
        exit: bar.close, r_realized: rMultiple({ ...t, stop: riskStop }, bar.close),
      });
      updated.push({ ...t, state: "closed", outcome: "CLOSED_EOD" });
    } else if (t.state === "pending_entry") {
      transitions.push({ id: t.id, ts: bar.ts, status: "EXPIRED_EOD" });
      updated.push({ ...t, state: "closed", outcome: "EXPIRED_EOD" });
    } else {
      updated.push(t);
    }
  }
  return { transitions, updated };
}

// Real broker exit (user ruling 2026-06-18): when the live broker position for
// an instrument goes flat, the matching open journal trade(s) close at the REAL
// fill price — broker truth, not the bar simulator. This is what lets the
// tracker know the trader exited or got tapped at break-even: R is measured off
// ORIGINAL risk (orig_stop, retained after a BE move), so a BE-stop tap books
// ~0R instead of the original-stop loss. Matches by symbol ROOT (MNQ1! ↔ MNQU6,
// via the injected rootOf) and side; a symbol-less legacy trade matches on side
// alone (the session is single-symbol). `side` is the round-trip direction in
// long/short terms (buy→long, sell→short) — pass it pre-normalized.
export function closeTradesAtBrokerExit(trades, { instrument, exit, side, rootOf, ts } = {}) {
  const transitions = [];
  const updated = [];
  const root = rootOf ? rootOf(instrument) : instrument;
  const when = ts || new Date().toISOString();
  for (const t of trades) {
    const rootMatch = (t.symbol == null || !rootOf) ? true : (rootOf(t.symbol) === root);
    const sideMatch = side == null || t.side === side;
    if (t.state !== "closed" && rootMatch && sideMatch) {
      const riskStop = Number.isFinite(Number(t.orig_stop)) ? t.orig_stop : t.stop;
      transitions.push({
        id: t.id, ts: when, status: "CLOSED_BROKER",
        exit, r_realized: rMultiple({ ...t, stop: riskStop }, exit),
      });
      updated.push({ ...t, state: "closed", outcome: "CLOSED_BROKER" });
    } else {
      updated.push(t);
    }
  }
  return { transitions, updated };
}

// Trailing consecutive losing trades in a session's trades.jsonl (user ruling
// 2026-06-13: halt new entries after 3 in a row). A loss is a STOPPED or a
// 16:00/broker close booked underwater; any winning/scratch close resets the
// streak. TP1_HIT/TP2_HIT/CLOSED_BE never count as losses (a B TP1 is a win; an
// A+ TP1 milestone is always followed by a real close that does count).
export function consecutiveLossStreak(events) {
  const closes = [];
  for (const ev of events) {
    if (ev.type !== "outcome") continue;
    if (ev.status === "STOPPED") closes.push({ ts: ev.ts, loss: true });
    else if (ev.status === "CLOSED_EOD" || ev.status === "CLOSED_BROKER") closes.push({ ts: ev.ts, loss: Number(ev.r_realized) < 0 });
    else if (["TP1_HIT", "TP2_HIT", "CLOSED_BE"].includes(ev.status)) closes.push({ ts: ev.ts, loss: false });
  }
  closes.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  let streak = 0;
  for (const c of closes) streak = c.loss ? streak + 1 : 0;
  return streak;
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
      // A+ → TP2: TP1 arms the runner (stop → break-even, original retained for
      // R/16:00-close). For everything else, TP1 is a full close at the target.
      else if (ev.status === "TP1_HIT") {
        if (runnerEligible(t)) { t.tp1_hit = true; t.orig_stop = t.stop; t.stop = t.entry; }
        else { t.state = "closed"; t.outcome = "TP1_HIT"; }
      }
      else if (["TP2_HIT", "STOPPED", "INVALIDATED", "CLOSED_EOD", "EXPIRED_EOD", "CLOSED_BROKER"].includes(ev.status)) {
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
