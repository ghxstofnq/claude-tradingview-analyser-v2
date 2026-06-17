// Pure helpers for Live.jsx — extracted so they can be unit-tested with
// `node --test`. Importing this file has no side effects.
import { greenLightReached } from "../../../cli/lib/scale-in-rules.js";

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

// Find Pillar 3 ("Entry Model + Confirmation") in a pillar_breakdown array
// by name substring (case-insensitive). Robust to ordering changes in the
// prompt — index-based access is fragile.
//
// Returns the pillar object or null if not found.
export function selectPillar3(pillars) {
  if (!Array.isArray(pillars)) return null;
  return pillars.find((p) => p && typeof p.name === "string" && /entry|confirmation/i.test(p.name)) || null;
}

// Map Pillar 3 elements to the four confirmation rows displayed in the
// STEP 5+6 panel. Elements are matched by name substring:
//   - "PD-array tap" → /pd|tap/i
//   - "1m close past structure" → /1m/i
//   - "5m close past structure" → /5m/i
//   - "Clean delivery" → /delivery|clean/i
//
// Returns [{ label, status, detail }] — one entry per slot, always 4 rows.
// Missing elements render as { status: "missing", detail: "—" }.
export function pillar3ToConfirmationRows(pillar3) {
  const elements = pillar3?.elements || [];
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
    rowFor("1m close past structure", /1m/i),
    rowFor("5m close past structure", /5m/i),
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

// Decide whether a same-side scale-in ("ADD") should surface onto the open
// position. Per strategy §7 Step 7, you only add to a WINNER: the anchor must
// be green-lit and the new live candidate must be the SAME side as the
// position — never reverse via an add.
//
// Green-light uses the SAME shared rule as the auto tranche engine
// (greenLightReached: 50% to the anchor's nearest intraday objective
// greenlight_ref, falling back to TP1) so MANUAL and AUTO add-timing are
// identical. Pass the journal anchor (carries greenlight_ref); when it's
// absent we judge off the live position's avgFill/tp.
//
// Inputs:
//   position    — live broker position { side:"buy"|"sell", avgFill, tp, ... }
//   anchor      — journal anchor { side, entry, tp1, greenlight_ref } (optional)
//   activeSetup — the live walker candidate { side:"long"|"short", entry, ... }
//   price       — current mid price
// Returns the activeSetup (the add candidate) when all conditions hold, else null.
export function deriveAddCandidate({ position, anchor = null, activeSetup, price } = {}) {
  if (!position || !activeSetup) return null;
  const posSide = normalizeSide(position.side);
  if (!posSide || activeSetup.side !== posSide) return null;     // same side only
  const gl = anchor && Number.isFinite(Number(anchor.entry))
    ? { side: posSide, entry: Number(anchor.entry), tp1: Number(anchor.tp1), greenlight_ref: anchor.greenlight_ref }
    : { side: posSide, entry: Number(position.avgFill), tp1: Number(position.tp) };
  // Target must be finite and beyond entry in the trade's direction — a broker
  // position can momentarily lack a tp; don't judge green-lit off garbage.
  const target = Number(gl.greenlight_ref ?? gl.tp1);
  if (!Number.isFinite(gl.entry) || !Number.isFinite(target)) return null;
  if (posSide === "long" ? target <= gl.entry : target >= gl.entry) return null;
  return greenLightReached(gl, price) ? activeSetup : null;
}

// Build the IN-TRADE tranche stack from the open journal trades (each tranche
// is its own trade on a netting account). Anchor first, then adds by seq. Each
// row carries its own entry/stop/tp + unrealized R (via liveGridFromTrade).
export function trancheStackFromState(openTrades, price) {
  if (!Array.isArray(openTrades)) return [];
  const rows = openTrades
    .filter((t) => t && t.state !== "closed")
    .map((t) => {
      const grid = liveGridFromTrade(
        { entry: t.entry, stop: t.stop, tp1: t.tp1, tp2: t.tp2, side: t.side, r_realized: t.r_realized, tp1_hit: t.tp1_hit },
        price,
      );
      return {
        id: t.id,
        role: t.tranche_role || "anchor",
        seq: t.tranche_seq ?? 0,
        side: t.side,
        grade: t.grade,
        entry: t.entry,
        stop: t.stop,
        tp: t.tp1,
        r: grid.pnl.v,
        tone: grid.pnl.tone,
      };
    });
  rows.sort((a, b) => (a.role === "anchor" ? 0 : 1) - (b.role === "anchor" ? 0 : 1) || (a.seq - b.seq));
  return rows;
}
