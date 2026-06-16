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
  no_size: "No whole-contract size lands within $50 of your risk.",
};
export function blockMessage(code) { return code ? (BLOCK[code] ?? code) : ""; }
