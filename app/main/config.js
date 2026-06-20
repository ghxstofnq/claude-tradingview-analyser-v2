// App-wide configuration constants.
//
// Single source of truth for the dual-symbol pair. The bar-close handler,
// the session-brief runner, and the baseline refresher all read from here
// so the pair is consistent end-to-end.
//
// Future: move to env var or config file if pairs ever need to vary by
// session or user. For v1 the user trades MNQ + MES; hardcoded is fine.

export const PAIR_PRIMARY = "MNQ1!";
export const PAIR_SECONDARY = "MES1!";
export const PAIR_DEFAULT = `${PAIR_PRIMARY},${PAIR_SECONDARY}`;

// Per-symbol baseline filename helper.
// baseline-MNQ1!.json / baseline-MES1!.json
export function baselinePathFor(symbol) {
  return `state/baseline-${symbol}.json`;
}

// 5m-structure campaign (2026-06-20). When STRUCTURE_TF='5' the walker reads
// market STRUCTURE (swings / MSS+BoS / failure-swings) from the 5m engine; the
// 1m stays the entry trigger (FVGs / sweeps / confirmation / entry). STOP_TF
// independently selects the stop-anchor timeframe. Default '1' = today's
// behavior (byte-identical). Read at call time so the fold harness can flip
// each variant via env (GOFNQ_STRUCTURE_TF / GOFNQ_STOP_TF).
export function structureTf() {
  return process.env.GOFNQ_STRUCTURE_TF === "5" ? "5" : "1";
}
export function stopTf() {
  return process.env.GOFNQ_STOP_TF === "5" ? "5" : "1";
}
