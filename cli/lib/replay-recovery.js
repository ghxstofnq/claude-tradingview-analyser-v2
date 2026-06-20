/**
 * replay-recovery.js — start every replay SESSION from a freshly-reloaded chart.
 *
 * Mirrors app/main/backtest-deps.js#{reloadChartAndWait,pinChart,freshChartForReplay}
 * (the backtest's proven recipe). Reusing a chart that already ran one
 * replay+stop wedges the SECOND replay.start into the "This symbol doesn't
 * exist" data-session error — and ONLY a page reload (not the replay API)
 * clears it. The tape recorder's two-pass capture (1m then 5m) is two sessions,
 * so it must reload before each. pinChart is TF-parameterized here because the
 * 5m pass pins to '5'; the backtest only ever pins '1'.
 */

import * as chart from '@tvmcp/core/chart';
import { getClient, evaluate } from '@tvmcp/core/connection';

const SETTLE_MS = 600;
const bare = (s) => String(s ?? '').replace(/^[A-Z_]+:/, '');

// Reload the TradingView page via RAW CDP Page.reload (not evaluate) — when the
// chart is wedged on "symbol doesn't exist", evaluate() hangs, but the raw CDP
// command still fires. Then poll document.readyState until the new context is
// up. (Recipe from scripts/run-week-proof.mjs; the quote feed ticks even when
// the pane is dead, so readyState is the reliable signal, not getQuote.)
export async function reloadChartAndWait({ timeoutMs = 90_000 } = {}) {
  try {
    const c = await getClient();
    await c.Page.reload({ ignoreCache: false });
  } catch { /* the reload tears down the eval context — expected */ }
  const deadline = Date.now() + timeoutMs;
  await new Promise((r) => setTimeout(r, 3_000));
  while (Date.now() < deadline) {
    try {
      const ok = await evaluate("typeof window !== 'undefined' && document.readyState === 'complete'");
      if (ok) { await new Promise((r) => setTimeout(r, 3_000)); return; }
    } catch { /* context still tearing down */ }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('chart did not recover after reload');
}

// Pin symbol + timeframe and VERIFY (setSymbol/setTimeframe are fire-and-forget
// against a chart that may still be loading — poll until state reflects it).
export async function pinChart({ leader, timeframe = '1', deadlineMs = 30_000 } = {}) {
  if (!leader) return;
  const deadline = Date.now() + deadlineMs;
  let requested = false;
  for (;;) {
    let state = null;
    try { state = await chart.getState(); } catch { /* still loading */ }
    if (state) {
      const symbolOk = bare(state.symbol) === bare(leader);
      const tfOk = state.resolution === timeframe;
      if (symbolOk && tfOk) return;
      if (!requested) {
        if (!symbolOk) await chart.setSymbol({ symbol: leader });
        if (!tfOk) await chart.setTimeframe({ timeframe });
        requested = true;
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`pinChart: chart did not settle on ${leader}@${timeframe} within ${deadlineMs}ms`);
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  }
}

export async function freshChartForReplay({ leader, timeframe = '1' } = {}) {
  await reloadChartAndWait();
  await pinChart({ leader, timeframe });
}
