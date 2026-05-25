// Chart-state enforcement helper.
//
// ensureChartState({ symbol, timeframe }) reads the chart's current state via
// CDP, compares against the requested symbol/TF, and switches whichever doesn't
// match. Used by the bar-close handler to pin the chart to the leader symbol
// + correct TF (1m for 1m ticks, 5m for 5m close turns) before Claude analyzes.
//
// Direct-imports @tvmcp/core/chart so the call stays in-process (no spawn
// overhead per tick) — same pattern as cli/lib/* imports elsewhere in main.

import * as chart from "@tvmcp/core/chart";

const SETTLE_MS = 600;

export async function ensureChartState({ symbol, timeframe } = {}) {
  const state = await chart.getState();
  // chart.getState() returns the fully-qualified symbol (e.g. CME_MINI:MNQ1!);
  // callers pass the bare shorthand (MNQ1!), so strip the prefix before
  // comparing.
  const bare = state.symbol.replace(/^[A-Z_]+:/, "");
  const needsSymbol = symbol && bare !== symbol;
  const needsTf = timeframe && state.resolution !== timeframe;
  if (needsSymbol) await chart.setSymbol({ symbol });
  if (needsTf) await chart.setTimeframe({ timeframe });
  if (needsSymbol || needsTf) await new Promise((r) => setTimeout(r, SETTLE_MS));
  return { changed: needsSymbol || needsTf, symbol: state.symbol, resolution: state.resolution };
}
