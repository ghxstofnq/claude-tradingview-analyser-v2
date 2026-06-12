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
import { PAIR_DEFAULT, PAIR_PRIMARY, PAIR_SECONDARY, baselinePathFor } from "./config.js";
import { deriveLtfBiasContext } from "./live-ltf-resolver.js";
import { markBarReceived, markTurnComplete } from "./health.js";
import { markBarReceivedForWatchdog } from "./trade-ticker-watchdog.js";
import { activeSessionDir } from "./sessions.js";
import { attachDetectorBriefDigest, parseHtfDestination } from "../../cli/lib/detector-brief-digest.js";
import { readMemory } from "./session-memory.js";
import { onModeChange, isLive } from "./mode.js";
import { record as recordMetric } from "./metrics.js";
import { foldOpenTrades } from "../../cli/lib/trade-outcomes.js";
import { buildWalkerInputsRecord } from "../../cli/lib/day-tape.js";
// #65 Trade ticking + session-end audit live in trade-ticker now,
// so this file is closer to pure orchestration.
import { setTickerSink, tickOpenTrades, maybeWarnSessionEndedWithOpenTrades } from "./trade-ticker.js";
import { surfaceSetup, surfaceNoTrade } from "./tools/surface.js";
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

// Single-brain entry hunt (2026-06-12). The walker chain is the ONLY setup
// producer — it surfaces packets/no-trades deterministically before any LLM
// turn. The per-bar LLM turn is narration-only, and it runs only when there
// is something to narrate: a packet fired, a walker changed stage, or a 5m
// close (the strategy's confirmation TF — trading-strategy-2026.md §7 step
// 6). Quiet 1m bars skip the LLM entirely. Source: docs/research/
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

  // Phase-aware: decide if Claude should react.
  const { session } = currentSession();
  const phase = phaseFor(session, ev);
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
  // If Claude Code is not authenticated, keep deterministic bar/trade/walker
  // ticking alive but suppress LLM turns. Otherwise a missing local login
  // creates one failed catch-up/wrap/brief attempt per scheduler tick.
  // Provider-aware: a Claude login failure must not mute turns when the
  // bar-close purpose resolves to Codex (scheduled-turn.js already does
  // this; the per-bar path missed it — observed 2026-06-12).
  const providerName = resolveLlmProvider({ purpose: "bar-close" }).name;
  const authBlocked = llmTurnAuthBlocked({ providerName, claudeBlocked: !!isClaudeAuthBlocked() });

  // Catch-up: if we entered entry-hunt without a pair-decision (started the
  // system after 09:45 ET for NY AM / 13:15 for NY PM / 03:15 for London),
  // the open-reaction window has already passed and surface_leader_decision
  // never fired. Trigger a one-shot catch-up turn now to pick the leader
  // from current data so the rest of entry-hunt has the chart pinned and
  // can run normally.
  if (!authBlocked && phase === "entry_hunt" && !(await pairDecisionExists())) {
    await runLeaderCatchupTurn(ev, session).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[bar-close] leader catch-up threw", err?.message || err);
    });
    // pair-decision.json may exist now; preflight will pin chart on next call
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
  let hint;
  if (phase === "open_reaction") {
    const finalize = mip != null && mip >= 14;
    const pairLine =
      `Pair config: pass pair="${PAIR_DEFAULT}", baseline="${baselinePathFor(PAIR_PRIMARY)}", baseline_secondary="${baselinePathFor(PAIR_SECONDARY)}" to tv_analyze_fast — the dual-symbol bundle is required to compute leader_evidence and to call surface_leader_decision at minute 14.`;
    hint = `Open-reaction window (+${mip ?? "?"}m of 15). Required action: ${pairLine} Call surface_open_reaction with the latest read (session="${session}"). ${finalize ? `minutes_into_phase >= 14 — also call surface_leader_decision with the values from pair.leader_evidence and surface_ltf_bias to finalize bias. ` : ""}End the turn with surface_no_trade — no setup card during open-reaction.`;
  } else {
    // Entry hunt — narration-only (single-brain, 2026-06-12). The walker
    // chain already surfaced this bar's verdict in code; the model explains
    // it. The hint must agree with <phase name="entry_hunt"> in the system
    // prompt — the 2026-05-27 lesson: a hint that contradicts the system
    // prompt makes the model execute BOTH paths and blow the turn timeout.
    hint = entryHuntNarrationHint();
  }
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

  // Catch-up routing — if we're past the open-reaction window but ltf-bias.md
  // is missing, route the model into <phase name="catch_up"> to backfill
  // pair-decision.json + ltf-bias.md before continuing to entry_hunt. The
  // existing legacy catch-up path (line ~462) handles the missing
  // pair-decision.json case specifically; this is the broader chain-aware
  // routing per spec §5.1.
  const sdir = await activeSessionDir();
  const pillar1Exists = existsSync(path.join(sdir, "pillar1.md"));
  const pillar2Exists = existsSync(path.join(sdir, "pillar2.md"));
  const ltfBiasExists = existsSync(path.join(sdir, "ltf-bias.md"));
  const sessionPhase = `${phase}_${session.replace("-", "_")}`;
  const isCatchUp = shouldRouteToCatchUp({
    sessionPhase,
    pillar1Exists,
    pillar2Exists,
    ltfBiasExists,
  });
  // Quiet-bar gate: during entry hunt (and only outside catch-up), skip the
  // LLM turn entirely when nothing narration-worthy happened this bar. The
  // walker chain already surfaced its verdict; the UI's walker panel and
  // deterministic events update every bar regardless.
  if (phase === "entry_hunt" && !isCatchUp && !shouldRunNarrationTurn({ truth: walkerTruth, ev })) {
    recordMetric({ kind: "bar-close", event: "skipped", session, reason: "narration_quiet_bar" });
    return;
  }
  // When in catch-up mode, REPLACE the per-phase hint with a focused
  // catch_up directive. Don't pile both on the model — the 90s bar-close
  // timeout can't accommodate "do catch_up AND walk three entry models".
  // After ltf-bias.md is written, the next bar falls through to the
  // normal entry_hunt hint.
  const text = isCatchUp
    ? `A new ${ev.tf} bar just closed at ${etTime} ET (utc=${ev.ts}). ${phaseLine}${memoryBlock}${untakenBlock}\n**CATCH-UP TURN** — ltf-bias.md is missing past the open-reaction window. Follow <phase name="catch_up"> in the system prompt: read pillar1.md frontmatter (both symbols), read pair-decision.json (leader is already chosen), compute the LTF bias from gates.engine.confirmation.last_bar + gates.engine.most_recent_structure, write ltf-bias.md via surface_ltf_bias with backfilled:true, leader:"<leader>", grade_cap:"B", chain_status:"backfilled:open_reaction". DO NOT walk entry models this bar — entry_hunt fires normally on the next bar. End with surface_no_trade("backfilling ltf-bias").`
    : `A new ${ev.tf} bar just closed at ${etTime} ET (utc=${ev.ts}). ${phaseLine}${memoryBlock}${untakenBlock}${walkerTruthBlock}\n${hint}`;

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
      if (e.type === "chunk") _send?.("chat:chunk", e);
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
        _send?.("chat:turn_complete", e);
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

// Read ltf-bias.md frontmatter — flat YAML between --- markers — to drive
// the detector's grade_cap / htf_ltf_alignment / entry_model_priority logic.
async function readLtfBiasFrontmatter() {
  const dir = await activeSessionDir();
  try {
    const txt = await fs.readFile(path.join(dir, "ltf-bias.md"), "utf8");
    const m = txt.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const fm = {};
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^(\w+):\s*"?([^"]*?)"?$/);
      if (kv) fm[kv[1]] = kv[2].trim();
    }
    return {
      bias: fm.bias || fm.leader_bias || null,
      leader: fm.leader || null,
      htf_ltf_alignment: fm.htf_ltf_alignment || null,
      is_retrace_day: fm.is_retrace_day === "true",
      entry_model_priority: fm.entry_model_priority || null,
      grade_cap: fm.grade_cap || null,
    };
  } catch { return {}; }
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

  if (bestPacket) {
    await surfaceSetup(truth.surfacePayload);
  } else {
    const reason = truth.noTradeReason ?? `deterministic packet blocked: ${(truth.blockers?.length ? truth.blockers : ['no_confirmed_packet']).join(', ')}`;
    await surfaceNoTrade({ reason }).catch((err) => {
      // A recent setup can suppress no-trade; that's fine for UI lifecycle.
      if (!/suppressed/i.test(String(err?.message || err))) throw err;
    });
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
  const bestPacket = result.bestPacket ? { ...result.bestPacket, finalVerdict: result.finalVerdict } : null;
  const blockers = bestPacket
    ? []
    : (result.packets?.flatMap((packet) => packet.blockers ?? []).slice(0, 10) ?? context.blockers ?? ['no_confirmed_packet']);
  const noTradeReason = bestPacket ? null : `${availability.reasonPrefix}: ${(blockers.length ? blockers : ['no_confirmed_packet']).join(', ')}`;
  return {
    schemaVersion: 1,
    eventTimeUtc: event?.ts ?? null,
    market: context.market,
    session,
    finalVerdict: result.finalVerdict,
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
    const violated = (confirmed || !wantDir) ? null : out.rows.find((row) => {
      if (row.state !== 'inverted' || !['fvg', 'ifvg'].includes(String(row.kind))) return false;
      if (row.dir !== wantDir) return false;
      const top = Number(row.top);
      const bottom = Number(row.bottom);
      if (!Number.isFinite(top) || !Number.isFinite(bottom) || !Number.isFinite(Number(close))) return false;
      return wantDir === 'bear' ? Number(close) < bottom : Number(close) > top;
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
      pillar1: inputs.session_state?.pillar1 ?? null,
      pillar2: inputs.session_state?.pillar2 ?? null,
    },
    gates: { ...(bundle.gates ?? {}), engine },
    ohlcv1m: bundle.ohlcv1m ?? bundle.bars?.last_5_bars ?? [],
    ohlcv5m: bundle.ohlcv5m ?? bundle.bars_by_tf?.m5?.last_5_bars ?? [],
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
    side: packet.side,
    entry: packet.entry?.price,
    entry_cite: packet.entry?.evidenceRef ?? 'deterministic.entry',
    stop: packet.stop?.price,
    stop_cite: packet.stop?.evidenceRef ?? 'deterministic.stop',
    tp1: packet.tp1?.price,
    tp1_cite: packet.tp1?.evidenceRef ?? 'deterministic.tp1',
    tp2: packet.tp2?.price ?? packet.tp1?.price,
    tp2_cite: packet.tp2?.evidenceRef ?? packet.tp1?.evidenceRef ?? 'deterministic.tp2',
    grade: packet.grade,
    tf: ev?.tf ?? '1m',
    rr: packet.tp1?.rMultiple ?? null,
    size_multiplier: 1,
    rationale: 'Deterministic packet truth: TradingView evidence → walker lifecycle → execution packet. LLM/provider may explain it but cannot change entry, stop, target, model, side, or grade.',
    pillar_breakdown: [
      { name: 'Pillar 1', verdict: 'PASS · deterministic context gate', elements: [] },
      { name: 'Pillar 2', verdict: 'PASS · deterministic quality gate', elements: [] },
      { name: 'Pillar 3', verdict: `PASS · ${packet.model} exact confirmation close`, elements: [] },
    ],
    executionPacket: packet,
  };
}

async function refreshEntryHuntScanForWalker(session) {
  try {
    await tvAnalyzeFast(entryHuntFastScanArgs(), { skipRead: true });
    recordMetric({ kind: "bar-close", event: "scan_refreshed", session });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] entry-hunt scan refresh failed", err?.message || err);
    recordMetric({ kind: "bar-close", event: "scan_refresh_failed", session, reason: String(err?.message || err) });
  }
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
      const derived = deriveLtfBiasContext({
        bundle, brief, session,
        eventTs: bundle?.quote?.time ? new Date(bundle.quote.time * 1000).toISOString() : new Date().toISOString(),
      });
      if (derived) ltf_bias_context = derived;
    } catch { /* fallback is best-effort; the chain blocks honestly without it */ }
  }
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

// One-shot leader-pick turn fired when entering entry-hunt without a
// pair-decision (system started after the open-reaction window closed,
// or the open-reaction turns failed to call surface_leader_decision).
//
// Asks Claude to capture a paired bundle now, treat current FVG disp_score
// as the leader_evidence proxy (we lost the chance to measure during the
// 15-min window), and call surface_leader_decision so the chart can be
// pinned for the rest of the session.
async function runLeaderCatchupTurn(ev, session) {
  // eslint-disable-next-line no-console
  console.log("[bar-close] leader catch-up: no pair-decision found, firing leader-pick turn");
  const etTime = new Date(ev.ts).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const text = `CATCH-UP TURN at ${etTime} ET — missed open-reaction window for the ${session.toUpperCase()} session. Pick leader + finalize LTF bias in ONE turn so entry-hunt can resume next bar.

Steps:
1. Call mcp__tv__tv_analyze_fast with pair="${PAIR_DEFAULT}", baseline="${baselinePathFor(PAIR_PRIMARY)}", baseline_secondary="${baselinePathFor(PAIR_SECONDARY)}". This produces a fresh paired bundle PLUS a sibling state/last-scan.digest.json (pretty-printed, ~17KB).
2. Read **state/last-scan.digest.json** (NOT last-scan.json — the full bundle is one giant single line truncated by Read). The digest carries leader_evidence + per-symbol HTF + pillar1 + ltf_context. Pick leader per the reason table:
   - primary_higher_disp_score (margin ≥ threshold) → primary, chain_status: "clean"
   - secondary_higher_disp_score (margin ≥ threshold) → secondary, chain_status: "clean"
   - inconclusive_margin_below_threshold → primary (DEFAULT), chain_status: "degraded:leader_inconclusive"
   - no_fvgs_created_in_window → primary (DEFAULT), chain_status: "degraded:no_fvgs_in_window"
   - secondary_engine_missing → primary, chain_status: "degraded:secondary_missing"
3. Call mcp__tv__surface_leader_decision with session="${session}", primary="${PAIR_PRIMARY}", secondary="${PAIR_SECONDARY}", leader=<chosen>, evidence={primary_disp_score, secondary_disp_score, margin, threshold} (all from brief_digest.leader_evidence), reason=<verbatim from leader_evidence>.
4. Read state/session/${currentSession().date}/${session}/pillar2.md frontmatter → grab the leader's pillar2_verdict (under \`<leader-key>:\` block, e.g. \`mnq:\` for MNQ1!). If missing or "pending", default to "poor" (catch-up assumption — we didn't grade Pillar 2 live).
5. Read state/session/${currentSession().date}/${session}/pillar1.md frontmatter → grab the leader's \`htf_destination\` (the brief's anchor, e.g. "above 30119 buy-side").
6. Compute ltf_bias from the last 5-6 entries of state/session/${currentSession().date}/${session}/bars.jsonl: count bullish vs bearish closes. ≥4 of 6 bullish → "bullish"; ≥4 of 6 bearish → "bearish"; mixed → "mixed"; if engine.meta.stale or no bar data → "stand_aside".
7. Compute htf_ltf_alignment from htf_destination vs ltf_bias:
   - htf_destination starts with "above" AND ltf_bias=="bullish" → "aligned"
   - htf_destination starts with "below" AND ltf_bias=="bearish" → "aligned"
   - htf_destination starts with "above" AND ltf_bias=="bearish" → "divergent"
   - htf_destination starts with "below" AND ltf_bias=="bullish" → "divergent"
   - htf_destination=="balanced", ltf_bias=="mixed"/"stand_aside", or htf_destination missing → "unclear"
8. Compute entry_model_priority from the decision tree in <phase name="open_reaction"> §B (the same tree the surface.js resolver uses):
   - pillar2_verdict=="poor" → "undecided"
   - htf_ltf_alignment=="divergent" → "MSS"
   - htf_ltf_alignment=="aligned" + recent failure_swing → "MSS"; + recent BoS in bias dir → "Trend"; + opposing inverted FVG → "Inversion"; else → "undecided"
   - htf_ltf_alignment=="unclear" → "undecided"
9. Call mcp__tv__surface_ltf_bias with session="${session}", leader=<chosen>, ltf_bias=<computed step 6>, htf_ltf_alignment=<computed step 7>, is_retrace_day=<true if step 7 was "divergent" else false>, entry_model_priority=<computed step 8>, priority_reason="<one line: which input drove the step 8 decision>", grade_cap:"B" (always B for backfilled sessions), chain_status:"backfilled:open_reaction", reasoning="<one short paragraph citing the bar.jsonl entries + pillar1/pillar2 frontmatter values you read>", failure_swings_present=<from step 8 check>, inverted_fvg_present=<from step 8 check>, pillar2_verdict=<from step 4>.
10. End with mcp__tv__surface_no_trade reason="caught up post-hoc — entry-hunt resumes next bar".

Do NOT walk entry models or call surface_setup. Leader + LTF backfill ONLY.`;
  recordMetric({ kind: "catch-up", event: "started", session });
  const startedAtCatchup = Date.now();
  let erroredCatchup = false;
  let usageCatchup = null;
  await userTurn({
    text,
    purpose: "catch-up",
    // Catch-up now does TWO surface calls (leader_decision + ltf_bias)
    // plus a fast capture + Read + bars.jsonl read. Bumped from default
    // 300s to 240s — gives the model breathing room but caps risk of
    // blocking the bar-close queue if something hangs.
    timeoutMs: 240_000,
    onEvent: (e) => {
      if (e.type === "chunk") _send?.("chat:chunk", e);
      else if (e.type === "tool_call") _send?.("chat:tool_call", e);
      else if (e.type === "turn_complete") {
        _send?.("chat:turn_complete", e);
        markTurnComplete();
      }
      else if (e.type === "usage") { usageCatchup = e.usage; }
      else if (e.type === "error") {
        erroredCatchup = true;
        _send?.("app:error", { source: "sdk", message: e.message });
      }
    },
  });
  recordMetric({
    kind: "catch-up",
    event: erroredCatchup ? "failed" : "succeeded",
    session,
    durationMs: Date.now() - startedAtCatchup,
    usage: usageCatchup,
  });
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
  // leader at the event TF.
  const leader = decision?.leader ?? PAIR_PRIMARY;
  const timeframe = ev.tf === "5m" ? "5" : "1";
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
