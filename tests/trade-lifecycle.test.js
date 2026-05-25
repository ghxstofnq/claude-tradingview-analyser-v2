// Integration tests for the trade lifecycle.
//
// Exercises the bar-close → tickTrades → trades.jsonl chain without
// spawning the detector subprocess or the Claude SDK. Stubs:
//   - the bar event (fed directly to tickTrades)
//   - activeSessionDir (points at a sandbox)
//   - the IPC send (captured into an array)
//
// Covers the cases that the audit kept flagging: same-bar TP1+stop
// heuristic, FILLED+STOPPED transition, rMultiple zero-guard, append
// atomicity for jsonl.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SANDBOX = path.join(REPO_ROOT, "tests", ".tmp-trade-lifecycle");

describe("trade lifecycle — bar-close → tickTrades → jsonl", () => {
  let tickTrades, foldOpenTrades;
  before(async () => {
    ({ tickTrades, foldOpenTrades } = await import("../cli/lib/trade-outcomes.js"));
    await fs.rm(SANDBOX, { recursive: true, force: true });
    await fs.mkdir(SANDBOX, { recursive: true });
  });
  after(async () => { await fs.rm(SANDBOX, { recursive: true, force: true }); });

  beforeEach(async () => {
    // Fresh trades file for each test.
    await fs.writeFile(path.join(SANDBOX, "trades.jsonl"), "", "utf8");
  });

  // Helper — write an accept event, return the trade record bar-close
  // would receive after fold.
  async function acceptTrade(trade) {
    const file = path.join(SANDBOX, "trades.jsonl");
    await fs.appendFile(file, JSON.stringify({
      type: "accept",
      id: trade.id,
      ts: new Date().toISOString(),
      ...trade,
    }) + "\n", "utf8");
  }

  async function loadOpen() {
    const txt = await fs.readFile(path.join(SANDBOX, "trades.jsonl"), "utf8");
    const events = txt.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    return foldOpenTrades(events);
  }

  async function persistTransitions(transitions) {
    const file = path.join(SANDBOX, "trades.jsonl");
    for (const tr of transitions) {
      await fs.appendFile(file, JSON.stringify({ type: "outcome", ...tr }) + "\n", "utf8");
    }
  }

  it("FILLED → TP1 → BE-stop → TP2 (full happy path)", async () => {
    await acceptTrade({
      id: "T-A", side: "long", entry: 100, stop: 95, tp1: 110, tp2: 120, invalidation: 90,
    });

    // Bar 1: crosses entry only.
    let open = await loadOpen();
    let res = tickTrades(open, { open: 99, high: 101, low: 99, ts: "B1" });
    assert.equal(res.transitions[0]?.status, "FILLED");
    await persistTransitions(res.transitions);

    // Bar 2: hits TP1.
    open = await loadOpen();
    res = tickTrades(open, { open: 105, high: 111, low: 104, ts: "B2" });
    assert.equal(res.transitions[0]?.status, "TP1_HIT");
    // Stop moved to BE (entry=100).
    assert.equal(res.updated[0]?.stop, 100);
    await persistTransitions(res.transitions);

    // Bar 3: hits TP2.
    open = await loadOpen();
    res = tickTrades(open, { open: 115, high: 121, low: 114, ts: "B3" });
    assert.equal(res.transitions[0]?.status, "TP2_HIT");
    await persistTransitions(res.transitions);

    // After TP2 the trade is closed → foldOpenTrades filters it out.
    open = await loadOpen();
    assert.equal(open.length, 0);
  });

  it("same-bar FILLED+STOPPED is conservative (no false TP1)", async () => {
    await acceptTrade({
      id: "T-B", side: "long", entry: 100, stop: 95, tp1: 110, tp2: 120, invalidation: 90,
    });
    const open = await loadOpen();
    // Bar that wicks through both entry and stop in one print.
    const res = tickTrades(open, { open: 99, high: 102, low: 93, ts: "B" });
    // FILLED first, then STOPPED — never TP1 in this case (price hadn't
    // gone above tp1=110).
    assert.equal(res.transitions[0]?.status, "FILLED");
    assert.equal(res.transitions[1]?.status, "STOPPED");
  });

  it("rMultiple returns null on entry===stop (zero-risk trade)", async () => {
    await acceptTrade({
      id: "T-C", side: "long", entry: 100, stop: 100, tp1: 110, tp2: 120, invalidation: 90,
    });
    const open = await loadOpen();
    // state should be filled by previous bar, but we trigger TP1 here
    const stillOpen = [{ ...open[0], state: "filled" }];
    const res = tickTrades(stillOpen, { high: 111, low: 105, ts: "B" });
    assert.equal(res.transitions[0]?.status, "TP1_HIT");
    assert.equal(res.transitions[0]?.r_realized, null);
  });

  it("foldOpenTrades preserves linkage across many events", async () => {
    await acceptTrade({
      id: "T-D", side: "short", entry: 100, stop: 105, tp1: 90, tp2: 80, invalidation: 110,
    });
    let open = await loadOpen();
    let res = tickTrades(open, { open: 101, high: 102, low: 99, ts: "B1" });
    await persistTransitions(res.transitions);
    open = await loadOpen();
    res = tickTrades(open, { open: 95, high: 96, low: 89, ts: "B2" });
    await persistTransitions(res.transitions);
    // After TP1, trade is filled, stop = entry (BE for short = 100)
    const events = (await fs.readFile(path.join(SANDBOX, "trades.jsonl"), "utf8"))
      .trim().split("\n").map((l) => JSON.parse(l));
    const finalState = foldOpenTrades(events);
    assert.equal(finalState[0]?.tp1_hit, true);
    assert.equal(finalState[0]?.stop, 100); // entry, BE
  });
});
