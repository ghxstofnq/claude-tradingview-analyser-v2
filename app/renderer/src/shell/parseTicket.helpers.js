// parseTicket — "long 2 mnq" → a seed for the palette ticket view. Pure.
//
// Sizing stays risk-based in the execution engine (execution:orderPreview /
// placeManual size from $ risk; CLAUDE.md #7 — no UI-invented sizing). A typed
// qty is therefore a display hint only, surfaced so the trader sees it was
// read; the engine's computed contracts are what routes.

export function parseTicket(qRaw, { defaultSymbol = "MNQ1!" } = {}) {
  const q = String(qRaw ?? "").trim().toLowerCase();
  const m = q.match(/^(long|short)\b\s*(\d+)?\s*(mnq|mes)?/);
  if (!m) return null;
  return {
    side: m[1] === "long" ? "buy" : "sell",
    dir: m[1].toUpperCase(),
    qtyHint: m[2] ? parseInt(m[2], 10) : null,
    symbol: m[3] ? `${m[3].toUpperCase()}1!` : defaultSymbol,
  };
}
