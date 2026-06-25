// General inversion-gate diagnostic. For ANY tape, fold the real chain and, for
// every bar / every inversion walker, evaluate the THREE confirmation-match
// conditions (validConf + fullCloseThrough + invertedThisBar). When all three
// pass, print the gate verdict + the trend context the gate judges on. Lets me
// see WHERE a no-trade day (06-17) would leak and compare it to a take day (01-29).
//
// Usage: node scripts/trace-inv-gate.mjs <tapeFile> [session] [estStart] [estEnd] [tzOffsetHrs]
//   tzOffsetHrs: ET offset from UTC. Jan/Feb = -5 (EST), Jun = -4 (EDT). Default -4.
import fs from "node:fs";
import { __test } from "../app/main/bar-close.js";
import { buildStrategyContext } from "../app/main/strategy/context/build-strategy-context.js";
import {
  isValidConfirmationForSide,
  allPdArrays,
  rowTop,
  rowBottom,
  activeModelWalkers,
} from "../app/main/strategy/walkers/lifecycle-utils.js";
import { inversionEntryValid } from "../app/main/strategy/walkers/inversion-lifecycle.js";

const { buildDeterministicPacketTruthFromInputs, buildStrategyBundleForRuntime } = __test;
const [tapeFile, session = "ny-am", estStart = "09:30", estEnd = "12:00", tzStr = "-4"] = process.argv.slice(2);
const tz = Number(tzStr);
const tape = JSON.parse(fs.readFileSync(tapeFile, "utf8"));
const est = (iso) => { const d = new Date(iso); return `${String((d.getUTCHours() + 24 + tz) % 24).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const near = (a, b, tol = 0.26) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < tol;

// exact mirrors of the two non-exported internal gates (inversion-lifecycle.js)
function fullCloseThrough(row, walker) {
  const close = Number(row?.close ?? row?.price ?? row?.confirm_close_price);
  if (!Number.isFinite(close)) return false;
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const top = rowTop(pd), bottom = rowBottom(pd);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return false;
  const rTop = Number(row?.zone_top ?? row?.top), rBottom = Number(row?.zone_bottom ?? row?.bottom);
  if (Number.isFinite(rTop) && Number.isFinite(rBottom) && (!near(rTop, top) || !near(rBottom, bottom))) return false;
  if (walker.side === "long") return close > top;
  if (walker.side === "short") return close < bottom;
  return false;
}
function invertedOnThisBar(context, walker, row) {
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const top = Number(pd.top), bottom = Number(pd.bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return true;
  const current = allPdArrays(context).map((r) => r?.rawPayload ?? r).find((r) => near(Number(r?.top), top) && near(Number(r?.bottom), bottom));
  const invMs = Number(current?.inverted_ms);
  if (!Number.isFinite(invMs) || invMs <= 0) return true;
  const barMs = Number(row?.last_bar?.time) * 1000;
  if (!Number.isFinite(barMs)) return true;
  return invMs >= barMs && invMs < barMs + 60_000;
}

let walkers = [];
let hits = 0;
for (const entry of tape.entries) {
  const utc = entry.event.ts;
  const t = est(utc);
  const inputs = entry.inputs;
  const event = { ts: utc, tf: entry.event.tf };
  const truth = buildDeterministicPacketTruthFromInputs({ inputs, previousWalkers: walkers, event, session });
  const nextWalkers = truth.walkers ?? walkers;
  if (t < estStart || t > estEnd) { walkers = nextWalkers; continue; }

  const bundle = buildStrategyBundleForRuntime(inputs, event, session);
  const ctx = buildStrategyContext(bundle);
  const rows = ctx?.pillar3?.confirmationRows ?? [];
  for (const w of activeModelWalkers(walkers, "Inversion")) {
    const match = rows.find((r) => isValidConfirmationForSide(r, w.side, { requireBody: false }) && fullCloseThrough(r, w) && invertedOnThisBar(ctx, w, r));
    if (!match) continue;
    hits++;
    const entryPrice = Number(match?.close ?? match?.price);
    const nowMs = Date.parse(ctx?.eventTimeUtc) || (Number(match?.last_bar?.time) * 1000);
    const g = inversionEntryValid({ context: ctx, side: w.side, entryPrice, nowMs });
    const p2 = ctx?.pillar2 ?? {};
    const pd = w?.evidence?.pdArray?.rawPayload ?? {};
    const swings = (ctx?.pillar3?.structuresSwing ?? []).filter((s) => s?.event === "mss" || s?.event === "bos");
    const dir = w.side === "short" ? "bear" : "bull";
    const dated = swings.filter((s) => Number.isFinite(Number(s?.confirmed_ms)));
    const recent = dated.length ? dated.reduce((a, b) => (Number(b.confirmed_ms) > Number(a.confirmed_ms) ? b : a)) : null;
    const sameDirDated = dated.filter((s) => String(s?.dir ?? s?.direction ?? "").startsWith(dir));
    const recentSameDir = sameDirDated.length ? sameDirDated.reduce((a, b) => (Number(b.confirmed_ms) > Number(a.confirmed_ms) ? b : a)) : null;
    const recentSameDirAgeMin = recentSameDir ? ((nowMs - Number(recentSameDir.confirmed_ms)) / 60000).toFixed(0) : "—";
    const sameDir = swings.filter((s) => String(s?.dir ?? s?.direction ?? "").startsWith(dir)).length;
    const sweeps = (ctx?.pillar3?.sweeps ?? []).map((s) => `${s.side}:${s.target}${s.rejected ? "(rej)" : ""}`);
    console.log(`${t} ${w.side} zone[${pd.bottom}-${pd.top}] entry=${entryPrice}`);
    console.log(`   GATE valid=${g.valid} kind=${g.kind} reason=${g.reason} depth=${g.depth?.toFixed?.(2)}`);
    console.log(`   leg[${p2.legLow}-${p2.legHigh}] coherence=${p2.coherence} | swings:${swings.length} sameDir(${dir}):${sameDir} recent=${recent ? `${recent.dir}/${recent.event}` : "—"} recentSameDirAge=${recentSameDirAgeMin}min`);
    console.log(`   sweeps: ${sweeps.join(" ") || "—"}`);
    // Discriminator A: minutes since the ny-am open (09:30 ET). openUtc = 9:30 - tz.
    const evMin = new Date(utc).getUTCHours() * 60 + new Date(utc).getUTCMinutes();
    const openUtcMin = (9 * 60 + 30) - tz * 60;
    console.log(`   [A timing] sessionMin=${evMin - openUtcMin}`);
    // Discriminator B: zone maturity — did the FVG HOLD before inverting (Lanto's
    // prior-leg retrace) or form+invert in the impulse?
    // Read the CURRENT zone from context (not the spawn-time walker payload) for live maturity.
    const cur = allPdArrays(ctx).map((r) => r?.rawPayload ?? r).find((r) => near(Number(r?.top), Number(pd.top)) && near(Number(r?.bottom), Number(pd.bottom))) ?? {};
    const heldCur = (Number(cur.inverted_ms) > 0 && Number(cur.entered_ms) > 0) ? ((Number(cur.inverted_ms) - Number(cur.entered_ms)) / 60000).toFixed(0) : "—";
    console.log(`   [B maturity-CUR] bars_in_zone=${cur.bars_in_zone ?? "—"} minutes_in_zone=${cur.minutes_in_zone ?? "—"} held_before_invert=${heldCur}min size_quality=${cur.size_quality ?? "—"} state=${cur.state ?? "—"}`);
  }
  walkers = nextWalkers;
}
console.log(`\n[${tapeFile}] inversion confirm-hits (all 3 conditions pass): ${hits}`);
