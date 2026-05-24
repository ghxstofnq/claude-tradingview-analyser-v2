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
