import { readFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { register } from '../router.js';
import * as health from '@tvmcp/core/health';
import * as data from '@tvmcp/core/data';
import * as replay from '@tvmcp/core/replay';
import { parseIctEngineTable, findIctEngineRows } from '../lib/ict-engine-parser.js';
import { evaluateLiveReadiness, buildLiveDryRunRecord } from '../lib/live-readiness.js';

function sessionFromOpts(opts) {
  return opts.session || process.env.TV_SESSION || 'ny-am';
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
    session: { type: 'string', short: 's', description: 'Session name: ny-am, ny-pm, london (default ny-am)' },
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
    session: { type: 'string', short: 's', description: 'Session name: ny-am, ny-pm, london (default ny-am)' },
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
    if (opts.out) {
      mkdirSync(path.dirname(opts.out), { recursive: true });
      appendFileSync(opts.out, `${JSON.stringify({ ...enrichedRecord, writtenAt: new Date().toISOString() })}\n`, 'utf8');
      return { ...enrichedRecord, out: opts.out };
    }
    return enrichedRecord;
  },
});

export const __test = { latestBarFromOhlcv, collectLiveReadinessInputs, defaultTruthPathForSession, readTruthForDryRun };
