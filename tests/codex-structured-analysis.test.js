import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CODEX_STRUCTURED_ANALYSIS_SCHEMA,
  applyCodexAnalysisToBriefPayloads,
  buildCodexAnalysisPrompt,
  runCodexStructuredAnalysis,
  validateCodexStructuredAnalysis,
} from "../app/main/codex-structured-analysis.js";

function deterministicPayload(symbol = "MNQ1!") {
  return {
    session: "ny-am",
    symbol,
    brief: `${symbol} deterministic brief`,
    prose_summary: `${symbol}: deterministic prose summary from TradingView digest with enough detail to render.`.repeat(2),
    pillar_grade: "B",
    anchored_target: "30050 (brief_digest.symbols.MNQ1!.pillar1.untaken_pools_above[0].price)",
    anchored_stop: "29920 (brief_digest.symbols.MNQ1!.pillar1.session_levels.PDH.price)",
    primary_draw: { tf: "h4", kind: "fvg", dir: "bull", top: 30000, bottom: 29950, ce: 29975, cite: "engine_by_tf.h4.fvgs[0]" },
  };
}

describe("Codex structured analysis adapter", () => {
  test("prompt sends TradingView digest and deterministic packet as untrusted evidence with no surface authority", () => {
    const prompt = buildCodexAnalysisPrompt({
      session: "ny-am",
      bundle: { brief_digest: { symbols: { "MNQ1!": { htf: { h4: { change_pct: "0.4%" } } } } } },
      deterministicPayloads: [deterministicPayload()],
    });

    assert.match(prompt, /<untrusted_tradingview_digest>/);
    assert.match(prompt, /<deterministic_packets>/);
    assert.match(prompt, /Do not change entry, stop, targets, grade, or no-trade state/i);
    assert.match(prompt, /Return JSON only/i);
    assert.match(prompt, /MNQ1!/);
  });

  test("validation accepts commentary-only symbol analyses", () => {
    const result = validateCodexStructuredAnalysis({
      schema_version: 1,
      analyses: [{
        symbol: "MNQ1!",
        commentary: "HTF and liquidity context support watching the deterministic packet, but Pillar 3 remains pending.",
        risk_challenges: ["Pillar 3 confirmation is not printed yet"],
        missed_perspectives: ["Check source freshness before live handoff"],
        confidence_note: "Commentary only; deterministic engine owns the packet.",
      }],
    }, { deterministicPayloads: [deterministicPayload()] });

    assert.equal(result.ok, true);
    assert.equal(result.value.analyses[0].symbol, "MNQ1!");
  });

  test("validation rejects packet override attempts and unknown symbols", () => {
    const result = validateCodexStructuredAnalysis({
      schema_version: 1,
      analyses: [{
        symbol: "NQ1!",
        commentary: "Take the long.",
        risk_challenges: [],
        missed_perspectives: [],
        confidence_note: "override",
        entry: 30000,
      }],
    }, { deterministicPayloads: [deterministicPayload()] });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /unknown symbol/);
    assert.match(result.errors.join("\n"), /forbidden key entry/);
  });

  test("merge appends Codex commentary without changing deterministic packet fields", () => {
    const payload = deterministicPayload();
    const merged = applyCodexAnalysisToBriefPayloads([payload], {
      schema_version: 1,
      analyses: [{
        symbol: "MNQ1!",
        commentary: "Codex sees the same HTF draw and warns to wait for Pillar 3.",
        risk_challenges: ["No confirmation close yet"],
        missed_perspectives: ["Watch whether target liquidity is swept before entry"],
        confidence_note: "Commentary only.",
      }],
    });

    assert.equal(merged[0].pillar_grade, payload.pillar_grade);
    assert.equal(merged[0].anchored_target, payload.anchored_target);
    assert.equal(merged[0].anchored_stop, payload.anchored_stop);
    assert.match(merged[0].prose_summary, /Codex check:/);
    assert.equal(merged[0].codex_analysis.risk_challenges[0], "No confirmation close yet");
  });

  test("runCodexStructuredAnalysis uses output schema and returns validated JSON, not raw transcript", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fake-codex-structured-"));
    const fakeCodex = path.join(dir, "codex");
    await fs.writeFile(fakeCodex, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--output-last-message');
const schemaIdx = args.indexOf('--output-schema');
if (schemaIdx < 0) process.exit(42);
process.stdout.write('OpenAI Codex transcript that must not be parsed as analysis\\n');
const payload = { schema_version: 1, analyses: [{ symbol: 'MNQ1!', commentary: 'Schema constrained commentary from digest.', risk_challenges: ['Wait for Pillar 3'], missed_perspectives: ['Check freshness'], confidence_note: 'Commentary only.' }] };
fs.writeFileSync(args[outIdx + 1], JSON.stringify(payload));
process.exit(0);
`);
    await fs.chmod(fakeCodex, 0o755);

    try {
      const result = await runCodexStructuredAnalysis({
        session: "ny-am",
        bundle: { brief_digest: { symbols: { "MNQ1!": {} } } },
        deterministicPayloads: [deterministicPayload()],
        provider: { name: "codex", command: fakeCodex, args: ["exec", "--skip-git-repo-check"], model: null },
        timeoutMs: 5000,
      });
      assert.equal(result.ok, true);
      assert.equal(result.analysis.analyses[0].commentary, "Schema constrained commentary from digest.");
      assert.equal(CODEX_STRUCTURED_ANALYSIS_SCHEMA.additionalProperties, false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
