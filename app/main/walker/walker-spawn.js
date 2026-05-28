// Spawn detection — pure. Decides whether a new walker should be created
// this tick based on engine gates + bars + prior walker state.
// Spec: docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md

const SWEEP_RECENCY_MS = 10 * 60_000; // 10 minutes
const NEWS_WINDOW_MS = 15 * 60_000;   // ±15 min around high-impact events

let _idSeq = 0;
function nextId() { return `w_${Date.now()}_${(_idSeq++).toString(36)}`; }
function sessionPrefix() { return 'am'; }   // detector will pass session via gates context in Task 21

function inNewsWindow(calendar) {
  const now = Date.now();
  return (calendar?.events ?? []).some((e) => e?.impact === 'high' && Math.abs(now - e.ts) <= NEWS_WINDOW_MS);
}

function vetoedByMemory(memory, model, side, swept_pool_name) {
  const lines = memory?.walkerSkipLines ?? [];
  for (const line of lines) {
    const m = String(line).match(/walker-skip:\s*(\w+)\s+(\w+)\s+(.+)/i);
    if (!m) continue;
    const [_, lModel, lSide, lCondition] = m;
    if (lModel.toUpperCase() === model.toUpperCase() && lSide.toLowerCase() === side.toLowerCase()) {
      if (swept_pool_name && lCondition.trim() === swept_pool_name) return true;
      if (lCondition.trim() === '*') return true;
    }
  }
  return false;
}

function suppressedByCorrelation(suppression, side) {
  return suppression?.activeTradeSide && suppression.activeTradeSide === side;
}

export function detectIgnitions({ gates, bars, prev, calendar, memory, suppression }) {
  // Upgrade 1: news-aware pause — skip all spawn during ±15 min red events.
  if (inNewsWindow(calendar)) return [];
  const out = [];
  out.push(...spawnMssStandard({ gates, prev, memory, suppression }));
  out.push(...spawnMssSweepInto5m({ gates, prev, memory, suppression }));
  out.push(...spawnTrendStandard({ gates, prev, memory, suppression }));
  out.push(...spawnInversion({ gates, prev, memory, suppression }));
  return out;
}

function spawnMssStandard({ gates, prev, memory, suppression }) {
  const sweeps = gates?.engine?.pillar1?.sweeps ?? [];
  const swings = gates?.engine?.pillar3?.failure_swings ?? [];
  const now = Date.now();
  const out = [];
  for (const sw of sweeps) {
    if (!sw?.swept_at_ms || now - sw.swept_at_ms > SWEEP_RECENCY_MS) continue;
    if (prev?.walkers?.some((w) =>
      w.model === 'MSS' && w.variant === 'standard' &&
      w.swept_pool?.name === sw.name && w.swept_pool?.level === sw.level)) continue;
    const swingDir = sw.dir === 'down' ? 'up' : 'down';
    const match = swings.find((s) =>
      s.event === 'MSS' && s.dir === swingDir && s.displacement === true && s.new_fvg);
    if (!match) continue;
    const side = swingDir === 'up' ? 'long' : 'short';
    if (vetoedByMemory(memory, 'MSS', side, sw.name)) continue;
    if (suppressedByCorrelation(suppression, side)) continue;
    out.push({
      id: nextId(),
      panel_id: `${sessionPrefix()}_${side}_MSS`,
      model: 'MSS',
      variant: 'standard',
      side,
      stage: 'displacement_done',
      swept_pool: { name: sw.name, level: sw.level },
      displacement_fvg: { high: match.new_fvg.high, low: match.new_fvg.low, ce: match.new_fvg.ce },
      retrace_zone: { high: match.new_fvg.high, low: match.new_fvg.ce },
      entry: null, stop: null, tp1: null, tp2: null,
      size_multiplier: 1.0, size_reason: 'default',
      hypothetical_r_to_stop: null, hypothetical_r_to_tp1: null,
      created_at: now, last_advanced_at: now, last_evaluated_at: now,
    });
  }
  return out;
}

function spawnMssSweepInto5m({ gates, prev, memory, suppression }) {
  const sweeps = gates?.engine?.pillar1?.sweeps ?? [];
  const m5Fvgs = gates?.engine_by_tf?.m5?.fvgs ?? [];
  const now = Date.now();
  const out = [];
  for (const sw of sweeps) {
    if (!sw?.swept_at_ms || now - sw.swept_at_ms > SWEEP_RECENCY_MS) continue;
    const fvgDir = sw.dir === 'down' ? 'up' : 'down';
    const fvg = m5Fvgs.find((f) => f.state === 'fresh' && f.dir === fvgDir && f.ts_ms >= sw.swept_at_ms);
    if (!fvg) continue;
    if (prev?.walkers?.some((w) =>
      w.model === 'MSS' && w.variant === 'sweep_into_5m' &&
      w.swept_pool?.name === sw.name && w.swept_pool?.level === sw.level)) continue;
    const side = fvgDir === 'up' ? 'long' : 'short';
    if (vetoedByMemory(memory, 'MSS', side, sw.name)) continue;
    if (suppressedByCorrelation(suppression, side)) continue;
    out.push({
      id: nextId(),
      panel_id: `${sessionPrefix()}_${side}_MSS`,
      model: 'MSS',
      variant: 'sweep_into_5m',
      side,
      stage: 'displacement_done_5m',
      swept_pool: { name: sw.name, level: sw.level },
      displacement_fvg: { high: fvg.high, low: fvg.low, ce: fvg.ce },
      retrace_zone: { high: fvg.high, low: fvg.ce },
      entry: null, stop: null, tp1: null, tp2: null,
      size_multiplier: 1.0, size_reason: 'default',
      hypothetical_r_to_stop: null, hypothetical_r_to_tp1: null,
      created_at: now, last_advanced_at: now, last_evaluated_at: now,
    });
  }
  return out;
}

function spawnTrendStandard({ gates, prev, memory, suppression }) {
  const fvgs = gates?.engine?.pillar3?.fvgs ?? [];
  const structures = gates?.engine?.pillar3?.structure_events ?? [];
  const bias = gates?.htf_bias;
  if (bias !== 'bullish' && bias !== 'bearish') return [];
  const dir = bias === 'bullish' ? 'up' : 'down';
  const now = Date.now();
  const out = [];
  const bos = structures.find((s) => s.event === 'BoS' && s.dir === dir && s.displacement === true);
  if (!bos) return [];
  // Trend forbids iFVG zones — they're an Inversion-family setup. Reject any
  // fresh FVG whose kind === 'iFVG'.
  const fvg = fvgs.find((f) => f.state === 'fresh' && f.dir === dir && f.kind !== 'iFVG');
  if (!fvg) return [];
  if (prev?.walkers?.some((w) => w.model === 'TREND' &&
      w.displacement_fvg?.high === fvg.high && w.displacement_fvg?.low === fvg.low)) return [];
  const side = dir === 'up' ? 'long' : 'short';
  if (vetoedByMemory(memory, 'TREND', side, null)) return [];
  if (suppressedByCorrelation(suppression, side)) return [];
  out.push({
    id: nextId(),
    panel_id: `${sessionPrefix()}_${side}_TREND`,
    model: 'TREND',
    variant: 'standard',
    side,
    stage: 'impulse_done',
    swept_pool: null,
    displacement_fvg: { high: fvg.high, low: fvg.low, ce: fvg.ce },
    retrace_zone: { high: fvg.high, low: fvg.ce },
    entry: null, stop: null, tp1: null, tp2: null,
    size_multiplier: 1.0, size_reason: 'default',
    hypothetical_r_to_stop: null, hypothetical_r_to_tp1: null,
    created_at: now, last_advanced_at: now, last_evaluated_at: now,
  });
  return out;
}

function spawnInversion({ gates, prev, memory, suppression }) {
  const fvgs = gates?.engine?.pillar3?.fvgs ?? [];
  const bias = gates?.htf_bias;
  if (bias !== 'bullish' && bias !== 'bearish') return [];
  const ourDir = bias === 'bullish' ? 'up' : 'down';
  const oppDir = bias === 'bullish' ? 'down' : 'up';
  const opp = fvgs.find((f) => f.state === 'fresh' && f.dir === oppDir);
  if (!opp) return [];
  if (prev?.walkers?.some((w) => w.model === 'INVERSION' &&
      w.displacement_fvg?.high === opp.high && w.displacement_fvg?.low === opp.low)) return [];
  const side = ourDir === 'up' ? 'long' : 'short';
  if (vetoedByMemory(memory, 'INVERSION', side, null)) return [];
  if (suppressedByCorrelation(suppression, side)) return [];
  const now = Date.now();
  return [{
    id: nextId(),
    panel_id: `${sessionPrefix()}_${side}_INVERSION`,
    model: 'INVERSION',
    variant: 'aggressive',  // patient promoted by evaluate phase if retrace is observed
    side,
    stage: 'spawn',
    swept_pool: null,
    displacement_fvg: { high: opp.high, low: opp.low, ce: opp.ce },
    retrace_zone: { high: opp.high, low: opp.ce },
    entry: null, stop: null, tp1: null, tp2: null,
    size_multiplier: 1.0, size_reason: 'default',
    hypothetical_r_to_stop: null, hypothetical_r_to_tp1: null,
    created_at: now, last_advanced_at: now, last_evaluated_at: now,
  }];
}
