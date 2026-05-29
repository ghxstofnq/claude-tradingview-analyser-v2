import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY_STATE = Object.freeze({ schemaVersion: 1, walkers: [] });

export function resolveWalkersJsonPath(sessionDir) {
  return path.join(sessionDir, 'walkers.json');
}

function normalizeWalkersState(value) {
  if (value && value.schemaVersion === 1 && Array.isArray(value.walkers)) {
    return value;
  }
  return { schemaVersion: 1, walkers: [], blockers: ['malformed_walkers_state'] };
}

export async function readWalkersJson(sessionDir) {
  const file = resolveWalkersJsonPath(sessionDir);
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return normalizeWalkersState(parsed);
  } catch (err) {
    if (err?.code === 'ENOENT') return { ...EMPTY_STATE, walkers: [] };
    return { schemaVersion: 1, walkers: [], blockers: ['malformed_walkers_state'] };
  }
}

export async function writeWalkersJson(sessionDir, state) {
  const file = resolveWalkersJsonPath(sessionDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
  return { path: file };
}
