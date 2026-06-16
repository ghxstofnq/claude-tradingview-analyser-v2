// app/main/live-h1-capture.js
// Capture the leader's raw 1H bars for LIVE session-draw history — the same
// data the backtest pulls under replay (backtest-deps.runDirectBrief). Without
// this, the live brief has no h1_history, so the session-draw feature is inert
// in live trading. Drives TV Desktop (CDP 9225) through the wedge-safe chart
// gate (packages/core/chart waitForChartReady). Best-effort: returns null on
// any failure so the brief simply gets no session draws — it never throws.
import * as chart from "../../packages/core/chart.js";
import * as data from "../../packages/core/data.js";
import { PAIR_PRIMARY } from "./config.js";

export async function captureLeaderH1({ leader = PAIR_PRIMARY, count = 500 } = {}) {
  try {
    await chart.setSymbol({ symbol: leader });
    await chart.setTimeframe({ timeframe: "60" });
    const h1 = await data.getOhlcv({ count });
    const bars = Array.isArray(h1?.bars) ? h1.bars : null;
    await chart.setTimeframe({ timeframe: "1" });   // restore LTF for the live loop
    return bars && bars.length ? bars : null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[live-h1] 1H capture failed:", e.message);
    try { await chart.setTimeframe({ timeframe: "1" }); } catch { /* best-effort restore */ }
    return null;
  }
}
