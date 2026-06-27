// One-off: trace WHY the chain no-traded 01-29 MES (Lanto shorted ES @10:28 EST,
// won). Replays the tape through the REAL pipeline (buildStrategyBundleForRuntime
// → buildStrategyContext → spawn builders + the deterministic truth fn), printing
// per bar around the entry: verdict, gates, and what each model's spawn-builder
// sees. 01-29 is January = EST (UTC-5).
import fs from "node:fs";
import { __test } from "../app/main/bar-close.js";
import { buildMssWalkerSpawnRequests } from "../app/main/strategy/walkers/mss-lifecycle.js";
import { buildTrendWalkerSpawnRequests } from "../app/main/strategy/walkers/trend-lifecycle.js";
import { buildInversionWalkerSpawnRequests } from "../app/main/strategy/walkers/inversion-lifecycle.js";
import { buildStrategyContext } from "../app/main/strategy/context/build-strategy-context.js";

const { buildDeterministicPacketTruthFromInputs, buildStrategyBundleForRuntime } = __test;
const tape = JSON.parse(fs.readFileSync("tests/tapes/2026-01-29-mes-ny-am-replay.tape.json", "utf8"));
const session = "ny-am";
const est = (iso) => { const d = new Date(iso); return `${String((d.getUTCHours() + 19) % 24).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

const n = (a) => (Array.isArray(a) ? a.length : 0);
const sweepsBuyRejSig = (ctx) => (ctx?.pillar3?.sweeps ?? ctx?.pillar1?.sweeps ?? []).filter((s) => s?.side === "buy" && s?.rejected === true);
const failSwingsBear = (ctx) => (ctx?.pillar3?.failureSwings ?? ctx?.pillar3?.failure_swings ?? []).filter((f) => ["bear", "bearish"].includes(f?.dir ?? f?.direction));
const freshBearFvg = (ctx) => (ctx?.pillar3?.pdArrays ?? ctx?.pillar3?.fvgs ?? []).filter((f) => ["bear", "bearish"].includes(f?.dir ?? f?.direction) && !["invalidated", "taken", "filled"].includes(String(f?.state ?? "fresh").toLowerCase()));

let walkers = [];
console.log("EST    verdict        blockers/notrade                          p1   p2    disp     | grab(buy,rej) failSw(bear) freshBearFVG conf | spawn mss/trend/inv");
for (const entry of tape.entries) {
  const utc = entry.event.ts;
  const t = est(utc);
  if (t < "09:55" || t > "10:40") continue;  // around Lanto's 10:28 EST short
  const inputs = entry.inputs;
  const event = { ts: utc, tf: entry.event.tf };
  const bundle = buildStrategyBundleForRuntime(inputs, event, session);
  const ctx = buildStrategyContext(bundle);
  const truth = buildDeterministicPacketTruthFromInputs({ inputs, previousWalkers: walkers, event, session });
  walkers = truth.walkers ?? walkers;

  const mss = buildMssWalkerSpawnRequests(ctx).filter((r) => r.side === "short").length;
  const trend = buildTrendWalkerSpawnRequests(ctx).filter((r) => r.side === "short").length;
  const inv = buildInversionWalkerSpawnRequests(ctx).filter((r) => r.side === "short").length;

  if (t < "10:24" || t > "10:32") continue;  // zoom to Lanto's entry
  // walker stages (short side)
  const sw = (walkers ?? []).filter((w) => w?.side === "short");
  const byStage = {};
  for (const w of sw) byStage[w.stage] = (byStage[w.stage] ?? 0) + 1;
  // confirmation row detail
  const c = (ctx?.pillar3?.confirmationRows ?? [])[0];
  const cd = c ? `dir=${c.confirm_dir ?? c.direction} close=${c.confirm_close} ce=${c.ce_held} chop15=${c.chop_15m} body=${c.last_bar?.body_ratio ?? c.body_ratio} state=${c.entry_state}` : "—";
  console.log(`${t}  ${String(truth.finalVerdict).padEnd(9)} spawn mss/trend/inv=${mss}/${trend}/${inv}`);
  console.log(`      short walkers=${sw.length} stages=${JSON.stringify(byStage)}`);
  console.log(`      conf-row: ${cd}`);
  if (t === "10:28" && c) {
    const cz = `[${c.zone_bottom ?? c.bottom}-${c.zone_top ?? c.top}]`;
    console.log(`      >>> confirmed zone bounds: ${cz}`);
    const tapped = sw.filter((w) => w.stage === "tap_seen" || w.stage === "confirmation_pending");
    console.log(`      >>> tapped walkers (${tapped.length}):`);
    for (const w of tapped) {
      const pd = w?.evidence?.pdArray?.rawPayload ?? {};
      console.log(`            ${w.model} stage=${w.stage} zone=[${pd.bottom}-${pd.top}] ref=${w.pdArrayRef}`);
    }
    // does ANY short walker (any stage) track the confirmed zone?
    const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.26;
    const cb = Number(c.zone_bottom ?? c.bottom), ct = Number(c.zone_top ?? c.top);
    const match = sw.filter((w) => { const pd = w?.evidence?.pdArray?.rawPayload ?? {}; return near(Number(pd.bottom), cb) && near(Number(pd.top), ct); });
    console.log(`      >>> walkers tracking the confirmed zone: ${match.length} ${match.map((w) => w.stage).join(",")}`);
  }
}
