// Deeper trace: WHY doesn't the [7065-7067] inversion walker confirm at Lanto's
// 10:28 EST short on 01-29 MES? The advance (buildInversionWalkerAdvanceRequests)
// goes pd_identified -> confirmed when ONE confirmation row passes THREE gates:
//   (1) isValidConfirmationForSide(row,'short',{requireBody:false})
//   (2) fullCloseThrough(row, walker)  -- zone bounds match within 0.26 AND close < bottom
//   (3) invertedOnThisBar(context, walker, row) -- zone inverted_ms in THIS bar
// The old zone trace only checked (1). This mirrors (2)+(3) exactly from
// inversion-lifecycle.js and prints the raw confirmation rows + per-condition verdict.
import fs from "node:fs";
import { __test } from "../app/main/bar-close.js";
import { buildStrategyContext } from "../app/main/strategy/context/build-strategy-context.js";
import {
  isValidConfirmationForSide,
  allPdArrays,
  rowTop,
  rowBottom,
} from "../app/main/strategy/walkers/lifecycle-utils.js";
import { buildInversionWalkerAdvanceRequests, inversionEntryValid } from "../app/main/strategy/walkers/inversion-lifecycle.js";

const { buildDeterministicPacketTruthFromInputs, buildStrategyBundleForRuntime } = __test;
const tape = JSON.parse(fs.readFileSync("tests/tapes/2026-01-29-mes-ny-am-replay.tape.json", "utf8"));
const session = "ny-am";
const est = (iso) => { const d = new Date(iso); return `${String((d.getUTCHours() + 19) % 24).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const near = (a, b, tol = 0.26) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < tol;
const ZB = 7065, ZT = 7067;
const isZone = (b, t) => near(b, ZB) && near(t, ZT);

// --- exact mirrors of the two non-exported internal gates (inversion-lifecycle.js) ---
function fullCloseThrough(row, walker) {
  const close = Number(row?.close ?? row?.price ?? row?.confirm_close_price);
  if (!Number.isFinite(close)) return { ok: false, why: "close NaN" };
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const top = rowTop(pd), bottom = rowBottom(pd);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return { ok: false, why: "walker pd bounds NaN" };
  const rTop = Number(row?.zone_top ?? row?.top);
  const rBottom = Number(row?.zone_bottom ?? row?.bottom);
  if (Number.isFinite(rTop) && Number.isFinite(rBottom)) {
    if (!near(rTop, top) || !near(rBottom, bottom)) {
      return { ok: false, why: `zone mismatch row[${rBottom}-${rTop}] vs walker[${bottom}-${top}]` };
    }
  }
  if (walker.side === "short") return { ok: close < bottom, why: close < bottom ? null : `close ${close} !< bottom ${bottom}` };
  if (walker.side === "long") return { ok: close > top, why: close > top ? null : `close ${close} !> top ${top}` };
  return { ok: false, why: "no side" };
}
function invertedOnThisBar(context, walker, row) {
  const pd = walker?.evidence?.pdArray?.rawPayload ?? {};
  const top = Number(pd.top), bottom = Number(pd.bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return { ok: true, why: "no walker bounds -> legacy true" };
  const current = allPdArrays(context).map((r) => r?.rawPayload ?? r).find((r) => near(Number(r?.top), top) && near(Number(r?.bottom), bottom));
  const invMs = Number(current?.inverted_ms);
  if (!Number.isFinite(invMs) || invMs <= 0) return { ok: true, why: `no inverted_ms stamp on zone -> legacy true (current zone found=${!!current})` };
  const barMs = Number(row?.last_bar?.time) * 1000;
  if (!Number.isFinite(barMs)) return { ok: true, why: "no row bar identity -> legacy true" };
  const ok = invMs >= barMs && invMs < barMs + 60_000;
  return { ok, why: ok ? null : `invMs ${invMs} not in bar [${barMs}, ${barMs + 60000})` };
}

let walkers = [];
for (const entry of tape.entries) {
  const utc = entry.event.ts;
  const t = est(utc);
  if (t < "10:18" || t > "10:36") { // still fold every bar to carry state
    const inputs0 = entry.inputs;
    const event0 = { ts: utc, tf: entry.event.tf };
    const truth0 = buildDeterministicPacketTruthFromInputs({ inputs: inputs0, previousWalkers: walkers, event: event0, session });
    walkers = truth0.walkers ?? walkers;
    continue;
  }
  const inputs = entry.inputs;
  const event = { ts: utc, tf: entry.event.tf };
  const bundle = buildStrategyBundleForRuntime(inputs, event, session);
  const ctx = buildStrategyContext(bundle);
  const truth = buildDeterministicPacketTruthFromInputs({ inputs, previousWalkers: walkers, event, session });
  walkers = truth.walkers ?? walkers;

  const close = Number(inputs?.bundle?.bars?.last_5_bars?.slice(-1)[0]?.close);
  // the [7065-7067] inversion walker (post-fold)
  const w = (walkers ?? []).find((x) => { const pd = x?.evidence?.pdArray?.rawPayload ?? {}; return x?.model === "Inversion" && isZone(Number(pd.bottom), Number(pd.top)); });
  // does the engine carry a [7065-7067] zone this bar, and is it inverted?
  const z = allPdArrays(ctx).map((r) => r?.rawPayload ?? r).find((r) => isZone(Number(r?.bottom), Number(r?.top)));
  const zinfo = z ? `state=${z.state} dir=${z.dir ?? z.direction} kind=${z.kind} inverted_ms=${z.inverted_ms ?? "-"}` : "(no [7065-7067] zone in pdArrays)";

  console.log(`\n${t} close=${close} | walker=${w ? `${w.stage}` : "NONE"} | zone: ${zinfo}`);

  const rows = ctx?.pillar3?.confirmationRows ?? [];
  const bearRows = rows.filter((r) => ["bear", "bearish"].includes(r?.confirm_dir ?? r?.direction ?? r?.dir));
  console.log(`   confirmationRows: ${rows.length} total, ${bearRows.length} bear`);
  for (const r of bearRows) {
    const zb = r?.zone_bottom ?? r?.bottom, zt = r?.zone_top ?? r?.top;
    const c1 = isValidConfirmationForSide(r, "short", { requireBody: false });
    const tag = isZone(Number(zb), Number(zt)) ? "  <<< [7065-7067]" : "";
    console.log(`   - bear row zone[${zb}-${zt}] state=${r.entry_state} cclose=${r.confirm_close} ce=${r.ce_held} chop=${r.chop_15m} dir=${r.confirm_dir ?? r.direction} body=${r?.last_bar?.body_ratio ?? r?.body_ratio} close=${r.close ?? r.price} | validConf=${c1}${tag}`);
    if (w) {
      const c2 = fullCloseThrough(r, w);
      const c3 = invertedOnThisBar(ctx, w, r);
      console.log(`       vs [7065-7067] walker: validConf=${c1} fullCloseThrough=${c2.ok}${c2.why ? ` (${c2.why})` : ""} invertedThisBar=${c3.ok}${c3.why ? ` (${c3.why})` : ""}`);
      if (c1 && c2.ok && c3.ok) {
        // The GATE — the only thing left between "3 conditions pass" and "confirmed".
        const entryPrice = Number(r?.close ?? r?.price);
        const nowMs = Date.parse(ctx?.eventTimeUtc) || (Number(r?.last_bar?.time) * 1000);
        const g = inversionEntryValid({ context: ctx, side: "short", entryPrice, nowMs });
        const p2 = ctx?.pillar2 ?? {};
        const sweeps = (ctx?.pillar3?.sweeps ?? []).map((s) => `${s.side}:${s.target}@${s.swept_ms ? est(new Date(Number(s.swept_ms)).toISOString()) : "?"}${s.rejected ? "(rej)" : ""}`);
        const swings = (ctx?.pillar3?.structuresSwing ?? []).map((s) => `${s.dir}/${s.event}@${s.confirmed_ms ? est(new Date(Number(s.confirmed_ms)).toISOString()) : "?"}`);
        console.log(`       >>> GATE valid=${g.valid} kind=${g.kind} reason=${g.reason} depth=${g.depth?.toFixed?.(2)}`);
        console.log(`       >>> legHigh=${p2.legHigh} legLow=${p2.legLow} entry=${entryPrice} coherence=${p2.coherence}`);
        console.log(`       >>> sweeps(${sweeps.length}): ${sweeps.join("  ") || "—"}`);
        console.log(`       >>> structuresSwing(${swings.length}): ${swings.join("  ") || "—"}`);
      }
    }
  }
  // What the REAL advance builder produces for the inversion walkers this bar
  const adv = buildInversionWalkerAdvanceRequests(ctx, walkers).map((a) => `${a.id}->${a.stage}`);
  console.log(`   advance requests: ${adv.length ? adv.join(", ") : "(none)"}`);
}
