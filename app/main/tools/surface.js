// surface_setup / surface_no_trade / surface_session_brief — tools Claude
// calls to push structured output to the UI. Main captures the call,
// persists to disk, and forwards to the renderer via IPC.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activeSessionDir, currentSession } from "../sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

let _send = null;
export function setSurfaceSink(sendFn) { _send = sendFn; }

export async function surfaceSetup(payload) {
  const dir = await activeSessionDir();
  const file = path.join(dir, "setups.jsonl");
  const id = payload.id || `S-${Date.now().toString(36)}`;
  const record = { ...payload, id, ts: new Date().toISOString() };
  await fs.appendFile(file, JSON.stringify(record) + "\n", "utf8");
  _send?.("chat:tool_call", { name: "surface_setup", payload: record });
  return { ok: true, id };
}

export async function surfaceNoTrade({ reason }) {
  _send?.("chat:tool_call", { name: "surface_no_trade", payload: { reason } });
  return { ok: true };
}

// Resolve the per-brief folder explicitly from payload.session — NOT from the
// active session clock. The london brief fires at 02:00 ET, before
// activeSessionDir() considers london active (its window starts at 03:00),
// so a clock-derived dir would land in ny-am/ and getBriefForToday("london")
// would never find it.
async function briefDirFor(session) {
  const { date } = currentSession();
  const dir = path.join(REPO_ROOT, "state", "session", date, session);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function surfaceSessionBrief(payload) {
  const dir = await briefDirFor(payload.session);
  const ts = new Date().toISOString();
  const record = { ...payload, ts };
  await fs.writeFile(path.join(dir, "brief.json"), JSON.stringify(record, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "pillar1.md"), renderPillar1Md(record), "utf8");
  await fs.writeFile(path.join(dir, "pillar2.md"), renderPillar2Md(record), "utf8");
  _send?.("prep:brief_updated", record);
  return { ok: true };
}

// Render pillar1.md from the brief payload — Draw & Bias section. Mirrors the
// frontmatter + section structure the /analyze slash command writes, so the
// per-bar prompt enrichment can re-read it as session memory.
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

  return `---
session: ${record.session || ""}
phase: ${phase}
graded_at: ${record.ts}
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

// Render pillar2.md — Price-Action Quality.
function renderPillar2Md(record) {
  const phase = `pre_session_${(record.session || "ny-am").replace("-", "_")}`;
  const p2 = (record.pillars || []).find((p) => /quality/i.test(p.name || ""));
  const elements = (p2?.elements || [])
    .map((e) => `- ${e.name}: ${e.status}`).join("\n");
  const verdict = p2?.status || "pending";

  return `---
session: ${record.session || ""}
phase: ${phase}
graded_at: ${record.ts}
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

// ---------- open-reaction.md ----------
//
// Running log written during the first 15 minutes of NY. Each call appends a
// new read; we persist the canonical list to open-reaction.json and re-render
// the markdown view from it. Latest snapshot at top, older below.
export async function surfaceOpenReaction(payload) {
  const dir = await activeSessionDir();
  const jsonFile = path.join(dir, "open-reaction.json");
  const mdFile = path.join(dir, "open-reaction.md");
  const ts = new Date().toISOString();

  let reads = [];
  try {
    reads = JSON.parse(await fs.readFile(jsonFile, "utf8")) || [];
  } catch {}
  const newRead = {
    ts,
    minutes_into_phase: payload.minutes_into_phase ?? null,
    latest_read: payload.latest_read,
    bias_direction: payload.bias_direction,
    watching: payload.watching,
  };
  reads.unshift(newRead);   // newest first
  await fs.writeFile(jsonFile, JSON.stringify(reads, null, 2), "utf8");
  await fs.writeFile(mdFile, renderOpenReactionMd({ ...payload, reads, ts }), "utf8");
  _send?.("chat:tool_call", { name: "surface_open_reaction", payload: newRead });
  return { ok: true };
}

function renderOpenReactionMd({ session, reads, ts }) {
  const [latest, ...prior] = reads;
  const phase = `open_reaction_${(session || "ny-am").replace("-", "_")}`;
  const head = `---
phase: ${phase}
updated_at: ${ts}
minutes_into_phase: ${latest?.minutes_into_phase ?? "n/a"}
---

# Open Reaction

## Latest read (${latest?.ts || ts}, +${latest?.minutes_into_phase ?? "?"}m)
${latest?.latest_read || "_no read_"}

## Bias direction so far
${latest?.bias_direction || "_unclear_"}

## What I'm watching
${latest?.watching || "_n/a_"}
`;
  if (!prior.length) return head;
  const priorBlock = prior
    .map((r) => `### ${r.ts} (+${r.minutes_into_phase ?? "?"}m) — ${r.bias_direction || "unclear"}\n${r.latest_read || ""}`)
    .join("\n\n");
  return `${head}
---
## Previous reads
${priorBlock}
`;
}

// ---------- ltf-bias.md ----------
//
// Finalized LTF bias, written at +14m of the open-reaction window. JSON
// sidecar is the source of truth for the renderer; markdown is the human view.
export async function surfaceLtfBias(payload) {
  const dir = await activeSessionDir();
  const ts = new Date().toISOString();
  const record = { ...payload, ts };
  await fs.writeFile(path.join(dir, "ltf-bias.json"), JSON.stringify(record, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "ltf-bias.md"), renderLtfBiasMd(record), "utf8");
  _send?.("chat:tool_call", { name: "surface_ltf_bias", payload: record });
  return { ok: true };
}

function renderLtfBiasMd(record) {
  const phase = `open_reaction_${(record.session || "ny-am").replace("-", "_")}_complete`;
  return `---
phase: ${phase}
finalized_at: ${record.ts}
---

# LTF Bias (post-NY-open)

- ltf_bias: ${record.ltf_bias || "stand_aside"}
- htf_ltf_alignment: ${record.htf_ltf_alignment || "unclear"}

## Reasoning
${record.reasoning || "_no reasoning provided_"}
`;
}

// ---------- summary.md ----------
//
// Session wrap, written shortly after the session closes. Resolves to the
// folder of the just-completed session via payload.session — not the active
// clock, which by then has rolled to inter-session/idle.
export async function surfaceSessionSummary(payload) {
  const session = payload.session;
  const dir = await briefDirFor(session);
  const ts = new Date().toISOString();
  const record = { ...payload, ts };
  await fs.writeFile(path.join(dir, "summary.json"), JSON.stringify(record, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "summary.md"), renderSummaryMd(record), "utf8");
  _send?.("chat:tool_call", { name: "surface_session_summary", payload: record });
  return { ok: true };
}

function renderSummaryMd(record) {
  const { date } = currentSession();
  const watch = (record.watch_next_session || []).map((w) => `- ${w}`).join("\n");
  return `---
session: ${record.session || ""}
date: ${date}
wrapped_at: ${record.ts}
---

# Session Summary — ${record.session || ""}, ${date}

## Bias picture
${record.bias_picture || "_no bias picture provided_"}

## What happened
${record.what_happened || "_no narrative provided_"}

## Watch next session
${watch || "- _no watchlist provided_"}
`;
}

// Read this session's memory files so a wrap turn (or any caller) can build a
// context block. Returns a stitched markdown blob, or null if nothing exists.
export async function readSessionMemoryFor(session) {
  const dir = await briefDirFor(session);
  const parts = [];
  for (const name of ["pillar1.md", "pillar2.md", "ltf-bias.md", "open-reaction.md"]) {
    try {
      const txt = (await fs.readFile(path.join(dir, name), "utf8")).trim();
      if (txt) parts.push(`--- ${name} ---\n${txt}`);
    } catch {}
  }
  for (const [name, tailN] of [["setups.jsonl", 20], ["bars.jsonl", 20]]) {
    try {
      const txt = await fs.readFile(path.join(dir, name), "utf8");
      const lines = txt.trim().split("\n").filter(Boolean).slice(-tailN);
      if (lines.length) parts.push(`--- ${name} (last ${lines.length}) ---\n${lines.join("\n")}`);
    } catch {}
  }
  return parts.length ? parts.join("\n\n") : null;
}
