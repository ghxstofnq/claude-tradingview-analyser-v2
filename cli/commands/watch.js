import { register } from '../router.js';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

/**
 * tv watch — long-running watchman for live bar-close polling.
 *
 * Strategy basis (docs/strategy/trading-strategy-2026.md §5, §7 step 6;
 * entry-models.md "Entry Confirmation (1m/5m)"):
 *   Pillar 3 confirmation runs on 1m/5m candle close. Once HTF context
 *   (Pillar 1 + 2) is set, the watchman scans every bar close for the
 *   precondition shared by all three entry models — a bar closing inside or
 *   near a PD array with a clear body (not a doji).
 *
 * Architecture:
 *   - Initial: full `tv analyze` baseline (~13s, switches chart through D/4H/1H/15m/5m/1m).
 *   - Each tick: `tv analyze --pillar3-only --baseline <path>` (~0.2s).
 *   - Baseline refresh: every --baseline-ttl seconds (default 900 = 15min,
 *     per CLAUDE.md analyze recipe). Strategy §2.4 explicitly allows reusing
 *     HTF context intraday.
 *
 * Detection (deliberately direction-agnostic and model-agnostic):
 *   - Bar close (last_bar.time changed since last tick), AND
 *   - last_bar.body_ratio >= --min-body-ratio (default 0.5; "clear body"), AND
 *   - close inside at least one Pine FVG box (gates.price_context.inside_boxes).
 *
 *   CLAUDE.md "Known gaps" explicitly defers entry_model_candidate (MSS vs
 *   Trend vs Inversion) and confirmation_status — those are interpretive.
 *   The watchman flags candidates; grading happens via /analyze escalation.
 *
 * Output:
 *   - stdout: JSON-line alerts (machine-readable; pipeable).
 *   - stderr: human-readable status logs.
 *   - state/watch/alerts.jsonl: persistent append-only log.
 *
 * Citation discipline (CLAUDE.md hard constraint #6):
 *   Every numeric field in an alert has a paired `cites.<field>` path that
 *   resolves into the scan bundle at state/watch/last-scan.json. The
 *   watchman emits prices; it never produces a number not present in the
 *   bundle.
 */

const DEFAULT_POLL_MS = 10_000;        // 10s between ticks
const DEFAULT_BASELINE_TTL_S = 900;     // 15 min
const DEFAULT_BODY_RATIO_MIN = 0.5;     // "clear body (not a doji)"

const STATE_DIR = 'state/watch';
const BASELINE_PATH = `${STATE_DIR}/baseline.json`;
const SCAN_PATH = `${STATE_DIR}/last-scan.json`;
const ALERTS_PATH = `${STATE_DIR}/alerts.jsonl`;
const SNAPSHOT_DIR = `${STATE_DIR}/snapshots`;

function runCli(args) {
  // Invoke the CLI as a subprocess. ~80-150ms node startup is negligible
  // against ~0.2-13s analyze runtimes, and we get fault isolation: a bad
  // tick can't crash the watcher loop.
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
    'analyze',
    '--pillar3-only',
    '--baseline', BASELINE_PATH,
    '--out', SCAN_PATH,
  ]);
  if (!result.ok) {
    throw new Error(`scan failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }
  return JSON.parse(readFileSync(SCAN_PATH, 'utf8'));
}

/**
 * Detect strategy-relevant signal events on the most recent bar close.
 *
 * v1 is direction-agnostic: it emits when a bar closed inside an FVG with a
 * clear body. The LLM (via /analyze escalation) judges which entry model is
 * actually in play and whether HTF context supports the trade.
 *
 * Returns an array of alert objects (zero or more). Empty array = quiet bar.
 * `bundle_path` is left blank here and patched in by the caller after the
 * frozen snapshot is written (the rolling SCAN_PATH gets overwritten every
 * tick, so each alert needs its own pinned snapshot — constraint #6
 * requires the cited path to resolve to the exact emitted value, post-hoc).
 */
function detectEvents(bundle, minBodyRatio) {
  const events = [];
  const lastBar = bundle?.gates?.pillar3?.last_bar;
  const insideBoxes = bundle?.gates?.price_context?.inside_boxes || [];
  if (!lastBar) return events;
  if (lastBar.body_ratio == null || lastBar.body_ratio < minBodyRatio) return events;

  for (let i = 0; i < insideBoxes.length; i++) {
    const box = insideBoxes[i];
    // Only FVG/iFVG boxes are strategy-relevant; other Pine boxes (BPR,
    // session ranges, etc.) are noise for confirmation triggers.
    if (!/FVG/i.test(box.study)) continue;
    events.push({
      ts: new Date().toISOString(),
      kind: 'bar_close_in_fvg',
      bar_time: lastBar.time,
      bar_direction: lastBar.direction,
      bar_body_ratio: lastBar.body_ratio,
      close: lastBar.close,
      // Cite-or-reject (CLAUDE.md #6): every emitted number resolves at
      // its `cites.<field>` path inside the snapshot bundle below. The
      // snapshot is frozen at emission time; the rolling SCAN_PATH is
      // overwritten every tick and is NOT a valid citation target.
      bundle_path: null, // patched by caller after snapshot is written
      cites: {
        close: 'gates.pillar3.last_bar.close',
        body_ratio: 'gates.pillar3.last_bar.body_ratio',
        direction: 'gates.pillar3.last_bar.direction',
        bar_time: 'gates.pillar3.last_bar.time',
        fvg_high: `gates.price_context.inside_boxes[${i}].high`,
        fvg_low: `gates.price_context.inside_boxes[${i}].low`,
      },
      fvg: {
        study: box.study,
        zone_index: box.zone_index,
        high: box.high,
        low: box.low,
      },
      hint: 'Bar closed inside an FVG with clear body. Possible MSS/Trend/Inversion candidate — escalate to /analyze for full grading.',
    });
  }
  return events;
}

function appendAlertLine(line) {
  mkdirSync(dirname(ALERTS_PATH), { recursive: true });
  writeFileSync(ALERTS_PATH, line + '\n', { flag: 'a' });
}

function emitStdout(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runWatch(opts) {
  const pollMs = opts.poll ? Number(opts.poll) * 1000 : DEFAULT_POLL_MS;
  const baselineTtl = opts['baseline-ttl'] ? Number(opts['baseline-ttl']) : DEFAULT_BASELINE_TTL_S;
  const minBodyRatio = opts['min-body-ratio'] ? Number(opts['min-body-ratio']) : DEFAULT_BODY_RATIO_MIN;

  mkdirSync(STATE_DIR, { recursive: true });

  captureBaseline();
  let baselineCapturedMs = Date.now();

  let lastSeenBarTime = null;
  let tickCount = 0;

  process.stderr.write(
    `[watch] started — poll=${pollMs / 1000}s baseline_ttl=${baselineTtl}s min_body_ratio=${minBodyRatio}\n`,
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
      const barTime = bundle?.gates?.pillar3?.last_bar?.time ?? null;

      if (barTime != null && barTime !== lastSeenBarTime) {
        const isFirst = lastSeenBarTime == null;
        lastSeenBarTime = barTime;
        if (isFirst) {
          process.stderr.write(`[watch] tick ${tickCount} bar=${barTime} (initial baseline; not evaluating)\n`);
        } else {
          const events = detectEvents(bundle, minBodyRatio);
          if (events.length > 0) {
            // Pin the bundle that generated these events to a per-tick
            // snapshot so the cite paths resolve post-hoc (constraint #6).
            mkdirSync(SNAPSHOT_DIR, { recursive: true });
            const snapshotPath = `${SNAPSHOT_DIR}/${barTime}.bundle.json`;
            writeFileSync(snapshotPath, JSON.stringify(bundle));
            for (const ev of events) {
              ev.bundle_path = snapshotPath;
              const line = JSON.stringify(ev);
              appendAlertLine(line);
              emitStdout(ev);
            }
            process.stderr.write(
              `[watch] tick ${tickCount} bar=${barTime} emitted ${events.length} alert(s) -> ${snapshotPath}\n`,
            );
          } else {
            const lb = bundle?.gates?.pillar3?.last_bar;
            const inside = bundle?.gates?.price_context?.inside_boxes?.length ?? 0;
            process.stderr.write(
              `[watch] tick ${tickCount} bar=${barTime} no-event (body=${lb?.body_ratio} dir=${lb?.direction} inside=${inside})\n`,
            );
          }
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
    'Long-running watchman: detects strategy-relevant events on bar close. Refreshes baseline every ~15min; runs --pillar3-only --baseline scans per tick. Emits JSON-line alerts to stdout (also appended to state/watch/alerts.jsonl). Stop with Ctrl+C.',
  options: {
    poll: { type: 'string', description: 'Poll interval in seconds (default 10).' },
    'baseline-ttl': { type: 'string', description: 'Refresh baseline when older than N seconds (default 900 = 15 min).' },
    'min-body-ratio': { type: 'string', description: 'Minimum last_bar.body_ratio to trigger an alert (default 0.5; strategy: "clear body, not a doji").' },
  },
  handler: async (opts) => {
    await runWatch(opts || {});
    process.exit(0); // unreachable
  },
});
