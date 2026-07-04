// evidence.helpers — curate a real brief key-level into the ONLY honest fields an
// Evidence panel can show: name, price, state, cite (provenance), and a distance
// to the last close. No sparkline / "rule" text — there is no real source for
// those in the renderer (a single last bar isn't a series). Pure; unit-tested.
export function curateLevel(level, close) {
  if (!level) return null;
  const price = Number(level.price);
  // Number(null) is 0 — guard so a missing close never fabricates a distance.
  const c = close == null ? NaN : Number(close);
  const hasDist = Number.isFinite(price) && Number.isFinite(c);
  return {
    name: level.name ?? "—",
    price: Number.isFinite(price) ? price : level.price,
    state: level.state || "untaken",
    cite: level.cite || null,
    distance: hasDist ? Math.abs(price - c) : null,
    direction: hasDist ? (price > c ? "above" : price < c ? "below" : "at") : "—",
  };
}
