#!/usr/bin/env node
// Decisive live-vs-backtest parity experiment for 2026-06-24 ny-am.
// Folds the SHARED truthFn three ways and counts surfaced setups:
//   A) live walker-inputs.jsonl as-is            (live inputs → brain)
//   B) backtest tape entries as-is               (replay inputs → brain)
//   C) backtest tape + live's resolved ltf_bias_context + pillar1.status='pass'
// If A and C surface setups but B doesn't, the baked context fields (bias=null,
// pillar1.status='fail' from the pre-open no-trade brief) are the cause.
import fs from "node:fs";
import { __test as barCloseTruth } from "../app/main/bar-close.js";

const truthFn = barCloseTruth.buildDeterministicPacketTruthFromInputs;
const RID = fs.readdirSync("state/backtest").find((d) => d.endsWith("2026-06-24"));
const live = fs.readFileSync("state/session/2026-06-24/ny-am/walker-inputs.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const tape = JSON.parse(fs.readFileSync(`state/backtest/${RID}/ny-am/tape.json`, "utf8"));

// live context by event ts (for injection into C)
const liveCtxByTs = new Map();
for (const e of live) { const ts = e.event?.ts ?? e.ts; if (ts) liveCtxByTs.set(ts, { ltf: e.inputs?.ltf_bias_context, ss: e.inputs?.session_state }); }

async function fold(label, entries, mutate) {
  let walkers = [];
  const setups = new Set();
  for (const e of entries) {
    const inputs = mutate ? mutate(structuredClone(e.inputs), e.event) : e.inputs;
    if (!inputs) continue;
    let truth;
    try { truth = await truthFn({ inputs, previousWalkers: walkers, event: e.event, session: "ny-am" }); }
    catch (err) { continue; }
    walkers = truth?.walkers ?? walkers;
    if (truth?.bestPacket && truth?.surfacePayload) setups.add(truth.surfacePayload.id ?? `${truth.surfacePayload.model}-${truth.surfacePayload.entry}`);
  }
  console.log(`${label}: distinct setups = ${setups.size}`);
  for (const s of setups) console.log("   -", s);
  return setups.size;
}

console.log(`run-id ${RID}\nlive bars ${live.length} | tape bars ${tape.entries.length}\n`);
await fold("A) LIVE inputs as-is        ", live, null);
await fold("B) BACKTEST tape as-is      ", tape.entries, null);
await fold("C) BACKTEST tape + live ctx ", tape.entries, (inp, ev) => {
  const lc = liveCtxByTs.get(ev?.ts);
  if (lc?.ltf) inp.ltf_bias_context = lc.ltf;
  if (inp.session_state?.pillar1) inp.session_state.pillar1.status = "pass";
  return inp;
});
process.exit(0);
