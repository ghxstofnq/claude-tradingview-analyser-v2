#!/usr/bin/env node
// Trace the PER-BAR resolved LTF bias through a backtest tape — the faithful way
// to diagnose a wrong-side session (anchor-bundle probes mislead: the deciding
// swing MSS / overnight often forms LATER in the session).
//
// Usage: node scripts/trace-bias.mjs <date> [session]   (default ny-am)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveLtfBiasContext } from "../app/main/live-ltf-resolver.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BT = path.join(WT, "state", "backtest");
const [date, session = "ny-am"] = process.argv.slice(2);
if (!date) { console.error("usage: trace-bias.mjs <date> [session]"); process.exit(2); }

const tag = `-${session.replace("ny-", "")}-${date}`;
const runId = fs.readdirSync(BT).filter((d) => d.includes(tag)).sort().reverse()[0];
if (!runId) { console.error(`no backtest run for ${date} ${session}`); process.exit(1); }
const rd = path.join(BT, runId, session);
const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
const bundle0 = JSON.parse(fs.readFileSync(path.join(rd, "brief-bundle.json"), "utf8"));
const digest = buildBriefDigest({ pair: { symbols: { "MNQ1!": bundle0 } } });
const pl = buildDirectSessionBriefPayloads({ session, bundle: { ...bundle0, brief_digest: digest }, symbols: ["MNQ1!"] });
const brief = (Array.isArray(pl) ? pl : [pl])[0];
console.log(`run ${runId}\nbrief htf_bias_dir=${brief?.htf_bias_dir} overnight=${brief?.pillar1_votes?.overnight} | ${tape.entries.length} bars\n`);

let last = null;
const swingBear = (b) => (b?.gates?.engine?.pillar3?.structures_by_tier?.swing ?? []).filter((s) => s?.dir === "bear" && (s?.displacement === true || s?.validation === "break")).length;
const swingBull = (b) => (b?.gates?.engine?.pillar3?.structures_by_tier?.swing ?? []).filter((s) => s?.dir === "bull" && (s?.displacement === true || s?.validation === "break")).length;
for (const e of tape.entries) {
  const ts = e.event?.ts; const b = e.inputs?.bundle; if (!ts || !b) continue;
  let ctx = null;
  try { ctx = deriveLtfBiasContext({ bundle: b, brief, session, eventTs: ts }); } catch { /* null */ }
  const bias = ctx?.bias ?? null;
  const line = `${ts.slice(11, 16)} bias=${String(bias).padEnd(8)} ${ctx?.interaction ?? "-"}  swingBear=${swingBear(b)} swingBull=${swingBull(b)}`;
  // print only on change or every 10th bar (keep it readable)
  if (bias !== last) { console.log(line, "  <-- CHANGE"); last = bias; }
}
