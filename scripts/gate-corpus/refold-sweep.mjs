#!/usr/bin/env node
// Gate-corpus refold sweep: re-fold every recorded corpus tape offline under a
// selectable context mode and aggregate outcomes. No chart access; seconds per
// session. Run with a clean env (env -u NODE_OPTIONS) when launched from a
// Claude session.
//
//   node scripts/gate-corpus/refold-sweep.mjs --mode baseline
//   node scripts/gate-corpus/refold-sweep.mjs --mode p2-unfrozen
//
// Modes:
//   baseline     — identical semantics to the recording (validation: aggregate
//                  must reproduce the recorded summaries).
//   p2-unfrozen  — the pre-open pillar2 verdict no longer hard-blocks the day:
//                  pillar2_poor days build a real context (lean fallback
//                  allowed) and pillar2.status is forced 'pass' (verdict kept).
//                  The walkers' own per-bar quality gate remains in force.
//                  Measures the cost of the unfolded 2026-07-02
//                  pillar2_prep_blocked freeze.

import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../../app/main/backtest-context.js";
import { gradeOpenTrade } from "../../app/main/backtest-grader.js";
import { __test as barCloseTruth } from "../../app/main/bar-close.js";
import { pillar2Verdict } from "../../cli/lib/pillar2-verdict.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");

const argIdx = process.argv.indexOf("--mode");
const MODE = argIdx >= 0 ? process.argv[argIdx + 1] : "baseline";
if (["lean-only", "unfrozen-lean", "p2-fixed"].includes(MODE)) process.env.GOFNQ_P1_LEAN_ONLY = "1";
if (!["baseline", "p2-unfrozen", "rejection-window", "leg-origin", "lean-only", "unfrozen-lean", "p2-fixed"].includes(MODE)) {
  console.error("--mode must be baseline | p2-unfrozen | rejection-window | leg-origin");
  process.exit(2);
}

// Lever folds: the tapes dual-emit both worlds (docs/gate-corpus-manifest.md),
// so a lever fold just swaps which field the evidence presents at every read
// path before folding. No production code involved.
function transformEntries(entries) {
  if (MODE !== "rejection-window" && MODE !== "leg-origin") return entries;
  for (const e of entries) {
    const b = e?.inputs?.bundle;
    if (!b) continue;
    const engines = [b.engine, b.gates?.engine].filter(Boolean);
    if (MODE === "rejection-window") {
      const sweepSets = [
        b.engine?.sweeps,
        b.gates?.engine?.pillar1?.sweeps,
      ];
      for (const set of sweepSets) {
        if (!Array.isArray(set)) continue;
        for (const s of set) {
          if (s && s.rejected_rw !== undefined) s.rejected = s.rejected_rw;
        }
      }
    } else {
      const qs = [
        b.engine?.quality,
        b.gates?.engine?.pillar2?.current_tf,
      ];
      for (const q of qs) {
        if (!q || q.leg_high_org === undefined) continue;
        q.leg_high = q.leg_high_org;
        q.leg_low = q.leg_low_org;
        q.leg_high_ms = q.leg_high_org_ms;
        q.leg_low_ms = q.leg_low_org_ms;
      }
    }
  }
  return entries;
}

const index = JSON.parse(fs.readFileSync(path.join(REPO, "state", "backtest", "index.json"), "utf8"));
const runs = (index.runs ?? []).filter((r) => (r.bars ?? 0) >= 20);

// p2-fixed: the corpus proved pillar2_verdict is a broken constant — 477/478
// sessions grade "poor" because the m5/m15 range tight-veto uses Pine's
// 10xATR threshold, which is calibrated on the 1m row (~0.3% of price) but
// demands 600-925 MNQ points on m15. Recompute the verdict with m5/m15
// range_quality REPLACED by the 1m row's (calibrated) read, preserving the
// module's coherence-primary design, and rebuild the context from the
// corrected payload (un-skips the lean fallback; pillar2.status follows).
function correctedVerdict(bundle) {
  const q1 = bundle?.engine?.quality ?? {};
  const tf = bundle?.engine_by_tf ?? {};
  const fix = (row) => (row ? { ...row, range_quality: q1.range_quality ?? row.range_quality } : row);
  return pillar2Verdict({ m5: fix(tf.m5?.quality), m15: fix(tf.m15?.quality), current_tf: q1 });
}

function buildContextForMode(session, payloads, bundle) {
  if (MODE === "baseline" || MODE === "rejection-window" || MODE === "leg-origin" || MODE === "lean-only") return contextFromBriefPayloads({ session, payloads });
  if (MODE === "p2-fixed") {
    const v = bundle ? correctedVerdict(bundle) : null;
    const fixed = payloads.map((p) => {
      if (!p || !v) return p;
      const q = { ...p, pillar2_verdict: v.verdict };
      if (q.pillar_grade === "no-trade" && q.no_trade_reason === "pillar2_poor" && v.verdict !== "poor") {
        q.no_trade_reason = "open_unconfirmed";
      }
      return q;
    });
    return contextFromBriefPayloads({ session, payloads: fixed });
  }
  // p2-unfrozen: allow pillar2_poor days into the lean fallback by swapping the
  // skip-listed reason for a non-skip one (everything else on the payload —
  // draw, bias, pillar2_verdict — is untouched), then force pillar2.status pass.
  const relaxed = payloads.map((p) =>
    p?.pillar_grade === "no-trade" && p?.no_trade_reason === "pillar2_poor"
      ? { ...p, no_trade_reason: "open_unconfirmed" }
      : p);
  const ctx = contextFromBriefPayloads({ session, payloads: relaxed });
  if (ctx?.session_state?.pillar2) ctx.session_state.pillar2.status = "pass";
  return ctx;
}

const out = [];
let done = 0;
for (const r of runs) {
  const rid = r.run_id ?? r.id;
  const sym = r.symbol ?? "MNQ1!";
  const dir = path.join(REPO, "state", "backtest", rid, r.session);
  let tape, payloads;
  try {
    tape = JSON.parse(fs.readFileSync(path.join(dir, "tape.json"), "utf8"));
    payloads = JSON.parse(fs.readFileSync(path.join(dir, "brief-payloads.json"), "utf8"));
  } catch (e) {
    out.push({ rid, sym, date: r.date, session: r.session, error: `load: ${e.message}` });
    continue;
  }
  const bus = new EventEmitter();
  const deps = {
    recordEntries: async () => ({ entries: transformEntries(tape.entries), warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => {
      let bundle = null;
      if (MODE === "p2-fixed") {
        try { bundle = JSON.parse(fs.readFileSync(path.join(dir, "brief-bundle.json"), "utf8")); } catch { /* verdict stays as recorded */ }
      }
      return buildContextForMode(r.session, payloads, bundle);
    },
    truthFn: barCloseTruth.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };
  try {
    const modeStateDir = path.join(REPO, "state", "backtest-refold", MODE);
    const { runId: refoldId, summary } = await runBacktest({
      date: tape.date, session: r.session, mode: "auto", bus,
      stateDir: modeStateDir, deps,
    });
    // The engine persists a full tape.json per run (~30MB); across a 478-run
    // sweep that is ~15GB of scratch — delete each run dir once we have the
    // summary (the sweep-<mode>.jsonl rows are the durable result).
    if (refoldId) fs.rmSync(path.join(modeStateDir, "backtest", refoldId), { recursive: true, force: true });
    out.push({
      rid, sym, date: r.date, session: r.session,
      chain: summary.chain_status, wins: summary.wins ?? 0, losses: summary.losses ?? 0,
      no_trades: summary.no_trades ?? 0, total_r: summary.total_r ?? 0,
      best_model: summary.best_model ?? null,
    });
  } catch (e) {
    out.push({ rid, sym, date: r.date, session: r.session, error: String(e.stack ?? e.message).slice(0, 400) });
  }
  done += 1;
  if (done % 50 === 0) console.error(`  ...${done}/${runs.length}`);
}

const resultPath = path.join(REPO, "state", "backtest-refold", `sweep-${MODE}.jsonl`);
fs.mkdirSync(path.dirname(resultPath), { recursive: true });
fs.writeFileSync(resultPath, out.map((o) => JSON.stringify(o)).join("\n") + "\n");

const agg = {};
for (const o of out) {
  if (o.error) { (agg.errors ??= []).push(`${o.sym} ${o.date} ${o.session}: ${o.error}`); continue; }
  const a = (agg[o.sym] ??= { sessions: 0, wins: 0, losses: 0, r: 0 });
  a.sessions += 1; a.wins += o.wins; a.losses += o.losses; a.r += o.total_r;
}
console.log(`\nmode=${MODE} → ${resultPath}`);
for (const sym of Object.keys(agg).filter((k) => k !== "errors").sort()) {
  const a = agg[sym];
  console.log(`${sym}: sessions=${a.sessions} trades=${a.wins + a.losses} (${a.wins}W/${a.losses}L) netR=${a.r.toFixed(2)}`);
}
if (agg.errors) console.log(`errors: ${agg.errors.length}\n  ` + agg.errors.slice(0, 5).join("\n  "));
