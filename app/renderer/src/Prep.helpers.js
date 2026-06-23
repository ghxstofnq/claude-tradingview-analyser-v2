// Pure helpers for Prep.jsx — extracted so they can be unit-tested with
// `node --test` (the project's only test runner; the renderer doesn't
// have Vitest). Importing this file has no side effects.

// Strip "(json.path)" citation parentheticals from a prose blob — those
// belong in tooltips, not in the readable text. Brief prose is loaded
// with these per CLAUDE.md constraint #6 (cite-or-reject); the renderer
// strips them for display while the raw value remains in brief.brief.
export function stripCitations(s) {
  if (!s) return "";
  return String(s)
    .replace(/\s*\([a-z_]+(?:[._a-zA-Z0-9!\[\]]+)?(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*\s*[^)]*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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
// in STEP 3 · PRICE QUALITY. The brief schema has shifted over time:
//
//   Legacy stub: element names like "range", "displacement", "candle".
//   Chain spec : TF-prefixed names like "h4 quality (good / ...)",
//                "h1 quality (...)", "m5 anatomy (clean displacement / ...)",
//                "m15 anatomy (...)".
//
// Matching strategy (in priority order):
//   1. 3h range          — element whose name starts with "range" or
//                          contains "3h range" or "range" but NOT
//                          "anatomy" (anatomy refers to candle shape).
//   2. 4H/1H displacement — element whose name starts with "h4" or "h1"
//                          (quality / displacement on the HTF candles).
//   3. 15m/5m candles    — element whose name starts with "m5" or "m15"
//                          (anatomy / candle shape on the LTF candles).
//
// Falls back to legacy substring matches if the new shape isn't present.
//
// Returns [{ k, v, tone }] — one entry per slot. Missing elements render
// as { k, v: "—", tone: "dim" }.
export function pillar2ToRows(pillar2) {
  const elements = pillar2?.elements || [];
  const findExact = (predicate) => elements.find((e) => e && typeof e.name === "string" && predicate(e.name));
  // Designer's STEP 3 tone vocabulary is ok / warn / bad / dim (not
  // green/amber/red) — those classes are the ones the popover stylesheet
  // colors inside `.bt-popover .row .v`. Keep them aligned so PRICE QUALITY
  // values render colored, matching the mockup.
  const statusTone = (s) => ({ pass: "ok", weak: "warn", fail: "bad", pending: "dim" }[s] || "dim");

  // Three slot matchers — each tries the chain-spec name first, then
  // falls back to the legacy substring.
  const rangeEl = findExact((n) => /^range\b/i.test(n) || /3.?h.*range/i.test(n))
               || findExact((n) => /\brange\b/i.test(n) && !/anatomy/i.test(n));
  const htfEl   = findExact((n) => /^h4\b/i.test(n))
               || findExact((n) => /^h1\b/i.test(n))
               || findExact((n) => /displacement/i.test(n) && !/anatomy/i.test(n));
  const ltfEl   = findExact((n) => /^m5\b/i.test(n))
               || findExact((n) => /^m15\b/i.test(n))
               || findExact((n) => /candle/i.test(n) && !/h4|h1/i.test(n));

  const rowFor = (label, el) => {
    if (!el) return { k: label, v: "—", tone: "dim" };
    const detail = el.detail || el.note || "";
    return {
      k: label,
      v: detail ? `${(el.status || "").toUpperCase()} · ${detail}` : (el.status || "").toUpperCase(),
      tone: statusTone(el.status),
    };
  };
  return [
    rowFor("3h range", rangeEl),
    rowFor("4H/1H displacement", htfEl),
    rowFor("15m/5m candles", ltfEl),
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

// Map a brief.htf_bias array to the four concise rows shown in STEP 1.
// brief.htf_bias is shaped: [{ tf, bias, note }] where tf is "D"|"4H"|"1H"
// and bias is "BULL"|"BEAR"|"NEUTRAL". `brief.primary_draw` and
// `brief.htf_destination` provide the imbalance / draw / reaction rows.
//
// Returns [{ k, v, tip }] — one per slot, missing rows render as "—".
// `tip` is the full strategy doc bullet text used as the title="" tooltip.
export function htfBiasToRowsConcise(brief) {
  // Bias trio renders as "D:BULL / 4H:BULL / 1H:BEAR" — abbreviate the
  // tf labels (DAILY → D) and the bias enums (BULLISH → BULL, BEARISH →
  // BEAR, MIXED stays MIXED, NEUTRAL → NEU) so the row fits the 1fr
  // column without wrapping.
  const abbrevTf = (tf) => {
    const t = String(tf || "").toUpperCase();
    if (t === "DAILY") return "D";
    return t;
  };
  const abbrevBias = (b) => {
    const v = String(b || "").toUpperCase();
    if (v === "BULLISH")  return "BULL";
    if (v === "BEARISH")  return "BEAR";
    if (v === "NEUTRAL")  return "NEU";
    return v;
  };
  const biases = (brief?.htf_bias || [])
    .map((r) => `${abbrevTf(r.tf)}:${abbrevBias(r.bias)}`)
    .join(" / ");
  const pd = brief?.primary_draw;
  const draw = brief?.htf_destination;
  const reaction = pd?.state || (pd?.took_liq ? "rejected" : null);
  // "Best imbalances" formatted as "<tf> <dir> <kind> · took_liq yes/no".
  // Examples: "h1 bull FVG · took_liq yes", "h4 bear BPR · took_liq no".
  let bestImbalances = "—";
  if (pd) {
    const tf = pd.tf || pd.timeframe;
    const dir = pd.dir ? String(pd.dir).toLowerCase() : null;
    const kind = pd.kind || pd.type;
    const liq = pd.took_liq != null ? `took_liq ${pd.took_liq ? "yes" : "no"}` : "";
    const parts = [tf, dir, (kind || "").toUpperCase()].filter(Boolean);
    const head = parts.join(" ") || "—";
    bestImbalances = [head, liq].filter(Boolean).join(" · ");
  }
  return [
    {
      k: "Structure",
      v: biases || "—",
      tip: "Structure on D / 4H / 1H — bos / mss direction of each",
    },
    {
      k: "Best imbalances",
      v: bestImbalances,
      tip: "Best imbalances in that direction (large FVGs / BPRs that took liquidity)",
    },
    {
      k: "Main draw",
      v: draw || "—",
      tip: "Main HTF draw (next major buy-side / sell-side pool)",
    },
    {
      k: "PD reaction",
      v: reaction || "—",
      tip: "Recent reaction off HTF PD array",
    },
  ];
}

// Map brief.htf_bias to the per-timeframe rows shown in STEP 1, matching the
// designer's layout exactly: one row per TF (Daily / 4H / 1H) carrying a
// tone-colored bias verdict + a gray descriptive note, then a Draw row from
// brief.primary_draw (or htf_destination as fallback).
//
// Returns [{ k, v, tone, note, tip }]. tone ∈ "bull"|"bear"|"neutral"|"".
// Notes carry a "(json.path)" citation per constraint #6 — stripped for
// display (the full text with the citation stays as the title="" tooltip).
export function htfBiasToRowsDesigner(brief) {
  const tfLabel = (tf) => {
    const t = String(tf || "").toUpperCase();
    if (t === "DAILY") return "Daily";
    return t || "—";
  };
  const biasLabel = (b) => {
    const v = String(b || "").toUpperCase();
    if (v === "BULLISH") return "BULL";
    if (v === "BEARISH") return "BEAR";
    return v || "—";
  };
  const biasTone = (b) => {
    const v = String(b || "").toUpperCase();
    if (v === "BULLISH") return "bull";
    if (v === "BEARISH") return "bear";
    if (v === "NEUTRAL" || v === "MIXED") return "neutral";
    return "";
  };
  const rows = (brief?.htf_bias || []).map((r) => ({
    k: tfLabel(r.tf),
    v: biasLabel(r.bias),
    tone: biasTone(r.bias),
    note: stripCitations(r.note) || "",
    tip: r.note || "",
  }));

  const pd = brief?.primary_draw;
  if (pd) {
    const price = pd.ce ?? pd.top ?? pd.bottom;
    const tf = pd.tf || pd.timeframe;
    const kind = String(pd.kind || pd.type || "").toUpperCase();
    const dir = pd.dir ? String(pd.dir).toLowerCase() : null;
    const note = [tf, kind ? `${kind} midpoint` : null, dir, pd.took_liq ? "took liq" : null]
      .filter(Boolean).join(" · ");
    rows.push({
      k: "Draw",
      v: price != null ? String(price) : (brief?.htf_destination || "—"),
      tone: "",
      note,
      tip: pd.cite ? `primary draw · ${pd.cite}` : "Primary HTF draw",
    });
  } else if (brief?.htf_destination) {
    rows.push({ k: "Draw", v: brief.htf_destination, tone: "", note: "", tip: "Main HTF draw" });
  }
  return rows;
}

// Map brief.overnight_block + brief.key_levels to STEP 2 header rows.
// Returns [{k, v, tip}] — Asia H/L, London H/L, Overnight verdict.
//
// Sources, in order:
//   1. brief.overnight_block.asia.{high,low} / .london.{high,low} —
//      structured form (post-2026-05-26 chain spec)
//   2. brief.key_levels with name AS_H/AS_L/LO_H/LO_L (legacy form)
//
// Overnight verdict reads:
//   1. brief.overnight_block.overnight_verdict — the canonical enum field
//   2. brief.overnight.find(r => /tone|overnight/i.test(r.k)).v
//   3. brief.overnight[0].note  (legacy)
//   4. brief.overnight[0].v     (legacy stub)
export function overnightHeaderRows(brief) {
  const ob = brief?.overnight_block || {};
  const kl = brief?.key_levels || [];
  const findOne = (names) => kl.find((k) => names.some((n) => k.name === n));

  const asia = ob.asia;
  const london = ob.london;
  const asiaH = asia?.high  ?? findOne(["AS_H", "AS.H", "ASIA_H"])?.price;
  const asiaL = asia?.low   ?? findOne(["AS_L", "AS.L", "ASIA_L"])?.price;
  const londonH = london?.high ?? findOne(["LO_H", "LO.H", "LONDON_H"])?.price;
  const londonL = london?.low  ?? findOne(["LO_L", "LO.L", "LONDON_L"])?.price;

  const ov = brief?.overnight || [];
  const verdictRow = ov.find((r) => r && typeof r.k === "string" && /tone|overnight/i.test(r.k));
  const overnight =
    ob.overnight_verdict
    || verdictRow?.v
    || ov[0]?.note
    || ov[0]?.v
    || "—";

  return [
    {
      k: "Asia H / L",
      v: asiaH != null && asiaL != null ? `${asiaH} / ${asiaL}` : "—",
      tip: "Asia high / low — the overnight range that often gets swept on London or NY open",
    },
    {
      k: "London H / L",
      v: londonH != null && londonL != null ? `${londonH} / ${londonL}` : "—",
      tip: "London high / low — set during the 02:00-05:00 ET window",
    },
    {
      k: "Overnight",
      v: overnight,
      tip: "Overnight: extending HTF or consolidating",
    },
  ];
}

// Map brief.pillar1_votes to the Draw & Bias 3-component vote breakdown
// (daily-bias §1: grade = count of HTF + overnight + NY-open reaction votes).
// The brief carries the two PRE-OPEN votes (htf, overnight); the third
// (NY-open reaction) resolves live, so pre-session it renders PENDING.
//
// Returns { rows: [{k,v,tone,tip}], cast, grade } where `cast` is how many
// pre-open components voted directionally and `grade` is the brief's pillar_grade.
export function drawBiasVoteRows(brief) {
  const votes = brief?.pillar1_votes || {};
  const fmt = (x) => {
    const s = String(x || "none").toLowerCase();
    if (s === "bullish" || s === "bull") return { v: "BULL", tone: "bull" };
    if (s === "bearish" || s === "bear") return { v: "BEAR", tone: "bear" };
    return { v: "NONE", tone: "dim" };
  };
  const htf = fmt(votes.htf);
  const overnight = fmt(votes.overnight);
  const isCast = (x) => x != null && String(x).toLowerCase() !== "none";
  const cast = [votes.htf, votes.overnight].filter(isCast).length;
  return {
    rows: [
      { k: "HTF vote", v: htf.v, tone: htf.tone, tip: "Reaction off the significant near-price HTF PD array (daily-bias §1)" },
      { k: "Overnight vote", v: overnight.v, tone: overnight.tone, tip: "Overnight directional read (Asia/London) — engine overnight_dir" },
      { k: "Open", v: "PENDING", tone: "dim", tip: "Third component — the session-open reaction, resolves live after the open" },
    ],
    cast,
    grade: brief?.pillar_grade || null,
  };
}

// Render the SCENARIOS panel meta — sizing-if-A+ line. Reads sizing_note
// from the deterministic/direct brief if present.
export function scenariosMeta(brief) {
  const note = brief?.sizing_note;
  if (!note) return "deterministic prep";
  return `deterministic prep · ${note}`;
}

// Build the verdict-first DECISION strip line from a deterministic brief.
// Pure — used by PrepPopover's hero. Returns:
//   { grade, gradeTone, bias, biasTone, cast, draw, reason }
// `cast` is the count of pre-open components that voted (HTF + overnight) of 3;
// the third (NY-open reaction) resolves live. `draw` is the primary HTF draw
// rendered as "<tf> <dir> <KIND> · <price>". `reason` is a one-line
// deterministic justification (no LLM).
export function decisionLine(brief) {
  const grade = brief?.pillar_grade || "—";
  const gradeTone = grade === "A+" ? "green" : grade === "B" ? "amber" : grade === "no-trade" ? "red" : "dim";

  const dirRaw = String(brief?.htf_bias_dir || brief?.primary_draw?.dir || "").toLowerCase();
  const bias = dirRaw.startsWith("bull") ? "BULLISH"
             : dirRaw.startsWith("bear") ? "BEARISH"
             : dirRaw ? dirRaw.toUpperCase() : "NEUTRAL";
  const biasTone = bias === "BULLISH" ? "ok" : bias === "BEARISH" ? "bad" : "warn";

  const votes = brief?.pillar1_votes || {};
  const isCast = (x) => x != null && String(x).toLowerCase() !== "none";
  const cast = [votes.htf, votes.overnight].filter(isCast).length;

  const pd = brief?.primary_draw;
  let draw = "—";
  if (pd) {
    const price = pd.ce ?? pd.top ?? pd.bottom;
    const tf = pd.tf || pd.timeframe || "";
    const kind = String(pd.kind || pd.type || "").toUpperCase();
    const d = pd.dir ? String(pd.dir).toLowerCase() : "";
    const head = [tf, d, kind].filter(Boolean).join(" ");
    draw = head + (price != null ? ` · ${price}` : "");
  } else if (brief?.htf_destination) {
    draw = brief.htf_destination;
  }

  const reasonParts = [];
  if (pd?.vote_reason) reasonParts.push(pd.vote_reason);
  if (brief?.pillar2_verdict) reasonParts.push(`price quality ${brief.pillar2_verdict}`);
  const reason = reasonParts.join(" · ");

  return { grade, gradeTone, bias, biasTone, cast, draw, reason };
}

// Resolve the OPEN-REACTION verdict block. Pre-open the third component is
// PENDING; once the live open-reaction read exists (useOpenReaction.latest),
// derive CONFIRMS / FLIPS / NOT YET from its fields. Defensive about the
// open-reaction.json shape (verdict/confirmation/bias/reaction_dir/note all
// optional). Returns { rows:[{k,v,tone}], verdict, verdictTone, note, resolved }.
export function openReactionVerdict(latest, brief) {
  const votes = brief?.pillar1_votes || {};
  const fmtVote = (x) => {
    const s = String(x || "none").toLowerCase();
    if (s.startsWith("bull")) return { v: "BULL", tone: "ok" };
    if (s.startsWith("bear")) return { v: "BEAR", tone: "bad" };
    return { v: "NONE", tone: "dim" };
  };
  const htf = fmtVote(votes.htf);
  const overnight = fmtVote(votes.overnight);

  const resolved = !!latest && !!(latest.verdict || latest.confirmation || latest.bias || latest.reaction_dir);
  let ny = { v: "PENDING", tone: "dim" };
  let verdict = "PENDING";
  let verdictTone = "dim";
  let note = "Resolves at the session open — the initial move into opposing / overnight liquidity, then the reaction (not the grab).";

  if (resolved) {
    const conf = String(latest.verdict || latest.confirmation || "").toLowerCase();
    const rdir = String(latest.bias || latest.reaction_dir || "").toLowerCase();
    ny = rdir.startsWith("bull") ? { v: "BULL", tone: "ok" }
       : rdir.startsWith("bear") ? { v: "BEAR", tone: "bad" }
       : { v: "MIXED", tone: "warn" };
    // verdictTone is a pill class (green | amber | red | dim).
    if (conf.includes("confirm") || conf.includes("aligned")) { verdict = "CONFIRMS"; verdictTone = "green"; }
    else if (conf.includes("flip") || conf.includes("revers") || conf.includes("divergent")) { verdict = "FLIPS"; verdictTone = "amber"; }
    else if (conf.includes("stand") || conf.includes("hands") || conf.includes("unclear") || conf.includes("no")) { verdict = "NOT YET"; verdictTone = "dim"; }
    else { verdict = String(latest.verdict || latest.confirmation || "READ").toUpperCase(); verdictTone = "amber"; }
    note = latest.note || latest.summary || latest.reason || note;
  }

  return {
    rows: [
      { k: "HTF", v: htf.v, tone: htf.tone },
      { k: "Overnight", v: overnight.v, tone: overnight.tone },
      { k: "Open", v: ny.v, tone: ny.tone },
    ],
    verdict, verdictTone, note, resolved,
  };
}
