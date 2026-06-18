// Fold EVERY recorded live session through runBacktest with the current code.
// The live walker-inputs.jsonl is the faithful per-bar record of what the live
// chain actually saw — unlike same-day backtest replays, which recompute the
// engine and surface setups at different bars. Run this old-vs-new (git stash)
// to measure a change's real impact across all live data.
//
// Usage: node scripts/fold-live-corpus.mjs [stateSessionDir]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";
import { buildTapeFromRecords } from "../cli/lib/day-tape.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";

// Defaults to this checkout's state/session; pass an absolute dir to fold a
// different checkout's live data (e.g. the main checkout's, when running from a
// worktree whose own state/session is empty).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SS = process.argv[2] || path.join(REPO_ROOT, "state", "session");
const jsonl = (p) => fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

function sessionsWithInputs() {
  const out = [];
  for (const date of fs.readdirSync(SS).filter((d) => /^2026-/.test(d)).sort()) {
    for (const session of ["london", "ny-am", "ny-pm"]) {
      const dir = path.join(SS, date, session);
      if (fs.existsSync(path.join(dir, "walker-inputs.jsonl")) && fs.statSync(path.join(dir, "walker-inputs.jsonl")).size > 0) {
        out.push({ date, session, dir });
      }
    }
  }
  return out;
}

async function foldOne({ date, session, dir }) {
  const records = jsonl(path.join(dir, "walker-inputs.jsonl"));
  const packets = fs.existsSync(path.join(dir, "deterministic-packets.jsonl")) ? jsonl(path.join(dir, "deterministic-packets.jsonl")) : [];
  const tape = buildTapeFromRecords(records, { fixture: `${date}-${session}`, date, session, packets });

  const bundle = JSON.parse(fs.readFileSync(path.join(dir, "brief-bundle.json"), "utf8"));
  let leader = "MNQ1!";
  try { const b = JSON.parse(fs.readFileSync(path.join(dir, "brief.json"), "utf8")); if (b?.symbol) leader = b.symbol; } catch { /* default */ }
  if (!bundle.brief_digest) bundle.brief_digest = buildBriefDigest({ pair: { symbols: bundle?.pair?.symbols ?? { [leader]: bundle } } });
  const payloads = buildDirectSessionBriefPayloads({ session, bundle, symbols: [leader] });
  const context = contextFromBriefPayloads({ session, payloads });

  const bus = new EventEmitter();
  const deps = {
    recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => context,
    truthFn: barCloseTruth.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };
  const { summary } = await runBacktest({ date, session, mode: "auto", bus, stateDir: "/tmp/fold-live-corpus", deps });
  return {
    leader,
    bias: context?.session_state?.pillar1?.htfBias ?? "?",
    interaction: summary.open_reaction?.interaction ?? "-",
    r: summary.total_r ?? 0,
    wl: `${summary.wins}/${summary.losses}`,
    halted: summary.session_halted ? "HALT" : "",
  };
}

const rows = sessionsWithInputs();
let total = 0;
console.log("DATE       SESS    LEADER  BIAS     INTERACTION       W/L   HALT   R");
for (const s of rows) {
  try {
    const o = await foldOne(s);
    total += o.r;
    console.log(`${s.date} ${s.session.padEnd(6)} ${o.leader.padEnd(6)} ${String(o.bias).padEnd(8)} ${String(o.interaction).padEnd(16)} ${o.wl.padEnd(5)} ${o.halted.padEnd(5)} ${o.r}`);
  } catch (e) {
    console.log(`${s.date} ${s.session.padEnd(6)} ERROR: ${e.message}`);
  }
}
console.log(`\nTOTAL R across ${rows.length} live sessions: ${Math.round(total * 100) / 100}`);
