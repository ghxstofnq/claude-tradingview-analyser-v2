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
