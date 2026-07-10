import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RECONCILE_STATES, reconcile, reconciliationGatesAuto, latestReconciliation,
  planAdopt, planProtect, planFlatten, createReconciler, startReconciler,
  eodDue, lastEodDateFrom, eodFlattenNow, runReconcileWithBurst,
} from "../app/main/execution/reconciler.js";
import { parseJsonlTolerant } from "../cli/lib/jsonl.js";
import { getReconciliationHealthy, setReconciliationHealthy } from "../app/main/execution/auto-resume.js";
import { interpretPositionSnapshot } from "../app/main/execution/tv-adapter.js";

const R = RECONCILE_STATES;
const okOpen = (position) => ({ ok: true, position });
const okFlat = { ok: true, position: null };
const unreadable = { ok: false, position: null };
const POS = { symbol: "MNQ1!", side: "buy", qty: 1 };

// ── Matrix — one row per state ──────────────────────────────────────────────
describe("reconcile matrix", () => {
  it("row 1: journal flat + broker flat → HEALTHY / none", () => {
    const r = reconcile({ journalOpen: false, brokerRead: okFlat });
    assert.equal(r.state, R.HEALTHY);
    assert.equal(r.action, "none");
    assert.deepEqual(r.blockers, []);
  });

  it("row 2: journal open + broker flat → JOURNAL_STALE / close_journal", () => {
    const r = reconcile({ journalOpen: true, brokerRead: okFlat });
    assert.equal(r.state, R.JOURNAL_STALE);
    assert.equal(r.action, "close_journal");
  });

  it("row 3: journal flat + broker open (stop present) → ORPHAN_POSITION / adopt_or_flatten", () => {
    const r = reconcile({ journalOpen: false, brokerRead: okOpen(POS), stopPresent: true });
    assert.equal(r.state, R.ORPHAN_POSITION);
    assert.equal(r.action, "adopt_or_flatten");
  });

  it("row 4: broker open + NO stop → CRITICAL_NO_STOP / protect_or_flatten (outranks orphan + qty)", () => {
    // journal flat, no stop
    assert.equal(reconcile({ journalOpen: false, brokerRead: okOpen(POS), stopPresent: false }).state, R.CRITICAL_NO_STOP);
    // journal open, no stop, qty mismatch — still no-stop wins
    assert.equal(reconcile({ journalOpen: true, brokerRead: okOpen(POS), stopPresent: false, qtyAgree: false }).state, R.CRITICAL_NO_STOP);
    assert.equal(reconcile({ journalOpen: true, brokerRead: okOpen(POS), stopPresent: false, qtyAgree: false }).action, "protect_or_flatten");
  });

  it("row 5: journal open + broker open + stop present + qty mismatch → CRITICAL_QTY_MISMATCH", () => {
    const r = reconcile({ journalOpen: true, brokerRead: okOpen(POS), stopPresent: true, qtyAgree: false });
    assert.equal(r.state, R.CRITICAL_QTY_MISMATCH);
    assert.equal(r.action, "manual_reconcile");
  });

  it("row 6: journal open + broker open + stop present + qty agree → MANAGEMENT_ONLY / none", () => {
    const r = reconcile({ journalOpen: true, brokerRead: okOpen(POS), stopPresent: true, qtyAgree: true });
    assert.equal(r.state, R.MANAGEMENT_ONLY);
    assert.equal(r.action, "none");
  });

  it("row 7: broker unreadable → UNKNOWN / retry (never infers flat)", () => {
    const r = reconcile({ journalOpen: false, brokerRead: unreadable });
    assert.equal(r.state, R.UNKNOWN);
    assert.equal(r.action, "retry");
    // A journal-open + unreadable broker is STILL unknown — we never assume flat.
    assert.equal(reconcile({ journalOpen: true, brokerRead: unreadable }).state, R.UNKNOWN);
    assert.equal(reconcile({ journalOpen: true, brokerRead: null }).state, R.UNKNOWN);
  });
});

// ── reconciliationGatesAuto ─────────────────────────────────────────────────
describe("reconciliationGatesAuto", () => {
  it("is true ONLY for HEALTHY", () => {
    assert.equal(reconciliationGatesAuto(R.HEALTHY), true);
    for (const s of Object.values(R)) {
      if (s === R.HEALTHY) continue;
      assert.equal(reconciliationGatesAuto(s), false, `${s} must not gate auto`);
    }
  });
});

// ── Operator planners — pure, no writes ─────────────────────────────────────
describe("operator planners", () => {
  const brokerPos = { symbol: "MNQ1!", side: "buy", qty: 2, avgFill: 21000 };

  it("planAdopt → accept+FILLED journal pair (source adopted) + POSITION_CONFIRMED intent", () => {
    const p = planAdopt(brokerPos);
    assert.equal(p.journal.length, 2);
    assert.equal(p.journal[0].type, "accept");
    assert.equal(p.journal[0].source, "adopted");
    assert.equal(p.journal[0].side, "long");
    assert.equal(p.journal[0].symbol, "MNQ1!");
    assert.equal(p.journal[0].entry, 21000);
    // Cheap hardening: the accept carries the broker qty so the next boot's
    // qtyMatches doesn't false-alarm CRITICAL_QTY_MISMATCH.
    assert.equal(p.journal[0].contracts, 2);
    assert.equal(p.journal[0].size.contracts, 2);
    assert.equal(p.journal[1].type, "outcome");
    assert.equal(p.journal[1].status, "FILLED");
    assert.equal(p.intent.state, "POSITION_CONFIRMED");
    assert.equal(p.intent.qty, 2);
    assert.equal(p.intent.trade_id, p.trade_id);
    assert.match(p.decision_id, /^OI-[0-9a-f]{8}$/);
  });

  it("planProtect → a stop order on the EXIT side at the given price", () => {
    const s = planProtect(brokerPos, 20950);
    assert.equal(s.type, "stop");
    assert.equal(s.side, "sell"); // exit side of a long
    assert.equal(s.price, 20950);
    assert.equal(s.contracts, 2);
    assert.equal(s.symbol, "MNQ1!");
  });

  it("planFlatten → a close spec matching the position", () => {
    const f = planFlatten(brokerPos);
    assert.equal(f.kind, "close");
    assert.equal(f.symbol, "MNQ1!");
    assert.equal(f.contracts, 2);
    assert.equal(f.side, "long");
  });
});

// ── latestReconciliation / restart idempotency ──────────────────────────────
describe("latestReconciliation", () => {
  it("returns the last record (restart reads the authoritative last line)", () => {
    const recs = [
      { ts: "t1", state: R.UNKNOWN },
      { ts: "t2", state: R.UNKNOWN },
      { ts: "t3", state: R.HEALTHY },
    ];
    assert.equal(latestReconciliation(recs).state, R.HEALTHY);
  });
  it("survives a torn tail line via parseJsonlTolerant", () => {
    const txt = [
      JSON.stringify({ state: R.UNKNOWN }),
      JSON.stringify({ state: R.HEALTHY }),
      '{"state":"MANAG', // torn
    ].join("\n");
    const { records, dropped } = parseJsonlTolerant(txt);
    assert.equal(dropped, 1);
    assert.equal(latestReconciliation(records).state, R.HEALTHY);
  });
  it("empty → null", () => {
    assert.equal(latestReconciliation([]), null);
  });
});

// ── createReconciler runtime (fake deps, no IO) ─────────────────────────────
describe("createReconciler", () => {
  function fakeDeps(over = {}) {
    const persisted = [];
    const gate = { healthy: null };
    const errors = [];
    const deps = {
      getJournalOpen: async () => null,
      readBroker: async () => okFlat,
      readStop: async () => false,
      recordReconciliation: async (rec) => { persisted.push(rec); },
      setReconciliationHealthy: (v) => { gate.healthy = v; },
      emitError: (o) => { errors.push(o); },
      accountId: () => "acct-1",
      ...over,
    };
    return { deps, persisted, gate, errors };
  }

  it("persists a record + sets the gate healthy on a HEALTHY reconciliation", async () => {
    const { deps, persisted, gate } = fakeDeps();
    const r = await createReconciler(deps).runReconcile();
    assert.equal(r.state, R.HEALTHY);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].state, R.HEALTHY);
    assert.equal(gate.healthy, true);
  });

  it("boot read not up (ok:false) → UNKNOWN, gate CLOSED; retry once broker answers → resolves", async () => {
    let up = false;
    const { deps, gate } = fakeDeps({ readBroker: async () => (up ? okFlat : unreadable) });
    const rec = createReconciler(deps);
    const first = await rec.runReconcile();
    assert.equal(first.state, R.UNKNOWN);
    assert.equal(gate.healthy, false, "gate closed while UNKNOWN");
    up = true;
    const second = await rec.runReconcile();
    assert.equal(second.state, R.HEALTHY);
    assert.equal(gate.healthy, true);
  });

  it("emits a loud app:error on CRITICAL_NO_STOP and leaves the gate closed", async () => {
    const { deps, gate, errors } = fakeDeps({ readBroker: async () => okOpen(POS), readStop: async () => false });
    const r = await createReconciler(deps).runReconcile();
    assert.equal(r.state, R.CRITICAL_NO_STOP);
    assert.equal(gate.healthy, false);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].level, "error");
  });

  it("emits app:error on ORPHAN_POSITION", async () => {
    const { deps, errors } = fakeDeps({ getJournalOpen: async () => null, readBroker: async () => okOpen(POS), readStop: async () => true });
    const r = await createReconciler(deps).runReconcile();
    assert.equal(r.state, R.ORPHAN_POSITION);
    assert.equal(errors.length, 1);
  });

  it("qty mismatch between journal + broker → CRITICAL_QTY_MISMATCH", async () => {
    const { deps, errors } = fakeDeps({
      getJournalOpen: async () => ({ id: "T-1", contracts: 3 }),
      readBroker: async () => okOpen({ symbol: "MNQ1!", side: "buy", qty: 1 }),
      readStop: async () => true,
    });
    const r = await createReconciler(deps).runReconcile();
    assert.equal(r.state, R.CRITICAL_QTY_MISMATCH);
    assert.equal(errors.length, 1);
  });

  it("matched qty + stop present → MANAGEMENT_ONLY (no error, gate stays closed)", async () => {
    const { deps, gate, errors } = fakeDeps({
      getJournalOpen: async () => ({ id: "T-1", contracts: 1 }),
      readBroker: async () => okOpen({ symbol: "MNQ1!", side: "buy", qty: 1 }),
      readStop: async () => true,
    });
    const r = await createReconciler(deps).runReconcile();
    assert.equal(r.state, R.MANAGEMENT_ONLY);
    assert.equal(errors.length, 0);
    assert.equal(gate.healthy, false, "auto stays paused on an already-open managed position");
  });
});

// ── B-1: recovery_held / stale journal has an EXIT path ─────────────────────
describe("createReconciler close_journal (B-1 escape hatch)", () => {
  it("JOURNAL_STALE with a recovery_held row → closeJournalStale runs, re-runs to HEALTHY, gate opens", async () => {
    let closed = false;
    const gate = { healthy: null };
    const deps = {
      // Before the close: an open recovery_held row. After: journal flat.
      getJournalOpen: async () => (closed ? null : { id: "R", state: "recovery_held" }),
      readBroker: async () => okFlat,                 // broker CONFIRMED flat
      readStop: async () => false,
      closeJournalStale: async () => { closed = true; return 1; },
      recordReconciliation: async () => {},
      setReconciliationHealthy: (v) => { gate.healthy = v; },
      emitError: () => {},
    };
    const r = await createReconciler(deps).runReconcile();
    assert.equal(closed, true, "close_journal executed");
    assert.equal(r.state, R.HEALTHY, "recomputed to HEALTHY after the stale row was closed");
    assert.equal(gate.healthy, true, "auto gate opened once the session was unblocked");
  });

  it("does NOT re-run / open the gate when there is no closeable row (a filled row is left alone)", async () => {
    const gate = { healthy: null };
    const deps = {
      getJournalOpen: async () => ({ id: "F", state: "filled" }),
      readBroker: async () => okFlat,
      readStop: async () => false,
      closeJournalStale: async () => 0, // filled row → nothing closed (P&L safety)
      recordReconciliation: async () => {},
      setReconciliationHealthy: (v) => { gate.healthy = v; },
      emitError: () => {},
    };
    const r = await createReconciler(deps).runReconcile();
    assert.equal(r.state, R.JOURNAL_STALE);
    assert.equal(gate.healthy, false, "stays paused pending the operator");
  });
});

// ── B-2: readStateSafe snapshot interpretation (panel-collapsed → ok:false) ──
describe("interpretPositionSnapshot (B-2 phantom-flat guard)", () => {
  it("collapsed panel (no positions table) → ok:false, never a confirmed flat", () => {
    const r = interpretPositionSnapshot({ connected: true, tablePresent: false, position: null });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "panel_unreadable");
  });
  it("disconnected → ok:false", () => {
    assert.equal(interpretPositionSnapshot({ connected: false, tablePresent: true }).ok, false);
    assert.equal(interpretPositionSnapshot(null).ok, false);
  });
  it("table present + connected + empty → ok:true, position null (a verifiable flat)", () => {
    const r = interpretPositionSnapshot({ connected: true, tablePresent: true, position: null });
    assert.deepEqual(r, { ok: true, position: null, connected: true });
  });
  it("table present + a live position → ok:true with the position", () => {
    const pos = { symbol: "MNQ1!", side: "buy", qty: 1 };
    assert.deepEqual(interpretPositionSnapshot({ connected: true, tablePresent: true, position: pos }), { ok: true, position: pos, connected: true });
  });
});

// ── I-1: paper auto is never silently bricked ───────────────────────────────
describe("startReconciler burst/backoff (I-1)", () => {
  it("emits ONE loud error when the fast burst ends still-UNKNOWN, then a later HEALTHY stops the loop", async () => {
    const errors = [];
    const send = (ch, p) => { if (ch === "app:error") errors.push(p); };
    let calls = 0;
    const runOnce = async () => { calls += 1; return { state: calls <= 7 ? R.UNKNOWN : R.HEALTHY }; };
    const queue = [];
    const schedule = (fn) => { queue.push(fn); };       // synchronous, drained by the test
    startReconciler({ send, runOnce, schedule });
    for (let i = 0; i < 40 && queue.length; i += 1) { const fn = queue.shift(); await fn(); }
    // Burst is 6: at the 6th UNKNOWN the burst-exhausted error fires exactly once.
    assert.equal(errors.length, 1, "exactly one burst-exhausted error");
    assert.match(errors[0].message, /UNREADABLE/);
    assert.equal(errors[0].level, "error");
    assert.ok(calls >= 8, "kept retrying past the burst until HEALTHY");
  });

  it("a non-HEALTHY-but-resolved boot (e.g. MANAGEMENT_ONLY) emits a one-time summary", async () => {
    const errors = [];
    const send = (ch, p) => { if (ch === "app:error") errors.push(p); };
    const runOnce = async () => ({ state: R.MANAGEMENT_ONLY });
    const queue = [];
    const schedule = (fn) => { queue.push(fn); };
    startReconciler({ send, runOnce, schedule });
    for (let i = 0; i < 5 && queue.length; i += 1) { const fn = queue.shift(); await fn(); }
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /PAUSED/);
  });
});

// A fresh reconcile can flip the auto gate false→true — the mechanism
// execution:resumeAuto relies on instead of circularly refusing.
describe("a fresh reconcile flips the auto gate", () => {
  it("HEALTHY run sets getReconciliationHealthy() true", async () => {
    setReconciliationHealthy(false);
    assert.equal(getReconciliationHealthy(), false);
    await createReconciler({
      getJournalOpen: async () => null,
      readBroker: async () => okFlat,
      recordReconciliation: async () => {},
      setReconciliationHealthy,
    }).runReconcile();
    assert.equal(getReconciliationHealthy(), true);
    setReconciliationHealthy(false); // reset for other tests
  });
});

// ── B4: broker-clock EOD ────────────────────────────────────────────────────
describe("eodDue / lastEodDateFrom", () => {
  it("fires at/after 16:00 ET, once per trading day", () => {
    assert.equal(eodDue({ nowEtMinutes: 959, lastEodDate: null, todayEt: "2026-07-10" }), false);
    assert.equal(eodDue({ nowEtMinutes: 960, lastEodDate: null, todayEt: "2026-07-10" }), true);
    assert.equal(eodDue({ nowEtMinutes: 970, lastEodDate: "2026-07-10", todayEt: "2026-07-10" }), false);
    assert.equal(eodDue({ nowEtMinutes: 970, lastEodDate: "2026-07-09", todayEt: "2026-07-10" }), true);
    assert.equal(eodDue({ nowEtMinutes: NaN, lastEodDate: null, todayEt: "2026-07-10" }), false);
  });
  it("lastEodDateFrom returns the last CONFIRMED eod date only", () => {
    assert.equal(lastEodDateFrom([]), null);
    assert.equal(lastEodDateFrom([{ action: "eod_flatten", confirmed_flat: false, trading_day: "2026-07-10" }]), null);
    assert.equal(lastEodDateFrom([
      { action: "eod_flatten", confirmed_flat: true, trading_day: "2026-07-09" },
      { action: "eod_flatten", confirmed_flat: false, trading_day: "2026-07-10" },
    ]), "2026-07-09");
  });
});

describe("eodFlattenNow is confirmed-flat gated", () => {
  function deps(over) {
    const records = [];
    return {
      _records: records,
      readStop: async () => true,
      getJournalOpen: async () => null,
      flatten: async () => ({ ok: true }),
      cancelWorkingOrders: async () => ({ ok: true }),
      recordReconciliation: async (r) => { records.push(r); },
      setReconciliationHealthy: () => {},
      emitError: () => {},
      accountId: () => "acct-1",
      ...over,
    };
  }
  it("confirmed flat on the re-read → confirmed_flat true", async () => {
    let broker = okOpen(POS);
    const d = deps({ readBroker: async () => broker, flatten: async () => { broker = okFlat; return { ok: true }; } });
    const res = await eodFlattenNow({ deps: d, now: 0, tradingDay: "2026-07-10" });
    assert.equal(res.confirmedFlat, true);
    assert.equal(d._records.at(-1).confirmed_flat, true);
  });
  it("re-read still open → confirmed_flat FALSE (never reports flat)", async () => {
    const d = deps({ readBroker: async () => okOpen(POS) }); // stays open
    const res = await eodFlattenNow({ deps: d, now: 0, tradingDay: "2026-07-10" });
    assert.equal(res.confirmedFlat, false);
    assert.equal(res.state, R.UNKNOWN);
  });
});

describe("runReconcileWithBurst does not flap a HEALTHY gate on transient UNKNOWN", () => {
  it("a transient UNKNOWN mid-burst restores the prior HEALTHY gate, then settles", async () => {
    let gate = true; // prior settled HEALTHY
    let call = 0;
    const runOnce = async () => {
      call += 1;
      if (call === 1) { gate = false; return { state: R.UNKNOWN }; } // internal write flips false
      gate = true; return { state: R.HEALTHY };
    };
    const res = await runReconcileWithBurst({
      runOnce, attempts: 4, delayMs: 0,
      getGate: () => gate, setGate: (v) => { gate = v; }, sleep: async () => {},
    });
    assert.equal(res.state, R.HEALTHY);
    assert.equal(gate, true, "gate never left flapped-false after the transient");
    assert.ok(call >= 2, "retried past the transient UNKNOWN");
  });
  it("returns the settled result without extra retries", async () => {
    let call = 0;
    const res = await runReconcileWithBurst({ runOnce: async () => { call += 1; return { state: R.MANAGEMENT_ONLY }; }, getGate: () => false, setGate: () => {}, sleep: async () => {} });
    assert.equal(res.state, R.MANAGEMENT_ONLY);
    assert.equal(call, 1, "no retries once settled");
  });
});

// ── auto-resume reconciliation gate ─────────────────────────────────────────
describe("auto-resume reconciliation flag", () => {
  it("defaults false and round-trips through the setter", () => {
    // Default is false on process start.
    assert.equal(getReconciliationHealthy(), false);
    setReconciliationHealthy(true);
    assert.equal(getReconciliationHealthy(), true);
    setReconciliationHealthy(false);
    assert.equal(getReconciliationHealthy(), false);
    // Only an explicit true sets it (fail-closed coercion).
    setReconciliationHealthy("yes");
    assert.equal(getReconciliationHealthy(), false);
  });
});
