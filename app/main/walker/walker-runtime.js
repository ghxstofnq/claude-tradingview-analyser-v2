// Impure runtime — file I/O for walkers.json + memory skip-line parsing.
// Spec: docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md

import fs from 'node:fs';
import path from 'node:path';

const EMPTY_STATE = (session) => ({
  session,
  walkers: [],
  triggers: [],
  proof: { last_1m_close: null, last_5m_close: null },
});

export function walkersJsonPath(sessionDir, sessionLabel) {
  return path.join(sessionDir, sessionLabel, 'walkers.json');
}

export function readWalkersJson(sessionDir, sessionLabel) {
  const p = walkersJsonPath(sessionDir, sessionLabel);
  if (!fs.existsSync(p)) return EMPTY_STATE(sessionLabel);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return EMPTY_STATE(sessionLabel);
  }
}

export function writeWalkersJson(sessionDir, sessionLabel, state) {
  const p = walkersJsonPath(sessionDir, sessionLabel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, p);
}

export function parseMemorySkipLines(memoryMdContent) {
  const out = [];
  for (const line of String(memoryMdContent ?? '').split('\n')) {
    const trimmed = line.replace(/^[-*]\s+/, '').trim();
    if (/^walker-skip:/i.test(trimmed)) out.push(trimmed);
  }
  return out;
}
