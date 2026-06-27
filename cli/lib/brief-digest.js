/**
 * brief-digest.js — build a slim per-symbol digest from a paired bundle.
 *
 * Solves the 2026-05-26 Read-window problem: the full pair block sits at
 * chars 140k-420k of the bundle, past the Read tool's effective limit.
 * The digest pulls forward only the fields the brief needs (HTF momentum,
 * top-ranked FVGs/BPRs/structures, Pillar 2 quality, overnight context),
 * costing ~7-15KB per symbol vs 152KB. Surfaced as `bundle.brief_digest`
 * — top-level, accessible in the first read.
 *
 * Pure function. No I/O. Cited paths use the `engine_by_tf.<tf>.*` prefix
 * so the model can cite directly from the digest's `cite` field.
 *
 * Strategy authority: docs/strategy/trading-strategy-2026.md §7 steps 1-3.
 * Spec: docs/superpowers/specs/2026-05-26-strategy-chain-design.md §2.1.
 */

const HTF_TFS = ['daily', 'h4', 'h1'];
const TOP_N = 3;

/**
 * Rank FVGs by (state=fresh DESC, took_liq DESC, size DESC, disp DESC).
 * §2.1 step 1 prioritizes EXTENSIVE imbalances (large gaps, strong
 * displacement) that took liquidity — size_quality joins as a tiebreaker
 * above raw displacement (below took_liq, preserving the hand-verified
 * June 9 draw pick).
 */
function rankFvgs(fvgs) {
  const sizeRank = (f) => (f.size_quality === 'large' ? 2 : f.size_quality === 'tiny' ? 0 : 1);
  const score = (f) => {
    const freshBit = f.state === 'fresh' ? 2 : (f.state === 'ce_tapped' || f.state === 'inverted' ? 1 : 0);
    const liqBit = f.took_liq ? 1 : 0;
    return freshBit * 1000 + liqBit * 100 + sizeRank(f) * 10 + (typeof f.disp_score === 'number' ? f.disp_score : 0);
  };
  return (fvgs || []).slice().sort((a, b) => score(b) - score(a));
}

/** Rank BPRs by (state=fresh DESC, took_liq DESC). No disp_score on BPRs. */
function rankBprs(bprs) {
  const score = (b) => (b.state === 'fresh' ? 2 : 0) + (b.took_liq ? 1 : 0);
  return (bprs || []).slice().sort((a, b) => score(b) - score(a));
}

/** Latest structures by confirmed_ms DESC. */
function recentStructures(structures, n = 2) {
  return (structures || [])
    .slice()
    .sort((a, b) => (b.confirmed_ms || 0) - (a.confirmed_ms || 0))
    .slice(0, n);
}

/**
 * Per-TF capture provenance for the digest. Distinguishes "no good FVG on a
 * healthy capture" (market verdict) from "the capture never returned data"
 * (instrument failure) — the brief grader maps the latter to data_gap, not
 * htf_unclear. Falls back to engine presence for bundles captured before
 * capture_health existed.
 */
function dataStatusFor(symBundle, tf) {
  const entry = symBundle?.capture_health?.by_tf?.[tf];
  if (entry?.status === 'fallback') {
    return { data_status: 'fallback', baseline_age_seconds: entry.baseline_age_seconds ?? null };
  }
  if (entry?.status) return { data_status: entry.status === 'fresh' ? 'fresh' : 'missing' };
  return { data_status: symBundle?.engine_by_tf?.[tf] ? 'fresh' : 'missing' };
}

function htfBlockForSymbol(symBundle) {
  const out = {};
  for (const tf of HTF_TFS) {
    const bars = symBundle?.bars_by_tf?.[tf] || {};
    const engineTf = symBundle?.engine_by_tf?.[tf] || {};
    const rankedFvgs = rankFvgs(engineTf.fvgs).slice(0, TOP_N);
    const rankedBprs = rankBprs(engineTf.bprs).slice(0, TOP_N);
    const recent = recentStructures(engineTf.structures, 2);
    out[tf] = {
      change_pct: bars.change_pct ?? null,
      range: bars.range ?? null,
      ...dataStatusFor(symBundle, tf),
      top_fvgs: rankedFvgs.map((f) => {
        const idx = (engineTf.fvgs || []).indexOf(f);
        return { ...f, cite: `engine_by_tf.${tf}.fvgs[${idx}]` };
      }),
      top_bprs: rankedBprs.map((b) => {
        const idx = (engineTf.bprs || []).indexOf(b);
        return { ...b, cite: `engine_by_tf.${tf}.bprs[${idx}]` };
      }),
      recent_structures: recent.map((s) => {
        const idx = (engineTf.structures || []).indexOf(s);
        return { ...s, cite: `engine_by_tf.${tf}.structures[${idx}]` };
      }),
      quality: engineTf.quality
        ? { ...engineTf.quality, cite: `engine_by_tf.${tf}.quality` }
        : null,
    };
  }
  return out;
}

function pillar1ForSymbol(symBundle) {
  const p1 = symBundle?.gates?.engine?.pillar1 || {};
  return {
    session_levels: p1.session_levels || {},
    sweeps: p1.sweeps || [],
    // Stage C Pillar-1 bias (HTF array vote + overnight vote + draw) — the brief
    // reads this and adds the open-reaction + combine. See cli/lib/pillar1-bias.js.
    bias: p1.bias || null,
    // Engine-partitioned untaken session draws, already split by side of price
    // and sorted nearest-first (compute-engine-gates). The brief's
    // overnight_block reads these so sell-side session lows (LO.L, AS.L) reach
    // the TP1 pool — previously the brief sliced `levels` by array position and
    // dropped them (2026-06-14 finding).
    untaken_sell_side_below: (p1.untaken_sell_side_below || []).slice(0, TOP_N),
    untaken_buy_side_above: (p1.untaken_buy_side_above || []).slice(0, TOP_N),
    untaken_pools_above: (p1.untaken_pools_above || []).slice(0, TOP_N),
    untaken_pools_below: (p1.untaken_pools_below || []).slice(0, TOP_N),
  };
}

function pillar2ForSymbol(symBundle) {
  const p2 = symBundle?.gates?.engine?.pillar2 || {};
  return {
    current_tf: p2.current_tf || null,
    m5: p2.m5 || null,
    m15: p2.m15 || null,
  };
}

function ltfContextForSymbol(symBundle) {
  const pc = symBundle?.gates?.engine?.price_context || {};
  const p3 = symBundle?.gates?.engine?.pillar3 || {};
  return {
    inside_fvgs: pc.inside_fvgs || [],
    inside_bprs: pc.inside_bprs || [],
    nearest_opposing_fvg_above: pc.nearest_opposing_fvg_above ?? null,
    nearest_opposing_fvg_below: pc.nearest_opposing_fvg_below ?? null,
    most_recent_structure: p3.most_recent_structure ?? null,
  };
}

/** Bare ticker from a fully-qualified chart symbol ("CME_MINI:MNQ1!" → "MNQ1!"). */
function bareSymbol(bundle) {
  const raw = bundle?.chart?.symbol || bundle?.quote?.symbol || '';
  return String(raw).replace(/^[A-Z_]+:/, '').trim() || null;
}

function digestSection(symBundle) {
  return {
    htf: htfBlockForSymbol(symBundle),
    pillar1: pillar1ForSymbol(symBundle),
    pillar2: pillar2ForSymbol(symBundle),
    ltf_context: ltfContextForSymbol(symBundle),
  };
}

/**
 * buildBriefDigest(bundle) → digest | null
 *
 * Paired bundle → one section per symbol. Single-symbol full capture → a
 * one-symbol digest keyed by the chart's bare symbol.
 *
 * The single-symbol path closes a 2026-06-15 gap: once the leader is decided,
 * `tv analyze --pair` short-circuits to a leader-only capture (no `pair`
 * block) to save the dual-capture cost. The direct session brief still needs
 * `brief_digest.symbols` to rebuild, so without a single-symbol digest any
 * brief refresh after the leader decision threw
 * "requires bundle.brief_digest.symbols". Returns null only when the bundle
 * has neither a pair block nor a usable single-symbol capture (no resolvable
 * symbol or no `engine_by_tf` — e.g. an empty or polling-mode bundle).
 */
export function buildBriefDigest(bundle) {
  const pair = bundle?.pair;
  if (pair?.symbols) {
    const symbols = {};
    for (const sym of Object.keys(pair.symbols)) {
      symbols[sym] = digestSection(pair.symbols[sym]);
    }
    return {
      symbols,
      leader_evidence: pair.leader_evidence || {},
    };
  }
  const sym = bareSymbol(bundle);
  if (!sym || !bundle?.engine_by_tf) return null;
  return {
    symbols: { [sym]: digestSection(bundle) },
    leader_evidence: {},
  };
}
