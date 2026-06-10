/**
 * tf-capture.js — verified per-TF capture of the ICT Engine table.
 *
 * Fixes the silent multi-TF capture hole observed 2026-06-02..10: after a
 * chart TF switch the engine table either lags (still shows the previous
 * TF's rows) or is momentarily absent, and a single fixed-delay read
 * recorded null/wrong-TF data without complaint. Downstream, the brief
 * graded those days "no-trade: htf_unclear" — a data gap wearing a market
 * verdict (8 of 13 June briefs).
 *
 * Three layers, all dependency-injected and unit-testable without CDP:
 *   1. captureTfWithRetry  — poll until the parsed table's meta.tf matches
 *      the requested resolution (the engine stamps every emit with its TF).
 *   2. captureMultiTfWithHealth — full sweep + one retry pass for failures,
 *      emitting a capture_health map so "data missing" is a first-class,
 *      visible state instead of a silent null.
 *   3. applyBaselineFallback — fill TFs that still failed from a saved
 *      baseline bundle, age-checked, provenance recorded. Strategy §2.4
 *      explicitly allows reusing HTF context intraday.
 */

// The engine emits daily as "1D" while TradingView's resolution string is "D".
const TV_TO_META_TF = { D: '1D', W: '1W', M: '1M' };

export const DEFAULT_POLL_INTERVAL_MS = 350;
export const DEFAULT_DEADLINE_MS = 4000;
export const DEFAULT_FALLBACK_MAX_AGE_SECONDS = 86_400; // one day

/** Does the engine's meta.tf stamp correspond to the requested TV resolution? */
export function tfMatchesMeta(tvResolution, metaTf) {
  if (typeof metaTf !== 'string' || metaTf === '') return false;
  return metaTf === tvResolution || metaTf === TV_TO_META_TF[tvResolution];
}

/**
 * Switch to one TF and poll until the engine table is verifiably for that TF
 * (meta.tf matches + schema supported). Never accepts a stale or absent table
 * as an answer — those time out into status 'missing'.
 *
 * Returns { bars, engine, health: { status, attempts, pass? , error? } }.
 * `bars` is read once at the end (the chart has settled on the TF by then)
 * and is best-effort: a read failure records { error } to keep bundle shape.
 */
export async function captureTfWithRetry({
  tv,
  key, // eslint-disable-line no-unused-vars -- part of the call contract, used by callers' logs
  setTimeframe,
  readEngine,
  readBars,
  sleep,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  deadlineMs = DEFAULT_DEADLINE_MS,
}) {
  try {
    await setTimeframe({ timeframe: tv });
  } catch (e) {
    return { bars: { error: e.message }, engine: null, health: { status: 'error', attempts: 0, error: e.message } };
  }

  const maxAttempts = Math.max(1, Math.ceil(deadlineMs / pollIntervalMs));
  let engine = null;
  let attempts = 0;
  let fresh = false;
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const candidate = await readEngine();
      if (candidate && candidate.schema_supported && tfMatchesMeta(tv, candidate?.meta?.tf)) {
        engine = candidate;
        fresh = true;
        break;
      }
    } catch {
      // transient read failure — keep polling until the deadline
    }
    if (attempts < maxAttempts) await sleep(pollIntervalMs);
  }

  let bars;
  try {
    bars = await readBars();
  } catch (e) {
    bars = { error: e.message };
  }
  return { bars, engine, health: { status: fresh ? 'fresh' : 'missing', attempts } };
}

/**
 * Sweep all TFs, then re-run capture once for any TF that failed (the second
 * setTimeframe also heals "chart stuck on previous TF"). Restores originalTf.
 *
 * deps: { setTimeframe, readEngine, readBars, sleep }
 * Returns { bars_by_tf, engine_by_tf, capture_health } where capture_health is
 * { ok, missing: [keys], fallback: [], by_tf: { <key>: { status, attempts, pass, error? } } }.
 */
export async function captureMultiTfWithHealth({
  tfs,
  originalTf,
  deps,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  deadlineMs = DEFAULT_DEADLINE_MS,
}) {
  const bars_by_tf = {};
  const engine_by_tf = {};
  const by_tf = {};

  const captureOne = async ({ tv, key }, pass) => {
    const result = await captureTfWithRetry({ tv, key, ...deps, pollIntervalMs, deadlineMs });
    bars_by_tf[key] = { ...result.bars, tv_resolution: tv };
    engine_by_tf[key] = result.engine;
    by_tf[key] = { ...result.health, pass };
  };

  for (const tf of tfs) await captureOne(tf, 1);
  const failed = tfs.filter(({ key }) => by_tf[key].status !== 'fresh');
  // Every TF failing means the indicator isn't on the chart at all — a second
  // pass can't heal that and would only add tfs × deadlineMs of polling.
  if (failed.length < tfs.length) {
    for (const tf of failed) await captureOne(tf, 2);
  }

  try {
    await deps.setTimeframe({ timeframe: originalTf });
    await deps.sleep(pollIntervalMs);
  } catch {
    // best-effort restore; the next capture sets the TF explicitly anyway
  }

  const missing = tfs.map(({ key }) => key).filter((key) => by_tf[key].status !== 'fresh');
  return {
    bars_by_tf,
    engine_by_tf,
    capture_health: { ok: missing.length === 0, missing, fallback: [], by_tf },
  };
}

/**
 * Fill TFs that are still missing after the retry pass from a saved baseline
 * bundle (the per-symbol state/baseline-<sym>.json the app refreshes during
 * live). Only fills when the baseline is younger than maxAgeSeconds and has
 * a non-null engine for that TF; every fill and every skip is recorded in
 * capture_health so a fallback never masquerades as a live read.
 */
export function applyBaselineFallback({
  capture,
  baseline,
  baselinePath = null,
  maxAgeSeconds = DEFAULT_FALLBACK_MAX_AGE_SECONDS,
  nowMs = Date.now(),
}) {
  const health = capture.capture_health;
  if (!baseline || !health || health.missing.length === 0) return capture;

  const baselineMs = baseline.timestamp ? Date.parse(baseline.timestamp) : NaN;
  const ageSeconds = Number.isFinite(baselineMs) ? Math.floor((nowMs - baselineMs) / 1000) : null;

  const stillMissing = [];
  for (const key of health.missing) {
    const entry = health.by_tf[key];
    const candidate = baseline.engine_by_tf?.[key];
    if (!candidate) {
      entry.fallback_skipped = 'baseline_missing_tf';
      stillMissing.push(key);
      continue;
    }
    if (ageSeconds == null || ageSeconds > maxAgeSeconds) {
      entry.fallback_skipped = ageSeconds == null ? 'baseline_age_unknown' : 'baseline_too_old';
      stillMissing.push(key);
      continue;
    }
    capture.engine_by_tf[key] = candidate;
    if (baseline.bars_by_tf?.[key]) capture.bars_by_tf[key] = baseline.bars_by_tf[key];
    health.by_tf[key] = { status: 'fallback', baseline_age_seconds: ageSeconds, baseline_path: baselinePath };
    health.fallback.push(key);
  }
  health.missing = stillMissing;
  health.ok = stillMissing.length === 0;
  return capture;
}
