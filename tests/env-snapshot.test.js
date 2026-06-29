// tests/env-snapshot.test.js
// Effective GOFNQ_* config snapshot — read-only auditability for live/backtest
// parity. These tests prove: (1) the registry covers every GOFNQ_* key the
// tracked source actually reads via process.env; (2) bool/number/string
// normalization; (3) secret-like names are redacted; (4) output is stably sorted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KNOWN_GOFNQ_KEYS,
  normalizeEnvValue,
  isSecretLike,
  buildEnvSnapshot,
  serializeEnvSnapshot,
  writeEnvSnapshotFile,
} from "../app/main/env-snapshot.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Discover every GOFNQ_* key the non-test source reads via process.env. This is
// the same grep the audit used; the registry must stay a superset of it so a new
// lever added to the code can never silently escape the parity snapshot.
function discoverReferencedKeys() {
  let out = "";
  try {
    out = execFileSync(
      "git",
      ["grep", "-hoE", "process\\.env\\.GOFNQ_[A-Z0-9_]+", "--", "*.js", "*.mjs", "*.cjs", ":!tests/*", ":!*.test.js"],
      { cwd: repoRoot, encoding: "utf8" },
    );
  } catch (e) {
    // git grep exits 1 when there are zero matches — that itself is a failure here.
    if (e.status === 1 && !e.stdout) return [];
    throw e;
  }
  return [...new Set(out.split("\n").filter(Boolean).map((l) => l.replace("process.env.", "")))].sort();
}

test("registry covers every GOFNQ_* key referenced in tracked non-test source", () => {
  const referenced = discoverReferencedKeys();
  assert.ok(referenced.length > 0, "expected to discover at least one referenced GOFNQ_* key");
  const known = new Set(KNOWN_GOFNQ_KEYS);
  const missing = referenced.filter((k) => !known.has(k));
  assert.deepEqual(missing, [], `registry missing referenced keys: ${missing.join(", ")}`);
});

test("registry has no stale entries (every known key is actually referenced)", () => {
  const referenced = new Set(discoverReferencedKeys());
  const stale = KNOWN_GOFNQ_KEYS.filter((k) => !referenced.has(k));
  assert.deepEqual(stale, [], `registry has unreferenced keys: ${stale.join(", ")}`);
});

test("KNOWN_GOFNQ_KEYS is sorted and de-duplicated", () => {
  const sorted = [...KNOWN_GOFNQ_KEYS].sort();
  assert.deepEqual(KNOWN_GOFNQ_KEYS, sorted, "registry is not sorted");
  assert.equal(new Set(KNOWN_GOFNQ_KEYS).size, KNOWN_GOFNQ_KEYS.length, "registry has duplicates");
});

test("normalizeEnvValue: booleans", () => {
  assert.equal(normalizeEnvValue("true"), true);
  assert.equal(normalizeEnvValue("false"), false);
  assert.equal(normalizeEnvValue("TRUE"), true);
  assert.equal(normalizeEnvValue(" False "), false);
});

test("normalizeEnvValue: numbers", () => {
  assert.equal(normalizeEnvValue("0"), 0);
  assert.equal(normalizeEnvValue("1"), 1);
  assert.equal(normalizeEnvValue("200"), 200);
  assert.equal(normalizeEnvValue("0.3"), 0.3);
  assert.equal(normalizeEnvValue("-5"), -5);
});

test("normalizeEnvValue: strings and unset", () => {
  assert.equal(normalizeEnvValue("MNQ1!"), "MNQ1!");
  assert.equal(normalizeEnvValue("5m"), "5m");
  assert.equal(normalizeEnvValue("/tmp/x"), "/tmp/x");
  assert.equal(normalizeEnvValue(""), "");
  assert.equal(normalizeEnvValue(undefined), null);
  assert.equal(normalizeEnvValue(null), null);
});

test("isSecretLike: name-based redaction triggers", () => {
  for (const k of ["GOFNQ_API_KEY", "GOFNQ_AUTH_TOKEN", "GOFNQ_DB_PASSWORD", "GOFNQ_SECRET", "GOFNQ_X_AUTH"]) {
    assert.equal(isSecretLike(k), true, `${k} should be secret-like`);
  }
  for (const k of ["GOFNQ_PM_CARRY_ONLY", "GOFNQ_STRUCTURE_TF", "GOFNQ_STRONG_OVN_NET"]) {
    assert.equal(isSecretLike(k), false, `${k} should NOT be secret-like`);
  }
});

test("buildEnvSnapshot: per-key entry shape (set/unset, normalized effective)", () => {
  const env = {
    GOFNQ_PM_CARRY_ONLY: "0",       // number
    GOFNQ_HTF_INTRADAY_DRAW: "true", // boolean
    GOFNQ_STRONG_OVN_NET: "200",     // number
    GOFNQ_FAITHFUL_LEADER: "MNQ1!",  // string
    // GOFNQ_STATE_DIR intentionally unset
  };
  const { vars } = buildEnvSnapshot(env);
  assert.deepEqual(vars.GOFNQ_PM_CARRY_ONLY, { set: true, raw: "0", effective: 0 });
  assert.deepEqual(vars.GOFNQ_HTF_INTRADAY_DRAW, { set: true, raw: "true", effective: true });
  assert.deepEqual(vars.GOFNQ_STRONG_OVN_NET, { set: true, raw: "200", effective: 200 });
  assert.deepEqual(vars.GOFNQ_FAITHFUL_LEADER, { set: true, raw: "MNQ1!", effective: "MNQ1!" });
  // An unset known key is still present, marked unset, with no leaked value.
  assert.deepEqual(vars.GOFNQ_STATE_DIR, { set: false, raw: null, effective: null });
});

test("buildEnvSnapshot: includes every known key even with an empty env", () => {
  const { vars } = buildEnvSnapshot({});
  for (const k of KNOWN_GOFNQ_KEYS) {
    assert.ok(k in vars, `expected ${k} in snapshot`);
    assert.equal(vars[k].set, false);
  }
});

test("buildEnvSnapshot: secret-like values are redacted, never leaked", () => {
  const env = { GOFNQ_SESSION_TOKEN: "dummy-redact-one", GOFNQ_API_KEY: "dummy-redact-two" };
  const { vars } = buildEnvSnapshot(env);
  assert.deepEqual(vars.GOFNQ_SESSION_TOKEN, { set: true, raw: "[REDACTED]", effective: "[REDACTED]", redacted: true });
  assert.deepEqual(vars.GOFNQ_API_KEY, { set: true, raw: "[REDACTED]", effective: "[REDACTED]", redacted: true });
  const serialized = serializeEnvSnapshot(buildEnvSnapshot(env));
  assert.ok(!serialized.includes("dummy-redact-one"), "secret value leaked into serialized snapshot");
  assert.ok(!serialized.includes("dummy-redact-two"), "secret value leaked into serialized snapshot");
});

test("buildEnvSnapshot: redaction is name-based — even an empty secret value is redacted", () => {
  const { vars } = buildEnvSnapshot({ GOFNQ_EMPTY_SECRET: "" });
  assert.deepEqual(vars.GOFNQ_EMPTY_SECRET, { set: true, raw: "[REDACTED]", effective: "[REDACTED]", redacted: true });
});

test("buildEnvSnapshot: output is stably sorted regardless of env insertion order", () => {
  const a = buildEnvSnapshot({ GOFNQ_ZULU: "1", GOFNQ_ALPHA: "2", GOFNQ_MIKE: "3" });
  const b = buildEnvSnapshot({ GOFNQ_MIKE: "3", GOFNQ_ALPHA: "2", GOFNQ_ZULU: "1" });
  const keysA = Object.keys(a.vars);
  assert.deepEqual(keysA, [...keysA].sort(), "snapshot keys are not sorted");
  assert.equal(serializeEnvSnapshot(a), serializeEnvSnapshot(b), "same env, different order → different output");
});

test("buildEnvSnapshot: identical env → byte-identical snapshot (diffable)", () => {
  const env = { GOFNQ_PM_CARRY_ONLY: "0", GOFNQ_STRUCTURE_TF: "5" };
  assert.equal(serializeEnvSnapshot(buildEnvSnapshot(env)), serializeEnvSnapshot(buildEnvSnapshot(env)));
});

test("writeEnvSnapshotFile: writes effective-config.json with metadata, never throws", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-snap-"));
  const res = writeEnvSnapshotFile({ dir, source: "test", env: { GOFNQ_PM_CARRY_ONLY: "1" } });
  assert.equal(res.ok, true);
  assert.equal(res.file, path.join(dir, "effective-config.json"));
  const parsed = JSON.parse(fs.readFileSync(res.file, "utf8"));
  assert.equal(parsed.source, "test");
  assert.equal(typeof parsed.captured_at, "string");
  assert.ok(!Number.isNaN(Date.parse(parsed.captured_at)), "captured_at is not an ISO date");
  assert.deepEqual(parsed.vars.GOFNQ_PM_CARRY_ONLY, { set: true, raw: "1", effective: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("writeEnvSnapshotFile: returns {ok:false} instead of throwing on an unwritable dir", () => {
  // A path whose parent is a file, not a directory → mkdir/write fails.
  const f = fs.mkdtempSync(path.join(os.tmpdir(), "env-snap-"));
  const filePath = path.join(f, "iam-a-file");
  fs.writeFileSync(filePath, "x");
  const res = writeEnvSnapshotFile({ dir: path.join(filePath, "nope"), source: "test", env: {} });
  assert.equal(res.ok, false);
  assert.ok(res.error, "expected an error object on failure");
  fs.rmSync(f, { recursive: true, force: true });
});
