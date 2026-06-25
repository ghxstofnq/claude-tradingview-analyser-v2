// fold-pair-leader.mjs — corpus-first validation for the faithful pair-leader.
//
// Per paired session (MNQ tape + MES tape) it folds each symbol's tape through
// the SAME deterministic chain, forward-sims the resulting packet to a realized
// R, computes the open-window leader two ways (displacement = compute-leader.js,
// divergence = smt-leader.js), and compares three arms:
//   - always-MNQ (baseline)
//   - displacement-leader (the faithful relative-strength pick — DB 36:32/37:28)
//   - divergence-SMT (the current live pick — expected ~baseline, inert)
//
// Design: docs/superpowers/specs/2026-06-25-faithful-pair-leader-design.md §6.
// One session is anecdotal — read the TOTALS once the corpus has ≥5 paired weeks.
// No chart, no live wiring; pure fold over recorded tapes.
//
// Usage: node scripts/fold-pair-leader.mjs

import fs from "node:fs";
import { foldTape } from "../cli/lib/day-tape.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";
import { computeLeader } from "../cli/lib/compute-leader.js";
import { computeSmtLeader } from "../cli/lib/smt-leader.js";

const truthFn = barCloseTruth.buildDeterministicPacketTruthFromInputs;
const PRIMARY = "MNQ1!";
const SECONDARY = "MES1!";

// Paired sessions. The Stage-G dates are MNQ-led (Lanto traded NQ) — they test
// "displacement doesn't break MNQ days". The lanto_pick dates are days Lanto
// explicitly traded ES (from his Discord) — they test "displacement correctly
// SWITCHES to MES". lanto_pick = his actual instrument+direction that session.
const SESSIONS = [
  // Stage-G (MNQ-led)
  { date: "2026-06-16", mnq: "tests/tapes/2026-06-16-ny-am-replay.tape.json", mes: "tests/tapes/2026-06-16-mes-ny-am-replay.tape.json", lanto_pick: "MNQ short" },
  { date: "2026-06-09", mnq: "tests/tapes/2026-06-09-ny-am-replay.tape.json", mes: "tests/tapes/2026-06-09-mes-ny-am-replay.tape.json", lanto_pick: "MNQ short" },
  { date: "2026-06-17", mnq: "tests/tapes/2026-06-17-ny-am-replay.tape.json", mes: "tests/tapes/2026-06-17-mes-ny-am-replay.tape.json", lanto_pick: "no-trade" },
  { date: "2026-06-18", mnq: "tests/tapes/2026-06-18-ny-am-replay.tape.json", mes: "tests/tapes/2026-06-18-mes-ny-am-replay.tape.json", lanto_pick: "MNQ long" },
  { date: "2026-02-09", mnq: "tests/tapes/2026-02-09-ny-am-replay.tape.json", mes: "tests/tapes/2026-02-09-mes-ny-am-replay.tape.json", lanto_pick: "MNQ long" },
  // ES-led (Lanto traded ES — the SWITCH test)
  { date: "2026-01-29", mnq: "tests/tapes/2026-01-29-ny-am-replay.tape.json", mes: "tests/tapes/2026-01-29-mes-ny-am-replay.tape.json", lanto_pick: "MES short (won, TP2 6879)" },
  { date: "2026-06-15", mnq: "tests/tapes/2026-06-15-ny-am-replay.tape.json", mes: "tests/tapes/2026-06-15-mes-ny-am-replay.tape.json", lanto_pick: "MES long (won +2R, tgt 7641)" },
  { date: "2026-04-06", mnq: "tests/tapes/2026-04-06-ny-am-replay.tape.json", mes: "tests/tapes/2026-04-06-mes-ny-am-replay.tape.json", lanto_pick: "MES long (b/e; ES led @10:12)" },
  { date: "2026-06-22", mnq: "tests/tapes/2026-06-22-ny-am-replay.tape.json", mes: "tests/tapes/2026-06-22-mes-ny-am-replay.tape.json", lanto_pick: "MES long (ES confirmed 4min before NQ)" },
];

const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);
const r2 = (n) => Math.round(n * 100) / 100;

// Realized R: forward-sim the packet against the tape's bars AFTER entry.
// tp1 hit = +planned-R, stop hit = −1R; conservative on an intra-bar straddle
// (assume stop first — mirrors backtest-grader.js); open at EOD = 0R.
function realizedR(tape, packet) {
  if (!packet) return { r: 0, result: "no_trade" };
  const entryMs = Date.parse(packet.event_ts);
  const { side, entry, stop, tp1 } = packet;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return { r: 0, result: "bad_stop" };
  const rr = r2(Math.abs(tp1 - entry) / risk);
  for (const e of tape.entries) {
    if (Date.parse(e.event.ts) <= entryMs) continue;
    const lb = e.inputs?.bundle?.bars?.last_5_bars;
    const bar = lb && lb[lb.length - 1];
    if (!bar) continue;
    const hitStop = side === "long" ? bar.low <= stop : bar.high >= stop;
    const hitTp = side === "long" ? bar.high >= tp1 : bar.low <= tp1;
    if (hitStop) return { r: -1, result: hitTp ? "stop_first(straddle)" : "stopped" };
    if (hitTp) return { r: rr, result: "tp1" };
  }
  return { r: 0, result: "open_eod" };
}

// Engine snapshot at/just before the open-window close — it contains every FVG
// created in the window, which is what the leader functions filter on.
function engineAtWindowEnd(tape, windowEndMs) {
  let best = null;
  for (const e of tape.entries) {
    if (Date.parse(e.event.ts) <= windowEndMs) best = e;
  }
  return best?.inputs?.bundle?.engine ?? null;
}

async function foldPacket(tape) {
  const outcome = await foldTape(tape, { truthFn });
  return outcome.firstPacket || null;
}

const rByLeader = (leader, rMnq, rMes) => (leader === SECONDARY ? rMes : rMnq);

async function run() {
  const arms = { always_mnq: 0, disp_leader: 0, smt_leader: 0 };
  const rows = [];
  for (const s of SESSIONS) {
    if (!exists(s.mnq) || !exists(s.mes)) { rows.push({ date: s.date, status: "MISSING tape (record MES)" }); continue; }
    const mnqTape = load(s.mnq);
    const mesTape = load(s.mes);
    // Open-reaction window = first 30 min from the session open (DST-agnostic —
    // derived from the tape's first bar, not a fixed UTC offset).
    const windowStartMs = Date.parse(mnqTape.entries[0].event.ts);
    const windowEndMs = windowStartMs + 30 * 60 * 1000;

    const [pMnq, pMes] = [await foldPacket(mnqTape), await foldPacket(mesTape)];
    const rMnq = realizedR(mnqTape, pMnq);
    const rMes = realizedR(mesTape, pMes);

    const args = {
      primary: PRIMARY, secondary: SECONDARY,
      primaryEngine: engineAtWindowEnd(mnqTape, windowEndMs),
      secondaryEngine: engineAtWindowEnd(mesTape, windowEndMs),
      windowStartMs, windowEndMs,
    };
    const disp = computeLeader(args);
    const smt = computeSmtLeader({ ...args, context: "auto" });
    const dispLeader = disp.leader || PRIMARY;     // fallback MNQ when inconclusive
    const smtLeader = smt.leader || PRIMARY;

    arms.always_mnq += rMnq.r;
    arms.disp_leader += rByLeader(dispLeader, rMnq.r, rMes.r);
    arms.smt_leader += rByLeader(smtLeader, rMnq.r, rMes.r);

    rows.push({
      date: s.date,
      lanto: s.lanto_pick || "?",
      mnq: pMnq ? `${pMnq.model} ${pMnq.side} ${pMnq.grade} → ${rMnq.r}R (${rMnq.result})` : "no_trade",
      mes: pMes ? `${pMes.model} ${pMes.side} ${pMes.grade} → ${rMes.r}R (${rMes.result})` : "no_trade",
      disp_leader: `${dispLeader.replace("1!", "")} (${disp.reason})`,
      smt_leader: `${smtLeader.replace("1!", "")} (${smt.reason})`,
    });
  }

  console.log("=== PAIR-LEADER FOLD ===\n");
  for (const row of rows) {
    if (row.status) { console.log(`${row.date}: ${row.status}`); continue; }
    const want = row.lanto.startsWith("MES") ? "MES" : row.lanto.startsWith("MNQ") ? "MNQ" : null;
    const got = row.disp_leader.slice(0, 3);
    const match = want == null ? "(no-trade day)" : want === got ? "✓ matches Lanto" : `✗ MISS — Lanto picked ${want}`;
    console.log(`${row.date}  ·  Lanto: ${row.lanto}`);
    console.log(`  MNQ: ${row.mnq}`);
    console.log(`  MES: ${row.mes}`);
    console.log(`  disp-leader → ${row.disp_leader}  ${match}`);
    console.log(`  smt-leader  → ${row.smt_leader}\n`);
  }
  const n = rows.filter((r) => !r.status).length;
  console.log(`=== ARM TOTALS (${n} paired session${n === 1 ? "" : "s"}) ===`);
  console.log(`  always-MNQ      : ${r2(arms.always_mnq)}R`);
  console.log(`  displacement    : ${r2(arms.disp_leader)}R`);
  console.log(`  divergence-SMT  : ${r2(arms.smt_leader)}R`);
  console.log(`\n  (anecdotal until ≥5 paired sessions — read the trend, not one row)`);
}

run();
