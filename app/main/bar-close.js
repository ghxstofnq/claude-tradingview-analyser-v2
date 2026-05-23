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
import { userTurn } from "./sdk.js";
import { currentSession } from "./sessions.js";
import { tvAnalyzeFull } from "./tools/tv-analyze.js";
import { markBarReceived, markTurnComplete } from "./health.js";
import { activeSessionDir } from "./sessions.js";
import { tickTrades, foldOpenTrades } from "../../cli/lib/trade-outcomes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TV_BIN = path.join(REPO_ROOT, "bin", "tv");
const BASELINE = path.join(REPO_ROOT, "state", "baseline.json");
const BASELINE_STALE_S = 900;          // 15 min

let _proc = null;
let _send = null;
let _restartTimer = null;
let _backoffMs = 1000;
let _refreshingBaseline = false;
let _busyWithClaude = false;            // single in-flight turn at a time

export function startDetector({ send }) {
  _send = send;
  _backoffMs = 1000;
  spawnOnce();
}

export function stopDetector() {
  if (_restartTimer) { clearTimeout(_restartTimer); _restartTimer = null; }
  if (_proc) {
    try { _proc.kill("SIGTERM"); } catch {}
    _proc = null;
  }
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
    // Backoff restart unless we asked it to stop.
    if (!_restartTimer) {
      _restartTimer = setTimeout(() => {
        _restartTimer = null;
        _backoffMs = Math.min(_backoffMs * 2, 30_000);
        spawnOnce();
      }, _backoffMs);
    }
  });

  _send?.("health:update", { detector: "running" });
}

async function handleBar(ev) {
  // ev shape (from tv stream bar-close): { ts, tf: "1m"|"5m", ohlc: {open,high,low,close}, ... }
  _send?.("bar:close", ev);
  markBarReceived();

  // Outcome tick FIRST — deterministic, runs before Claude's turn so the
  // per-bar read sees fresh trade state. Any TP/stop/INVALIDATED transitions
  // get appended to trades.jsonl and pushed to the renderer.
  await tickOpenTrades(ev).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] tick threw", err?.message || err);
  });

  // Phase-aware: decide if Claude should react.
  const { session } = currentSession();
  const phase = phaseFor(session, ev);
  if (phase === "off") return;

  // Don't pile up turns if Claude is still streaming the previous one.
  if (_busyWithClaude) return;
  _busyWithClaude = true;

  try {
    await maybeRefreshBaseline();

    const hint = phase === "open_reaction"
      ? "Watch the open reaction; do NOT call surface_setup yet — surface_no_trade or stay silent."
      : "Walk the 3-pillar checklist; if a valid setup is in play, call surface_setup at end of the turn.";
    const text = `A new ${ev.tf} bar just closed at ${ev.ts} (ET). Phase: ${phase}. ${hint}`;

    await userTurn({
      text,
      onEvent: (e) => {
        if (e.type === "chunk") _send?.("chat:chunk", e);
        else if (e.type === "tool_call") _send?.("chat:tool_call", e);
        else if (e.type === "turn_complete") {
          _send?.("chat:turn_complete", e);
          markTurnComplete();
        }
        else if (e.type === "error") _send?.("app:error", { source: "sdk", message: e.message });
      },
    });
  } finally {
    _busyWithClaude = false;
  }
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

async function tickOpenTrades(ev) {
  if (!ev?.ohlc) return;
  const dir = await activeSessionDir();
  const file = path.join(dir, "trades.jsonl");
  let txt = "";
  try { txt = await fs.readFile(file, "utf8"); } catch { return; }
  const events = txt.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const open = foldOpenTrades(events);
  if (!open.length) return;

  const bar = { high: ev.ohlc.high, low: ev.ohlc.low, ts: ev.ts };
  const { transitions } = tickTrades(open, bar);
  for (const tr of transitions) {
    await fs.appendFile(file, JSON.stringify({ type: "outcome", ...tr }) + "\n", "utf8");
    _send?.("trade:outcome", tr);
  }
}

async function maybeRefreshBaseline() {
  if (_refreshingBaseline) return;
  try {
    const stat = await fs.stat(BASELINE);
    const ageSec = (Date.now() - stat.mtimeMs) / 1000;
    if (ageSec < BASELINE_STALE_S) return;
  } catch {
    // baseline missing → refresh
  }
  _refreshingBaseline = true;
  try {
    // eslint-disable-next-line no-console
    console.log("[bar-close] refreshing baseline");
    await tvAnalyzeFull({}, { outPath: BASELINE });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] baseline refresh failed", err?.message || err);
  } finally {
    _refreshingBaseline = false;
  }
}
