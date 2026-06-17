// app/main/health-check.js
// Mid-session live health-check: the moment the live chain blocks on a
// PLUMBING reason (a bug — the chain can't evaluate), push a loud system
// notification so a broken session is caught in minutes, not days. The June
// 2026 blackout (ltf-bias stand-aside reader) blocked every bar for two full
// sessions and nobody noticed because the only signal was a quiet REVIEW line.
//
// A plumbing block is one of the known "chain is broken / starved" signatures
// — NOT a normal market verdict. `no_confirmed_packet` (no setup confirmed) and
// `missing_ltf_bias` alone (a legit stand-aside / pre-window state) are market
// states and must stay silent, or the alert becomes noise nobody trusts.
import { notifySystem } from "./notify.js";

// Tokens that only appear when the chain is genuinely broken/starved — never on
// a healthy stand-aside or quiet day. Kept tight on purpose: false alarms here
// would re-create the "pill nobody watches" failure.
const PLUMBING_TOKENS = [
  "entry_model_priority", "grade_cap",          // the stand-aside reader bug (#106) — must never recur
  "ict_engine_rows", "source health",           // engine evidence missing (capture starved)
  "symbol_mismatch",                            // chart on the wrong instrument
  "missing_pair_decision",                      // no leader resolved
  "missing_primary_draw", "missing_htf_draw",   // brief/context never loaded (#80 placeholder symptom)
];

// Pure. "plumbing" = a bug the trader must know about now; "market" = a
// legitimate no-trade the chain reached on purpose.
export function classifyNoTradeReason(reason) {
  const r = String(reason || "").toLowerCase();
  return PLUMBING_TOKENS.some((tok) => r.includes(tok)) ? "plumbing" : "market";
}

// Pure. Stable de-dupe key for one plumbing condition (drop bar counts/numbers
// so "missing_X on 12 bars" and "...on 13 bars" collapse to one alert).
export function plumbingAlertKey(reason) {
  return String(reason || "").replace(/\d+/g, "#").trim().slice(0, 100);
}

// Per-session throttle state. One alert per distinct plumbing condition per
// session — a session that blocks 134 bars on the same reason pushes once.
let _alerted = { session: null, keys: new Set() };
export function __resetHealthAlerts() { _alerted = { session: null, keys: new Set() }; }

// Fire a loud push the FIRST time a live session hits a given plumbing block.
// `notify`/`send` are injectable for tests. Best-effort: never throws into the
// live chain.
export async function alertIfPlumbingBlock({ reason, session, send, notify = notifySystem } = {}) {
  if (classifyNoTradeReason(reason) !== "plumbing") return { alerted: false, kind: "market" };
  if (session !== _alerted.session) _alerted = { session, keys: new Set() };
  const key = plumbingAlertKey(reason);
  if (_alerted.keys.has(key)) return { alerted: false, throttled: true };
  _alerted.keys.add(key);
  try {
    await notify({
      title: "⚠️ Live chain blocked",
      body: `${session || "session"} — chain can't evaluate: ${reason}`,
    });
  } catch { /* notify is best-effort */ }
  try { send?.("app:error", { kind: "plumbing_block", session, reason, ts: new Date().toISOString() }); } catch { /* renderer optional */ }
  return { alerted: true, key };
}
