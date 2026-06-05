import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCodexInvocation, buildProviderSpawnEnv, resolveLlmProvider } from "./llm-provider.js";
import { readSessionMemoryFor, surfaceSessionSummary } from "./tools/surface.js";

export const CODEX_WRAP_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    schema_version: { type: "integer", const: 1 },
    commentary: { type: "string", minLength: 20, maxLength: 700 },
    risk_challenges: { type: "array", items: { type: "string" }, maxItems: 5 },
    missed_perspectives: { type: "array", items: { type: "string" }, maxItems: 5 },
    confidence_note: { type: "string", minLength: 5, maxLength: 300 },
  },
  required: ["schema_version", "commentary", "risk_challenges", "missed_perspectives", "confidence_note"],
};

const REQUIRED_KEYS = CODEX_WRAP_ANALYSIS_SCHEMA.required;
const FORBIDDEN_WRAP_KEYS = new Set([
  "session", "bias_picture", "what_happened", "watch_next_session", "prose_summary",
  "summary", "payload", "surface", "surface_session_summary", "entry", "stop", "tp1", "tp2",
  "grade", "pillar_grade", "model", "side", "no_trade_reason", "chain_status",
]);

function compact(text, max = 900) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "No persisted session memory was available for this wrap.";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function compactSentence(text, max = 260) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function extractSetupLines(memoryText) {
  return String(memoryText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\{.*(model|setup|entry|outcome|status).*\}/i.test(line))
    .slice(-5);
}

function setupNarrative(memoryText) {
  const setupLines = extractSetupLines(memoryText);
  if (!setupLines.length) return "No confirmed setup lines were found in persisted session memory; treat the wrap as a context/chain recap rather than a trade-performance claim.";
  return `Persisted setup evidence includes: ${setupLines.map((line) => compactSentence(line, 180)).join(" | ")}.`;
}

export function buildDirectSessionWrapPayload({ session, memoryText = "" } = {}) {
  const memory = compact(memoryText, 1200);
  const happened = setupNarrative(memoryText);
  return {
    session,
    bias_picture: `Direct wrap from persisted session memory. Chain/context recap: ${memory}`,
    what_happened: happened,
    watch_next_session: [
      "Re-check unresolved HTF draw/overnight liquidity before the next killzone.",
      "Keep LIVE entry validation gated by the deterministic MSS/Trend/Inversion packet, not wrap commentary.",
    ],
    prose_summary: `Deterministic session wrap for ${String(session || "session").toUpperCase()}: JS summarized the persisted chain and setup evidence, then surfaced the summary directly so Codex does not need MCP surface tools. ${compactSentence(happened, 220)}`,
  };
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateStringArray(errors, value, pathName) {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be an array`);
    return;
  }
  for (const [idx, item] of value.entries()) {
    if (typeof item !== "string" || !item.trim()) errors.push(`${pathName}[${idx}] must be a non-empty string`);
  }
}

export function validateCodexWrapAnalysis(value) {
  const errors = [];
  if (!isPlainObject(value)) return { ok: false, errors: ["analysis must be an object"] };
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_WRAP_KEYS.has(key)) errors.push(`forbidden key ${key}`);
    if (!REQUIRED_KEYS.includes(key)) errors.push(`unknown key ${key}`);
  }
  if (value.schema_version !== 1) errors.push("schema_version must be 1");
  for (const key of ["commentary", "confidence_note"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) errors.push(`${key} must be a non-empty string`);
  }
  validateStringArray(errors, value.risk_challenges, "risk_challenges");
  validateStringArray(errors, value.missed_perspectives, "missed_perspectives");
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export function applyCodexWrapAnalysisToPayload(payload, analysis) {
  if (!analysis) return payload;
  const risk = (analysis.risk_challenges || []).slice(0, 2).join("; ");
  const check = compactSentence(`Codex wrap check: ${analysis.commentary}${risk ? ` Risk: ${risk}.` : ""}`);
  return {
    ...payload,
    prose_summary: payload.prose_summary ? `${payload.prose_summary}\n\n${check}` : check,
    codex_analysis: {
      commentary: analysis.commentary,
      risk_challenges: analysis.risk_challenges,
      missed_perspectives: analysis.missed_perspectives,
      confidence_note: analysis.confidence_note,
      authority: "commentary_only_js_surface_owner",
    },
  };
}

function buildCodexWrapPrompt({ session, memoryText, deterministicPayload }) {
  return `You are Codex running as a schema-constrained wrap analyst for GXNQ's MNQ/MES assistant.

Return commentary/challenges only. The deterministic JS app owns session, bias_picture, what_happened, watch_next_session, prose_summary, and surface_session_summary.
Do not override summary fields, trading decisions, entry/stop/targets, grade, model/side, or no-trade state.
Return JSON only matching the schema.

Session: ${session}

<deterministic_wrap_payload>
${JSON.stringify(deterministicPayload, null, 2)}
</deterministic_wrap_payload>

<persisted_session_memory>
${compact(memoryText, 20_000)}
</persisted_session_memory>
`;
}

function appendTail(prev, chunk, max = 2400) {
  const next = `${prev || ""}${chunk}`;
  return next.length > max ? next.slice(next.length - max) : next;
}

export async function runCodexWrapAnalysis({
  session,
  memoryText,
  deterministicPayload,
  provider = resolveLlmProvider({ purpose: "chat", providerOverride: "codex" }),
  timeoutMs = Number(process.env.CODEX_WRAP_ANALYSIS_TIMEOUT_MS || 180_000),
} = {}) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "tv-codex-wrap-"));
  const outputPath = path.join(outputDir, "analysis.json");
  const schemaPath = path.join(outputDir, "schema.json");
  await fs.writeFile(schemaPath, JSON.stringify(CODEX_WRAP_ANALYSIS_SCHEMA, null, 2));
  const prompt = buildCodexWrapPrompt({ session, memoryText, deterministicPayload });
  const invocation = buildCodexInvocation({ provider, prompt, outputPath, outputSchemaPath: schemaPath });

  try {
    return await new Promise((resolve) => {
      const child = spawn(provider.command, invocation.args, {
        cwd: invocation.cwd,
        env: buildProviderSpawnEnv(process.env),
      });
      let settled = false;
      let outputTail = "";
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill("SIGTERM"); } catch {}
        resolve({ ok: false, errors: [`Codex wrap analysis timed out after ${timeoutMs}ms`] });
      }, timeoutMs);
      child.stdout?.on("data", (chunk) => { outputTail = appendTail(outputTail, chunk.toString()); });
      child.stderr?.on("data", (chunk) => { outputTail = appendTail(outputTail, chunk.toString()); });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, errors: [`Codex wrap analysis failed to start: ${err.message}`] });
      });
      child.on("exit", async (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          resolve({ ok: false, errors: [`Codex wrap analysis exited with code ${code}${outputTail.trim() ? `: ${outputTail.trim()}` : ""}`] });
          return;
        }
        try {
          const parsed = JSON.parse(await fs.readFile(outputPath, "utf8"));
          const validated = validateCodexWrapAnalysis(parsed);
          resolve(validated.ok ? { ok: true, analysis: validated.value } : validated);
        } catch (err) {
          resolve({ ok: false, errors: [`Codex wrap analysis produced unreadable JSON: ${err.message}`] });
        }
      });
      child.stdin?.end(invocation.stdin);
    });
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runDirectSessionWrap(session, {
  readMemoryFn = readSessionMemoryFor,
  codexAnalysisFn = runCodexWrapAnalysis,
  surfaceFn = surfaceSessionSummary,
  onEvent,
} = {}) {
  const memoryText = await readMemoryFn(session);
  let payload = buildDirectSessionWrapPayload({ session, memoryText });

  if (codexAnalysisFn) {
    try {
      const codexResult = await codexAnalysisFn({ session, memoryText, deterministicPayload: payload });
      if (codexResult?.ok && codexResult.analysis) {
        payload = applyCodexWrapAnalysisToPayload(payload, codexResult.analysis);
        onEvent?.({ type: "codex_analysis", status: "applied", session });
      } else {
        onEvent?.({ type: "codex_analysis", status: "rejected", errors: codexResult?.errors || ["unknown Codex wrap analysis rejection"] });
      }
    } catch (err) {
      onEvent?.({ type: "codex_analysis", status: "error", errors: [err?.message || String(err)] });
    }
  }

  await surfaceFn(payload);
  onEvent?.({ type: "tool_call", name: "direct_surface_session_summary", payload });
  onEvent?.({ type: "chunk", text: `Deterministic session wrap surfaced for ${session}; Codex analysis is commentary-only when present.` });
  return { ok: true, toolCalls: ["direct_surface_session_summary"] };
}
