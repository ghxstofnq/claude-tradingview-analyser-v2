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
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as replayCore from "@tvmcp/core/replay";
import { userTurn } from "./sdk.js";
import { currentSession } from "./sessions.js";
import { tvAnalyzeFull } from "./tools/tv-analyze.js";
import { ensureChartState } from "./tools/tv-chart.js";
import { PAIR_DEFAULT, PAIR_PRIMARY, PAIR_SECONDARY, baselinePathFor } from "./config.js";
import { markBarReceived, markTurnComplete } from "./health.js";
import { markBarReceivedForWatchdog } from "./trade-ticker-watchdog.js";
import { activeSessionDir } from "./sessions.js";
import { readMemory } from "./session-memory.js";
import { onModeChange, isLive } from "./mode.js";
import { record as recordMetric } from "./metrics.js";
import { foldOpenTrades } from "../../cli/lib/trade-outcomes.js";
// #65 Trade ticking + session-end audit live in trade-ticker now,
// so this file is closer to pure orchestration.
import { setTickerSink, tickOpenTrades, maybeWarnSessionEndedWithOpenTrades } from "./trade-ticker.js";

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

export function startDetector({ send }) {
  _send = send;
  setTickerSink(send);
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
async function hasOpenTrades() {
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
  // Catch-up: if we entered entry-hunt without a pair-decision (started the
  // system after 09:45 ET for NY AM / 13:15 for NY PM / 03:15 for London),
  // the open-reaction window has already passed and surface_leader_decision
  // never fired. Trigger a one-shot catch-up turn now to pick the leader
  // from current data so the rest of entry-hunt has the chart pinned and
  // can run normally.
  if (phase === "entry_hunt" && !(await pairDecisionExists())) {
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

  const memory = await readSessionMemory();
  const mip = minutesIntoPhase(session, ev, phase);
  let hint;
  if (phase === "open_reaction") {
    const finalize = mip != null && mip >= 14;
    const pairLine =
      `PAIR CONFIG: pass pair="${PAIR_DEFAULT}", baseline="${baselinePathFor(PAIR_PRIMARY)}", baseline_secondary="${baselinePathFor(PAIR_SECONDARY)}" to tv_analyze_fast — the dual-symbol bundle is required to compute leader_evidence and to call surface_leader_decision at minute 14.`;
    hint = `Open-reaction window (+${mip ?? "?"}m of 15). ${pairLine} Call surface_open_reaction with the latest read (session="${session}"). ${finalize ? `minutes_into_phase >= 14 — ALSO call surface_leader_decision with the values from pair.leader_evidence AND surface_ltf_bias to finalize bias. ` : ""}End the turn with surface_no_trade. Do NOT call surface_setup during open-reaction.`;
  } else {
    // Entry hunt: leader decision is in place. The bundle is single-symbol
    // on the leader because tv analyze short-circuits on pair-decision.json.
    // Pass the LEADER's baseline path — feeding MNQ baseline data into a
    // MES capture would inject the wrong HTF bars_by_tf / engine_by_tf
    // (real bug when leader=MES). Falls back to PAIR_PRIMARY if for some
    // reason the catch-up hasn't run yet.
    const leader = (await readPairDecisionLeader()) || PAIR_PRIMARY;
    // 5m turns: preflight already pinned the chart to leader+5m, so the
    // bundle's top-level `engine` and `bars` reflect 5m. The 1m view is
    // available in engine_by_tf.m1 from the cached baseline. Strategy §3:
    // 5m drives displacement / FVG / structure read; 1m confirms the close.
    const tfLine = ev.tf === "5m"
      ? `This is a 5m close turn — the bundle's top-level engine/bars reflect 5m (chart is pinned to 5m for this tick). Use engine.fvgs / engine.structures / engine.sweeps for 5m displacement read. Use engine_by_tf.m1 (from cached baseline) for the 1m confirmation bar. After this turn the next 1m tick will flip the chart back.`
      : `This is a 1m close turn — bundle is 1m. Use engine.* for the 1m entry-model walk; pair with engine_by_tf.m5 for 5m structure context if needed.`;
    hint = `Step 1: call mcp__tv__tv_analyze_fast with baseline="${baselinePathFor(leader)}". Step 2: Read state/last-scan.slim.json (the slim sibling — ~5-10 KB, fits in one Read; the full state/last-scan.json is for fallback only). The slim contains quote.last, engine.{fvgs,bprs,sweeps,structures,swings} (last 10 each), engine.quality + levels, engine_by_tf.{m1,m5}, gates.session, gates.engine.{pillar1,pillar2,confirmation,price_context}. Step 3: ${tfLine} Walk all three entry models by NAME — MSS / Trend / Inversion. Give one verdict per model (don't stop at the first miss). Step 4: If a candidate or confirmed setup is in play, call mcp__tv__surface_setup with tf="${ev.tf}"; otherwise call mcp__tv__surface_no_trade with a real reason ("no entry model in play" / "price quality weak" / etc — never a meta excuse like "couldn't read bundle").`;
  }
  const memoryBlock = memory ? `\n\nSESSION MEMORY (read-only context for this turn):\n${memory}\n` : "";
  const phaseLine = `Phase: ${phase}${mip != null ? ` (+${mip}m)` : ""}. TF tick: ${ev.tf}${ev.is_5m_close ? " (also a 5m close)" : ""}.`;
  // ev.ts is UTC ISO (detector emits `new Date().toISOString()`). The previous
  // header labeled it "(ET)" — Claude read the UTC string literally and was
  // off by 4 hours, breaking session-phase reasoning in prose. Emit ET-
  // formatted HH:MM:SS and keep UTC in parens for machine traceability.
  const etTime = new Date(ev.ts).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const text = `A new ${ev.tf} bar just closed at ${etTime} ET (utc=${ev.ts}). ${phaseLine}${memoryBlock}\n${hint}`;

  // Metrics: track bar-close turn lifecycle. Was: bar-close (the highest-
  // frequency turn at ~60/hour) emitted ZERO metrics — couldn't answer
  // "how many turns succeeded/failed/timed out today?" Now matches brief
  // and wrap.
  recordMetric({ kind: "bar-close", event: "started", session });
  const startedAt = Date.now();
  let errored = false;
  await userTurn({
    text,
    purpose: "bar-close",
    // Tight timeout: next bar fires in 60s. A turn stuck past 90s is just
    // going to lose work to the next tick anyway — better to give up and
    // let the next tick start fresh than block the coalescing queue.
    timeoutMs: 90_000,
    onEvent: (e) => {
      if (e.type === "chunk") _send?.("chat:chunk", e);
      else if (e.type === "tool_call") _send?.("chat:tool_call", e);
      else if (e.type === "turn_complete") {
        _send?.("chat:turn_complete", e);
        markTurnComplete();
      }
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
  const text = `CATCH-UP TURN: it is ${etTime} ET — we are in entry-hunt for the ${session.toUpperCase()} session but pair-decision.json does NOT exist (the system started after the open-reaction window closed, or the open-reaction turns failed to fire surface_leader_decision). Pick the leader now so the rest of entry-hunt can run normally.

Steps:
1. Call mcp__tv__tv_analyze_fast with pair="${PAIR_DEFAULT}", baseline="${baselinePathFor(PAIR_PRIMARY)}", baseline_secondary="${baselinePathFor(PAIR_SECONDARY)}".
2. Read state/last-scan.slim.json (the slim sibling — fits in one Read). Use the FVGs from the last 15 minutes (pair.symbols.${PAIR_PRIMARY}.engine.fvgs[] and pair.symbols.${PAIR_SECONDARY}.engine.fvgs[]) as the leader_evidence proxy — take max disp_score per symbol.
3. Call mcp__tv__surface_leader_decision with session="${session}", primary="${PAIR_PRIMARY}", secondary="${PAIR_SECONDARY}", leader=<the symbol with the higher max disp_score>, evidence={primary_disp_score, secondary_disp_score, margin, threshold: 0.10}, reason="post_hoc_caught_up_after_open_reaction_window".
4. End with mcp__tv__surface_no_trade reason="leader caught up post-hoc — resuming entry hunt next bar".

Do NOT walk entry models or call surface_setup in this turn. It is leader-pick only.`;
  recordMetric({ kind: "catch-up", event: "started", session });
  const startedAtCatchup = Date.now();
  let erroredCatchup = false;
  await userTurn({
    text,
    purpose: "catch-up",
    onEvent: (e) => {
      if (e.type === "chunk") _send?.("chat:chunk", e);
      else if (e.type === "tool_call") _send?.("chat:tool_call", e);
      else if (e.type === "turn_complete") {
        _send?.("chat:turn_complete", e);
        markTurnComplete();
      }
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
async function preflightChartState(ev, phase) {
  if (phase !== "entry_hunt") return;
  const dir = await activeSessionDir();
  let decision;
  try {
    const txt = await fs.readFile(path.join(dir, "pair-decision.json"), "utf8");
    decision = JSON.parse(txt);
  } catch {
    return;  // no decision → leave chart alone
  }
  if (!decision?.leader) return;
  const timeframe = ev.tf === "5m" ? "5" : "1";
  // #12 ensureChartState reports whether it actually changed the chart.
  // If the user (or anything else) had moved the chart off leader/TF,
  // we now surface a one-shot notification so the trader knows their
  // manual change was reverted — previously it was silent.
  const result = await ensureChartState({ symbol: decision.leader, timeframe });
  if (result?.changed) {
    _send?.("app:error", {
      source: "preflight",
      level: "warn",
      message: `Chart reverted to ${decision.leader} @ ${timeframe}m (entry-hunt requires it). Manual changes will keep snapping back.`,
    });
  }
}

// Append a per-bar log to the session folder. Main computes body_ratio and
// close_position_in_range from the OHLC — Claude reads, never produces.
// Gated on is_new_bar: at minute ticks where the chart's TF bar hasn't
// rolled over yet (chart on a higher TF), we'd otherwise write the same
// running bar repeatedly — skip those.
async function appendBarLog(ev) {
  if (!ev?.is_new_bar) return;
  const o = ev?.ohlc?.open, h = ev?.ohlc?.high, l = ev?.ohlc?.low, c = ev?.ohlc?.close;
  if (o == null || h == null || l == null || c == null) return;
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
