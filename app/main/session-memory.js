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
import { PAIR_PRIMARY, PAIR_SECONDARY } from "./config.js";

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
  // pillar2 in the microseconds between renames. Combined-first means
  // readers never see a torn pair.
  //
  // Comparative rendering: in dual-symbol mode this surface fires twice
  // (once per symbol). We re-render pillar1/pillar2 from EVERY
  // brief-<sym>.json on disk so after MNQ's call the file has just MNQ;
  // after MES's call it has both. Single-symbol mode (no `symbol` on the
  // payload) just renders from the payload directly.
  const perSymbolPayloads = await loadAllPerSymbolBriefs(dir, payload);
  const pillar1Md = renderPillar1Md(perSymbolPayloads);
  const pillar2Md = renderPillar2Md(perSymbolPayloads);
  await writeAtomic(
    path.join(dir, "pillars.md"),
    `${pillar1Md}\n\n---\n\n${pillar2Md}\n`,
  );
  await writeAtomic(path.join(dir, "pillar1.md"), pillar1Md);
  await writeAtomic(path.join(dir, "pillar2.md"), pillar2Md);
}

/**
 * Load every brief-<symbol>.json under `dir`. Returns the payloads in
 * canonical order (primary first, secondary second). For single-symbol
 * mode (payload has no `symbol` field) just returns [payload].
 */
async function loadAllPerSymbolBriefs(dir, currentPayload) {
  if (!currentPayload?.symbol) return [currentPayload];
  const out = [];
  for (const sym of [PAIR_PRIMARY, PAIR_SECONDARY]) {
    if (sym === currentPayload.symbol) {
      out.push(currentPayload);
      continue;
    }
    try {
      const txt = await fs.readFile(path.join(dir, `brief-${sym}.json`), "utf8");
      out.push(JSON.parse(txt));
    } catch { /* missing — skip */ }
  }
  return out;
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

// Per-symbol frontmatter key (lowercased, no `!` or `1`). MNQ1! → "mnq".
function frontKey(sym) {
  return (sym || "primary").toLowerCase().replace(/[!1]/g, "");
}

// Build the structured frontmatter block for one symbol (Pillar 1 fields).
// Returns an indented block of YAML keys under the symbol's key, or empty
// when the payload carries no chain handoff fields (legacy briefs).
function renderPillar1FrontmatterForSymbol(payload) {
  const k = frontKey(payload.symbol);
  const pd = payload.primary_draw;
  const primary_draw = pd
    ? `\n  primary_draw:\n    tf: ${pd.tf}\n    kind: ${pd.kind}\n    dir: ${pd.dir}\n    top: ${pd.top}\n    bottom: ${pd.bottom}\n    ce: ${pd.ce}\n    state: ${pd.state}\n    cite: ${pd.cite}`
    : "";
  const htf_destination = payload.htf_destination ? `\n  htf_destination: "${payload.htf_destination}"` : "";
  const overnight_verdict = payload.overnight_block?.overnight_verdict ? `\n  overnight_verdict: ${payload.overnight_block.overnight_verdict}` : "";
  const path_to_destination = payload.overnight_block?.path_to_destination ? `\n  path_to_destination: "${payload.overnight_block.path_to_destination}"` : "";
  const pillar_grade = payload.pillar_grade ? `\n  pillar_grade: ${payload.pillar_grade}` : "";
  const no_trade_reason = payload.no_trade_reason ? `\n  no_trade_reason: ${payload.no_trade_reason}` : "";
  const chain_status = payload.chain_status ? `\n  chain_status: ${payload.chain_status}` : "";
  // Symbol key at column 0 (valid YAML); nested fields at 2-space indent.
  return `${k}:${primary_draw}${htf_destination}${overnight_verdict}${path_to_destination}${pillar_grade}${no_trade_reason}${chain_status}`;
}

// Body section for one symbol — keeps existing prose format under a
// `## <symbol>` heading. When only one payload is present the section
// looks like a single-symbol brief.
function renderPillar1BodyForSymbol(payload) {
  const sym = payload.symbol || "primary";
  const bias = (payload.htf_bias || [])
    .map((b) => `- **${b.tf}** — ${b.bias}: ${b.note}`).join("\n");
  const overnight = (payload.overnight || [])
    .map((o) => `- ${o.k}: ${o.v}`).join("\n");
  const levels = (payload.key_levels || [])
    .map((l) => `- ${l.name}: ${l.price} (${l.state})`).join("\n");
  const p1 = (payload.pillars || []).find((p) => /draw|bias/i.test(p.name || ""));
  const verdict = p1?.status || "pending";
  return `## ${sym}

### HTF Bias
${bias || "_no HTF bias provided_"}

### Primary HTF Draw
- target: ${payload.anchored_target || "_n/a_"}
- structural stop ref: ${payload.anchored_stop || "_n/a_"}

### Overnight Summary
${overnight || "_no overnight context provided_"}

### Key Levels
${levels || "_no levels provided_"}

### Plan
${payload.plan || "_no plan provided_"}

### Verdict
- pillar1: ${verdict}
- pillar_grade (P1+P2 roll-up): ${payload.pillar_grade || "pending"}`;
}

function renderPillar1Md(payloads) {
  // Accept either a single payload (legacy) or an array (comparative mode).
  const arr = Array.isArray(payloads) ? payloads : [payloads];
  if (arr.length === 0) {
    return "---\n---\n\n# Pillar 1 — Draw & Bias\n\n_no brief data_\n";
  }
  const first = arr[0];
  const session = first.session || "";
  const phase = `pre_session_${(session || "ny-am").replace("-", "_")}`;
  const graded = first.ts || new Date().toISOString();
  const symbols = arr.map((p) => p.symbol).filter(Boolean);
  const symbolsField = symbols.length
    ? `symbols: [${symbols.map((s) => `"${s}"`).join(", ")}]\n`
    : "";
  const symbolSections = arr.map(renderPillar1FrontmatterForSymbol).join("\n");
  const bodySections = arr.map(renderPillar1BodyForSymbol).join("\n\n");
  return `---
session: ${session}
phase: ${phase}
${symbolsField}graded_at: ${graded}
${symbolSections}
---

# Pillar 1 — Draw & Bias

${bodySections}
`;
}

function renderPillar2FrontmatterForSymbol(payload) {
  const k = frontKey(payload.symbol);
  const verdict = payload.pillar2_verdict ? `\n  pillar2_verdict: ${payload.pillar2_verdict}` : "";
  const chain_status = payload.chain_status ? `\n  chain_status: ${payload.chain_status}` : "";
  return `${k}:${verdict}${chain_status}`;
}

function renderPillar2BodyForSymbol(payload) {
  const sym = payload.symbol || "primary";
  const p2 = (payload.pillars || []).find((p) => /quality/i.test(p.name || ""));
  const elements = (p2?.elements || [])
    .map((e) => `- ${e.name}: ${e.status}`).join("\n");
  const verdict = p2?.status || "pending";
  return `## ${sym}

### Elements
${elements || "_no elements provided_"}

### Sizing
${payload.sizing_note || "_no sizing note provided_"}

### Verdict
- pillar2: ${verdict}
- pillar2_verdict: ${payload.pillar2_verdict || "pending"}`;
}

function renderPillar2Md(payloads) {
  const arr = Array.isArray(payloads) ? payloads : [payloads];
  if (arr.length === 0) {
    return "---\n---\n\n# Pillar 2 — Price-Action Quality\n\n_no brief data_\n";
  }
  const first = arr[0];
  const session = first.session || "";
  const phase = `pre_session_${(session || "ny-am").replace("-", "_")}`;
  const graded = first.ts || new Date().toISOString();
  const symbols = arr.map((p) => p.symbol).filter(Boolean);
  const symbolsField = symbols.length
    ? `symbols: [${symbols.map((s) => `"${s}"`).join(", ")}]\n`
    : "";
  const symbolSections = arr.map(renderPillar2FrontmatterForSymbol).join("\n");
  const bodySections = arr.map(renderPillar2BodyForSymbol).join("\n\n");
  return `---
session: ${session}
phase: ${phase}
${symbolsField}graded_at: ${graded}
${symbolSections}
---

# Pillar 2 — Price-Action Quality

${bodySections}
`;
}
