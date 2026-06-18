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
import { resolveOpenReaction, overnightTargetsForSession } from "../../cli/lib/open-reaction-resolver.js";
import { computeEntryModelPriority } from "../../cli/lib/entry-model-priority.js";
import { etToEpochSeconds } from "../../cli/lib/tape-recorder.js";

const SESSION_WINDOWS = {
  "ny-am": { from: "09:30", to: "12:00" },
  "ny-pm": { from: "13:00", to: "16:00" },
  london: { from: "03:00", to: "06:00" },
};

// User ruling 2026-06-12: the session halts at -3R realized — no new
// positions once the day's closed trades reach the cap (June 11 AM chop
// bled 9 straight stops without it).
const SESSION_MAX_LOSS_R = -3;
// User ruling 2026-06-13: also halt after 3 LOSING trades in a row (any win
// resets the streak) — stricter than the cumulative cap, and it catches the
// concurrent-adds bleed the cumulative −3R let slip (June 11 AM −4 → −3).
const SESSION_MAX_LOSS_STREAK = 3;

// Break-even scale-in — DEFAULT ON (user ruling 2026-06-13; opt out with
// TV_SCALEIN=0). The anchor keeps its ORIGINAL stop and rides to TP1 as normal;
// once it travels 50% of the way to TP1 (the "green light" = the move is
// proven), up to SCALE_IN_MAX additional SAME-DIRECTION confirmed setups may
// open as concurrent adds (10-min dedup so near-identical entries collapse to
// one). No break-even stop move anywhere — winners are never scratched; the
// adds carry their own -1R risk and the 2-stop breaker caps chop-day bleed.
const SCALE_IN = process.env.TV_SCALEIN !== "0";
const SCALE_IN_MAX = 5;                 // up to 5 concurrent adds (user 2026-06-13)
const SCALE_IN_STOP_STREAK = 2;         // 2 add stop-outs in a row → adds off for the session
// Green-light off the anchor's nearest INTRADAY objective (packet.greenlight_ref)
// instead of its TP1 — DEFAULT ON (opt out with TV_GREENLIGHT_INTRADAY=0).
// Decouples add-timing from how far the HTF/session draw sits: the target model
// can push TP1 out to a far draw, which delayed the green light and dropped adds
// (June-15). Keying off the nearest intraday objective restores the original add
// cadence. Corpus-validated +4.82R (helps trend days, costs ~1R on chop days);
// inert on frozen days (no session draws there, so greenlight_ref == TP1).
const GREENLIGHT_INTRADAY = process.env.TV_GREENLIGHT_INTRADAY !== "0";
// Dedup: setups that are the same side + same draw (same TP1) within this
// window of an already-taken position are "basically the same trade" (e.g.
// June 2's 10:32 + 10:33, one minute apart) — collapse them to the first, so
// adds are genuinely distinct entries, not duplicates of each other.
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

function anchorGreenLit(anchor) {
  return Boolean(anchor?.greenLight);
}
// A+ → TP2 (user ruling 2026-06-13): only A+ trades run past TP1, and only when
// TP2 sits BEYOND TP1 in the trade's direction (otherwise there's no runner
// room and it banks at TP1 like a B trade).
function isRunnerEligible(trade) {
  if (trade?.grade !== "A+") return false;
  const t1 = Number(trade.tp1), t2 = Number(trade.tp2);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return false;
  return trade.side === "short" ? t2 < t1 : t2 > t1;
}
function isNearDuplicate(setup, takenLog) {
  const ms = Date.parse(setup.event_ts);
  if (!Number.isFinite(ms)) return false;
  // Same SIDE within the window is "basically the same trade" — the targets may
  // differ slightly (May 26: 29975 vs 29913.5) but it's one continuation idea.
  return takenLog.some((t) =>
    t.side === setup.side && ms - t.ms < DEDUP_WINDOW_MS && ms - t.ms >= 0);
}
function canScaleInto(anchor, setup, openCount, takenLog) {
  if (!SCALE_IN || !anchorGreenLit(anchor)) return false;
  if (openCount >= 1 + SCALE_IN_MAX) return false;
  if (setup.side !== anchor.side) return false;  // SAME DIRECTION (was: same draw)
  return !isNearDuplicate(setup, takenLog);      // not a 10-min duplicate
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

/**
 * Deterministic open-reaction leg (§2.3 / §7 Step 4) for synthesized
 * contexts: resolve the NY-open verdict from the engine's sweep rows at the
 * minute-15 boundary and return the upgraded ltf context + chain status.
 */
function resolveOpenReactionLeg({ entry, context, window, session, windowCloses = [] }) {
  const gates = entry?.inputs?.bundle?.gates?.engine ?? {};
  const htfBias = context?.session_state?.pillar1?.htfBias ?? null;
  // Standing swing-tier structure AS OF the open window (engine's real-vs-
  // internal separation) — lets the resolver detect failed breaks (§7 Step
  // 4). Post-window structures must not rewrite the open read; they drive
  // mss realignment instead (see the fold loop).
  const swingStructs = (gates?.pillar3?.structures_by_tier?.swing ?? [])
    .filter((s) => (s?.confirmed_ms ?? 0) <= window.endMs);
  const swingStructure = swingStructs.reduce(
    (a, b) => ((b?.confirmed_ms ?? 0) >= (a?.confirmed_ms ?? 0) ? b : a),
    null,
  );
  const verdict = resolveOpenReaction({
    htf_bias: htfBias,
    sweeps: gates?.pillar1?.sweeps ?? [],
    swing_structure: swingStructure,
    window,
    overnight_targets: overnightTargetsForSession(session),
    window_closes: windowCloses,
  });
  const p3 = gates?.pillar3 ?? {};
  const priority = computeEntryModelPriority({
    pillar2_verdict: context?.session_state?.pillar2?.verdict ?? null,
    htf_ltf_alignment: verdict.htf_ltf_alignment,
    ltf_bias: verdict.ltf_bias,
    failure_swings: p3.failure_swings ?? [],
    most_recent_structure: p3.most_recent_structure ?? null,
    inverted_fvg_present: (p3.fvgs ?? []).some((f) => f?.state === "inverted"),
  });
  const chainStatus = verdict.htf_ltf_alignment === "aligned" ? "clean"
    : verdict.htf_ltf_alignment === "divergent" ? "divergent"
    : "degraded:open_unclear";
  return {
    ...verdict,
    entry_model_priority: priority.priority,
    resolved_at_ts: entry?.event?.ts ?? null,
    chainStatus,
    ltf_bias_context: {
      bias: verdict.ltf_bias,
      htf_ltf_alignment: verdict.htf_ltf_alignment,
      is_retrace_day: verdict.is_retrace_day,
      entry_model_priority: priority.priority,
      grade_cap: verdict.grade_cap,
    },
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
  const takenLog = []; // {side, tp1, ms} of every position opened — for scale-in dedup
  let addStopStreak = 0;     // consecutive ADD stop-outs (winning add resets)
  let addsDisabled = false;  // tripped once addStopStreak hits SCALE_IN_STOP_STREAK
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
    // Scale-in circuit breaker: 2 ADD stop-outs in a row → adds off for the
    // rest of the session (a winning add resets). The anchor's own outcome
    // and a 16:00 close never count toward the streak.
    if (SCALE_IN && trade.scale_in_add) {
      if (verdict.outcome === "stop_hit") {
        addStopStreak += 1;
        if (addStopStreak >= SCALE_IN_STOP_STREAK) {
          addsDisabled = true;
          appendActivity({ kind: "scale_in_breaker", rule: `${SCALE_IN_STOP_STREAK} add stops in a row` });
        }
      } else if (verdict.outcome === "tp1_hit") {
        addStopStreak = 0;
      }
    }
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
      // Honest data gap — no recorded chain state and no brief could be
      // built. Mirrors constraint #9's data_gap separation: this is a
      // capture problem, not a market verdict.
      chainStatus = "no_context:data_gap";
      const summary = buildSummary({
        runId, date, session, mode, startedAt,
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
    let lastRealignMs = 0;
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
      const inResolveSpan = Number.isFinite(entryMs) && entryMs >= orWindow.resolveMs &&
        (!openReaction || entryMs <= orWindow.endMs);
      if (synthesizedContext && inResolveSpan) {
        const next = resolveOpenReactionLeg({ entry, context, window: orWindow, session, windowCloses });
        const changed = !openReaction ||
          next.interaction !== openReaction.interaction ||
          next.level !== openReaction.level ||
          next.htf_ltf_alignment !== openReaction.htf_ltf_alignment;
        if (changed) {
          openReaction = next;
          chainStatus = next.chainStatus;
          appendActivity({
            kind: "open_reaction",
            interaction: next.interaction,
            level: next.level,
            alignment: next.htf_ltf_alignment,
            cite: next.cite,
          });
        }
      }
      // §2.3 + user ruling 2026-06-12: a quiet open leaves the LTF bias
      // PENDING — the first swing-tier structure event after the window
      // earns the fold its direction at B cap (§7 Step 7: neutral
      // overnight stays one weaker element). Mirrors the live resolver.
      if (synthesizedContext && openReaction && Number.isFinite(entryMs) && entryMs > orWindow.endMs && !openReaction.ltf_bias) {
        const swings = entry?.inputs?.bundle?.gates?.engine?.pillar3?.structures_by_tier?.swing ?? [];
        const struct = swings
          .filter((s) => (s?.confirmed_ms ?? 0) > orWindow.endMs && (s?.confirmed_ms ?? 0) <= entryMs)
          .reduce((a, b) => ((b?.confirmed_ms ?? 0) >= (a?.confirmed_ms ?? 0) ? b : a), null);
        const structBias = struct?.dir === "bear" ? "bearish" : struct?.dir === "bull" ? "bullish" : null;
        if (structBias) {
          const htfBias = context?.session_state?.pillar1?.htfBias ?? null;
          const aligned = structBias === htfBias;
          openReaction = {
            ...openReaction,
            interaction: "late_direction",
            ltf_bias: structBias,
            htf_ltf_alignment: aligned ? "aligned" : "divergent",
            is_retrace_day: !aligned,
            grade_cap: "B",
            cite: "gates.engine.pillar3.structures_by_tier.swing[latest]",
            resolved_at_ts: entry.event?.ts ?? null,
            chainStatus: aligned ? "clean" : "divergent",
            ltf_bias_context: {
              ...openReaction.ltf_bias_context,
              bias: structBias,
              htf_ltf_alignment: aligned ? "aligned" : "divergent",
              is_retrace_day: !aligned,
              grade_cap: "B",
            },
          };
          chainStatus = openReaction.chainStatus;
          lastRealignMs = struct.confirmed_ms;
          appendActivity({ kind: "late_direction", bias: structBias, alignment: openReaction.htf_ltf_alignment, cite: openReaction.cite });
        }
      }
      // §2.3 "never marries a bias" + §7 Step 5: after the open window, a
      // SWING-tier MSS — or a swing-tier BoS with displacement — confirming
      // against the current bias realigns the fold to the structure's
      // direction (mirrors the live resolver; see live-ltf-resolver.js for the
      // 2026-06-18 BoS-skipped case the MSS-only filter missed).
      if (synthesizedContext && openReaction && Number.isFinite(entryMs) && entryMs > orWindow.endMs && openReaction.ltf_bias) {
        const swings = entry?.inputs?.bundle?.gates?.engine?.pillar3?.structures_by_tier?.swing ?? [];
        const mss = swings
          .filter((s) => (s?.event === "mss" || (s?.event === "bos" && s?.displacement === true))
            && (s?.confirmed_ms ?? 0) > orWindow.endMs &&
            (s?.confirmed_ms ?? 0) > lastRealignMs && (s?.confirmed_ms ?? 0) <= entryMs)
          .reduce((a, b) => ((b?.confirmed_ms ?? 0) >= (a?.confirmed_ms ?? 0) ? b : a), null);
        const structBias = mss?.dir === "bear" ? "bearish" : mss?.dir === "bull" ? "bullish" : null;
        if (structBias && structBias !== openReaction.ltf_bias) {
          const htfBias = context?.session_state?.pillar1?.htfBias ?? null;
          const aligned = structBias === htfBias;
          openReaction = {
            ...openReaction,
            interaction: "mss_realignment",
            ltf_bias: structBias,
            htf_ltf_alignment: aligned ? "aligned" : "divergent",
            is_retrace_day: !aligned,
            grade_cap: aligned ? "A+" : "B",
            cite: "gates.engine.pillar3.structures_by_tier.swing[latest mss]",
            resolved_at_ts: entry.event?.ts ?? null,
            chainStatus: aligned ? "clean" : "divergent",
            ltf_bias_context: {
              ...openReaction.ltf_bias_context,
              bias: structBias,
              htf_ltf_alignment: aligned ? "aligned" : "divergent",
              is_retrace_day: !aligned,
              grade_cap: aligned ? "A+" : "B",
            },
          };
          chainStatus = openReaction.chainStatus;
          lastRealignMs = mss.confirmed_ms;
          appendActivity({ kind: "mss_realignment", bias: structBias, alignment: openReaction.htf_ltf_alignment, cite: openReaction.cite });
        }
      }
      if (synthesizedContext && openReaction) {
        entry.inputs.ltf_bias_context = openReaction.ltf_bias_context;
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
          greenlight_ref: payload.greenlight_ref ?? null,
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
            takenLog.push({ side: setup.side, tp1: Number(setup.tp1), ms: Date.parse(setup.event_ts) });
            appendSetupRow({ type: "open", ts: Date.now(), accepted_by: "auto", ...setup });
          } else if (SCALE_IN && anchorGreenLit(openTrades[0]) && setup.side === openTrades[0].side
                     && isNearDuplicate(setup, takenLog)) {
            // Same side within 10 min of a position already taken — "basically
            // the same trade." Collapse it (don't double-count).
            appendSetupRow({ type: "dedup_skipped", ts: Date.now(), setup_id: setup.id });
          } else if (!addsDisabled && canScaleInto(openTrades[0], setup, openTrades.length, takenLog)) {
            // Break-even scale-in (flagged): the anchor is green-lit (past 50%
            // to TP1) and this is a same-side, same-draw, NON-duplicate
            // confirmation — open it as a concurrent add rather than skipping.
            setup.scale_in_add = true;
            openTrades.push(setup);
            takenLog.push({ side: setup.side, tp1: Number(setup.tp1), ms: Date.parse(setup.event_ts) });
            appendSetupRow({ type: "open", ts: Date.now(), accepted_by: "auto", scale_in_add: true, ...setup });
            bus.emit("backtest:event", { type: "setup_accepted", runId, setupId: setup.id });
          } else {
            // One position at a time (§7 Step 7 sizing/management): the
            // setup still counts as surfaced, but AUTO doesn't stack
            // positions — recorded so the review shows what was skipped.
            appendSetupRow({ type: "skipped_active_trade", ts: Date.now(), setup_id: setup.id });
          }
        }
      }

      // 4. Outcomes: walk open trades against this bar's recorded close.
      //    Entry fills at the confirmation close, so grading starts on the
      //    bar AFTER the one that surfaced the packet.
      const bar = lastClosedBarOf(entry);
      if (bar) {
        // Green light: the anchor (oldest open trade) has travelled 50% of the
        // way to its TP1 → the move is proven, concurrent adds become allowed.
        // The anchor itself keeps its ORIGINAL stop (no break-even move).
        if (SCALE_IN && openTrades.length > 0 && !openTrades[0].greenLight) {
          const a = openTrades[0];
          const e = Number(a.entry);
          // Default: 50% to the anchor's TP1. Opt-in: 50% to its nearest
          // intraday objective (greenlight_ref) so add-timing is independent of
          // how far the HTF draw sits. Falls back to TP1 when no intraday ref.
          const t = Number(GREENLIGHT_INTRADAY ? (a.greenlight_ref ?? a.tp1) : a.tp1);
          if (Number.isFinite(e) && Number.isFinite(t)) {
            const half = a.side === "long" ? e + 0.5 * (t - e) : e - 0.5 * (e - t);
            if (a.side === "long" ? Number(bar.high) >= half : Number(bar.low) <= half) a.greenLight = true;
          }
        }
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
        runId, date, session, mode, startedAt,
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
    runId, date, session, mode, startedAt,
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

function buildSummary({ runId, date, session, mode, startedAt, surfaced = [], closedTrades, openTrades, chainStatus, contextSource, warnings = 0, bars = 0, errorMessage = null, openReaction = null, sessionHalted = false }) {
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
    date, session, mode,
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
