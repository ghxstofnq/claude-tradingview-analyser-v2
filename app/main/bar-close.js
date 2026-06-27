// Bar-close detector bridge.
//
// Spawns `./bin/tv stream bar-close` as a long-running subprocess when LIVE
// mode is entered. Reads JSONL events line-by-line from its stdout, fires
// each event into:
//   - the outcome-tick path (Phase 6, deterministic)
//   - a Claude turn via sdk.userTurn(), phase-aware
//
// Lifecycle: startDetector / stopDetector. Crash recovery: exponential
// backoff restart up to 30s.

import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as replayCore from "@tvmcp/core/replay";
import { userTurn, isClaudeAuthBlocked } from "./sdk.js";
import { resolveLlmProvider } from "./llm-provider.js";

// Pure: the per-bar LLM gate. Claude login state only matters when the
// resolved provider for this purpose IS claude.
function llmTurnAuthBlocked({ providerName, claudeBlocked }) {
  return providerName === "claude" && claudeBlocked === true;
}
import { currentSession } from "./sessions.js";
import { tvAnalyzeFull, tvAnalyzeFast } from "./tools/tv-analyze.js";
import { ensureChartState } from "./tools/tv-chart.js";
import { PAIR_DEFAULT, PAIR_PRIMARY, PAIR_SECONDARY, baselinePathFor, structureTf, stopTf, pillar2EntryGate } from "./config.js";
import { computeEngineGates } from "../../cli/lib/compute-engine-gates.js";
import { deriveLtfBiasContext } from "./live-ltf-resolver.js";
import { finalizeOpenReactionDeterministic } from "./live-open-reaction-finalizer.js";
import { appendWindowClose, readWindowCloses } from "./window-closes.js";
import { normalizeLtfBiasRecord, isFinalizedLtfBiasRecord } from "../../cli/lib/ltf-bias-record.js";
import { markBarReceived, markTurnComplete } from "./health.js";
import { markBarReceivedForWatchdog } from "./trade-ticker-watchdog.js";
import { activeSessionDir } from "./sessions.js";
import { attachDetectorBriefDigest, parseHtfDestination } from "../../cli/lib/detector-brief-digest.js";
import { readMemory } from "./session-memory.js";
import { onModeChange, isLive } from "./mode.js";
import { record as recordMetric } from "./metrics.js";
import { foldOpenTrades, consecutiveLossStreak } from "../../cli/lib/trade-outcomes.js";
import { buildWalkerInputsRecord } from "../../cli/lib/day-tape.js";
// #65 Trade ticking + session-end audit live in trade-ticker now,
// so this file is closer to pure orchestration.
import { setTickerSink, tickOpenTrades, maybeForceCloseAtEod, maybeWarnSessionEndedWithOpenTrades } from "./trade-ticker.js";
import { surfaceSetup, surfaceNoTrade } from "./tools/surface.js";
import { alertIfPlumbingBlock } from "./health-check.js";
import { buildStrategyContext } from "./strategy/context/build-strategy-context.js";
import { runDeterministicWalkerStrategy } from "./strategy/walkers/deterministic-strategy.js";
import {
  readWalkersJson as readDeterministicWalkersJson,
  writeWalkersJson as writeDeterministicWalkersJson,
} from "./strategy/walkers/walker-runtime.js";
import { classifyEvaluationAvailability } from "../../cli/lib/live-readiness.js";

// How many recent JSONL entries to tail into the per-bar prompt.
const MEMORY_SETUPS_TAIL = 5;
const MEMORY_BARS_TAIL = 10;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TV_BIN = path.join(REPO_ROOT, "bin", "tv");
const BASELINE = path.join(REPO_ROOT, "state", "baseline.json");
const BASELINE_PRIMARY = path.join(REPO_ROOT, baselinePathFor(PAIR_PRIMARY));
const BASELINE_SECONDARY = path.join(REPO_ROOT, baselinePathFor(PAIR_SECONDARY));
// Live fresh-5m cache: a targeted 5m engine capture taken on each 5m close
// (--scan-tf 5, ~3s) so the open-reaction read sees the last-closed 5m bar
// fresh — matching the backtest's per-bar 5m. buildDetectorInputs overlays it
// onto engine_by_tf.m5. Without this, live's m5 came from the ≤15-min baseline.
const FRESH_M5 = path.join(REPO_ROOT, "state", "fresh-m5.json");
const FRESH_M5_MAX_AGE_MS = 7 * 60_000; // ~1 five-min bar of slack
const BASELINE_STALE_S = 900;          // 15 min

let _proc = null;
let _send = null;
let _restartTimer = null;
let _backoffMs = 1000;
let _refreshingBaseline = false;
// Detector restart cap. Without a max, a fundamentally broken detector
// (binary missing, perms wrong, port conflict) retries every 30s
// forever — silent fail under "loop down" forever. Cap means we
// eventually stop and surface to the user.
let _restartCount = 0;
const MAX_RESTARTS = 10;
let _unsubscribeMode = null;

// Per-tf coalescing queue. When a turn is in flight and another bar arrives,
// we keep ONLY the most recent bar of that timeframe — stale bars don't help
// the analysis. 5m closes drain before 1m closes because the strategy's
// confirmation TF is 5m.
let _q5m = null;
let _q1m = null;
let _running = false;

// One deterministic fold per underlying bar (the 5m-tagged queue copy of a
// minute event reuses the 1m fold's truth instead of re-folding — duplicate
// folds double-advanced walkers and broke live/replay parity, 2026-06-12).
let _truthCache = { key: null, truth: null };
function truthCacheKeyFor(ev) {
  return ev?.bar_close_time ?? ev?.ts ?? null;
}

/**
 * Should this bar-close turn route into <phase name="catch_up"> instead of
 * the regular phase? True iff:
 * - We're past the open-reaction window (entry_hunt phase or post_session)
 * - pillar1.md + pillar2.md exist (brief/pillar state is complete)
 * - ltf-bias.md does NOT exist (open-reaction never ran or didn't finalize)
 *
 * Spec: docs/superpowers/specs/2026-05-26-strategy-chain-design.md §5.1
 */
export function shouldRouteToCatchUp({ sessionPhase, pillar1Exists, pillar2Exists, ltfBiasExists }) {
  if (ltfBiasExists) return false;
  if (!pillar1Exists) return false;
  if (!pillar2Exists) return false;
  if (sessionPhase === 'entry_hunt_ny_am' || sessionPhase === 'entry_hunt_ny_pm') return true;
  if (sessionPhase === 'post_ny_am' || sessionPhase === 'post_ny_pm') return true;
  return false;
}

export function briefFilenameForLeader(leader) {
  if (leader === "mnq") return `brief-${PAIR_PRIMARY}.json`;
  if (leader === "mes") return `brief-${PAIR_SECONDARY}.json`;
  return "brief.json";
}

export function htfBiasFromBrief(brief) {
  return parseHtfDestination(brief?.htf_destination)?.dir || brief?.htf_destination?.direction || brief?.htf_bias || null;
}

export function entryHuntFastScanArgs() {
  return {
    pair: PAIR_DEFAULT,
    baseline: baselinePathFor(PAIR_PRIMARY),
    baselineSecondary: baselinePathFor(PAIR_SECONDARY),
  };
}

// Chart timeframe for the entry-hunt walker fold. ALWAYS the live base TF (1m),
// never the event's narration tag. The walker fold is the strategy's 1m setup
// search (filters-dont-separate: 1m entry is load-bearing; 5m-confirmation
// tested -55R); `ev.tf === "5m"` only signals a NARRATION cadence. Pinning the
// analysis chart to 5m on the 5m-boundary event (the queue drains 5m first)
// made ~1-in-5 walker folds run against the coarse 5m engine table, scrambling
// 1m walker tracking — London 2026-06-17: live folded 0 setups while an all-1m
// backtest of the same session folded 5. `ev` is accepted for call-site
// symmetry and possible future per-event logic; the fold TF is 1m today.
export function entryHuntChartTf(ev) {
  void ev;
  return "1";
}

// Single-brain entry hunt (2026-06-12). The walker chain is the ONLY setup
// producer — it surfaces packets/no-trades deterministically before any LLM
// turn. The per-bar LLM turn is narration-only, and it runs only when there
// is something to narrate: a packet fired, a walker changed stage, or a 5m
// close (the strategy's confirmation TF — strategy/confirmation.md). Quiet
// 1m bars skip the LLM entirely. Source: docs/research/
// ai-trading-analysis.md — "deterministic extraction → LLM synthesis"; the
// LLM stays out of the per-bar hot path.
export function shouldRunNarrationTurn({ truth, ev } = {}) {
  if (!truth) return true; // fail-open: a chain failure must stay visible
  if (truth.bestPacket) return true;
  if (truth.walkersChanged) return true;
  if (ev?.is_5m_close) return true;
  return false;
}

export function walkersSignatureChanged(prev, next) {
  const sig = (ws) => (ws ?? []).map((w) => `${w?.id}:${w?.stage}`).sort().join('|');
  return sig(prev) !== sig(next);
}

// Compact, prompt-safe view of this bar's deterministic truth. Strips
// evidence/rawPayload (huge, and the model must not re-derive from raw
// data — it narrates the verdict, constraint #7: no LLM arithmetic).
export function buildWalkerTruthBlock(truth) {
  const compact = truth
    ? {
        finalVerdict: truth.finalVerdict ?? 'no_trade',
        noTradeReason: truth.noTradeReason ?? null,
        blockers: (truth.blockers ?? []).slice(0, 6),
        bestPacket: truth.bestPacket
          ? {
              model: truth.bestPacket.model,
              side: truth.bestPacket.side,
              grade: truth.bestPacket.grade,
              entry: truth.bestPacket.entry?.price ?? null,
              stop: truth.bestPacket.stop?.price ?? null,
              stop_kind: truth.bestPacket.stop?.kind ?? null,
              tp1: truth.bestPacket.tp1?.price ?? null,
              tp1_r: truth.bestPacket.tp1?.rMultiple ?? null,
            }
          : null,
        walkers: (truth.walkers ?? []).map((w) => ({ model: w.model, side: w.side, stage: w.stage })),
      }
    : {
        finalVerdict: 'unknown',
        chain_error: 'walker chain did not produce truth this bar — tell the trader the chain failed and the bar was not evaluated',
      };
  return `\n\n<walker_truth>\n${JSON.stringify(compact, null, 2)}\n</walker_truth>\n`;
}

export function entryHuntNarrationHint() {
  return `Required action: narrate the walker chain's verdict per <phase name="entry_hunt">.

The <walker_truth> block above is the deterministic chain's verdict for this bar — it has ALREADY been surfaced to the UI in code before this turn started. DO NOT call surface_setup or surface_no_trade (a second surface would double-write or contradict the chain). DO NOT call tv_analyze_fast.

Reply with 2-4 sentences of plain prose for the trader: if a packet fired, explain the chain (what set it up, what confirmed, where the invalidation sits) using ONLY numbers present in <walker_truth>; if no-trade, give the blocking reason in one sentence and what would change it next bar; if a walker advanced a stage, say what it is now waiting for.`;
}

export function startDetector({ send }) {
  _send = send;
  setTickerSink(send);
  // Idempotent — if a detector subprocess is already running (e.g.
  // electron-main.js calls both bindDetectorToMode + an explicit kick on
  // LIVE-restore boot, or a mode flip fires while one is alive), don't
  // spawn a second. Without this guard, every boot leaks an extra
  // detector and the bar-close-events.jsonl gets N-way duplicate emits.
  if (_proc && !_proc.killed) {
    // eslint-disable-next-line no-console
    console.log(`[bar-close] startDetector: detector already running (pid ${_proc.pid}) — no-op`);
    return;
  }
  resetDetectorRestarts();
  spawnOnce();
}

export function stopDetector() {
  if (_restartTimer) { clearTimeout(_restartTimer); _restartTimer = null; }
  if (_proc) {
    try { _proc.kill("SIGTERM"); } catch {}
    _proc = null;
  }
}

// Wire the detector lifecycle to mode changes. Replaces the previous
// pattern where ipc.mode:switch called startDetector/stopDetector directly
// — that meant any future mode-aware caller had to wire its own dispatch.
// Now it's one subscription owned next to the detector itself.
//
// #1 IMPORTANT: don't stop the detector if there's an open trade. The
// trade-outcome ticker depends on bar events; killing it means TP/stop
// events never fire. Trader who flips to PREP "just to check" would
// silently lose tracking. Instead, the runClaudeTurnFor function gates
// Claude turns on mode (only fires when mode === live), but the detector
// keeps emitting and tickOpenTrades keeps running.
export async function hasOpenTrades() {
  try {
    const dir = await activeSessionDir();
    const txt = await fs.readFile(path.join(dir, "trades.jsonl"), "utf8");
    const events = txt.trim().split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    return foldOpenTrades(events).length > 0;
  } catch { return false; }
}

export function bindDetectorToMode({ send }) {
  if (_unsubscribeMode) _unsubscribeMode();
  _unsubscribeMode = onModeChange(async ({ mode }) => {
    if (mode === "live") {
      startDetector({ send });
    } else {
      // Only stop if no open trades. Otherwise keep the detector alive
      // so tickOpenTrades continues — Claude turns are gated separately.
      if (await hasOpenTrades()) {
        // eslint-disable-next-line no-console
        console.log(`[bar-close] mode=${mode} but open trade(s) — detector stays running for outcome ticking`);
        send?.("app:error", {
          source: "bar-close",
          level: "info",
          message: `Detector stays running — open trade(s) need outcome tracking.`,
        });
      } else {
        stopDetector();
      }
    }
  });
  // Honor whatever mode the app booted into.
  if (isLive()) startDetector({ send });
}

function spawnOnce() {
  // eslint-disable-next-line no-console
  console.log("[bar-close] spawning detector");
  _proc = spawn(TV_BIN, ["stream", "bar-close"], { cwd: REPO_ROOT });

  const rl = readline.createInterface({ input: _proc.stdout });
  rl.on("line", (line) => {
    const trimmed = (line || "").trim();
    if (!trimmed) return;
    let ev;
    try { ev = JSON.parse(trimmed); } catch { return; }
    handleBar(ev).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[bar-close] handleBar threw", err);
    });
  });

  _proc.stderr?.on("data", (chunk) => {
    // eslint-disable-next-line no-console
    console.warn("[bar-close stderr]", chunk.toString().slice(0, 400));
  });

  _proc.on("exit", (code) => {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] detector exited", code);
    _proc = null;
    _send?.("health:update", { detector: code === 0 ? "stopped" : "down" });
    // Backoff restart unless we asked it to stop OR we've blown the cap.
    if (!_restartTimer && _restartCount < MAX_RESTARTS) {
      _restartCount += 1;
      _restartTimer = setTimeout(() => {
        _restartTimer = null;
        _backoffMs = Math.min(_backoffMs * 2, 30_000);
        spawnOnce();
      }, _backoffMs);
    } else if (_restartCount >= MAX_RESTARTS) {
      // eslint-disable-next-line no-console
      console.error(`[bar-close] detector blew restart cap (${MAX_RESTARTS}); giving up. Restart the app.`);
      _send?.("app:error", {
        source: "bar-close",
        message: `Detector failed ${MAX_RESTARTS} restart attempts. Restart the app.`,
      });
      _send?.("health:update", { detector: "failed" });
    }
  });

  _send?.("health:update", { detector: "running" });
}

// Reset restart counter when a session starts cleanly (or a manual reset
// is wanted). Called from startDetector — gives the cap "amnesty" on a
// fresh session, so a previous day's bad run doesn't poison today.
export function resetDetectorRestarts() {
  _restartCount = 0;
  _backoffMs = 1000;
}

async function handleBar(ev) {
  // ev shape (from tv stream bar-close):
  //   { ts, tf: "1m", ohlc: {open,high,low,close,volume},
  //     is_new_bar, is_5m_close, chart_tf, symbol, bar_open_time, bar_close_time, ... }
  // The detector fires every wall-clock minute regardless of the chart's
  // display TF. is_new_bar tells us whether the chart's TF bar actually
  // rolled over at this tick; is_5m_close fires every 5th minute by wall clock.
  _send?.("bar:close", ev);
  markBarReceived();
  // #64 Watchdog uses this signal to know the detector is alive — it
  // skips polling as long as bar events keep arriving.
  markBarReceivedForWatchdog();

  // Outcome tick — deterministic, runs every minute regardless of session /
  // queue state. Uses ohlc.high / ohlc.low; running values from an in-progress
  // bar are fine since we only need running max/min for TP/SL hit detection.
  await tickOpenTrades(ev).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] tick threw", err?.message || err);
  });
  // 4:00 PM ET cash close — force-close any trade held to the NY close
  // (user ruling 2026-06-13). ET-gated inside; inert before 16:00.
  await maybeForceCloseAtEod(ev).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] eod-close threw", err?.message || err);
  });

  // Phase-aware: decide if Claude should react.
  const { session } = currentSession();
  const phase = phaseFor(session, ev);

  // Accumulate the full open-window 1m closes so the live open-reaction read
  // sees the whole window (matching the backtest), not just bars.last_5_bars
  // (live≠backtest fix 2026-06-21). Runs every 1m bar regardless of phase —
  // the window closes happen DURING open_reaction, before buildDetectorInputs
  // (entry_hunt) ever runs. Inert outside the window (appendWindowClose gates
  // by time). Live runs a 1m chart, so ev.ohlc is the closed 1m bar.
  if (session && ev?.ohlc?.close != null) {
    try {
      const dir = await activeSessionDir();
      appendWindowClose({ dir, eventTs: ev.ts, session, close: ev.ohlc.close });
    } catch { /* best-effort; resolver falls back to last_5_bars */ }
  }
  if (phase === "off") {
    // #6 Session close — if any trades are still open after the session
    // ended, warn the user once per (date, session). Trader could've
    // walked away with a position. We emit a single warning, not one
    // per bar, by tracking the last warning's (date, session) key.
    await maybeWarnSessionEndedWithOpenTrades(ev).catch(() => {});
    return;
  }
  // #1 Mode gate: even with the detector running for trade ticking,
  // only fire Claude turns when mode === live. PREP/REVIEW are non-
  // trading; we don't want a NY-AM bar to surface a setup when the
  // trader is reviewing yesterday or briefing tomorrow.
  if (!isLive()) return;

  // Append the bar to <sdir>/bars.jsonl BEFORE queuing the Claude turn so the
  // next prompt enrichment can see it. Deterministic — body_ratio etc.
  // computed in code per constraint #7 (no LLM arithmetic). Gated on
  // is_new_bar: skip in-progress bars (avoid duplicate rows for the same
  // chart-TF bar across multiple minute ticks).
  await appendBarLog(ev).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] appendBarLog threw", err?.message || err);
  });

  // Coalesce queue: keep only the most recent event per TF. If a turn is in
  // flight and 3 more bars arrive, only the freshest one of each TF runs when
  // the queue drains — stale bars would only generate stale analysis. The
  // detector emits ONE event per minute tagged tf="1m"; at 5m boundaries we
  // synthesize a 5m-tagged copy so the strategy's 5m-close walk also fires.
  _q1m = ev;
  if (ev.is_5m_close) {
    _q5m = { ...ev, tf: "5m" };
  }

  // Single drainer; concurrent handleBar calls all return here after queuing.
  maybeRunDrain();
}

// Drain the per-tf queue sequentially. 5m gets priority because it's the
// strategy's primary confirmation TF. _running is set synchronously before
// any await, so concurrent maybeRunDrain calls are safe — only the first
// gets through; the rest see _running=true and return.
function maybeRunDrain() {
  if (_running) return;
  _running = true;
  (async () => {
    try {
      while (_q5m || _q1m) {
        // Prefer 5m; fall back to 1m.
        const ev = _q5m || _q1m;
        if (ev === _q5m) _q5m = null;
        else _q1m = null;
        // Re-derive session+phase from the event's clock — the queue may
        // have crossed a session boundary while we were waiting.
        const { session } = currentSession();
        const phase = phaseFor(session, ev);
        if (phase === "off") continue;
        await runClaudeTurnFor(ev, session, phase).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[bar-close] runClaudeTurnFor threw", err);
        });
      }
    } finally {
      _running = false;
    }
  })();
}

// Cache replay state so we don't hammer CDP on every bar. Re-check
// at most once per ~30s. If replay is on, bar-close turns skip — grading
// replay bars as live would surface fake setups.
let _replayCheckedAt = 0;
let _replayActive = false;
async function isReplayActive() {
  const now = Date.now();
  if (now - _replayCheckedAt < 30_000) return _replayActive;
  _replayCheckedAt = now;
  try {
    const s = await replayCore.status();
    _replayActive = !!s?.is_replay_started;
  } catch {
    _replayActive = false; // no replay session = "not active"
  }
  return _replayActive;
}

async function runClaudeTurnFor(ev, session, phase) {
  // Skip Claude turns when TradingView replay is on — bar OHLC is from
  // the replay timeline, not live market. Grading these would surface
  // fake setups. Trade-outcome ticking is still allowed (deterministic;
  // user can manually close any positions before enabling replay).
  if (await isReplayActive()) {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] skipping Claude turn — TradingView replay is active");
    recordMetric({ kind: "bar-close", event: "skipped", session, reason: "replay_active" });
    return;
  }
  await maybeRefreshBaseline();
  // Hard short-circuit: when brief surfaced no-trade for a data/engine/closed
  // reason, the chain spec §5.5 says everything downstream skips. Don't
  // burn tokens running catch-up or entry-hunt against a session the brief
  // already flagged as unworkable. Soft reasons (pillar2_poor, htf_unclear)
  // still fall through so the model can flag a recovery if conditions
  // genuinely improve mid-session.
  const briefNoTradeReason = await readBriefNoTradeReason(session).catch(() => null);
  const HARD_NO_TRADE_REASONS = new Set(["data_gap", "engine_stale", "session_closed"]);
  if (briefNoTradeReason && HARD_NO_TRADE_REASONS.has(briefNoTradeReason)) {
    // eslint-disable-next-line no-console
    console.warn(`[bar-close] hard short-circuit: brief no_trade_reason=${briefNoTradeReason}, skipping turn`);
    recordMetric({ kind: "bar-close", event: "skipped", session, reason: `brief_no_trade_hard:${briefNoTradeReason}` });
    return;
  }

  // Open-reaction window — fully deterministic (2026-06-15), no Claude turn.
  // At/after minute 14 of the 15-min window, finalize leader + LTF bias +
  // open verdict from the engine's own evidence — computeLeader (via the
  // bundle's pair.leader_evidence) + deriveLtfBiasContext — the SAME resolvers
  // the backtest folds. Earlier bars defer: the verdict is meaningless until
  // the window has actually run. This runs regardless of LLM auth.
  if (phase === "open_reaction") {
    const mipOR = minutesIntoPhase(session, ev, phase);
    if (mipOR != null && mipOR >= 14) {
      const r = await finalizeOpenReactionDeterministic({ session, eventTs: ev.ts, minutesIntoPhase: mipOR })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[bar-close] open-reaction finalize threw", err?.message || err);
          return null;
        });
      recordMetric({ kind: "bar-close", event: "open_reaction_finalized", session, wrote: r?.wrote ?? false, leader: r?.leader ?? null, bias: r?.bias ?? null });
    } else {
      recordMetric({ kind: "bar-close", event: "open_reaction_deferred", session, mip: mipOR });
    }
    return;
  }

  // If Claude Code is not authenticated, keep deterministic bar/trade/walker
  // ticking alive but suppress LLM turns. Otherwise a missing local login
  // creates one failed catch-up/wrap/brief attempt per scheduler tick.
  // Provider-aware: a Claude login failure must not mute turns when the
  // bar-close purpose resolves to Codex (scheduled-turn.js already does
  // this; the per-bar path missed it — observed 2026-06-12).
  const providerName = resolveLlmProvider({ purpose: "bar-close" }).name;
  const authBlocked = llmTurnAuthBlocked({ providerName, claudeBlocked: !!isClaudeAuthBlocked() });

  // Deterministic open-reaction backfill (replaces the LLM leader/ltf-bias
  // catch-up turns — 2026-06-15). If we reached entry-hunt without a
  // pair-decision or ltf-bias (system started after the open window, or the
  // open-reaction finalize hasn't landed yet), resolve leader + bias + open
  // verdict in CODE — the same resolvers the backtest folds. Runs before
  // preflight so the chart pins to the chosen leader, and regardless of LLM
  // auth (the whole point: the chain no longer needs Claude here).
  if (phase === "entry_hunt") {
    const sdir0 = await activeSessionDir();
    const needsBackfill = !(await pairDecisionExists()) || !existsSync(path.join(sdir0, "ltf-bias.md"));
    if (needsBackfill) {
      await finalizeOpenReactionDeterministic({ session, eventTs: ev.ts }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[bar-close] open-reaction backfill threw", err?.message || err);
      });
      // pair-decision.json + ltf-bias.* may exist now; preflight pins the chart.
    }
  }

  await preflightChartState(ev, phase).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] preflightChartState threw", err?.message || err);
  });

  // Single-brain entry-hunt path: refresh the fast scan, then the walker
  // chain — the ONLY setup producer — evaluates the bar and surfaces its
  // packet or no-trade verdict deterministically. The LLM never surfaces
  // during entry hunt; it narrates the chain's verdict below (and only on
  // narration-worthy bars).
  let walkerTruth = null;
  if (phase === "entry_hunt") {
    // One fold per underlying bar: the queue synthesizes a 5m-tagged copy of
    // the same minute event at 5m boundaries (for narration cadence), and
    // both drain through here — observed live 2026-06-12 London as duplicate
    // truth records + double walker advancement every 5th minute, which also
    // breaks parity with the backtest (one fold per 1m bar). The second
    // drain of the same bar reuses the cached truth.
    const barKey = truthCacheKeyFor(ev);
    if (barKey != null && _truthCache.key === barKey && _truthCache.truth) {
      walkerTruth = _truthCache.truth;
    } else {
    // On a 5m close, grab a fresh 5m engine (sequenced BEFORE the 1m scan so the
    // two chart switches never overlap) → state/fresh-m5.json. buildDetectorInputs
    // overlays it onto engine_by_tf.m5 so the open-reaction read uses the
    // last-closed 5m bar fresh, matching the backtest.
    if (ev.is_5m_close) await refreshFreshM5();
    await refreshEntryHuntScanForWalker(session);
    try {
      walkerTruth = await runDeterministicPacketTruthForBar(ev, session);
      _truthCache = { key: barKey, truth: walkerTruth };
      recordMetric({
        kind: "bar-close",
        event: "deterministic_packet_truth",
        session,
        finalVerdict: walkerTruth?.finalVerdict ?? "no_trade",
        packetStatus: walkerTruth?.bestPacket?.status ?? walkerTruth?.packets?.[0]?.status ?? "none",
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[bar-close] deterministic packet truth threw", err?.message || err);
      recordMetric({ kind: "bar-close", event: "deterministic_packet_failed", session, reason: String(err?.message || err) });
      // Fall through to Claude turn as a safety net for the first iterations.
    }
    }
  }

  if (authBlocked) {
    recordMetric({ kind: "bar-close", event: "skipped", session, reason: "claude_auth_blocked" });
    _send?.("app:error", {
      source: "sdk",
      level: "warn",
      message: "Claude Code not logged in — auto LLM turns paused. Run `claude /login` (or set ANTHROPIC_API_KEY) and restart the dashboard.",
    });
    return;
  }

  const memory = await readSessionMemory();
  const mip = minutesIntoPhase(session, ev, phase);
  // Only entry-hunt reaches here — open_reaction is fully deterministic and
  // returns above; "off" is filtered by the drainer. Entry hunt is
  // narration-only (single-brain, 2026-06-12): the walker chain already
  // surfaced this bar's verdict in code; the model explains it. The hint MUST
  // agree with <phase name="entry_hunt"> in the system prompt — the
  // 2026-05-27 lesson: a hint that contradicts the system prompt makes the
  // model execute BOTH paths and blow the turn timeout.
  const hint = entryHuntNarrationHint();
  const memoryBlock = memory ? `\n\nSESSION MEMORY (read-only context for this turn):\n${memory}\n` : "";
  const phaseLine = `Phase: ${phase}${mip != null ? ` (+${mip}m)` : ""}. TF tick: ${ev.tf}${ev.is_5m_close ? " (also a 5m close)" : ""}.`;

  // Untaken-targets block. Observed live 2026-05-26 NY PM 13:11: model
  // cited AS.H 29990 as a target for "bull continuation" even though the
  // brief had already marked AS.H state=taken. The model "looked at the
  // chart" and grabbed the visually-closest level without re-checking
  // swept state. Inject the leader's untaken levels explicitly so the
  // model can't miss them — these are the ONLY valid targets per strategy.
  const untakenBlock = await readUntakenTargetsBlock().catch(() => "");

  // Walker-truth block — the deterministic chain's verdict for this bar,
  // already surfaced in code above. The model narrates it; it cannot change
  // it. (The old cli/lib/setup-detector.js <candidate_object> injection was
  // removed 2026-06-12 — two rule engines surfacing into the same UI fought
  // each other; the walker chain is the single brain now. The CLI detector
  // remains available to manual /analyze runs only.)
  const walkerTruthBlock = phase === "entry_hunt" ? buildWalkerTruthBlock(walkerTruth) : "";
  // ev.ts is UTC ISO (detector emits `new Date().toISOString()`). The previous
  // header labeled it "(ET)" — Claude read the UTC string literally and was
  // off by 4 hours, breaking session-phase reasoning in prose. Emit ET-
  // formatted HH:MM:SS and keep UTC in parens for machine traceability.
  const etTime = new Date(ev.ts).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

  // Quiet-bar gate: during entry hunt, skip the LLM narration turn entirely
  // when nothing narration-worthy happened this bar. The walker chain already
  // surfaced its verdict; the UI's walker panel and deterministic events
  // update every bar regardless. (The LLM catch-up routing was removed
  // 2026-06-15 — the deterministic backfill above resolves leader + bias in
  // code, so there is no longer a catch_up turn to keep alive on quiet bars.)
  if (phase === "entry_hunt" && !shouldRunNarrationTurn({ truth: walkerTruth, ev })) {
    recordMetric({ kind: "bar-close", event: "skipped", session, reason: "narration_quiet_bar" });
    return;
  }
  const text = `A new ${ev.tf} bar just closed at ${etTime} ET (utc=${ev.ts}). ${phaseLine}${memoryBlock}${untakenBlock}${walkerTruthBlock}\n${hint}`;

  // Metrics: track bar-close turn lifecycle. Was: bar-close (the highest-
  // frequency turn at ~60/hour) emitted ZERO metrics — couldn't answer
  // "how many turns succeeded/failed/timed out today?" Now matches brief
  // and wrap.
  recordMetric({ kind: "bar-close", event: "started", session });
  const startedAt = Date.now();
  let errored = false;
  let usage = null;
  // Per-turn tool-call timeline. Captured so we can post-mortem which tool
  // ate the time on slow turns. Each entry: { ts, elapsed_ms, name }.
  const toolCalls = [];
  await userTurn({
    text,
    purpose: "bar-close",
    // Bumped from 120s → 180s on 2026-05-27 after observing every
    // bar-close turn from 09:43 ET onwards timing out at exactly 120s.
    // Catch-up turns regularly hit 196s, so the model genuinely needs
    // more headroom on the chain-aware entry-hunt walk. Coalescing
    // queue handles the case where bars accumulate while a long turn
    // runs: most-recent bar of each TF replaces older ones.
    timeoutMs: 180_000,
    onEvent: (e) => {
      if (e.type === "chunk") _send?.("chat:chunk", { ...e, purpose: "bar-close" });
      else if (e.type === "tool_call") {
        _send?.("chat:tool_call", e);
        // For diagnostics — capture the file_path for Read/Edit calls so
        // we can see which state file the model is loading mid-turn.
        // Other tool args are deliberately not captured (some are large
        // / contain secrets like brief contents).
        const args = e.args || {};
        const argHint = (e.name === "Read" || e.name === "Edit" || e.name === "Write")
          ? (args.file_path ? String(args.file_path).slice(-60) : null)
          : null;
        toolCalls.push({
          elapsed_ms: Date.now() - startedAt,
          name: e.name,
          ...(argHint ? { path: argHint } : {}),
        });
      }
      else if (e.type === "turn_complete") {
        _send?.("chat:turn_complete", { ...e, purpose: "bar-close" });
        markTurnComplete();
        // Clear detector candidate — next turn re-stages its own.
        import("./tools/surface.js").then(({ clearTurnAuditState }) => clearTurnAuditState()).catch(() => {});
      }
      else if (e.type === "usage") { usage = e.usage; }
      else if (e.type === "error") {
        errored = true;
        _send?.("app:error", { source: "sdk", message: e.message });
      }
    },
  });
  recordMetric({
    kind: "bar-close",
    event: errored ? "failed" : "succeeded",
    session,
    durationMs: Date.now() - startedAt,
    usage,
    // Slow turns observed 2026-05-27 — every turn hitting the 120s
    // timeout had no tool-level visibility. Persisting the tool-call
    // timeline so the next round of failures can be diagnosed without
    // re-running the day. Trimmed to avoid metrics bloat: max 15
    // entries + each ≤80 chars of name. Read/Edit/Write also carry
    // the last 60 chars of the file path so we can identify WHICH
    // state file the model is loading mid-turn.
    tool_calls: toolCalls.slice(0, 15).map((t) => ({
      elapsed_ms: t.elapsed_ms,
      name: String(t.name || "").slice(0, 80),
      ...(t.path ? { path: t.path } : {}),
    })),
  });
}

// Check whether pair-decision.json exists for the active session. Used by
// the entry-hunt catch-up path to decide if a leader-pick turn is needed.
async function pairDecisionExists() {
  const dir = await activeSessionDir();
  try {
    await fs.access(path.join(dir, "pair-decision.json"));
    return true;
  } catch { return false; }
}

// Read brief.<leader>.no_trade_reason from the brief.json (per-symbol
// primary mirror). Returns the enum string or null when the brief
// didn't fire / didn't grade no-trade. Used to hard-short-circuit
// bar-close turns when the brief flagged a data/engine/closed reason.
async function readBriefNoTradeReason() {
  const dir = await activeSessionDir();
  try {
    const txt = await fs.readFile(path.join(dir, "brief.json"), "utf8");
    const brief = JSON.parse(txt);
    return brief?.no_trade_reason || null;
  } catch { return null; }
}

// Read the leader's untaken_above + untaken_below from brief.json's
// overnight_block. Returns a formatted block to inject into the per-bar
// prompt so the model can't cite a swept level as a target.
//
// Observed 2026-05-26 NY PM 13:11: model cited AS.H 29990 as a "bull
// continuation" target even though brief.key_levels had AS.H state=taken.
// The model picked visually-closest level instead of next-untaken. This
// block forces the untaken set into the prompt where it can't be missed.
async function readUntakenTargetsBlock() {
  const dir = await activeSessionDir();
  try {
    const txt = await fs.readFile(path.join(dir, "brief.json"), "utf8");
    const brief = JSON.parse(txt);
    const above = brief?.overnight_block?.untaken_above || [];
    const below = brief?.overnight_block?.untaken_below || [];
    if (above.length === 0 && below.length === 0) return "";
    const fmtLevel = (l) => `${l.name} ${l.price} (${l.cite || "—"})`;
    const aboveStr = above.length ? above.map(fmtLevel).join("; ") : "(none)";
    const belowStr = below.length ? below.map(fmtLevel).join("; ") : "(none)";
    return `\n\n<untaken_targets>\nOnly these levels are valid as TP/draw targets this session — swept levels are NOT valid targets:\n  above price: ${aboveStr}\n  below price: ${belowStr}\nWhen citing a target in surface_setup tp1/tp2 or surface_no_trade reasoning about R:R, use ONE of these. Citing a swept level (state=taken in brief.key_levels) as a target is a bug — pick the next untaken level beyond it instead.\n</untaken_targets>\n`;
  } catch { return ""; }
}

// Read the finalized LTF bias for the detector's grade_cap / htf_ltf_alignment
// / entry_model_priority / bias logic. The `ltf-bias.json` sidecar that
// surface_ltf_bias writes IS the source of truth (the `.md` is the human view).
// Earlier this parsed the `.md` FRONTMATTER for a field named `bias` — but the
// writer puts the value in the `.md` body as `ltf_bias` and the structured
// payload in the JSON, so the chain read `bias: null` and blocked every
// divergent/mixed-open session on `missing_ltf_bias`. Read the JSON; fall back
// to scanning the `.md` (frontmatter AND body) for legacy sessions.
async function readLtfBiasFrontmatter() {
  const dir = await activeSessionDir();
  try {
    const rec = JSON.parse(await fs.readFile(path.join(dir, "ltf-bias.json"), "utf8"));
    const ctx = normalizeLtfBiasRecord(rec);
    // Trust the JSON source of truth whenever it's a finalized verdict — even a
    // stand-aside (bias null) carries entry_model_priority + grade_cap. The old
    // `hasValue(ctx.bias)` guard discarded those records and fell back to the
    // .md (which lacks both fields), blocking every stand-aside session on
    // missing_entry_model_priority/grade_cap. A null bias here still lets the
    // per-bar deterministic fallback (deriveLtfBiasContext) earn the direction.
    if (isFinalizedLtfBiasRecord(ctx)) return ctx;
  } catch { /* no JSON sidecar — fall back to the .md below */ }
  try {
    const txt = await fs.readFile(path.join(dir, "ltf-bias.md"), "utf8");
    const fm = {};
    // Scan the whole file: the structured fields live in the body as
    // `- ltf_bias: ...` bullets (and, in older files, in the `---` frontmatter).
    for (const line of txt.split("\n")) {
      const kv = line.match(/^[-\s]*([A-Za-z0-9_]+):\s*"?([^"#]*?)"?\s*$/);
      if (kv && !(kv[1] in fm)) fm[kv[1]] = kv[2].trim();
    }
    return normalizeLtfBiasRecord(fm);
  } catch { return {}; }
}

// Best (strongest) HTF displacement across h4/h1 — mirrors
// direct-session-brief.js#bestHtfDisplacement (inlined to avoid importing that
// module's full dependency tree into the bar-close hot path).
const HTF_DISP_RANK = { clean: 3, acceptable: 2, weak: 1 };
function bestHtfDisp(htfQuality) {
  const h4 = String(htfQuality?.h4?.displacement ?? '').toLowerCase();
  const h1 = String(htfQuality?.h1?.displacement ?? '').toLowerCase();
  const best = (HTF_DISP_RANK[h4] ?? 0) >= (HTF_DISP_RANK[h1] ?? 0) ? h4 : h1;
  return HTF_DISP_RANK[best] ? best : null;
}

async function readSessionStrategyState(brief = null) {
  const dir = await activeSessionDir();
  const pillar1Fm = await readMarkdownFrontmatter(path.join(dir, 'pillar1.md')).catch(() => null);
  const pillar2Fm = await readMarkdownFrontmatter(path.join(dir, 'pillar2.md')).catch(() => null);
  return {
    ...(pillar1Fm || brief ? {
      pillar1: {
        status: normalizePassStatus(pillar1Fm?.status ?? pillar1Fm?.verdict ?? brief?.pillar1_status ?? 'pass'),
        htfBias: pillar1Fm?.htf_bias ?? pillar1Fm?.htfBias ?? htfBiasFromBrief(brief) ?? null,
        htfDraw: pillar1Fm?.htf_draw ?? pillar1Fm?.htfDraw ?? brief?.htf_destination ?? null,
        primaryDraw: pillar1Fm?.primary_draw ?? pillar1Fm?.primaryDraw ?? brief?.primary_draw ?? null,
      },
    } : {}),
    ...(pillar2Fm || brief?.pillar2_verdict ? {
      pillar2: {
        status: normalizePassStatus(pillar2Fm?.status ?? pillar2Fm?.verdict ?? brief?.pillar2_verdict ?? 'pass'),
        verdict: pillar2Fm?.verdict ?? pillar2Fm?.pillar2_verdict ?? brief?.pillar2_verdict ?? null,
        // §7 Step 3 (Fix A): 4H/1H displacement for the A+ grade + entry gate.
        htf_displacement: pillar2Fm?.htf_displacement ?? bestHtfDisp(brief?.htf_quality),
      },
    } : {}),
  };
}

async function readMarkdownFrontmatter(filePath) {
  const txt = await fs.readFile(filePath, 'utf8');
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_\-.]+):\s*"?([^"#]*?)"?\s*$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function normalizePassStatus(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (['pass', 'passed', 'ok', 'clean', 'good', 'a+', 'b'].includes(v)) return 'pass';
  if (!v) return null;
  return v;
}

// Build the detector input bundle for the current bar-close turn.
// Reads slim bundle + brief.json + ltf-bias.md + pair-decision.json from
// disk, synthesizes brief_digest fields the detector expects (htf_destination
// + primary_draw — these live in brief.json, not in the analyze-time digest),
// and returns { bundle, leader, ltf_bias_context, untaken_targets }.
// Deterministic packet truth — main live path for V2. Reads the same fresh
// TradingView bundle used by the detector, runs the PR #3 strategy walker,
// persists packet truth, and surfaces only the deterministic packet verdict.
async function runDeterministicPacketTruthForBar(ev, session) {
  const inputs = await buildDetectorInputs(session);
  const dir = await activeSessionDir();
  // Day-tape recording (fix #4): freeze this bar's exact detector inputs so
  // any session can later be promoted into a replayable regression tape
  // (scripts/promote-day-tape.js). Fire-and-forget — recording must never
  // block or fail the live turn.
  if (inputs?.bundle) {
    const record = buildWalkerInputsRecord({ event: ev, session, inputs });
    fs.appendFile(path.join(dir, "walker-inputs.jsonl"), `${JSON.stringify(record)}\n`).catch(() => {});
  }
  if (!inputs?.bundle?.gates) {
    const truth = { finalVerdict: 'no_trade', packets: [], bestPacket: null, blockers: ['missing_scan_bundle'], walkersChanged: false, eventTimeUtc: ev?.ts ?? null };
    await persistDeterministicTruth(dir, truth);
    await surfaceNoTrade({ reason: 'deterministic packet blocked: missing_scan_bundle' }).catch(() => {});
    return truth;
  }

  const previous = await readDeterministicWalkersJson(dir);
  const truth = buildDeterministicPacketTruthFromInputs({
    inputs,
    previousWalkers: previous.walkers ?? [],
    event: ev,
    session,
  });
  const nextState = { schemaVersion: 1, walkers: truth.walkers, updatedAt: new Date().toISOString() };
  await writeDeterministicWalkersJson(dir, nextState);

  const bestPacket = truth.bestPacket;
  const blockingPacket = bestPacket ?? {
    status: 'blocked',
    finalVerdict: 'no_trade',
    blockers: truth.blockers?.length ? truth.blockers : ['no_confirmed_packet'],
  };

  const { setCurrentDeterministicPacket } = await import("./tools/surface.js");
  setCurrentDeterministicPacket(bestPacket ?? blockingPacket);
  await persistDeterministicTruth(dir, truth);
  _send?.('deterministic:packet', truth);
  _send?.('walkers:state', { session, walkers: truth.walkers, deterministic: true });

  // 3-losses-in-a-row session halt (user ruling 2026-06-13): once the session
  // has 3 consecutive losers, stop surfacing new setups for the rest of it.
  let lossHalt = false;
  try {
    const txt = await fs.readFile(path.join(dir, "trades.jsonl"), "utf8");
    const events = txt.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    lossHalt = consecutiveLossStreak(events) >= 3;
  } catch { /* no trades file yet — not halted */ }

  if (bestPacket && !lossHalt) {
    await surfaceSetup(truth.surfacePayload);
    // Tranche execution (auto modes only). The manager no-ops in manual mode
    // (default), so the existing surface→human-accept flow is untouched. Never
    // let an execution failure break the chain.
    try {
      const { runTrancheManager } = await import("./execution/tranche-manager.js");
      const price = ev?.ohlc?.close ?? null;
      const r = await runTrancheManager({ bestPacket: truth.surfacePayload, price });
      if (r && r.action !== "manual" && r.action !== "none") {
        // eslint-disable-next-line no-console
        console.log(`[tranche] ${r.action}${r.reason ? ` — ${r.reason}` : ""}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[tranche] runTrancheManager failed", err?.message || err);
    }
  } else {
    const reason = lossHalt
      ? "session halt: 3 losses in a row"
      : (truth.noTradeReason ?? `deterministic packet blocked: ${(truth.blockers?.length ? truth.blockers : ['no_confirmed_packet']).join(', ')}`);
    await surfaceNoTrade({ reason }).catch((err) => {
      // A recent setup can suppress no-trade; that's fine for UI lifecycle.
      if (!/suppressed/i.test(String(err?.message || err))) throw err;
    });
    // Mid-session health-check: the instant the LIVE chain blocks on a plumbing
    // (bug) reason, push a loud notification — once per condition per session.
    // The June blackout blocked every bar for two sessions unnoticed.
    alertIfPlumbingBlock({ reason, session, send: _send }).then((r) => {
      if (r?.alerted) recordMetric({ kind: "bar-close", event: "plumbing_block_alert", session, reason });
    }).catch(() => {});
  }

  return truth;
}

function buildDeterministicPacketTruthFromInputs({ inputs, previousWalkers = [], event, session } = {}) {
  const strategyBundle = buildStrategyBundleForRuntime(inputs, event, session);
  const context = buildStrategyContext(strategyBundle);
  const availability = classifyEvaluationAvailability(context.sourceHealth);
  if (availability.evaluationStatus === 'cannot_evaluate_source_health') {
    const blockers = availability.blockers;
    return {
      schemaVersion: 1,
      eventTimeUtc: event?.ts ?? null,
      market: context.market,
      session,
      finalVerdict: 'no_trade',
      evaluationStatus: availability.evaluationStatus,
      bestPacket: null,
      packets: [],
      blockers,
      sourceHealth: context.sourceHealth,
      walkers: previousWalkers,
      walkersChanged: false,
      events: [],
      surfacePayload: null,
      noTradeReason: `${availability.reasonPrefix}: ${blockers.join(', ')}`,
    };
  }
  const chain = evaluateStrategyChainReadiness(inputs, context);
  if (!chain.ok) {
    return {
      schemaVersion: 1,
      eventTimeUtc: event?.ts ?? null,
      market: context.market,
      session,
      finalVerdict: 'no_trade',
      evaluationStatus: 'cannot_evaluate_strategy_chain',
      bestPacket: null,
      packets: [],
      blockers: chain.blockers,
      sourceHealth: context.sourceHealth,
      walkers: previousWalkers,
      walkersChanged: false,
      events: [],
      surfacePayload: null,
      sessionChain: context.sessionChain,
      noTradeReason: `cannot evaluate: strategy chain incomplete: ${chain.blockers.join(', ')}`,
    };
  }
  const result = runDeterministicWalkerStrategy({ context, walkers: previousWalkers });
  let bestPacket = result.bestPacket ? { ...result.bestPacket, finalVerdict: result.finalVerdict } : null;
  let finalVerdict = result.finalVerdict;
  // Faithful Pillar-2 entry gate (§3): stand aside when the confirmation fires
  // into a genuinely poor environment (2+ of candle-5m / displacement-4H1H / range-3h).
  let p2EntryBlocked = false;
  if (bestPacket && pillar2EntryGate() && pillar2PoorAtEntry(inputs)) {
    bestPacket = null;
    finalVerdict = 'no_trade';
    p2EntryBlocked = true;
  }
  const blockers = bestPacket
    ? []
    : (p2EntryBlocked
      ? ['pillar2_poor_at_entry']
      : (result.packets?.flatMap((packet) => packet.blockers ?? []).slice(0, 10) ?? context.blockers ?? ['no_confirmed_packet']));
  const noTradeReason = bestPacket ? null : `${availability.reasonPrefix}: ${(blockers.length ? blockers : ['no_confirmed_packet']).join(', ')}`;
  return {
    schemaVersion: 1,
    eventTimeUtc: event?.ts ?? null,
    market: context.market,
    session,
    finalVerdict,
    evaluationStatus: availability.evaluationStatus,
    bestPacket,
    packets: result.packets,
    blockers,
    sourceHealth: context.sourceHealth,
    walkers: result.walkers,
    walkersChanged: walkersSignatureChanged(previousWalkers, result.walkers),
    events: result.events,
    surfacePayload: bestPacket ? deterministicPacketToSurfacePayload(bestPacket, event) : null,
    noTradeReason,
  };
}

function hasValue(value) {
  return value != null && String(value).trim() !== '';
}

// Faithful Pillar-2 quality, re-measured AT the confirmation bar across the doc's
// three TF scopes (§7 Step 3): candle anatomy on 5m (majority of last 3 — Fix B,
// not 1-of-3), displacement on 4H/1H (Fix A, from the brief's htf_displacement),
// 3h range recalibrated (Fix C). "poor" = N-of-3 dims failing (GOFNQ_P2_ENTRY_N,
// default 2). Returns true when the entry environment is genuinely bad.
function pillar2PoorAtEntry(inputs) {
  const bundle = inputs?.bundle ?? {};
  // (B) candle anatomy — last 3 closed 5m bars; doji/wick = body<25% AND wick>60%
  // (matches the Pine thresholds); bad when a MAJORITY (>=2) are doji/wick.
  const bars = (bundle.bars_by_tf?.m5?.last_5_bars ?? []).slice(-3);
  let doji = 0;
  for (const b of bars) {
    const o = +b.open; const h = +b.high; const l = +b.low; const c = +b.close;
    const rng = h - l;
    if (!(rng > 0)) continue;
    const body = Math.abs(c - o);
    const wick = Math.max(h - Math.max(o, c), Math.min(o, c) - l);
    if (body / rng < 0.25 && wick / rng > 0.60) doji += 1;
  }
  const candleBad = bars.length >= 2 && doji >= 2;
  // (C) 3h range — tight when 3h range < pct of price (recalibrated from 0.3%).
  const q = bundle.engine_by_tf?.m5?.quality ?? {};
  const close = Number(bundle.quote?.last);
  const pct = Number(process.env.GOFNQ_P2_RANGE_PCT) > 0 ? Number(process.env.GOFNQ_P2_RANGE_PCT) : 0.005;
  const rangeBad = Number.isFinite(+q.range_3h) && Number.isFinite(close) && close > 0 && (+q.range_3h) < close * pct;
  // (A) displacement — 4H/1H (session brief); weak when not clean/acceptable.
  const htfDisp = String(inputs?.session_state?.pillar2?.htf_displacement ?? '').toLowerCase();
  const dispBad = htfDisp !== '' && !['clean', 'acceptable'].includes(htfDisp);
  const bad = (candleBad ? 1 : 0) + (rangeBad ? 1 : 0) + (dispBad ? 1 : 0);
  const need = Number(process.env.GOFNQ_P2_ENTRY_N) >= 1 ? Number(process.env.GOFNQ_P2_ENTRY_N) : 2;
  return bad >= need;
}

function evaluateStrategyChainReadiness(inputs = {}, context = {}) {
  const blockers = [];
  const ltf = inputs.ltf_bias_context ?? {};
  const state = inputs.session_state ?? {};
  if (!hasValue(inputs.leader)) blockers.push('missing_pair_decision');
  // Fail closed on wrong-symbol evidence: a crashed pair sweep left the
  // chart on MES@5m mid-session (2026-06-12 NY-AM) and the chain folded
  // MES bars against MNQ context for 23 minutes. Instrument failure, not
  // a market verdict.
  const chartSymbol = String(inputs.bundle?.chart?.symbol ?? '').replace(/^[A-Z_]+:/, '');
  if (hasValue(inputs.leader) && chartSymbol && chartSymbol !== String(inputs.leader).replace(/^[A-Z_]+:/, '')) {
    blockers.push('symbol_mismatch');
  }
  if (!hasValue(ltf.bias)) blockers.push('missing_ltf_bias');
  if (!hasValue(ltf.htf_ltf_alignment)) blockers.push('missing_htf_ltf_alignment');
  if (!hasValue(ltf.entry_model_priority)) blockers.push('missing_entry_model_priority');
  if (!hasValue(ltf.grade_cap)) blockers.push('missing_grade_cap');
  if (!state.pillar1) blockers.push('missing_pillar1_state');
  if (!state.pillar2) blockers.push('missing_pillar2_state');
  if (context?.pillar1?.status !== 'pass') blockers.push(...(context?.pillar1?.blockers ?? []).filter(Boolean));
  if (context?.pillar2?.status !== 'pass') blockers.push(...(context?.pillar2?.blockers ?? []).filter(Boolean));
  return { ok: blockers.length === 0, blockers: [...new Set(blockers)] };
}

// Bridge the live scan bundle's engine gates (cli/lib/compute-engine-gates.js
// output) into the evidence shapes the strategy context consumes. Discovered
// 2026-06-12 from June 5's deterministic-packets.jsonl: every live bar was
// blocked with missing_ict_engine_rows — the walker chain was built against a
// rows-bearing test shape the live bundle never produced. Three derivations,
// each only when the field is absent (hand-built test bundles and future
// emitters that provide them directly are left untouched):
//   rows               ← pillar3.fvgs/bprs (the parsed V2 zone lists)
//   confirmation       ← the most recently confirmed V2 zone's lifecycle
//                        fields + the live bar close (entry price source)
//   structural_stops   ← swing pivots (strategy: stop at structural
//                        invalidation; zone-edge stops are a future, separate
//                        strategy decision — see PR notes)
// Boundary-based zone identity: the engine re-orders its zone lists bar to
// bar, so index-based refs give the same zone a new identity every bar —
// walker dedup and tap-matching both need the zone itself, not its position.
function zoneRef(row, fallback) {
  // Explicit refs win — hand-built evidence (tests, labels) names its zones.
  if (row?.evidenceRef) return row.evidenceRef;
  if (row?.cite) return row.cite;
  const top = Number(row?.top);
  const bottom = Number(row?.bottom);
  if (Number.isFinite(top) && Number.isFinite(bottom)) return `zone:${bottom}-${top}`;
  return fallback;
}

function bridgeEngineEvidence(engine, { lastClose = null } = {}) {
  const out = { ...engine };
  const p3 = out.pillar3 ?? {};

  if (!Array.isArray(out.rows) || out.rows.length === 0) {
    out.rows = [
      ...(p3.fvgs ?? []).map((row, i) => ({
        kind: 'fvg', ...row,
        evidenceRef: zoneRef(row, `gates.engine.pillar3.fvgs[${i}]`),
      })),
      ...(p3.bprs ?? []).map((row, i) => ({
        kind: 'bpr', ...row,
        evidenceRef: zoneRef(row, `gates.engine.pillar3.bprs[${i}]`),
      })),
    ];
  }

  // Align the price-context zone refs to the same identities so a walker
  // spawned from rows[] recognizes its zone in inside_fvgs[] (MSS tap).
  const pc = out.price_context ?? {};
  out.price_context = {
    ...pc,
    inside_fvgs: (pc.inside_fvgs ?? []).map((row, i) => ({
      ...row, evidenceRef: zoneRef(row, `gates.engine.price_context.inside_fvgs[${i}]`),
    })),
    inside_bprs: (pc.inside_bprs ?? []).map((row, i) => ({
      ...row, evidenceRef: zoneRef(row, `gates.engine.price_context.inside_bprs[${i}]`),
    })),
  };

  const conf = out.confirmation ?? {};
  if (conf.entry_state == null) {
    const close = conf.last_bar?.close ?? lastClose;
    // entry_state='confirmed' on an engine row is a HISTORICAL record — the
    // table keeps completed entries around (June 9 tape: a 13:41 confirm was
    // still 'confirmed' at 13:55 and masked the live violation). Only a
    // confirm_ms inside the current bar is confirmation evidence for THIS
    // bar; without a bar timestamp nothing is bridged from entry_state.
    const barOpenMs = Number(conf.last_bar?.time) * 1000;
    const inCurrentBar = (ms) => Number.isFinite(barOpenMs) && Number.isFinite(ms)
      && ms >= barOpenMs && ms <= barOpenMs + 60_000;
    const confirmed = out.rows
      .filter((row) => row.entry_state === 'confirmed'
        && (row.confirm_close === true || row.confirm_close === 1)
        && inCurrentBar(Number(row.confirm_ms)))
      .sort((a, b) => (b.confirm_ms ?? 0) - (a.confirm_ms ?? 0))[0];
    // The engine's entry_state machinery only tracks CE-retest entries. A
    // blast-through close that flips a zone to state=inverted IS the
    // confirmation for the Inversion model's aggressive variant
    // (docs/strategy/entry-models.md: "enter on the initial close that
    // violated the FVG") — synthesize that row deterministically from the
    // bar close vs the flipped zone. Engine-emitted confirms take precedence.
    //
    // The search is keyed to the CLOSING BAR's direction: old inverted zones
    // on the wrong side stay "closed-beyond" forever (June 9 tape: a stale
    // bull-inverted zone from the opening bounce won first-match on every
    // later bar and masked the real bearish confirmation for six bars).
    // The confirmation candle's direction is the strategy's own discipline —
    // a bearish close confirms shorts, full stop. No bar direction → no
    // synthesis (fail closed).
    const barDir = conf.last_bar?.direction;
    const wantDir = barDir === 'bearish' ? 'bear' : barDir === 'bullish' ? 'bull' : null;
    // GXNQ hand grade 2026-06-13 (June 9 trades 4+6): "the entry candle
    // didn't invert a bullish fvg." Close-beyond an inverted zone is true of
    // every zone the move left behind; the violation is only THIS bar's if
    // the engine stamped inverted_ms inside it. No stamp → no synthesis.
    const violated = (confirmed || !wantDir) ? null : out.rows.find((row) => {
      if (row.state !== 'inverted' || !['fvg', 'ifvg'].includes(String(row.kind))) return false;
      if (row.dir !== wantDir) return false;
      if (!inCurrentBar(Number(row.inverted_ms))) return false;
      const top = Number(row.top);
      const bottom = Number(row.bottom);
      if (!Number.isFinite(top) || !Number.isFinite(bottom) || !Number.isFinite(Number(close))) return false;
      // The engine already determined the zone inverted (stamped inverted_ms in this
      // bar); the bridge re-checking a STRICT close-beyond-boundary is redundant and
      // drops boundary closes (06-15 10:29: a bear FVG inverted bullish with the close
      // landing EXACTLY at the zone top, so close > top failed and the long never
      // confirmed). GOFNQ_INV_RECLAIM makes the boundary inclusive (>=/<=).
      const inclusive = process.env.GOFNQ_INV_RECLAIM === '1';
      return wantDir === 'bear'
        ? (inclusive ? Number(close) <= bottom : Number(close) < bottom)
        : (inclusive ? Number(close) >= top : Number(close) > top);
    });
    const source = confirmed ?? violated;
    if (source) {
      out.confirmation = {
        ...conf,
        entry_state: 'confirmed',
        confirm_close: true,
        confirm_dir: confirmed ? (confirmed.confirm_dir ?? null) : source.dir,
        ce_held: confirmed ? confirmed.ce_held === true : true,
        chop_15m: source.chop_15m === true,
        confirm_ms: source.confirm_ms ?? null,
        close,
        // Zone identity travels with the confirmation so walkers holding a
        // DIFFERENT zone can never consume it (June 9 trade 4 cross-wiring).
        zone_top: Number.isFinite(Number(source.top)) ? Number(source.top) : null,
        zone_bottom: Number.isFinite(Number(source.bottom)) ? Number(source.bottom) : null,
        evidenceRef: source.evidenceRef ?? zoneRef(source, 'gates.engine.confirmation'),
        ...(violated ? { source: 'violation_close_bridge' } : {}),
      };
    }
  }

  if (!Array.isArray(p3.structural_stops) || p3.structural_stops.length === 0) {
    const pivotStops = (tier) => ((p3.swings ?? {})[tier] ?? [])
      .filter((s) => Number.isFinite(Number(s?.price)))
      .map((s, i) => ({
        kind: s.is_high ? 'swing_high' : 'swing_low',
        price: Number(s.price),
        tier,
        bar_ms: s.bar_ms ?? null,
        // swept-ness disqualifies a pivot as a TARGET (no resting liquidity)
        // — carried through so the target pool can filter; stops ignore it.
        swept: s.swept === true,
        evidenceRef: `gates.engine.pillar3.swings.${tier}[${i}]`,
      }));
    // Session levels (NYAM.H, LO.H, PDH, ...) are structural highs/lows the
    // engine tracks LIVE — pivot confirmation lags several bars (June 9: the
    // 29847 high printed 09:49, became a confirmed pivot only at 09:56,
    // while NYAM.H carried it from 09:50). Tagged with their own kinds so
    // the generic stop pool can exclude them; only the Inversion stop rule
    // consumes them (GXNQ ruling 2026-06-12: stop above the structural high).
    const levelStops = Object.entries(engine.pillar1?.session_levels ?? {})
      .filter(([, lv]) => Number.isFinite(Number(lv?.price)))
      .map(([key, lv]) => {
        const name = String(lv?.name ?? key);
        if (name.endsWith('H')) return { kind: 'session_level_high', price: Number(lv.price), name, evidenceRef: `gates.engine.pillar1.session_levels.${key}` };
        if (name.endsWith('L')) return { kind: 'session_level_low', price: Number(lv.price), name, evidenceRef: `gates.engine.pillar1.session_levels.${key}` };
        return null;
      })
      .filter(Boolean);
    // V3 leg extremes — the running high/low of the CURRENT leg (since the
    // last external structure break), emitted live on the quality row. No
    // pivot-confirmation lag at all: the bar that prints the extreme carries
    // it. The tightest honest "structural invalidation" anchor (§6) when it
    // sits beyond the violated zone.
    const q = engine.pillar2?.current_tf ?? {};
    const legStops = [];
    if (Number.isFinite(Number(q.leg_high))) {
      legStops.push({ kind: 'leg_high', price: Number(q.leg_high), timeMs: q.leg_high_ms ?? null, evidenceRef: 'gates.engine.pillar2.current_tf.leg_high' });
    }
    if (Number.isFinite(Number(q.leg_low))) {
      legStops.push({ kind: 'leg_low', price: Number(q.leg_low), timeMs: q.leg_low_ms ?? null, evidenceRef: 'gates.engine.pillar2.current_tf.leg_low' });
    }
    out.pillar3 = { ...p3, structural_stops: [...pivotStops('swing'), ...pivotStops('internal'), ...levelStops, ...legStops] };
  }

  return out;
}

function buildStrategyBundleForRuntime(inputs, ev, session) {
  const bundle = inputs.bundle ?? {};
  const leader = inputs.leader || bundle.symbol || bundle.market || ev?.symbol || 'unknown';
  const briefDigest = bundle.brief_digest ?? {};
  const engine = bridgeEngineEvidence(bundle.gates?.engine ?? {}, { lastClose: bundle.quote?.last ?? null });
  engine.pillar1 = {
    ...(engine.pillar1 ?? {}),
    htfBias: engine.pillar1?.htfBias ?? engine.pillar1?.htf_bias ?? htfBiasFromBrief(briefDigest) ?? null,
    htfDraw: engine.pillar1?.htfDraw ?? engine.pillar1?.htf_draw ?? briefDigest.htf_destination ?? null,
    primaryDraw: engine.pillar1?.primaryDraw ?? engine.pillar1?.primary_draw ?? briefDigest.primary_draw ?? null,
    untakenTargets: engine.pillar1?.untakenTargets ?? {
      above: inputs.untaken_targets?.untaken_above ?? [],
      below: inputs.untaken_targets?.untaken_below ?? [],
    },
  };
  const meta = engine.meta ?? {};
  engine.meta = {
    ...meta,
    schemaSupported: meta.schemaSupported ?? meta.schema_supported ?? true,
    stale: meta.stale ?? false,
  };
  // 5m-structure campaign (2026-06-20): when STRUCTURE_TF='5', source market
  // STRUCTURE (swings / MSS+BoS / failure-swings / most-recent) from the 5m
  // engine while the 1m keeps FVGs / sweeps / price_context / confirmation (the
  // entry layer). STOP_TF independently routes the structural stop. The 5m
  // structure is the COMPUTED+bridged gates of the captured 5m table
  // (engine_by_tf.m5). Default '1' leaves the 1m engine byte-identical.
  if (structureTf() === '5' && bundle.engine_by_tf?.m5) {
    const m5 = bridgeEngineEvidence(
      computeEngineGates({
        engine: bundle.engine_by_tf.m5,
        engineByTf: null,
        last: bundle.quote?.last ?? null,
        lastBar: null,
        lastBarAgeSeconds: null,
        m5LastBar: null,
        m15LastBar: null,
        quoteTimeMs: ev?.ts ? Date.parse(ev.ts) : Date.now(),
      }),
      { lastClose: bundle.quote?.last ?? null },
    );
    const p3 = engine.pillar3 ?? {};
    const s3 = m5.pillar3 ?? {};
    engine.pillar3 = {
      ...p3, // fvgs / fvgs_ranked / bprs / fvg_summary stay 1m (the entry layer)
      swings: s3.swings ?? p3.swings,
      structure_events: s3.structure_events ?? p3.structure_events,
      structures_by_tier: s3.structures_by_tier ?? p3.structures_by_tier,
      failure_swings: s3.failure_swings ?? p3.failure_swings,
      most_recent_structure: s3.most_recent_structure ?? p3.most_recent_structure,
      ...(stopTf() === '5' ? { structural_stops: s3.structural_stops ?? p3.structural_stops } : {}),
    };
    engine.meta = { ...engine.meta, structure_tf: '5', stop_tf: stopTf() };
  }
  return {
    ...bundle,
    market: leader,
    session,
    eventTimeUtc: ev?.ts ?? bundle.eventTimeUtc ?? null,
    eventTimeEt: ev?.ts ? new Date(ev.ts).toLocaleString('en-US', { timeZone: 'America/New_York' }) : bundle.eventTimeEt ?? null,
    sessionChain: {
      leader: inputs.leader ?? null,
      ltfBias: inputs.ltf_bias_context?.bias ?? null,
      htfLtfAlignment: inputs.ltf_bias_context?.htf_ltf_alignment ?? null,
      isRetraceDay: inputs.ltf_bias_context?.is_retrace_day ?? false,
      entryModelPriority: inputs.ltf_bias_context?.entry_model_priority ?? null,
      gradeCap: inputs.ltf_bias_context?.grade_cap ?? null,
      // Stage C nested 3-vote grade (drives deriveGrade's A+/B label).
      drawBiasPillar: inputs.ltf_bias_context?.draw_bias_pillar ?? null,
      bElevatable: inputs.ltf_bias_context?.b_elevatable ?? false,
      aPlusEligible: inputs.ltf_bias_context?.a_plus_eligible ?? false,
      pillar1: inputs.session_state?.pillar1 ?? null,
      pillar2: inputs.session_state?.pillar2 ?? null,
    },
    gates: { ...(bundle.gates ?? {}), engine },
    ohlcv1m: bundle.ohlcv1m ?? bundle.bars?.last_5_bars ?? [],
    ohlcv5m: bundle.ohlcv5m ?? bundle.bars_by_tf?.m5?.last_5_bars ?? [],
    // Full session 1m history (~150 bars) for the Trend FVG-candle stop — live
    // from the capture (bundle.full1m), backtest reconstructed in runBacktest.
    full1m: bundle.full1m ?? [],
  };
}

async function persistDeterministicTruth(dir, truth) {
  await fs.mkdir(dir, { recursive: true });
  const record = { ...truth, persistedAt: new Date().toISOString() };
  await fs.writeFile(path.join(dir, 'deterministic-packet.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await fs.appendFile(path.join(dir, 'deterministic-packets.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
}

// Stable 8-hex-char hash (FNV-1a) — setup ids must be a pure function of
// the walker id so the same walker keeps one id across bars, while DIFFERENT
// walkers never collide. The previous 14-char truncation kept only
// walker_<market>_<session>, collapsing every setup in a session into one
// id — the backtest de-dup then swallowed all trades after the first.
function stableIdHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function deterministicSetupId(packet, ev) {
  if (packet.walkerId ?? packet.id) {
    const raw = String(packet.walkerId ?? packet.id);
    const readable = raw
      .replace(/^w(alker)?_/, '')
      .replace(/[^0-9A-Za-z]+/g, '')
      .slice(0, 14) || 'unknown';
    return `D-${readable}-${stableIdHash(raw)}`;
  }
  const eventMs = Date.parse(ev?.ts);
  if (Number.isFinite(eventMs)) {
    const eventKey = new Date(eventMs).toISOString().replace(/[-:]/g, '').slice(0, 13);
    return `D-${eventKey}`;
  }
  const fallback = String(packet.entry?.evidenceRef ?? 'unknown').replace(/[^0-9A-Za-z]+/g, '').slice(0, 14) || 'unknown';
  return `D-${fallback}`;
}

function deterministicPacketToSurfacePayload(packet, ev) {
  return {
    id: deterministicSetupId(packet, ev),
    model: packet.model,
    // Lanto's model CLASS (Reversal/Continuation) — computed in execution-packet.js
    // from leg direction, distinct from the lifecycle name. Surfaced so the UI
    // shows the bot's own classification instead of guessing it (UI-fidelity mandate).
    model_class: packet.model_class ?? null,
    side: packet.side,
    entry: packet.entry?.price,
    entry_cite: packet.entry?.evidenceRef ?? 'deterministic.entry',
    stop: packet.stop?.price,
    stop_cite: packet.stop?.evidenceRef ?? 'deterministic.stop',
    tp1: packet.tp1?.price,
    tp1_cite: packet.tp1?.evidenceRef ?? 'deterministic.tp1',
    tp2: packet.tp2?.price ?? packet.tp1?.price,
    tp2_cite: packet.tp2?.evidenceRef ?? packet.tp1?.evidenceRef ?? 'deterministic.tp2',
    greenlight_ref: packet.greenlightRef ?? null,
    grade: packet.grade,
    tf: ev?.tf ?? '1m',
    rr: packet.tp1?.rMultiple ?? null,
    // TS §6 / §7 Step 7 sizing (grade × day-of-week) — for display only.
    size: packet.size ?? null,
    size_multiplier: packet.size?.contracts ?? 1,
    rationale: 'Deterministic packet truth: TradingView evidence → walker lifecycle → execution packet. LLM/provider may explain it but cannot change entry, stop, target, model, side, or grade.',
    pillar_breakdown: [
      { name: 'Pillar 1', verdict: 'PASS · deterministic context gate', elements: [] },
      { name: 'Pillar 2', verdict: 'PASS · deterministic quality gate', elements: [] },
      { name: 'Pillar 3', verdict: `PASS · ${packet.model} exact confirmation close`, elements: [] },
    ],
    executionPacket: packet,
  };
}

// A fast scan is only chain-usable if the engine emitted zone rows — an empty
// engine table (the forming-bar emit / a CDP read race against the indicator
// re-render) makes the walker chain block missing_ict_engine_rows for that one
// bar. Observed live 2026-06-15 on ~16% of NY-AM bars, each self-recovering the
// next bar. Predicate kept pure for unit testing.
function scanBundleHasEngineRows(bundle) {
  const p3 = bundle?.gates?.engine?.pillar3 ?? {};
  return (Array.isArray(p3.fvgs) && p3.fvgs.length > 0)
    || (Array.isArray(p3.bprs) && p3.bprs.length > 0);
}

// Re-run `scanFn` a bounded number of times until it yields a bundle with
// engine rows, giving the indicator a moment to re-render. FRESH evidence
// only — an empty scan is re-captured, never reused as stale rows; a persistent
// empty (or a scan failure) returns ok:false so the chain blocks honestly.
// `scanFn` + `sleep` are injectable so the retry loop is unit-testable.
async function scanUntilEngineRows({
  scanFn, retries = 3, waitMs = 350,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    let bundle = null;
    try {
      bundle = await scanFn();
    } catch (err) {
      return { ok: false, failed: true, attempts: attempt, error: err };
    }
    if (scanBundleHasEngineRows(bundle)) return { ok: true, attempts: attempt, bundle };
    if (attempt < retries) await sleep(waitMs);
  }
  return { ok: false, attempts: retries, bundle: null };
}

async function refreshEntryHuntScanForWalker(session) {
  const res = await scanUntilEngineRows({
    scanFn: async () => (await tvAnalyzeFast(entryHuntFastScanArgs())).bundle,
  });
  if (res.failed) {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] entry-hunt scan refresh failed", res.error?.message || res.error);
    recordMetric({ kind: "bar-close", event: "scan_refresh_failed", session, reason: String(res.error?.message || res.error) });
    return;
  }
  if (res.ok) {
    recordMetric({ kind: "bar-close", event: "scan_refreshed", session, ...(res.attempts > 1 ? { attempts: res.attempts } : {}) });
    return;
  }
  // Still no engine rows after retries — leave the fresh (engine-less) scan on
  // disk; the chain blocks missing_ict_engine_rows honestly rather than fold
  // against stale evidence.
  recordMetric({ kind: "bar-close", event: "scan_empty_engine_persist", session, attempts: res.attempts });
}

// Targeted fresh 5m capture (--scan-tf 5: switch → verified read → restore,
// ~3s). Best-effort; on failure buildDetectorInputs just keeps the baseline m5.
async function refreshFreshM5() {
  try {
    await tvAnalyzeFast({ scanTf: "5" }, { outPath: FRESH_M5, skipRead: true });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] fresh-m5 capture failed", err?.message || err);
    return false;
  }
}

// Pure: overlay a freshly-captured 5m engine bundle onto the scan bundle's
// engine_by_tf.m5 (+ bars_by_tf.m5). Only applies a schema-supported 5m engine
// captured within maxAgeMs (a stale prior-session cache is ignored). Mutates +
// returns bundle. The open-reaction read + walker overlay both read
// engine_by_tf.m5, so this is the single point that makes live's 5m == the
// last-closed 5m bar (matching the backtest tapes).
export function overlayFreshM5(bundle, freshBundle, { nowMs = Date.now(), maxAgeMs = FRESH_M5_MAX_AGE_MS } = {}) {
  const eng = freshBundle?.engine;
  if (!bundle || !eng || eng.schema_supported !== true) return bundle;
  if (String(eng?.meta?.tf ?? "") !== "5") return bundle;
  const capMs = freshBundle?.timestamp ? Date.parse(freshBundle.timestamp) : null;
  if (capMs && Number.isFinite(capMs) && nowMs - capMs > maxAgeMs) return bundle;
  bundle.engine_by_tf = { ...(bundle.engine_by_tf ?? {}), m5: eng };
  if (freshBundle?.bars) bundle.bars_by_tf = { ...(bundle.bars_by_tf ?? {}), m5: freshBundle.bars };
  return bundle;
}

async function readBriefJson(session, leader = null) {
  const dir = await activeSessionDir();
  const candidates = [briefFilenameForLeader(leader), "brief.json"].filter((v, i, a) => v && a.indexOf(v) === i);
  let lastErr;
  for (const filename of candidates) {
    try {
      const txt = await fs.readFile(path.join(dir, filename), "utf8");
      return JSON.parse(txt);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// Full bundle first — the slim projection is the LLM's view, not the chain's.
const DETECTOR_SCAN_CANDIDATES = [
  path.join(REPO_ROOT, "state", "last-scan.json"),
  path.join(REPO_ROOT, "state", "last-scan.slim.json"),
];

async function buildDetectorInputs(session) {
  // `session` was previously read as a bare module-scope variable that
  // doesn't exist — readBriefJson(session, ...) threw ReferenceError on
  // every live bar, the try/catch swallowed it, brief stayed null, and
  // untaken_targets came back empty so every packet would have blocked on
  // missing_side_consistent_tp1. Parameterized 2026-06-12.
  const dir = await activeSessionDir();

  // Load bundle: FULL first, slim as fallback. The slim projection exists
  // for the LLM's Read budget and strips gates.engine.pillar3 + bars —
  // exactly what the walker chain needs (rows bridge, failure swings,
  // structural stops, confirmation bars). Preferring slim here starved the
  // chain live: every 2026-06-12 London bar blocked missing_ict_engine_rows
  // while last-scan.json sat next to it with 24 fvgs.
  let bundle = null;
  for (const candidatePath of DETECTOR_SCAN_CANDIDATES) {
    try { bundle = JSON.parse(await fs.readFile(candidatePath, "utf8")); break; } catch {}
  }
  if (!bundle) return null;

  // Live fresh-5m: overlay the targeted 5m capture taken on 5m closes so the
  // open-reaction read + walker see the last-closed 5m bar fresh (live == the
  // backtest tapes). Falls through to the scan's baseline m5 when absent/stale
  // (e.g. before the first 5m close).
  try {
    const freshM5 = JSON.parse(await fs.readFile(FRESH_M5, "utf8"));
    overlayFreshM5(bundle, freshM5);
  } catch { /* no fresh-m5 yet — baseline m5 stands */ }

  // Brief on disk has htf_destination + primary_draw + overnight_block.
  // Leader: the minute-14 pair decision when it exists, else the configured
  // primary — the chain must not block a whole session on a missing LLM
  // leader call (missing_pair_decision blocked every 2026-06-12 London bar).
  const leader = (await readPairDecisionLeader()) ?? PAIR_PRIMARY;
  let brief = null;
  try { brief = await readBriefJson(session, leader); } catch {}

  let ltf_bias_context = await readLtfBiasFrontmatter();
  // Deterministic open-reaction fallback (§2.3 / §7 Step 4): when no
  // ltf-bias.md exists past the minute-15 boundary — the LLM open-reaction/
  // catch-up turn didn't run (2026-06-12 London: auth-blocked) — derive the
  // verdict from the engine's own sweep + swing-structure evidence, the
  // same resolver the backtest engine uses. An LLM-written ltf-bias.md
  // always wins; the fallback only fills absence.
  if (!ltf_bias_context?.bias) {
    try {
      const dir = await activeSessionDir();
      const derived = deriveLtfBiasContext({
        bundle, brief, session,
        eventTs: bundle?.quote?.time ? new Date(bundle.quote.time * 1000).toISOString() : new Date().toISOString(),
        // Full open-window closes (window-closes.js) so the live read matches the
        // backtest's accumulated coverage, not the bundle's 4-5 bar tail.
        windowClosesOverride: readWindowCloses(dir),
      });
      if (derived) ltf_bias_context = derived;
    } catch { /* fallback is best-effort; the chain blocks honestly without it */ }
  }

  // Persist the per-bar EFFECTIVE LTF bias so the LIVE/PREP popovers can show it
  // resolving in real time (depth-2). The minute-14 ltf-bias.json snapshot stays
  // PENDING through a stand-aside open while THIS per-bar resolver actively earns
  // a direction — that work was invisible because it was never written down.
  // activeSessionDir() isolates this to the backtest folder under replay, so it
  // never pollutes live state. Best-effort: getOpenReaction falls back to the
  // snapshot if the file is absent.
  try {
    const liveDir = await activeSessionDir();
    await fs.writeFile(
      path.join(liveDir, "ltf-bias-live.json"),
      JSON.stringify({ ...(ltf_bias_context || {}), ts: new Date().toISOString() }, null, 2),
    );
  } catch { /* best-effort; popover falls back to the ltf-bias.json snapshot */ }

  const session_state = await readSessionStrategyState(brief).catch(() => ({}));

  // Synthesize brief_digest fields the detector reads — see
  // cli/lib/detector-brief-digest.js for the why (single-symbol bundles
  // post-pair-decision, slim projections, analyze-time-before-brief).
  attachDetectorBriefDigest(bundle, brief, leader);

  return {
    bundle,
    leader,
    ltf_bias_context,
    session_state,
    untaken_targets: {
      untaken_above: brief?.overnight_block?.untaken_above || [],
      untaken_below: brief?.overnight_block?.untaken_below || [],
    },
  };
}

export const __test = {
  buildDeterministicPacketTruthFromInputs,
  buildStrategyBundleForRuntime,
  deterministicPacketToSurfacePayload,
  truthCacheKeyFor,
  llmTurnAuthBlocked,
  scanBundleHasEngineRows,
  scanUntilEngineRows,
  overlayFreshM5,
};

// Read the chosen leader symbol from pair-decision.json. Returns null if
// the file is missing, malformed, or leader is null (inconclusive). Used
// by the entry-hunt prompt to point Claude at the leader's baseline.
async function readPairDecisionLeader() {
  const dir = await activeSessionDir();
  try {
    const txt = await fs.readFile(path.join(dir, "pair-decision.json"), "utf8");
    const decision = JSON.parse(txt);
    return decision?.leader || null;
  } catch { return null; }
}

// Before each Claude turn during entry-hunt, pin the chart to the leader
// symbol + correct TF (1m for 1m ticks, 5m for 5m close turns). Strategy
// §3 — entry scanning needs the chart on 1m base; at 5m closes we briefly
// flip to 5m for the 5m-flavor walk, then the next 1m tick pulls it back.
//
// If pair-decision.json doesn't exist yet (pre-session / open-reaction),
// or the leader is null (inconclusive), this is a no-op — those phases
// run their own dual-symbol scans and don't want the chart pinned.
// #2 Throttle the chart-revert notice — if the trader keeps clicking
// away every couple minutes, they'd get a toast every minute back.
// Notify once per CHART_REVERT_NOTICE_MS window. Trader sees the
// message once, then we stay quiet about repeated reverts.
const CHART_REVERT_NOTICE_MS = 10 * 60 * 1000;   // 10 min
let _lastChartRevertNoticeTs = 0;

async function preflightChartState(ev, phase) {
  if (phase !== "entry_hunt") return;
  const dir = await activeSessionDir();
  let decision;
  try {
    const txt = await fs.readFile(path.join(dir, "pair-decision.json"), "utf8");
    decision = JSON.parse(txt);
  } catch {
    decision = null;
  }
  // No pair decision (the LLM minute-14 call never fired — e.g. auth down)
  // → pin the configured primary. "Leave the chart alone" let a crashed
  // pair sweep strand the chart on MES@5m for 23 minutes of garbage folds
  // (2026-06-12 NY-AM); during entry hunt the chart must ALWAYS be on the
  // leader at the 1m fold TF (NOT the event's 5m narration tag — that pinned
  // the chart to 5m on every 5m boundary and corrupted ~1-in-5 folds; see
  // entryHuntChartTf).
  const leader = decision?.leader ?? PAIR_PRIMARY;
  const timeframe = entryHuntChartTf(ev);
  const result = await ensureChartState({ symbol: leader, timeframe });
  if (result?.changed) {
    const sinceLast = Date.now() - _lastChartRevertNoticeTs;
    if (sinceLast > CHART_REVERT_NOTICE_MS) {
      _send?.("app:error", {
        source: "preflight",
        level: "warn",
        message: `Chart reverted to ${leader} @ ${timeframe}m (entry-hunt requires it). Manual changes will keep snapping back.`,
      });
      _lastChartRevertNoticeTs = Date.now();
    }
  }
}

// Append a per-bar log to the session folder. Main computes body_ratio and
// close_position_in_range from the OHLC — Claude reads, never produces.
// Gated on is_new_bar: at minute ticks where the chart's TF bar hasn't
// rolled over yet (chart on a higher TF), we'd otherwise write the same
// running bar repeatedly — skip those.
// Per-TF dedup: the detector occasionally emits two events for the same
// minute (timing edge cases between the 60s boundary sleep and the close
// poll). Without dedup, bars.jsonl gets duplicate rows that mislead the
// model's "last 6 bars" read.
const _lastBarLogged = { "1m": null, "5m": null };

async function appendBarLog(ev) {
  if (!ev?.is_new_bar) return;
  const o = ev?.ohlc?.open, h = ev?.ohlc?.high, l = ev?.ohlc?.low, c = ev?.ohlc?.close;
  if (o == null || h == null || l == null || c == null) return;
  // Dedup: if we already logged this exact bar for this tf, skip.
  const tfKey = ev.tf === "5m" ? "5m" : "1m";
  if (_lastBarLogged[tfKey] === ev.ts) return;
  _lastBarLogged[tfKey] = ev.ts;

  const range = Math.max(h - l, 1e-9);
  const body_ratio = Number((Math.abs(c - o) / range).toFixed(3));
  const close_position_in_range = Number(((c - l) / range).toFixed(3));
  const direction = c > o ? "bullish" : c < o ? "bearish" : "doji";
  // time_et added so Claude reads ET timestamps in session memory (bars.jsonl
  // tail goes into the per-bar prompt). time_utc kept for machine parsing.
  const time_et = new Date(ev.ts).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const rec = { time_et, time_utc: ev.ts, tf: ev.tf, chart_tf: ev.chart_tf, o, h, l, c, body_ratio, direction, close_position_in_range };
  const dir = await activeSessionDir();
  // Always log to bars.jsonl (one per tick when a new chart-TF bar closes).
  // Mirror to bars-5m.jsonl at wall-clock 5m boundaries — useful when chart
  // is on 1m and we want a clean 5m stream for the strategy's confirmation TF.
  await fs.appendFile(path.join(dir, "bars.jsonl"), JSON.stringify(rec) + "\n", "utf8");
  if (ev.is_5m_close) {
    await fs.appendFile(path.join(dir, "bars-5m.jsonl"), JSON.stringify({ ...rec, tf: "5m" }) + "\n", "utf8");
  }
}

// Per-bar memory enrichment delegates to session-memory.readMemory so the
// brief writer and the bar-close reader share one definition + one race-
// safe read path (writes are atomic via tmp+rename in session-memory).
async function readSessionMemory() {
  const dir = await activeSessionDir();
  return readMemory(dir, { tailBars: MEMORY_BARS_TAIL, tailSetups: MEMORY_SETUPS_TAIL });
}

function phaseFor(session, ev) {
  if (session === "idle") return "off";
  const t = new Date(ev.ts);
  const ny = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(t);
  const hh = Number(ny.find((p) => p.type === "hour")?.value || 0);
  const mm = Number(ny.find((p) => p.type === "minute")?.value || 0);
  const mins = hh * 60 + mm;

  if (session === "ny-am") return mins < 9 * 60 + 45 ? "open_reaction" : "entry_hunt";
  if (session === "ny-pm") return mins < 13 * 60 + 15 ? "open_reaction" : "entry_hunt";
  if (session === "london") return mins < 3 * 60 + 15 ? "open_reaction" : "entry_hunt";
  return "off";
}

// Minutes since the open-reaction window opened. Used so Claude knows when
// to call surface_ltf_bias (at >= 14). Returns null outside open-reaction.
function minutesIntoPhase(session, ev, phase) {
  if (phase !== "open_reaction") return null;
  const t = new Date(ev.ts);
  const ny = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(t);
  const hh = Number(ny.find((p) => p.type === "hour")?.value || 0);
  const mm = Number(ny.find((p) => p.type === "minute")?.value || 0);
  const mins = hh * 60 + mm;
  if (session === "ny-am") return mins - (9 * 60 + 30);
  if (session === "ny-pm") return mins - (13 * 60);
  if (session === "london") return mins - (3 * 60);
  return null;
}

// #65 tickOpenTrades + maybeWarnSessionEndedWithOpenTrades +
// writeSessionEndAudit moved to ./trade-ticker.js. This file is now
// closer to pure orchestration — detector lifecycle, event dispatch,
// Claude turns, chart preflight.

// Capture a paired baseline (~30s) and split it into per-symbol baselines so
// open-reaction fast scans stay fast (~2s). Also writes the legacy single
// baseline.json for backward compat with any consumer that still reads it.
//
// When the analyzer short-circuits (pair-decision.json exists during
// entry-hunt), tvAnalyzeFull --pair returns a single-symbol bundle (no
// pair block). In that case we just write that single-symbol bundle to
// the leader's baseline + legacy baseline.json.
async function maybeRefreshBaseline() {
  if (_refreshingBaseline) return;
  try {
    const stat = await fs.stat(BASELINE_PRIMARY);
    const ageSec = (Date.now() - stat.mtimeMs) / 1000;
    if (ageSec < BASELINE_STALE_S) return;
  } catch {
    // baseline missing → refresh
  }
  _refreshingBaseline = true;
  try {
    // eslint-disable-next-line no-console
    console.log("[bar-close] refreshing paired baseline");
    await tvAnalyzeFull({ pair: PAIR_DEFAULT }, { outPath: BASELINE, skipRead: true });
    const bundle = JSON.parse(await fs.readFile(BASELINE, "utf8"));
    if (bundle?.pair?.symbols) {
      // Split paired bundle into per-symbol baselines. Each per-symbol
      // baseline mirrors the shape of a normal single-symbol bundle so
      // tv analyze --baseline can consume it directly.
      for (const symbol of [bundle.pair.primary, bundle.pair.secondary]) {
        const sub = bundle.pair.symbols[symbol];
        if (!sub) continue;
        const subBaseline = {
          timestamp: bundle.timestamp,
          chart: sub.chart,
          quote: sub.quote,
          bars: sub.bars,
          bars_by_tf: sub.bars_by_tf,
          engine: sub.engine,
          engine_by_tf: sub.engine_by_tf,
          gates: sub.gates,
        };
        await fs.writeFile(
          path.join(REPO_ROOT, baselinePathFor(symbol)),
          JSON.stringify(subBaseline),
          "utf8",
        );
      }
    } else {
      // Single-symbol bundle (e.g. analyzer short-circuited because
      // pair-decision.json exists). Use it as the primary's baseline.
      await fs.writeFile(BASELINE_PRIMARY, JSON.stringify(bundle), "utf8");
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] baseline refresh failed", err?.message || err);
  } finally {
    _refreshingBaseline = false;
  }
}
