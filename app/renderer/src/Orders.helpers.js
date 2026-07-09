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
  fvg_c1: "1/3 FVG", fvg_c2: "2/3 FVG",
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

// ── Stacked chooser rows (refined BUY/SELL ticket, 2026-07-10) ──────────────
// The ticket asks the trader to CHOOSE the stop and TP from named options,
// defaults pre-selected (1/3 FVG stop · 1:2 TP). Pure: rows carry everything
// the renderer prints; `value` is what selecting the row writes into the
// typed field ("" = the default → placement re-derives it on a fresh read).

const STOP_TAG = {
  fvg_c1: "1/3 FVG", fvg_c2: "2/3 FVG",
  ifvg_c1: "1/3 iFVG", ifvg_c2: "2/3 iFVG",
  swing_low: "SL", swing_high: "SH",
  session_level_low: "session", session_level_high: "session", session_level: "session",
  leg_low: "leg", leg_high: "leg",
};
export function stopTag(kind) { return STOP_TAG[kind] ?? (kind || "level"); }

export function stopChooserRows(preview, typedStop) {
  const opts = preview?.stopOptions ?? [];
  const entry = Number(preview?.entry);
  const raw = String(typedStop ?? "");
  const typed = raw === "" ? null : Number(raw);
  const rows = opts.map((o, i) => {
    const tag = stopTag(o.kind);
    const label = /fvg_c[12]$/.test(String(o.kind))
      ? String(o.name ?? "").replace(tag, "").trim()
      : (o.name ?? tag);
    const pts = Number.isFinite(entry) && Number.isFinite(Number(o.stopPrice))
      ? Number(Math.abs(entry - o.stopPrice).toFixed(2)) : null;
    return {
      key: `${o.kind}:${o.stopPrice}`, tag, label,
      levelPrice: o.levelPrice, stopPrice: o.stopPrice, pts,
      sel: typed == null ? i === 0 : Number(o.stopPrice) === typed,
      isDefault: i === 0,
      value: i === 0 ? "" : String(o.stopPrice),
    };
  });
  return { rows, customSel: typed != null && !rows.some((r) => r.sel) };
}

export function tpChooserRows(preview, typedTp) {
  const raw = String(typedTp ?? "");
  const typed = raw === "" ? null : Number(raw);
  const rows = [];
  if (preview?.tpDefault != null) {
    rows.push({ key: "rr_default", tag: "1:2", label: "default", price: preview.tpDefault, rr: 2, sel: typed == null, isDefault: true, value: "" });
  }
  for (const d of preview?.tpDraws ?? []) {
    const tag = d.kind === "session_level" ? "session" : /^eq/.test(String(d.kind ?? "")) ? "pool" : "level";
    rows.push({ key: `draw:${d.price}`, tag, label: d.name ?? tag, price: d.price, rr: d.rr ?? null, sel: typed != null && Number(d.price) === typed, isDefault: false, value: String(d.price) });
  }
  return { rows, customSel: typed != null && !rows.some((r) => r.sel) };
}
