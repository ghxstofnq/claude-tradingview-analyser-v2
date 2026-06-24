// Pure helpers for Live.jsx — extracted so they can be unit-tested with
// `node --test`. Importing this file has no side effects.

// Normalize a position/order "side" to "long" | "short" | null, accepting every
// vocabulary the execution feeds emit: order side ("buy"/"sell"), TradingView's
// positions-table Side column read from the DOM ("long"/"short", lowercased at
// tv-adapter.js:67), and numeric/signed values (1/-1). A binary
// `=== "buy" ? "long" : "short"` silently flipped a DOM-sourced long to "short";
// this returns null for flat/unknown so callers can fall back safely.
export function normalizeSide(side) {
  if (side == null) return null;
  const s = String(side).trim().toLowerCase();
  if (s === "buy" || s === "long" || s === "b" || s === "1" || s === "+1") return "long";
  if (s === "sell" || s === "short" || s === "s" || s === "-1") return "short";
  return null;
}

// Find Pillar 3 (the entry-model + confirmation pillar) in a pillar_breakdown
// array by name substring (case-insensitive). Robust to ordering changes —
// index-based access is fragile. Matches both shapes the panel can receive:
// the LLM-surfaced "Entry Model + Confirmation" and the live single-brain
// deterministic packet's "Pillar 3" (bar-close.js deterministicPacketToSurfacePayload).
//
// Returns the pillar object or null if not found.
export function selectPillar3(pillars) {
  if (!Array.isArray(pillars)) return null;
  return pillars.find((p) => p && typeof p.name === "string" && /entry|confirmation|pillar\s*3/i.test(p.name)) || null;
}

// Map Pillar 3 to the three confirmation rows in the ENTRY panel. Lanto's
// confirmation is the ONE-MINUTE close ONLY — "I don't use five-minute
// confirmation … one minute confirmation on every single gap" (Entry Models
// 04:43) — so there is NO 5m confirmation row. The faithful checks are:
//   - "PD-array tap"            → /pd|tap/i   (price rebalanced the entry array)
//   - "1m confirmation close"   → /1m/i       (the deliberate 1m close)
//   - "Clean delivery"          → /delivery|clean/i  (displaced, not a >10-15m fight)
//
// Two input shapes:
//   1. Live single-brain deterministic packet — carries no named elements; its
//      Pillar-3 VERDICT string is the confirmation truth (the chain only
//      surfaces a setup AFTER the 1m confirmation close, so a PASS verdict means
//      all three held). Map the verdict onto the three rows.
//   2. LLM-surfaced "Entry Model + Confirmation" pillar with named elements —
//      match each row by name substring.
//
// Returns [{ label, status, detail }] — always 3 rows. Missing elements render
// as { status: "missing", detail: "—" }.
export function pillar3ToConfirmationRows(pillar3) {
  const elements = pillar3?.elements || [];
  if (!elements.length && pillar3?.verdict) {
    const status = /^pass/i.test(String(pillar3.verdict)) ? "pass" : "pending";
    const detail = String(pillar3.verdict);
    return [
      { label: "PD-array tap", status, detail },
      { label: "1m confirmation close", status, detail },
      { label: "Clean delivery", status, detail },
    ];
  }
  const find = (rx) => elements.find((e) => e && typeof e.name === "string" && rx.test(e.name));
  const rowFor = (label, rx) => {
    const el = find(rx);
    if (!el) return { label, status: "missing", detail: "—" };
    return {
      label,
      status: el.status || "pending",
      detail: el.detail || el.note || (el.status === "pass" ? "yes" : el.status === "pending" ? "pending" : "—"),
    };
  };
  return [
    rowFor("PD-array tap", /pd|tap/i),
    rowFor("1m confirmation close", /1m/i),
    rowFor("Clean delivery", /delivery|clean/i),
  ];
}

// Compute LIVE GRID 4-cell data from a trade + live close price.
// Returns { price, pnl, toTp1, toStop } each with { v: string, sub: string, tone: string }.
//
// When lastClose isn't a finite number, returns nulls — the renderer
// falls back to "—" placeholders.
export function liveGridFromTrade(trade, lastClose) {
  if (!trade || typeof lastClose !== "number" || !Number.isFinite(lastClose)) {
    return {
      price: { v: "—", sub: "", tone: "" },
      pnl: { v: "—", sub: "", tone: "" },
      toTp1: { v: "—", sub: "", tone: "" },
      toStop: { v: "—", sub: "", tone: "" },
    };
  }
  const fmt = (n) => Number(n.toFixed(2));
  const fmtPx = (n) => {
    const [whole, dec = ""] = String(n).split(".");
    const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return dec ? `${withSpaces}.${dec.padEnd(2, "0").slice(0, 2)}` : withSpaces;
  };
  const entry = Number(trade.entry);
  const tp1 = Number(trade.tp1);
  const stop = Number(trade.stop);
  const isLong = trade.side === "long";
  const fromEntry = isLong ? lastClose - entry : entry - lastClose;
  const distTp1 = isLong ? tp1 - lastClose : lastClose - tp1;
  const distStop = isLong ? lastClose - stop : stop - lastClose;
  const pnlR = trade.r_realized != null
    ? Number(trade.r_realized)
    : Number.isFinite(entry) && Number.isFinite(stop) && entry !== stop
      ? fmt(fromEntry / Math.abs(entry - stop))
      : null;
  return {
    price: {
      v: fmtPx(lastClose),
      sub: Number.isFinite(fromEntry) ? `${fromEntry >= 0 ? "+" : ""}${fmt(fromEntry)} from entry` : "",
      tone: "",
    },
    pnl: {
      v: pnlR != null ? `${pnlR > 0 ? "+" : ""}${pnlR} R` : "—",
      sub: trade.r_realized != null ? "realized" : "unrealized",
      tone: pnlR == null ? "" : pnlR > 0 ? "green" : pnlR < 0 ? "red" : "",
    },
    toTp1: {
      v: Number.isFinite(distTp1) ? String(Math.abs(fmt(distTp1))) : "—",
      sub: distTp1 > 0 ? "pts away" : "past",
      tone: "green",
    },
    toStop: {
      v: Number.isFinite(distStop) ? String(Math.abs(fmt(distStop))) : "—",
      sub: trade.tp1_hit ? "pts (BE)" : "pts",
      tone: "red",
    },
  };
}

// design.md 2×2 framing: 2 models (Reversal / Continuation) × 2 mechanisms
// (FVG-retrace / inversion). The walker emits one combined name — MSS / Trend /
// Inversion — so annotate the model family for a clearer entry-model label,
// falling back to the raw string.
//   MSS       → Reversal · MSS        (liquidity grab + market-structure shift)
//   Trend     → Continuation · Trend  (continuation in the direction of displacement)
//   Inversion → Inversion             (failed PD array flips and is traded the other way)
export function modelLabel(setup) {
  const m = String(setup?.model || "").trim();
  if (!m) return "—";
  if (/^mss$/i.test(m)) return "Reversal · MSS";
  if (/^trend$/i.test(m)) return "Continuation · Trend";
  if (/^inversion$/i.test(m)) return "Inversion";
  return m;
}

// Roll the four Pillar-3 confirmation rows into one verdict for the entry
// header (verdict-first). Lanto's confirmation = a deliberate 1m close, so the
// AWAITING state names it explicitly. Returns { label, tone } where tone is a
// pill class (green | amber | red | dim).
//   - any row fail            → INVALIDATED (red)
//   - all rows pass           → CONFIRMED (green)
//   - otherwise (pending/etc) → AWAITING 1m CLOSE (amber)
//   - no rows                 → "—" (dim)
export function entryConfirmationVerdict(confRows) {
  const rows = Array.isArray(confRows) ? confRows : [];
  if (!rows.length) return { label: "—", tone: "dim" };
  if (rows.some((r) => r.status === "fail")) return { label: "INVALIDATED", tone: "red" };
  if (rows.every((r) => r.status === "pass")) return { label: "CONFIRMED", tone: "green" };
  return { label: "AWAITING 1m CLOSE", tone: "amber" };
}
