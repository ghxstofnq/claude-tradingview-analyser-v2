// Task C3.1 data contract for the execution:orderIntents IPC. The handler is a
// thin, RAW pass-through: it parses order-intents.jsonl tolerantly and returns
// { records, dropped, reconcile } WITHOUT folding or inventing ages — the
// renderer re-derives the lifecycle. electron can't load under node --test, so
// this proves the contract at the data layer the handler is built from:
// parseJsonlTolerant → raw records survive to foldIntentChain (the renderer
// consumer), and a torn tail line propagates as dropped>0.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseJsonlTolerant } from "../cli/lib/jsonl.js";
import { foldIntentChain, deriveTimeline } from "../app/renderer/src/LiveTimeline.helpers.js";

// A realistic append-only journal: one full chain (3 transitions, same
// decision_id) plus a torn final line from a crash mid-append.
const JOURNAL =
  JSON.stringify({ decision_id: "OI-A", state: "INTENT_CREATED", symbol: "MNQ1!", side: "buy", ts: "2026-07-10T13:30:00Z" }) + "\n" +
  JSON.stringify({ decision_id: "OI-A", state: "SUBMITTING", symbol: "MNQ1!", side: "buy", ts: "2026-07-10T13:30:01Z" }) + "\n" +
  JSON.stringify({ decision_id: "OI-A", state: "BROKER_ACKNOWLEDGED", symbol: "MNQ1!", side: "buy", ts: "2026-07-10T13:30:02Z" }) + "\n" +
  '{"decision_id":"OI-A","state":"POSIT'; // torn tail (power-loss mid-append)

describe("execution:orderIntents — RAW records + dropped contract", () => {
  it("returns records UNFOLDED (every transition preserved, not last-wins)", () => {
    const { records, dropped } = parseJsonlTolerant(JOURNAL);
    // Three intact transitions for the same decision_id — the handler must NOT
    // collapse them (folding is the renderer's job).
    const forA = records.filter((r) => r.decision_id === "OI-A");
    assert.equal(forA.length, 3);
    assert.deepEqual(forA.map((r) => r.state), ["INTENT_CREATED", "SUBMITTING", "BROKER_ACKNOWLEDGED"]);
    assert.equal(dropped, 1, "the torn tail line must surface as dropped");
  });

  it("the renderer folds the raw records to the correct active chain", () => {
    const { records } = parseJsonlTolerant(JOURNAL);
    const { active } = foldIntentChain(records, { symbol: "MNQ1!" });
    assert.equal(active.decision_id, "OI-A");
    assert.equal(active.state, "BROKER_ACKNOWLEDGED"); // last intact transition
    assert.equal(active.transitions.length, 3);
  });

  it("dropped>0 drives the renderer to a CORRUPT, blocked rail", () => {
    const { records, dropped } = parseJsonlTolerant(JOURNAL);
    const { active } = foldIntentChain(records, { symbol: "MNQ1!" });
    const rail = deriveTimeline({ chain: active, dropped });
    assert.equal(rail.corrupt, true);
    assert.equal(rail.blocked, true);
    assert.equal(rail.recovery.kind, "CORRUPT");
  });

  it("an absent / empty journal yields zero records and zero dropped", () => {
    assert.deepEqual(parseJsonlTolerant(""), { records: [], dropped: 0 });
  });
});
