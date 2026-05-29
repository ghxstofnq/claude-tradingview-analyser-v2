import { spawnWalker } from './walker-spawn.js';
import { advanceWalker } from './walker-advance.js';
import { killWalker } from './walker-kill.js';

export function runWalkerEngine({ context, walkers = [], spawnRequests = [], advanceRequests = [], killRequests = [] } = {}) {
  let nextWalkers = [...walkers];
  const events = [];

  for (const request of spawnRequests) {
    const result = spawnWalker({ context, existingWalkers: nextWalkers, ...request });
    events.push({ type: 'spawn', ...result });
    if (result.spawned) nextWalkers = [...nextWalkers, result.walker];
  }

  for (const request of advanceRequests) {
    nextWalkers = nextWalkers.map((walker) => {
      if (walker.id !== request.id) return walker;
      const advanced = advanceWalker(walker, request);
      events.push({ type: 'advance', walker: advanced });
      return advanced;
    });
  }

  for (const request of killRequests) {
    nextWalkers = nextWalkers.map((walker) => {
      if (walker.id !== request.id) return walker;
      const killed = killWalker(walker, request);
      events.push({ type: 'kill', walker: killed });
      return killed;
    });
  }

  return { walkers: nextWalkers, events };
}

export { advanceWalker } from './walker-advance.js';
export { killWalker } from './walker-kill.js';
export { spawnWalker } from './walker-spawn.js';
export * from './walker-state.js';
