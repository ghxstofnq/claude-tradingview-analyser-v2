import { readFileSync, mkdirSync, appendFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { register } from '../router.js';
import * as health from '@tvmcp/core/health';
import * as data from '@tvmcp/core/data';
import * as replay from '@tvmcp/core/replay';
import { parseIctEngineTable, findIctEngineRows } from '../lib/ict-engine-parser.js';
import { evaluateLiveReadiness, buildLiveDryRunRecord } from '../lib/live-readiness.js';

function activeSessionFromMs(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(Number(nowMs)));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const mins = Number(get('hour')) * 60 + Number(get('minute'));
  if (mins >= 9 * 60 + 30 && mins < 12 * 60) return 'ny-am';
  if (mins >= 13 * 60 && mins < 16 * 60) return 'ny-pm';
  if (mins >= 3 * 60 && mins < 6 * 60) return 'london';
  return 'idle';
}

function sessionFromOpts(opts = {}) {
  return opts.session || process.env.TV_SESSION || activeSessionFromMs(opts.now ? Date.parse(opts.now) : Date.now());
}

function etDateFromMs(nowMs = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Number(nowMs)));
  const get = (type) => fmt.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function defaultTruthPathForSession({ session = 'ny-am', nowMs = Date.now() } = {}) {
  return path.join(process.cwd(), 'state', 'session', etDateFromMs(nowMs), session, 'deterministic-packet.json');
}

function readTruthForDryRun(opts, nowMs) {
  const explicitPath = opts.truth || null;
  const truthPath = explicitPath ?? defaultTruthPathForSession({ session: sessionFromOpts(opts), nowMs });
  if (!truthPath || !existsSync(truthPath)) return { truth: null, truthPath };
  return { truth: JSON.parse(readFileSync(truthPath, 'utf8')), truthPath };
}

function persistDryRunSessionRecord({ record, sessionDir, writtenAt = new Date().toISOString() } = {}) {
  if (!record || !sessionDir) return null;
  mkdirSync(sessionDir, { recursive: true });
  const deterministic = {
    mode: record.mode ?? 'live-dry-run',
    evaluationStatus: record.finalVerdict ?? 'cannot_evaluate_deterministic_truth',
    finalVerdict: record.finalVerdict ?? 'cannot_evaluate_deterministic_truth',
    eventTimeUtc: record.eventTimeUtc ?? null,
    bestPacket: record.bestPacket ?? null,
    blockers: Array.isArray(record.blockers) ? record.blockers : [],
    noTradeReason: record.summary ?? null,
    readiness: record.readiness ?? null,
    writtenAt,
  };
  writeFileSync(path.join(sessionDir, 'deterministic-packet.json'), `${JSON.stringify(deterministic, null, 2)}\n`, 'utf8');
  appendFileSync(path.join(sessionDir, 'no-trades.jsonl'), `${JSON.stringify({
    ts: writtenAt,
    mode: record.mode ?? 'live-dry-run',
    finalVerdict: deterministic.finalVerdict,
    eventTimeUtc: deterministic.eventTimeUtc,
    reason: deterministic.noTradeReason,
    blockers: deterministic.blockers,
    bestPacket: null,
  })}\n`, 'utf8');
  return deterministic;
}

function latestBarFromOhlcv(ohlcv) {
  const rows = ohlcv?.bars ?? ohlcv?.data ?? ohlcv?.rows ?? [];
  const last = Array.isArray(rows) ? rows.at(-1) : null;
  if (!last) return null;
  return {
    ...last,
    ts: typeof last.time === 'number' ? new Date((last.time > 10_000_000_000 ? last.time : last.time * 1000)).toISOString() : last.time,
  };
}

async function collectLiveReadinessInputs(opts = {}) {
  if (opts.fixture) {
    const fixture = JSON.parse(readFileSync(opts.fixture, 'utf8'));
    return {
      status: fixture.status ?? fixture.health ?? fixture,
      ui: fixture.ui ?? {},
      replay: fixture.replay ?? {},
      engine: fixture.engine ?? fixture.gates?.engine ?? {},
      bar: fixture.bar ?? latestBarFromOhlcv(fixture.ohlcv ?? fixture.bars) ?? null,
      session: sessionFromOpts(opts),
      nowMs: opts.now ? Date.parse(opts.now) : Date.now(),
      fixturePath: opts.fixture,
    };
  }

  const [status, ui, replayStatus, ohlcv, tables] = await Promise.all([
    health.healthCheck(),
    health.uiState().catch(() => ({})),
    replay.status().catch(() => ({})),
    data.getOhlcv({ count: 3 }).catch(() => ({})),
    data.getPineTables().catch(() => []),
  ]);
  return {
    status,
    ui,
    replay: replayStatus,
    engine: parseIctEngineTable(findIctEngineRows(tables)),
    bar: latestBarFromOhlcv(ohlcv),
    session: sessionFromOpts(opts),
    nowMs: opts.now ? Date.parse(opts.now) : Date.now(),
  };
}

register('live-check', {
  description: 'Run the fail-closed live startup checklist before MNQ/MES trading',
  options: {
    session: { type: 'string', short: 's', description: 'Session name: ny-am, ny-pm, london (default active ET session)' },
    fixture: { type: 'string', short: 'f', description: 'Read a fixture JSON instead of CDP/TradingView' },
    now: { type: 'string', description: 'ISO timestamp override for tests' },
  },
  handler: async (opts) => {
    const inputs = await collectLiveReadinessInputs(opts);
    return evaluateLiveReadiness(inputs);
  },
});

register('live-dry-run', {
  description: 'Run one manual-first live dry-run tick; blocks action when source health/readiness fails',
  options: {
    session: { type: 'string', short: 's', description: 'Session name: ny-am, ny-pm, london (default active ET session)' },
    fixture: { type: 'string', short: 'f', description: 'Read a fixture JSON instead of CDP/TradingView' },
    truth: { type: 'string', short: 't', description: 'Optional deterministic-packet truth JSON to summarize' },
    out: { type: 'string', short: 'o', description: 'Append dry-run record to this JSONL file' },
    now: { type: 'string', description: 'ISO timestamp override for tests' },
  },
  handler: async (opts) => {
    const inputs = await collectLiveReadinessInputs(opts);
    const readiness = evaluateLiveReadiness(inputs);
    const { truth, truthPath } = readTruthForDryRun(opts, inputs.nowMs);
    const record = buildLiveDryRunRecord({ readiness, truth, event: inputs.bar });
    const enrichedRecord = { ...record, truthPath };
    if (!enrichedRecord.actionable) {
      persistDryRunSessionRecord({ record: enrichedRecord, sessionDir: path.dirname(truthPath) });
    }
    if (opts.out) {
      mkdirSync(path.dirname(opts.out), { recursive: true });
      appendFileSync(opts.out, `${JSON.stringify({ ...enrichedRecord, writtenAt: new Date().toISOString() })}\n`, 'utf8');
      return { ...enrichedRecord, out: opts.out };
    }
    return enrichedRecord;
  },
});

export const __test = { latestBarFromOhlcv, collectLiveReadinessInputs, defaultTruthPathForSession, readTruthForDryRun, persistDryRunSessionRecord, sessionFromOpts, activeSessionFromMs };
