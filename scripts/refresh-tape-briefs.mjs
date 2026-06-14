#!/usr/bin/env node
// Re-record the brief-derived fields in recorded tapes from the CURRENT brief.
//
// Tapes bake market/engine data (good) AND brief-derived fields (untaken_targets,
// session_state) captured at record time. After a brief-code change those fields
// go stale — the June-13 tapes carried the old malformed overnight_block (wrong-
// side targets) and the pre-§2.1 bias ("draw above price → bullish"), so any
// direct reader of the raw tape saw a system that no longer runs. The refold-gate
// already regenerates the brief from the bundle (self-healing), so this script is
// about keeping the RAW tape files honest for every other reader (debug-fold, the
// popover replay, future inspection).
//
// Only brief-derived fields are touched: inputs.bundle (market/engine) and the
// recorded OHLC are preserved, so the verified frozen baseline does not move.
//
//   node scripts/refresh-tape-briefs.mjs            # refresh every run with a bundle
//   node scripts/refresh-tape-briefs.mjs --dry-run  # report what would change

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BT_ROOT = path.join(REPO_ROOT, "state", "backtest");
const dryRun = process.argv.includes("--dry-run");

function sessionOf(dir) {
  if (dir.endsWith("ny-pm")) return "ny-pm";
  if (dir.endsWith("ny-am")) return "ny-am";
  return null;
}

let refreshed = 0;
let skipped = 0;
for (const runId of fs.existsSync(BT_ROOT) ? fs.readdirSync(BT_ROOT) : []) {
  for (const sess of ["ny-am", "ny-pm"]) {
    const dir = path.join(BT_ROOT, runId, sess);
    const tapePath = path.join(dir, "tape.json");
    const bundlePath = path.join(dir, "brief-bundle.json");
    const payloadsPath = path.join(dir, "brief-payloads.json");
    if (!fs.existsSync(tapePath) || !fs.existsSync(bundlePath) || !fs.existsSync(payloadsPath)) continue;

    const session = sessionOf(dir);
    const recorded = JSON.parse(fs.readFileSync(payloadsPath, "utf8"));
    const leader = recorded[0]?.symbol || "MNQ1!";
    const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
    const digest = buildBriefDigest({ pair: { symbols: { [leader]: bundle } } });
    const payloads = buildDirectSessionBriefPayloads({ session, bundle: { ...bundle, brief_digest: digest }, symbols: [leader] });
    const ctx = contextFromBriefPayloads({ session, payloads });
    if (!ctx) { skipped++; continue; }

    const oldBelow = JSON.stringify((recorded[0]?.overnight_block?.untaken_below || []).map((l) => l.name));
    const newBelow = JSON.stringify((payloads[0]?.overnight_block?.untaken_below || []).map((l) => l.name));
    const oldBias = recorded[0]?.htf_bias_dir;
    const newBias = payloads[0]?.htf_bias_dir;

    if (dryRun) {
      if (oldBelow !== newBelow || oldBias !== newBias) {
        console.log(`${runId}/${session}: below ${oldBelow} -> ${newBelow} | bias ${oldBias} -> ${newBias}`);
      }
      continue;
    }

    // 1. brief-payloads.json -> current brief.
    fs.writeFileSync(payloadsPath, JSON.stringify(payloads, null, 2));
    // 2. tape.json inputs -> current brief-derived context fields (market data kept).
    const tape = JSON.parse(fs.readFileSync(tapePath, "utf8"));
    for (const entry of tape.entries ?? []) {
      if (!entry.inputs) continue;
      entry.inputs.untaken_targets = ctx.untaken_targets;
      entry.inputs.session_state = ctx.session_state;
    }
    fs.writeFileSync(tapePath, JSON.stringify(tape));
    refreshed++;
    console.log(`refreshed ${runId}/${session}: below ${oldBelow} -> ${newBelow} | bias ${oldBias} -> ${newBias}`);
  }
}
console.log(`\n${dryRun ? "(dry run) " : ""}refreshed ${refreshed} run(s), skipped ${skipped}`);
