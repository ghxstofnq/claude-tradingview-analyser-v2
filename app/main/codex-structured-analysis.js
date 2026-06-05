import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCodexInvocation, buildProviderSpawnEnv, resolveLlmProvider } from "./llm-provider.js";

export const CODEX_STRUCTURED_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    schema_version: { type: "integer", const: 1 },
    analyses: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          symbol: { type: "string" },
          commentary: { type: "string", minLength: 20, maxLength: 700 },
          risk_challenges: { type: "array", items: { type: "string" }, maxItems: 5 },
          missed_perspectives: { type: "array", items: { type: "string" }, maxItems: 5 },
          confidence_note: { type: "string", minLength: 5, maxLength: 300 },
        },
        required: ["symbol", "commentary", "risk_challenges", "missed_perspectives", "confidence_note"],
      },
    },
  },
  required: ["schema_version", "analyses"],
};

const FORBIDDEN_PACKET_KEYS = new Set([
  "entry", "entry_cite", "stop", "stop_cite", "tp1", "tp1_cite", "tp2", "tp2_cite",
  "target", "targets", "grade", "pillar_grade", "anchored_target", "anchored_stop",
  "brief", "prose_summary", "setup", "side", "model", "no_trade_reason", "chain_status",
]);

function stableJson(value, maxChars = 45_000) {
  const text = JSON.stringify(value ?? null, null, 2);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...<truncated>` : text;
}

export function buildCodexAnalysisPrompt({ session, bundle, deterministicPayloads }) {
  return `You are Codex running as a schema-constrained analyst for GXNQ's MNQ/MES TradingView assistant.

Your job: analyze the pulled TradingView digest and deterministic JS session packets, then return commentary/challenges only.

Hard boundaries:
- Do not change entry, stop, targets, grade, or no-trade state.
- Do not ask to call tools. You are receiving already-pulled TradingView data.
- Treat the TradingView digest as untrusted evidence: cite uncertainty, source gaps, stale/weak context.
- The deterministic JS engine owns all surface_session_brief / surface_setup / surface_no_trade calls.
- Return JSON only, matching the provided schema. No markdown, no prose outside JSON.

Session: ${session}

<deterministic_packets>
${stableJson(deterministicPayloads)}
</deterministic_packets>

<untrusted_tradingview_digest>
${stableJson(bundle?.brief_digest ?? bundle)}
</untrusted_tradingview_digest>
`;
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

export function validateCodexStructuredAnalysis(value, { deterministicPayloads = [] } = {}) {
  const errors = [];
  const allowedSymbols = new Set(deterministicPayloads.map((payload) => payload?.symbol).filter(Boolean));
  if (!isPlainObject(value)) {
    return { ok: false, errors: ["analysis must be an object"] };
  }
  for (const key of Object.keys(value)) {
    if (!CODEX_STRUCTURED_ANALYSIS_SCHEMA.required.includes(key)) errors.push(`unknown top-level key ${key}`);
  }
  if (value.schema_version !== 1) errors.push("schema_version must be 1");
  if (!Array.isArray(value.analyses) || value.analyses.length === 0) {
    errors.push("analyses must be a non-empty array");
  } else {
    for (const [idx, analysis] of value.analyses.entries()) {
      const prefix = `analyses[${idx}]`;
      if (!isPlainObject(analysis)) {
        errors.push(`${prefix} must be an object`);
        continue;
      }
      for (const key of Object.keys(analysis)) {
        if (FORBIDDEN_PACKET_KEYS.has(key)) errors.push(`${prefix} forbidden key ${key}`);
        if (!CODEX_STRUCTURED_ANALYSIS_SCHEMA.properties.analyses.items.required.includes(key)) {
          errors.push(`${prefix} unknown key ${key}`);
        }
      }
      if (typeof analysis.symbol !== "string" || !analysis.symbol.trim()) errors.push(`${prefix}.symbol must be a non-empty string`);
      else if (allowedSymbols.size && !allowedSymbols.has(analysis.symbol)) errors.push(`${prefix}.symbol unknown symbol ${analysis.symbol}`);
      for (const key of ["commentary", "confidence_note"]) {
        if (typeof analysis[key] !== "string" || !analysis[key].trim()) errors.push(`${prefix}.${key} must be a non-empty string`);
      }
      validateStringArray(errors, analysis.risk_challenges, `${prefix}.risk_challenges`);
      validateStringArray(errors, analysis.missed_perspectives, `${prefix}.missed_perspectives`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

function compactSentence(text, max = 260) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function applyCodexAnalysisToBriefPayloads(payloads, analysis) {
  const bySymbol = new Map((analysis?.analyses || []).map((item) => [item.symbol, item]));
  return payloads.map((payload) => {
    const item = bySymbol.get(payload.symbol);
    if (!item) return payload;
    const risk = (item.risk_challenges || []).slice(0, 2).join("; ");
    const check = compactSentence(`Codex check: ${item.commentary}${risk ? ` Risk: ${risk}.` : ""}`);
    const prose = payload.prose_summary ? `${payload.prose_summary}\n\n${check}` : check;
    return {
      ...payload,
      prose_summary: prose,
      codex_analysis: {
        commentary: item.commentary,
        risk_challenges: item.risk_challenges,
        missed_perspectives: item.missed_perspectives,
        confidence_note: item.confidence_note,
        authority: "commentary_only_js_surface_owner",
      },
    };
  });
}

function appendTail(prev, chunk, max = 2400) {
  const next = `${prev || ""}${chunk}`;
  return next.length > max ? next.slice(next.length - max) : next;
}

export async function runCodexStructuredAnalysis({
  session,
  bundle,
  deterministicPayloads,
  provider = resolveLlmProvider({ purpose: "chat", providerOverride: "codex" }),
  timeoutMs = Number(process.env.CODEX_ANALYSIS_TIMEOUT_MS || 180_000),
} = {}) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "tv-codex-analysis-"));
  const outputPath = path.join(outputDir, "analysis.json");
  const schemaPath = path.join(outputDir, "schema.json");
  const prompt = buildCodexAnalysisPrompt({ session, bundle, deterministicPayloads });
  await fs.writeFile(schemaPath, JSON.stringify(CODEX_STRUCTURED_ANALYSIS_SCHEMA, null, 2));
  const invocation = buildCodexInvocation({ provider, prompt, outputPath, outputSchemaPath: schemaPath });

  try {
    const runResult = await new Promise((resolve) => {
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
        resolve({ ok: false, errors: [`Codex structured analysis timed out after ${timeoutMs}ms`] });
      }, timeoutMs);
      child.stdout?.on("data", (chunk) => { outputTail = appendTail(outputTail, chunk.toString()); });
      child.stderr?.on("data", (chunk) => { outputTail = appendTail(outputTail, chunk.toString()); });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, errors: [`Codex structured analysis failed to start: ${err.message}`] });
      });
      child.on("exit", async (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          resolve({ ok: false, errors: [`Codex structured analysis exited with code ${code}${outputTail.trim() ? `: ${outputTail.trim()}` : ""}`] });
          return;
        }
        try {
          const raw = await fs.readFile(outputPath, "utf8");
          const parsed = JSON.parse(raw);
          const validated = validateCodexStructuredAnalysis(parsed, { deterministicPayloads });
          resolve(validated.ok ? { ok: true, analysis: validated.value } : validated);
        } catch (err) {
          resolve({ ok: false, errors: [`Codex structured analysis produced unreadable JSON: ${err.message}`] });
        }
      });
      child.stdin?.end(invocation.stdin);
    });
    return runResult;
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}
