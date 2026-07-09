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
  it("SELL auto stop skips a swing-low above entry, picks the swing high", () => {
    const cands = [
      { kind: "swing_low", price: 21010, name: "swing low" },   // above entry but a LOW — not a short stop
      { kind: "swing_high", price: 21080, name: "swing high" },
    ];
    const s = pickAutoStop({ side: "sell", entry: 21000, candidates: cands, symbol: "MNQ1!" });
    assert.equal(s.kind, "swing_high");
    assert.equal(s.levelPrice, 21080);
    const opts = stopSideOptions({ side: "sell", entry: 21000, candidates: cands, symbol: "MNQ1!" });
    assert.deepEqual(opts.map((o) => o.kind), ["swing_high"]);
  });
  it("BUY auto stop skips a swing-high below entry, picks the swing low", () => {
    const cands = [
      { kind: "swing_high", price: 20990, name: "swing high" }, // below entry but a HIGH — not a long stop
      { kind: "swing_low", price: 20940, name: "swing low" },
    ];
    const s = pickAutoStop({ side: "buy", entry: 21000, candidates: cands, symbol: "MNQ1!" });
    assert.equal(s.kind, "swing_low");
    assert.equal(s.levelPrice, 20940);
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
  it("block no_size when even 1 contract busts tolerance (huge stop, no cap)", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: 20500, typedTp: null, riskUsd: 120 });
    assert.equal(p.block, "no_size");
  });
  it("with a cap: rounds an off-target stop DOWN and places (no block)", () => {
    // 60pt stop, $300 target ($120/c) → 2c @ $240, under the $400 cap.
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: 20940, typedTp: null, riskUsd: 300, maxRiskUsd: 400 });
    assert.equal(p.block, null);
    assert.equal(p.contracts, 2);
    assert.equal(p.actualRiskUsd, 240);
  });
  it("with a cap: blocks over_max when 1 contract busts the cap (huge stop)", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), draws: d(), typedStop: 20500, typedTp: null, riskUsd: 300, maxRiskUsd: 400 });
    assert.equal(p.block, "over_max");
  });
});

// ── FVG candle stops + 1:2 default TP (manual BUY/SELL ticket, 2026-07-10) ──
import { fvgStopCandidates, nearestEntryFvg } from "../app/main/execution/manual-order.js";

// Bull FVG 20980–20990 (c1 low 20975, c2 low 20984); a farther bull FVG below;
// a bear FVG above (20040–21050); a dead (filled) zone; a pre-V5 zone with NaN candles.
function fvgBundle() {
  const b = bundle();
  b.gates.engine.pillar3.fvgs = [
    { dir: "bull", state: "fresh",  top: 20990, bottom: 20980, c1l: 20975, c1h: 20990, c2l: 20984, c2h: 20998 },
    { dir: "bull", state: "tapped", top: 20960, bottom: 20950, c1l: 20945, c1h: 20960, c2l: 20953, c2h: 20968 },
    { dir: "bear", state: "fresh",  top: 21050, bottom: 21040, c1l: 21040, c1h: 21055, c2l: 21030, c2h: 21046 },
    { dir: "bull", state: "filled", top: 20998, bottom: 20994, c1l: 20991, c1h: 20998, c2l: 20995, c2h: 21004 },
    { dir: "bull", state: "fresh",  top: 20972, bottom: 20966, c1l: NaN, c1h: NaN, c2l: NaN, c2h: NaN },
  ];
  return b;
}

describe("fvgStopCandidates", () => {
  it("bull zones anchor candle LOWS, bear zones candle HIGHS, dead + NaN dropped", () => {
    const z = fvgStopCandidates(fvgBundle());
    assert.equal(z.length, 3); // filled + NaN-candles dropped
    const bull = z[0];
    assert.equal(bull.forSide, "buy");
    assert.deepEqual(bull.anchors.map((a) => [a.kind, a.price]), [["fvg_c1", 20975], ["fvg_c2", 20984]]);
    assert.match(bull.anchors[0].name, /^1\/3 FVG 20980–20990$/);
    const bear = z.find((x) => x.forSide === "sell");
    assert.deepEqual(bear.anchors.map((a) => [a.kind, a.price]), [["fvg_c1", 21055], ["fvg_c2", 21046]]);
  });
});

describe("nearestEntryFvg", () => {
  const fvgs = () => fvgStopCandidates(fvgBundle());
  it("BUY picks the nearest bull zone at/below entry", () => {
    assert.equal(nearestEntryFvg({ side: "buy", entry: 21000, fvgs: fvgs() }).bottom, 20980);
  });
  it("in-zone entry counts as distance zero", () => {
    assert.equal(nearestEntryFvg({ side: "buy", entry: 20985, fvgs: fvgs() }).bottom, 20980);
  });
  it("SELL picks the nearest bear zone at/above entry; none → null", () => {
    assert.equal(nearestEntryFvg({ side: "sell", entry: 21000, fvgs: fvgs() }).top, 21050);
    assert.equal(nearestEntryFvg({ side: "sell", entry: 21060, fvgs: fvgs() }), null);
  });
});

describe("FVG-first stop options + 1:2 TP default", () => {
  const c = () => structuralStopCandidates(fvgBundle());
  const f = () => fvgStopCandidates(fvgBundle());

  it("BUY options lead with the nearest FVG's 1/3 then 2/3, both 2-tick buffered", () => {
    const opts = stopSideOptions({ side: "buy", entry: 21000, candidates: c(), fvgs: f(), symbol: "MNQ1!" });
    assert.deepEqual(opts.slice(0, 2).map((o) => [o.kind, o.levelPrice, o.stopPrice]),
      [["fvg_c1", 20975, 20974.5], ["fvg_c2", 20984, 20983.5]]);
    assert.equal(opts[2].kind, "leg_low"); // structural list follows, nearest-first
  });

  it("an anchor on the wrong side of entry is dropped, not offered", () => {
    // entry deep in-zone at 20983: c2 low 20984 sits ABOVE entry → only c1 offered
    const opts = stopSideOptions({ side: "buy", entry: 20983, candidates: c(), fvgs: f(), symbol: "MNQ1!" });
    assert.equal(opts[0].kind, "fvg_c1");
    assert.equal(opts.some((o) => o.kind === "fvg_c2"), false);
  });

  it("preview defaults: stop = 1/3 FVG, TP = 1:2 from the working stop", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), fvgs: f(),
      draws: untakenDraws(fvgBundle()), riskUsd: 120 });
    assert.equal(p.stopSource, "fvg_c1");
    assert.equal(p.stop, 20974.5);
    assert.equal(p.tpSource, "rr_default");
    assert.equal(p.tp, 21051); // 21000 + 2 × 25.5
    assert.equal(p.rr, 2);
  });

  it("typed TP overrides the default; clearing restores it", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: c(), fvgs: f(),
      draws: untakenDraws(fvgBundle()), typedTp: "21120", riskUsd: 120 });
    assert.equal(p.tpSource, "typed");
    assert.equal(p.tp, 21120);
    assert.equal(p.tpDefault, 21051); // still exposed for the placeholder
  });

  it("no live FVG → structural default, TP still 1:2; no fvgs field (stale ctx) is safe", () => {
    const p = buildOrderPreview({ side: "buy", entry: 21000, symbol: "MNQ1!", candidates: structuralStopCandidates(bundle()),
      draws: untakenDraws(bundle()), riskUsd: 120 });
    assert.equal(p.stopSource, "leg_low");
    assert.equal(p.tpSource, "rr_default");
    assert.equal(p.tp, 21061); // 21000 + 2 × 30.5
  });

  it("SELL mirror: 1/3 FVG above entry, TP below", () => {
    const p = buildOrderPreview({ side: "sell", entry: 21000, symbol: "MNQ1!", candidates: c(), fvgs: f(),
      draws: untakenDraws(fvgBundle()), riskUsd: 120 });
    assert.equal(p.stopSource, "fvg_c1");
    assert.equal(p.stop, 21055.5); // c1h 21055 + 2 ticks
    assert.equal(p.tp, 20889); // 21000 - 2 × 55.5
  });
});
