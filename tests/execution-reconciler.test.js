import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RECONCILE_STATES, reconcile, reconciliationGatesAuto, latestReconciliation,
  planAdopt, planProtect, planFlatten, createReconciler,
} from "../app/main/execution/reconciler.js";
import { parseJsonlTolerant } from "../cli/lib/jsonl.js";
import { getReconciliationHealthy, setReconciliationHealthy } from "../app/main/execution/auto-resume.js";

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
