// tests/execution-fills.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFill, readFills, dayRealizedLossUsd, readAllFills, fillsByAccount } from "../app/main/execution/fills.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fills-")); });

describe("fills", () => {
  it("appends then reads a record round-trip for a date", () => {
    const rec = { account: "paper", symbol: "MNQ1!", side: "long", actual: { r: 1.6, usd: 320 } };
    appendFill(dir, "2026-06-15", rec);
    const back = readFills(dir, "2026-06-15");
    assert.equal(back.length, 1);
    assert.equal(back[0].symbol, "MNQ1!");
    assert.ok(back[0].ts, "appendFill stamps ts");
  });
  it("returns [] for a date with no file", () => {
    assert.deepEqual(readFills(dir, "2026-01-01"), []);
  });
  it("sums realized losses (positive $ number) for the daily halt", () => {
    appendFill(dir, "2026-06-15", { actual: { usd: -200 } });
    appendFill(dir, "2026-06-15", { actual: { usd: 120 } });
    appendFill(dir, "2026-06-15", { actual: { usd: -150 } });
    assert.equal(dayRealizedLossUsd(readFills(dir, "2026-06-15")), 350);
  });
  it("readAllFills concatenates every date file oldest-first", () => {
    appendFill(dir, "2026-06-12", { ts: "2026-06-12T10:00:00Z", actual: { r: 1 } });
    appendFill(dir, "2026-06-15", { ts: "2026-06-15T10:00:00Z", actual: { r: -1 } });
    const all = readAllFills(dir);
    assert.equal(all.length, 2);
    assert.equal(all[0].ts, "2026-06-12T10:00:00Z");
    assert.equal(all[1].ts, "2026-06-15T10:00:00Z");
  });
  it("readAllFills returns [] for a missing dir", () => {
    assert.deepEqual(readAllFills(join(dir, "nope")), []);
  });
  it("scopes the daily loss to one account so accounts don't cross-charge", () => {
    appendFill(dir, "2026-06-17", { account: "tradovate", actual: { usd: -2549 } });
    appendFill(dir, "2026-06-17", { account: "paper", actual: { usd: -100 } });
    const all = readFills(dir, "2026-06-17");
    assert.equal(dayRealizedLossUsd(all), 2649);              // all accounts (back-compat)
    assert.equal(dayRealizedLossUsd(all, "paper"), 100);      // paper not charged tradovate's loss
    assert.equal(dayRealizedLossUsd(all, "tradovate"), 2549);
  });
  it("scopes by account id so two DIFFERENT tradovate accounts don't cross-charge", () => {
    // Both fills carry broker label "tradovate" but different account ids — the
    // exact bug: lose on one tradovate account, switch to another, get halted.
    appendFill(dir, "2026-06-19", { account: "tradovate", accountId: "D50756821", actual: { usd: -800 } });
    appendFill(dir, "2026-06-19", { account: "tradovate", accountId: "D99999999", actual: { usd: -300 } });
    const all = readFills(dir, "2026-06-19");
    assert.equal(dayRealizedLossUsd(all, "D50756821"), 800);  // only this account's loss
    assert.equal(dayRealizedLossUsd(all, "D99999999"), 300);  // the fresh account starts clean-ish
    assert.equal(dayRealizedLossUsd(all), 1100);              // null = all accounts
  });
  it("falls back to the broker label for fills written before per-account ids", () => {
    appendFill(dir, "2026-06-19", { account: "tradovate", actual: { usd: -500 } }); // no accountId
    const all = readFills(dir, "2026-06-19");
    assert.equal(dayRealizedLossUsd(all, "tradovate"), 500);
  });
  it("C14: an { id, broker } scope counts a same-broker fill that has no accountId", () => {
    // The fill was written before the account id was learned (accountId absent)
    // — it must NOT be silently excluded from the id-scoped halt, or the halt
    // under-counts and trades past the limit.
    appendFill(dir, "2026-06-20", { account: "tradovate", accountId: "D50756821", actual: { usd: -300 } });
    appendFill(dir, "2026-06-20", { account: "tradovate", actual: { usd: -200 } }); // no accountId yet
    const all = readFills(dir, "2026-06-20");
    // Before the fix (id-only string scope) this returned 300, hiding the -200.
    assert.equal(dayRealizedLossUsd(all, { id: "D50756821", broker: "tradovate" }), 500);
  });
  it("C14: the { id, broker } scope does NOT bleed a null-id fill across brokers", () => {
    appendFill(dir, "2026-06-20", { account: "paper", accountId: "P1", actual: { usd: -100 } });
    appendFill(dir, "2026-06-20", { account: "tradovate", actual: { usd: -900 } }); // null id, different broker
    const all = readFills(dir, "2026-06-20");
    assert.equal(dayRealizedLossUsd(all, { id: "P1", broker: "paper" }), 100, "tradovate's null-id loss must not hit the paper halt");
  });
  it("C14: a different same-broker account's identified fill is still excluded", () => {
    appendFill(dir, "2026-06-20", { account: "tradovate", accountId: "A", actual: { usd: -100 } });
    appendFill(dir, "2026-06-20", { account: "tradovate", accountId: "B", actual: { usd: -900 } });
    const all = readFills(dir, "2026-06-20");
    assert.equal(dayRealizedLossUsd(all, { id: "A", broker: "tradovate" }), 100);
  });

  it("fillsByAccount groups by label; unlabelled bucket under 'unknown'", () => {
    const g = fillsByAccount([
      { account: "paper", actual: { usd: 1 } },
      { account: "tradovate", actual: { usd: 2 } },
      { actual: { usd: 3 } },
    ]);
    assert.equal(g.paper.length, 1);
    assert.equal(g.tradovate.length, 1);
    assert.equal(g.unknown.length, 1);
  });
});

process.on("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
