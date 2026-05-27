#!/usr/bin/env node
// scripts/diff-bundle.js — structural compare of two `./bin/tv analyze --out` bundles.
//
// Used during the webview migration to confirm the in-app webview produces an
// analyze bundle structurally identical to the one TV Desktop produces for the
// same chart state. Numeric fields tolerate 0.25pt drift (TV web↔desktop data
// feed precision). Timestamps and emission-age fields are skipped because
// they always differ between captures taken seconds apart.
//
// Exports pure functions for unit testing. The bottom of the file is the CLI.

import fs from "node:fs";

const DEFAULT_TOLERANCE = 0.25;

// Paths that always differ between two captures of the same chart state.
// Each pattern is matched against the dot-joined property path (e.g.
// "gates.engine.meta.emit_ms"). Listed explicitly — no wildcards beyond
// what's encoded here — so volatility is auditable.
//
// Categories:
//   1. Wall-clock / emit timestamps — always advance between captures.
//   2. Live tick data (quote, bars) — change every tick.
//   3. Live aggregates (period, OHLCV, range, change, volume, avg_volume) —
//      derived from live ticks, so change every tick.
//   4. Visible-range / viewport — depends on whatever the chart was showing
//      at capture time, not on the underlying data.
//   5. Engine meta + quality (ATR, range_3h, session) — recomputed each
//      bar close.
//   6. Session gate (timestamp_et, label, phase, killzone state, etc.) —
//      derived from the system clock, so advances every capture.
//
// What remains compared:
//   - Top-level schema (every expected key present in both bundles)
//   - chart.symbol / chart.resolution / chart.chartType
//   - engine.schema, engine.schema_supported
//   - engine.levels[], engine.fvgs[], engine.bprs[], engine.swings[],
//     engine.structures[], engine.pools[] (counts + per-entry shape)
//   - engine_by_tf.<tf>.{levels, fvgs, bprs, swings, structures, pools}
//   - gates.engine.pillar1/pillar2/pillar3 (engine-derived structure)
//   - candidates (detector output shape)
const VOLATILE_PATHS = [
  // Wall-clock timestamps
  /^timestamp$/,

  // Viewport / visible-range
  /^visible_range\./,

  // Live tick data
  /^quote\./,

  // Live aggregates at the current TF
  /^bars\.(period|open|close|high|low|range|change|change_pct|volume|avg_volume|last_5_bars)/,

  // Live aggregates per timeframe
  /^bars_by_tf\.[a-z_0-9]+\.(period|open|close|high|low|range|change|change_pct|volume|avg_volume|last_5_bars)/,

  // Indicators payload (the raw studies object — its content is dictated by
  // which indicators are on the chart, which is intentionally allowed to vary
  // between Desktop and webview chart setups for this migration)
  /^indicators$/,
  /^indicators\./,

  // Engine emit times / staleness / session derived
  /^engine\.meta\.emit_ms$/,
  /^engine\.meta\.emit_ny$/,
  /^engine\.meta\.emit_age_seconds$/,
  /^engine\.meta\.stale$/,
  /^engine\.quality\.range_3h$/,
  /^engine\.quality\.atr_14$/,
  /^engine\.quality\.atr_17$/,
  /^engine\.quality\.session$/,

  // Per-TF engine meta + quality (live-derived)
  /^engine_by_tf\.[a-z_0-9]+\.meta\./,
  /^engine_by_tf\.[a-z_0-9]+\.quality\./,

  // Session gate (clock-derived)
  /^gates\.session\./,

  // Engine gate meta + price-context (live tick + recomputation)
  /^gates\.engine\.meta\./,
  /^gates\.engine\.price_context\./,
  /^gates\.engine\.confirmation\./,

  // Detector meta (timestamp_ms, bar_close_ms)
  /^candidates\.meta\./,

  // Baseline reuse metadata (--baseline)
  /^baseline_meta\./,
];

export function isVolatilePath(path) {
  return VOLATILE_PATHS.some((re) => re.test(path));
}

export function compareBundles(a, b, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const issues = [];
  walk(a, b, "", issues, tolerance);
  return { ok: issues.length === 0, issues };
}

function walk(a, b, path, issues, tolerance) {
  if (isVolatilePath(path)) return;

  // null/undefined handling — both null is fine, mismatch is a type-mismatch issue.
  if (a === null || b === null || a === undefined || b === undefined) {
    if (a === b) return;
    issues.push({ path, kind: "type-mismatch", expected: a, actual: b });
    return;
  }

  // Type check first.
  const ta = Array.isArray(a) ? "array" : typeof a;
  const tb = Array.isArray(b) ? "array" : typeof b;
  if (ta !== tb) {
    issues.push({ path, kind: "type-mismatch", expected: a, actual: b });
    return;
  }

  if (ta === "array") {
    if (a.length !== b.length) {
      issues.push({
        path,
        kind: "array-length",
        expected: a.length,
        actual: b.length,
      });
      return;
    }
    for (let i = 0; i < a.length; i++) {
      walk(a[i], b[i], `${path}[${i}]`, issues, tolerance);
    }
    return;
  }

  if (ta === "object") {
    const aKeys = new Set(Object.keys(a));
    const bKeys = new Set(Object.keys(b));
    for (const k of aKeys) {
      if (!bKeys.has(k)) {
        issues.push({
          path: path ? `${path}.${k}` : k,
          kind: "missing-key",
          expected: a[k],
          actual: undefined,
        });
      }
    }
    for (const k of bKeys) {
      if (!aKeys.has(k)) {
        issues.push({
          path: path ? `${path}.${k}` : k,
          kind: "extra-key",
          expected: undefined,
          actual: b[k],
        });
      }
    }
    for (const k of aKeys) {
      if (bKeys.has(k)) {
        walk(a[k], b[k], path ? `${path}.${k}` : k, issues, tolerance);
      }
    }
    return;
  }

  if (ta === "number") {
    if (!Number.isFinite(a) && !Number.isFinite(b)) return; // NaN === NaN
    if (Math.abs(a - b) > tolerance) {
      issues.push({
        path,
        kind: "number-drift",
        expected: a,
        actual: b,
        delta: b - a,
      });
    }
    return;
  }

  if (ta === "string") {
    if (a !== b) {
      issues.push({ path, kind: "string-mismatch", expected: a, actual: b });
    }
    return;
  }

  if (ta === "boolean") {
    if (a !== b) {
      issues.push({ path, kind: "type-mismatch", expected: a, actual: b });
    }
    return;
  }
}

// ---------------------------- CLI ----------------------------
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [, , aPath, bPath] = process.argv;
  if (!aPath || !bPath) {
    console.error("usage: scripts/diff-bundle.js <baseline.json> <new.json>");
    process.exit(2);
  }
  const a = JSON.parse(fs.readFileSync(aPath, "utf8"));
  const b = JSON.parse(fs.readFileSync(bPath, "utf8"));
  const { ok, issues } = compareBundles(a, b);
  if (ok) {
    console.log(`PASS: ${aPath} ≈ ${bPath} (no structural differences, all numbers within 0.25pt)`);
    process.exit(0);
  }
  console.log(`FAIL: ${issues.length} issue(s) found`);
  for (const issue of issues.slice(0, 50)) {
    if (issue.kind === "number-drift") {
      console.log(`  ${issue.kind}  ${issue.path}: ${issue.expected} → ${issue.actual} (Δ${issue.delta?.toFixed(4)})`);
    } else {
      console.log(`  ${issue.kind}  ${issue.path}: ${JSON.stringify(issue.expected)} vs ${JSON.stringify(issue.actual)}`);
    }
  }
  if (issues.length > 50) console.log(`  … and ${issues.length - 50} more`);
  process.exit(1);
}
