#!/usr/bin/env node
// Fold a recorded run's tape through the production truth fn, printing
// walker stages, packets, and block reasons per bar. Pure disk — no chart.
//
// Usage: node scripts/debug-fold.js <run-id> [session] [fromHHMM] [toHHMM]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";
import { openReactionWindowMs } from "../app/main/backtest-engine.js";
import { resolveOpenReaction } from "../cli/lib/open-reaction-resolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const [runId, session = "ny-am", fromHHMM = "09:30", toHHMM = "12:00"] = process.argv.slice(2);
const runDir = path.join(REPO_ROOT, "state", "backtest", runId, session);
const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
const payloads = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8"));
const context = contextFromBriefPayloads({ session, payloads });

const w = openReactionWindowMs({ date: tape.date, session });
const freezeMs = w.endMs;
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
for (const entry of tape.entries) {
  const ms = Date.parse(entry.event.ts);
  if (ms >= w.resolveMs && (!openReaction || ms <= freezeMs)) {
    const gates = entry.inputs.bundle.gates.engine;
    const swings = gates?.pillar3?.structures_by_tier?.swing ?? [];
    const swing = swings.reduce((a, b) => ((b?.confirmed_ms ?? 0) >= (a?.confirmed_ms ?? 0) ? b : a), null);
    const v = resolveOpenReaction({
      htf_bias: context.session_state.pillar1.htfBias,
      sweeps: gates?.pillar1?.sweeps ?? [],
      swing_structure: swing,
      window: w,
    });
    if (!openReaction || v.interaction !== openReaction.interaction || v.htf_ltf_alignment !== openReaction.htf_ltf_alignment) {
      openReaction = v;
      console.log(`>> ${et(entry.event.ts)} open-reaction: ${v.interaction} ${v.level ?? ""} → ${v.ltf_bias} ${v.htf_ltf_alignment} cap=${v.grade_cap}`);
    }
  }
  if (openReaction) {
    entry.inputs.ltf_bias_context = {
      bias: openReaction.ltf_bias,
      htf_ltf_alignment: openReaction.htf_ltf_alignment,
      is_retrace_day: openReaction.is_retrace_day,
      entry_model_priority: "undecided",
      grade_cap: openReaction.grade_cap,
    };
  }
  const truth = await barCloseTruth.buildDeterministicPacketTruthFromInputs({
    inputs: entry.inputs, previousWalkers: walkers, event: entry.event, session,
  });
  walkers = truth?.walkers ?? walkers;
  if (!inRange(entry.event.ts)) continue;
  const ws = (truth.walkers ?? []).map((x) => `${x.model ?? x.kind ?? "?"}/${x.side ?? x.dir ?? "?"}@${x.stage ?? "?"}`).join(" ");
  const pk = truth.bestPacket ? ` PACKET ${truth.bestPacket.model} ${truth.bestPacket.side} ${truth.bestPacket.grade ?? ""} e=${truth.bestPacket.entry}` : "";
  const bl = (truth.blockers ?? []).slice(0, 4).join(",");
  console.log(`${et(entry.event.ts)} verdict=${truth.finalVerdict} walkers=[${ws}]${pk}${bl ? ` blocked:${bl}` : ""}`);
}
