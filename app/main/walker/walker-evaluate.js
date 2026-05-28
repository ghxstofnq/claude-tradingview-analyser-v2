// Stage advance + kill evaluators. Pure functions.
// Spec: docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md

const TICK_SIZE = 0.25;                 // MNQ / MES — same tick
const CHOP_TIMEOUT_MS = 15 * 60_000;
const NEWS_WINDOW_MS = 15 * 60_000;
const BODY_RATIO_MIN = 0.6;

function roundTick(v) { return Math.round(v / TICK_SIZE) * TICK_SIZE; }

// Upgrade 6: hypothetical R-to-stop + R-to-TP1, computed every tick for
// retrace/intermediate walkers. Helps the trader see what's at stake.
function computeHypotheticalR(walker, lastClose) {
  if (lastClose == null) return { hypothetical_r_to_stop: null, hypothetical_r_to_tp1: null };
  // Use swept_pool for MSS, displacement FVG opposite edge for Trend/Inversion.
  const stop = walker.swept_pool
    ? (walker.side === 'long' ? walker.swept_pool.level - TICK_SIZE : walker.swept_pool.level + TICK_SIZE)
    : (walker.side === 'long' ? walker.displacement_fvg.low - TICK_SIZE : walker.displacement_fvg.high + TICK_SIZE);
  const risk = Math.abs(lastClose - stop);
  if (risk <= 0) return { hypothetical_r_to_stop: null, hypothetical_r_to_tp1: null };
  const tp1Target = walker.side === 'long'
    ? walker.displacement_fvg.high + risk * 0.5
    : walker.displacement_fvg.low - risk * 0.5;
  return {
    hypothetical_r_to_stop: Number((risk / TICK_SIZE / 4).toFixed(2)),  // points / 4 ticks/pt = R in points
    hypothetical_r_to_tp1: Number((Math.abs(tp1Target - lastClose) / risk).toFixed(2)),
  };
}

// Upgrade 2 + 3: clean candle + volume_acceptable + multi-TF coherence checks
// applied on confirmation transitions. Returns true when all gates pass.
function confirmationGatesPass(walker, gates, lastBar) {
  const cleanBody = (lastBar?.body_ratio ?? 0) >= BODY_RATIO_MIN;
  const cleanCandle = gates?.engine?.pillar2?.current_tf?.candle === 'clean';
  const volumeOK = gates?.engine?.confirmation?.last_bar?.volume_acceptable === true;
  const m5Opposing = (gates?.engine_by_tf?.m5?.structure_events ?? []).some(
    (s) => s.event === 'MSS' && s.dir !== (walker.side === 'long' ? 'up' : 'down')
  );
  return cleanBody && cleanCandle && volumeOK && !m5Opposing;
}

export function evaluateAdvance(walker, gates, bars) {
  switch (walker.model) {
    case 'MSS': return advanceMss(walker, gates, bars);
    case 'TREND': return advanceTrend(walker, gates, bars);
    case 'INVERSION': return advanceInversion(walker, gates, bars);
    default: return { stage: walker.stage };
  }
}

function advanceMss(walker, gates, bars) {
  const m1 = bars?.m1 ?? [];
  const last = m1[m1.length - 1];
  if (!last) return { stage: walker.stage };

  if (walker.stage === 'displacement_done' || walker.stage === 'displacement_done_5m') {
    const wickedIn = walker.side === 'long'
      ? last.low <= walker.displacement_fvg.high && last.low >= walker.displacement_fvg.low
      : last.high >= walker.displacement_fvg.low && last.high <= walker.displacement_fvg.high;
    if (wickedIn) return { stage: 'retrace_pending' };
    return { stage: walker.stage };
  }

  if (walker.stage === 'retrace_pending') {
    const correctDir = walker.side === 'long'
      ? last.close > walker.displacement_fvg.ce
      : last.close < walker.displacement_fvg.ce;
    if (correctDir && confirmationGatesPass(walker, gates, last)) return { stage: 'confirmation' };
    const hyp = computeHypotheticalR(walker, last.close);
    return { stage: walker.stage, ...hyp };
  }

  if (walker.stage === 'confirmation') {
    const entry = last.close;
    const stop = walker.side === 'long'
      ? walker.swept_pool.level - TICK_SIZE
      : walker.swept_pool.level + TICK_SIZE;
    const risk = Math.abs(entry - stop);
    const tp1 = walker.side === 'long' ? entry + risk * 1.5 : entry - risk * 1.5;
    const tp2 = walker.side === 'long' ? entry + risk * 3.0 : entry - risk * 3.0;
    return {
      stage: 'trigger',
      setup: {
        model: 'MSS', side: walker.side, entry, stop,
        tp1: roundTick(tp1), tp2: roundTick(tp2),
        size_multiplier: walker.size_multiplier ?? 1.0,
        grade: 'A+',
      },
    };
  }
  return { stage: walker.stage };
}

function advanceTrend(walker, gates, bars) {
  const m5 = bars?.m5 ?? [];
  const last = m5[m5.length - 1];
  if (!last) return { stage: walker.stage };

  if (walker.stage === 'impulse_done') {
    const wickedIn = walker.side === 'long'
      ? last.low <= walker.displacement_fvg.high && last.low >= walker.displacement_fvg.low
      : last.high >= walker.displacement_fvg.low && last.high <= walker.displacement_fvg.high;
    if (wickedIn) return { stage: 'retrace_pending' };
    return { stage: walker.stage };
  }

  if (walker.stage === 'retrace_pending') {
    const correctDir = walker.side === 'long'
      ? last.close > walker.displacement_fvg.ce
      : last.close < walker.displacement_fvg.ce;
    if (correctDir && confirmationGatesPass(walker, gates, last)) return { stage: 'confirmation' };
    const hyp = computeHypotheticalR(walker, last.close);
    return { stage: walker.stage, ...hyp };
  }

  if (walker.stage === 'confirmation') {
    const entry = last.close;
    const stop = walker.side === 'long'
      ? walker.displacement_fvg.low - TICK_SIZE
      : walker.displacement_fvg.high + TICK_SIZE;
    const risk = Math.abs(entry - stop);
    const tp1 = walker.side === 'long' ? entry + risk * 1.5 : entry - risk * 1.5;
    const tp2 = walker.side === 'long' ? entry + risk * 3.0 : entry - risk * 3.0;
    return {
      stage: 'trigger',
      setup: {
        model: 'TREND', side: walker.side, entry, stop,
        tp1: roundTick(tp1), tp2: roundTick(tp2),
        size_multiplier: walker.size_multiplier ?? 1.0,
        grade: 'A+',
      },
    };
  }
  return { stage: walker.stage };
}

function advanceInversion(walker, gates, bars) {
  const m1 = bars?.m1 ?? [];
  const last = m1[m1.length - 1];
  if (!last) return { stage: walker.stage };

  if (walker.stage === 'spawn') {
    const closedThrough = walker.side === 'long'
      ? last.close > walker.displacement_fvg.high
      : last.close < walker.displacement_fvg.low;
    if (closedThrough) return { stage: 'inversion_violation' };
    return { stage: walker.stage };
  }

  if (walker.stage === 'inversion_violation') {
    if (walker.variant === 'patient') {
      // Patient: wait for retrace into iFVG before confirming.
      const wickedIn = walker.side === 'long'
        ? last.low <= walker.displacement_fvg.high && last.low >= walker.displacement_fvg.low
        : last.high >= walker.displacement_fvg.low && last.high <= walker.displacement_fvg.high;
      if (wickedIn) return { stage: 'retrace_pending' };
      return { stage: walker.stage };
    }
    // Aggressive: confirm immediately on next clean close past the violated FVG.
    const correctDir = walker.side === 'long'
      ? last.close > walker.displacement_fvg.high
      : last.close < walker.displacement_fvg.low;
    if (correctDir && confirmationGatesPass(walker, gates, last)) return { stage: 'confirmation' };
    return { stage: walker.stage };
  }

  if (walker.stage === 'retrace_pending') {
    // Only reachable for patient variant. Wait for clean close back in direction.
    const correctDir = walker.side === 'long'
      ? last.close > walker.displacement_fvg.high
      : last.close < walker.displacement_fvg.low;
    if (correctDir && confirmationGatesPass(walker, gates, last)) return { stage: 'confirmation' };
    const hyp = computeHypotheticalR(walker, last.close);
    return { stage: walker.stage, ...hyp };
  }

  if (walker.stage === 'confirmation') {
    const entry = last.close;
    const stop = walker.side === 'long'
      ? walker.displacement_fvg.low - TICK_SIZE
      : walker.displacement_fvg.high + TICK_SIZE;
    const risk = Math.abs(entry - stop);
    const tp1 = walker.side === 'long' ? entry + risk * 1.5 : entry - risk * 1.5;
    const tp2 = walker.side === 'long' ? entry + risk * 3.0 : entry - risk * 3.0;
    return {
      stage: 'trigger',
      setup: {
        model: 'INVERSION', side: walker.side, entry, stop,
        tp1: roundTick(tp1), tp2: roundTick(tp2),
        size_multiplier: walker.size_multiplier ?? 1.0,
        grade: 'A+',
      },
    };
  }
  return { stage: walker.stage };
}

export function evaluateKill(walker, gates, bars) {
  // Upgrade 1: news-aware kill — any retrace_pending walker dies in ±15 min
  // of a high-impact event.
  if (walker.stage === 'retrace_pending') {
    const events = gates?.calendar?.events ?? [];
    const now = Date.now();
    if (events.some((e) => e?.impact === 'high' && Math.abs(now - e.ts) <= NEWS_WINDOW_MS)) {
      return { kill: true, reason: 'news_window' };
    }
  }

  // Chop timeout — no advance in 15 min while in a pending stage.
  if (['retrace_pending', 'inversion_violation', 'displacement_done', 'displacement_done_5m', 'impulse_done'].includes(walker.stage)) {
    if (walker.last_advanced_at && Date.now() - walker.last_advanced_at > CHOP_TIMEOUT_MS) {
      return { kill: true, reason: 'chop_timeout' };
    }
  }

  // Structure break — for MSS waiting on retrace, a new same-side extreme
  // beyond the swept pool invalidates.
  if (walker.model === 'MSS' && walker.swept_pool && bars?.m1) {
    const last = bars.m1[bars.m1.length - 1];
    if (last) {
      if (walker.side === 'long' && last.low < walker.swept_pool.level) return { kill: true, reason: 'structure_break' };
      if (walker.side === 'short' && last.high > walker.swept_pool.level) return { kill: true, reason: 'structure_break' };
    }
  }

  return { kill: false };
}
