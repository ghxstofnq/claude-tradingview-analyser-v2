#!/usr/bin/env node
// Regen-from-bundle: rewrite every recorded backtest run's brief-payloads.json
// from its brief-bundle.json using the CURRENT direct-session-brief code, so the
// on-disk baked brief matches what the live chain + fold tooling produce today.
// The gate / fold-week already regen on read; this persists it for the tools that
// read the baked file directly (refold-run.js, debug-fold.js) and removes the
// stale artifact ("never trust a tape's baked brief after a code change").
//
// Backs up the as-recorded file to brief-payloads.recorded.json once (provenance).
// Runs that have NO brief-bundle.json cannot be regenerated and are reported as
// needing a re-record. Dry-run by default; pass --write to persist.
//
//   node scripts/regen-payloads.mjs            # dry run, show before/after
//   node scripts/regen-payloads.mjs --write    # persist
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BT = path.join(REPO_ROOT, "state", "backtest");
const WRITE = process.argv.includes("--write");

function regen(sessDir, session) {
  const bundlePath = path.join(sessDir, "brief-bundle.json");
  const recPath = path.join(sessDir, "brief-payloads.json");
  if (!fs.existsSync(recPath)) return { status: "no-payloads" };
  const recorded = JSON.parse(fs.readFileSync(recPath, "utf8"));
  if (!fs.existsSync(bundlePath)) return { status: "no-bundle", recorded };
  const leader = recorded[0]?.symbol || "MNQ1!";
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const digest = buildBriefDigest({ pair: { symbols: { [leader]: bundle } } });
  const fresh = buildDirectSessionBriefPayloads({
    session, bundle: { ...bundle, brief_digest: digest }, symbols: [leader],
  });
  return { status: "ok", recorded, fresh, recPath, sessDir };
}

const sig = (p) => p ? `${p.htf_bias_dir || "?"}/${p.pillar_grade || "?"}${p.no_trade_reason ? "(" + p.no_trade_reason + ")" : ""}` : "—";

const runs = fs.readdirSync(BT).filter((d) => /\d{4}-\d{2}-\d{2}$/.test(d)).sort();
let okCount = 0, changed = 0, noBundle = 0, noPayloads = 0;
const changes = [];

for (const run of runs) {
  for (const session of ["ny-am", "ny-pm", "london"]) {
    const sessDir = path.join(BT, run, session);
    if (!fs.existsSync(sessDir)) continue;
    const r = regen(sessDir, session);
    if (r.status === "no-payloads") { noPayloads++; continue; }
    if (r.status === "no-bundle") { noBundle++; console.log(`  NO-BUNDLE  ${run}/${session} (needs re-record)`); continue; }
    okCount++;
    const before = sig(r.recorded[0]), after = sig(r.fresh[0]);
    if (before !== after) { changed++; changes.push(`  CHANGED   ${run}/${session}  ${before}  ->  ${after}`); }
    if (WRITE) {
      const bak = path.join(r.sessDir, "brief-payloads.recorded.json");
      if (!fs.existsSync(bak)) fs.copyFileSync(r.recPath, bak);
      fs.writeFileSync(r.recPath, JSON.stringify(r.fresh, null, 2));
    }
  }
}

console.log("\n" + changes.join("\n"));
console.log("\n===== regen-payloads " + (WRITE ? "(WROTE)" : "(dry run)") + " =====");
console.log(`  regenerable: ${okCount}  |  brief changed: ${changed}  |  no-bundle: ${noBundle}  |  no-payloads: ${noPayloads}`);
if (!WRITE) console.log("  (dry run — re-run with --write to persist; backs up to brief-payloads.recorded.json)");
