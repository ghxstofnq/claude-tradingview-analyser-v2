// app/main/execution/account-gate.js
// Pure account-routing gate. The engine follows the ACTIVE TradingView account
// but only routes to the CONFIRMED one; any switch needs a deliberate confirm
// (live = serious). Live auto-fire is additionally paused on boot until resumed.

// Decide whether to route, or surface a confirm, given the active vs confirmed account.
export function resolveAccountGate({ active, confirmed } = {}) {
  if (!active) return { route: false, needsConfirm: false, level: null, reason: "no_active_account" };
  if (confirmed && active.id === confirmed.id) return { route: true, needsConfirm: false, level: null, reason: null };
  return { route: false, needsConfirm: true, level: active.type === "live" ? "live" : "paper", reason: "account_switch" };
}

// The AUTO path is allowed only for a confirmed account, and for LIVE only once
// the per-session resume tap has cleared the boot pause. Manual entries do NOT
// call this — they're gated by resolveAccountGate alone.
export function autoFireAllowed({ confirmed, autoResumed } = {}) {
  if (!confirmed) return false;
  if (confirmed.type === "live") return autoResumed === true;
  return true;
}

// Resolve the broker target (host + account id) for the confirmed account.
// Returns null for live until liveHost is configured (the discovery spike) —
// making accidental live routing impossible before then.
export function targetFor(confirmed, config = {}) {
  if (!confirmed) return null;
  if (confirmed.type === "paper") return { host: config.paperHost, accountId: confirmed.id };
  if (confirmed.type === "live") return config.liveHost ? { host: config.liveHost, accountId: confirmed.id } : null;
  return null;
}

// Shape the active account from live inputs. Pure.
// - A live Tradovate broker (sniffed from the webview's REST traffic) takes
//   precedence — it's a separate broker with its own account id + host, typed
//   "live" so switching to it rides the deliberate confirm-on-switch arming.
// - Otherwise the TV paper account: type is "live" only once a liveHost is
//   configured AND the feed marks the account live; otherwise "paper".
export function deriveActiveAccount({ feed = {}, config = {} } = {}) {
  if (feed.activeBroker === "tradovate" && feed.tradovate?.accountId) {
    return {
      id: String(feed.tradovate.accountId), type: "live",
      name: feed.tradovate.name ?? "Tradovate (demo)",
      broker: "tradovate", host: feed.tradovate.host ?? null,
    };
  }
  const id = feed.accountId ?? config.paperAccountId ?? null;
  if (id == null) return null;
  const type = config.liveHost && feed.accountType === "live" ? "live" : "paper";
  return { id: String(id), type, name: feed.accountName ?? null, broker: "paper" };
}
