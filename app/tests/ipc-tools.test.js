// Unit tests for the main-process tool wrappers (spawn stubbed).

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { tvAnalyzeFull, tvAnalyzeFast } from "../main/tools/tv-analyze.js";
import { tvAlertCreate, tvAlertList } from "../main/tools/tv-alerts.js";

function fakeProc({ exitCode = 0 } = {}) {
  const p = new EventEmitter();
  p.stderr = new EventEmitter();
  setImmediate(() => p.emit("close", exitCode));
  return p;
}

test("tvAnalyzeFull invokes ./bin/tv analyze --out and resolves with path", async () => {
  const calls = [];
  const fakeSpawn = (cmd, args, _opts) => {
    calls.push({ cmd, args });
    return fakeProc();
  };
  const res = await tvAnalyzeFull({}, { spawn: fakeSpawn, outPath: "/tmp/x.json", skipRead: true });
  assert.equal(res.path, "/tmp/x.json");
  assert.ok(calls[0].args.includes("analyze"));
  assert.ok(calls[0].args.includes("--out"));
  assert.ok(calls[0].args.includes("/tmp/x.json"));
  assert.ok(calls[0].cmd.endsWith("/bin/tv"));
});

test("tvAnalyzeFast adds --pillar3-only and optional --baseline", async () => {
  const calls = [];
  const fakeSpawn = (cmd, args) => {
    calls.push({ cmd, args });
    return fakeProc();
  };
  await tvAnalyzeFast({ baseline: "/tmp/b.json" }, { spawn: fakeSpawn, outPath: "/tmp/y.json", skipRead: true });
  const a = calls[0].args;
  assert.ok(a.includes("--pillar3-only"));
  assert.ok(a.includes("--baseline"));
  assert.ok(a.includes("/tmp/b.json"));
  assert.ok(a.includes("--out"));
  assert.ok(a.includes("/tmp/y.json"));
});

test("tvAnalyzeFast without baseline omits the flag", async () => {
  const calls = [];
  const fakeSpawn = (cmd, args) => {
    calls.push({ cmd, args });
    return fakeProc();
  };
  await tvAnalyzeFast({}, { spawn: fakeSpawn, outPath: "/tmp/y.json", skipRead: true });
  const a = calls[0].args;
  assert.ok(a.includes("--pillar3-only"));
  assert.equal(a.indexOf("--baseline"), -1);
});

test("non-zero exit code rejects with a useful error", async () => {
  const fakeSpawn = () => fakeProc({ exitCode: 2 });
  await assert.rejects(
    () => tvAnalyzeFull({}, { spawn: fakeSpawn, outPath: "/tmp/x.json", skipRead: true }),
    /exited 2/,
  );
});

test("tvAlertCreate passes price and label as --price / --message", async () => {
  const calls = [];
  const fakeSpawn = (cmd, args) => {
    calls.push(args);
    return fakeProc();
  };
  await tvAlertCreate({ price: 21540.25, label: "PDH" }, { spawn: fakeSpawn });
  const a = calls[0];
  assert.ok(a.includes("alert"));
  assert.ok(a.includes("create"));
  assert.deepEqual(a.slice(a.indexOf("--price"), a.indexOf("--price") + 2), ["--price", "21540.25"]);
  assert.deepEqual(a.slice(a.indexOf("--message"), a.indexOf("--message") + 2), ["--message", "PDH"]);
});

test("tvAlertList parses JSON stdout", async () => {
  const fakeSpawn = () => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    setImmediate(() => {
      p.stdout.emit("data", Buffer.from('[{"id":"1","status":"armed"}]'));
      p.emit("close", 0);
    });
    return p;
  };
  const res = await tvAlertList({}, { spawn: fakeSpawn });
  assert.deepEqual(res, [{ id: "1", status: "armed" }]);
});
