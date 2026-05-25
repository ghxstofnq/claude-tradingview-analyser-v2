// pair-decision.js — reads/writes state/session/<date>/<session>/pair-decision.json
// the file that locks in which symbol of a pair is the "leader" for the
// rest of the session. Written once by surface_leader_decision at minute 14
// of the open-reaction phase; read by tv analyze to short-circuit dual-
// capture once the decision exists.

import fs from 'node:fs/promises';
import path from 'node:path';

const FILE_NAME = 'pair-decision.json';
const SCHEMA = 1;

// Atomic write: serialize first (throws bubble up before any disk write),
// then write to a sibling .tmp file and rename. Prevents partial-file
// state if the serializer throws or the process crashes mid-write.
export async function writePairDecision(sessionDir, payload) {
  const record = { schema: SCHEMA, ...payload };
  const json = JSON.stringify(record, null, 2);    // may throw on circular refs
  await fs.mkdir(sessionDir, { recursive: true });
  const target = path.join(sessionDir, FILE_NAME);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, target);
  return target;
}

// Returns the decision record if it exists AND its `date` field matches the
// requested `todayDate` string (YYYY-MM-DD). Otherwise null. Callers treat
// null as "no decision yet" and run the dual-capture flow.
export async function readPairDecision(sessionDir, todayDate) {
  const target = path.join(sessionDir, FILE_NAME);
  let text;
  try {
    text = await fs.readFile(target, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch (e) {
    throw new Error(`pair-decision.json at '${target}' is not valid JSON: ${e.message}`);
  }
  if (record.date !== todayDate) return null;
  return record;
}
