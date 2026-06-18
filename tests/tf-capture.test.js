import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tfMatchesMeta,
  captureTfWithRetry,
  captureMultiTfWithHealth,
  applyBaselineFallback,
  enginePresent,
  pollEnginePresent,
} from '../cli/lib/tf-capture.js';

// ---------------------------------------------------------------- helpers

const noopSleep = async () => {};

test('enginePresent: true only when schema supported AND has ≥1 row type', () => {
  assert.equal(enginePresent({ schema_supported: true, levels: [{ name: 'AS.H' }] }), true);
  assert.equal(enginePresent({ schema_supported: true, fvgs: [{}], levels: [] }), true);
  assert.equal(enginePresent({ schema_supported: true, levels: [], fvgs: [], swings: [], structures: [] }), false);
  assert.equal(enginePresent({ schema_supported: false, levels: [{ name: 'AS.H' }] }), false);
  assert.equal(enginePresent(null), false);
});

test('pollEnginePresent: returns present after a lagging read settles (counts attempts)', async () => {
  let n = 0;
  const readEngine = async () => (++n < 3 ? { schema_supported: true, levels: [] } : { schema_supported: true, levels: [{ name: 'AS.H' }] });
  const r = await pollEnginePresent({ readEngine, sleep: noopSleep, pollIntervalMs: 1, deadlineMs: 10 });
  assert.equal(r.present, true);
  assert.equal(r.attempts, 3);
  assert.ok(r.engine.levels.length > 0);
});

test('pollEnginePresent: gives up present:false after the deadline (never invents data)', async () => {
  const readEngine = async () => ({ schema_supported: true, levels: [] }); // never present
  const r = await pollEnginePresent({ readEngine, sleep: noopSleep, pollIntervalMs: 1, deadlineMs: 4 });
  assert.equal(r.present, false);
  assert.ok(r.attempts >= 1);
});

test('pollEnginePresent: tolerates transient read throws', async () => {
  let n = 0;
  const readEngine = async () => { if (++n === 1) throw new Error('CDP blip'); return { schema_supported: true, swings: [{}] }; };
  const r = await pollEnginePresent({ readEngine, sleep: noopSleep, pollIntervalMs: 1, deadlineMs: 10 });
  assert.equal(r.present, true);
  assert.equal(r.attempts, 2);
});

function freshEngine(metaTf) {
  return {
    schema: 2,
    schema_supported: true,
    meta: { schema: 2, tf: metaTf, emit_ms: 1780666321876, symbol: 'MNQ1!' },
    fvgs: [],
    quality: { range_3h: 100 },
  };
}

// ---------------------------------------------------------- tfMatchesMeta

test('tfMatchesMeta: D matches the engine 1D emit form', () => {
  assert.equal(tfMatchesMeta('D', '1D'), true);
  assert.equal(tfMatchesMeta('D', 'D'), true);
});

test('tfMatchesMeta: numeric resolutions match exactly and reject others', () => {
  assert.equal(tfMatchesMeta('240', '240'), true);
  assert.equal(tfMatchesMeta('60', '60'), true);
  assert.equal(tfMatchesMeta('240', '15'), false);
  assert.equal(tfMatchesMeta('1', '5'), false);
});

test('tfMatchesMeta: null/absent meta tf never matches', () => {
  assert.equal(tfMatchesMeta('60', null), false);
  assert.equal(tfMatchesMeta('60', undefined), false);
});

// ----------------------------------------------------- captureTfWithRetry

test('captureTfWithRetry: rejects stale table from the previous TF and polls until the engine re-emits', async () => {
  let reads = 0;
  const result = await captureTfWithRetry({
    tv: '60',
    key: 'h1',
    setTimeframe: async () => {},
    readEngine: async () => {
      reads += 1;
      // first two reads still show the previous TF's table (240)
      return reads < 3 ? freshEngine('240') : freshEngine('60');
    },
    readBars: async () => ({ count: 5 }),
    sleep: noopSleep,
    pollIntervalMs: 10,
    deadlineMs: 1000,
  });
  assert.equal(result.engine.meta.tf, '60');
  assert.equal(result.health.status, 'fresh');
  assert.equal(result.health.attempts, 3);
  assert.deepEqual(result.bars, { count: 5 });
});

test('captureTfWithRetry: an absent engine table is missing after the deadline, never accepted', async () => {
  const result = await captureTfWithRetry({
    tv: '60',
    key: 'h1',
    setTimeframe: async () => {},
    readEngine: async () => null,
    readBars: async () => ({ count: 5 }),
    sleep: noopSleep,
    pollIntervalMs: 10,
    deadlineMs: 50,
  });
  assert.equal(result.engine, null);
  assert.equal(result.health.status, 'missing');
  assert.equal(result.health.attempts, 5); // ceil(50/10)
  // bars are still captured best-effort so bars_by_tf keeps its shape
  assert.deepEqual(result.bars, { count: 5 });
});

test('captureTfWithRetry: unsupported schema is not accepted as fresh', async () => {
  const result = await captureTfWithRetry({
    tv: '60',
    key: 'h1',
    setTimeframe: async () => {},
    readEngine: async () => ({ ...freshEngine('60'), schema_supported: false }),
    readBars: async () => ({}),
    sleep: noopSleep,
    pollIntervalMs: 10,
    deadlineMs: 30,
  });
  assert.equal(result.engine, null);
  assert.equal(result.health.status, 'missing');
});

test('captureTfWithRetry: setTimeframe failure reports status=error with the message', async () => {
  const result = await captureTfWithRetry({
    tv: '60',
    key: 'h1',
    setTimeframe: async () => { throw new Error('CDP gone'); },
    readEngine: async () => freshEngine('60'),
    readBars: async () => ({}),
    sleep: noopSleep,
  });
  assert.equal(result.engine, null);
  assert.equal(result.health.status, 'error');
  assert.match(result.health.error, /CDP gone/);
});

// ----------------------------------------------- captureMultiTfWithHealth

function makeSweepDeps({ failKeys = new Set(), healOnSecondPass = new Set() } = {}) {
  const setCalls = [];
  let currentTf = null;
  const attemptsPerTf = new Map();
  return {
    setCalls,
    deps: {
      setTimeframe: async ({ timeframe }) => {
        setCalls.push(timeframe);
        currentTf = timeframe;
        attemptsPerTf.set(timeframe, (attemptsPerTf.get(timeframe) || 0) + 1);
      },
      readEngine: async () => {
        const visits = attemptsPerTf.get(currentTf) || 0;
        const metaTf = currentTf === 'D' ? '1D' : currentTf;
        if (failKeys.has(currentTf)) return null;
        if (healOnSecondPass.has(currentTf) && visits < 2) return null;
        return freshEngine(metaTf);
      },
      readBars: async () => ({ count: 5 }),
      sleep: noopSleep,
    },
  };
}

const TFS = [
  { tv: 'D', key: 'daily' },
  { tv: '240', key: 'h4' },
  { tv: '60', key: 'h1' },
];

test('captureMultiTfWithHealth: clean sweep reports ok with all TFs fresh', async () => {
  const { deps, setCalls } = makeSweepDeps();
  const out = await captureMultiTfWithHealth({
    tfs: TFS, originalTf: '1', deps, pollIntervalMs: 10, deadlineMs: 30,
  });
  assert.equal(out.capture_health.ok, true);
  assert.deepEqual(out.capture_health.missing, []);
  assert.equal(out.capture_health.by_tf.daily.status, 'fresh');
  assert.equal(out.engine_by_tf.h4.meta.tf, '240');
  assert.equal(out.bars_by_tf.h1.tv_resolution, '60');
  // restores the original TF after the sweep
  assert.equal(setCalls[setCalls.length - 1], '1');
});

test('captureMultiTfWithHealth: a TF that fails the first pass is retried in a second pass', async () => {
  const { deps } = makeSweepDeps({ healOnSecondPass: new Set(['60']) });
  const out = await captureMultiTfWithHealth({
    tfs: TFS, originalTf: '1', deps, pollIntervalMs: 10, deadlineMs: 30,
  });
  assert.equal(out.capture_health.ok, true);
  assert.equal(out.capture_health.by_tf.h1.status, 'fresh');
  assert.equal(out.capture_health.by_tf.h1.pass, 2);
  assert.equal(out.engine_by_tf.h1.meta.tf, '60');
});

test('captureMultiTfWithHealth: a TF that never yields a fresh table is reported missing', async () => {
  const { deps } = makeSweepDeps({ failKeys: new Set(['60']) });
  const out = await captureMultiTfWithHealth({
    tfs: TFS, originalTf: '1', deps, pollIntervalMs: 10, deadlineMs: 30,
  });
  assert.equal(out.capture_health.ok, false);
  assert.deepEqual(out.capture_health.missing, ['h1']);
  assert.equal(out.engine_by_tf.h1, null);
  assert.equal(out.bars_by_tf.h1.tv_resolution, '60');
});

// -------------------------------------------------- applyBaselineFallback

function capturedWithMissingH1() {
  return {
    bars_by_tf: {
      daily: { count: 5, tv_resolution: 'D' },
      h4: { count: 5, tv_resolution: '240' },
      h1: { count: 5, tv_resolution: '60' },
    },
    engine_by_tf: { daily: freshEngine('1D'), h4: freshEngine('240'), h1: null },
    capture_health: {
      ok: false,
      missing: ['h1'],
      fallback: [],
      by_tf: {
        daily: { status: 'fresh', attempts: 1, pass: 1 },
        h4: { status: 'fresh', attempts: 1, pass: 1 },
        h1: { status: 'missing', attempts: 3, pass: 2 },
      },
    },
  };
}

test('applyBaselineFallback: fills a missing TF from a fresh-enough baseline and records provenance', () => {
  const capture = capturedWithMissingH1();
  const nowMs = Date.parse('2026-06-11T14:00:00Z');
  const baseline = {
    timestamp: '2026-06-11T13:00:00Z', // 1h old
    bars_by_tf: { h1: { count: 9, tv_resolution: '60' } },
    engine_by_tf: { h1: freshEngine('60') },
  };
  const out = applyBaselineFallback({
    capture, baseline, baselinePath: '/state/baseline-MNQ1!.json', nowMs,
  });
  assert.equal(out.engine_by_tf.h1.meta.tf, '60');
  assert.equal(out.bars_by_tf.h1.count, 9);
  assert.equal(out.capture_health.by_tf.h1.status, 'fallback');
  assert.equal(out.capture_health.by_tf.h1.baseline_age_seconds, 3600);
  assert.equal(out.capture_health.by_tf.h1.baseline_path, '/state/baseline-MNQ1!.json');
  assert.deepEqual(out.capture_health.missing, []);
  assert.deepEqual(out.capture_health.fallback, ['h1']);
  assert.equal(out.capture_health.ok, true);
});

test('applyBaselineFallback: a baseline older than maxAgeSeconds is rejected', () => {
  const capture = capturedWithMissingH1();
  const nowMs = Date.parse('2026-06-11T14:00:00Z');
  const baseline = {
    timestamp: '2026-06-05T13:00:00Z', // ~6 days old
    bars_by_tf: { h1: { count: 9 } },
    engine_by_tf: { h1: freshEngine('60') },
  };
  const out = applyBaselineFallback({ capture, baseline, baselinePath: '/x.json', nowMs });
  assert.equal(out.engine_by_tf.h1, null);
  assert.equal(out.capture_health.by_tf.h1.status, 'missing');
  assert.equal(out.capture_health.by_tf.h1.fallback_skipped, 'baseline_too_old');
  assert.deepEqual(out.capture_health.missing, ['h1']);
  assert.equal(out.capture_health.ok, false);
});

test('applyBaselineFallback: a baseline that itself lacks the TF cannot fill it', () => {
  const capture = capturedWithMissingH1();
  const nowMs = Date.parse('2026-06-11T14:00:00Z');
  const baseline = {
    timestamp: '2026-06-11T13:30:00Z',
    bars_by_tf: {},
    engine_by_tf: { h1: null },
  };
  const out = applyBaselineFallback({ capture, baseline, baselinePath: '/x.json', nowMs });
  assert.equal(out.engine_by_tf.h1, null);
  assert.equal(out.capture_health.by_tf.h1.status, 'missing');
  assert.equal(out.capture_health.by_tf.h1.fallback_skipped, 'baseline_missing_tf');
});

test('applyBaselineFallback: fresh TFs are never overwritten by baseline data', () => {
  const capture = capturedWithMissingH1();
  const nowMs = Date.parse('2026-06-11T14:00:00Z');
  const baseline = {
    timestamp: '2026-06-11T13:30:00Z',
    bars_by_tf: { h4: { count: 99 } },
    engine_by_tf: { h4: freshEngine('240'), h1: freshEngine('60') },
  };
  const out = applyBaselineFallback({ capture, baseline, baselinePath: '/x.json', nowMs });
  assert.equal(out.bars_by_tf.h4.count, 5);
  assert.equal(out.capture_health.by_tf.h4.status, 'fresh');
});

test('applyBaselineFallback: no baseline at all leaves the capture unchanged', () => {
  const capture = capturedWithMissingH1();
  const out = applyBaselineFallback({ capture, baseline: null, nowMs: Date.now() });
  assert.equal(out.capture_health.by_tf.h1.status, 'missing');
  assert.deepEqual(out.capture_health.missing, ['h1']);
});

test('captureMultiTfWithHealth: skips the second pass when every TF failed (engine indicator absent)', async () => {
  let setTimeframeCalls = 0;
  const deps = {
    setTimeframe: async () => { setTimeframeCalls += 1; },
    readEngine: async () => null,
    readBars: async () => ({}),
    sleep: noopSleep,
  };
  const out = await captureMultiTfWithHealth({
    tfs: TFS, originalTf: '1', deps, pollIntervalMs: 10, deadlineMs: 30,
  });
  assert.equal(out.capture_health.ok, false);
  assert.deepEqual(out.capture_health.missing, ['daily', 'h4', 'h1']);
  // 3 TFs on pass 1 + 1 restore — no pass-2 re-sweep of all-failed TFs
  assert.equal(setTimeframeCalls, 4);
});
