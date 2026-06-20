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

// 5m-structure campaign (2026-06-20). STRUCTURE_TF drives the open-reaction
// structure read (and the trade-inert walker overlay). SHIPPED DEFAULT '5':
// reading the open-reaction structure on 5m folded +6.48R (124.56 vs 118.08),
// one fewer -3R day, same win-days, never worse on the corpus; matches the
// strategy doc (structure is 5m). LIVE parity: the live hunt captures a fresh
// 5m engine on each 5m close (bar-close.js refreshFreshM5 → engine_by_tf.m5),
// so what the backtest folds, live trades. Opt out to 1m: GOFNQ_STRUCTURE_TF=1.
// STOP_TF / REALIGN_TF stay '1' (5m there folded WORSE).
export function structureTf() {
  return process.env.GOFNQ_STRUCTURE_TF === "1" ? "1" : "5";
}
export function stopTf() {
  return process.env.GOFNQ_STOP_TF === "5" ? "5" : "1";
}

// Independent control for ONLY the mid-session realignment (the bias flip on a
// post-window swing-MSS — the "don't flip on a 1m false break" lever). Lets the
// fold isolate the realignment from the open-reaction read (which follows
// STRUCTURE_TF). Default '1'.
export function realignTf() {
  return process.env.GOFNQ_REALIGN_TF === "5" ? "5" : "1";
}
