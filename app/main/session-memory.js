// session-memory — the one place that reads/writes per-session memory
// files in state/session/<date>/<session>/.
//
// Why a module: today three different files write or read these files
// (surface.js, session-brief.js, bar-close.js), with three different
// definitions of what "session memory" is. Race: brief refresh writes four
// files sequentially (brief.json, brief-<sym>.json, pillar1.md, pillar2.md);
// the bar-close loop reads pillar1.md + pillar2.md on every tick. Read mid-
// write yields mismatched pillars and silently corrupts Claude's context.
//
// Fix: one module with one contract.
//   writeBrief(dir, payload)  — atomic writes (write-to-tmp + rename)
//   readMemory(dir)           — race-free stitched markdown for prompts
//   readBrief(dir, symbol?)   — typed single-brief read
//
// brief.json now mirrors the PRIMARY symbol's brief deterministically,
// not last-written. Eliminates "Review panel shows MES" class of bug.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAIR_PRIMARY } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
// The bundle Claude analyzed during the brief turn. tv_analyze_full writes
// here; we copy it into the session folder so the cited prices can be
// audited later (otherwise the source data gets overwritten by the next
// tv_analyze call).
const SOURCE_BUNDLE = path.join(REPO_ROOT, "state", "last-analyze.json");

const DEFAULT_TAIL_BARS = 10;
const DEFAULT_TAIL_SETUPS = 5;

// Atomic write: write to <name>.tmp, then rename. POSIX rename is atomic
// within a filesystem — readers always see either the prior version or
// the new one, never a partial half-written file. Costs one extra fs op
// per write; cheap compared to the bug class it eliminates.
//
// Exported so other modules (surface.js) can use the same pattern for
// non-brief writes (ltf-bias, summary, open-reaction).
export async function writeAtomic(absPath, content) {
  const tmp = absPath + ".tmp";
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, absPath);
}

/**
 * writeBrief — persist a session-brief payload to a session folder.
 *
 * @param {string} dir   absolute path to state/session/<date>/<session>/
 * @param {object} payload  the surface_session_brief tool's input
 */
export async function writeBrief(dir, payload) {
  await fs.mkdir(dir, { recursive: true });
  const json = JSON.stringify(payload, null, 2);
  if (payload.symbol) {
    // Per-symbol brief.
    await writeAtomic(path.join(dir, `brief-${payload.symbol}.json`), json);
    // Legacy brief.json mirrors the PRIMARY only — not whichever symbol
    // Claude happened to write last. Review/journal panels read brief.json
    // by name and were always picking up MES (called second).
    if (payload.symbol === PAIR_PRIMARY) {
      await writeAtomic(path.join(dir, "brief.json"), json);
      // Snapshot the source bundle alongside the primary brief. Lets
      // someone reading brief.json 2 hours later verify the cited
      // prices — without this, the bundle has been overwritten by the
      // next tv_analyze run and citations are unauditable. Best-effort:
      // missing source = no snapshot, brief still writes.
      try {
        const sourceBundle = await fs.readFile(SOURCE_BUNDLE, "utf8");
        await writeAtomic(path.join(dir, "brief-bundle.json"), sourceBundle);
      } catch { /* no source bundle — skip snapshot */ }
    }
  } else {
    // Legacy single-symbol mode — no per-symbol file, only brief.json.
    await writeAtomic(path.join(dir, "brief.json"), json);
    try {
      const sourceBundle = await fs.readFile(SOURCE_BUNDLE, "utf8");
      await writeAtomic(path.join(dir, "brief-bundle.json"), sourceBundle);
    } catch { /* no source bundle — skip snapshot */ }
  }
  // Pillar 1 + 2 as an atomic PAIR. Bar-close reads both pillars on every
  // tick to enrich the per-bar prompt — writing them as two separate
  // files used to mean bar-close could read the new pillar1 + the old
  // pillar2 in the microseconds between renames. Now: write the combined
  // pillars.md atomically (the canonical source readMemory consumes) and
  // ALSO write the individual files (still useful for human inspection).
  // Combined-first means readers never see a torn pair.
  const pillar1Md = renderPillar1Md(payload);
  const pillar2Md = renderPillar2Md(payload);
  await writeAtomic(
    path.join(dir, "pillars.md"),
    `${pillar1Md}\n\n---\n\n${pillar2Md}\n`,
  );
  await writeAtomic(path.join(dir, "pillar1.md"), pillar1Md);
  await writeAtomic(path.join(dir, "pillar2.md"), pillar2Md);
}

/**
 * readMemory — stitch the session-memory markdown files + jsonl tails
 * into a single markdown block for prompt enrichment. Returns null if
 * nothing has been written yet (early-session prompts).
 *
 * @param {string} dir  absolute path to state/session/<date>/<session>/
 */
export async function readMemory(dir, opts = {}) {
  const tailBars = opts.tailBars ?? DEFAULT_TAIL_BARS;
  const tailSetups = opts.tailSetups ?? DEFAULT_TAIL_SETUPS;
  const parts = [];
  // Prefer pillars.md (single atomic file containing both pillar 1 and 2)
  // — it can never be torn the way pillar1.md + pillar2.md could be when
  // they're written separately. Fall back to the individual files for
  // briefs written before pillars.md existed (or if writeBrief failed
  // partway).
  let pillarsHandled = false;
  try {
    const txt = (await fs.readFile(path.join(dir, "pillars.md"), "utf8")).trim();
    if (txt) {
      parts.push(`--- pillars.md ---\n${txt}`);
      pillarsHandled = true;
    }
  } catch { /* fall back */ }
  if (!pillarsHandled) {
    for (const name of ["pillar1.md", "pillar2.md"]) {
      try {
        const txt = (await fs.readFile(path.join(dir, name), "utf8")).trim();
        if (txt) parts.push(`--- ${name} ---\n${txt}`);
      } catch { /* missing → skip */ }
    }
  }
  for (const name of ["ltf-bias.md", "open-reaction.md"]) {
    try {
      const txt = (await fs.readFile(path.join(dir, name), "utf8")).trim();
      if (txt) parts.push(`--- ${name} ---\n${txt}`);
    } catch { /* missing → skip */ }
  }
  for (const [name, n] of [["setups.jsonl", tailSetups], ["bars.jsonl", tailBars]]) {
    try {
      const txt = await fs.readFile(path.join(dir, name), "utf8");
      const lines = txt.trim().split("\n").filter(Boolean).slice(-n);
      if (lines.length) parts.push(`--- ${name} (last ${lines.length}) ---\n${lines.join("\n")}`);
    } catch { /* missing → skip */ }
  }
  return parts.length ? parts.join("\n\n") : null;
}

// ---------- markdown rendering ----------
// Kept in this module so format + write semantics live together.

function renderPillar1Md(record) {
  const phase = `pre_session_${(record.session || "ny-am").replace("-", "_")}`;
  const bias = (record.htf_bias || [])
    .map((b) => `- **${b.tf}** — ${b.bias}: ${b.note}`).join("\n");
  const overnight = (record.overnight || [])
    .map((o) => `- ${o.k}: ${o.v}`).join("\n");
  const levels = (record.key_levels || [])
    .map((l) => `- ${l.name}: ${l.price} (${l.state})`).join("\n");
  const p1 = (record.pillars || []).find((p) => /draw|bias/i.test(p.name || ""));
  const verdict = p1?.status || "pending";
  const graded = record.ts || new Date().toISOString();

  return `---
session: ${record.session || ""}
phase: ${phase}
graded_at: ${graded}
---

# Pillar 1 — Draw & Bias

## HTF Bias
${bias || "_no HTF bias provided_"}

## Primary HTF Draw
- target: ${record.anchored_target || "_n/a_"}
- structural stop ref: ${record.anchored_stop || "_n/a_"}

## Overnight Summary
${overnight || "_no overnight context provided_"}

## Key Levels
${levels || "_no levels provided_"}

## Plan
${record.plan || "_no plan provided_"}

## Verdict
- pillar1: ${verdict}
- pillar_grade (P1+P2 roll-up): ${record.pillar_grade || "pending"}
`;
}

function renderPillar2Md(record) {
  const phase = `pre_session_${(record.session || "ny-am").replace("-", "_")}`;
  const p2 = (record.pillars || []).find((p) => /quality/i.test(p.name || ""));
  const elements = (p2?.elements || [])
    .map((e) => `- ${e.name}: ${e.status}`).join("\n");
  const verdict = p2?.status || "pending";
  const graded = record.ts || new Date().toISOString();

  return `---
session: ${record.session || ""}
phase: ${phase}
graded_at: ${graded}
---

# Pillar 2 — Price-Action Quality

## Elements
${elements || "_no elements provided_"}

## Sizing
${record.sizing_note || "_no sizing note provided_"}

## Verdict
- pillar2: ${verdict}
`;
}
