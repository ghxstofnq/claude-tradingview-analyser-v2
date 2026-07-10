import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tapeCodeRev } from "../cli/lib/tape-code-rev.js";

function mkRun(rev) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tcr-"));
  fs.mkdirSync(path.join(dir, "ny-am"), { recursive: true });
  const entry = rev == null ? { engine: { meta: {} } } : { engine: { meta: { code_rev: rev } } };
  fs.writeFileSync(path.join(dir, "ny-am", "tape.json"), JSON.stringify({ entries: [entry] }));
  return dir;
}

test("tapeCodeRev reads the first entry's engine code_rev", () => {
  assert.equal(tapeCodeRev(mkRun(2), "ny-am"), 2);
  assert.equal(tapeCodeRev(mkRun(1), "ny-am"), 1);
});

test("tapeCodeRev is null (fail-safe: not done) for pre-stamp, missing, or torn tapes", () => {
  assert.equal(tapeCodeRev(mkRun(null), "ny-am"), null);
  assert.equal(tapeCodeRev("/nonexistent/run", "ny-am"), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tcr-"));
  fs.mkdirSync(path.join(dir, "ny-am"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ny-am", "tape.json"), '{"entries":[{');
  assert.equal(tapeCodeRev(dir, "ny-am"), null);
});

test("tapeCodeRev skips entries without a finite rev and finds a later one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tcr-"));
  fs.mkdirSync(path.join(dir, "ny-pm"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ny-pm", "tape.json"),
    JSON.stringify({ entries: [{ engine: { meta: {} } }, { engine: { meta: { code_rev: 2 } } }] }),
  );
  assert.equal(tapeCodeRev(dir, "ny-pm"), 2);
});
