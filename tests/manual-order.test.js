// tests/manual-order.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  structuralStopCandidates, untakenDraws, stopSideOptions,
  pickAutoStop, tpDrawsForSide, rr, buildOrderPreview,
} from "../app/main/execution/manual-order.js";

// Minimal bundle: price 21000. Structure: swing low 20940, swing high 21080,
// leg low 20970, leg high 21090, session NYAM.L 20900 / NYAM.H 21120.
// Untaken draws: above [NYAM.H 21120, EQH 21150], below [NYAM.L 20900, EQL 20850].
function bundle() {
  return {
    chart: { symbol: "MNQ1!" },
    quote: { last: 21000 },
    gates: { engine: {
      pillar3: { swings: {
        swing: [{ price: 20940, is_high: false, swept: false }, { price: 21080, is_high: true, swept: false }],
        internal: [],
      } },
      pillar2: { current_tf: { leg_high: 21090, leg_low: 20970 } },
      pillar1: {
        session_levels: {
          NYAM_L: { name: "NYAM.L", price: 20900, swept: false },
          NYAM_H: { name: "NYAM.H", price: 21120, swept: false },
        },
        untaken_buy_side_above: [{ name: "NYAM.H", price: 21120 }],
        untaken_pools_above: [{ kind: "eqh", price: 21150 }],
        untaken_sell_side_below: [{ name: "NYAM.L", price: 20900 }],
        untaken_pools_below: [{ kind: "eql", price: 20850 }],
      },
    } },
  };
}

describe("manual-order gathering", () => {
  it("structuralStopCandidates pulls swings + session levels + leg extremes", () => {
    const c = structuralStopCandidates(bundle());
    const prices = c.map((x) => x.price).sort((a, b) => a - b);
    assert.deepEqual(prices, [20900, 20940, 20970, 21080, 21090, 21120]);
  });
  it("untakenDraws splits + sorts (above asc, below desc), deduped", () => {
    const d = untakenDraws(bundle());
    assert.deepEqual(d.above.map((x) => x.price), [21120, 21150]);
    assert.deepEqual(d.below.map((x) => x.price), [20900, 20850]);
  });
  it("empty/garbage bundle → empty", () => {
    assert.deepEqual(structuralStopCandidates({}), []);
    assert.deepEqual(untakenDraws({}), { above: [], below: [] });
  });
});

describe("manual-order decisions", () => {
  const c = () => structuralStopCandidates(bundle());

  it("auto stop BUY = nearest level below entry minus 2-tick buffer", () => {
    // nearest below 21000 is leg_low 20970 → 20970 - 0.5 = 20969.5
    const s = pickAutoStop({ side: "buy", entry: 21000, candidates: c(), symbol: "MNQ1!" });
    assert.equal(s.price, 20969.5);
    assert.equal(s.levelPrice, 20970);
  });
  it("auto stop SELL = nearest level above entry plus 2-tick buffer", () => {
    // nearest above 21000 is swing_high 21080 → 21080 + 0.5 = 21080.5
    const s = pickAutoStop({ side: "sell", entry: 21000, candidates: c(), symbol: "MNQ1!" });
    assert.equal(s.price, 21080.5);
    assert.equal(s.levelPrice, 21080);
  });
  it("no candidate on the stop side → null", () => {
    const only = [{ kind: "swing_high", price: 21080, ref: "x" }];
    assert.equal(pickAutoStop({ side: "buy", entry: 21000, candidates: [], symbol: "MNQ1!" }), null);
    assert.equal(pickAutoStop({ side: "sell", entry: 21200, candidates: only, symbol: "MNQ1!" }), null);
  });
  it("stopSideOptions are side-filtered + nearest-first + buffered", () => {
    const opts = stopSideOptions({ side: "buy", entry: 21000, candidates: c(), symbol: "MNQ1!" });
    assert.deepEqual(opts.map((o) => o.levelPrice), [20970, 20940, 20900]);
    assert.equal(opts[0].stopPrice, 20969.5);
  });
  it("tpDrawsForSide BUY = above-entry only", () => {
    const d = untakenDraws(bundle());
    const tps = tpDrawsForSide({ side: "buy", entry: 21000, draws: d });
    assert.deepEqual(tps.map((x) => x.price), [21120, 21150]);
  });
  it("rr computes reward:risk to 1dp", () => {
    assert.equal(rr({ side: "buy", entry: 21000, stop: 20970, tp: 21120 }), 4);
    assert.equal(rr({ side: "buy", entry: 21000, stop: 20970, tp: null }), null);
  });
});

describe("buildOrderPreview", () => {
  const c = () => structuralStopCandidates(bundle());
  const d = () => untakenDraws(bundle());

  it("clean BUY: auto stop, sized, R:R when TP typed", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: null, typedTp: 21120, riskUsd: 120 });
    assert.equal(p.block, null);
    assert.equal(p.stop, 20969.5);
    assert.equal(p.stopSource, "leg_low");
    assert.ok(p.contracts >= 1);
    assert.equal(p.tp, 21120);
    assert.ok(p.rr > 0);
    assert.ok(p.tpDraws.length >= 1 && p.tpDraws[0].rr != null);
  });
  it("typed stop overrides auto", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: 20950, typedTp: null, riskUsd: 120 });
    assert.equal(p.stop, 20950);
    assert.equal(p.stopSource, "typed");
  });
  it("block no_stop when nothing beyond entry and none typed", () => {
    const p = buildOrderPreview({ side: "buy", entry: 19000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: null, typedTp: null, riskUsd: 120 });
    assert.equal(p.block, "no_stop");
  });
  it("block stop_wrong_side when typed stop is above entry on a long", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: 21050, typedTp: null, riskUsd: 120 });
    assert.equal(p.block, "stop_wrong_side");
  });
  it("block no_size when even 1 contract busts tolerance (huge stop)", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: 20500, typedTp: null, riskUsd: 120 });
    assert.equal(p.block, "no_size");
  });
});
