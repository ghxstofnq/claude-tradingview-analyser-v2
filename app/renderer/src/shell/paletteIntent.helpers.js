// paletteIntent — classify a ⌘K query into a palette view. Pure.
// Ported from the Command Shell prototype's detect() (design handoff,
// 2026-07-03): verbs run, questions ask, nouns browse.

export function detectIntent(qRaw) {
  const q = String(qRaw ?? "").trim().toLowerCase();
  if (!q) return "root";
  if (/^(long|short)\b/.test(q)) return "ticket";
  if (/\?\s*$/.test(q) || /^(why|what|how|should|did|was|is|are|can)\b/.test(q)) return "ask";
  if (/^alerts?\b/.test(q)) return "browse";
  if (/^(news|calendar)\b/.test(q)) return "news";
  if (/^(orders?|fills?)\b/.test(q)) return "orders";
  return "filter";
}
