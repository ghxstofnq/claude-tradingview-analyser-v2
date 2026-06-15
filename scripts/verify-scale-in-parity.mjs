// scripts/verify-scale-in-parity.mjs — read-only rule-level parity check.
// For every recorded backtest run, walk its setups.jsonl in order and assert
// the ported scale-in-rules agree with what the backtest recorded:
//   • every open row flagged scale_in_add:true → our canScaleInto returns true
//     (same side, not a 10-min duplicate), given the anchor was green-lit
//     (the backtest only opened adds when green-lit, so we assume it here).
//   • every dedup_skipped row → our canScaleInto returns false (it's a dup).
// Full bar-by-bar parity (including the green-light timing) is the day-tape
// gate's job; this proves the rule logic matches on the real corpus.
//
// Corpus root: TV_CORPUS_DIR env, else ./state/backtest.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { canScaleInto, isNearDuplicate } from "../cli/lib/scale-in-rules.js";

const root = process.env.TV_CORPUS_DIR || "state/backtest";
if (!existsSync(join(root, "index.json"))) {
  console.error(`no corpus index at ${join(root, "index.json")} — set TV_CORPUS_DIR`);
  process.exit(2);
}
const idx = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
const runs = Array.isArray(idx) ? idx : (idx.runs || Object.values(idx));

let expectedAdds = 0, addAgree = 0, dedupSeen = 0, dedupAgree = 0, mismatches = 0, runsSeen = 0;

for (const r of runs) {
  const id = r.runId || r.id || r.run_id; const session = r.session; if (!id) continue;
  const p = [join(root, id, session || "", "setups.jsonl"), join(root, id, "setups.jsonl")].find(existsSync);
  if (!p) continue;
  runsSeen++;
  const rows = readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  // Fold opens + outcomes in chronological order so the "anchor" is the oldest
  // CURRENTLY-open trade (mirrors the backtest's openTrades[0]). A run can have
  // several anchor sequences in a day (one stops, a new one opens, adds ride
  // the survivor) — treating the first open as THE anchor is wrong for those.
  const evStream = rows
    .filter((x) => (x.type === "open" || x.type === "outcome") && x.event_ts)
    .map((x) => ({ ...x, _ms: Date.parse(x.event_ts), _p: x.type === "open" ? 0 : 1 }))
    .sort((a, b) => (a._ms - b._ms) || (a._p - b._p));

  const openTranches = []; // {id, side, entry, tp1}
  const takenLog = [];     // cumulative, never shrinks (backtest dedup basis)

  for (const ev of evStream) {
    if (ev.type === "outcome") {
      const i = openTranches.findIndex((t) => t.id === ev.setup_id);
      if (i >= 0) openTranches.splice(i, 1);
      continue;
    }
    // open
    if (ev.scale_in_add) {
      expectedAdds++;
      const anchor = openTranches[0] ? { ...openTranches[0], greenLight: true } : null;
      const ok = anchor && canScaleInto({ anchor, setup: ev, openCount: openTranches.length, takenLog, maxAdds: 99 });
      if (ok) addAgree++; else { mismatches++; console.error(`MISMATCH add not accepted: run ${id} ${ev.event_ts} (anchor=${anchor?.side ?? "none"})`); }
    }
    openTranches.push({ id: ev.id, side: ev.side, entry: Number(ev.entry), tp1: Number(ev.tp1) });
    takenLog.push({ side: ev.side, tp1: Number(ev.tp1), ms: Date.parse(ev.event_ts) });
  }

  // dedup_skipped rows: we must agree they are duplicates (when fields present).
  for (const d of rows.filter((x) => x.type === "dedup_skipped")) {
    if (!d.side || !d.event_ts) continue;
    dedupSeen++;
    const isDup = isNearDuplicate({ side: d.side, event_ts: d.event_ts }, takenLog);
    if (isDup) dedupAgree++; else { mismatches++; console.error(`MISMATCH dedup not flagged: run ${id} ${d.event_ts}`); }
  }
}

console.log(`runs: ${runsSeen}`);
console.log(`scale_in_add rows: ${expectedAdds} · agreed: ${addAgree}`);
console.log(`dedup_skipped rows (with fields): ${dedupSeen} · agreed: ${dedupAgree}`);
console.log(mismatches === 0 ? "PARITY OK (rule-level)" : `PARITY MISMATCH: ${mismatches}`);
process.exit(mismatches === 0 ? 0 : 1);
