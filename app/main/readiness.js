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
  return row(META.pine, { status: PASS, evidence, age_s, reason: `engine schema ${p.schema ?? "?"} · code_rev ${p.code_rev} verified` });
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
      return row(META.automation, { status: WARN, evidence, age_s, reason: `AUTO armed but paused${m.autoPauseReason ? `: ${m.autoPauseReason}` : ""}` });
    }
    return row(META.automation, { status: PASS, evidence, age_s, reason: "AUTO — fires when all deterministic + risk gates pass" });
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
// The go-live cert/tests/approval facts are cached briefly so a renderer poll
// doesn't re-spawn git / re-read parity artifacts every second.
let _goLiveCache = { at: 0, value: null, sym: null };
const GOLIVE_TTL_MS = 20_000;

// Map one backtest-verdict gate → the { status, reason, evidence, as_of } fact
// shape the reducer's go-live rows consume. Reuses the gate's own status/reason.
function gateFact(gate, as_of) {
  if (!plainObject(gate)) return null;
  const status = gate.status === "pass" ? "pass" : gate.status === "pending" ? "pending" : "fail";
  return { status, reason: gate.reason ?? null, evidence: plainObject(gate.evidence) ? gate.evidence : null, as_of };
}

async function collectGoLiveFacts({ stateDir, symbol, cwd, env, now }) {
  if (_goLiveCache.value && _goLiveCache.sym === symbol && (now - _goLiveCache.at) < GOLIVE_TTL_MS) {
    return _goLiveCache.value;
  }
  let facts = { tests: null, corpus: null, parity: null, strategy_approval: null };
  try {
    const { collectBacktestReadiness } = await import("../../cli/lib/backtest-readiness.js");
    // baseline:null skips the (expensive) corpus fold — the go-live net-R
    // verdict stays the Backtest page's job; the System card only needs the
    // mechanical cert/tests/approval gates, which are computed either way.
    const r = await collectBacktestReadiness({ stateDir, symbol, cwd, env, baseline: null });
    const g = Array.isArray(r?.gates) ? new Map(r.gates.map((x) => [x.id, x])) : new Map();
    facts = {
      tests: gateFact(g.get("tests"), now),
      corpus: gateFact(g.get("corpus"), now),
      parity: gateFact(g.get("parity"), now),
      strategy_approval: gateFact(g.get("strategy_review"), now),
    };
  } catch { /* leave nulls → rows render unavailable, fail-closed */ }
  _goLiveCache = { at: now, value: facts, sym: symbol };
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
    const cfg = readExecConfig() || {};
    const mode = cfg.automationMode ?? "manual";
    const loopRunning = health?.loop === "healthy";
    const guards = plainObject(cfg.guards) ? cfg.guards : {};
    const autoPaused = mode === "auto" && !loopRunning;
    automation = { mode, autoPaused, autoPauseReason: autoPaused ? "detector not running" : null, as_of: now, _guards: guards };
  } catch { /* null */ }

  const goLive = await collectGoLiveFacts({ stateDir, symbol, cwd, env, now });

  return composeReadiness({ now, goLive, version, pine, detector, account, reconciliation, protection, automation });
}
