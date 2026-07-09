import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(repoRoot, "scripts", "gate-corpus", "parity-diff.py");
const DIGEST = "a".repeat(64);

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function writePair(dir, { mismatch = false } = {}) {
  const tape = path.join(dir, "tape.json");
  const live = path.join(dir, "live.jsonl");
  const engine = {
    meta: { schema: 4, code_rev: 1, symbol: "MNQ1!" },
    levels: [{ name: "PDH", price: 100, swept: false, state: "fresh" }],
    fvgs: [],
    bprs: [],
    structures: [],
    pools: [],
  };
  const tapeEntry = {
    // Backtest-engine tapes carry the closed bar in last_5_bars; event.ohlc
    // and bars.last_bar are intentionally absent in the production artifact.
    event: { ts: "2026-06-01T13:29:00.000Z" },
    inputs: { bundle: { engine, bars: { last_5_bars: [{ time: 1, open: 1, high: 2, low: 1, close: 2 }] } } },
  };
  const liveEntry = {
    event: { ts: "2026-06-01T13:29:00.000Z", ohlc: { open: 1, high: mismatch ? 3 : 2, low: 1, close: 2 } },
    inputs: { bundle: { engine } },
  };
  fs.writeFileSync(tape, JSON.stringify({ date: "2026-06-01", session: "ny-am", entries: [tapeEntry] }));
  fs.writeFileSync(live, `${JSON.stringify(liveEntry)}\n`);
  return { tape, live };
}

test("parity-diff writes structured certificate only on exact PASS", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-cert-"));
  const { tape, live } = writePair(dir);
  const certPath = path.join(dir, "cert.json");
  const res = spawnSync("python3", [
    SCRIPT,
    tape,
    live,
    "--certificate-out", certPath,
    "--manifest-id", "gate-corpus-2026-h1-v1",
    "--selection-digest", DIGEST,
    "--schema", "4",
    "--code-rev", "1",
  ], { encoding: "utf8" });

  assert.equal(res.status, 0, res.stdout + res.stderr);
  const cert = JSON.parse(fs.readFileSync(certPath, "utf8"));
  assert.equal(cert.schema_version, "gate-corpus-parity-certificate/v1");
  assert.equal(cert.generator, "scripts/gate-corpus/parity-diff.py");
  assert.equal(cert.verdict, "PASS");
  assert.equal(cert.manifest_id, "gate-corpus-2026-h1-v1");
  assert.equal(cert.selection_digest, DIGEST);
  assert.deepEqual(cert.engine, { schema: 4, code_rev: 1 });
  assert.deepEqual(cert.scope, { date: "2026-06-01", session: "ny-am", symbol: "MNQ1!" });
  assert.equal(cert.sources.tape.path, path.resolve(tape));
  assert.equal(cert.sources.live.path, path.resolve(live));
  assert.equal(cert.sources.tape.sha256, sha256File(tape));
  assert.equal(cert.sources.live.sha256, sha256File(live));
  assert.deepEqual(cert.mismatch_counts, { alignment: 0, ohlc: 0, hard: 0 });
  assert.ok(Number.isFinite(Date.parse(cert.generated_at)));
});

test("parity-diff exits nonzero and does not write positive certificate on mismatch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-cert-"));
  const { tape, live } = writePair(dir, { mismatch: true });
  const certPath = path.join(dir, "cert.json");
  const res = spawnSync("python3", [
    SCRIPT,
    tape,
    live,
    "--certificate-out", certPath,
    "--manifest-id", "gate-corpus-2026-h1-v1",
    "--selection-digest", DIGEST,
    "--schema", "4",
    "--code-rev", "1",
  ], { encoding: "utf8" });

  assert.notEqual(res.status, 0);
  assert.equal(fs.existsSync(certPath), false);
  assert.match(res.stdout, /FAIL|PASS-WITH-NOTES/);
});

test("parity-diff removes stale output and rejects empty inputs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-cert-"));
  const tape = path.join(dir, "empty-tape.json");
  const live = path.join(dir, "empty-live.jsonl");
  const certPath = path.join(dir, "cert.json");
  fs.writeFileSync(tape, JSON.stringify({ entries: [] }));
  fs.writeFileSync(live, "");
  fs.writeFileSync(certPath, JSON.stringify({ verdict: "PASS", stale: true }));
  const res = spawnSync("python3", [
    SCRIPT, tape, live,
    "--certificate-out", certPath,
    "--manifest-id", "gate-corpus-2026-h1-v1",
    "--selection-digest", DIGEST,
    "--schema", "4",
    "--code-rev", "1",
  ], { encoding: "utf8" });
  assert.notEqual(res.status, 0);
  assert.equal(fs.existsSync(certPath), false);
});

test("parity-diff rejects duplicate event keys and missing OHLC evidence", () => {
  const duplicateDir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-cert-"));
  const pair = writePair(duplicateDir);
  const row = fs.readFileSync(pair.live, "utf8").trim();
  fs.writeFileSync(pair.live, `${row}
${row}
`);
  const duplicate = spawnSync("python3", [SCRIPT, pair.tape, pair.live], { encoding: "utf8" });
  assert.notEqual(duplicate.status, 0);

  const missingDir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-cert-"));
  const missing = writePair(missingDir);
  const liveEntry = JSON.parse(fs.readFileSync(missing.live, "utf8"));
  delete liveEntry.event.ohlc;
  fs.writeFileSync(missing.live, `${JSON.stringify(liveEntry)}
`);
  const noOhlc = spawnSync("python3", [SCRIPT, missing.tape, missing.live], { encoding: "utf8" });
  assert.notEqual(noOhlc.status, 0);
});

test("parity-diff refuses malformed selection digests", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-cert-"));
  const { tape, live } = writePair(dir);
  const certPath = path.join(dir, "cert.json");
  const res = spawnSync("python3", [
    SCRIPT, tape, live,
    "--certificate-out", certPath,
    "--manifest-id", "gate-corpus-2026-h1-v1",
    "--selection-digest", "abc123",
    "--schema", "4",
    "--code-rev", "1",
  ], { encoding: "utf8" });
  assert.notEqual(res.status, 0);
  assert.equal(fs.existsSync(certPath), false);
});
