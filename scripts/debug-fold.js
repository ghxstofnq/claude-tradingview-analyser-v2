#!/usr/bin/env node
// Fold a recorded run's tape through the production truth fn, printing
// walker stages, packets, and block reasons per bar. Pure disk — no chart.
//
// Mirrors the backtest-engine per-bar open-reaction EXACTLY: it recomputes the
// brief context with current code (regen → recomputeGate), accumulates the
// in-window 1m closes, and resolves the open read via deriveLtfBiasContext —
// the SAME resolver the live chain + baseline fold use, levers and all
// (overnight_net / fresh-draw / wait-for-reaction). The old version called a
// bare resolveOpenReaction WITHOUT the levers and read the stale baked
// payloads, so its open read diverged from the real chain on every lever-era
// day (2026-06-18 read "bearish divergent" here but resolves differently in the
// real fold). This trace is now faithful to the baseline fold.
//
// Usage: node scripts/debug-fold.js <run-id> [session] [fromHHMM] [toHHMM]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";
import { openReactionWindowMs } from "../app/main/backtest-engine.js";
import { deriveLtfBiasContext } from "../app/main/live-ltf-resolver.js";
import { regen } from "../app/main/backtest-baseline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const [runId, session = "ny-am", fromHHMM = "09:30", toHHMM = "12:00"] = process.argv.slice(2);
const runDir = path.join(REPO_ROOT, "state", "backtest", runId, session);
const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
const symbol = tape.entries?.[0]?.inputs?.leader ?? "MNQ1!";
// Recompute the brief with CURRENT code (same regen the baseline fold uses) so
// the HTF bias/draw reflect the live levers, not the stale baked payloads.
const payloads = regen(runDir, session, symbol)
  ?? JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8"));
const context = contextFromBriefPayloads({ session, payloads });

const w = openReactionWindowMs({ date: tape.date, session });
const et = (iso) => {
  const d = new Date(iso);
  return `${String((d.getUTCHours() + 20) % 24).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const inRange = (iso) => {
  const t = et(iso);
  return t >= fromHHMM && t <= toHHMM;
};

let walkers = [];
let openReaction = null;
let prevInteraction = null;
const windowCloses = [];
for (const entry of tape.entries) {
  const entryMs = Date.parse(entry?.event?.ts ?? "");
  // Accumulate the in-window 1m closes exactly like backtest-engine does.
  const lastBar = entry?.inputs?.bundle?.bars?.last_5_bars?.at(-1);
  const lastBarCloseMs = Number(lastBar?.time) * 1000 + 60_000;
  if (Number.isFinite(lastBarCloseMs) && Number.isFinite(Number(lastBar?.close))
    && lastBarCloseMs > w.startMs && lastBarCloseMs <= w.endMs
    && !windowCloses.some((c) => c.time_ms === lastBarCloseMs)) {
    windowCloses.push({ time_ms: lastBarCloseMs, close: Number(lastBar.close) });
  }
  // ONE open-read via the production resolver (levers included), every bar from
  // minute 15; deriveLtfBiasContext self-freezes post-window.
  if (Number.isFinite(entryMs) && entryMs >= w.resolveMs) {
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
      openReaction = read;
      if (read.interaction !== prevInteraction) {
        console.log(`>> ${et(entry.event.ts)} open-reaction: ${read.interaction} ${read.level ?? ""} → ${read.bias} ${read.htf_ltf_alignment} cap=${read.grade_cap}`);
        prevInteraction = read.interaction;
      }
    }
  }
  if (openReaction) {
    entry.inputs.ltf_bias_context = {
      bias: openReaction.bias,
      htf_ltf_alignment: openReaction.htf_ltf_alignment,
      is_retrace_day: openReaction.is_retrace_day,
      entry_model_priority: openReaction.entry_model_priority ?? "undecided",
      grade_cap: openReaction.grade_cap,
    };
  }
  // Mirror runBacktest's per-bar context re-injection (backtest-engine.js:428-452)
  // EXACTLY, or this tracer diverges from the real fold. The recorder freezes the
  // 09:30 pre-open grade as pillar1.status='fail'; without the override the walker
  // stays blocked even after the draw resolves, so the trace shows no-trade while
  // fold-bias books the win (2026-06-28: 06-09 traced 0 packets vs fold-bias +9.47).
  if (context?.session_state?.pillar1) {
    entry.inputs.session_state = {
      ...(entry.inputs.session_state ?? {}),
      pillar1: context.session_state.pillar1,
    };
  }
  if (context?.untaken_targets) {
    entry.inputs.untaken_targets = context.untaken_targets;
  }
  const htfDisp = context?.session_state?.pillar2?.htf_displacement;
  if (htfDisp != null) {
    entry.inputs.session_state = {
      ...(entry.inputs.session_state ?? {}),
      pillar2: { ...(entry.inputs.session_state?.pillar2 ?? {}), htf_displacement: htfDisp },
    };
  }
  const truth = await barCloseTruth.buildDeterministicPacketTruthFromInputs({
    inputs: entry.inputs, previousWalkers: walkers, event: entry.event, session,
  });
  walkers = truth?.walkers ?? walkers;
  if (!inRange(entry.event.ts)) continue;
  const ws = (truth.walkers ?? []).map((x) => `${x.model ?? x.kind ?? "?"}/${x.side ?? x.dir ?? "?"}@${x.stage ?? "?"}`).join(" ");
  // Numeric entry/stop/tp1 live on surfacePayload (bestPacket.entry is the audit
  // object → prints [object Object]); mirror foldTape's field reads.
  const sp = truth.surfacePayload ?? {};
  const pk = truth.bestPacket ? ` PACKET ${sp.model ?? truth.bestPacket.model} ${sp.side ?? truth.bestPacket.side} ${sp.grade ?? truth.bestPacket.grade ?? ""} e=${sp.entry ?? "?"} s=${sp.stop ?? "?"} tp1=${sp.tp1 ?? "?"}` : "";
  const bl = (truth.blockers ?? []).slice(0, 4).join(",");
  console.log(`${et(entry.event.ts)} verdict=${truth.finalVerdict} walkers=[${ws}]${pk}${bl ? ` blocked:${bl}` : ""}`);
}
