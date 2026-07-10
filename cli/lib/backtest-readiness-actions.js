import { spawn as defaultSpawn } from "node:child_process";

import { certifyCorpus as defaultCertifyCorpus } from "./corpus-certification.js";
import { defaultStateDir, validateBacktestSymbol } from "./backtest-readiness.js";
import {
  clearTestEvidence,
  currentCodeIdentity,
  normalizeLevers,
  readinessScopeDigest,
  testsGreenForCurrentCode,
  writeApproval,
  writeTestEvidence,
} from "./backtest-readiness-state.js";

function runChild({ command, args, cwd, env, spawnImpl }) {
  return new Promise((resolve) => {
    const child = spawnImpl(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on?.("data", (b) => { stdout += b.toString(); });
    child.stderr?.on?.("data", (b) => { stderr += b.toString(); });
    child.on("error", (err) => resolve({ status: 1, stdout, stderr: String(err?.message || err) }));
    child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

export async function verifyReadinessTests({
  stateDir = defaultStateDir(),
  cwd = process.cwd(),
  env = process.env,
  spawnImpl = defaultSpawn,
  command = "npm",
  args = ["run", "test"],
} = {}) {
  const before = currentCodeIdentity({ cwd });
  if (!before.ok) {
    clearTestEvidence({ stateDir });
    return { ok: false, exitCode: 1, reason: before.reason, code_sha: before.code_sha };
  }
  const child = await runChild({ command, args, cwd, env, spawnImpl });
  if (child.status !== 0) {
    clearTestEvidence({ stateDir });
    return {
      ok: false,
      exitCode: child.status,
      reason: `test command failed with exit ${child.status}`,
      stdout: child.stdout,
      stderr: child.stderr,
    };
  }

  const after = currentCodeIdentity({ cwd });
  if (!after.ok || after.code_sha !== before.code_sha) {
    clearTestEvidence({ stateDir });
    return {
      ok: false,
      exitCode: 1,
      reason: after.ok ? "code identity changed during test run" : after.reason,
      code_sha: after.code_sha,
    };
  }

  const record = writeTestEvidence({
    stateDir,
    code_sha: after.code_sha,
    command: [command, ...args].join(" "),
  });
  return { ok: true, exitCode: 0, code_sha: after.code_sha, record };
}

export async function approveReadiness({
  stateDir = defaultStateDir(),
  cwd = process.cwd(),
  env = process.env,
  symbol,
  strategyReview,
  userWindowApproved,
  note = "",
  certifyCorpus = defaultCertifyCorpus,
} = {}) {
  const normalizedSymbol = validateBacktestSymbol(symbol);
  if (!new Set(["approved", "rejected"]).has(strategyReview)) {
    throw new Error("approval requires explicit strategy review state: approved or rejected");
  }
  if (strategyReview === "approved" && userWindowApproved !== true) {
    throw new Error("approval requires explicit user window approval");
  }

  const code = currentCodeIdentity({ cwd });
  if (!code.ok) throw new Error(code.reason);
  const tests = testsGreenForCurrentCode({ stateDir, cwd });
  if (!tests.ok) throw new Error(tests.reason);

  const cert = certifyCorpus({ stateDir });
  if (cert?.certified !== true) {
    throw new Error(cert?.blockers?.[0]?.message ?? "corpus is not certified");
  }
  if (cert?.parity?.certified !== true) throw new Error("backtest-live parity is not certified");
  if (!cert?.requirements || typeof cert.requirements !== "object" || Array.isArray(cert.requirements)) {
    throw new Error("certification evidence scope missing");
  }
  if (typeof cert.manifest_id !== "string" || cert.manifest_id === "") {
    throw new Error("certification manifest id missing");
  }
  if (typeof cert.selection_digest !== "string" || !/^[a-f0-9]{64}$/i.test(cert.selection_digest)) {
    throw new Error("certification selection digest missing");
  }
  if (!Array.isArray(cert.requirements.symbols)
    || !cert.requirements.symbols.includes(normalizedSymbol)
    || !cert.symbols?.[normalizedSymbol]) {
    throw new Error(`${normalizedSymbol} is not included in certification scope`);
  }

  const record = writeApproval({
    stateDir,
    record: {
      manifest_id: cert.manifest_id,
      selection_digest: cert.selection_digest,
      scope_digest: readinessScopeDigest(cert.requirements),
      evidence_scope: cert.requirements,
      code_sha: code.code_sha,
      symbol: normalizedSymbol,
      levers: normalizeLevers(env),
      strategy_review_state: strategyReview,
      user_approved_window: strategyReview === "approved" && userWindowApproved === true,
      note,
    },
  });

  return { ok: true, record };
}
