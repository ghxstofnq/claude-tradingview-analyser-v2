/**
 * pillar1-bias.js — Pillar 1 (Draw & Bias), Stage C of the faithful-Lanto rebuild.
 *
 * Faithful to docs/strategy/daily-bias.md and the oracle (docs/strategy/lanto-oracle.md).
 * Single-sourced for gates.engine.pillar1.bias + the brief, mirroring Stage B's
 * cli/lib/pillar2-verdict.js. Pure — no CDP, no I/O.
 */

import { overnightTargetsForSession } from './open-reaction-resolver.js';

/*
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

// Significance gate (Q1, transcript-grounded): a gap earns the HTF vote only
// when it is DISPLACIVE — "a large body, minimal wickage… the bigger the body,
// the bigger the inefficiency" (ENTRY 05:38); among candidates take "which gap
// clearly shows the BEST displacement… block out the noise" (ENTRY 06:35). A
// small, low-displacement gap is "nothing crazy" → no HTF vote, the day is 2/3
// (BIAS 27:42). Disp-based, NOT a raw size veto ("it doesn't have to be entirely
// large", ENTRY 05:38) — calibrated so 06-16's ds 0.74 array still counts (you
// traded it). Tune with the Discord calls.
export const SIG_DISP_MIN = 0.5;

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
  if (!Number.isFinite(ce)) return false;
  if (!Number.isFinite(price) || price === 0) return true; // no price → can't assess nearness, don't filter
  return Math.abs(ce - price) / Math.abs(price) <= NEAR_PRICE_PCT;
}

/** Significant = a real displacive/large gap, not "nothing crazy" noise (Q1). */
function isSignificant(zone) {
  const sq = String(zone?.size_quality || '');
  const ds = Number(zone?.disp_score);
  // Neither size nor displacement known → don't penalize (real engine emits both).
  if (sq === '' && !Number.isFinite(ds)) return true;
  return sq === 'large' || sq === 'normal' || (Number.isFinite(ds) && ds >= SIG_DISP_MIN);
}
/** Rank: best displacement first ("the clearest gap"), size as the tiebreak. */
function sigScore(zone) {
  const sizeBoost = zone?.size_quality === 'large' ? 1 : zone?.size_quality === 'tiny' ? 0 : 0.5;
  const ds = Number(zone?.disp_score);
  return (Number.isFinite(ds) ? ds : 0) + sizeBoost;
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
      .filter((c) => c.vote !== 'none' && c.z?.took_liq === true && nearPrice(c.ce, price) && isSignificant(c.z))
      // best displacement first ("block out the noise"); nearest as the tiebreak.
      .sort((a, b) => sigScore(b.z) - sigScore(a.z) || Math.abs(a.ce - price) - Math.abs(b.ce - price));
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
        // zone above/below current price — for the legacy biasFromDraw fallback
        // (live-ltf-resolver) when htf_bias_dir is absent.
        position: Number.isFinite(price) ? (ce > price ? 'above_price' : 'below_price') : null,
        // observed-reaction passthrough (engine FVG fields) — the vote reads
        // state, but downstream biasFromDraw + PREP still read these.
        reacted: !!z.reacted,
        ...(z.reaction_dir ? { reaction_dir: z.reaction_dir } : {}),
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

// --- Slice 2: the overnight vote (daily-bias §3) ---

/**
 * Overnight directional vote (daily-bias §3). Reads the engine's overnight_dir
 * (Asia+London net move vs overnight range; the engine flags "chop" when
 * |net| < 0.25× overnight range). bull→bullish, bear→bearish, chop/na→no vote
 * (a non-vote, not a conflict — §1). overnight_net carried through for the
 * combiner's grab-vs-conflict test.
 *
 * @param {object} qualityRow engine quality row: { overnight_dir, overnight_net }
 * @returns {{vote:'bullish'|'bearish'|'none', reason:string, net:number|null}}
 */
export function overnightVote(qualityRow) {
  const d = String(qualityRow?.overnight_dir || 'na').toLowerCase();
  const net = Number.isFinite(Number(qualityRow?.overnight_net)) ? Number(qualityRow.overnight_net) : null;
  if (d === 'bull') return { vote: 'bullish', reason: 'overnight-bull', net };
  if (d === 'bear') return { vote: 'bearish', reason: 'overnight-bear', net };
  return { vote: 'none', reason: d === 'chop' ? 'overnight-chop' : 'overnight-na', net };
}

// --- Slice 3: the NY-open reaction (daily-bias §4) ---

const isHighLevel = (name) => /\.H$/.test(String(name || ''));
const inWindow = (ms, { startMs = -Infinity, endMs = Infinity } = {}) =>
  Number.isFinite(ms) && ms >= startMs && ms < endMs;
const dispBreak = (s) => s?.displacement === true || s?.validation === 'break';
const latestBy = (arr, key) => (arr.length ? arr.reduce((a, b) => ((Number(b?.[key]) || 0) >= (Number(a?.[key]) || 0) ? b : a)) : null);
const structBias = (s) => (s?.dir === 'bear' ? 'bearish' : s?.dir === 'bull' ? 'bullish' : null);

// The opening-range grab is the FIRST 30 min after the open (daily-bias §4 /
// BIAS 24:50 "we get the opening range move ~15 min after"); the REACTION can
// confirm later, so the structure horizon runs to the read time.
const GRAB_WINDOW_MS = 30 * 60 * 1000;
// How far back before the open a swing-tier break still counts as the "standing"
// structure the open grab is read against (the leg into the open, BIAS 38:23).
const STANDING_LOOKBACK_MS = 4 * 60 * 60 * 1000;

/**
 * NY-open reaction direction (daily-bias §4). "It's not the initial liquidity we
 * take — it's the reaction" (BIAS 20:33); "wait for later displacement" (38:23);
 * gauge it "through breaking these lower-high sequences" — structure, above the
 * raw grab (BIAS 27:42). Priority:
 *   1. Latest SWING-tier displaced break from the open to the read time — the
 *      reaction Lanto waits for (often after the first 30 min, e.g. 06-09's 10:40
 *      bear MSS). Catches genuine reversals (§5).
 *   2. Else the STANDING swing structure (the leg into the open). A grab OPPOSING
 *      it is a failed break — the grab is the liquidity, the structure the
 *      reaction (06-16: the low-sweep bounce was the grab, the reaction down).
 *   3. Else a post-open INTERNAL-tier displaced break — the LH/HL-sequence break
 *      that sets the open's direction (06-17 the bear MSS that sold the open).
 *   4. Else the raw opening grab (reject/continuation off the overnight sweep).
 *   5. Else no vote (a non-vote, not a conflict).
 *
 * `window` = { startMs: session open, endMs: read time }. Pure.
 */
export function nyOpenReaction({ sweeps = [], structures = [], window = {}, session = 'ny-am' } = {}) {
  const { startMs = -Infinity, endMs = Infinity } = window;
  const targets = overnightTargetsForSession(session);
  const structs = (structures || []).filter((s) => s?.dir === 'bull' || s?.dir === 'bear');
  const mk = (dir, interaction, source, level, tier, displaced) => ({
    vote: dir ?? 'none', direction: dir ?? null, interaction, source, level: level ?? null, tier: tier ?? null, displaced: !!displaced,
  });

  const grab = latestBy(
    (sweeps || []).filter((s) => targets.has(s?.target) && inWindow(s?.swept_ms, { startMs, endMs: startMs + GRAB_WINDOW_MS })),
    'swept_ms',
  );
  const grabDir = grab
    ? (isHighLevel(grab.target) ? (grab.rejected === true ? 'bearish' : 'bullish') : grab.rejected === true ? 'bullish' : 'bearish')
    : null;

  // (1) Post-open swing-tier displacement — the reaction (catches reversals, §5).
  const postOpenSwing = latestBy(
    structs.filter((s) => s.tier === 'swing' && dispBreak(s) && inWindow(s.confirmed_ms, { startMs, endMs })),
    'confirmed_ms',
  );
  if (postOpenSwing) return mk(structBias(postOpenSwing), 'swing_displacement', 'structure', postOpenSwing.level, 'swing', true);

  // (2) Standing swing structure (the leg into the open); a grab opposing it fails.
  const standingSwing = latestBy(
    structs.filter((s) => s.tier === 'swing' && dispBreak(s)
      && Number(s.confirmed_ms) <= endMs && Number(s.confirmed_ms) >= startMs - STANDING_LOOKBACK_MS),
    'confirmed_ms',
  );
  if (standingSwing) {
    const dir = structBias(standingSwing);
    const interaction = grabDir && grabDir !== dir ? 'failed_break' : 'standing_swing';
    return mk(dir, interaction, 'structure', grab?.target ?? standingSwing.level, 'swing', true);
  }

  // (3) Post-open internal-tier displaced break — breaking the LH/HL sequence
  // (BIAS 27:42 "gauge through breaking these lower-high sequences"), above the
  // raw grab.
  const internal = latestBy(
    structs.filter((s) => s.tier === 'internal' && dispBreak(s) && inWindow(s.confirmed_ms, { startMs, endMs })),
    'confirmed_ms',
  );
  if (internal) return mk(structBias(internal), 'internal_break', 'structure', internal.level, 'internal', false);

  // (4) The raw opening grab.
  if (grab) return mk(grabDir, `sweep_${grab.rejected === true ? 'rejection' : 'continuation'}`, 'sweep', grab.target, null, false);

  return mk(null, 'none', null, null, null, false);
}

// --- Slice 4: the nested 3-component grade (daily-bias §1; README grade table) ---

const dirOf = (v) => {
  if (v === 'bullish' || v === 'bearish') return v;
  const d = v?.vote ?? v?.direction;
  return d === 'bullish' || d === 'bearish' ? d : 'none';
};

/** Map the SMT leader's bias_dir (smt-leader.js) to a bias word. */
export const smtBiasOf = (biasDir) =>
  biasDir === 'long' ? 'bullish' : biasDir === 'short' ? 'bearish' : null;

/**
 * Apply the SMT/leading-asset cross-check to a resolved bias (daily-bias §6:
 * "use the leader's displacement to CONFIRM or FLIP the open-reaction read").
 * SMT is NOT a fourth vote (§1 is three components) — it confirms or warns:
 *
 *   - leader agrees with the bias        → annotate `confirms` (or `confirms-flip`
 *                                           on a swing-reversal flip); no change.
 *   - leader OPPOSES the bias            → the D4 10-02 loss (RISK ~30:39: "ES had
 *                                           interest in drawing lower" — the NQ long
 *                                           should have flipped). Lower conviction:
 *                                           cap A+ → B and flag `conflict`.
 *
 * WARNING-ONLY by decision (2026-06-23). The transcript says an opposing leader
 * is a STAND-ASIDE, not a smaller trade — the D4 10-02 loss took a long while ES
 * "had interest in drawing lower" (RISK ~30:39); the faithful behavior (spec §6)
 * is hands-off / follow the leader. But SMT divergence is unproven on this corpus
 * (neutral on the validated week), so an opposing leader is held warning-only
 * (cap A+ -> B + flag `conflict`) and never blocks or flips a trade on its own;
 * no-divergence (smt_bias=null) is a no-op. PROMOTE `conflict` to a hands-off
 * no-trade once SMT proves out on more paired sessions (the Discord calls).
 */
function applySmt(result, smtBias) {
  if (!smtBias) return { ...result, smt: null, smt_bias: null };
  const tradable = result.grade_cap === 'A+' || result.grade_cap === 'B';
  const bias = result.bias;
  if (!tradable || (bias !== 'bullish' && bias !== 'bearish')) {
    return { ...result, smt: null, smt_bias: smtBias };
  }
  if (smtBias === bias) {
    const note = result.reason === 'flip_swing_reversal' ? 'confirms-flip' : 'confirms';
    return { ...result, smt: note, smt_bias: smtBias };
  }
  return {
    ...result,
    smt: 'conflict',
    smt_bias: smtBias,
    a_plus_eligible: false,
    grade_cap: result.grade_cap === 'A+' ? 'B' : result.grade_cap,
  };
}

/**
 * Combine the three components into the draw-bias pillar grade (daily-bias §1, §4,
 * §5). NOT a naive vote count — Lanto's actual mechanism: HTF + overnight set a
 * PRE-OPEN LEAN, then the NY-open reaction CONFIRMS or REVERSES it.
 *
 *   - CONFIRM (open agrees with the lean, or sets it when there's no lean): count
 *     the aligned components → 2/3 B (b_elevatable: Pillar 3 multi-alignment → A+),
 *     3/3 A+-eligible.
 *   - REVERSE (open opposes the lean): flip ONLY on a swing-tier mass-displacement
 *     move (§5 "need more displacement, multiple arrays invalidated") → bias = the
 *     open direction, grade B (a reversal day is lower conviction, §2.4; still
 *     b_elevatable via a multi-alignment entry — D2 06-09). A non-swing reversal is
 *     "timing not there yet" → HANDS-OFF no-trade (§4; 06-17).
 *   - No open reaction yet → unconfirmed; don't trade pre-confirmation (§4).
 *
 * Validated on the engine's at-open arrays: the overnight rallies leave a bull
 * lean on every oracle day; the bearish days turn bearish via the open-reaction
 * swing reversal (D2/06-16), the choppy day hands-off (06-17), the bull days
 * confirm (D1/06-18). pillar2 'poor' caps the grade + demands a clean Pillar-3
 * entry; it never hard-blocks here (Stage B locked decision).
 *
 * @param {object} args htf/overnight/nyopen (directions or vote objects); nyopen
 *   may carry { tier, displaced } so the swing-reversal flip can be detected.
 *   `smt_bias` (optional, 'bullish'|'bearish'|null) is the SMT leader's direction
 *   (smtBiasOf(leader_evidence.bias_dir), §6) — confirms or caps the resolved bias.
 */
export function combineBias({ htf, overnight, nyopen, pillar2 = null, smt_bias = null } = {}) {
  const h = dirOf(htf);
  const o = dirOf(overnight);
  const n = dirOf(nyopen);
  const votes = { htf: h, overnight: o, nyopen: n };
  const openObj = nyopen && typeof nyopen === 'object' ? nyopen : {};
  const openSwing = openObj.tier === 'swing' && openObj.displaced === true; // mass displacement (§5)
  const priceGood = pillar2 === 'good' || pillar2 == null;
  const requires_clean_entry = pillar2 === 'poor';

  // Pre-open lean = HTF + overnight. Both present + agree → that direction; both
  // present + disagree → no clean lean; one present → that one; neither → none.
  let lean = null;
  if (h !== 'none' && o !== 'none') lean = h === o ? h : null;
  else lean = h !== 'none' ? h : o !== 'none' ? o : null;

  const out = (extra) => applySmt({
    bias: null,
    votes,
    lean,
    open: n,
    open_swing: openSwing,
    draw_bias_pillar: 'unclear',
    grade_cap: 'no-trade',
    a_plus_eligible: false,
    b_elevatable: false,
    requires_clean_entry,
    ...extra,
  }, smt_bias);

  // No open reaction yet → the bias is not confirmed (§4 needs the reaction).
  if (n === 'none') {
    if (!lean) return out({ reason: 'no_read', no_trade_reason: 'no_bias' });
    return out({ bias: lean, reason: 'unconfirmed_lean', no_trade_reason: 'open_unconfirmed' });
  }

  // No pre-open lean (no HTF + no overnight) → the open reaction is just ONE
  // component. §1 "one out of three → you do not take a trade" (BIAS 22:25). A
  // reversal not backed by a 2nd component is a lower-timeframe scalp at most
  // (BIAS 25:44) — this pillar does not green-light it on its own, even a
  // swing-tier one. (Open question for the Discord calls: does a strong reversal
  // off a significant grab override "1/3"? Conservative default = stand aside.)
  if (!lean) {
    return out({ bias: n, reason: 'open_only_one_of_three', no_trade_reason: 'one_of_three' });
  }

  // CONFIRM — the open agrees with the lean.
  if (n === lean) {
    const count = (h === lean ? 1 : 0) + (o === lean ? 1 : 0) + 1;
    if (count >= 3) {
      return out({ bias: lean, draw_bias_pillar: 'confirmed-3of3', grade_cap: priceGood ? 'A+' : 'B', a_plus_eligible: priceGood, reason: 'three_of_three' });
    }
    return out({ bias: lean, draw_bias_pillar: 'clear-2of3', grade_cap: 'B', b_elevatable: priceGood, reason: 'two_of_three' });
  }

  // REVERSE — the open opposes the lean. Flip only on mass displacement (§5).
  if (openSwing) {
    return out({ bias: n, draw_bias_pillar: 'clear-2of3', grade_cap: 'B', b_elevatable: priceGood, reason: 'flip_swing_reversal' });
  }
  // Not enough to flip → timing not there yet (§4).
  return out({ bias: lean, reason: 'reversal_hands_off', no_trade_reason: 'conflict_hands_off' });
}
