/**
 * pillar1-bias.js — Pillar 1 (Draw & Bias), Stage C of the faithful-Lanto rebuild.
 *
 * Faithful to docs/strategy/daily-bias.md and the oracle (docs/strategy/lanto-oracle.md).
 * Single-sourced for gates.engine.pillar1.bias + the brief, mirroring Stage B's
 * cli/lib/pillar2-verdict.js. Pure — no CDP, no I/O.
 *
 * Bias is THREE votes (daily-bias §1): HTF + overnight + NY-open reaction.
 * Count aligned votes → 1/3 no-trade · 2/3 B-cap · 3/3 A+-eligible.
 *
 * --- Slice 1: the HTF vote (daily-bias §2) ---
 * Corrected per the [[engine-htf-overread]] finding: the HTF directional vote is
 * the REACTION off a SIGNIFICANT near-price PD ARRAY (displacive + took-liq
 * FVG/iFVG), NOT structure (MSS/BoS) and NOT the liquidity draw. Liquidity
 * (buy/sell side) is the TARGET/draw, never the vote (BIAS 09:21).
 *
 * Vote by the engine FVG `state`:
 *   - fresh / ce_tapped (respected)            → the array's OWN direction
 *   - inverted WITH displacement (ds ≥ cut)    → FLIPPED (the array failed)
 *   - filled / invalidated / inverted-no-disp  → NO vote
 * Significance gate (in pickPrimaryDraw): took_liq AND near price. Per the
 * D1/D4 floor, a tiny-but-fresh, took-liq, near-price array DOES vote — so
 * size/disp is NOT a hard floor; only the inversion needs displacement.
 */

// An inverted array votes only if the inversion itself displaced. Calibrated on
// the two oracle points: 06-16 daily inverted-bull ds 0.06 = NO vote vs 06-17
// daily inverted-bull ds 0.84 = a bear vote. Cutoff anywhere in (0.06, 0.84);
// 0.5 is the conservative midpoint. Tune at Stage G with more graded days.
export const INVERSION_DISP_MIN = 0.5;

// "Near price" = a realistic intraday destination today (daily-bias §2). Scale-
// free as a fraction of price so it works on MNQ and MES alike (Stage B lesson:
// express scale-free where possible). 0.3% ≈ 90pt at 30000. Calibrated: 06-16's
// only fresh bull array was 141pt ≈ 0.47% away = too far (correctly excluded);
// D4's voting array was 21.75pt ≈ 0.08% = near. Tune at Stage G.
export const NEAR_PRICE_PCT = 0.003;

// §2.1: "Primary charts: Daily and 4H (sometimes 1H)" + "prefers 4H PD arrays" —
// 4H first, then Daily, then 1H.
const TF_PRIORITY = ['h4', 'daily', 'h1'];

const asDir = (d) => (/^bull/i.test(d || '') ? 'bull' : /^bear/i.test(d || '') ? 'bear' : null);
const biasWord = (d) => (d === 'bull' ? 'bullish' : d === 'bear' ? 'bearish' : 'none');
const opposite = (d) => (d === 'bull' ? 'bear' : d === 'bear' ? 'bull' : null);

/**
 * A PD array's directional vote (daily-bias §2; engine-htf-overread calibration).
 * Pure read of the array's direction + lifecycle state — significance (took_liq,
 * near-price) is gated separately in pickPrimaryDraw.
 *
 * @param {object} zone parsed engine FVG/BPR: { dir, kind, state, disp_score }
 * @returns {{vote:'bullish'|'bearish'|'none', reason:string}}
 */
export function arrayVote(zone) {
  const dir = asDir(zone?.dir);
  if (!dir) return { vote: 'none', reason: 'no-direction' };
  const state = String(zone?.state || 'fresh');
  if (state === 'fresh' || state === 'ce_tapped') {
    return { vote: biasWord(dir), reason: `${state}-respected` };
  }
  if (state === 'inverted') {
    const ds = Number(zone?.disp_score);
    if (Number.isFinite(ds) && ds >= INVERSION_DISP_MIN) {
      return { vote: biasWord(opposite(dir)), reason: `inverted-displaced(${ds})` };
    }
    return { vote: 'none', reason: `inverted-no-displacement(${zone?.disp_score ?? 'na'})` };
  }
  return { vote: 'none', reason: `${state}-no-vote` };
}

/** |ce - price| / |price| ≤ NEAR_PRICE_PCT — a realistic destination today. */
function nearPrice(ce, price) {
  if (!Number.isFinite(ce) || !Number.isFinite(price) || price === 0) return false;
  return Math.abs(ce - price) / Math.abs(price) <= NEAR_PRICE_PCT;
}

/**
 * Pick the ONE significant near-price PD array that sets HTF bias (daily-bias
 * §2: "pick one primary draw … read the reaction off it"). Walks TFs 4H→Daily→1H;
 * within a TF keeps only arrays that (a) cast a directional vote, (b) took
 * liquidity in creation, (c) sit near price; picks the nearest. Returns null when
 * no significant near-price array exists (→ no HTF vote, e.g. 12-12 "no HTF").
 *
 * @param {object} htfByTf digest-shaped { daily, h4, h1 } each { top_fvgs[], top_bprs[] }
 * @param {{price:number|null}} opts current price for near-ness + distance
 */
export function pickPrimaryDraw(htfByTf, { price = null } = {}) {
  for (const tf of TF_PRIORITY) {
    const block = htfByTf?.[tf] ?? {};
    const zones = [...(block.top_fvgs ?? []), ...(block.top_bprs ?? [])];
    const qualifying = zones
      .map((z) => {
        const ce = Number.isFinite(z?.ce) ? z.ce : (Number(z?.top) + Number(z?.bottom)) / 2;
        const v = arrayVote(z);
        return { z, ce, vote: v.vote, voteReason: v.reason };
      })
      .filter((c) => c.vote !== 'none' && c.z?.took_liq === true && nearPrice(c.ce, price))
      .sort((a, b) => Math.abs(a.ce - price) - Math.abs(b.ce - price));
    if (qualifying.length) {
      const { z, ce, vote, voteReason } = qualifying[0];
      return {
        tf,
        kind: /ifvg|inv/i.test(z.kind || '') || z.state === 'inverted' ? 'ifvg' : z.kind || 'fvg',
        dir: asDir(z.dir),
        top: z.top,
        bottom: z.bottom,
        ce,
        disp_score: Number.isFinite(z.disp_score) ? z.disp_score : 0,
        size_quality: z.size_quality ?? null,
        took_liq: true,
        state: z.state || 'fresh',
        distance_to_ce: Number.isFinite(price) ? price - ce : null,
        near: true,
        significant: true,
        vote,
        vote_reason: voteReason,
        cite: z.cite ?? null,
      };
    }
  }
  return null;
}

/**
 * The HTF directional vote (daily-bias §2). The vote of the single significant
 * near-price array; 'none' when no such array exists (no HTF read → the day can
 * still be 2/3 on overnight + open-reaction alone).
 *
 * @returns {{vote:'bullish'|'bearish'|'none', significant:boolean, draw:object|null, reason:string}}
 */
export function htfVote(htfByTf, { price = null } = {}) {
  const draw = pickPrimaryDraw(htfByTf, { price });
  if (!draw) return { vote: 'none', significant: false, draw: null, reason: 'no-significant-near-price-array' };
  return { vote: draw.vote, significant: true, draw, reason: draw.vote_reason };
}
