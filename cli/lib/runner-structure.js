// Derive an open runner's per-bar structural-management context from the engine
// evidence — SHARED by the live ticker (tickTrades ctx) and the backtest grader
// (gradeRunner) so the two outcome engines stay in lockstep.
//
// Faithful to risk-and-management.md §"Management styles" / RISK ~13:07–13:59
// ("move the stop up structurally … hold until I get trailed out and we see a
// structure change") and Lanto's Discord runner days (the stop ratchets behind
// price along the swing structure; the ride ends on a structure change):
//
//   protectiveLevel       — the latest SWING-tier protective pivot on the right
//                           side of price (a Higher Low under a long, a Lower
//                           High over a short). The trail ratchets the stop to
//                           it; tickTrades/gradeRunner never loosen.
//   structureBreakAgainst — a SWING-tier displaced MSS in the OPPOSITE direction
//                           (the same significance gate the entry uses, D3) →
//                           exit at market.
//
// Comparisons + a max/min selection only — no price arithmetic (constraint #7).
// Everything is read-only off the engine and tolerant of missing fields, so an
// absent / field-less engine yields {protectiveLevel:null, structureBreakAgainst:false}
// (= today's BE/TP2 behavior; filter-only-when-present).

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normDir(d) {
  const s = String(d ?? "").toLowerCase();
  if (s === "bull" || s === "bullish" || s === "up" || s === "long") return "bullish";
  if (s === "bear" || s === "bearish" || s === "down" || s === "short") return "bearish";
  return null;
}

// Swing-tier swing pivots from the engine, normalized to {isHigh, level}.
function swingPivots(engine) {
  const p3 = engine?.pillar3 ?? {};
  const rows = p3.swings?.swing ?? p3.swingsSwing ?? [];
  return rows
    .map((s) => ({
      isHigh: s.is_high === true || s.isHigh === true,
      level: num(s.level ?? s.price),
    }))
    .filter((s) => s.level != null);
}

// The most recent swing-tier structure event, normalized. A "structure change"
// is a genuine break (validation==='break') with displacement — the D3 gate.
function recentSwingStructure(engine) {
  const p3 = engine?.pillar3 ?? {};
  const mrs = p3.most_recent_structure ?? p3.mostRecentStructure ?? null;
  const tier = String(mrs?.tier ?? "").toLowerCase();
  if (!mrs || tier !== "swing") return null;
  return {
    dir: normDir(mrs.dir ?? mrs.direction),
    event: String(mrs.event ?? "").toLowerCase(),
    validation: String(mrs.validation ?? "").toLowerCase(),
    displacement: mrs.displacement === true || mrs.displacement === 1,
  };
}

export function deriveRunnerStructure(engine, side, refPrice) {
  const result = { protectiveLevel: null, structureBreakAgainst: false };
  if (!engine || (side !== "long" && side !== "short")) return result;
  const ref = num(refPrice ?? engine?.price_context?.last ?? engine?.priceContext?.last);

  // Protective trail level — the tightest swing pivot still on the protective
  // side of price (highest HL under a long / lowest LH over a short).
  const pivots = swingPivots(engine);
  if (ref != null) {
    if (side === "long") {
      const lows = pivots.filter((p) => !p.isHigh && p.level < ref).map((p) => p.level);
      if (lows.length) result.protectiveLevel = Math.max(...lows);
    } else {
      const highs = pivots.filter((p) => p.isHigh && p.level > ref).map((p) => p.level);
      if (highs.length) result.protectiveLevel = Math.min(...highs);
    }
  }

  // Exit on a market-structure change — a swing-tier displaced break the other
  // way (long ⇒ bearish break; short ⇒ bullish break).
  const struct = recentSwingStructure(engine);
  if (struct && struct.displacement && struct.validation === "break") {
    const against = side === "long" ? "bearish" : "bullish";
    if (struct.dir === against) result.structureBreakAgainst = true;
  }
  return result;
}
