import { isTradableSourceHealth } from '../context/source-health.js';
import { createWalker, isActiveWalker, sameWalkerKey, WALKER_MODELS, WALKER_SIDES } from './walker-state.js';

function collectGateBlockers(context) {
  const blockers = [];
  if (!isTradableSourceHealth(context?.sourceHealth)) {
    blockers.push(...(Array.isArray(context?.sourceHealth?.blockers) ? context.sourceHealth.blockers : ['source_health_blocked']));
  }
  for (const pillarName of ['pillar1', 'pillar2']) {
    const pillar = context?.[pillarName];
    if (pillar?.status === 'blocked' || pillar?.status === 'fail') {
      blockers.push(...(Array.isArray(pillar.blockers) && pillar.blockers.length ? pillar.blockers : [`${pillarName}_blocked`]));
    }
  }
  if (Array.isArray(context?.blockers)) blockers.push(...context.blockers);
  return [...new Set(blockers)];
}

export function spawnWalker({ context, model, side, pdArray = null, existingWalkers = [] }) {
  const blockers = collectGateBlockers(context);
  if (!WALKER_MODELS.includes(model)) blockers.push('unknown_walker_model');
  if (!WALKER_SIDES.includes(side)) blockers.push('unknown_walker_side');
  if (!context?.eventTimeUtc) blockers.push('missing_event_time');

  if (blockers.length > 0) {
    return { spawned: false, walker: null, blockers: [...new Set(blockers)] };
  }

  const walker = createWalker({ context, model, side, pdArray });
  const duplicate = existingWalkers.find((candidate) => isActiveWalker(candidate) && sameWalkerKey(candidate, walker));
  if (duplicate) {
    return { spawned: false, walker: duplicate, blockers: ['duplicate_active_walker'] };
  }

  return { spawned: true, walker, blockers: [] };
}
