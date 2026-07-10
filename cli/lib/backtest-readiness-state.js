import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isSecretLike } from "../../app/main/env-snapshot.js";

export const READINESS_SCHEMA = 1;
export const APPROVAL_SCHEMA = 1;

const TEST_EVIDENCE_KIND = "tests_green";
const APPROVAL_KIND = "readiness_approval";
const OPERATIONAL_LEVER_KEYS = new Set(["GOFNQ_STATE_DIR"]);
const OPERATIONAL_SUFFIX = /_(DIR|PATH|PORT|HOST|URL|LOG|LOGFILE)$/;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value[Symbol.iterator] === "function") return false;
  if (value instanceof Date) return false;
  return true;
}

function requirePlainObject(value, label) {
  if (value == null || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a plain object`);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizeLevers(env = process.env) {
  requirePlainObject(env, "lever environment");
  const out = {};
  for (const key of Object.keys(env).sort()) {
    if (!key.startsWith("GOFNQ_")) continue;
    if (isSecretLike(key.toUpperCase())) continue;
    if (OPERATIONAL_LEVER_KEYS.has(key) || OPERATIONAL_SUFFIX.test(key)) continue;
    const value = env[key];
    if (value == null || value === "") continue;
    if (typeof value === "object") throw new Error(`lever ${key} must be scalar`);
    out[key] = String(value);
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function readinessDir(stateDir) {
  return path.join(stateDir, "backtest", "readiness");
}

export function approvalsDir(stateDir) {
  return path.join(stateDir, "backtest", "approvals");
}

function testEvidenceFile(stateDir) {
  return path.join(readinessDir(stateDir), "tests-green.json");
}

function isSafePathSegment(seg) {
  return typeof seg === "string" && seg !== "" && seg !== "." && seg !== ".." && !/[\\/]/.test(seg);
}

function symbolSlug(symbol) {
  if (typeof symbol !== "string" || symbol.trim() === "") return null;
  const slug = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return slug || null;
}

function validSha(sha) {
  return typeof sha === "string" && /^[0-9a-f]{40}$/i.test(sha);
}

function validDigest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validApprovalSymbol(value) {
  return typeof value === "string" && /^[A-Z0-9!._-]{1,24}$/.test(value);
}

export function readinessScopeDigest(scope) {
  requirePlainObject(scope, "readiness evidence scope");
  return crypto.createHash("sha256").update(stableJson(scope)).digest("hex");
}

export function gitShaFull({ cwd } = {}) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

export function currentCodeIdentity({ cwd } = {}) {
  const code_sha = gitShaFull({ cwd });
  if (!code_sha) return { ok: false, code_sha: null, reason: "could not resolve git HEAD" };
  try {
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      cwd,
      encoding: "utf8",
    }).trim();
    if (status) {
      return { ok: false, code_sha, reason: "worktree is dirty; rerun verification after committing or clearing all source changes" };
    }
    return { ok: true, code_sha, reason: "tracked worktree clean" };
  } catch {
    return { ok: false, code_sha, reason: "could not inspect tracked worktree state" };
  }
}

function validTestEvidence(record) {
  return isPlainObject(record)
    && record.schema === READINESS_SCHEMA
    && record.kind === TEST_EVIDENCE_KIND
    && validSha(record.code_sha)
    && (record.command == null || typeof record.command === "string")
    && validTimestamp(record.ran_at);
}

export function writeTestEvidence({ stateDir, code_sha, command, ran_at }) {
  if (!validSha(code_sha)) throw new Error("writeTestEvidence: valid code_sha required");
  const record = {
    schema: READINESS_SCHEMA,
    kind: TEST_EVIDENCE_KIND,
    code_sha,
    command: command ?? null,
    ran_at: ran_at ?? new Date().toISOString(),
  };
  atomicWriteJson(testEvidenceFile(stateDir), record);
  return record;
}

export function clearTestEvidence({ stateDir }) {
  try {
    fs.rmSync(testEvidenceFile(stateDir), { force: true });
  } catch {
    // best effort
  }
}

export function readTestEvidence({ stateDir }) {
  return readJson(testEvidenceFile(stateDir));
}

export function testsGreenForSha({ stateDir, code_sha }) {
  if (!validSha(code_sha)) return false;
  const record = readTestEvidence({ stateDir });
  return validTestEvidence(record) && record.code_sha === code_sha;
}

export function testsGreenForCurrentCode({ stateDir, cwd } = {}) {
  const identity = currentCodeIdentity({ cwd });
  if (!identity.ok) return { ok: false, code_sha: identity.code_sha, reason: identity.reason };
  const ok = testsGreenForSha({ stateDir, code_sha: identity.code_sha });
  return {
    ok,
    code_sha: identity.code_sha,
    reason: ok ? "test evidence green for current clean code" : "no green test evidence for current clean code",
  };
}

export function approvalPath({ stateDir, manifest_id, symbol }) {
  if (!isSafePathSegment(manifest_id)) return null;
  if (!validApprovalSymbol(symbol)) return null;
  const slug = symbolSlug(symbol);
  if (!slug) return null;
  return path.join(approvalsDir(stateDir), `${manifest_id}__${slug}.json`);
}

function assertApprovalRecordForWrite(record) {
  requirePlainObject(record, "approval record");
  for (const field of ["manifest_id", "selection_digest", "code_sha", "symbol", "strategy_review_state"]) {
    if (typeof record[field] !== "string" || record[field] === "") {
      throw new Error(`approval record ${field} required`);
    }
  }
  if (!validSha(record.code_sha)) throw new Error("approval record valid code_sha required");
  if (!validDigest(record.selection_digest)) throw new Error("approval record valid selection_digest required");
  if (!validDigest(record.scope_digest)) throw new Error("approval record valid scope_digest required");
  requirePlainObject(record.evidence_scope, "approval record evidence_scope");
  if (readinessScopeDigest(record.evidence_scope) !== record.scope_digest) {
    throw new Error("approval record scope_digest does not match evidence_scope");
  }
  if (!validApprovalSymbol(record.symbol)) throw new Error("approval record valid symbol required");
  if (!Array.isArray(record.evidence_scope.symbols) || !record.evidence_scope.symbols.includes(record.symbol)) {
    throw new Error("approval record symbol is not included in evidence_scope");
  }
  if (!new Set(["approved", "rejected"]).has(record.strategy_review_state)) {
    throw new Error("approval record requires explicit approved or rejected strategy review");
  }
  if (record.strategy_review_state === "approved" && record.user_approved_window !== true) {
    throw new Error("approval record requires explicit user window approval");
  }
  requirePlainObject(record.levers, "approval record levers");
  if (record.note != null && typeof record.note !== "string") throw new Error("approval record note must be a string");
  if (record.ts != null && !validTimestamp(record.ts)) throw new Error("approval record valid timestamp required");
}

export function writeApproval({ stateDir, record }) {
  assertApprovalRecordForWrite(record);
  const file = approvalPath({ stateDir, manifest_id: record.manifest_id, symbol: record.symbol });
  if (!file) throw new Error("writeApproval: unsafe manifest_id/symbol");
  const full = {
    schema: APPROVAL_SCHEMA,
    kind: APPROVAL_KIND,
    manifest_id: record.manifest_id,
    selection_digest: record.selection_digest,
    scope_digest: record.scope_digest,
    evidence_scope: record.evidence_scope,
    code_sha: record.code_sha,
    symbol: record.symbol,
    levers: normalizeLevers(record.levers),
    strategy_review_state: record.strategy_review_state,
    user_approved_window: record.user_approved_window === true,
    note: record.note ?? "",
    ts: record.ts ?? new Date().toISOString(),
  };
  atomicWriteJson(file, full);
  return full;
}

export function readApproval({ stateDir, manifest_id, symbol }) {
  const file = approvalPath({ stateDir, manifest_id, symbol });
  if (!file) return null;
  return readJson(file);
}

function approvalShapeError(record) {
  if (!isPlainObject(record)) return "approval record missing";
  if (record.schema !== APPROVAL_SCHEMA) return `approval schema ${record.schema} unsupported`;
  if (record.kind !== APPROVAL_KIND) return "approval kind invalid";
  for (const field of ["manifest_id", "selection_digest", "code_sha", "symbol", "strategy_review_state"]) {
    if (typeof record[field] !== "string" || record[field] === "") return `approval ${field} missing`;
  }
  if (!validSha(record.code_sha)) return "approval code_sha invalid";
  if (!validDigest(record.selection_digest)) return "approval selection_digest invalid";
  if (!validDigest(record.scope_digest)) return "approval scope_digest invalid";
  if (!isPlainObject(record.evidence_scope)) return "approval evidence_scope invalid";
  if (readinessScopeDigest(record.evidence_scope) !== record.scope_digest) return "approval evidence scope digest mismatch";
  if (!validApprovalSymbol(record.symbol)) return "approval symbol invalid";
  if (!Array.isArray(record.evidence_scope.symbols) || !record.evidence_scope.symbols.includes(record.symbol)) {
    return "approval symbol is not included in evidence scope";
  }
  if (!validTimestamp(record.ts)) return "approval timestamp invalid";
  if (!new Set(["approved", "rejected"]).has(record.strategy_review_state)) return "approval strategy review decision invalid";
  if (record.strategy_review_state === "approved" && record.user_approved_window !== true) return "approval user window is not approved";
  if (!Object.hasOwn(record, "levers") || !isPlainObject(record.levers)) return "approval lever shape invalid";
  return null;
}

export function validateApproval({ record, manifest_id, selection_digest, scope_digest, code_sha, symbol, levers }) {
  if (!record) return { ok: false, reason: "no approval on record; run `tv backtest approve`" };
  const shapeError = approvalShapeError(record);
  if (shapeError) return { ok: false, reason: shapeError };
  if (record.manifest_id !== manifest_id) return { ok: false, reason: `approval manifest drift (${record.manifest_id} != ${manifest_id})` };
  if (record.symbol !== symbol) return { ok: false, reason: `approval symbol drift (${record.symbol} != ${symbol})` };
  if (record.selection_digest !== selection_digest) return { ok: false, reason: "approval selection-digest drift; corpus selection changed since sign-off" };
  if (record.scope_digest !== scope_digest) return { ok: false, reason: "approval evidence-scope drift; approved window or scope changed since sign-off" };
  if (record.code_sha !== code_sha) return { ok: false, reason: "approval code-sha drift; code changed since sign-off" };
  let storedLevers;
  let currentLevers;
  try {
    storedLevers = normalizeLevers(record.levers);
    currentLevers = normalizeLevers(levers);
  } catch {
    return { ok: false, reason: "approval lever shape invalid" };
  }
  if (stableJson(storedLevers) !== stableJson(currentLevers)) {
    return { ok: false, reason: "approval lever drift; strategy levers changed since sign-off" };
  }
  if (record.strategy_review_state === "rejected") {
    return {
      ok: false,
      reason: "strategy review explicitly rejected for current evidence",
      strategy_review_state: "rejected",
      user_approved_window: false,
    };
  }
  return {
    ok: true,
    reason: "approval matches current manifest/selection/code/levers",
    strategy_review_state: "approved",
    user_approved_window: true,
  };
}
