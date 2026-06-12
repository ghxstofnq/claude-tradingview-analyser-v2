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
import { generateRunId, resolveRunDir, writeIndexEntry } from "./backtest-store.js";
import { resolveOpenReaction, overnightTargetsForSession } from "../../cli/lib/open-reaction-resolver.js";
import { computeEntryModelPriority } from "../../cli/lib/entry-model-priority.js";
import { etToEpochSeconds } from "../../cli/lib/tape-recorder.js";

const SESSION_WINDOWS = {
  "ny-am": { from: "09:30", to: "12:00" },
  "ny-pm": { from: "13:00", to: "16:00" },
  london: { from: "03:00", to: "06:00" },
};

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
function resolveOpenReactionLeg({ entry, context, window, session }) {
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
  date, session, mode,
  bus,
  stateDir = "state",
  deps,
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
  const closedTrades = [];
  let contextSource = "none";
  let chainStatus = "clean";
  let openReaction = null;
  let errorMessage = null;
  let entries = [];
  let warnings = [];

  try {
    // 1. Context: the day's recorded chain state if it exists, else a
    //    deterministic brief at the replay anchor (grade_cap B — same rule
    //    as the live catch_up backfill).
    let context = await deps.loadDayContext?.({ date, session });
    if (context) {
      contextSource = "day_state";
    } else if (deps.runDirectBrief) {
      context = await deps.runDirectBrief({ runId, session, date });
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
    const seenPacketIds = new Set();
    for (let i = 0; i < entries.length && !stopped; i += 1) {
      const entry = entries[i];
      const entryMs = Date.parse(entry?.event?.ts ?? "");
      const inResolveSpan = Number.isFinite(entryMs) && entryMs >= orWindow.resolveMs &&
        (!openReaction || entryMs <= orWindow.endMs);
      if (synthesizedContext && inResolveSpan) {
        const next = resolveOpenReactionLeg({ entry, context, window: orWindow, session });
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
      // SWING-tier MSS confirming against the current bias realigns the
      // fold to the structure's direction (mirrors the live resolver).
      if (synthesizedContext && openReaction && Number.isFinite(entryMs) && entryMs > orWindow.endMs && openReaction.ltf_bias) {
        const swings = entry?.inputs?.bundle?.gates?.engine?.pillar3?.structures_by_tier?.swing ?? [];
        const mss = swings
          .filter((s) => s?.event === "mss" && (s?.confirmed_ms ?? 0) > orWindow.endMs &&
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
          } else if (openTrades.length === 0) {
            openTrades.push(setup);
            appendSetupRow({ type: "open", ts: Date.now(), accepted_by: "auto", ...setup });
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
        for (const trade of [...openTrades]) {
          if (trade.event_ts === entry.event?.ts) continue; // packet bar itself
          const verdict = deps.gradeFn(trade, bar);
          if (verdict.outcome === "pending") continue;
          appendSetupRow({
            type: "outcome", ts: Date.now(), setup_id: trade.id,
            outcome: verdict.outcome, exit: verdict.exit, conflict_bar: verdict.conflict_bar,
            event_ts: entry.event?.ts ?? null,
          });
          closedTrades.push({ ...trade, ...verdict });
          openTrades.splice(openTrades.indexOf(trade), 1);
          bus.emit("backtest:event", {
            type: "setup_outcome", runId, setupId: trade.id,
            outcome: verdict.outcome, exit: verdict.exit,
          });
        }
      }

      bus.emit("backtest:event", {
        type: "progress", runId, bar: i + 1, total: entries.length, cost: 0, phase: "folding",
      });
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
    openReaction,
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

function buildSummary({ runId, date, session, mode, startedAt, surfaced = [], closedTrades, openTrades, chainStatus, contextSource, warnings = 0, bars = 0, errorMessage = null, openReaction = null }) {
  // `setups` counts what the chain SURFACED — a rejected setup still
  // happened; only acceptance routes it into the outcome walk.
  const totalSetups = surfaced.length;
  const wins = closedTrades.filter((t) => t.outcome === "tp1_hit").length;
  const losses = closedTrades.filter((t) => t.outcome === "stop_hit").length;
  // Simple R model: TP1 hit = +1R, stop hit = -1R, open at session end = 0.
  const total_r = wins - losses;
  const winsByModel = closedTrades.reduce((acc, t) => {
    if (!t.model || t.outcome !== "tp1_hit") return acc;
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
    if (t.outcome !== "tp1_hit") return acc;
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
    wins, losses,
    no_trades: totalSetups === 0 ? 1 : 0,
    total_r: round2(total_r),
    best_model,
    setups_by_grade,
    wins_by_grade,
    your_agreement: { agreed: 0, disagreed: 0, ungraded: totalSetups },
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
