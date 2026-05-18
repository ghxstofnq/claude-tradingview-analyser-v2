import { register } from '../router.js';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

/**
 * tv watch — long-running watchman with multi-TF tap/confirmation/invalidation
 * state machine, strictly aligned with Lanto's 3-pillar ICT framework.
 *
 * Strategy basis (re-read 2026-05-18):
 *   - trading-strategy-2026.md §2.1: HTF tools = FVGs, BPRs, iFVGs, +
 *     buy-side/sell-side liquidity. Watchman taps trigger on any PD array.
 *   - §2.2/§2.3 + §3 + §7 step 3: context gates (killzone + price quality)
 *     filter NEW tap creation; existing watches keep ticking through.
 *   - §2.4: HTF context can sit intraday. No 15-min auto-refresh; baseline
 *     refreshes once at startup + at session boundaries (03:00 / 09:00 /
 *     13:00 ET) + on demand.
 *   - §5 + §6 step 6 + entry-models.md: confirmation discipline is on 1m
 *     AND 5m close. Watchman runs per-1m scan; switches to 5m for ~2-3s at
 *     every 5m boundary. Cross-TF confirmation allowed: a 1m bar can
 *     confirm a 5m watch and vice versa (MSS A+ example: 5m FVG + 1m
 *     confirmation candle).
 *
 * Chart ownership: the chart MUST be on 1m. If the user changes the TF
 * manually, the watchman snaps it back to 1m on the next tick and logs.
 * The user's 5m visual view is not supported simultaneously — use a
 * separate tab/pane if needed.
 *
 * Lifecycle per PD-array zone (key = `${tf}:${study}:${high}:${low}`):
 *   1. pd_array_tap        — wick overlap with zone + body >= --min-body-ratio,
 *                            while context gates pass. Opens a watch keyed by
 *                            the bar's TF (1m or 5m).
 *   2. pd_array_confirmation — within --window-seconds, ANY new bar (1m or 5m)
 *                            with body >= --confirmation-body-ratio whose
 *                            close is within --confirmation-proximity zone-
 *                            heights of the zone. Closes the watch.
 *   3. pd_array_invalidation — --window-seconds elapse with no confirmation.
 *
 * Direction match and entry-model classification (MSS / Trend / Inversion)
 * stay in the LLM via /analyze. The watchman fires candidates with full
 * direction metadata (fvg_direction) for downstream grading.
 *
 * Persistence:
 *   - state/watch/baseline.json        — captured at startup + session boundaries
 *   - state/watch/last-scan.json       — rolling per-tick scan; NOT cited
 *   - state/watch/snapshots/<bar_time>_<tf>.bundle.json — frozen per-event
 *   - state/watch/watches.json         — open watches (schema_version 2)
 *   - state/watch/alerts.jsonl         — append-only history
 */

const DEFAULT_POLL_MS = 10_000;
const DEFAULT_BODY_RATIO_MIN = 0.5;
const DEFAULT_CONFIRMATION_BODY_RATIO_MIN = 0.6;
const DEFAULT_WINDOW_SECONDS = 900; // 15 min (strategy §6 upper bound)
const DEFAULT_CONFIRMATION_PROXIMITY = 1.0;

// Session-boundary refresh times in ET. Strategy §2.1 + §2.4: HTF context
// reused intraday EXCEPT at major session boundaries. User's chosen lead-in:
// 30 min before each killzone opens.
const SESSION_REFRESH_TIMES_ET = [
  { hour: 3,  minute: 0,  label: 'London Open prep' },     // London KZ opens 03:00
  { hour: 9,  minute: 0,  label: 'NY AM prep' },           // NY AM KZ opens 08:30; user prefers 09:00
  { hour: 13, minute: 0,  label: 'NY PM prep' },           // NY PM KZ opens 13:30; user prefers 13:00
];

// PD-array studies for tap detection. Strategy §2.1 names FVGs, BPRs, and
// iFVGs as the same class of HTF tools. iFVGs come from the same FVG
// indicator (Nephew_Sam_); BPR is its own indicator. Anything matching this
// pattern is a valid tap target.
const PD_ARRAY_PATTERN = /FVG|BPR|Balanced Price Range/i;

// Home TF — watchman snaps chart back to this if user changes it.
const HOME_TF = '1';

const STATE_DIR = 'state/watch';
const BASELINE_PATH = `${STATE_DIR}/baseline.json`;
const SCAN_PATH = `${STATE_DIR}/last-scan.json`;
const SCAN_5M_PATH = `${STATE_DIR}/last-scan-5m.json`;
const ALERTS_PATH = `${STATE_DIR}/alerts.jsonl`;
const SNAPSHOT_DIR = `${STATE_DIR}/snapshots`;
const WATCHES_PATH = `${STATE_DIR}/watches.json`;

const STATE_SCHEMA_VERSION = 2;

// Context gates default to ACTIVE (conservative); user opts out via flags.
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

function captureBaseline(reason = 'startup') {
  const t0 = Date.now();
  process.stderr.write(`[watch] refreshing baseline (${reason}; chart will flash through 6 TFs)...\n`);
  const result = runCli(['analyze', '--out', BASELINE_PATH]);
  if (!result.ok) {
    throw new Error(`baseline capture failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  process.stderr.write(`[watch] baseline refreshed in ${dt}s -> ${BASELINE_PATH}\n`);
}

// Capture at chart's CURRENT TF (no switch). For per-1m scans.
function captureScan() {
  const result = runCli([
    'analyze', '--pillar3-only', '--baseline', BASELINE_PATH, '--out', SCAN_PATH,
  ]);
  if (!result.ok) {
    throw new Error(`scan failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }
  return JSON.parse(readFileSync(SCAN_PATH, 'utf8'));
}

// Capture by briefly switching the chart to the requested TF. ~2-3s flash.
// Used by 5m boundary cadence. Restores TF before returning.
function captureScanAtTf(tf) {
  const out = tf === '5' ? SCAN_5M_PATH : `${STATE_DIR}/last-scan-${tf}.json`;
  const result = runCli([
    'analyze', '--pillar3-only', '--baseline', BASELINE_PATH,
    '--scan-tf', tf, '--out', out,
  ]);
  if (!result.ok) {
    throw new Error(`scan-tf=${tf} failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }
  return JSON.parse(readFileSync(out, 'utf8'));
}

// Schema migrations. Each function takes the prior schema's `watches` object
// and returns the current-schema version. Chained on load so multi-version
// upgrades work in one pass. Keep upgrades small and additive — losing armed
// watches across a deploy is a real cost (15 min of strategy state).
function migrateV1toV2(watchesV1) {
  // v1 key: "study:high:low" (no TF — implicit 1m).
  // v2 key: "tf:study:high:low" with each watch object gaining `tf: "1m"`.
  const out = {};
  for (const [oldKey, watch] of Object.entries(watchesV1 || {})) {
    const newKey = `1m:${oldKey}`;
    out[newKey] = { ...watch, tf: '1m', key: newKey };
  }
  return out;
}

function loadWatches() {
  if (!existsSync(WATCHES_PATH)) return {};
  try {
    const data = JSON.parse(readFileSync(WATCHES_PATH, 'utf8'));
    let watches = data.watches || {};
    let version = data.schema_version;
    if (version === STATE_SCHEMA_VERSION) return watches;
    if (version === 1) {
      process.stderr.write(`[watch] migrating watches.json v1 → v2 (adding tf prefix to keys)\n`);
      watches = migrateV1toV2(watches);
      version = 2;
    }
    if (version !== STATE_SCHEMA_VERSION) {
      process.stderr.write(
        `[watch] watches.json schema_version is ${data.schema_version}, expected ${STATE_SCHEMA_VERSION}; discarding.\n`,
      );
      return {};
    }
    return watches;
  } catch (e) {
    process.stderr.write(`[watch] could not load watches.json: ${e.message}; starting fresh\n`);
    return {};
  }
}

function saveWatches(watches) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    WATCHES_PATH,
    JSON.stringify({ schema_version: STATE_SCHEMA_VERSION, updated_at: new Date().toISOString(), watches }, null, 2),
  );
}

function watchKey(tf, study, high, low) {
  return `${tf}:${study}:${high}:${low}`;
}

function writeSnapshotOnce(bundle, barTime, tf) {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const path = `${SNAPSHOT_DIR}/${barTime}_${tf}.bundle.json`;
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(bundle));
  }
  return path;
}

// Delete snapshot files older than `retainDays` days. Snapshots accumulate
// indefinitely otherwise — each tap creates a file, hundreds per busy
// session. Retention default 7 days is plenty for "review yesterday";
// any alert older than that whose snapshot is gone gets a dangling
// bundle_path (still informational, just not re-citable).
function cleanupOldSnapshots(retainDays) {
  if (retainDays <= 0) return { kept: 0, deleted: 0 };
  if (!existsSync(SNAPSHOT_DIR)) return { kept: 0, deleted: 0 };
  const cutoffMs = Date.now() - retainDays * 86400 * 1000;
  let kept = 0;
  let deleted = 0;
  for (const f of readdirSync(SNAPSHOT_DIR)) {
    const full = `${SNAPSHOT_DIR}/${f}`;
    try {
      const st = statSync(full);
      if (st.mtimeMs < cutoffMs) {
        unlinkSync(full);
        deleted++;
      } else {
        kept++;
      }
    } catch (e) {
      // Best-effort: a vanished file from a concurrent write is fine to skip.
    }
  }
  return { kept, deleted };
}

// Proximity classifier: bar.close inside the zone OR within margin × zone_height.
function classifyCloseProximity(close, zoneLow, zoneHigh, proximityMult) {
  const zoneHeight = zoneHigh - zoneLow;
  if (zoneHeight <= 0) return { near: false, distance: null };
  let distance;
  if (close < zoneLow) distance = zoneLow - close;
  else if (close > zoneHigh) distance = close - zoneHigh;
  else distance = -Math.min(close - zoneLow, zoneHigh - close);
  const margin = zoneHeight * proximityMult;
  return { near: distance <= margin, distance: Math.round(distance * 100) / 100 };
}

// Tap alert — always grouped. One alert per (bar_time, tf, kind); the
// `zones[]` array carries each zone-specific entry. Even single-zone
// taps go through this shape so downstream consumers parse one schema.
// Saw multi-zone taps live (2026-05-18 10:30 ET: bullish bar tapped both
// a bullish_fvg and a bullish_ifvg simultaneously — strategically ONE
// event, two zones).
function buildTapAlertGrouped({ lastBar, snapshotPath, entries, tf, windowSeconds }) {
  return {
    ts: new Date().toISOString(),
    kind: 'pd_array_tap',
    tf,
    bar_time: lastBar.time,
    bar_direction: lastBar.direction,
    bar_body_ratio: lastBar.body_ratio,
    close: lastBar.close,
    window_seconds: windowSeconds,
    bundle_path: snapshotPath,
    cites: {
      close: 'gates.pillar3.last_bar.close',
      body_ratio: 'gates.pillar3.last_bar.body_ratio',
      direction: 'gates.pillar3.last_bar.direction',
      bar_time: 'gates.pillar3.last_bar.time',
    },
    zones: entries.map(({ watch, tappedIndex }) => ({
      watch_id: watch.key,
      study: watch.study,
      high: watch.zone_high,
      low: watch.zone_low,
      direction: watch.fvg_direction || 'unknown',
      cites: {
        zone_high: `gates.price_context.wick_tapped_boxes[${tappedIndex}].high`,
        zone_low: `gates.price_context.wick_tapped_boxes[${tappedIndex}].low`,
      },
    })),
    hint: entries.length > 1
      ? `${entries.length} PD-array zones tapped simultaneously on ${tf}. Watching all for confirmation within ${windowSeconds}s (1m or 5m).`
      : `Watch opened on ${tf} tap. Looking for a strong-bodied close within ${windowSeconds}s (1m or 5m) for confirmation.`,
  };
}

function buildConfirmationAlertGrouped({ lastBar, snapshotPath, entries, confirmTf }) {
  return {
    ts: new Date().toISOString(),
    kind: 'pd_array_confirmation',
    confirm_tf: confirmTf,
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
    zones: entries.map(({ watch, elapsedSec, distance }) => ({
      watch_id: watch.key,
      watch_tf: watch.tf,
      elapsed_seconds: Math.round(elapsedSec),
      close_distance_from_zone: distance,
      pd_array: {
        study: watch.study,
        high: watch.zone_high,
        low: watch.zone_low,
        direction: watch.fvg_direction || 'unknown',
      },
      tap: {
        tf: watch.tf,
        bar_time: watch.tap_bar_time,
        close: watch.tap_bar_close,
        direction: watch.tap_bar_direction,
        body_ratio: watch.tap_bar_body_ratio,
        snapshot_path: watch.tap_snapshot_path,
      },
    })),
    hint: entries.length > 1
      ? `Confirmation candle (${confirmTf}) within window confirmed ${entries.length} zones. Escalate to /analyze for entry-model grading.`
      : `Confirmation candle (${confirmTf}) within window and near zone. Escalate to /analyze for entry-model and direction grading.`,
  };
}

function buildInvalidationAlert({ watch, elapsedSec }) {
  return {
    ts: new Date().toISOString(),
    kind: 'pd_array_invalidation',
    watch_id: watch.key,
    watch_tf: watch.tf,
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
      tf: watch.tf,
      bar_time: watch.tap_bar_time,
      close: watch.tap_bar_close,
      direction: watch.tap_bar_direction,
      body_ratio: watch.tap_bar_body_ratio,
      snapshot_path: watch.tap_snapshot_path,
    },
    pd_array: { study: watch.study, high: watch.zone_high, low: watch.zone_low, direction: watch.fvg_direction || 'unknown' },
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

// ET clock helpers. Strategy operates in ET. Wall-clock is the source of truth
// for session-boundary refresh (not bar.time, which depends on data flow).
function nowET() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

// Returns the matching session-boundary entry if now is within ±30s of one,
// else null. Used to fire baseline refresh exactly at session start.
function matchSessionBoundary(et) {
  for (const b of SESSION_REFRESH_TIMES_ET) {
    if (et.hour === b.hour && et.minute === b.minute && et.second < 30) return b;
  }
  return null;
}

// Get current chart TF via the CLI (subprocess).
function currentChartTf() {
  const r = runCli(['state']);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.stdout).resolution || null;
  } catch (e) {
    return null;
  }
}

function snapChartTo(tf) {
  const r = runCli(['timeframe', tf]);
  return r.ok;
}

async function runWatch(opts) {
  const pollMs = opts.poll ? Number(opts.poll) * 1000 : DEFAULT_POLL_MS;
  const tapBodyMin = opts['min-body-ratio'] ? Number(opts['min-body-ratio']) : DEFAULT_BODY_RATIO_MIN;
  const confirmBodyMin = opts['confirmation-body-ratio']
    ? Number(opts['confirmation-body-ratio'])
    : DEFAULT_CONFIRMATION_BODY_RATIO_MIN;
  const windowSeconds = opts['window-seconds']
    ? Number(opts['window-seconds'])
    : DEFAULT_WINDOW_SECONDS;
  const confirmProximity = opts['confirmation-proximity']
    ? Number(opts['confirmation-proximity'])
    : DEFAULT_CONFIRMATION_PROXIMITY;
  const allows = {
    allowOutsideKillzone: opts['allow-outside-killzone'] === true,
    allowPoorQuality: opts['allow-poor-quality'] === true,
    allowMarketClosed: opts['allow-market-closed'] === true,
  };
  const snapshotRetainDays = opts['snapshot-retention-days']
    ? Number(opts['snapshot-retention-days'])
    : 7;

  mkdirSync(STATE_DIR, { recursive: true });

  // Startup snapshot cleanup. Snapshots accumulate one-per-tap; without
  // retention the dir grows forever.
  {
    const { kept, deleted } = cleanupOldSnapshots(snapshotRetainDays);
    if (deleted > 0) {
      process.stderr.write(`[watch] startup cleanup: removed ${deleted} snapshot(s) older than ${snapshotRetainDays}d; kept ${kept}\n`);
    }
  }

  // Snap chart to 1m before baseline so the baseline's "original TF" is 1m,
  // which is what we want it restored to on every analyze call.
  const initialTf = currentChartTf();
  if (initialTf !== HOME_TF) {
    process.stderr.write(`[watch] chart was on ${initialTf}; snapping to ${HOME_TF}m\n`);
    snapChartTo(HOME_TF);
    await sleep(500);
  }

  captureBaseline('startup');
  let watches = loadWatches();
  let lastSeenBarTime1m = null;
  let lastSeenBarTime5m = null;
  let tickCount = 0;
  let lastBoundaryRefresh = null; // dateKey:label of last fired

  const gateSummary =
    `killzone=${allows.allowOutsideKillzone ? 'off' : 'on'} ` +
    `quality=${allows.allowPoorQuality ? 'off' : 'on'} ` +
    `market_closed=${allows.allowMarketClosed ? 'off' : 'on'}`;
  process.stderr.write(
    `[watch] started — poll=${pollMs / 1000}s ` +
      `tap_min=${tapBodyMin} confirm_min=${confirmBodyMin} window=${windowSeconds}s ` +
      `confirm_proximity=${confirmProximity}\n`,
  );
  process.stderr.write(`[watch] context gates: ${gateSummary}\n`);
  process.stderr.write(
    `[watch] HTF baseline auto-refresh: startup + 03:00 / 09:00 / 13:00 ET (manual: ./bin/tv watch --refresh-now or touch state/watch/refresh-now)\n`,
  );
  process.stderr.write(
    `[watch] loaded ${Object.keys(watches).length} open watch(es) from ${WATCHES_PATH}\n`,
  );
  process.stderr.write('[watch] alerts -> stdout (JSON-line) + state/watch/alerts.jsonl. Ctrl+C to stop.\n');

  while (true) {
    try {
      // ====================================================================
      // (1) Session-boundary baseline refresh check + manual sentinel.
      // ====================================================================
      const et = nowET();
      const boundary = matchSessionBoundary(et);
      const boundaryKey = boundary ? `${et.dateKey}:${boundary.label}` : null;
      if (boundary && boundaryKey !== lastBoundaryRefresh) {
        captureBaseline(`session boundary ${boundary.label} (${et.hour}:${String(et.minute).padStart(2,'0')} ET)`);
        const { deleted } = cleanupOldSnapshots(snapshotRetainDays);
        if (deleted > 0) {
          process.stderr.write(`[watch] boundary cleanup: removed ${deleted} snapshot(s) older than ${snapshotRetainDays}d\n`);
        }
        lastBoundaryRefresh = boundaryKey;
      }
      const sentinel = `${STATE_DIR}/refresh-now`;
      if (existsSync(sentinel)) {
        captureBaseline('manual sentinel');
        try { unlinkSync(sentinel); } catch (e) {}
      }

      // ====================================================================
      // (2) Chart TF enforcement: snap back to 1m if user changed it.
      // ====================================================================
      const tfNow = currentChartTf();
      if (tfNow && tfNow !== HOME_TF) {
        process.stderr.write(`[watch] chart TF was ${tfNow}, snapping back to ${HOME_TF}m\n`);
        snapChartTo(HOME_TF);
        await sleep(500);
      }

      // ====================================================================
      // (3) 1m scan — every tick.
      // ====================================================================
      const scan1m = captureScan();
      tickCount++;
      const last1m = scan1m?.gates?.pillar3?.last_bar;
      const barTime1m = last1m?.time ?? null;
      const isNewBar1m = barTime1m != null && barTime1m !== lastSeenBarTime1m;
      const isFirstBar1m = isNewBar1m && lastSeenBarTime1m == null;
      if (isNewBar1m) lastSeenBarTime1m = barTime1m;

      const alerts = [];
      let stateDirty = false;
      const nowMs = Date.now();

      // ====================================================================
      // (3a) Confirmations against the 1m bar (any open watch, cross-TF).
      // Runs BEFORE invalidations so a bar at the window boundary gets its
      // shot to confirm.
      // ====================================================================
      let snapshot1mPath = null;
      const ensure1mSnapshot = () => {
        if (snapshot1mPath == null) snapshot1mPath = writeSnapshotOnce(scan1m, barTime1m, '1m');
        return snapshot1mPath;
      };
      if (isNewBar1m && !isFirstBar1m && last1m && last1m.body_ratio >= confirmBodyMin) {
        const confirmEntries1m = [];
        for (const [key, watch] of Object.entries({ ...watches })) {
          const { near, distance } = classifyCloseProximity(
            last1m.close, watch.zone_low, watch.zone_high, confirmProximity,
          );
          if (!near) continue;
          const elapsedSec = (nowMs - new Date(watch.opened_at).getTime()) / 1000;
          confirmEntries1m.push({ watch, elapsedSec, distance });
          delete watches[key];
          stateDirty = true;
        }
        if (confirmEntries1m.length > 0) {
          alerts.push(
            buildConfirmationAlertGrouped({ lastBar: last1m, snapshotPath: ensure1mSnapshot(), entries: confirmEntries1m, confirmTf: '1m' }),
          );
        }
      }

      // ====================================================================
      // (3b) Invalidations — every tick (timer-based, independent of bar).
      // ====================================================================
      for (const [key, watch] of Object.entries({ ...watches })) {
        const elapsedSec = (nowMs - new Date(watch.opened_at).getTime()) / 1000;
        if (elapsedSec > watch.window_seconds) {
          alerts.push(buildInvalidationAlert({ watch, elapsedSec }));
          delete watches[key];
          stateDirty = true;
        }
      }

      // ====================================================================
      // (3c) New 1m taps — only on new bar, only when context gates pass.
      // ====================================================================
      let skipReason1m = null;
      if (isNewBar1m && !isFirstBar1m) {
        skipReason1m = shouldSkipByContext(scan1m, allows);
        if (!skipReason1m && last1m && last1m.body_ratio >= tapBodyMin) {
          const tapped = scan1m?.gates?.price_context?.wick_tapped_boxes || [];
          const tapEntries1m = [];
          for (let i = 0; i < tapped.length; i++) {
            const box = tapped[i];
            if (!PD_ARRAY_PATTERN.test(box.study)) continue;
            const key = watchKey('1m', box.study, box.high, box.low);
            if (watches[key]) continue;
            const watch = {
              key,
              tf: '1m',
              study: box.study,
              zone_high: box.high,
              zone_low: box.low,
              fvg_direction: box.fvg_direction || 'unknown',
              tap_bar_time: last1m.time,
              tap_bar_close: last1m.close,
              tap_bar_direction: last1m.direction,
              tap_bar_body_ratio: last1m.body_ratio,
              tap_snapshot_path: ensure1mSnapshot(),
              opened_at: new Date().toISOString(),
              window_seconds: windowSeconds,
              status: 'open',
            };
            watches[key] = watch;
            tapEntries1m.push({ watch, tappedIndex: i });
            stateDirty = true;
          }
          if (tapEntries1m.length > 0) {
            alerts.push(buildTapAlertGrouped({ lastBar: last1m, snapshotPath: ensure1mSnapshot(), entries: tapEntries1m, tf: '1m', windowSeconds }));
          }
        }
      }

      // ====================================================================
      // (4) 5m boundary: if barTime1m % 300 == 0, the 5m bar also just
      // closed. Switch chart to 5m, scan, switch back, then evaluate against
      // the 5m bar (cross-TF confirmation + new 5m taps).
      // ====================================================================
      if (isNewBar1m && !isFirstBar1m && barTime1m % 300 === 0) {
        let scan5m;
        try {
          scan5m = captureScanAtTf('5');
        } catch (e) {
          process.stderr.write(`[watch] 5m scan failed: ${e.message}\n`);
          scan5m = null;
        }
        if (scan5m) {
          const last5m = scan5m?.gates?.pillar3?.last_bar;
          const barTime5m = last5m?.time ?? null;
          const isNewBar5m = barTime5m != null && barTime5m !== lastSeenBarTime5m;
          if (isNewBar5m) lastSeenBarTime5m = barTime5m;

          let snapshot5mPath = null;
          const ensure5mSnapshot = () => {
            if (snapshot5mPath == null) snapshot5mPath = writeSnapshotOnce(scan5m, barTime5m, '5m');
            return snapshot5mPath;
          };

          // (4a) Confirmations against the 5m bar (any open watch, cross-TF).
          if (isNewBar5m && last5m && last5m.body_ratio >= confirmBodyMin) {
            const confirmEntries5m = [];
            for (const [key, watch] of Object.entries({ ...watches })) {
              const { near, distance } = classifyCloseProximity(
                last5m.close, watch.zone_low, watch.zone_high, confirmProximity,
              );
              if (!near) continue;
              const elapsedSec = (nowMs - new Date(watch.opened_at).getTime()) / 1000;
              confirmEntries5m.push({ watch, elapsedSec, distance });
              delete watches[key];
              stateDirty = true;
            }
            if (confirmEntries5m.length > 0) {
              alerts.push(
                buildConfirmationAlertGrouped({ lastBar: last5m, snapshotPath: ensure5mSnapshot(), entries: confirmEntries5m, confirmTf: '5m' }),
              );
            }
          }

          // (4b) New 5m taps.
          const skipReason5m = shouldSkipByContext(scan5m, allows);
          if (!skipReason5m && last5m && last5m.body_ratio >= tapBodyMin) {
            const tapped5m = scan5m?.gates?.price_context?.wick_tapped_boxes || [];
            const tapEntries5m = [];
            for (let i = 0; i < tapped5m.length; i++) {
              const box = tapped5m[i];
              if (!PD_ARRAY_PATTERN.test(box.study)) continue;
              const key = watchKey('5m', box.study, box.high, box.low);
              if (watches[key]) continue;
              const watch = {
                key,
                tf: '5m',
                study: box.study,
                zone_high: box.high,
                zone_low: box.low,
                fvg_direction: box.fvg_direction || 'unknown',
                tap_bar_time: last5m.time,
                tap_bar_close: last5m.close,
                tap_bar_direction: last5m.direction,
                tap_bar_body_ratio: last5m.body_ratio,
                tap_snapshot_path: ensure5mSnapshot(),
                opened_at: new Date().toISOString(),
                window_seconds: windowSeconds,
                status: 'open',
              };
              watches[key] = watch;
              tapEntries5m.push({ watch, tappedIndex: i });
              stateDirty = true;
            }
            if (tapEntries5m.length > 0) {
              alerts.push(buildTapAlertGrouped({ lastBar: last5m, snapshotPath: ensure5mSnapshot(), entries: tapEntries5m, tf: '5m', windowSeconds }));
            }
          }
        }
      }

      // ====================================================================
      // (5) Emit + persist + log.
      // ====================================================================
      for (const a of alerts) emitAlert(a);
      if (stateDirty) saveWatches(watches);

      if (isFirstBar1m) {
        process.stderr.write(`[watch] tick ${tickCount} bar=${barTime1m} (initial baseline; not evaluating)\n`);
      } else if (alerts.length > 0) {
        const kinds = alerts.map((a) => `${a.kind}(${a.tf || a.confirm_tf || a.watch_tf || '?'})`).join(',');
        process.stderr.write(
          `[watch] tick ${tickCount} bar=${barTime1m} emitted ${alerts.length} alert(s) [${kinds}]; open=${Object.keys(watches).length}\n`,
        );
      } else if (isNewBar1m) {
        if (skipReason1m) {
          process.stderr.write(
            `[watch] tick ${tickCount} bar=${barTime1m} skipped: ${skipReason1m}; open=${Object.keys(watches).length}\n`,
          );
        } else {
          const pdInsideCount = (scan1m?.gates?.price_context?.wick_tapped_boxes || [])
            .filter((b) => PD_ARRAY_PATTERN.test(b.study)).length;
          process.stderr.write(
            `[watch] tick ${tickCount} bar=${barTime1m} no-event (body=${last1m?.body_ratio} dir=${last1m?.direction} pd_arrays_tapped=${pdInsideCount}); open=${Object.keys(watches).length}\n`,
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
    'Long-running watchman with multi-TF tap/confirmation/invalidation state machine per PD array (FVG + iFVG + BPR). Chart locked to 1m; flips to 5m for ~2-3s at each 5m boundary. Cross-TF confirmation: a 1m close can confirm a 5m watch and vice versa. HTF baseline refreshes at startup + 03:00 / 09:00 / 13:00 ET + on demand. Emits JSON-line alerts to stdout + state/watch/alerts.jsonl. State persists across restart.',
  options: {
    poll: { type: 'string', description: 'Poll interval in seconds (default 10).' },
    'min-body-ratio': { type: 'string', description: 'Minimum last_bar.body_ratio for a new TAP (default 0.5; strategy: "clear body, not a doji").' },
    'confirmation-body-ratio': { type: 'string', description: 'Minimum last_bar.body_ratio for a CONFIRMATION close (default 0.6).' },
    'window-seconds': { type: 'string', description: 'Watch window length in seconds (default 900 = 15 min; strategy §6 upper bound).' },
    'confirmation-proximity': { type: 'string', description: 'How close the confirmation bar\'s close must be to the PD-array zone, in multiples of zone height (default 1.0).' },
    'allow-outside-killzone': { type: 'boolean', description: 'Opt out of the killzone gate (applies to new TAPS only).' },
    'allow-poor-quality': { type: 'boolean', description: 'Opt out of the price-quality gate (applies to new TAPS only).' },
    'allow-market-closed': { type: 'boolean', description: 'Opt out of the market-closed gate (applies to new TAPS only).' },
    'snapshot-retention-days': { type: 'string', description: 'Delete snapshot bundles older than N days at startup and at each session-boundary refresh (default 7). Set 0 to disable.' },
  },
  handler: async (opts) => {
    await runWatch(opts || {});
    process.exit(0); // unreachable
  },
});
