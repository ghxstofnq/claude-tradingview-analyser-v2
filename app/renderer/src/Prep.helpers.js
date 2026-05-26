// Pure helpers for Prep.jsx — extracted so they can be unit-tested with
// `node --test` (the project's only test runner; the renderer doesn't
// have Vitest). Importing this file has no side effects.

// Partition key_levels[] into { above, below } relative to currentPrice.
// Each partition is sorted by absolute distance to currentPrice (closest
// first), so the closest opposing levels lead in each direction.
//
// When currentPrice is null/undefined/NaN, returns { above: null, below: null,
// all: <sorted-high-to-low> } — the renderer falls back to a single block.
//
// `levels` must be an array of { name, price, state, ... } objects. Any
// item missing a numeric price is filtered out.
export function groupLevelsByPrice(levels, currentPrice) {
  const valid = (levels || []).filter((l) => typeof l.price === "number" && Number.isFinite(l.price));
  if (typeof currentPrice !== "number" || !Number.isFinite(currentPrice)) {
    const all = [...valid].sort((a, b) => b.price - a.price);
    return { above: null, below: null, all };
  }
  const above = valid
    .filter((l) => l.price > currentPrice)
    .sort((a, b) => (a.price - currentPrice) - (b.price - currentPrice));
  const below = valid
    .filter((l) => l.price <= currentPrice)
    .sort((a, b) => (currentPrice - a.price) - (currentPrice - b.price));
  return { above, below, all: null };
}

// Find a specific pillar in brief.pillars[] by name substring (case-insensitive).
// Robust to ordering changes in the prompt — index-based access is fragile.
// Returns the pillar object or null if not found.
//
// Substring patterns used elsewhere:
//   - Pillar 1: "Draw & Bias"  → /draw.*bias/i
//   - Pillar 2: "Price-Action Quality" → /price.*action|quality/i
//   - Pillar 3: "Entry Model + Confirmation" → /entry|confirmation/i
export function selectPillar(pillars, pattern) {
  if (!Array.isArray(pillars)) return null;
  return pillars.find((p) => p && typeof p.name === "string" && pattern.test(p.name)) || null;
}

// Map a Pillar 2 (Price-Action Quality) object to the three rows displayed
// in STEP 3 · PRICE QUALITY. Pillar 2 elements are matched by substring:
//   - "range" → 3h range
//   - "displacement" → 4H/1H displacement
//   - "candle" → 15m/5m candles
//
// Returns [{ k, v, tone }] — one entry per matched element, in the order
// above. Missing elements render as { k, v: "—", tone: "dim" }.
export function pillar2ToRows(pillar2) {
  const elements = pillar2?.elements || [];
  const find = (rx) => elements.find((e) => e && typeof e.name === "string" && rx.test(e.name));
  const statusTone = (s) => ({ pass: "green", weak: "amber", fail: "red", pending: "dim" }[s] || "dim");
  const rowFor = (label, rx, fallback) => {
    const el = find(rx);
    if (!el) return { k: label, v: fallback, tone: "dim" };
    const detail = el.detail || el.note || "";
    return {
      k: label,
      v: detail ? `${(el.status || "").toUpperCase()} · ${detail}` : (el.status || "").toUpperCase(),
      tone: statusTone(el.status),
    };
  };
  return [
    rowFor("3h range", /range/i, "—"),
    rowFor("4H/1H displacement", /displacement/i, "—"),
    rowFor("15m/5m candles", /candle/i, "—"),
  ];
}

// Decide whether the chain_status chip should render and what tone to use.
// Returns { visible, label, tone } — visible=false when status is null,
// undefined, or exactly "clean".
//
// Tones:
//   - "stale:N" → red ("STALE")
//   - everything else non-clean → amber
export function formatChainChip(status) {
  if (!status || status === "clean") return { visible: false, label: null, tone: null };
  const tone = status.startsWith("stale:") ? "stale" : "warn";
  return { visible: true, label: status, tone };
}
