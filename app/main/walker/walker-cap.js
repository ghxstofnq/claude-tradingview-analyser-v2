// LIFO eviction with stage protection. Walkers in confirmation or later
// stages are protected from eviction — they're about to fire.

const PROTECTED_STAGES = new Set(['confirmation', 'trigger']);

export function enforceCap(walkers, maxLive) {
  if (!Array.isArray(walkers) || walkers.length <= maxLive) return walkers;
  const protectedW = walkers.filter((w) => PROTECTED_STAGES.has(w.stage));
  const evictable = walkers
    .filter((w) => !PROTECTED_STAGES.has(w.stage))
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));   // newest first
  const slotsForEvictable = Math.max(0, maxLive - protectedW.length);
  return [...protectedW, ...evictable.slice(0, slotsForEvictable)];
}
