// cli/lib/lanto-overnight-vote.js
// Overnight component vote (rubric §3, docs/strategy/lanto-prep-rubric.md).
//
// A clear bearish/bullish overnight state votes that direction; consolidation /
// chop votes `none` (Daily Bias 15:54: "if overnight strikes consolidation, I
// won't have a dedicated bias… it's just chop"; 16:50). Driven by the engine's
// own overnight classification (quality.overnight_dir ∈ bull | bear | chop),
// with a sign guard against a stale/contradictory net.
//
// Pure. Returns "bull" | "bear" | "none".

export function overnightVote({ overnight_dir, overnight_net } = {}) {
  const s = String(overnight_dir ?? "").toLowerCase();
  const dir = s.startsWith("bull") ? "bull" : s.startsWith("bear") ? "bear" : "none";
  if (dir === "none") return "none";

  // Contradiction guard: if a net is given and clearly disagrees with the dir,
  // treat it as unresolved (none) rather than trust a stale label.
  const net = Number(overnight_net);
  if (Number.isFinite(net) && net !== 0) {
    if (dir === "bull" && net < 0) return "none";
    if (dir === "bear" && net > 0) return "none";
  }
  return dir;
}
