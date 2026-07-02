// app/main/env-snapshot.js
// Effective GOFNQ_* config snapshot — read-only auditability for live/backtest
// parity. The audit (Phase 4) found that GOFNQ_* levers are scattered across
// app/main/*, cli/lib/*, and scripts/*.mjs with per-key defaults, so there is no
// single place to see "what config was actually in effect for this run". This
// module produces that snapshot. It only OBSERVES process.env — it changes no
// default and no behavior.
//
// Two callers write it: the live app on boot (state/effective-config.json) and
// each backtest run (state/backtest/<run-id>/effective-config.json). Diff the two
// to audit parity. The default-resolution logic stays in config.js et al.; this
// snapshot records the raw env input, not the resolved default (reproducing every
// key's default here would duplicate that logic and risk drift).

import fs from "node:fs";
import path from "node:path";

// Registry of every GOFNQ_* key read via process.env in tracked non-test source.
// tests/env-snapshot.test.js greps the repo and fails if this drifts from what the
// code actually reads. Sorted for stable, diffable output.
export const KNOWN_GOFNQ_KEYS = Object.freeze([
  "GOFNQ_BRIEF_DIR_OVERRIDE",
  "GOFNQ_FAITHFUL_LEADER",
  "GOFNQ_FRESH_DRAW_HOLD",
  "GOFNQ_HTF_FALLBACK_STANDASIDE",
  "GOFNQ_HTF_INTRADAY_DRAW",
  "GOFNQ_HTF_STRUCT_ALIGN",
  "GOFNQ_INV_COHERENCE",
  "GOFNQ_INV_DEEP_COHERENCE",
  "GOFNQ_INV_DEPTH",
  "GOFNQ_INV_GATE",
  "GOFNQ_INV_GRAB_RECENCY",
  "GOFNQ_INV_OPEN_GATE",
  "GOFNQ_INV_OPEN_REACTION",
  "GOFNQ_INV_PATIENCE",
  "GOFNQ_INV_PATIENCE_RECENCY",
  "GOFNQ_INV_RECLAIM",
  "GOFNQ_INV_TREND_OVERRIDE",
  "GOFNQ_LIVE_CITE_CHECK",
  "GOFNQ_NEAR_PRICE_PCT",
  "GOFNQ_P1_HTF_FALLBACK",
  "GOFNQ_P2_DISP_HTF",
  "GOFNQ_P2_ENTRY",
  "GOFNQ_P2_ENTRY_N",
  "GOFNQ_P2_RANGE_PCT",
  "GOFNQ_P3_TREND_STOP",
  "GOFNQ_PM_CARRY_ONLY",
  "GOFNQ_REALIGN_TF",
  "GOFNQ_RECORD_BARS_ON_NULL",
  "GOFNQ_STATE_DIR",
  "GOFNQ_STOP_TF",
  "GOFNQ_STRONG_OVN_NET",
  "GOFNQ_STRUCTURE_TF",
  "GOFNQ_WAIT_FOR_REACTION",
]);

const SECRET_RE = /TOKEN|SECRET|PASSWORD|KEY|AUTH/;
const REDACTED = "[REDACTED]";

// Redact by NAME, not value: any GOFNQ_* key whose name looks credential-bearing
// never has its value written to disk. None of today's levers match — this is a
// forward-compat guard so a future GOFNQ_*_TOKEN can't leak through the snapshot.
export function isSecretLike(key) {
  return SECRET_RE.test(String(key));
}

// Best-effort normalization for diffability. "true"/"false" → boolean, a pure
// numeric string → number, everything else stays the original string. Unset → null.
// The raw value is always preserved alongside, so this is lossless for diffing.
export function normalizeEnvValue(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  const lower = t.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (t !== "" && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return raw;
}

function entryFor(key, env) {
  const has = Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined;
  if (has && isSecretLike(key)) {
    return { set: true, raw: REDACTED, effective: REDACTED, redacted: true };
  }
  const raw = has ? String(env[key]) : null;
  return { set: has, raw, effective: has ? normalizeEnvValue(raw) : null };
}

// Effective config snapshot: { vars: { GOFNQ_X: { set, raw, effective, redacted? } } }.
// Covers every known key (present or not) plus any GOFNQ_* actually in env — the
// latter catches typos and forward-compat flags the registry doesn't list yet.
// Keys are inserted in sorted order so JSON.stringify is stable and diffable.
// Pure: no timestamp, no I/O — identical env yields a byte-identical snapshot.
export function buildEnvSnapshot(env = process.env) {
  const keys = new Set(KNOWN_GOFNQ_KEYS);
  for (const k of Object.keys(env)) {
    if (k.startsWith("GOFNQ_")) keys.add(k);
  }
  const vars = {};
  for (const key of [...keys].sort()) {
    vars[key] = entryFor(key, env);
  }
  return { vars };
}

export function serializeEnvSnapshot(snapshot) {
  return JSON.stringify(snapshot, null, 2);
}

// Write the snapshot to <dir>/effective-config.json, wrapped with { source,
// captured_at }. Never throws into the caller — auditability must not be able to
// break a live boot or a backtest run; failures come back as { ok: false, error }.
export function writeEnvSnapshotFile({ dir, source = null, env = process.env } = {}) {
  const file = path.join(dir, "effective-config.json");
  const snapshot = { source, captured_at: new Date().toISOString(), ...buildEnvSnapshot(env) };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, serializeEnvSnapshot(snapshot) + "\n");
    return { ok: true, file, snapshot };
  } catch (error) {
    return { ok: false, file, error };
  }
}
