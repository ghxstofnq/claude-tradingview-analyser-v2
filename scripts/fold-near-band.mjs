#!/usr/bin/env node
// Calibration fold for the HTF-draw near-price band (GOFNQ_NEAR_PRICE_PCT).
// Re-derives each run's brief FROM brief-bundle.json (so the draw is re-picked
// under the current band) and folds the recorded tape. Run once per band:
//   GOFNQ_NEAR_PRICE_PCT=0.003 node scripts/fold-near-band.mjs
//   GOFNQ_NEAR_PRICE_PCT=0.005 node scripts/fold-near-band.mjs
//   GOFNQ_NEAR_PRICE_PCT=0.007 node scripts/fold-near-band.mjs
// Days with no tape (skipped at record time) can't be folded here — they need a
// tape recorded first; this measures the band's effect on the days we DO have.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { NEAR_PRICE_PCT } from "../cli/lib/pillar1-bias.js";

const BT = path.join(process.cwd(), "state", "backtest");
const SYMBOL = "MNQ1!";

function reDeriveContext(runDir, session, symbol) {
  let bundle;
  try { bundle = JSON.parse(fs.readFileSync(path.join(runDir, "brief-bundle.json"), "utf8")); } catch { return null; }
  if (!bundle.brief_digest) {
    try { bundle.brief_digest = buildBriefDigest({ pair: { symbols: { [symbol]: bundle } } }); } catch { return null; }
  }
  let payloads;
  try { payloads = buildDirectSessionBriefPayloads({ session, bundle, symbols: [symbol] }); } catch { return null; }
  const lead = (Array.isArray(payloads) ? payloads : [payloads]).find((p) => p?.primary_draw) ?? null;
  return { context: contextFromBriefPayloads({ session, payloads }), drawPct: lead?.primary_draw ? distPct(lead.primary_draw, bundle) : null };
}
function distPct(draw, bundle) {
  const price = bundle?.quote?.last ?? bundle?.pair?.symbols?.[SYMBOL]?.quote?.last;
  return Number.isFinite(price) && Number.isFinite(draw?.ce) ? Math.abs(draw.ce - price) / Math.abs(price) : null;
}

async function foldTape(tape, context, date, session) {
  const bus = new EventEmitter();
  const deps = {
    recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => context,
    truthFn: barCloseTruth.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "fold-nb-"));
  try {
    const { summary } = await runBacktest({ date: tape.date ?? date, session, mode: "auto", bus, stateDir: sd, deps });
    return summary;
  } finally { fs.rmSync(sd, { recursive: true, force: true }); }
}

const dirs = fs.readdirSync(BT).filter((d) => /^2026.*am-2026/.test(d) && !fs.lstatSync(path.join(BT, d)).isSymbolicLink()).sort();
let total = 0, n = 0, traded = 0, noDraw = 0;
console.log(`band = ${(NEAR_PRICE_PCT * 100).toFixed(2)}%  (GOFNQ_NEAR_PRICE_PCT=${process.env.GOFNQ_NEAR_PRICE_PCT ?? "unset"})`);
for (const d of dirs) {
  const session = "ny-am";
  const runDir = path.join(BT, d, session);
  if (!fs.existsSync(path.join(runDir, "tape.json"))) continue;
  let tape;
  try { tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8")); } catch { continue; }
  if (!tape?.entries?.length) continue;
  const sym = tape.entries[0]?.inputs?.leader;
  if (sym !== SYMBOL) continue;
  const date = (d.match(/am-(2026-\d\d-\d\d)/) || [])[1];
  const { context, drawPct } = reDeriveContext(runDir, session, SYMBOL) ?? {};
  if (!context) { noDraw += 1; console.log(`${date}  no-draw (band re-derive → null context)`); continue; }
  const s = await foldTape(tape, context, date, session);
  total += s.total_r || 0; n += 1; traded += 1;
  console.log(`${date}  R=${(s.total_r || 0).toFixed(2)}  setups=${s.setups}  drawDist=${drawPct != null ? (drawPct * 100).toFixed(2) + "%" : "-"}`);
}
console.log(`\nTOTAL ${total.toFixed(2)}R  traded=${traded}  no-draw=${noDraw}  (folded ${n} tapes)`);
