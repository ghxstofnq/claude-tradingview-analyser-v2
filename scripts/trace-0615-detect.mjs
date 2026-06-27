// Detection-gap trace: WHY does the chain have no LONG inversion candidate at
// Lanto's 06-15 10:30 entry? Lanto: "1m bearish gap -> bullish inversion gap, stop
// relative low" (a bearish FVG reclaimed bullish ~10:30). For each bar 10:20-10:40,
// print the bull confirmation rows, the active LONG inversion walkers + stages +
// tracked zones, and the 3 confirm conditions on any long walker. Tells me whether
// it's a SPAWN gap (no bearish-FVG walker) or a CONFIRM gap (walker exists, fails).
import fs from "node:fs";
import { __test } from "../app/main/bar-close.js";
import { buildStrategyContext } from "../app/main/strategy/context/build-strategy-context.js";
import {
  isValidConfirmationForSide,
  allPdArrays,
  activeModelWalkers,
} from "../app/main/strategy/walkers/lifecycle-utils.js";

const { buildDeterministicPacketTruthFromInputs, buildStrategyBundleForRuntime } = __test;
const tape = JSON.parse(fs.readFileSync(process.argv[2] ?? "/tmp/2026-06-15-mes-v5.tape.json", "utf8"));
const session = "ny-am";
const est = (iso) => { const d = new Date(iso); return `${String((d.getUTCHours() + 24 - 4) % 24).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const lo = process.argv[3] ?? "10:18", hi = process.argv[4] ?? "10:40";

let walkers = [];
for (const entry of tape.entries) {
  const utc = entry.event.ts;
  const t = est(utc);
  const inputs = entry.inputs;
  const event = { ts: utc, tf: entry.event.tf };
  const truth = buildDeterministicPacketTruthFromInputs({ inputs, previousWalkers: walkers, event, session });
  const nextWalkers = truth.walkers ?? walkers;
  if (t < lo || t > hi) { walkers = nextWalkers; continue; }

  const bundle = buildStrategyBundleForRuntime(inputs, event, session);
  const ctx = buildStrategyContext(bundle);
  const close = Number(inputs?.bundle?.bars?.last_5_bars?.slice(-1)[0]?.close);
  const rows = ctx?.pillar3?.confirmationRows ?? [];
  const bullRows = rows.filter((r) => ["bull", "bullish"].includes(r?.confirm_dir ?? r?.direction ?? r?.dir));
  // ALL confirmation rows (any dir) — what does the engine/bridge actually emit?
  for (const r of rows) {
    console.log(`   [confirmRow] dir=${r.confirm_dir ?? r.direction} state=${r.entry_state} cclose=${r.confirm_close} confirm_ms=${r.confirm_ms} zone=[${r.zone_bottom ?? r.bottom}-${r.zone_top ?? r.top}] close=${r.close ?? r.price}`);
  }
  // bearish FVGs in the book (long-inversion spawn candidates: a bear FVG reclaimed = bullish inversion)
  const bearFvgs = allPdArrays(ctx).map((r) => r?.rawPayload ?? r).filter((r) => ["bear", "bearish"].includes(r?.dir ?? r?.direction) && /fvg/i.test(String(r?.kind)));
  const longWalkers = activeModelWalkers(walkers, "Inversion").filter((w) => w.side === "long");

  console.log(`\n${t} close=${close} | bullConfirmRows=${bullRows.length} bearFVGs=${bearFvgs.length} longInvWalkers=${longWalkers.length}`);
  for (const r of bullRows) {
    const zb = r?.zone_bottom ?? r?.bottom, zt = r?.zone_top ?? r?.top;
    console.log(`   bullConfirm zone[${zb}-${zt}] state=${r.entry_state} cclose=${r.confirm_close} ce=${r.ce_held} chop=${r.chop_15m} close=${r.close ?? r.price} validLong=${isValidConfirmationForSide(r, "long", { requireBody: false })}`);
  }
  for (const w of longWalkers) {
    const pd = w?.evidence?.pdArray?.rawPayload ?? {};
    console.log(`   longWalker stage=${w.stage} zone=[${pd.bottom}-${pd.top}] state=${pd.state} inverted_ms=${pd.inverted_ms ?? "-"}`);
  }
  if (longWalkers.length === 0 && bearFvgs.length > 0) {
    console.log(`   (no long inversion walker despite ${bearFvgs.length} bear FVGs — zones near price:`);
    for (const f of bearFvgs.filter((f) => Math.abs(((Number(f.top) + Number(f.bottom)) / 2) - close) < 15).slice(0, 4)) {
      console.log(`        bearFVG [${f.bottom}-${f.top}] state=${f.state} took_liq=${f.took_liq} disp=${f.disp_score})`);
    }
  }
}
