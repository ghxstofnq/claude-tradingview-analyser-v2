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

// How many recent JSONL entries to tail into the per-bar prompt.
const MEMORY_SETUPS_TAIL = 5;
const MEMORY_BARS_TAIL = 10;

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

  // Append the bar to <sdir>/bars.jsonl (or bars-5m.jsonl) BEFORE Claude's turn
  // so the next prompt enrichment can see it. Deterministic — body_ratio etc.
  // are computed in code per constraint #7 (no LLM arithmetic).
  await appendBarLog(ev).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[bar-close] appendBarLog threw", err?.message || err);
  });

  // Don't pile up turns if Claude is still streaming the previous one.
  if (_busyWithClaude) return;
  _busyWithClaude = true;

  try {
    await maybeRefreshBaseline();

    const memory = await readSessionMemory();
    const hint = phase === "open_reaction"
      ? "Watch the open reaction; do NOT call surface_setup yet — surface_no_trade or stay silent."
      : "Walk all three entry models by NAME — MSS / Trend / Inversion. Give one verdict per model (don't stop at the first miss). If a candidate or confirmed setup is in play, call surface_setup; otherwise surface_no_trade.";
    const memoryBlock = memory ? `\n\nSESSION MEMORY (read-only context for this turn):\n${memory}\n` : "";
    const text = `A new ${ev.tf} bar just closed at ${ev.ts} (ET). Phase: ${phase}.${memoryBlock}\n${hint}`;

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

// Append a per-bar log to the session folder. Main computes body_ratio and
// close_position_in_range from the OHLC — Claude reads, never produces.
async function appendBarLog(ev) {
  const o = ev?.ohlc?.open, h = ev?.ohlc?.high, l = ev?.ohlc?.low, c = ev?.ohlc?.close;
  if (o == null || h == null || l == null || c == null) return;
  const range = Math.max(h - l, 1e-9);
  const body_ratio = Number((Math.abs(c - o) / range).toFixed(3));
  const close_position_in_range = Number(((c - l) / range).toFixed(3));
  const direction = c > o ? "bullish" : c < o ? "bearish" : "doji";
  const rec = { time: ev.ts, tf: ev.tf, o, h, l, c, body_ratio, direction, close_position_in_range };
  const dir = await activeSessionDir();
  const name = ev.tf === "5m" ? "bars-5m.jsonl" : "bars.jsonl";
  await fs.appendFile(path.join(dir, name), JSON.stringify(rec) + "\n", "utf8");
}

// Read the per-session memory files and stitch them into a single block for
// the per-bar prompt. Mirrors the "Required reads first" lists in analyze.md.
// Silently skips anything that doesn't exist — early-session prompts get less.
async function readSessionMemory() {
  const dir = await activeSessionDir();
  const parts = [];
  for (const name of ["pillar1.md", "pillar2.md", "ltf-bias.md", "open-reaction.md"]) {
    try {
      const txt = (await fs.readFile(path.join(dir, name), "utf8")).trim();
      if (txt) parts.push(`--- ${name} ---\n${txt}`);
    } catch {}
  }
  for (const [name, tailN] of [["setups.jsonl", MEMORY_SETUPS_TAIL], ["bars.jsonl", MEMORY_BARS_TAIL]]) {
    try {
      const txt = await fs.readFile(path.join(dir, name), "utf8");
      const lines = txt.trim().split("\n").filter(Boolean).slice(-tailN);
      if (lines.length) parts.push(`--- ${name} (last ${lines.length}) ---\n${lines.join("\n")}`);
    } catch {}
  }
  return parts.length ? parts.join("\n\n") : null;
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
