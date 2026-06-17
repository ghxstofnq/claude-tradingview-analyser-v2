// app/renderer/src/Orders.helpers.js
// Pure formatters for the ORDERS popover. No React — unit-tested via node --test.

export function formatDrawOption(d) {
  const r = d?.rr != null ? ` · ${d.rr}R` : "";
  return `${d?.name ?? "level"} · ${d?.price}${r}`;
}

const STOP_LABEL = {
  leg_low: "leg low", leg_high: "leg high",
  swing_low: "swing low", swing_high: "swing high",
  session_level_low: "session level", session_level_high: "session level", session_level: "session level",
  typed: "typed",
};
export function formatStopSource(kind) {
  if (!kind) return "—";
  return STOP_LABEL[kind] ?? kind;
}

export function routingLabel({ active, confirmed, gate } = {}) {
  const brokerName = (a) => (a?.broker === "tradovate" ? "tradovate" : a?.type);
  if (confirmed && gate?.route) return `${brokerName(confirmed)} · ${confirmed.id}`;
  const a = active || confirmed;
  // surface the ACTIVE account on a pending switch so it's visible the moment
  // the trader changes brokers (e.g. "confirm Tradovate · D54476869").
  if (a && gate?.needsConfirm) {
    const label = a.broker === "tradovate" ? "Tradovate" : a.type;
    return `confirm ${label} · ${a.id}`;
  }
  if (confirmed?.type === "live" && !gate?.route) return "live blocked";
  return "confirm account";
}

const BLOCK = {
  no_price: "No live price — refresh the structure read.",
  no_stop: "No stop — pick a level or type one.",
  stop_wrong_side: "Stop is on the wrong side of entry.",
  no_size: "No whole-contract size could be computed for this stop.",
  over_max: "Stop too wide — even 1 contract exceeds your per-trade max.",
};
export function blockMessage(code) { return code ? (BLOCK[code] ?? code) : ""; }

// Toast text for a placeManual result. Three outcomes:
//   ok:true            → "ORDER SENT" (broker confirmed)
//   blocked:true       → "BLOCKED · <reason>" (guard/route, never reached the broker)
//   else               → "ORDER FAILED · <why>" (broker rejected / transport error)
// The paper path used to return ok:true regardless of HTTP status, so a failed
// POST toasted "ORDER SENT" — this distinguishes the broker-failure case.
export function orderResultToast(r, { side, contracts, symbol } = {}) {
  if (r?.ok) return `ORDER SENT · ${String(side || "").toUpperCase()} ${contracts ?? "?"}c ${symbol ?? ""}`.trim();
  if (r?.blocked) return `BLOCKED · ${r.code ? blockMessage(r.code) : (r.message || r.error || "rejected")}`;
  const why = r?.result?.status ? `HTTP ${r.result.status}` : (r?.error || r?.result?.body || "broker rejected");
  return `ORDER FAILED · ${String(why).slice(0, 80)}`;
}
