// Brain.helpers — turn the deterministic chain's per-bar verdict
// (deterministic:packet) into plain-English BRAIN prose. No Claude in the loop:
// this is the deterministic engine's own reasoning rendered directly, so BRAIN
// keeps working even when the LLM is unavailable. Pure + unit-tested.

// Format a number for prose: round to 2 decimals, strip trailing zeros.
function fmtNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  return String(Math.round(n * 100) / 100);
}

// A packet field may be { price } (full truth) or a bare number (flat). Coerce.
function price(field) {
  if (field && typeof field === "object") return field.price;
  return field;
}

export function walkerTruthToProse(truth) {
  if (!truth || typeof truth !== "object") return "Chain produced no verdict for this bar.";
  if (truth.chain_error) return String(truth.chain_error);

  const pkt = truth.bestPacket;
  if (pkt) {
    const entry = price(pkt.entry);
    const stop = price(pkt.stop);
    const stopKind = (pkt.stop && typeof pkt.stop === "object" ? pkt.stop.kind : null) ?? pkt.stop_kind ?? null;
    const tp1 = price(pkt.tp1);
    const tp1r = (pkt.tp1 && typeof pkt.tp1 === "object" ? pkt.tp1.rMultiple : null) ?? pkt.tp1_r ?? null;
    const head = [pkt.grade, pkt.model, String(pkt.side ?? "").toUpperCase()].filter(Boolean).join(" ").trim();
    const bits = [];
    if (entry != null) bits.push(`entry ${fmtNum(entry)}`);
    if (stop != null) bits.push(`stop ${fmtNum(stop)}${stopKind ? ` (${stopKind})` : ""}`);
    if (tp1 != null) bits.push(`TP1 ${fmtNum(tp1)}${tp1r != null ? ` (${fmtNum(tp1r)}R)` : ""}`);
    return `Setup fired — ${[head, ...bits].filter(Boolean).join(", ")}.`;
  }

  const reason = (truth.noTradeReason && String(truth.noTradeReason).trim())
    || (Array.isArray(truth.blockers) && truth.blockers.length ? `blocked: ${truth.blockers.slice(0, 4).join(", ")}` : "no setup this bar");
  const walkers = (Array.isArray(truth.walkers) ? truth.walkers : []).filter((w) => w && w.stage);
  let line = `No trade — ${reason}.`;
  if (walkers.length) {
    const ws = walkers.slice(0, 4)
      .map((w) => `${w.model || "?"} ${String(w.side ?? "").toUpperCase()} @ ${w.stage}`.replace(/\s+/g, " ").trim())
      .join("; ");
    line += ` ${walkers.length} walker${walkers.length > 1 ? "s" : ""}: ${ws}.`;
  }
  return line;
}
