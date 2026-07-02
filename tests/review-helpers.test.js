// Unit tests for app/renderer/src/Review.helpers.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  degradedChainStages,
  formatGradeShort,
  deriveLedgerState,
  deriveLedgerReason,
  buildLedger,
  buildTrackRecord,
  buildTrackRecordFromFills,
  buildTrackRecordByAccount,
  resolveAccountName,
  todayBadge,
} from "../app/renderer/src/Review.helpers.js";

describe("todayBadge", () => {
  // The library row shape is { date, session, grade, stats:{ net_r, setups } }.
  // The old badge read today.total_r / today.setups (top-level) → always 0.
  it("reads net_r + setups from the row's stats block when the row IS today", () => {
    const b = todayBadge([{ date: "2026-06-16", session: "ny-pm", stats: { net_r: 10.12, setups: 6 } }], "2026-06-16");
    assert.equal(b.totalR, 10.12);
    assert.equal(b.setups, 6);
  });
  it("C33: a prior day's row shows NO R (dim setup-count only), never labeled today", () => {
    const b = todayBadge([{ date: "2026-06-16", session: "ny-pm", stats: { net_r: 10.12, setups: 6 } }], "2026-06-17");
    assert.equal(b.totalR, null, "yesterday's +10.12R must not render as today's session");
    assert.equal(b.setups, 6);
  });
  it("a 0R day reports totalR 0 (dim count), not null", () => {
    const b = todayBadge([{ stats: { net_r: 0, setups: 3 } }], "2026-06-16");
    assert.equal(b.totalR, 0);
    assert.equal(b.setups, 3);
  });
  it("no library / empty → totalR null, setups 0", () => {
    assert.deepEqual(todayBadge(null), { totalR: null, setups: 0 });
    assert.deepEqual(todayBadge([]), { totalR: null, setups: 0 });
    assert.deepEqual(todayBadge([{}]), { totalR: null, setups: 0 });
  });
});

describe("buildTrackRecordFromFills", () => {
  const fills = [
    { side: "long", symbol: "MNQ1!", actual: { r: 1.6, usd: 320 } },
    { side: "short", symbol: "MNQ1!", actual: { r: -1.0, usd: -200 } },
    { side: "long", symbol: "MES1!", actual: { r: 2.4, usd: 600 } },
  ];
  it("aggregates real fills into cumulative R, win-rate, payoff, expectancy", () => {
    const A = buildTrackRecordFromFills(fills);
    assert.equal(A.n_trades, 3);
    assert.equal(A.cum_r, 3.0);
    assert.equal(A.cum_usd, 720);
    assert.equal(A.win_n, 2);
    assert.equal(A.loss_n, 1);
    assert.equal(A.win_pct, 67);
    assert.equal(A.avg_win, 2.0);
    assert.equal(A.avg_loss, -1.0);
    assert.equal(A.payoff, 2.0);
    assert.equal(A.expectancy, 1.0);
    assert.equal(A.best_r, 2.4);
    assert.equal(A.worst_r, -1.0);
  });
  it("ignores fills without a numeric realized R; empty → zeros", () => {
    assert.equal(buildTrackRecordFromFills([{ actual: {} }]).n_trades, 0);
    assert.equal(buildTrackRecordFromFills([]).cum_r, 0);
  });
  it("excludes break-even fills (r=0) from win-rate", () => {
    const A = buildTrackRecordFromFills([
      { actual: { r: 1.6, usd: 320 } },
      { actual: { r: -1.0, usd: -200 } },
      { actual: { r: 0, usd: 0 } },
    ]);
    assert.equal(A.n_trades, 3);   // BE still a trade taken
    assert.equal(A.win_pct, 50);   // 1 win / (1 win + 1 loss) — BE excluded, not 33
  });
});

describe("buildTrackRecordByAccount", () => {
  const fills = [
    { account: "paper", actual: { r: 2, usd: 400 } },
    { account: "paper", actual: { r: -1, usd: -200 } },
    { account: "tradovate", actual: { r: -1, usd: -300 } },
    { actual: { r: 1, usd: 100 } }, // unlabelled
  ];
  it("separates track records per account — no cross-bleed", () => {
    const by = buildTrackRecordByAccount(fills);
    const paper = by.find((a) => a.account === "paper");
    const trad = by.find((a) => a.account === "tradovate");
    assert.equal(paper.n_trades, 2);
    assert.equal(paper.cum_r, 1);   // 2 + (-1); NOT polluted by tradovate's -1
    assert.equal(trad.n_trades, 1);
    assert.equal(trad.cum_r, -1);
  });
  it("buckets unlabelled fills under 'unknown'; empty input → []", () => {
    assert.ok(buildTrackRecordByAccount(fills).find((a) => a.account === "unknown"));
    assert.equal(buildTrackRecordByAccount([]).length, 0);
  });
  it("orders the busiest account first", () => {
    assert.equal(buildTrackRecordByAccount(fills)[0].account, "paper"); // 2 trades > 1
  });
});

describe("buildTrackRecordByAccount — per-accountId separation", () => {
  // Two distinct Tradovate accounts under the same broker label must NOT
  // collapse — the old key was the broker ("tradovate"), which merged them.
  const fills = [
    { ts: "2026-06-25T14:03:00Z", account: "tradovate", accountId: "D50756821", side: "long", symbol: "MNQ1!", qty: 1, actual: { r: -0.63, usd: -300 } },
    { ts: "2026-06-25T14:20:00Z", account: "tradovate", accountId: "D54902911", side: "sell", symbol: "MNQ1!", qty: 2, actual: { r: null, usd: 24.5 } },
    { ts: "2026-06-25T14:33:00Z", account: "tradovate", accountId: "D54902911", side: "sell", symbol: "MNQ1!", qty: 3, actual: { r: null, usd: -457.5 } },
  ];
  const confirmed = { id: "D50756821", name: "Tradovate (demo)", type: "live" };

  it("keys by accountId, not the broker label", () => {
    const by = buildTrackRecordByAccount(fills, confirmed);
    assert.equal(by.length, 2);
    assert.ok(by.find((a) => a.accountId === "D50756821"));
    assert.ok(by.find((a) => a.accountId === "D54902911"));
  });
  it("resolves the armed account's real name; others show their id", () => {
    const by = buildTrackRecordByAccount(fills, confirmed);
    assert.equal(by.find((a) => a.accountId === "D50756821").name, "Tradovate (demo)");
    assert.equal(by.find((a) => a.accountId === "D54902911").name, "D54902911");
  });
  it("flags the armed account and orders it first", () => {
    const by = buildTrackRecordByAccount(fills, confirmed);
    assert.equal(by[0].accountId, "D50756821"); // armed, despite fewer trades than D54902911
    assert.equal(by[0].armed, true);
    assert.equal(by.find((a) => a.accountId === "D54902911").armed, false);
  });
  it("counts ALL fills incl. un-bracketed (r:null) and sums real $", () => {
    const manual = buildTrackRecordByAccount(fills, confirmed).find((a) => a.accountId === "D54902911");
    assert.equal(manual.n_trades, 2);          // both fills, even though r is null
    assert.equal(manual.net_usd, -433);        // 24.5 + (-457.5), rounded
    assert.equal(manual.net_r, null);          // no bracketed R on either
  });
  it("attaches each account's trades newest-first", () => {
    const manual = buildTrackRecordByAccount(fills, confirmed).find((a) => a.accountId === "D54902911");
    assert.equal(manual.trades.length, 2);
    assert.equal(manual.trades[0].ts, "2026-06-25T14:33:00Z"); // newest first
  });
  it("always surfaces the armed account, even with zero fills here", () => {
    const by = buildTrackRecordByAccount([], confirmed);
    assert.equal(by.length, 1);
    assert.equal(by[0].accountId, "D50756821");
    assert.equal(by[0].n_trades, 0);
    assert.equal(by[0].armed, true);
  });
});

describe("resolveAccountName", () => {
  const confirmed = { id: "D50756821", name: "Tradovate (demo)" };
  it("uses the confirmed account's real name", () => {
    assert.equal(resolveAccountName("D50756821", "tradovate", confirmed), "Tradovate (demo)");
  });
  it("falls back to the account id for everything else (never invents)", () => {
    assert.equal(resolveAccountName("D54902911", "tradovate", confirmed), "D54902911");
    assert.equal(resolveAccountName("D54902911", "tradovate", null), "D54902911");
  });
  it("labels a truly unattributed fill", () => {
    assert.equal(resolveAccountName("unknown", null, confirmed), "Unattributed");
  });
});

describe("buildTrackRecord", () => {
  const rows = [
    { date: "2026-06-12", session: "ny-am", grade: "A+", stats: { setups: 3, accepted: 1, net_r: 1.6 } },
    { date: "2026-06-11", session: "ny-pm", grade: "B", stats: { setups: 2, accepted: 1, net_r: -1.0 } },
    { date: "2026-06-11", session: "ny-am", grade: "A+", stats: { setups: 4, accepted: 2, net_r: 2.4 } },
  ];
  it("sums cumulative R and session counts from real per-session totals", () => {
    const A = buildTrackRecord(rows);
    assert.equal(A.n_sessions, 3);
    assert.equal(A.cum_r, 3.0);
    assert.equal(A.win_sessions, 2);
    assert.equal(A.loss_sessions, 1);
    assert.equal(A.win_pct, 67);
    assert.equal(A.best_r, 2.4);
    assert.equal(A.worst_r, -1.0);
    assert.equal(A.setups_total, 9);
    assert.equal(A.accepted_total, 4);
  });
  it("groups R by session type and by grade", () => {
    const A = buildTrackRecord(rows);
    const am = A.by_session.find((s) => s.k === "NY-AM");
    assert.equal(am.r, 4.0);
    assert.equal(am.n, 2);
    const aplus = A.by_grade.find((g) => g.k === "A+");
    assert.equal(aplus.r, 4.0);
    assert.equal(aplus.n, 2);
  });
  it("handles an empty library without NaN", () => {
    const A = buildTrackRecord([]);
    assert.equal(A.n_sessions, 0);
    assert.equal(A.cum_r, 0);
    assert.equal(A.avg_r, 0);
    assert.deepEqual(A.by_session, []);
  });
});

describe("formatGradeShort", () => {
  it("shortens 'no-trade' to 'NO'", () => {
    assert.equal(formatGradeShort("no-trade"), "NO");
  });

  it("passes 'A+' and 'B' through unchanged", () => {
    assert.equal(formatGradeShort("A+"), "A+");
    assert.equal(formatGradeShort("B"), "B");
  });

  it("renders null/undefined as em-dash", () => {
    assert.equal(formatGradeShort(null), "—");
    assert.equal(formatGradeShort(undefined), "—");
  });
});

describe("deriveLedgerState", () => {
  it("returns NO-TRADE/amber for no-trade disposition", () => {
    const r = deriveLedgerState({ _disposition: "no-trade" }, null);
    assert.equal(r.label, "NO-TRADE");
    assert.equal(r.tone, "amber");
  });

  it("returns REJECTED/red for rejected disposition", () => {
    const r = deriveLedgerState({ _disposition: "rejected" }, null);
    assert.equal(r.label, "REJECTED");
    assert.equal(r.tone, "red");
  });

  it("returns CONFIRMED · TP1 for accepted + TP1_HIT outcome", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, { outcome: "TP1_HIT" });
    assert.equal(r.label, "CONFIRMED · TP1");
    assert.equal(r.tone, "green");
  });

  it("returns CONFIRMED · TP2 for accepted + TP2_HIT outcome", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, { outcome: "TP2_HIT" });
    assert.equal(r.label, "CONFIRMED · TP2");
    assert.equal(r.tone, "green");
  });

  it("returns STOPPED/red for accepted + STOPPED outcome", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, { outcome: "STOPPED" });
    assert.equal(r.label, "STOPPED");
    assert.equal(r.tone, "red");
  });

  it("returns INVALIDATED/red for accepted + INVALIDATED outcome", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, { outcome: "INVALIDATED" });
    assert.equal(r.label, "INVALIDATED");
    assert.equal(r.tone, "red");
  });

  it("returns PENDING/blue for accepted + pending_entry state", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, { state: "pending_entry" });
    assert.equal(r.label, "PENDING");
    assert.equal(r.tone, "blue");
  });

  it("returns OPEN/blue for accepted + filled state (no outcome)", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, { state: "filled" });
    assert.equal(r.label, "OPEN");
    assert.equal(r.tone, "blue");
  });

  it("returns OPEN/blue when accepted but no trade record yet", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, null);
    assert.equal(r.label, "OPEN");
  });

  it("returns em-dash/dim for unknown disposition", () => {
    const r = deriveLedgerState({ _disposition: "ignored" }, null);
    assert.equal(r.label, "—");
    assert.equal(r.tone, "dim");
  });
});

describe("deriveLedgerReason", () => {
  it("surfaces no_trade_reason for no-trade rows", () => {
    const r = deriveLedgerReason(
      { _disposition: "no-trade", no_trade_reason: "pillar2 poor · range 14pt" },
      null,
    );
    assert.match(r, /pillar2 poor/);
  });

  it("surfaces _rejection_reason for rejected rows", () => {
    const r = deriveLedgerReason(
      { _disposition: "rejected", _rejection_reason: "low conviction" },
      null,
    );
    assert.equal(r, "low conviction");
  });

  it("falls back to placeholder when rejection_reason is empty", () => {
    const r = deriveLedgerReason(
      { _disposition: "rejected", _rejection_reason: "" },
      null,
    );
    assert.match(r, /no reason given/);
  });

  it("emits 'stopped' for accepted + STOPPED", () => {
    const r = deriveLedgerReason(
      { _disposition: "accepted", model: "MSS" },
      { outcome: "STOPPED" },
    );
    assert.match(r, /stopped/);
  });

  it("emits 'model · click to expand' for accepted in-progress", () => {
    const r = deriveLedgerReason(
      { _disposition: "accepted", model: "MSS" },
      { outcome: "TP1_HIT" },
    );
    assert.match(r, /MSS/);
    assert.match(r, /expand/);
  });

  it("falls back to 'no reason given' for no-trade without reason", () => {
    const r = deriveLedgerReason(
      { _disposition: "no-trade", no_trade_reason: "" },
      null,
    );
    assert.match(r, /no reason given/);
  });
});

describe("buildLedger", () => {
  const setups = [
    { id: "s1", ts: "2026-05-27T13:35:00Z", _disposition: "no-trade", grade: "no-trade", no_trade_reason: "pillar2 poor", direction: "long", model: "MSS" },
    { id: "s2", ts: "2026-05-27T13:42:00Z", _disposition: "accepted", grade: "A+", direction: "long", model: "MSS" },
    { id: "s3", ts: "2026-05-27T13:51:00Z", _disposition: "rejected", _rejection_reason: "low conviction", grade: "B", direction: "short", model: "MSS" },
    { id: "s4", ts: "2026-05-27T13:30:00Z", _disposition: "ignored", grade: "no-trade", direction: "long", model: "Trend" },
  ];
  const trades = [
    { setup_id: "s2", outcome: "TP1_HIT", state: "filled", model: "MSS" },
  ];

  it("returns chronological rows sorted by setup.ts ascending", () => {
    const rows = buildLedger(setups, trades);
    const ids = rows.map((r) => r.setup.id);
    // ignored row (s4) is suppressed; rest are sorted by ts.
    assert.deepEqual(ids, ["s1", "s2", "s3"]);
  });

  it("suppresses rows with _disposition === 'ignored'", () => {
    const rows = buildLedger(setups, trades);
    assert.equal(rows.find((r) => r.setup.id === "s4"), undefined);
  });

  it("attaches the matching trade to accepted rows only", () => {
    const rows = buildLedger(setups, trades);
    const accepted = rows.find((r) => r.setup.id === "s2");
    assert.equal(accepted.trade.outcome, "TP1_HIT");
    const noTrade = rows.find((r) => r.setup.id === "s1");
    assert.equal(noTrade.trade, null);
  });

  it("marks accepted rows with a trade as expandable", () => {
    const rows = buildLedger(setups, trades);
    const accepted = rows.find((r) => r.setup.id === "s2");
    assert.equal(accepted.expandable, true);
    const rejected = rows.find((r) => r.setup.id === "s3");
    assert.equal(rejected.expandable, false);
  });

  it("returns empty array on missing inputs", () => {
    assert.deepEqual(buildLedger(undefined, undefined), []);
    assert.deepEqual(buildLedger([], []), []);
  });

  it("places rows with missing ts at the front (stable insertion)", () => {
    const noTs = [
      { id: "a", _disposition: "no-trade", grade: "no-trade" },
      { id: "b", ts: "2026-05-27T13:00:00Z", _disposition: "no-trade", grade: "no-trade" },
    ];
    const rows = buildLedger(noTs, []);
    assert.equal(rows[0].setup.id, "a");
    assert.equal(rows[1].setup.id, "b");
  });
});

describe("degradedChainStages", () => {
  const audit = {
    brief: {
      mnq: { chain_status: "clean" },
      mes: { chain_status: "degraded:htf_partial" },
    },
    open_reaction: { chain_status: "degraded:missing_ltf_bias" },
    entry_hunt: { chain_status: "degraded:missing_setups" },
    outcome: { chain_status: "clean" },
  };

  it("collects degraded stages from nested and flat chain_audit entries", () => {
    const rows = degradedChainStages(audit);
    assert.deepEqual(rows, [
      { stage: "brief.mes", status: "degraded:htf_partial" },
      { stage: "open_reaction", status: "degraded:missing_ltf_bias" },
      { stage: "entry_hunt", status: "degraded:missing_setups" },
    ]);
  });

  it("flags stale:* but not clean / divergent / backfilled / n-a", () => {
    const rows = degradedChainStages({
      a: { chain_status: "stale:12" },
      b: { chain_status: "divergent" },
      c: { chain_status: "backfilled:open_reaction" },
      d: { chain_status: "n/a" },
    });
    assert.deepEqual(rows, [{ stage: "a", status: "stale:12" }]);
  });

  it("null/missing audit returns empty array", () => {
    assert.deepEqual(degradedChainStages(null), []);
    assert.deepEqual(degradedChainStages({}), []);
  });
});
