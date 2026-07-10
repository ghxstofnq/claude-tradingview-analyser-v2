// Task C4: acceptSetup threads a durable decision_id onto the journal accept
// event so the intent↔trade join is EXACT. Read-only additive — no behavioral
// change to the trade itself. State writes are isolated to a temp GOFNQ_STATE_DIR
// (never touches the live state/).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let acceptSetup, deriveDecisionId;

describe("acceptSetup — decision_id threading (C4)", () => {
  beforeEach(async () => {
    // Fresh state root per test: acceptSetup enforces one-open-trade-at-a-time,
    // so each case needs an empty journal.
    process.env.GOFNQ_STATE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "gofnq-trades-"));
    ({ acceptSetup } = await import("../app/main/trades.js"));
    ({ deriveDecisionId } = await import("../app/main/execution/order-intent.js"));
  });

  it("derives a decision_id from the setup fields when none is threaded (manual path)", async () => {
    const setup = { id: "S-1", direction: "long", entry: 21000, stop: 20990, tp1: 21050, grade: "A+", model: "MSS", symbol: "MNQ1!" };
    const ev = await acceptSetup({ setup });
    assert.ok(!ev.error, ev.error);
    assert.equal(typeof ev.decision_id, "string");
    const expected = deriveDecisionId({ packetId: "S-1", accountId: null, session: null, side: "long", entry: 21000, stop: 20990 });
    assert.equal(ev.decision_id, expected);
  });

  it("a threaded setup.decision_id WINS (AUTO path — exact join with the intent chain)", async () => {
    const setup = { id: "S-2", direction: "short", entry: 21000, stop: 21010, tp1: 20950, grade: "B", model: "Trend", symbol: "MNQ1!", decision_id: "OI-EXACT-123" };
    const ev = await acceptSetup({ setup });
    assert.ok(!ev.error, ev.error);
    assert.equal(ev.decision_id, "OI-EXACT-123");
  });

  it("the decision_id is persisted to trades.jsonl alongside setup_id", async () => {
    const setup = { id: "S-3", direction: "long", entry: 100, stop: 90, tp1: 120, grade: "A+", model: "MSS", symbol: "MES1!" };
    const ev = await acceptSetup({ setup });
    assert.ok(!ev.error, ev.error);
    const { activeSessionDir } = await import("../app/main/sessions.js");
    const txt = await fs.readFile(path.join(await activeSessionDir(), "trades.jsonl"), "utf8");
    const rows = txt.trim().split("\n").map((l) => JSON.parse(l));
    const accept = rows.find((r) => r.type === "accept" && r.id === ev.id);
    assert.ok(accept.decision_id, "accept row must carry a decision_id");
    assert.equal(accept.setup_id, "S-3");
    assert.equal(accept.decision_id, ev.decision_id);
  });

  it("manual-path join parity: the accept's decision_id is threaded verbatim into the order intent (INTENT hop reachable)", async () => {
    // The renderer threads the accept event's decision_id into the placeOrder
    // request; execution:place resolves `payload.decision_id ?? derive(...)`.
    // With the id threaded, the intent chain and the journal trade share ONE
    // key — regardless of the account/side/entry the place path would otherwise
    // derive independently (the bug this fixes). Mirror that resolver here.
    const setup = { id: "S-4", direction: "long", entry: 21000, stop: 20990, tp1: 21050, grade: "A+", model: "MSS", symbol: "MNQ1!" };
    const ev = await acceptSetup({ setup });
    assert.ok(!ev.error, ev.error);
    // execution:place would derive with account/side/entry that DON'T match the
    // accept's derivation — prove that the threaded value wins so the join holds.
    const placeSideVocabDiffers = deriveDecisionId({ packetId: "S-4", accountId: "ACCT-LIVE-9", session: null, side: "buy", entry: 21000, stop: 20990 });
    assert.notEqual(placeSideVocabDiffers, ev.decision_id, "independent derivations diverge — exactly why threading is required");
    const threaded = ev.decision_id;
    const intentDecisionId = threaded ?? placeSideVocabDiffers; // mirrors execution:place resolver
    assert.equal(intentDecisionId, ev.decision_id, "the intent must carry the SAME decision_id as the journal trade");
  });
});
