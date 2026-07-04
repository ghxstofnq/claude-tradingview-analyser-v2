// app/main/fixtures.js — read-only fixtures runner for the System page. Lists the
// hand-graded regression pairs under tests/fixtures/ and shells the existing
// smoke/verify scripts to RUN them. No money-path, no writes to state/, no
// edit/delete (editing citation ground-truth from the UI is a footgun — do it in
// git). Path-traversal-safe; never throws to the caller.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const FIX_DIR = join(REPO_ROOT, "tests", "fixtures");
const OUT_CAP = 16 * 1024;

// Reject any id that isn't a plain fixture basename — never interpolate raw
// renderer input into a path.
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const cap = (s) => (s.length > OUT_CAP ? s.slice(-OUT_CAP) : s);

// LIST — pure disk read, top-level *.bundle.json only (subdirs are not fixtures).
export function listFixtures() {
  let names = [];
  try { names = readdirSync(FIX_DIR).filter((f) => f.endsWith(".bundle.json")).sort(); }
  catch { return { ok: false, error: "tests/fixtures not found", fixtures: [] }; }
  const fixtures = names.map((f) => {
    const base = f.replace(/\.bundle\.json$/, "");
    const bundlePath = join(FIX_DIR, f);
    const expectedPath = join(FIX_DIR, `${base}.expected.md`);
    let sizeBytes = 0, mtimeMs = null;
    try { const st = statSync(bundlePath); sizeBytes = st.size; mtimeMs = st.mtimeMs; } catch { /* ignore */ }
    return { id: base, name: base, bundlePath, expectedPath, hasExpected: existsSync(expectedPath), sizeBytes, mtimeMs };
  });
  return { ok: true, fixtures };
}

// RUN ONE — citation-check a fixture that has an expected.md; schema-only fixtures
// (no expected.md) report "skipped". Never throws.
export function runFixture(id) {
  return new Promise((resolve) => {
    if (!SAFE_ID.test(String(id || ""))) return resolve({ ok: false, status: "fail", output: "invalid fixture id" });
    const bundlePath = join(FIX_DIR, `${id}.bundle.json`);
    const expectedPath = join(FIX_DIR, `${id}.expected.md`);
    if (!existsSync(bundlePath)) return resolve({ ok: false, status: "fail", output: "unknown fixture" });
    if (!existsSync(expectedPath)) {
      try {
        const b = JSON.parse(readFileSync(bundlePath, "utf8"));
        const REQUIRED_TOP = ["timestamp", "chart", "visible_range", "quote", "bars", "bars_by_tf", "indicators", "engine", "engine_by_tf", "gates"];
        const missing = REQUIRED_TOP.filter((k) => !(k in b));
        return resolve({ ok: missing.length === 0, status: missing.length ? "fail" : "skipped",
          output: missing.length ? `schema missing: ${missing.join(", ")}` : "schema OK (no expected.md — citation check skipped)" });
      } catch (e) { return resolve({ ok: false, status: "fail", output: `invalid JSON: ${e.message}` }); }
    }
    const child = spawn("node", ["scripts/verify-citations.js", expectedPath, bundlePath], { cwd: REPO_ROOT, timeout: 30_000 });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ ok: false, status: "fail", output: `spawn error: ${e.message}` }));
    child.on("close", (code) => resolve({ ok: code === 0, status: code === 0 ? "pass" : "fail", exitCode: code, output: cap((out + err).trim()) }));
  });
}

// RUN ALL — shell the whole smoke:fixtures runner once (matches CI); parse the
// trailing PASS/FAIL summary.
export function runAllFixtures() {
  return new Promise((resolve) => {
    const child = spawn("node", ["scripts/smoke-fixtures.js"], { cwd: REPO_ROOT, timeout: 120_000 });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ ok: false, status: "fail", output: `spawn error: ${e.message}` }));
    child.on("close", (code) => {
      const combined = (out + err).trim();
      const m = combined.match(/(PASS|FAIL): (\d+)\/(\d+) checks across (\d+) fixture/);
      resolve({ ok: code === 0, status: code === 0 ? "pass" : "fail", exitCode: code,
        passed: m ? Number(m[2]) : null, total: m ? Number(m[3]) : null, fixtures: m ? Number(m[4]) : null, output: cap(combined) });
    });
  });
}

// REVIEW — read a fixture's expected.md for the viewer (5MB cap).
export function readFixtureExpected(id) {
  if (!SAFE_ID.test(String(id || ""))) return { ok: false, error: "invalid fixture id" };
  const p = join(FIX_DIR, `${id}.expected.md`);
  if (!existsSync(p)) return { ok: false, error: "no expected.md for this fixture" };
  const st = statSync(p);
  if (st.size > 5 * 1024 * 1024) return { ok: false, error: "file too large" };
  return { ok: true, content: readFileSync(p, "utf8"), size: st.size };
}
