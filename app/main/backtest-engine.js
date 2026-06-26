// app/main/backtest-engine.js
// Deterministic backtest: record a replay-stepped tape, fold it through the
// REAL production truth function (the same walker chain that trades live),
// grade outcomes from the recorded bars.
//
// Rewritten 2026-06-12. The previous engine ran one sdk.userTurn per replayed
// bar: the `bundle` it passed wasn't a userTurn parameter (silently ignored,
// so the LLM got a blank prompt with none of the live path's candidate/hint
// enrichment), outcomes were graded off `bundle.bars.last_bar` which doesn't
// exist in the analyze bundle (trades could never resolve), and the walker
// chain — the actual live brain since PR #12/#14 — never ran at all. Neither
// run on disk ever completed. This engine costs $0, finishes in roughly
// replay-stepping time, and every run persists a tape.json promotable into
// tests/tapes/ after hand-grading.
//
// Contract with ipc-backtest.js (event shapes unchanged so the popover +
// useBacktest keep working):
//   outbound bus events: start, progress, setup_surfaced, setup_accepted,
//                        paused, setup_rejected, setup_outcome, done, error
//   inbound bus commands: { type: "stop" }, { type: "decision", choice }
//
// deps (all injected; production wiring lives in ipc-backtest.js):
//   recordEntries({ context, date, fromEt, toEt, onBar, isStopped })
//     → { entries, warnings } — replay-stepping recorder (cli/lib/tape-recorder)
//   loadDayContext({ date, session }) → context | null — that day's recorded
//     brief + ltf-bias from state/session/<date>/<session>/
//   runDirectBrief({ session }) → context | null — deterministic brief at the
//     replay anchor when no day state exists (grade_cap B, backfilled status)
//   truthFn — buildDeterministicPacketTruthFromInputs (the live chain)
//   gradeFn — gradeOpenTrade (pure outcome grader)

import fs from "node:fs";
import path from "node:path";
import { closeAtMarket, gradeRunner } from "./backtest-grader.js";
import { generateRunId, resolveRunDir, writeIndexEntry } from "./backtest-store.js";
import { etToEpochSeconds } from "../../cli/lib/tape-recorder.js";
import { canonicalSymbol } from "../../cli/lib/run-symbol.js";
// The fold's open-reaction read is the SAME resolver the live chain uses — one
// source of truth (no parallel copy to drift). Circular with live-ltf-resolver
// (it imports openReactionWindowMs/biasFromDraw from here) but both usages are
// function-level, so ESM resolves it.
import { deriveLtfBiasContext } from "./live-ltf-resolver.js";

const SESSION_WINDOWS = {
  "ny-am": { from: "09:30", to: "12:00" },
  "ny-pm": { from: "13:00", to: "16:00" },
  london: { from: "03:00", to: "06:00" },
};

// A (date, session) is runnable only once its session has CLOSED in ET. A
// future or not-yet-closed session has no replayable data — the recorder would
// step live/empty bars and leave an aborted run (2026-06-19: a custom range
// with an end past the last completed session ran today + next week). nowMs is
// injectable for tests. Mirror the renderer guard in Backtest.helpers.js.
export function sessionHasClosed(date, session, nowMs = Date.now()) {
  const w = SESSION_WINDOWS[session] ?? SESSION_WINDOWS["ny-am"];
  return etToEpochSeconds(date, w.to) * 1000 <= nowMs;
}

// User ruling 2026-06-12: the session halts at -3R realized — no new
// positions once the day's closed trades reach the cap (June 11 AM chop
// bled 9 straight stops without it).
const SESSION_MAX_LOSS_R = -3;
// User ruling 2026-06-13: also halt after 3 LOSING trades in a row (any win
// resets the streak) — stricter than the cumulative cap, and it catches the
// concurrent-adds bleed the cumulative −3R let slip (June 11 AM −4 → −3).
const SESSION_MAX_LOSS_STREAK = 3;

// Scale-in (concurrent adds) REMOVED 2026-06-23 — the faithful rebuild trades
// ONE position at a time (risk-and-management.md §"Management styles": no-trim
// ride-the-trail on a single position; "overlays + scale-in are deleted",
// build-sequence E2). AUTO opens the single position and never stacks adds.

// A+ → TP2 (user ruling 2026-06-13): only A+ trades run past TP1, and only when
// TP2 sits BEYOND TP1 in the trade's direction (otherwise there's no runner
// room and it banks at TP1 like a B trade).
function isRunnerEligible(trade) {
  if (trade?.grade !== "A+") return false;
  const t1 = Number(trade.tp1), t2 = Number(trade.tp2);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return false;
  return trade.side === "short" ? t2 < t1 : t2 > t1;
}

const OPEN_REACTION_RESOLVE_MIN = 15; // §2.3 / §7 Step 4: verdict from minute 15…
const OPEN_REACTION_END_MIN = 30;     // …interactions count through minute 30

function round2(n) { return Math.round(n * 100) / 100; }

function lastClosedBarOf(entry) {
  const bars = entry?.inputs?.bundle?.bars?.last_5_bars ?? [];
  return bars[bars.length - 1] ?? null;
}

/**
 * Open-reaction timing for a session (§7 Step 4 "first 15–30 minutes"):
 * level interactions count within [startMs, endMs) (30 minutes); the
 * verdict first resolves at resolveMs (minute 15) and re-evaluates each
 * bar until endMs, then freezes.
 */
export function openReactionWindowMs({ date, session }) {
  const window = SESSION_WINDOWS[session] ?? SESSION_WINDOWS["ny-am"];
  const startMs = etToEpochSeconds(date, window.from) * 1000;
  return {
    startMs,
    resolveMs: startMs + OPEN_REACTION_RESOLVE_MIN * 60_000,
    endMs: startMs + OPEN_REACTION_END_MIN * 60_000,
  };
}

export async function runBacktest({
  date, session, mode, symbol,
  bus,
  stateDir = "state",
  deps,
  // Same-day continuation bars (user ruling 2026-06-13): an AM run is given
  // that day's PM tape entries so a trade still open at the AM window's end
  // keeps grading into PM, then force-closes at 16:00. PM runs need no carry
  // (their own tape already reaches 16:00). Outcome-grading only — no new
  // packets surface during carry.
  carryEntries = [],
}) {
  if (!date || !session || !mode) {
    throw new Error("runBacktest requires { date, session, mode }");
  }
  if (!bus || !deps?.recordEntries || !deps?.truthFn || !deps?.gradeFn) {
    throw new Error("runBacktest requires { bus, deps: { recordEntries, truthFn, gradeFn } }");
  }

  const runId = generateRunId({ session, date });
  const sessionDir = resolveRunDir({ stateDir, runId });
  fs.mkdirSync(sessionDir, { recursive: true });
  // The instrument this run traded — tags the summary + index so analytics can
  // be read per symbol (MNQ vs MES). Truthful source: the symbol the popover
  // sent for this job (BOTH expands to separate per-symbol jobs). Headless runs
  // (run-backtest-headless.js) pass no symbol but set BACKTEST_LEADER to pick
  // the instrument — tag the run with it so it isn't registered as null. Still
  // null when neither names an instrument — never guessed.
  const runSymbol = canonicalSymbol(symbol) || canonicalSymbol(process.env.BACKTEST_LEADER);

  const startedAt = Date.now();
  let stopped = false;
  const stopHandler = (cmd) => { if (cmd?.type === "stop") stopped = true; };
  bus.on("backtest:command", stopHandler);
  bus.emit("backtest:event", { type: "start", runId, session, date, mode });

  const setupsPath = path.join(sessionDir, "setups.jsonl");
  const activityPath = path.join(sessionDir, "activity.jsonl");
  const appendSetupRow = (row) => fs.appendFileSync(setupsPath, JSON.stringify(row) + "\n");
  const appendActivity = (row) => fs.appendFileSync(activityPath, JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n");

  const surfaced = [];
  const openTrades = [];
  const closedTrades = [];
  let sessionRealizedR = 0;
  let lossStreak = 0;        // consecutive losing trades (any win resets)
  let sessionHalted = false;
  let contextSource = "none";
  let chainStatus = "clean";
  let openReaction = null;
  let errorMessage = null;
  let entries = [];
  let warnings = [];

  // Book a resolved outcome for one open trade — shared by the main fold,
  // the PM carry pass, and the 16:00 force-close so all three count R
  // identically. Realized R model (user correction 2026-06-12): a TP1 hit
  // books its actual multiple |exit-entry|/|entry-stop| (swing TP1s pay >=2R
  // by rule), a stop books -1R; a 16:00 close carries its own SIGNED R via
  // verdict.realized_r (the close can land in profit or loss).
  const bookOutcome = (trade, verdict, eventTs) => {
    const risk = Math.abs(Number(trade.entry) - Number(trade.stop));
    const realizedR = Number.isFinite(verdict.realized_r) ? verdict.realized_r
      : verdict.outcome === "tp1_hit" && Number.isFinite(risk) && risk > 0
        ? Number((Math.abs(Number(verdict.exit) - Number(trade.entry)) / risk).toFixed(2))
        : verdict.outcome === "stop_hit" ? -1 : 0;
    appendSetupRow({
      type: "outcome", ts: Date.now(), setup_id: trade.id,
      outcome: verdict.outcome, exit: verdict.exit, realized_r: realizedR, conflict_bar: verdict.conflict_bar,
      event_ts: eventTs,
    });
    closedTrades.push({ ...trade, ...verdict, realized_r: realizedR });
    sessionRealizedR += realizedR;
    // 3-losses-in-a-row halt (user ruling 2026-06-13). A loss is realized R < 0
    // (stop, or a 16:00 close underwater); any non-loss resets the streak.
    if (realizedR < 0) lossStreak += 1; else lossStreak = 0;
    if (!sessionHalted && lossStreak >= SESSION_MAX_LOSS_STREAK) {
      sessionHalted = true;
      appendActivity({ kind: "session_halt", session_r: round2(sessionRealizedR), rule: `${SESSION_MAX_LOSS_STREAK} losses in a row` });
      bus.emit("backtest:event", { type: "session_halted", runId, session_r: round2(sessionRealizedR) });
    }
    if (!sessionHalted && sessionRealizedR <= SESSION_MAX_LOSS_R) {
      sessionHalted = true;
      appendActivity({ kind: "session_halt", session_r: round2(sessionRealizedR), rule: `halt at ${SESSION_MAX_LOSS_R}R` });
      bus.emit("backtest:event", { type: "session_halted", runId, session_r: round2(sessionRealizedR) });
    }
    openTrades.splice(openTrades.indexOf(trade), 1);
    bus.emit("backtest:event", {
      type: "setup_outcome", runId, setupId: trade.id,
      outcome: verdict.outcome, exit: verdict.exit,
    });
  };

  // Grade one open trade against a bar — shared by the main fold and the PM
  // carry pass. Handles the A+→TP2 runner: a non-runner books at stop/TP1 (and
  // an eligible A+ arms break-even + runs for TP2 on TP1); a runner books on
  // TP2 / break-even.
  const gradeOneTrade = (trade, bar, eventTs) => {
    if (trade.runner) {
      const rv = gradeRunner(trade, bar);
      if (rv.outcome !== "pending") bookOutcome(trade, rv, eventTs);
      return;
    }
    const verdict = deps.gradeFn(trade, bar);
    if (verdict.outcome === "pending") return;
    if (verdict.outcome === "tp1_hit" && isRunnerEligible(trade)) {
      // Arm the runner. The stop is NOT mutated — gradeRunner uses `entry` as
      // the break-even level and `stop` as the (original) risk denominator, so
      // leaving stop intact keeps the surfaced setup's R/stop honest.
      trade.runner = true;
      const tp2SameBar = trade.side === "short"
        ? Number(bar.low) <= Number(trade.tp2) : Number(bar.high) >= Number(trade.tp2);
      if (tp2SameBar) {
        const risk = Math.abs(Number(trade.entry) - Number(trade.stop));
        const move = trade.side === "short"
          ? Number(trade.entry) - Number(trade.tp2) : Number(trade.tp2) - Number(trade.entry);
        bookOutcome(trade, {
          outcome: "tp2_hit", exit: trade.tp2,
          realized_r: risk > 0 ? Number((move / risk).toFixed(2)) : 0, conflict_bar: false,
        }, eventTs);
      }
      return;
    }
    bookOutcome(trade, verdict, eventTs);
  };

  try {
    // Future / not-yet-closed session: no replayable data exists yet, so the
    // recorder would step live/empty bars and leave an aborted run. Fail fast —
    // the catch below writes the error summary + emits the "error" event.
    if (!sessionHasClosed(date, session)) {
      throw new Error(`session_not_closed: ${date} ${session} has not closed yet`);
    }
    // 1. Context: the day's recorded chain state if it exists, else a
    //    deterministic brief at the replay anchor (grade_cap B — same rule
    //    as the live catch_up backfill).
    let context = await deps.loadDayContext?.({ date, session });
    if (context) {
      contextSource = "day_state";
    } else if (deps.runDirectBrief) {
      context = await deps.runDirectBrief({ runId, session, date, symbol });
      if (context) {
        contextSource = "direct_brief";
        chainStatus = "backfilled:brief_only";
      }
    }
    if (!context) {
      // Why was no context built? "data_gap" used to be hard-coded here, but
      // most null contexts are NOT a capture problem — the HTF capture is fresh
      // and the brief simply selected no primary_draw (no significant near-price
      // array; reason `open_unconfirmed`/`no_bias`). Read the brief's own reason
      // (production path always writes brief-payloads.json before returning) and
      // label honestly: a genuine capture failure stays data_gap, a fresh-data
      // no-draw day becomes no_draw. Fold/test deps don't persist payloads → the
      // file is absent → fall back to data_gap (unchanged for those callers).
      const HARD_GAP = new Set(["data_gap", "engine_stale", "session_closed"]);
      let nullReason = "data_gap";
      try {
        const pj = JSON.parse(fs.readFileSync(path.join(sessionDir, "brief-payloads.json"), "utf8"));
        const reason = (Array.isArray(pj) ? pj[0] : pj)?.no_trade_reason ?? null;
        // Surface the brief's real reason (open_unconfirmed / no_bias /
        // pillar2_poor / htf_unclear) — only genuine capture failures stay
        // data_gap. Falls back to data_gap when the brief named no reason.
        if (reason) nullReason = HARD_GAP.has(reason) ? "data_gap" : reason;
      } catch { /* no payloads on disk (fold/test) → keep data_gap */ }
      chainStatus = `no_context:${nullReason}`;
      const summary = buildSummary({
        runId, date, session, mode, symbol: runSymbol, startedAt,
        surfaced: [], closedTrades: [], openTrades: [], chainStatus, contextSource,
      });
      persistSummary({ sessionDir, stateDir, summary });
      bus.emit("backtest:event", { type: "done", runId, summary });
      bus.off("backtest:command", stopHandler);
      await runCleanup(deps, runId);
      return { runId, summary };
    }
    appendActivity({ kind: "context", source: contextSource });

    // 2. Record: one replay pass, engine recomputed per bar.
    const window = SESSION_WINDOWS[session] ?? SESSION_WINDOWS["ny-am"];
    const recording = await deps.recordEntries({
      context, date,
      fromEt: window.from, toEt: window.to,
      isStopped: () => stopped,
      onBar: ({ bar, total }) => {
        bus.emit("backtest:event", { type: "progress", runId, bar, total, cost: 0, phase: "recording" });
      },
    });
    entries = recording.entries ?? [];
    warnings = recording.warnings ?? [];
    appendActivity({ kind: "recorded", bars: entries.length, warnings: warnings.length });
    fs.writeFileSync(path.join(sessionDir, "tape.json"), JSON.stringify({
      fixture: `${date}-${session}-backtest`,
      date, session,
      source: "backtest-engine",
      verified: false,
      context_source: contextSource,
      expected: { outcome: "no_trade" },
      entries,
    }, null, 2));
    // AFTER the tape is persisted (keep it lean), reconstruct the full session
    // 1m history from the entries (each entry's just-closed bar) and attach it
    // CUMULATIVELY per bar — bars at or before that entry's own bar, no
    // lookahead. The Trend FVG-candle stop (execution-packet) needs it to reach
    // the FVG-creating candle (~100min back, outside the live 4-bar window).
    // Live carries the same series via bundle.full1m from the capture, so the
    // backtest == live by reconstructing it here.
    {
      const series = new Map();
      for (const e of entries) {
        const b = e?.inputs?.bundle?.bars?.last_5_bars?.slice(-1)?.[0];
        if (b && Number.isFinite(Number(b.time))) series.set(Number(b.time), b);
      }
      const sorted = [...series.values()].sort((a, b) => Number(a.time) - Number(b.time));
      for (const e of entries) {
        const t = Number(e?.inputs?.bundle?.bars?.last_5_bars?.slice(-1)?.[0]?.time ?? Infinity);
        if (e?.inputs?.bundle) e.inputs.bundle.full1m = sorted.filter((b) => Number(b.time) <= t);
      }
    }

    // 3. Fold: the real chain, walker state carried bar to bar (same
    //    semantics as cli/lib/day-tape.js#foldTape).
    //    For synthesized (direct-brief) contexts the open-reaction leg
    //    resolves deterministically at the minute-15 boundary (§2.3 /
    //    §7 Step 4) and upgrades every later bar's ltf context. Day-state
    //    contexts carry the live-recorded verdict and are never overridden.
    const orWindow = openReactionWindowMs({ date, session });
    // §7 Step 4 gives the open reaction "15–30 minutes": resolve at minute
    // 15 (resolveMs), then re-evaluate each bar until minute 30 (endMs) —
    // late breaks count and the sweep `rejected` flag matures as later bars
    // close back through the level. Frozen after endMs.
    const synthesizedContext = contextSource === "direct_brief";
    let walkers = [];
    let prevInteraction = null; // activity-log dedup: emit only on interaction change
    // In-window 1m closes for the resolver's close-based rejection (GXNQ
    // 2026-06-13, June 11: the engine's sweep flag lagged; the closes ARE
    // the §7-Step-4 reaction evidence). Bar close stamp = open time + 60s.
    const windowCloses = [];
    const seenPacketIds = new Set();
    for (let i = 0; i < entries.length && !stopped; i += 1) {
      const entry = entries[i];
      const entryMs = Date.parse(entry?.event?.ts ?? "");
      const lastBar = entry?.inputs?.bundle?.bars?.last_5_bars?.at(-1);
      const lastBarCloseMs = Number(lastBar?.time) * 1000 + 60_000;
      if (Number.isFinite(lastBarCloseMs) && Number.isFinite(Number(lastBar?.close))
        && lastBarCloseMs > orWindow.startMs && lastBarCloseMs <= orWindow.endMs
        && !windowCloses.some((c) => c.time_ms === lastBarCloseMs)) {
        windowCloses.push({ time_ms: lastBarCloseMs, close: Number(lastBar.close) });
      }
      // ONE open-read: the fold calls the SAME resolver the live chain uses
      // (deriveLtfBiasContext) per bar, handing it the accumulated full-window
      // closes. This replaces the inline resolveOpenReaction + late-direction +
      // MSS-realignment + HTF-fallback copy that drifted from live twice
      // (2026-06-20/21). The resolver is stateless and frozen-deterministic
      // post-window (window-confined closes + the matured-flag guard), so the
      // fold is byte-identical to the old stateful loop. Day-state contexts keep
      // their recorded verdict (synthesizedContext gate). The brief shim feeds
      // the resolver the context's HTF read (htfBias/draw/pillar2) — the same
      // inputs the old resolveOpenReactionLeg read straight off the context.
      if (synthesizedContext && Number.isFinite(entryMs) && entryMs >= orWindow.resolveMs) {
        const read = deriveLtfBiasContext({
          bundle: entry?.inputs?.bundle,
          brief: {
            htf_bias_dir: context?.session_state?.pillar1?.htfBias ?? null,
            h4_struct_dir: context?.session_state?.pillar1?.h4StructDir ?? null,
            h1_struct_dir: context?.session_state?.pillar1?.h1StructDir ?? null,
            primary_draw: context?.session_state?.pillar1?.primaryDraw ?? null,
            pillar2_verdict: context?.session_state?.pillar2?.verdict ?? null,
          },
          session,
          eventTs: entry?.event?.ts ?? null,
          windowClosesOverride: windowCloses,
        });
        if (read) {
          const cs = read.interaction === "htf_fallback" ? "degraded:htf_fallback"
            : read.htf_ltf_alignment === "aligned" ? "clean"
            : read.htf_ltf_alignment === "divergent" ? "divergent"
            : "degraded:open_unclear";
          openReaction = {
            interaction: read.interaction,
            level: read.level ?? null,
            ltf_bias: read.bias,
            htf_ltf_alignment: read.htf_ltf_alignment,
            is_retrace_day: read.is_retrace_day,
            grade_cap: read.grade_cap,
            entry_model_priority: read.entry_model_priority,
            cite: read.cite,
            resolved_at_ts: entry?.event?.ts ?? null,
            chainStatus: cs,
            ltf_bias_context: {
              bias: read.bias,
              htf_ltf_alignment: read.htf_ltf_alignment,
              is_retrace_day: read.is_retrace_day,
              entry_model_priority: read.entry_model_priority,
              grade_cap: read.grade_cap,
            },
          };
          chainStatus = cs;
          if (read.interaction !== prevInteraction) {
            const kind = read.interaction === "htf_fallback" ? "htf_fallback"
              : read.interaction === "mss_realignment" ? "mss_realignment"
              : read.interaction === "late_direction" ? "late_direction"
              : "open_reaction";
            appendActivity({ kind, interaction: read.interaction, level: read.level ?? null, bias: read.bias, alignment: read.htf_ltf_alignment, cite: read.cite });
            prevInteraction = read.interaction;
          }
        }
      }
      if (synthesizedContext && openReaction) {
        entry.inputs.ltf_bias_context = openReaction.ltf_bias_context;
      }
      // Pillar-1 state comes from the BRIEF context, not the tape's baked copy.
      // The recorder froze the 09:30 pre-open grade as pillar1.status='fail'
      // (open_unconfirmed), which permanently blocked the walker even after the
      // open resolved — live recomputes Pillar 1 = pass once the draw exists, so
      // the same walker spawned (2026-06-26 parity diag, scripts/diag-parity-0624).
      // Symmetric with the ltf_bias_context override above; re-injecting the fresh
      // (status='pass') pillar1 is what lets already-recorded tapes re-fold to live.
      if (context?.session_state?.pillar1) {
        entry.inputs.session_state = {
          ...(entry.inputs.session_state ?? {}),
          pillar1: context.session_state.pillar1,
        };
      }
      // Targets come from the BRIEF, not the tape's baked-in copy. Old tapes
      // froze the malformed-overnight_block targets (wrong-side levels in the
      // below/above lists); replaying them folded on stale targets while live
      // used the fixed brief (2026-06-14). Override per bar from the context's
      // untaken_targets so a replay reflects the current brief (no-op on fresh
      // runs, where the tape and context already agree).
      if (context?.untaken_targets) {
        entry.inputs.untaken_targets = context.untaken_targets;
      }
      // §7 Step 3 (Fix A): carry the brief's 4H/1H displacement into the per-bar
      // session_state so deriveGrade + the Pillar-2 entry gate read the HTF value,
      // not the stale baked tape (live gets it from the brief — keeps live==backtest).
      const htfDisp = context?.session_state?.pillar2?.htf_displacement;
      if (htfDisp != null) {
        entry.inputs.session_state = {
          ...(entry.inputs.session_state ?? {}),
          pillar2: { ...(entry.inputs.session_state?.pillar2 ?? {}), htf_displacement: htfDisp },
        };
      }
      const truth = await deps.truthFn({
        inputs: entry.inputs,
        previousWalkers: walkers,
        event: entry.event,
        session,
      });
      walkers = truth?.walkers ?? walkers;

      if (truth?.bestPacket && truth?.surfacePayload) {
        const payload = truth.surfacePayload;
        const setup = {
          id: payload.id ?? `setup-${i}`,
          model: payload.model ?? null,
          side: payload.side ?? null,
          entry: payload.entry ?? null,
          stop: payload.stop ?? null,
          tp1: payload.tp1 ?? null,
          tp2: payload.tp2 ?? null,
          grade: payload.grade ?? null,
          rationale: payload.rationale ?? null,
          event_ts: entry.event?.ts ?? null,
        };
        if (!seenPacketIds.has(setup.id)) {
          seenPacketIds.add(setup.id);
          surfaced.push(setup);
          bus.emit("backtest:event", { type: "setup_surfaced", runId, setup });
          appendActivity({ kind: "packet", id: setup.id, model: setup.model, side: setup.side });

          if (mode === "pause") {
            bus.emit("backtest:event", { type: "paused", runId, setup });
            const decision = await waitForDecision(bus, () => stopped);
            if (decision.choice === "accept") {
              openTrades.push(setup);
              appendSetupRow({ type: "open", ts: Date.now(), accepted_by: "user", ...setup });
              bus.emit("backtest:event", { type: "setup_accepted", runId, setupId: setup.id });
            } else if (decision.choice === "stopped") {
              appendSetupRow({ type: "stopped_during_decision", ts: Date.now(), setup_id: setup.id });
            } else {
              appendSetupRow({ type: "rejected", ts: Date.now(), setup_id: setup.id, reason: decision.reason ?? null });
              bus.emit("backtest:event", { type: "setup_rejected", runId, setupId: setup.id });
            }
          } else if (sessionHalted) {
            // -3R session halt (user ruling 2026-06-12): the setup still
            // surfaces for review, but the day is done trading.
            appendSetupRow({ type: "session_halted", ts: Date.now(), setup_id: setup.id, session_r: round2(sessionRealizedR) });
          } else if (openTrades.length === 0) {
            openTrades.push(setup);
            appendSetupRow({ type: "open", ts: Date.now(), accepted_by: "auto", ...setup });
          } else {
            // One position at a time (§7 Step 7 sizing/management; scale-in
            // removed 2026-06-23): the setup still counts as surfaced, but AUTO
            // never stacks positions — recorded so the review shows the skip.
            appendSetupRow({ type: "skipped_active_trade", ts: Date.now(), setup_id: setup.id });
          }
        }
      }

      // 4. Outcomes: walk open trades against this bar's recorded close.
      //    Entry fills at the confirmation close, so grading starts on the
      //    bar AFTER the one that surfaced the packet.
      const bar = lastClosedBarOf(entry);
      if (bar) {
        for (const trade of [...openTrades]) {
          if (trade.event_ts === entry.event?.ts) continue; // packet bar itself
          gradeOneTrade(trade, bar, entry.event?.ts ?? null);
        }
      }

      bus.emit("backtest:event", {
        type: "progress", runId, bar: i + 1, total: entries.length, cost: 0, phase: "folding",
      });
    }

    // 5. Carry + 4:00 PM close (user ruling 2026-06-13): a trade still open
    //    when its session window ends is NOT abandoned at $0. An AM trade
    //    keeps grading against the SAME DAY's PM bars (carryEntries); any
    //    trade still open at the 16:00 ET bar force-closes at that bar's
    //    price. Outcome-grading only — no new packets surface during carry.
    //    The frozen graded days have zero open trades at session end, so this
    //    is inert for them (refold-gate verified byte-identical).
    if (!stopped && !errorMessage && openTrades.length > 0 && carryEntries.length > 0) {
      for (const carryEntry of carryEntries) {
        if (openTrades.length === 0) break;
        const bar = lastClosedBarOf(carryEntry);
        if (!bar) continue;
        for (const trade of [...openTrades]) {
          gradeOneTrade(trade, bar, carryEntry.event?.ts ?? null);
        }
      }
    }
    if (!stopped && !errorMessage && openTrades.length > 0) {
      const graded = carryEntries.length > 0 ? carryEntries : entries;
      const lastEntry = graded[graded.length - 1];
      const lastBar = lastClosedBarOf(lastEntry);
      const lastCloseMs = Number(lastBar?.time) * 1000 + 60_000;
      const dayEndMs = etToEpochSeconds(date, "16:00") * 1000;
      // Force-close ONLY at a true day end (>= 16:00 ET). An AM run with no
      // PM carry ends at noon — those trades stay open (honest data gap),
      // never marked at the lunch price.
      if (lastBar && Number.isFinite(lastCloseMs) && lastCloseMs >= dayEndMs - 60_000) {
        for (const trade of [...openTrades]) {
          bookOutcome(trade, closeAtMarket(trade, lastBar), lastEntry.event?.ts ?? null);
        }
      }
    }

    if (stopped) chainStatus = "user-stopped";
  } catch (e) {
    errorMessage = e.message;
    chainStatus = `error:${e.message}`;
    // eslint-disable-next-line no-console
    console.error(`[backtest] run ${runId} failed:`, e.message);
    // Persist the failure — a crashed run must be reconstructable from disk
    // (2026-06-12: a popover run died with the error visible only in the
    // renderer event stream; nothing on disk, nothing in the log).
    try {
      const summary = buildSummary({
        runId, date, session, mode, symbol: runSymbol, startedAt,
        surfaced, closedTrades, openTrades, chainStatus, contextSource,
        warnings: warnings.length, bars: entries.length, errorMessage,
        openReaction,
      });
      persistSummary({ sessionDir, stateDir, summary });
    } catch { /* persistence is best-effort on the failure path */ }
    bus.emit("backtest:event", { type: "error", runId, message: e.message });
    bus.off("backtest:command", stopHandler);
    await runCleanup(deps, runId);
    throw e;
  }

  bus.off("backtest:command", stopHandler);
  // Fill the tape's PROPOSED expectation from the fold (verified stays
  // false — the human sign-off flips it before promotion to tests/tapes/).
  if (surfaced.length > 0) {
    try {
      const tapePath = path.join(sessionDir, "tape.json");
      const tape = JSON.parse(fs.readFileSync(tapePath, "utf8"));
      const first = surfaced[0];
      const outcome = closedTrades.find((t) => t.id === first.id)?.outcome ?? null;
      tape.expected = {
        outcome: "setup",
        model: first.model, side: first.side, grade: first.grade,
        entry: first.entry, stop: first.stop, tp1: first.tp1,
        ...(outcome ? { trade_outcome: outcome } : {}),
      };
      fs.writeFileSync(tapePath, JSON.stringify(tape, null, 2));
    } catch { /* tape enrichment is best-effort */ }
  }
  const summary = buildSummary({
    runId, date, session, mode, symbol: runSymbol, startedAt,
    surfaced, closedTrades, openTrades, chainStatus, contextSource,
    warnings: warnings.length, bars: entries.length, errorMessage,
    openReaction, sessionHalted,
  });
  persistSummary({ sessionDir, stateDir, summary });
  bus.emit("backtest:event", { type: "done", runId, summary });
  await runCleanup(deps, runId);
  return { runId, summary };
}

// summary.json (machine) + summary.md (the replayed day's wrap — chain_audit
// frontmatter mirroring the live wrap, rendered by the popover DETAIL view)
// + index entry.
function persistSummary({ sessionDir, stateDir, summary }) {
  fs.writeFileSync(path.join(sessionDir, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(sessionDir, "summary.md"), summaryMarkdown(summary));
  writeIndexEntry({ stateDir, entry: summary });
}

function summaryMarkdown(s) {
  const or = s.open_reaction;
  return [
    "---",
    `chain_status: "${s.chain_status}"`,
    `context_source: "${s.context_source}"`,
    `setups: ${s.setups}`,
    `wins: ${s.wins}`,
    `losses: ${s.losses}`,
    `total_r: ${s.total_r}`,
    ...(or ? [
      `open_reaction_alignment: "${or.htf_ltf_alignment}"`,
      `open_reaction_level: "${or.level ?? ""}"`,
    ] : []),
    "---",
    "",
    `# Backtest ${s.date} ${s.session}`,
    "",
    `- engine: ${s.engine}`,
    `- mode: ${s.mode} · bars: ${s.bars} · cost: $${s.cost_usd}`,
    `- chain: ${s.chain_status} (context: ${s.context_source})`,
    `- setups: ${s.setups} · wins ${s.wins} · losses ${s.losses} · total R ${s.total_r}`,
    ...(or ? [
      "",
      "## Open reaction",
      `- ${or.interaction} at ${or.level ?? "n/a"} → ${or.htf_ltf_alignment}` +
        `${or.is_retrace_day ? " (retrace day)" : ""} · cap ${or.grade_cap} · model priority ${or.entry_model_priority}`,
      `- cite: ${or.cite}`,
    ] : []),
    "",
  ].join("\n");
}

// Always-on teardown (production: stop TV replay so the shared chart never
// stays stranded in replay mode — a stranded replay poisons the next live
// capture). Failures are logged, never thrown: cleanup must not mask the
// run result.
async function runCleanup(deps, runId) {
  if (!deps.cleanup) return;
  try {
    await deps.cleanup();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[backtest] cleanup failed for ${runId}:`, e.message);
  }
}

function buildSummary({ runId, date, session, mode, symbol = null, startedAt, surfaced = [], closedTrades, openTrades, chainStatus, contextSource, warnings = 0, bars = 0, errorMessage = null, openReaction = null, sessionHalted = false }) {
  // `setups` counts what the chain SURFACED — a rejected setup still
  // happened; only acceptance routes it into the outcome walk.
  const totalSetups = surfaced.length;
  // A win is any trade that booked positive R — a TP1/TP2 hit, OR a 16:00
  // force-close that was in profit (user ruling 2026-06-17: a profitable EOD
  // close is a win, a losing one a loss). Matches the dashboard's R-based
  // definition (cli/lib/backtest-analytics.js).
  const isWin = (t) => t.outcome === "tp1_hit" || t.outcome === "tp2_hit"
    || (t.outcome === "closed_1600" && Number(t.realized_r) > 0);
  const isLoss = (t) => t.outcome === "stop_hit"
    || (t.outcome === "closed_1600" && Number(t.realized_r) < 0);
  const wins = closedTrades.filter(isWin).length;
  const losses = closedTrades.filter(isLoss).length;
  // Trades force-closed at 16:00 (user ruling 2026-06-13) — kept as an
  // informational count; they're now ALSO classified win/loss by signed R above.
  const closed_eod = closedTrades.filter((t) => t.outcome === "closed_1600").length;
  // Realized R model (user correction 2026-06-12): each closed trade books
  // its actual multiple — TP1 hits pay |exit-entry|/|entry-stop| (>=2R for
  // swing targets by rule), stops pay -1R, open at session end = 0.
  const total_r = closedTrades.reduce((acc, t) => acc + (Number.isFinite(t.realized_r) ? t.realized_r : (t.outcome === "tp1_hit" ? 1 : t.outcome === "stop_hit" ? -1 : 0)), 0);
  const winsByModel = closedTrades.reduce((acc, t) => {
    if (!t.model || !isWin(t)) return acc;
    acc[t.model] = (acc[t.model] ?? 0) + 1;
    return acc;
  }, {});
  const best_model = Object.entries(winsByModel).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const setups_by_grade = surfaced.reduce((acc, t) => {
    const g = t.grade ?? "B";
    acc[g] = (acc[g] ?? 0) + 1;
    return acc;
  }, {});
  const wins_by_grade = closedTrades.reduce((acc, t) => {
    if (!isWin(t)) return acc;
    const g = t.grade ?? "B";
    acc[g] = (acc[g] ?? 0) + 1;
    return acc;
  }, {});
  return {
    run_id: runId,
    date, session, mode, symbol,
    created_at: new Date(startedAt).toISOString(),
    elapsed_ms: Date.now() - startedAt,
    cost_usd: 0,
    engine: "deterministic-walker-chain",
    context_source: contextSource,
    bars,
    recording_warnings: warnings,
    setups: totalSetups,
    wins, losses, closed_eod,
    no_trades: totalSetups === 0 ? 1 : 0,
    total_r: round2(total_r),
    best_model,
    setups_by_grade,
    wins_by_grade,
    your_agreement: { agreed: 0, disagreed: 0, ungraded: totalSetups },
    session_halted: sessionHalted,
    chain_status: errorMessage ? `error:${errorMessage}` : chainStatus,
    ...(openReaction ? {
      open_reaction: {
        interaction: openReaction.interaction,
        level: openReaction.level,
        ltf_bias: openReaction.ltf_bias,
        htf_ltf_alignment: openReaction.htf_ltf_alignment,
        is_retrace_day: openReaction.is_retrace_day,
        grade_cap: openReaction.grade_cap,
        entry_model_priority: openReaction.entry_model_priority,
        cite: openReaction.cite,
        resolved_at_ts: openReaction.resolved_at_ts,
      },
    } : {}),
  };
}

export const __test = { buildSummary };

// Wait for a {type:"decision", choice:"accept"|"reject"} command on the bus.
// Resolves early on {type:"stop"} so the engine unwinds cleanly.
function waitForDecision(bus, isStopped) {
  return new Promise((resolve) => {
    const onCmd = (cmd) => {
      if (!cmd) return;
      if (cmd.type === "decision") {
        bus.off("backtest:command", onCmd);
        resolve(cmd);
      } else if (cmd.type === "stop") {
        bus.off("backtest:command", onCmd);
        resolve({ choice: "stopped" });
      }
    };
    bus.on("backtest:command", onCmd);
    if (isStopped && isStopped()) {
      bus.off("backtest:command", onCmd);
      resolve({ choice: "stopped" });
    }
  });
}
