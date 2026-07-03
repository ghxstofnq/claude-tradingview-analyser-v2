// app/main/execution/account-gate.js
// Pure account-routing gate. The engine follows the ACTIVE TradingView account
// but only routes to the CONFIRMED one; any switch needs a deliberate confirm
// (live = serious). Live auto-fire is additionally paused on boot until resumed.

// Decide whether to route, or surface a confirm, given the active vs confirmed account.
export function resolveAccountGate({ active, confirmed } = {}) {
  if (!active) return { route: false, needsConfirm: false, level: null, reason: "no_active_account" };
  // Match on id AND type — the same account id can be re-typed paper→live once a
  // liveHost is configured; id-only matching would route to live with no confirm.
  // Also match on broker — two different brokers can share a numeric account id
  // + type; id+type-only routed a Tradovate order to a "confirmed" paper account
  // (or vice versa) with no re-confirm (audit review). Undefined brokers on both
  // sides still match (legacy back-compat); a mismatch forces re-confirm.
  if (confirmed && active.id === confirmed.id && active.type === confirmed.type && (active.broker ?? null) === (confirmed.broker ?? null)) return { route: true, needsConfirm: false, level: null, reason: null };
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

// Build the paper account to confirm on a revert-to-sim. Reuse the live active
// account ONLY when it's already paper (so resolveAccountGate routes at once);
// otherwise synthesize a paper target from config. NEVER returns live/tradovate —
// so realAccountView reports paper (it falls back to active when confirmed is
// null, which is why revert must set a paper confirmed account, not null).
export function paperConfirmTarget({ active, config = {} } = {}) {
  if (active && active.type === "paper") return active;
  const id = config.paperAccountId != null ? String(config.paperAccountId) : null;
  return { id, type: "paper", name: "Paper Trading", broker: "paper", host: config.paperHost ?? null };
}

// Pure revert-to-sim decision. Revert is a ROUTING change, not a flatten — so if
// a live position is open, re-routing to sim would strand it (flatten would then
// target paper). Fail-closed: block unless forced; `positionOpen === null` means
// the read failed → block too. Returns { block, reason } or { writePatch,
// clearAutoResumed, warned }. Caller resolves positionOpen from real sources.
export function revertSimDecision({ active, confirmed, config = {}, positionOpen, force = false } = {}) {
  const revertingFromLive = confirmed?.type === "live" || active?.broker === "tradovate";
  if (revertingFromLive && !force) {
    if (positionOpen == null) return { block: true, reason: "position_read_failed" };
    if (positionOpen) return { block: true, reason: "live_position_open" };
  }
  return {
    block: false,
    writePatch: { confirmedAccount: paperConfirmTarget({ active, config }) },
    clearAutoResumed: true,
    warned: (revertingFromLive && force) ? "live_position_open_stranded" : null,
  };
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
