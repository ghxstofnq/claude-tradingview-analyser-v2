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

/** Rank FVGs by (state=fresh DESC, took_liq DESC, disp_score DESC). */
function rankFvgs(fvgs) {
  const score = (f) => {
    const freshBit = f.state === 'fresh' ? 2 : (f.state === 'ce_tapped' || f.state === 'inverted' ? 1 : 0);
    const liqBit = f.took_liq ? 1 : 0;
    return freshBit * 100 + liqBit * 10 + (typeof f.disp_score === 'number' ? f.disp_score : 0);
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

/**
 * buildBriefDigest(bundle) → digest | null
 *
 * Returns null when there is no `pair` block (single-symbol bundles don't
 * need a digest — the model reads top-level fields directly).
 */
export function buildBriefDigest(bundle) {
  const pair = bundle?.pair;
  if (!pair?.symbols) return null;
  const symbols = {};
  for (const sym of Object.keys(pair.symbols)) {
    const sb = pair.symbols[sym];
    symbols[sym] = {
      htf: htfBlockForSymbol(sb),
      pillar1: pillar1ForSymbol(sb),
      pillar2: pillar2ForSymbol(sb),
      ltf_context: ltfContextForSymbol(sb),
    };
  }
  return {
    symbols,
    leader_evidence: pair.leader_evidence || {},
  };
}
