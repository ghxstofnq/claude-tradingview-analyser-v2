// Live==backtest parity check for the HTF fallback. For every MNQ session in
// the corpus, run the LIVE resolver (deriveLtfBiasContext) on each recorded
// per-bar bundle and report which sessions it resolves via 'htf_fallback'.
// These must be exactly the NY-AM sessions the backtest fold newly unblocked
// (05-19am/06-04am/05-22am/06-01am/05-14am), and PM neutral opens must NOT
// fall back. Both paths share htf-fallback.js, so the bias must also match.
import fs from "node:fs"; import path from "node:path";
import { deriveLtfBiasContext } from "../app/main/live-ltf-resolver.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";

const SYM = "MNQ1!";
const BT = "/Users/anasqatanani/Documents/claude-tradingview-analyser-v2/state/backtest";
const idx = JSON.parse(fs.readFileSync(path.join(BT, "index.json"), "utf8"));
function regenBrief(rd, s) {
  const bp = path.join(rd, "brief-bundle.json"); if (!fs.existsSync(bp)) return null;
  let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(rd, "brief-payloads.json"), "utf8")); } catch {}
  const b = JSON.parse(fs.readFileSync(bp, "utf8")); const ld = rec?.[0]?.symbol || SYM;
  const pl = buildDirectSessionBriefPayloads({ session: s, bundle: { ...b, brief_digest: buildBriefDigest({ pair: { symbols: { [ld]: b } } }) }, symbols: [ld] });
  return pl?.[0] ?? null;
}
const leaderOf = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, "tape.json"), "utf8")).entries?.[0]?.inputs?.leader ?? null; } catch { return null; } };

const rows = [];
for (const e of idx.runs) {
  if (e.symbol !== SYM) continue;
  const rd = path.join(BT, e.run_id, e.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) continue;
  if (leaderOf(rd) !== SYM) continue;
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const brief = regenBrief(rd, e.session); if (!brief) continue;
  const seen = new Map(); // interaction -> {bias, n}
  for (const entry of tape.entries) {
    const bundle = entry?.inputs?.bundle; const eventTs = entry?.event?.ts;
    if (!bundle || !eventTs) continue;
    let ctx = null;
    try { ctx = deriveLtfBiasContext({ bundle, brief, session: e.session, eventTs }); } catch { ctx = null; }
    if (ctx?.bias) {
      const k = ctx.interaction || ctx.source || "?";
      const cur = seen.get(k) || { bias: ctx.bias, n: 0 }; cur.n++; seen.set(k, cur);
    }
  }
  const fb = seen.get("htf_fallback");
  rows.push({ k: `${e.date} ${e.session}`, fb: fb ? `${fb.bias}×${fb.n}` : "-", interactions: [...seen.keys()].join(",") || "none" });
}

console.log("LIVE resolver per-bar — sessions resolving via htf_fallback:\n");
console.log("DATE       SESS    HTF_FALLBACK(bias×bars)   all-interactions-seen");
for (const r of rows.sort((a, b) => a.k.localeCompare(b.k))) {
  if (r.fb !== "-" || /am/.test(r.k)) console.log(`${r.k.padEnd(16)} ${r.fb.padEnd(24)} ${r.interactions}`);
}
const fbAM = rows.filter((r) => r.fb !== "-" && /ny-am/.test(r.k)).map((r) => r.k);
const fbPM = rows.filter((r) => r.fb !== "-" && /ny-pm/.test(r.k)).map((r) => r.k);
console.log(`\nLIVE htf_fallback fired on NY-AM: ${fbAM.length} sessions -> ${fbAM.join(", ")}`);
console.log(`LIVE htf_fallback fired on NY-PM: ${fbPM.length} (must be 0 — PM excluded): ${fbPM.join(", ") || "none"}`);
