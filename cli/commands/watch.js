import { register } from '../router.js';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

/**
 * tv watch — long-running watchman for live bar-close polling, with a
 * tap/confirmation/invalidation state machine per FVG zone.
 *
 * Strategy basis:
 *   - trading-strategy-2026.md §5 + §6 step 6: "Price taps your chosen PD
 *     array. Within 10–15 minutes, you get a strong 1m/5m close in your
 *     direction." The strategy's hard rule is a TIMER from tap, not just a
 *     per-bar inside-FVG check.
 *   - entry-models.md: MSS / Trend / Inversion all share the same
 *     confirmation discipline — tap, wait, confirm or invalidate.
 *   - §2.4: HTF context reused intraday; per-tick we run pillar3-only
 *     against a 15-min-stale baseline.
 *
 * Lifecycle per FVG zone (keyed by study + high + low — robust across
 * snapshots, unlike zone_index which shifts as new FVGs are added/removed):
 *   1. fvg_tap        — first bar with body_ratio >= --min-body-ratio
 *                       that closes inside the zone, while gates pass.
 *                       Opens a watch; arms the timer.
 *   2. fvg_confirmation — within --window-seconds, a subsequent bar with
 *                         body_ratio >= --confirmation-body-ratio closes.
 *                         The watch is closed.
 *   3. fvg_invalidation — --window-seconds elapse with no confirmation.
 *                         The watch is closed.
 *
 *   The state machine intentionally does NOT classify MSS vs Trend vs
 *   Inversion or check confirmation direction against FVG direction. Those
 *   decisions are in CLAUDE.md "Known gaps" — interpretive, deferred to
 *   the LLM via /analyze. The watchman fires candidate events; /analyze
 *   grades them.
 *
 * Context gating only applies to new-tap creation. Existing watches keep
 * ticking through session boundaries — once the strategy has armed a
 * setup, the timer keeps running.
 *
 * Persistence:
 *   - state/watch/baseline.json        — rolling full bundle (15-min TTL)
 *   - state/watch/last-scan.json       — rolling per-tick scan; NOT a
 *                                        valid citation target
 *   - state/watch/snapshots/<bar_time>.bundle.json — frozen per-event
 *                                        snapshots; alerts cite into these
 *   - state/watch/watches.json         — open watches; survives restart
 *   - state/watch/alerts.jsonl         — append-only history of all alerts
 *
 * Citation discipline (CLAUDE.md #6): every numeric field in an alert has
 * a `cites.<field>` path that resolves into the alert's `bundle_path`
 * snapshot file. The snapshot is frozen at emission time.
 */

const DEFAULT_POLL_MS = 10_000;
const DEFAULT_BASELINE_TTL_S = 900;
const DEFAULT_BODY_RATIO_MIN = 0.5;
const DEFAULT_CONFIRMATION_BODY_RATIO_MIN = 0.6;
const DEFAULT_WINDOW_SECONDS = 900; // 15 min (strategy §6 upper bound)

const STATE_DIR = 'state/watch';
const BASELINE_PATH = `${STATE_DIR}/baseline.json`;
const SCAN_PATH = `${STATE_DIR}/last-scan.json`;
const ALERTS_PATH = `${STATE_DIR}/alerts.jsonl`;
const SNAPSHOT_DIR = `${STATE_DIR}/snapshots`;
const WATCHES_PATH = `${STATE_DIR}/watches.json`;

// Context gates default to ACTIVE (conservative); user opts out via flags.
// Strategy basis (trading-strategy-2026.md):
//   - §2.2 + §2.3: liquidity moves during sessions/killzones.
//   - §3 + §7 step 3: stand aside when 5m/15m candle quality is poor.
//   - CME schedule: futures closed Sat, Fri 17:00 → Sun 18:00 ET, daily
//     17:00–18:00 ET break.
function shouldSkipByContext(bundle, allows) {
  const session = bundle?.gates?.session;
  const pillar2 = bundle?.gates?.pillar2;
  if (!session) return 'session_unknown';
  if (!allows.allowMarketClosed && session.is_market_closed === true) {
    return 'market_closed';
  }
  if (!allows.allowOutsideKillzone && session.in_killzone === false) {
    return `outside_killzone(${session.label})`;
  }
  if (!allows.allowPoorQuality) {
    const m5q = pillar2?.m5?.candle_quality_heuristic;
    const m15q = pillar2?.m15?.candle_quality_heuristic;
    if (m5q === 'poor' || m15q === 'poor') {
      return `poor_quality(m5=${m5q},m15=${m15q})`;
    }
  }
  return null;
}

function runCli(args) {
  const result = spawnSync('node', [resolvePath('./cli/index.js'), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status,
  };
}

function captureBaseline() {
  const t0 = Date.now();
  process.stderr.write('[watch] refreshing baseline (full analyze; chart will flash through 6 TFs)...\n');
  const result = runCli(['analyze', '--out', BASELINE_PATH]);
  if (!result.ok) {
    throw new Error(`baseline capture failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  process.stderr.write(`[watch] baseline refreshed in ${dt}s -> ${BASELINE_PATH}\n`);
}

function captureScan() {
  const result = runCli([
    'analyze', '--pillar3-only', '--baseline', BASELINE_PATH, '--out', SCAN_PATH,
  ]);
  if (!result.ok) {
    throw new Error(`scan failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }
  return JSON.parse(readFileSync(SCAN_PATH, 'utf8'));
}

function loadWatches() {
  if (!existsSync(WATCHES_PATH)) return {};
  try {
    const data = JSON.parse(readFileSync(WATCHES_PATH, 'utf8'));
    return data.watches || {};
  } catch (e) {
    process.stderr.write(`[watch] could not load watches.json: ${e.message}; starting fresh\n`);
    return {};
  }
}

function saveWatches(watches) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    WATCHES_PATH,
    JSON.stringify({ schema_version: 1, updated_at: new Date().toISOString(), watches }, null, 2),
  );
}

function watchKey(study, high, low) {
  return `${study}:${high}:${low}`;
}

// Snapshot writer is memoised per-tick: at most one bundle file per
// bar_time even if multiple alerts emit from the same tick.
function writeSnapshotOnce(bundle, barTime) {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const path = `${SNAPSHOT_DIR}/${barTime}.bundle.json`;
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(bundle));
  }
  return path;
}

function findInsideBoxIndex(bundle, box) {
  const list = bundle?.gates?.price_context?.inside_boxes || [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.study === box.study && b.high === box.high && b.low === box.low) return i;
  }
  return -1;
}

function buildTapAlert({ watch, lastBar, bundle, snapshotPath, insideIndex }) {
  return {
    ts: new Date().toISOString(),
    kind: 'fvg_tap',
    watch_id: watch.key,
    window_seconds: watch.window_seconds,
    bar_time: lastBar.time,
    bar_direction: lastBar.direction,
    bar_body_ratio: lastBar.body_ratio,
    close: lastBar.close,
    bundle_path: snapshotPath,
    cites: {
      close: 'gates.pillar3.last_bar.close',
      body_ratio: 'gates.pillar3.last_bar.body_ratio',
      direction: 'gates.pillar3.last_bar.direction',
      bar_time: 'gates.pillar3.last_bar.time',
      fvg_high: `gates.price_context.inside_boxes[${insideIndex}].high`,
      fvg_low: `gates.price_context.inside_boxes[${insideIndex}].low`,
    },
    fvg: { study: watch.study, high: watch.zone_high, low: watch.zone_low },
    hint: `Watch opened. Looking for a strong-bodied close within ${watch.window_seconds}s for confirmation.`,
  };
}

function buildConfirmationAlert({ watch, lastBar, bundle, snapshotPath, elapsedSec }) {
  return {
    ts: new Date().toISOString(),
    kind: 'fvg_confirmation',
    watch_id: watch.key,
    elapsed_seconds: Math.round(elapsedSec),
    bar_time: lastBar.time,
    bar_direction: lastBar.direction,
    bar_body_ratio: lastBar.body_ratio,
    close: lastBar.close,
    bundle_path: snapshotPath,
    cites: {
      close: 'gates.pillar3.last_bar.close',
      body_ratio: 'gates.pillar3.last_bar.body_ratio',
      direction: 'gates.pillar3.last_bar.direction',
      bar_time: 'gates.pillar3.last_bar.time',
    },
    tap: {
      bar_time: watch.tap_bar_time,
      close: watch.tap_bar_close,
      direction: watch.tap_bar_direction,
      body_ratio: watch.tap_bar_body_ratio,
      snapshot_path: watch.tap_snapshot_path,
    },
    fvg: { study: watch.study, high: watch.zone_high, low: watch.zone_low },
    hint: 'Confirmation candle within window. Escalate to /analyze for entry-model and direction grading.',
  };
}

function buildInvalidationAlert({ watch, elapsedSec }) {
  // Invalidation has no current-bar facts to cite; it references the
  // already-frozen tap snapshot for reproducibility (citations resolve
  // into the tap snapshot, not a fresh one).
  return {
    ts: new Date().toISOString(),
    kind: 'fvg_invalidation',
    watch_id: watch.key,
    elapsed_seconds: Math.round(elapsedSec),
    reason: 'timeout',
    bundle_path: watch.tap_snapshot_path,
    cites: {
      tap_close: 'gates.pillar3.last_bar.close',
      tap_body_ratio: 'gates.pillar3.last_bar.body_ratio',
      tap_direction: 'gates.pillar3.last_bar.direction',
      tap_bar_time: 'gates.pillar3.last_bar.time',
    },
    tap: {
      bar_time: watch.tap_bar_time,
      close: watch.tap_bar_close,
      direction: watch.tap_bar_direction,
      body_ratio: watch.tap_bar_body_ratio,
      snapshot_path: watch.tap_snapshot_path,
    },
    fvg: { study: watch.study, high: watch.zone_high, low: watch.zone_low },
    hint: 'Watch window expired without a confirmation candle.',
  };
}

function appendAlertLine(line) {
  mkdirSync(dirname(ALERTS_PATH), { recursive: true });
  writeFileSync(ALERTS_PATH, line + '\n', { flag: 'a' });
}

function emitAlert(alert) {
  const line = JSON.stringify(alert);
  appendAlertLine(line);
  process.stdout.write(line + '\n');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runWatch(opts) {
  const pollMs = opts.poll ? Number(opts.poll) * 1000 : DEFAULT_POLL_MS;
  const baselineTtl = opts['baseline-ttl'] ? Number(opts['baseline-ttl']) : DEFAULT_BASELINE_TTL_S;
  const tapBodyMin = opts['min-body-ratio'] ? Number(opts['min-body-ratio']) : DEFAULT_BODY_RATIO_MIN;
  const confirmBodyMin = opts['confirmation-body-ratio']
    ? Number(opts['confirmation-body-ratio'])
    : DEFAULT_CONFIRMATION_BODY_RATIO_MIN;
  const windowSeconds = opts['window-seconds']
    ? Number(opts['window-seconds'])
    : DEFAULT_WINDOW_SECONDS;
  const allows = {
    allowOutsideKillzone: opts['allow-outside-killzone'] === true,
    allowPoorQuality: opts['allow-poor-quality'] === true,
    allowMarketClosed: opts['allow-market-closed'] === true,
  };

  mkdirSync(STATE_DIR, { recursive: true });

  captureBaseline();
  let baselineCapturedMs = Date.now();

  let watches = loadWatches();
  let lastSeenBarTime = null;
  let tickCount = 0;

  const gateSummary =
    `killzone=${allows.allowOutsideKillzone ? 'off' : 'on'} ` +
    `quality=${allows.allowPoorQuality ? 'off' : 'on'} ` +
    `market_closed=${allows.allowMarketClosed ? 'off' : 'on'}`;
  process.stderr.write(
    `[watch] started — poll=${pollMs / 1000}s baseline_ttl=${baselineTtl}s ` +
      `tap_min=${tapBodyMin} confirm_min=${confirmBodyMin} window=${windowSeconds}s\n`,
  );
  process.stderr.write(`[watch] context gates: ${gateSummary}\n`);
  process.stderr.write(
    `[watch] loaded ${Object.keys(watches).length} open watch(es) from ${WATCHES_PATH}\n`,
  );
  process.stderr.write('[watch] alerts -> stdout (JSON-line) + state/watch/alerts.jsonl. Ctrl+C to stop.\n');

  while (true) {
    try {
      const baselineAgeS = Math.floor((Date.now() - baselineCapturedMs) / 1000);
      if (baselineAgeS > baselineTtl) {
        captureBaseline();
        baselineCapturedMs = Date.now();
      }

      const bundle = captureScan();
      tickCount++;
      const lastBar = bundle?.gates?.pillar3?.last_bar;
      const barTime = lastBar?.time ?? null;
      const isNewBar = barTime != null && barTime !== lastSeenBarTime;
      const isFirstBar = isNewBar && lastSeenBarTime == null;
      if (isNewBar) lastSeenBarTime = barTime;

      let snapshotPath = null;
      const ensureSnapshot = () => {
        if (snapshotPath == null) snapshotPath = writeSnapshotOnce(bundle, barTime);
        return snapshotPath;
      };
      const alerts = [];
      let stateDirty = false;

      // (a) Invalidations — every tick, irrespective of new-bar or gates.
      // Watch timers keep running through session boundaries; once the
      // strategy has armed a setup, the clock doesn't pause.
      const nowMs = Date.now();
      for (const [key, watch] of Object.entries({ ...watches })) {
        const elapsedSec = (nowMs - new Date(watch.opened_at).getTime()) / 1000;
        if (elapsedSec > watch.window_seconds) {
          alerts.push(buildInvalidationAlert({ watch, elapsedSec }));
          delete watches[key];
          stateDirty = true;
        }
      }

      // (b) Confirmations — only on a new bar close, irrespective of gates.
      // Existing watches keep evaluating regardless of context.
      if (isNewBar && !isFirstBar && lastBar && lastBar.body_ratio >= confirmBodyMin) {
        for (const [key, watch] of Object.entries({ ...watches })) {
          const elapsedSec = (nowMs - new Date(watch.opened_at).getTime()) / 1000;
          alerts.push(
            buildConfirmationAlert({
              watch, lastBar, bundle, snapshotPath: ensureSnapshot(), elapsedSec,
            }),
          );
          delete watches[key];
          stateDirty = true;
        }
      }

      // (c) New taps — only on new bar, only when context gates pass.
      let skipReason = null;
      if (isNewBar && !isFirstBar) {
        skipReason = shouldSkipByContext(bundle, allows);
        if (!skipReason && lastBar && lastBar.body_ratio >= tapBodyMin) {
          const insideList = bundle?.gates?.price_context?.inside_boxes || [];
          for (let i = 0; i < insideList.length; i++) {
            const box = insideList[i];
            if (!/FVG/i.test(box.study)) continue;
            const key = watchKey(box.study, box.high, box.low);
            if (watches[key]) continue; // already watching this zone
            const watch = {
              key,
              study: box.study,
              zone_high: box.high,
              zone_low: box.low,
              tap_bar_time: lastBar.time,
              tap_bar_close: lastBar.close,
              tap_bar_direction: lastBar.direction,
              tap_bar_body_ratio: lastBar.body_ratio,
              tap_snapshot_path: ensureSnapshot(),
              opened_at: new Date().toISOString(),
              window_seconds: windowSeconds,
              status: 'open',
            };
            watches[key] = watch;
            alerts.push(
              buildTapAlert({ watch, lastBar, bundle, snapshotPath: ensureSnapshot(), insideIndex: i }),
            );
            stateDirty = true;
          }
        }
      }

      // (d) Emit + persist + log.
      for (const a of alerts) emitAlert(a);
      if (stateDirty) saveWatches(watches);

      if (isFirstBar) {
        process.stderr.write(
          `[watch] tick ${tickCount} bar=${barTime} (initial baseline; not evaluating)\n`,
        );
      } else if (alerts.length > 0) {
        const kinds = alerts.map((a) => a.kind).join(',');
        process.stderr.write(
          `[watch] tick ${tickCount} bar=${barTime} emitted ${alerts.length} alert(s) [${kinds}]; open=${Object.keys(watches).length}\n`,
        );
      } else if (isNewBar) {
        if (skipReason) {
          process.stderr.write(
            `[watch] tick ${tickCount} bar=${barTime} skipped: ${skipReason}; open=${Object.keys(watches).length}\n`,
          );
        } else {
          const insideFvgCount = (bundle?.gates?.price_context?.inside_boxes || [])
            .filter((b) => /FVG/i.test(b.study)).length;
          process.stderr.write(
            `[watch] tick ${tickCount} bar=${barTime} no-event (body=${lastBar?.body_ratio} dir=${lastBar?.direction} fvgs_inside=${insideFvgCount}); open=${Object.keys(watches).length}\n`,
          );
        }
      }
    } catch (e) {
      process.stderr.write(`[watch] tick error: ${e.message}\n`);
    }
    await sleep(pollMs);
  }
}

register('watch', {
  description:
    'Long-running watchman with tap/confirmation/invalidation state machine per FVG zone. Strategy §6: "Price taps your chosen PD array. Within 10–15 minutes, you get a strong 1m/5m close." Emits JSON-line alerts to stdout (also appended to state/watch/alerts.jsonl). State persisted to state/watch/watches.json across restarts. Stop with Ctrl+C.',
  options: {
    poll: { type: 'string', description: 'Poll interval in seconds (default 10).' },
    'baseline-ttl': { type: 'string', description: 'Refresh baseline when older than N seconds (default 900 = 15 min).' },
    'min-body-ratio': { type: 'string', description: 'Minimum last_bar.body_ratio for a new TAP (default 0.5; strategy: "clear body, not a doji").' },
    'confirmation-body-ratio': { type: 'string', description: 'Minimum last_bar.body_ratio for a CONFIRMATION close (default 0.6; stricter than tap because confirmation should show displacement).' },
    'window-seconds': { type: 'string', description: 'Watch window length in seconds (default 900 = 15 min; strategy §6 upper bound).' },
    'allow-outside-killzone': { type: 'boolean', description: 'Opt out of the killzone gate (applies to new TAPS only; existing watches keep ticking).' },
    'allow-poor-quality': { type: 'boolean', description: 'Opt out of the price-quality gate (applies to new TAPS only).' },
    'allow-market-closed': { type: 'boolean', description: 'Opt out of the market-closed gate (applies to new TAPS only).' },
  },
  handler: async (opts) => {
    await runWatch(opts || {});
    process.exit(0); // unreachable
  },
});
