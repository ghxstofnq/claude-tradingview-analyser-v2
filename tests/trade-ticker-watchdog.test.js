import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { eodDue, eodFlattenNow } from "../app/main/execution/reconciler.js";
import { runEodCheck, etNow } from "../app/main/trade-ticker-watchdog.js";

const okOpen = (position) => ({ ok: true, position, account_id: "A1" });
const okFlat = { ok: true, position: null, account_id: "A1" };
const unreadable = { ok: false, position: null };
const LONG = { symbol: "MNQ1!", side: "buy", qty: 2 };

// ── (21)-(23) eodDue boundaries ─────────────────────────────────────────────
describe("eodDue boundaries", () => {
  it("(21) before 16:00 ET → false", () => {
    assert.equal(eodDue({ nowEtMinutes: 15 * 60 + 59, lastEodDate: null, todayEt: "2026-07-10" }), false);
  });
  it("(22) at/after 16:00 ET and not yet run today → true", () => {
    assert.equal(eodDue({ nowEtMinutes: 16 * 60, lastEodDate: null, todayEt: "2026-07-10" }), true);
    assert.equal(eodDue({ nowEtMinutes: 16 * 60 + 30, lastEodDate: "2026-07-09", todayEt: "2026-07-10" }), true);
  });
  it("(23) already ran today → false (idempotent per trading day)", () => {
    assert.equal(eodDue({ nowEtMinutes: 16 * 60 + 5, lastEodDate: "2026-07-10", todayEt: "2026-07-10" }), false);
  });
  it("etNow returns ET minutes + date", () => {
    const r = etNow(Date.parse("2026-07-10T20:05:00Z")); // 16:05 ET (EDT)
    assert.equal(r.minutes, 16 * 60 + 5);
    assert.equal(r.date, "2026-07-10");
  });
});

// ── (24) EOD while detector down — timer path independent of bar events ──────
describe("runEodCheck independence", () => {
  it("(24) fires the flatten with no bar events involved", async () => {
    let called = 0;
    const flatten = async () => { called += 1; return { confirmedFlat: true }; };
    const etNowFn = () => ({ minutes: 16 * 60 + 1, date: "2026-07-10" });
    const out = await runEodCheck({ lastEodDate: null, etNowFn, flatten });
    assert.equal(called, 1, "flatten was invoked purely off the clock, no bar events");
    assert.equal(out.ran, true);
    assert.equal(out.confirmedFlat, true);
    assert.equal(out.lastEodDate, "2026-07-10", "latch advances on confirmed flat");
  });

  it("does NOT advance the latch on an unconfirmed flatten (retries next tick)", async () => {
    const flatten = async () => ({ confirmedFlat: false });
    const etNowFn = () => ({ minutes: 16 * 60 + 1, date: "2026-07-10" });
    const out = await runEodCheck({ lastEodDate: null, etNowFn, flatten });
    assert.equal(out.ran, true);
    assert.equal(out.confirmedFlat, false);
    assert.equal(out.lastEodDate, null, "latch stays open so the next tick retries");
  });

  it("no-op before 16:00 ET", async () => {
    let called = 0;
    const flatten = async () => { called += 1; return { confirmedFlat: true }; };
    const etNowFn = () => ({ minutes: 15 * 60, date: "2026-07-10" });
    const out = await runEodCheck({ lastEodDate: null, etNowFn, flatten });
    assert.equal(called, 0);
    assert.equal(out.ran, false);
  });
});

// ── (25)-(27) eodFlattenNow behaviour with injected deps ────────────────────
describe("eodFlattenNow", () => {
  function fakeDeps(over = {}) {
    const records = [];
    return {
      records,
      readBroker: over.readBroker,
      readStop: over.readStop || (async () => true),
      getJournalOpen: over.getJournalOpen || (async () => null),
      flatten: over.flatten || (async () => ({ ok: true })),
      cancelWorkingOrders: over.cancelWorkingOrders || (async () => ({ ok: true, cancelled: 0 })),
      recordReconciliation: async (r) => { records.push(r); },
      setReconciliationHealthy: () => {},
      emitError: over.emitError || (() => {}),
      accountId: () => "A1",
    };
  }

  it("(25) open at EOD → flatten + cancel + re-reconcile → confirmed flat → record", async () => {
    let broker = okOpen(LONG);
    const flattenCalls = [];
    const cancelCalls = [];
    const deps = fakeDeps({
      readBroker: async () => broker, // starts open; flatten flips it flat
      flatten: async (p) => { flattenCalls.push(p); broker = okFlat; return { ok: true }; },
      cancelWorkingOrders: async () => { cancelCalls.push(1); return { ok: true, cancelled: 1 }; },
    });
    const res = await eodFlattenNow({ deps, now: 0, tradingDay: "2026-07-10" });
    assert.equal(flattenCalls.length, 1, "flattened the net position");
    assert.equal(cancelCalls.length, 1, "cancelled the working bracket");
    assert.equal(res.confirmedFlat, true);
    const rec = deps.records.at(-1);
    assert.equal(rec.action, "eod_flatten");
    assert.equal(rec.confirmed_flat, true);
    assert.equal(rec.trading_day, "2026-07-10");
  });

  it("(26) confirmed flat at EOD → idempotent no-op (already_flat), no flatten", async () => {
    let flattened = 0;
    const deps = fakeDeps({
      readBroker: async () => okFlat,
      flatten: async () => { flattened += 1; return { ok: true }; },
    });
    const res = await eodFlattenNow({ deps, now: 0, tradingDay: "2026-07-10" });
    assert.equal(flattened, 0, "never flattens an already-flat broker");
    assert.equal(res.confirmedFlat, true);
    assert.equal(res.alreadyFlat, true);
    assert.equal(deps.records.at(-1).note, "already_flat");
  });

  it("(27) MANUAL (non-tranche) position at EOD → still broker-flattened (net flatten)", async () => {
    // A position with NO tranche/standalone markers — the manual-bracket gap the
    // bar path never covered. The broker flatten closes the NET position anyway.
    let broker = okOpen({ symbol: "MNQ1!", side: "sell", qty: 1 }); // manual short
    let flattened = 0;
    const deps = fakeDeps({
      readBroker: async () => broker,
      getJournalOpen: async () => null, // journal doesn't even know about it
      flatten: async () => { flattened += 1; broker = okFlat; return { ok: true }; },
    });
    const res = await eodFlattenNow({ deps, now: 0, tradingDay: "2026-07-10" });
    assert.equal(flattened, 1, "manual position flattened at the broker despite no journal row");
    assert.equal(res.confirmedFlat, true);
  });

  it("unreadable broker at EOD → UNKNOWN, never assumes flat, retries", async () => {
    const deps = fakeDeps({ readBroker: async () => unreadable });
    const res = await eodFlattenNow({ deps, now: 0, tradingDay: "2026-07-10" });
    assert.equal(res.confirmedFlat, false);
    assert.equal(res.state, "UNKNOWN");
    assert.equal(deps.records.at(-1).confirmed_flat, false);
  });
});
