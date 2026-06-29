// Deterministic backtest engine (2026-06-12): record a replay-stepped tape,
// fold it through the REAL production truth function (the same walker chain
// that trades live), grade outcomes from the recorded bars. No LLM in the
// loop — the old engine fired blank sdk.userTurn calls per bar (its `bundle`
// arg wasn't even a userTurn parameter) and graded outcomes off a
// `bars.last_bar` field that doesn't exist in the bundle, so no run ever
// resolved a trade. Folding the June 9 tape here proves the engine drives
// the same brain as live.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpStateDir } from "./helpers/tmp-state.js";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runBacktest } from "../app/main/backtest-engine.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test } from "../app/main/bar-close.js";

const JUNE9 = JSON.parse(fs.readFileSync(path.resolve("tests/tapes/2026-06-09-ny-am-replay.tape.json"), "utf8"));
// 02-09 is the A+ session (multi-alignment two-and-one) — used for the runner
// → TP2 mechanic since 06-09 now grades B (its early entry isn't a two-and-one).
const FEB9 = JSON.parse(fs.readFileSync(path.resolve("tests/tapes/2026-02-09-ny-am-replay.tape.json"), "utf8"));

function makeDeps({ entries, context = null }) {
  const calls = { recorded: 0, briefRuns: 0 };
  return {
    calls,
    deps: {
      recordEntries: async ({ onBar }) => {
        calls.recorded += 1;
        entries.forEach((_, i) => onBar?.({ bar: i + 1, total: entries.length }));
        return { entries, warnings: [] };
      },
      loadDayContext: async () => context ?? { session: "ny-am", leader: "MNQ1!" },
      runDirectBrief: async () => { calls.briefRuns += 1; return null; },
      truthFn: __test.buildDeterministicPacketTruthFromInputs,
      gradeFn: gradeOpenTrade,
    },
  };
}

function collectEvents(bus) {
  const events = [];
  bus.on("backtest:event", (e) => events.push(e));
  return events;
}

test("AUTO mode: June 9 tape folds to the Inversion short through the real chain — one opportunity, one open position", async () => {
  const stateDir = tmpStateDir("bt-engine-");
  const bus = new EventEmitter();
  const events = collectEvents(bus);
  const { deps } = makeDeps({ entries: JUNE9.entries });

  const { summary, runId } = await runBacktest({
    date: "2026-06-09", session: "ny-am", mode: "auto",
    bus, stateDir, deps,
  });

  assert.equal(summary.cost_usd, 0);
  // Stage-G (2026-06-24): the continuation-trend fix (an inversion continuation
  // must run WITH the most-recent swing-tier break) suppresses June 9's premature
  // early short and surfaces the verified A+ reversal — entry 29964.75, grade A+.
  // As an A+ it arms a runner to the deeper draw
  // rather than banking at TP1; the recorded tape window ends before that deeper
  // target, so the trade stays OPEN (no loss, no in-window resolution). TP
  // targeting to the major-liquidity draw (AS.L 29595.25) is the separate open
  // Stage-G item — see scripts/fold-tape.mjs on the 06-09 tape.
  assert.equal(summary.losses, 0, "the A+ short must not hit its stop on the recorded bars");
  assert.equal(summary.chain_status, "clean");

  // As the move unfolds, neighboring zones confirm the same trade idea under
  // distinct walker ids — every surfaced packet must be the SAME opportunity
  // (Inversion short), and the first is the hand-verified trade.
  const surfaced = events.filter((e) => e.type === "setup_surfaced");
  assert.ok(surfaced.length >= 1);
  assert.equal(summary.setups, surfaced.length);
  for (const s of surfaced) {
    assert.equal(s.setup.model, "Inversion");
    assert.equal(s.setup.side, "short");
  }
  // The FIRST surfaced packet is the corrected reversal short, graded A+ (the
  // tape gate locks this); later same-opportunity confirmations can grade B.
  assert.equal(surfaced[0].setup.grade, "A+", "the corrected June 9 first reversal short grades A+");
  // TODO(stage-G): exact entry/stop/tp1 are IN FLUX — the multi-TF re-record +
  // the deterministic inversion gate (2026-06-23) block the pre-grab losers, so
  // the first surfaced bar moved off the old 29792/09:52. The exact retrace
  // level (gate's first-valid-after-grab vs the oracle's deeper 10:27) is the
  // open Stage-G entry-precision item. Until it's finalized + the tape promoted,
  // this test asserts only the load-bearing facts (model/side/one-opportunity,
  // below) + a sane short entry, not the exact tick.
  assert.ok(surfaced[0].setup.entry > 0 && surfaced[0].setup.stop > surfaced[0].setup.entry,
    `first short: entry ${surfaced[0].setup.entry}, stop ${surfaced[0].setup.stop} (stop must sit above entry)`);

  // Every surfaced setup gets exactly one disposition. Since scale-in is the
  // default (2026-06-13), a setup is opened (anchor or add), skipped while a
  // trade is active, dedup-collapsed (same-side within 10 min), or halted.
  const rows = fs.readFileSync(path.join(stateDir, "backtest", runId, "ny-am", "setups.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  const opens = rows.filter((r) => r.type === "open").length;
  const skipped = rows.filter((r) => r.type === "skipped_active_trade").length;
  const dedup = rows.filter((r) => r.type === "dedup_skipped").length;
  const halted = rows.filter((r) => r.type === "session_halted").length;
  assert.ok(opens >= 1);
  assert.equal(opens + skipped + dedup + halted, surfaced.length);
  assert.ok(fs.existsSync(path.join(stateDir, "backtest", runId, "ny-am", "tape.json")), "recorded tape persisted for promotion");
  assert.ok(events.some((e) => e.type === "done"));
});

test("outcome grading: a later bar through TP1 then TP2 resolves the A+ runner as a TP2 win", async () => {
  const stateDir = tmpStateDir("bt-engine-");
  const bus = new EventEmitter();
  const events = collectEvents(bus);

  // 02-09 is the A+ session (multi-alignment), an Inversion LONG — so its A+
  // runner rides UP through TP1 to TP2. (06-09 grades B now and would only bank
  // at TP1, so it can't exercise the runner mechanic.)
  const last = FEB9.entries[FEB9.entries.length - 1];
  const winBar = structuredClone(last);
  // Next 1m bar trades UP through TP1 AND TP2 (the long A+ runner's second
  // target) — high 25900 clears every Inversion-long TP2 on the tape.
  const bars = winBar.inputs.bundle.bars.last_5_bars;
  const prev = bars[bars.length - 1];
  const t = Number(prev.time) + 60;
  bars.push({ time: t, open: prev.close, high: 25900, low: prev.close, close: 25899 });
  winBar.event = { ...winBar.event, ts: new Date((t + 60) * 1000).toISOString() };
  winBar.inputs.bundle.quote = { ...winBar.inputs.bundle.quote, last: 25899, time: t + 60 };

  const { deps } = makeDeps({ entries: [...FEB9.entries, winBar] });
  const { summary } = await runBacktest({
    date: "2026-02-09", session: "ny-am", mode: "auto",
    bus, stateDir, deps,
  });

  assert.ok(summary.setups >= 1);
  // A+→TP2: the runner blows through TP1 to TP2 on that bar → a TP2 win.
  assert.ok(summary.wins >= 1);
  assert.equal(summary.losses, 0);
  assert.ok(summary.total_r >= 1);
  assert.equal(summary.best_model, "Inversion");
  const outcome = events.find((e) => e.type === "setup_outcome");
  assert.equal(outcome.outcome, "tp2_hit");
});

test("PAUSE mode: pauses on the packet and a reject decision records the rejection", async () => {
  const stateDir = tmpStateDir("bt-engine-");
  const bus = new EventEmitter();
  const events = collectEvents(bus);
  bus.on("backtest:event", (e) => {
    if (e.type === "paused") {
      setImmediate(() => bus.emit("backtest:command", { type: "decision", choice: "reject", reason: "not my read" }));
    }
  });

  const { deps } = makeDeps({ entries: JUNE9.entries });
  const { summary, runId } = await runBacktest({
    date: "2026-06-09", session: "ny-am", mode: "pause",
    bus, stateDir, deps,
  });

  assert.ok(events.some((e) => e.type === "paused"));
  assert.ok(events.some((e) => e.type === "setup_rejected"));
  assert.ok(summary.setups >= 1);
  assert.equal(summary.wins, 0);

  const rows = fs.readFileSync(path.join(stateDir, "backtest", runId, "ny-am", "setups.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(rows.some((r) => r.type === "rejected" && r.reason === "not my read"));
});

test("no day context and no brief context → run completes honestly as no_trade data gap", async () => {
  const stateDir = tmpStateDir("bt-engine-");
  const bus = new EventEmitter();
  const events = collectEvents(bus);
  const deps = {
    recordEntries: async () => { throw new Error("must not record without context"); },
    loadDayContext: async () => null,
    runDirectBrief: async () => null,
    truthFn: __test.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };

  const { summary } = await runBacktest({
    date: "2026-06-09", session: "ny-am", mode: "auto",
    bus, stateDir, deps,
  });
  assert.equal(summary.setups, 0);
  assert.equal(summary.chain_status, "no_context:data_gap");
  assert.ok(events.some((e) => e.type === "done"));
});

test("stop command during recording aborts cleanly with a summary", async () => {
  const stateDir = tmpStateDir("bt-engine-");
  const bus = new EventEmitter();
  const { deps } = makeDeps({ entries: JUNE9.entries });
  deps.recordEntries = async ({ onBar, isStopped }) => {
    onBar?.({ bar: 1, total: 22 });
    bus.emit("backtest:command", { type: "stop" });
    // engine exposes isStopped so the recorder can bail between steps
    assert.equal(typeof isStopped, "function");
    return { entries: JUNE9.entries.slice(0, 3), warnings: [], aborted: isStopped() };
  };

  const { summary } = await runBacktest({
    date: "2026-06-09", session: "ny-am", mode: "auto",
    bus, stateDir, deps,
  });
  assert.equal(summary.chain_status, "user-stopped");
});
