// Scope the fix: trace the ONE confirmed zone [7065-7067] across 01-29 MES.
// Does it tap on a SEPARATE bar (gap-selection alone fixes it) or tap+confirm in
// one bar / never register a walker tap (tap->confirm alignment also needs fixing)?
import fs from "node:fs";
import { __test } from "../app/main/bar-close.js";
import { buildStrategyContext } from "../app/main/strategy/context/build-strategy-context.js";
import { inversionEntryValid } from "../app/main/strategy/walkers/inversion-lifecycle.js";
import { isValidConfirmationForSide } from "../app/main/strategy/walkers/lifecycle-utils.js";

const { buildDeterministicPacketTruthFromInputs, buildStrategyBundleForRuntime } = __test;
const tape = JSON.parse(fs.readFileSync("tests/tapes/2026-01-29-mes-ny-am-replay.tape.json", "utf8"));
const session = "ny-am";
const est = (iso) => { const d = new Date(iso); return `${String((d.getUTCHours() + 19) % 24).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const near = (a, b, tol = 1.0) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < tol;
const isZone = (z) => near(Number(z?.bottom ?? z?.zone_bottom), 7065) && near(Number(z?.top ?? z?.zone_top), 7067);

let walkers = [];
console.log("EST    close   | engine: entry_state entered_ms>0 bars_in_zone confirm_ms>0 | walker tap(insidePD)? stage");
for (const entry of tape.entries) {
  const utc = entry.event.ts;
  const t = est(utc);
  if (t < "09:50" || t > "10:30") continue;
  const inputs = entry.inputs;
  const event = { ts: utc, tf: entry.event.tf };
  const bundle = buildStrategyBundleForRuntime(inputs, event, session);
  const ctx = buildStrategyContext(bundle);
  const truth = buildDeterministicPacketTruthFromInputs({ inputs, previousWalkers: walkers, event, session });
  walkers = truth.walkers ?? walkers;

  const close = Number(inputs?.bundle?.bars?.last_5_bars?.slice(-1)[0]?.close);
  const fvg = (ctx?.pillar3?.pdArrays ?? ctx?.pillar3?.fvgs ?? []).find(isZone);
  const insidePD = (ctx?.pillar3?.insidePdArrays ?? ctx?.pillar3?.inside_pd_arrays ?? []).some(isZone);
  const w = (walkers ?? []).find((x) => { const pd = x?.evidence?.pdArray?.rawPayload ?? {}; return isZone(pd); });

  const eng = fvg
    ? `state=${fvg.entry_state ?? "?"} entered=${Number(fvg.entered_ms) > 0} barsIn=${fvg.bars_in_zone ?? "?"} confirm=${Number(fvg.confirm_ms) > 0}`
    : "(zone not in fvgs this bar)";
  console.log(`${t}  ${String(close).padEnd(7)} | ${eng.padEnd(56)} | tap=${insidePD}  ${w ? `${w.model} stage=${w.stage}` : "(no walker)"}`);
  if (insidePD && w) {
    const insideRefs = (ctx?.pillar3?.insidePdArrays ?? ctx?.pillar3?.inside_pd_arrays ?? []).filter(isZone).map((r) => r.evidenceRef ?? r.cite ?? r.id ?? JSON.stringify(Object.keys(r)));
    console.log(`        walker.pdArrayRef=${w.pdArrayRef}   insidePD row refs=${JSON.stringify(insideRefs)}`);
  }
  // Evaluate the inversion confirm conditions on the violating-close bar (close < zone).
  if (w && w.model === "Inversion" && Number.isFinite(close) && close < 7065) {
    const rows = ctx?.pillar3?.confirmationRows ?? [];
    const cr = rows.find((r) => ["bear", "bearish"].includes(r?.confirm_dir ?? r?.direction)) ?? rows[0];
    const validConf = cr ? isValidConfirmationForSide(cr, "short", { requireBody: false }) : false;
    const gate = inversionEntryValid({ context: ctx, side: "short", entryPrice: close, nowMs: Date.parse(utc) });
    const zfvg = (ctx?.pillar3?.pdArrays ?? ctx?.pillar3?.fvgs ?? []).find(isZone);
    console.log(`        >>> [${t}] violating close=${close} < zone bottom 7065`);
    console.log(`        >>> validConfRow=${validConf} (confRow: ${cr ? `dir=${cr.confirm_dir} state=${cr.entry_state} closeThru=${close < 7065} invMs=${zfvg?.inverted_ms}` : "none"})`);
    console.log(`        >>> inversionEntryValid=${gate.valid} kind=${gate.kind} reason=${gate.reason} depth=${gate.depth?.toFixed?.(2)} (legHi=${ctx?.pillar2?.legHigh} legLo=${ctx?.pillar2?.legLow})`);
    console.log(`        >>> sweeps=${(ctx?.pillar3?.sweeps ?? []).length} structuresSwing=${(ctx?.pillar3?.structuresSwing ?? []).length} coherence=${ctx?.pillar2?.coherence}`);
  }
}
