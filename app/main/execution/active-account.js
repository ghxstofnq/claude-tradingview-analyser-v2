// app/main/execution/active-account.js
// Runtime read of the active TradingView account → { id, type, name } | null.
// Pure shaping lives in account-gate.deriveActiveAccount; this just supplies the
// live inputs (trading-feed state + exec config). Proactive read of the active
// account + its paper/live type on connect/switch is confirmed by the deferred
// discovery spike; until liveHost is configured, type is always "paper".
import { getTradingState } from "./trading-feed.js";
import { readExecConfig } from "./config.js";
import { deriveActiveAccount } from "./account-gate.js";

export function getActiveAccount() {
  const feed = getTradingState();
  return deriveActiveAccount({
    feed: {
      accountId: feed.accountId, accountName: feed.accountName, accountType: feed.accountType,
      // Forward the broker fields so deriveActiveAccount can resolve a Tradovate
      // account (these were dropped here, so the Tradovate branch never fired).
      activeBroker: feed.activeBroker, tradovate: feed.tradovate,
    },
    config: readExecConfig(),
  });
}
