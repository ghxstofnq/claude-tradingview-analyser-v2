// app/main/readiness.js
// The ONE readiness truth. A pure reducer that composes a single ordered set of
// readiness rows from already-gathered facts — the SAME rows the System page,
// the Backtest hero, and the Settings page all render, so no surface invents its
// own definition of "ready" (Task C1).
//
// Design rules, enforced fail-closed:
//   • Every row carries a real `source` + a `status` + (where a real clock
//     exists) an `age_s`. A row with no proven source/timestamp renders
//     `unavailable`, never a fabricated pass.
//   • The go-live rows (tests / corpus / parity / strategy_approval) reuse the
//     exact gate semantics of cli/lib/backtest-verdict.js — this file does NOT
//     invent a parallel vocabulary, it maps those gates into the unified card.
//   • Any critical row that is not `pass` blocks ARMING (real auto-fire). A
//     confirmed protective-safety failure additionally blocks paper/manual.
//   • No LLM anywhere in this path.
//
// The top half is pure (no IO, no imports) so tests inject plain fact objects.
// The IO collector lives at the bottom and is the only part that reads git /
// disk / the execution getters.

// ── Vocabulary ───────────────────────────────────────────────────────────────
export const READINESS_STATUS = Object.freeze({
  PASS: "pass",
  WARN: "warn",
  FAIL: "fail",
  PENDING: "pending",
  UNAVAILABLE: "unavailable",
});
const { PASS, WARN, FAIL, PENDING, UNAVAILABLE } = READINESS_STATUS;

export const ROW_SEVERITY = Object.freeze({ CRITICAL: "critical", WARNING: "warning" });
const { CRITICAL, WARNING } = ROW_SEVERITY;

// Fixed render order + labels + the source each row's fact comes from.
export const READINESS_ROWS = Object.freeze([
  { id: "tests", label: "Tests / build", source: "test-evidence", severity: CRITICAL },
  { id: "running_code", label: "Running code", source: "git", severity: CRITICAL },
  { id: "pine", label: "TradingView / Pine", source: "ict-engine", severity: CRITICAL },
  { id: "detector", label: "Detector bar-data", source: "detector-heartbeat", severity: CRITICAL },
  { id: "corpus", label: "Corpus certification", source: "corpus-certification", severity: CRITICAL },
  { id: "parity", label: "Parity certificate", source: "parity-certificate", severity: CRITICAL },
  { id: "strategy_approval", label: "Strategy approval", source: "approval", severity: CRITICAL },
  { id: "broker_account", label: "Broker / account", source: "account-gate", severity: CRITICAL },
  { id: "broker_reconciliation", label: "Broker reconciliation", source: "reconciler", severity: CRITICAL },
  { id: "protective_stop", label: "Protective stop", source: "protection-watchdog", severity: CRITICAL },
  { id: "automation", label: "Automation mode", source: "exec-config", severity: WARNING },
]);
export const READINESS_ROW_IDS = Object.freeze(READINESS_ROWS.map((r) => r.id));

// A confirmed failure on any of these blocks even paper/manual — an open
// position that is provably unprotected must never look tradable.
const SAFETY_ROW_IDS = Object.freeze(["protective_stop"]);

// Engine emit older than this (seconds) can't verify the deployed Pine against
// live — matches CLAUDE.md's baseline_meta.age_seconds > 900 staleness rule.
export const PINE_STALE_S = 900;

const ALL_STATUSES = new Set(Object.values(READINESS_STATUS));

// ── Pure helpers ─────────────────────────────────────────────────────────────
function ageFrom(asOf, now) {
  return Number.isFinite(asOf) ? Math.max(0, Math.round((now - asOf) / 1000)) : null;
}

function plainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

// Build a row, coercing a malformed status to UNAVAILABLE (fail-closed) and a
// missing evidence to null.
function row(meta, { status, reason, evidence = null, age_s = null, action = null }) {
  const safeStatus = ALL_STATUSES.has(status) ? status : UNAVAILABLE;
  return {
    id: meta.id,
    label: meta.label,
    source: meta.source,
    severity: meta.severity,
    status: safeStatus,
    reason: typeof reason === "string" && reason.trim() ? reason : "readiness evidence unavailable",
    evidence: plainObject(evidence) ? evidence : null,
    age_s: Number.isFinite(age_s) ? age_s : null,
    action: typeof action === "string" && action ? action : null,
  };
}

const META = Object.fromEntries(READINESS_ROWS.map((m) => [m.id, m]));

// go-live-derived rows share one shape: { status, reason, evidence, as_of }.
// Their status is already pass|fail|pending from the gate table.
function goLiveRow(id, fact, now, action = null) {
  if (!plainObject(fact)) {
    return row(META[id], { status: UNAVAILABLE, reason: `${META[id].label.toLowerCase()} evidence unavailable` });
  }
  return row(META[id], {
    status: fact.status,
    reason: fact.reason,
    evidence: fact.evidence,
    age_s: ageFrom(fact.as_of, now),
    action,
  });
}

// ── Row builders ─────────────────────────────────────────────────────────────
function runningCodeRow(v, now) {
  if (!plainObject(v)) return row(META.running_code, { status: UNAVAILABLE, reason: "version status unavailable" });
  const evidence = { sha: v.sha ?? null, boot_sha: v.boot_sha ?? null, behind: v.behind ?? null };
  const age_s = ageFrom(v.as_of, now);
  if (v.restart_needed === true) {
    return row(META.running_code, { status: FAIL, evidence, age_s, reason: `running code is behind disk — restart to load HEAD (booted ${v.boot_sha ?? "?"}, disk ${v.sha ?? "?"})` });
  }
  if (v.pull_needed === true) {
    return row(META.running_code, { status: WARN, evidence, age_s, reason: `origin/main is ${v.behind ?? "?"} commit(s) ahead — pull then restart` });
  }
  if (v.sha) {
    return row(META.running_code, { status: PASS, evidence, age_s, reason: `running current code (${v.sha})` });
  }
  return row(META.running_code, { status: UNAVAILABLE, evidence, age_s, reason: "could not resolve running SHA" });
}

function pineRow(p, now) {
  if (!plainObject(p)) return row(META.pine, { status: UNAVAILABLE, reason: "no engine telemetry available" });
  const evidence = { cdp: p.cdp ?? null, schema: p.schema ?? null, code_rev: p.code_rev ?? null, expected_code_rev: p.expected_code_rev ?? null };
  const age_s = ageFrom(Number.isFinite(p.emit_ms) ? p.emit_ms : p.as_of, now);
  if (p.cdp === "down") return row(META.pine, { status: FAIL, evidence, reason: "TradingView CDP unreachable (9225) — engine blind" });
  if (p.cdp === "unknown" || p.cdp == null) return row(META.pine, { status: WARN, evidence, reason: "TradingView CDP not yet probed" });
  // CDP up — verify the deployed engine from the last emit on disk.
  if (!Number.isFinite(p.code_rev)) {
    return row(META.pine, { status: WARN, evidence, age_s, reason: "no recent engine emit to verify Pine schema / code_rev" });
  }
  if (p.schema_supported !== true) {
    return row(META.pine, { status: FAIL, evidence, age_s, reason: `engine schema ${p.schema ?? "?"} not supported by the parser` });
  }
  if (Number.isFinite(p.expected_code_rev) && p.code_rev !== p.expected_code_rev) {
    return row(META.pine, { status: FAIL, evidence, age_s, reason: `deployed Pine code_rev ${p.code_rev} ≠ expected ${p.expected_code_rev} (deploy drift)` });
  }
  // Code/schema check the deployed indicator, but a matching rev off a stale
  // emit proves nothing about NOW — degrade to WARN past the baseline-staleness
  // bound (CLAUDE.md's 900s baseline_meta rule).
  if (Number.isFinite(age_s) && age_s > PINE_STALE_S) {
    return row(META.pine, { status: WARN, evidence, age_s, reason: `engine emit is ${age_s}s old (> ${PINE_STALE_S}s) — code_rev ${p.code_rev} unverified against live` });
  }
  return row(META.pine, { status: PASS, evidence, age_s, reason: `engine schema ${p.schema ?? "?"} · code_rev ${p.code_rev} verified · emit ${Number.isFinite(age_s) ? age_s : "?"}s ago` });
}

function detectorRow(d, now) {
  if (!plainObject(d)) return row(META.detector, { status: UNAVAILABLE, reason: "detector health unavailable" });
  const evidence = { loop: d.loop ?? null, heartbeat_age_s: d.heartbeat_age_s ?? null, cdp: d.cdp ?? null, turn_lag_s: d.turn_lag_s ?? null };
  const age_s = Number.isFinite(d.heartbeat_age_s) ? d.heartbeat_age_s : ageFrom(d.as_of, now);
  if (d.loop === "healthy") {
    return row(META.detector, { status: PASS, evidence, age_s, action: "restart_detector", reason: `bar-close loop healthy${Number.isFinite(d.heartbeat_age_s) ? ` · heartbeat ${d.heartbeat_age_s}s` : ""}` });
  }
  if (d.loop === "stale") {
    return row(META.detector, { status: WARN, evidence, age_s, action: "restart_detector", reason: `bar-close heartbeat stale${Number.isFinite(d.heartbeat_age_s) ? ` (${d.heartbeat_age_s}s)` : ""}` });
  }
  const reason = d.cdp === "down" ? "loop down — TradingView CDP unreachable" : "bar-close detector not running";
  return row(META.detector, { status: FAIL, evidence, age_s, action: "restart_detector", reason });
}

function brokerAccountRow(a, now) {
  if (!plainObject(a)) return row(META.broker_account, { status: UNAVAILABLE, reason: "account state unavailable" });
  const evidence = { connected: a.connected === true, level: a.level ?? null, name: a.name ?? null, live: a.live === true };
  const age_s = ageFrom(a.as_of, now);
  if (a.connected !== true) {
    return row(META.broker_account, { status: WARN, evidence, age_s, reason: "no broker account connected — log in to route orders" });
  }
  if (a.route === true) {
    const action = a.live === true ? "revert_sim" : null;
    return row(META.broker_account, { status: PASS, evidence, age_s, action, reason: `routing armed to ${a.name || "account"}${a.live ? " (LIVE)" : " (SIM · paper)"}` });
  }
  if (a.needsConfirm === true && a.level === "live") {
    return row(META.broker_account, { status: FAIL, evidence, age_s, reason: "LIVE account unconfirmed — type LIVE in Settings to arm real orders" });
  }
  return row(META.broker_account, { status: PENDING, evidence, age_s, reason: "paper routing unconfirmed — confirm to route tickets" });
}

const RECONCILE_PASS = new Set(["HEALTHY", "MANAGEMENT_ONLY"]);
const RECONCILE_SOFT = new Set(["UNKNOWN"]);
function reconciliationRow(r, now) {
  if (!plainObject(r)) return row(META.broker_reconciliation, { status: UNAVAILABLE, reason: "reconciliation state unavailable" });
  const evidence = { healthy: r.healthy === true, state: r.state ?? null };
  const age_s = ageFrom(r.as_of, now);
  const st = r.state ?? null;
  if (RECONCILE_PASS.has(st)) return row(META.broker_reconciliation, { status: PASS, evidence, age_s, action: "retry_reconcile", reason: `broker ≡ journal (${st})` });
  if (st == null || RECONCILE_SOFT.has(st)) {
    return row(META.broker_reconciliation, { status: WARN, evidence, age_s, action: "retry_reconcile", reason: "broker not yet read — reconciliation pending" });
  }
  return row(META.broker_reconciliation, { status: FAIL, evidence, age_s, action: "retry_reconcile", reason: `broker/journal mismatch (${st})` });
}

const PROTECTION_PASS = new Set(["PROTECTED", "NO_POSITION"]);
function protectiveStopRow(p, now) {
  if (!plainObject(p)) return row(META.protective_stop, { status: UNAVAILABLE, reason: "protection watchdog state unavailable" });
  const evidence = { healthy: p.healthy === true, state: p.state ?? null, blocker: p.blocker ?? null };
  const age_s = ageFrom(p.as_of, now);
  if (p.blocked === true) {
    return row(META.protective_stop, { status: FAIL, evidence, age_s, action: "retry_reconcile", reason: `protection breach: ${p.blocker || p.state || "unprotected"} — new entries paused` });
  }
  if (PROTECTION_PASS.has(p.state)) {
    const detail = p.state === "PROTECTED" ? "open position fully bracketed" : "no open position to protect";
    return row(META.protective_stop, { status: PASS, evidence, age_s, action: "retry_reconcile", reason: detail });
  }
  return row(META.protective_stop, { status: WARN, evidence, age_s, action: "retry_reconcile", reason: `protection watchdog ${p.state ? p.state.toLowerCase() : "warming up"}` });
}

function automationRow(m, now) {
  if (!plainObject(m)) return row(META.automation, { status: UNAVAILABLE, reason: "automation config unavailable" });
  const mode = m.mode ?? "manual";
  const evidence = { mode, auto_paused: m.autoPaused === true };
  const age_s = ageFrom(m.as_of, now);
  if (mode === "auto") {
    if (m.autoPaused === true) {
      return row(META.automation, { status: WARN, evidence, age_s, reason: `AUTO (paused: ${m.autoPauseReason || "gate closed"})` });
    }
    return row(META.automation, { status: PASS, evidence, age_s, reason: "AUTO — all runtime gates open; fires automatically when a setup + risk gates pass" });
  }
  if (mode === "suggest") {
    return row(META.automation, { status: PASS, evidence, age_s, reason: "SUGGEST — alerts on a proposal; you accept every entry" });
  }
  return row(META.automation, { status: PASS, evidence, age_s, reason: "MANUAL — every entry requires your accept" });
}

// ── Composition ──────────────────────────────────────────────────────────────
export function composeReadiness(facts = {}) {
  const f = plainObject(facts) ? facts : {};
  const now = Number.isFinite(f.now) ? f.now : Date.now();
  const gl = plainObject(f.goLive) ? f.goLive : {};

  const rows = [
    goLiveRow("tests", gl.tests, now),
    runningCodeRow(f.version, now),
    pineRow(f.pine, now),
    detectorRow(f.detector, now),
    goLiveRow("corpus", gl.corpus, now),
    goLiveRow("parity", gl.parity, now),
    goLiveRow("strategy_approval", gl.strategy_approval, now),
    brokerAccountRow(f.account, now),
    reconciliationRow(f.reconciliation, now),
    protectiveStopRow(f.protection, now),
    automationRow(f.automation, now),
  ];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const critical = rows.filter((r) => r.severity === CRITICAL);
  const blockers = critical.filter((r) => r.status === FAIL || r.status === UNAVAILABLE)
    .map((r) => ({ id: r.id, status: r.status, reason: r.reason }));
  const pending = critical.filter((r) => r.status === WARN || r.status === PENDING)
    .map((r) => ({ id: r.id, status: r.status, reason: r.reason }));
  const warnings = rows.filter((r) => r.severity === WARNING && r.status !== PASS)
    .map((r) => ({ id: r.id, status: r.status, reason: r.reason }));

  const armReady = blockers.length === 0 && pending.length === 0;
  const safetyRed = SAFETY_ROW_IDS.some((id) => byId.get(id)?.status === FAIL);
  const paperManual = !safetyRed;

  const worst = rows.some((r) => r.status === FAIL || r.status === UNAVAILABLE) ? FAIL
    : rows.some((r) => r.status === WARN || r.status === PENDING) ? WARN
      : PASS;

  const mode = armReady ? "auto_ready" : paperManual ? "paper_manual" : "locked";
  const reason = armReady
    ? "all readiness gates green — safe to arm"
    : (blockers[0]?.reason ?? pending[0]?.reason ?? "readiness incomplete");

  return {
    ok: true,
    generated_at: now,
    rows,
    summary: {
      arm: armReady,
      paper: paperManual,
      manual: paperManual,
      mode,
      worst,
      reason,
      blockers,
      pending,
      warnings,
      safety_red: safetyRed,
    },
  };
}

// ── IO collector (the only impure part) ──────────────────────────────────────
// Gathers facts from the existing getters + disk, then runs composeReadiness.
// Three independent caches keep a renderer poll off the main thread:
//   _certCache  — the corpus/parity certification is symbol-SET-wide, so it is
//                 memoized ONCE (not per symbol) with its own TTL. This is the
//                 heavy read (readFileSync + SHA over dozens of artifacts).
//   _codeIdCache — the git HEAD + clean-worktree read, resolved via ASYNC
//                 execFile (no execFileSync on the poll), cached briefly.
//   _goLiveCache — a small Map keyed by symbol (approval is per-symbol), so
//                 System (MNQ1!) and Backtest (active symbol) don't thrash a
//                 single slot.
const GOLIVE_TTL_MS = 20_000;
const CERT_TTL_MS = 20_000;
const CODEID_TTL_MS = 10_000;
let _certCache = { at: 0, stateDir: null, value: null };
let _codeIdCache = { at: 0, cwd: null, value: null };
const _goLiveCache = new Map(); // symbol -> { at, value }

// Async git identity — HEAD SHA + clean-tracked-worktree, via promisified
// execFile so the poll never blocks on execFileSync.
async function codeIdentityAsync({ cwd, now }) {
  if (_codeIdCache.value && _codeIdCache.cwd === cwd && (now - _codeIdCache.at) < CODEID_TTL_MS) return _codeIdCache.value;
  let value = { code_sha: null, clean: false, reason: "could not resolve git HEAD" };
  try {
    const [util, child] = await Promise.all([import("node:util"), import("node:child_process")]);
    const execFileP = util.promisify(child.execFile);
    const code_sha = (await execFileP("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim() || null;
    if (code_sha) {
      const st = (await execFileP("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd })).stdout.trim();
      const clean = st === "";
      value = { code_sha, clean, reason: clean ? "tracked worktree clean" : "worktree is dirty; commit or clear source changes before verifying" };
    }
  } catch { /* leave nulls */ }
  _codeIdCache = { at: now, cwd, value };
  return value;
}

// Memoized corpus/parity certification (symbol-independent).
async function certifyCached({ stateDir, now }) {
  if (_certCache.value && _certCache.stateDir === stateDir && (now - _certCache.at) < CERT_TTL_MS) return _certCache.value;
  let value = null;
  try {
    const { certifyCorpus } = await import("../../cli/lib/corpus-certification.js");
    value = certifyCorpus({ stateDir });
  } catch { value = null; }
  _certCache = { at: now, stateDir, value };
  return value;
}

// Compose the four go-live facts DIRECTLY from the same validators the go-live
// verdict uses (certifyCorpus / testsGreenForSha / validateApproval) — same
// vocabulary, but with async git + split caching so nothing blocks the poll.
async function collectGoLiveFacts({ stateDir, symbol, cwd, env, now }) {
  const cached = _goLiveCache.get(symbol);
  if (cached && (now - cached.at) < GOLIVE_TTL_MS) return cached.value;

  let facts = { tests: null, corpus: null, parity: null, strategy_approval: null };
  try {
    const state = await import("../../cli/lib/backtest-readiness-state.js");
    const [code, cert] = await Promise.all([
      codeIdentityAsync({ cwd, now }),
      certifyCached({ stateDir, now }),
    ]);

    const manifest_id = cert?.manifest_id ?? null;
    const selection_digest = cert?.selection_digest ?? null;
    const requirements = plainObject(cert?.requirements) ? cert.requirements : null;
    const inScope = Array.isArray(requirements?.symbols) && requirements.symbols.includes(symbol);

    // tests — evidence keyed on the async sha; testsGreenForSha reads a file, no git.
    const testsGreen = !!(code.code_sha && code.clean && state.testsGreenForSha({ stateDir, code_sha: code.code_sha }));
    facts.tests = {
      status: testsGreen ? "pass" : "fail",
      reason: !code.code_sha ? "could not resolve git HEAD"
        : !code.clean ? code.reason
          : testsGreen ? "test evidence green for current clean code"
            : "no green test evidence — re-run `tv backtest verify-tests` on HEAD",
      evidence: { code_sha: code.code_sha, clean_worktree: code.clean },
      as_of: now,
    };

    // corpus + parity — from the memoized certification.
    const corpusCertified = cert?.certified === true && inScope;
    const primaryBlocker = Array.isArray(cert?.blockers) && cert.blockers[0]?.message ? cert.blockers[0].message : null;
    facts.corpus = {
      status: corpusCertified ? "pass" : "fail",
      reason: corpusCertified ? "gate corpus certified"
        : !inScope ? `${symbol} not in certification scope`
          : primaryBlocker ?? "gate corpus not certified",
      evidence: { manifest_id, selection_digest, blockers: cert?.blockers ?? [] },
      as_of: now,
    };
    const parityCertified = cert?.parity?.certified === true;
    facts.parity = {
      status: parityCertified ? "pass" : "fail",
      reason: parityCertified ? "backtest-live parity certified" : (cert?.parity?.evidence ?? "backtest-live parity not certified"),
      evidence: plainObject(cert?.parity) ? cert.parity : null,
      as_of: now,
    };

    // strategy approval — the same validator as the go-live gate.
    let approvalStatus = "pending";
    let approvalReason = "strategy review pending — run `tv backtest approve`";
    try {
      if (manifest_id && requirements && code.code_sha) {
        const scope_digest = state.readinessScopeDigest(requirements);
        const record = state.readApproval({ stateDir, manifest_id, symbol });
        const v = state.validateApproval({
          record, manifest_id, selection_digest, scope_digest,
          code_sha: code.code_sha, symbol, levers: state.normalizeLevers(env),
        });
        if (v?.ok) { approvalStatus = "pass"; approvalReason = "strategy review approved"; }
        else if (v?.strategy_review_state === "rejected") { approvalStatus = "fail"; approvalReason = v.reason; }
        else { approvalStatus = "pending"; approvalReason = v?.reason ?? approvalReason; }
      }
    } catch { /* pending */ }
    facts.strategy_approval = { status: approvalStatus, reason: approvalReason, evidence: { manifest_id, symbol }, as_of: now };
  } catch { /* leave nulls → rows render unavailable, fail-closed */ }

  _goLiveCache.set(symbol, { at: now, value: facts });
  if (_goLiveCache.size > 8) {
    // Bound the map — evict the oldest entry.
    let oldestKey = null; let oldestAt = Infinity;
    for (const [k, v] of _goLiveCache) { if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; } }
    if (oldestKey != null) _goLiveCache.delete(oldestKey);
  }
  return facts;
}

// Read the last engine emit from disk (never CDP) to verify the deployed Pine.
async function readPineFact({ cdp, now }) {
  const fact = { cdp: cdp ?? "unknown", schema: null, schema_supported: null, code_rev: null, expected_code_rev: null, emit_ms: null, as_of: now };
  try {
    const [{ default: fs }, path, url, parser] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
      import("node:url"),
      import("../../cli/lib/ict-engine-parser.js"),
    ]);
    fact.expected_code_rev = Number.isFinite(parser.EXPECTED_CODE_REV) ? parser.EXPECTED_CODE_REV : null;
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const repo = path.resolve(dir, "..", "..");
    const stateDir = process.env.GOFNQ_STATE_DIR || path.join(repo, "state");
    // Prefer the freshest of the live scan / last analyze / baseline captures.
    const candidates = ["last-scan.json", "last-analyze.json", "baseline-MNQ1.json", "baseline.json"]
      .map((f) => path.join(stateDir, f));
    let best = null;
    for (const p of candidates) {
      try {
        const stat = await fs.stat(p);
        if (!best || stat.mtimeMs > best.mtimeMs) best = { p, mtimeMs: stat.mtimeMs };
      } catch { /* absent */ }
    }
    if (best) {
      const bundle = JSON.parse(await fs.readFile(best.p, "utf8"));
      const meta = bundle?.engine?.meta ?? null;
      if (meta) {
        fact.schema = Number.isFinite(meta.schema) ? meta.schema : null;
        fact.code_rev = Number.isFinite(meta.code_rev) ? meta.code_rev : null;
        fact.schema_supported = bundle?.engine?.schema_supported === true;
        fact.emit_ms = Number.isFinite(meta.emit_ms) ? meta.emit_ms : best.mtimeMs;
      }
    }
  } catch { /* leave nulls */ }
  return fact;
}

// collectSystemReadiness — the production entry point behind the IPC handler.
// Every input is a real getter or a disk read; anything that throws degrades to
// a null fact (→ unavailable row), never a fabricated pass.
export async function collectSystemReadiness({
  symbol = "MNQ1!",
  cwd = process.cwd(),
  env = process.env,
  getVersion,
  getHealth,
  getAccount,
} = {}) {
  const now = Date.now();
  const path = await import("node:path");
  const stateDir = env.GOFNQ_STATE_DIR || path.resolve("state");

  let version = null;
  try { const v = getVersion?.(); if (plainObject(v)) version = { ...v, as_of: Number.isFinite(v.checked_at) ? v.checked_at : now }; } catch { /* null */ }

  let health = null;
  try { const h = getHealth?.(); if (plainObject(h)) health = h; } catch { /* null */ }
  const healthAsOf = Number.isFinite(health?.as_of) ? health.as_of : now;
  const detector = health ? { loop: health.loop ?? null, heartbeat_age_s: health.heartbeat_age_s ?? null, cdp: health.cdp ?? null, turn_lag_s: health.turn_lag_s ?? null, as_of: healthAsOf } : null;
  const reconciliation = plainObject(health?.reconciliation) ? { ...health.reconciliation, as_of: healthAsOf } : null;
  const protection = plainObject(health?.protection) ? { ...health.protection, as_of: healthAsOf } : null;

  const pine = await readPineFact({ cdp: health?.cdp, now });

  let account = null;
  try { const a = await getAccount?.(); if (plainObject(a)) account = { ...a, as_of: now }; } catch { /* null */ }

  let automation = null;
  try {
    const { readExecConfig } = await import("./execution/config.js");
    const autoResume = await import("./execution/auto-resume.js");
    const cfg = readExecConfig() || {};
    const mode = cfg.automationMode ?? "manual";
    // AUTO only truly fires when EVERY runtime gate is open. Feed the real
    // gates so the row can't claim live-firing while a gate holds it paused:
    //   detector loop · protection watchdog · live boot-pause · reconciliation.
    const loopRunning = health?.loop === "healthy";
    const protectionOk = autoResume.getProtectionOk?.() !== false; // defaults open
    const reconHealthy = autoResume.getReconciliationHealthy?.() === true;
    const autoResumed = autoResume.getAutoResumed?.() === true;
    const liveConfirmed = account?.live === true && account?.route === true;
    let autoPauseReason = null;
    if (mode === "auto") {
      if (!loopRunning) autoPauseReason = "detector not running";
      else if (!protectionOk) autoPauseReason = "protection watchdog";
      else if (liveConfirmed && !autoResumed) autoPauseReason = "live auto paused after restart";
      else if (!reconHealthy) autoPauseReason = "reconciliation pending";
    }
    const autoPaused = mode === "auto" && autoPauseReason != null;
    automation = { mode, autoPaused, autoPauseReason, as_of: now };
  } catch { /* null */ }

  const goLive = await collectGoLiveFacts({ stateDir, symbol, cwd, env, now });

  return composeReadiness({ now, goLive, version, pine, detector, account, reconciliation, protection, automation });
}
