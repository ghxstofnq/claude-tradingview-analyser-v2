import path from "node:path";

import { foldSymbol as defaultFoldSymbol } from "../../app/main/backtest-baseline.js";
import { certifyCorpus as defaultCertifyCorpus } from "./corpus-certification.js";
import { DEFAULT_MIN_SESSIONS, composeReadiness } from "./backtest-verdict.js";
import {
  currentCodeIdentity,
  normalizeLevers,
  readApproval,
  readinessScopeDigest,
  testsGreenForCurrentCode,
  validateApproval,
} from "./backtest-readiness-state.js";

export const DEFAULT_SYMBOL = "MNQ1!";

export function defaultStateDir() {
  return process.env.GOFNQ_STATE_DIR || path.resolve("state");
}

export function validateBacktestSymbol(symbol) {
  if (typeof symbol !== "string" || symbol.trim() === "") {
    throw new Error("symbol required");
  }
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9!._-]{1,24}$/.test(normalized)) {
    throw new Error("symbol contains unsupported characters");
  }
  return normalized;
}

function finite(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function baselineStats(baseline) {
  return {
    cum_r: finite(baseline?.total_r),
    sessions: finite(baseline?.corpus?.n_sessions),
    dates: Array.isArray(baseline?.corpus?.dates) ? baseline.corpus.dates : [],
    code_sha: baseline?.code_sha ?? null,
  };
}

function certificationSelection(certification, symbol) {
  const symbols = certification?.requirements?.symbols;
  const report = certification?.symbols?.[symbol];
  if (!Array.isArray(symbols) || !symbols.includes(symbol) || !report) {
    return { ok: false, reason: `${symbol} is not included in certification scope`, runIds: [] };
  }
  if (!report.selected || typeof report.selected !== "object" || Array.isArray(report.selected)) {
    return { ok: false, reason: `${symbol} certification selection is unavailable`, runIds: [] };
  }
  const runIds = Object.values(report.selected);
  if (runIds.some((runId) => typeof runId !== "string" || runId === "") || new Set(runIds).size !== runIds.length) {
    return { ok: false, reason: `${symbol} certification selection is malformed`, runIds: [] };
  }
  return { ok: true, reason: "certification selection resolved", runIds: [...runIds].sort() };
}

function bindBaselineIdentity(baseline, { certification, scopeDigest }) {
  return {
    ...baseline,
    corpus: {
      ...(baseline?.corpus ?? {}),
      run_ids: Array.isArray(baseline?.corpus?.run_ids) ? [...baseline.corpus.run_ids].sort() : [],
    },
    readiness_identity: {
      manifest_id: certification?.manifest_id ?? null,
      selection_digest: certification?.selection_digest ?? null,
      scope_digest: scopeDigest,
    },
  };
}

function baselineIdentityStatus(baseline, { codeSha, symbol, certification, scopeDigest, runIds }) {
  if (!baseline || typeof baseline !== "object") return { ok: false, reason: "baseline unavailable" };
  if (baseline.symbol !== symbol) return { ok: false, reason: "baseline symbol is stale" };
  if (baseline.code_sha !== codeSha) return { ok: false, reason: "baseline code SHA is stale" };
  if (typeof baseline.total_r !== "number" || !Number.isFinite(baseline.total_r)) {
    return { ok: false, reason: "baseline performance total is invalid" };
  }
  const identity = baseline.readiness_identity;
  if (identity?.manifest_id !== certification?.manifest_id
    || identity?.selection_digest !== certification?.selection_digest
    || identity?.scope_digest !== scopeDigest) {
    return { ok: false, reason: "baseline certification identity is stale" };
  }
  const actualRunIds = Array.isArray(baseline.corpus?.run_ids) ? [...baseline.corpus.run_ids].sort() : [];
  const expectedRunIds = [...runIds].sort();
  if (JSON.stringify(actualRunIds) !== JSON.stringify(expectedRunIds)) {
    return { ok: false, reason: "baseline selected-run identity is stale" };
  }
  if (baseline.corpus?.n_sessions !== expectedRunIds.length) {
    return { ok: false, reason: "baseline selected-run session count is stale" };
  }
  return { ok: true, reason: "baseline matches exact code and certified selection" };
}

export async function foldCertifiedBaseline({ symbol, stateDir, certification, foldSymbol = defaultFoldSymbol }) {
  const normalizedSymbol = validateBacktestSymbol(symbol);
  const selection = certificationSelection(certification, normalizedSymbol);
  if (!selection.ok) throw new Error(selection.reason);
  const scopeDigest = readinessScopeDigest(certification.requirements ?? null);
  const baseline = bindBaselineIdentity(
    await foldSymbol({ symbol: normalizedSymbol, stateDir, runIds: selection.runIds }),
    { certification, scopeDigest },
  );
  const status = baselineIdentityStatus(baseline, {
    codeSha: baseline.code_sha,
    symbol: normalizedSymbol,
    certification,
    scopeDigest,
    runIds: selection.runIds,
  });
  if (!status.ok) throw new Error(status.reason);
  return baseline;
}

function splitCertification(cert, symbol) {
  const blockers = Array.isArray(cert?.blockers) ? cert.blockers : [];
  const corpusBlockers = blockers.filter((blocker) => (
    !String(blocker?.code ?? "").startsWith("parity_")
    && (!blocker?.symbol || blocker.symbol === symbol)
  ));
  const report = cert?.symbols?.[symbol];
  const completeCoverage = Number.isFinite(report?.expected)
    && report.expected > 0
    && report.valid === report.expected;
  const structurallyBound = typeof cert?.manifest_id === "string"
    && /^[0-9a-f]{64}$/i.test(cert?.selection_digest ?? "")
    && cert?.requirements
    && typeof cert.requirements === "object"
    && !Array.isArray(cert.requirements);
  const certified = structurallyBound && completeCoverage && corpusBlockers.length === 0;
  const primaryBlocker = corpusBlockers[0];
  return { certified, blockers: corpusBlockers, primaryBlocker };
}

export async function collectBacktestReadiness({
  symbol = DEFAULT_SYMBOL,
  stateDir = defaultStateDir(),
  cwd = process.cwd(),
  env = process.env,
  minSessions = DEFAULT_MIN_SESSIONS,
  foldSymbol = defaultFoldSymbol,
  certifyCorpus = defaultCertifyCorpus,
  baseline: providedBaseline,
} = {}) {
  const normalizedSymbol = validateBacktestSymbol(symbol);
  let cert;
  try {
    cert = certifyCorpus({ stateDir });
  } catch (err) {
    cert = {
      manifest_id: null,
      certified: false,
      selection_digest: null,
      requirements: null,
      symbols: {},
      parity: { certified: false, evidence: err?.message || String(err) },
      blockers: [{ code: "certification_error", message: err?.message || String(err) }],
    };
  }
  const code = currentCodeIdentity({ cwd });
  const tests = testsGreenForCurrentCode({ stateDir, cwd });
  const levers = normalizeLevers(env);
  const corpus = splitCertification(cert, normalizedSymbol);

  const manifest_id = cert?.manifest_id ?? null;
  const selection_digest = cert?.selection_digest ?? null;
  const scope_digest = cert?.requirements ? readinessScopeDigest(cert.requirements) : null;
  const selection = certificationSelection(cert, normalizedSymbol);
  if (!selection.ok) {
    corpus.certified = false;
    corpus.primaryBlocker = { code: "symbol_out_of_scope", symbol: normalizedSymbol, message: selection.reason };
  }

  let baseline = providedBaseline ?? null;
  let baseline_error = null;
  if (providedBaseline === undefined && selection.ok) {
    try {
      baseline = await foldCertifiedBaseline({
        symbol: normalizedSymbol,
        stateDir,
        certification: cert,
        foldSymbol,
      });
    } catch (err) {
      baseline_error = err?.message || String(err);
    }
  } else if (!selection.ok) {
    baseline_error = selection.reason;
  }
  const stats = baselineStats(baseline);
  const baselineStatus = selection.ok
    ? baselineIdentityStatus(baseline, {
      codeSha: code.code_sha,
      symbol: normalizedSymbol,
      certification: cert,
      scopeDigest: scope_digest,
      runIds: selection.runIds,
    })
    : { ok: false, reason: selection.reason };
  const approvalRecord = manifest_id
    ? readApproval({ stateDir, manifest_id, symbol: normalizedSymbol })
    : null;
  const approval = validateApproval({
    record: approvalRecord,
    manifest_id,
    selection_digest,
    scope_digest,
    code_sha: code.code_sha,
    symbol: normalizedSymbol,
    levers,
  });

  const readiness = composeReadiness({
    tests_green: tests.ok,
    tests_reason: tests.reason,
    tests_evidence: { code_sha: tests.code_sha, clean_worktree: code.ok },
    baseline_current: code.ok && baselineStatus.ok,
    baseline_reason: baseline_error
      ? `baseline fold failed: ${baseline_error}`
      : !code.ok
        ? code.reason
        : baselineStatus.reason,
    baseline_evidence: {
      baseline_code_sha: stats.code_sha,
      current_code_sha: code.code_sha,
      readiness_identity: baseline?.readiness_identity ?? null,
      run_ids: baseline?.corpus?.run_ids ?? [],
    },
    corpus_certified: corpus.certified,
    corpus_reason: corpus.certified ? "gate corpus certified" : corpus.primaryBlocker?.message ?? "gate corpus not certified",
    corpus_evidence: {
      manifest_id,
      selection_digest,
      blockers: corpus.blockers,
    },
    parity_certified: cert?.parity?.certified === true,
    parity_reason: cert?.parity?.certified === true ? "backtest-live parity certified" : cert?.parity?.evidence ?? "backtest-live parity not certified",
    parity_evidence: cert?.parity ?? null,
    strategy_review_state: approval.strategy_review_state ?? "pending",
    strategy_review_reason: approval.ok ? "strategy review approved" : approval.reason,
    user_approved_window: approval.user_approved_window === true,
    user_approval_reason: approval.ok ? "user-approved trading window on record" : approval.reason,
    user_approval_evidence: { manifest_id, selection_digest, scope_digest, approval_ok: approval.ok },
    cum_r: stats.cum_r,
    sessions: stats.sessions,
    performance_evidence: { cum_r: stats.cum_r, sessions: stats.sessions, dates: stats.dates },
    minSessions,
  });

  return {
    ...readiness,
    symbol: normalizedSymbol,
    manifest_id,
    selection_digest,
    scope_digest,
    code_sha: code.code_sha,
    baseline_error,
  };
}
