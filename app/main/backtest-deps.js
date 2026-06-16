// app/main/backtest-deps.js
// Production deps for the deterministic backtest engine — extracted from
// ipc-backtest.js so they import cleanly without electron. Two consumers:
// the IPC layer (popover runs) and scripts/run-backtest-headless.js
// (debugging + proof runs from a plain node process).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveRunDir } from "./backtest-store.js";
import { loadDayContext, contextFromBriefPayloads } from "./backtest-context.js";
import { analyzePairBundle, buildDirectSessionBriefPayloads } from "./direct-session-brief.js";
import { gradeOpenTrade } from "./backtest-grader.js";
import { __test as barCloseTruth } from "./bar-close.js";
import { PAIR_PRIMARY } from "./config.js";
import { recordEntries } from "../../cli/lib/tape-recorder.js";
import { untakenSessionDraws } from "../../cli/lib/session-levels.js";
import { parseIctEngineTable, findIctEngineRows } from "../../cli/lib/ict-engine-parser.js";
import { buildBriefDigest } from "../../cli/lib/brief-digest.js";
import * as replay from "../../packages/core/replay.js";
import * as chart from "../../packages/core/chart.js";
import * as data from "../../packages/core/data.js";
import { evaluate as cdpEvaluate } from "../../packages/core/connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
export const STATE_DIR = path.join(REPO_ROOT, "state");
const SYMBOL_SETTLE_MS = 600;

const REPLAY_ANCHORS = { "ny-am": "09:30", "ny-pm": "13:00", london: "03:00" };

// chart.getState right after a replay + pair sweep can throw transiently
// ("chart may still be loading") — retry briefly before giving up.
async function getChartStateWithRetry({ attempts = 5, delayMs = 1500 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await chart.getState();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

const bare = (sym) => String(sym ?? "").replace(/^[A-Z_]+:/, "");

// Pin and VERIFY: setSymbol/setTimeframe are fire-and-forget against a chart
// that may still be loading — poll until the state actually reflects the
// request (observed 2026-06-12: a 600ms settle "pinned" MNQ but the capture
// ran on MES because the wedged chart never applied the switch).
async function pinChart(leader, { deadlineMs = 30_000 } = {}) {
  if (!leader) return;
  const deadline = Date.now() + deadlineMs;
  let requested = false;
  for (;;) {
    const state = await getChartStateWithRetry();
    const symbolOk = bare(state.symbol) === bare(leader);
    const tfOk = state.resolution === "1";
    if (symbolOk && tfOk) return;
    if (!requested) {
      if (!symbolOk) await chart.setSymbol({ symbol: leader });
      if (!tfOk) await chart.setTimeframe({ timeframe: "1" });
      requested = true;
    }
    if (Date.now() > deadline) {
      throw new Error(`pinChart: chart did not settle on ${leader}@1m within ${deadlineMs}ms (at ${state.symbol}@${state.resolution})`);
    }
    await new Promise((r) => setTimeout(r, SYMBOL_SETTLE_MS));
  }
}

// Heavy replay use intermittently wedges the TradingView chart: quotes fail
// ("chart may still be loading") and every TF switch returns an empty engine
// table. A page reload reliably recovers it (verified manually 2026-06-12,
// twice). This automates that recovery: reload, then poll the quote until
// the chart is alive again.
async function reloadChartAndWait({ timeoutMs = 90_000 } = {}) {
  // eslint-disable-next-line no-console
  console.warn("[backtest] chart looks wedged — reloading the TradingView page");
  try {
    await cdpEvaluate("setTimeout(() => location.reload(), 0); 'reload-scheduled'");
  } catch { /* the reload kills the evaluation context — expected */ }
  const deadline = Date.now() + timeoutMs;
  await new Promise((r) => setTimeout(r, 8_000));
  for (;;) {
    try {
      const q = await data.getQuote();
      if (Number.isFinite(q?.last)) return;
    } catch { /* still loading */ }
    if (Date.now() > deadline) throw new Error("chart did not recover after reload");
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

const CDP_RECORDER_DEPS = {
  startReplay: (args) => replay.start(args),
  stepReplay: () => replay.step(),
  stopReplay: () => replay.stop(),
  readBars: () => data.getOhlcv({ summary: true }),
  readEngine: async () => parseIctEngineTable(findIctEngineRows(await data.getPineTables())),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export const PROD_DEPS = {
  loadDayContext: ({ date, session }) => loadDayContext({ date, session }),

  // No day state: capture a SINGLE-symbol bundle (the run's leader) with the
  // chart anchored at the session open of the historic date, build the
  // deterministic brief payloads, synthesize a grade-capped context.
  // Single-symbol on purpose: a pair sweep switches symbols under active
  // replay, which reloads the whole chart per TF — the second symbol's
  // capture came back empty on every TF (observed 2026-06-12). The digest
  // is computed in-process from the single bundle instead of by --pair.
  async runDirectBrief({ runId, session, date }) {
    const runDir = resolveRunDir({ stateDir: STATE_DIR, runId });
    const leader = PAIR_PRIMARY;
    let bundle = null;
    let h1History = null;
    try {
      await pinChart(leader);
      await replay.start({ date, time: REPLAY_ANCHORS[session] ?? "09:30" });
      const out = path.join(runDir, "brief-bundle.json");
      const anchorTime = REPLAY_ANCHORS[session] ?? "09:30";
      // A wedged chart shows up two ways: the capture THROWS (every TF empty)
      // or it "succeeds" with the HTFs missing while only the active 1m TF
      // emitted (observed 2026-06-12 ny-pm replay: m1 fresh, daily..m5 all
      // missing, quote stamped with LIVE time — the anchor never applied).
      // Both are instrument failures, not data verdicts — recover + retry once.
      const wedged = (b) => {
        const missing = b?.capture_health?.missing ?? [];
        return b?.capture_health?.ok === false && missing.length >= 3;
      };
      try {
        bundle = await analyzePairBundle({ out, pair: null });
        if (wedged(bundle)) throw new Error(`anchor capture wedged: missing ${bundle.capture_health.missing.join(",")}`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[backtest] anchor capture failed, recovering:", e.message);
        try { await replay.stop(); } catch { /* may already be detached */ }
        await reloadChartAndWait();
        await pinChart(leader);
        await replay.start({ date, time: anchorTime });
        bundle = await analyzePairBundle({ out, pair: null });
        if (wedged(bundle)) throw new Error(`anchor capture wedged after recovery: missing ${bundle.capture_health.missing.join(",")}`);
      }
      // Raw 1H history for session-level draws — pulled UNDER REPLAY so the bars
      // are no-lookahead (TV bars respect the replay clock; only the engine table
      // doesn't). The multi-TF sweep restored the chart to 1m; flip to 1H, pull
      // ~500 bars (~3 weeks), flip back.
      try {
        await chart.setTimeframe({ timeframe: "60" });
        const h1 = await data.getOhlcv({ count: 500 });
        h1History = Array.isArray(h1?.bars) ? h1.bars : null;
        await chart.setTimeframe({ timeframe: "1" });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[backtest] 1H history pull failed:", e.message);
      }
    } finally {
      try {
        await replay.stop();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[backtest] replay.stop after anchor brief failed:", e.message);
      }
    }
    if (!bundle) return null;
    // Persist the 1H history ON the bundle so the session-level draws are
    // computed in buildDirectSessionBriefPayloads (the single point the refold
    // path shares). Re-write brief-bundle.json with it so fold-week/regen can
    // recompute the draws too — without this a refold loses them.
    if (h1History) bundle.h1_history = h1History;
    try { fs.writeFileSync(path.join(runDir, "brief-bundle.json"), JSON.stringify(bundle)); } catch { /* best-effort */ }
    bundle.brief_digest = buildBriefDigest({ pair: { symbols: { [leader]: bundle } } });
    const payloads = buildDirectSessionBriefPayloads({ session, bundle, symbols: [leader] });
    fs.writeFileSync(path.join(runDir, "brief-payloads.json"), JSON.stringify(payloads, null, 2));
    return contextFromBriefPayloads({ session, payloads });
  },

  async recordEntries({ context, date, fromEt, toEt, onBar, isStopped }) {
    await pinChart(context?.leader);
    return recordEntries({
      context, date, fromEt, toEt,
      deps: CDP_RECORDER_DEPS,
      onBar, isStopped,
    });
  },

  truthFn: barCloseTruth.buildDeterministicPacketTruthFromInputs,
  gradeFn: gradeOpenTrade,

  // Always-on teardown: never leave the shared chart stranded in replay —
  // a stranded replay poisons the next live capture (observed 2026-06-12).
  async cleanup() {
    try {
      const status = await replay.status();
      if (status?.is_replay_started) await replay.stop();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[backtest] cleanup replay.stop failed:", e.message);
    }
  },
};
