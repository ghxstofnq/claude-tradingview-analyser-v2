// tests/order-context.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseBundle, scanMatchesSymbol } from "../app/main/execution/order-context.js";

function bundle() {
  return {
    chart: { symbol: "MNQ1!" },
    quote: { last: 21000 },
    gates: { engine: {
      pillar3: { swings: { swing: [{ price: 20940, is_high: false, swept: false }], internal: [] } },
      pillar2: { current_tf: { leg_high: 21090, leg_low: 20970 } },
      pillar1: {
        session_levels: { NYAM_L: { name: "NYAM.L", price: 20900, swept: false } },
        untaken_buy_side_above: [{ name: "NYAM.H", price: 21120 }],
        untaken_sell_side_below: [{ name: "NYAM.L", price: 20900 }],
        untaken_pools_above: [], untaken_pools_below: [],
      },
    } },
  };
}

describe("order-context.parseBundle", () => {
  it("extracts symbol, price, candidates, draws", () => {
    const ctx = parseBundle(bundle(), "test");
    assert.equal(ctx.symbol, "MNQ1!");
    assert.equal(ctx.price, 21000);
    assert.ok(ctx.candidates.length >= 3);
    assert.deepEqual(ctx.draws.above.map((x) => x.price), [21120]);
    assert.equal(ctx.stale, false);
    assert.equal(ctx.source, "test");
  });
  it("missing engine → stale", () => {
    const ctx = parseBundle({ chart: { symbol: "MNQ1!" }, quote: { last: 21000 } }, "test");
    assert.equal(ctx.stale, true);
    assert.deepEqual(ctx.candidates, []);
  });
});

describe("order-context.scanMatchesSymbol", () => {
  it("matches across exchange prefix + bare forms", () => {
    assert.equal(scanMatchesSymbol("CME_MINI:MES1!", "MES1!"), true);
    assert.equal(scanMatchesSymbol("CME_MINI:MES1!", "CME_MINI:MES1!"), true);
    assert.equal(scanMatchesSymbol("MES1!", "MES1!"), true);
  });
  it("rejects a different symbol (the MNQ-vs-MES bug)", () => {
    assert.equal(scanMatchesSymbol("CME_MINI:MNQ1!", "MES1!"), false);
    assert.equal(scanMatchesSymbol("CME_MINI:MES1!", "MNQ1!"), false);
  });
  it("no requested symbol → any scan matches", () => {
    assert.equal(scanMatchesSymbol("CME_MINI:MNQ1!", null), true);
    assert.equal(scanMatchesSymbol("CME_MINI:MNQ1!", ""), true);
  });
});
