// tests/tv-launcher.test.js
// The one-click "relaunch TradingView with the CDP flag" flow (constraint #1
// recipe) plus the health monitor's loop derivation. All side effects are
// injected — no real app is quit or launched here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { probeCdp, relaunchTvWithCdp, CDP_PORT } from "../app/main/tv-launcher.js";
import { deriveLoop } from "../app/main/health.js";

const noSleep = async () => {};

// Sequenced async stub: returns the queued values in order, then repeats the last.
function seq(...values) {
  let i = 0;
  const fn = async (...args) => {
    fn.calls.push(args);
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v;
  };
  fn.calls = [];
  return fn;
}

function recorder() {
  const fn = async (cmd) => { fn.cmds.push(cmd); return { stdout: "", stderr: "" }; };
  fn.cmds = [];
  return fn;
}

describe("probeCdp", () => {
  it("true when /json/version answers ok", async () => {
    assert.equal(await probeCdp({ fetchFn: async () => ({ ok: true }) }), true);
  });
  it("false on non-ok response", async () => {
    assert.equal(await probeCdp({ fetchFn: async () => ({ ok: false }) }), false);
  });
  it("false when the port is closed (fetch throws)", async () => {
    assert.equal(await probeCdp({ fetchFn: async () => { throw new Error("ECONNREFUSED"); } }), false);
  });
});

describe("relaunchTvWithCdp", () => {
  it("short-circuits when CDP is already up — touches nothing", async () => {
    const run = recorder();
    const r = await relaunchTvWithCdp({ probeCdp: seq(true), tvRunning: seq(false), run, sleep: noSleep });
    assert.deepEqual(r, { ok: true, already: true });
    assert.equal(run.cmds.length, 0);
  });

  it("quits a running flagless TV, reopens with the debug flag, waits for CDP", async () => {
    const run = recorder();
    const r = await relaunchTvWithCdp({
      probeCdp: seq(false, false, true),   // down → still down after launch → up
      tvRunning: seq(true, true, false),   // running → still exiting → gone
      run, sleep: noSleep,
    });
    assert.equal(r.ok, true);
    assert.equal(run.cmds[0], `osascript -e 'quit app "TradingView"'`);
    assert.equal(run.cmds[1], `open -a TradingView --args --remote-debugging-port=${CDP_PORT}`);
  });

  it("skips the quit when TV isn't running at all", async () => {
    const run = recorder();
    const r = await relaunchTvWithCdp({ probeCdp: seq(false, true), tvRunning: seq(false), run, sleep: noSleep });
    assert.equal(r.ok, true);
    assert.equal(run.cmds.length, 1);
    assert.match(run.cmds[0], /^open -a TradingView/);
  });

  it("fails honestly when TV won't quit (blocking dialog)", async () => {
    const run = recorder();
    const r = await relaunchTvWithCdp({
      probeCdp: seq(false), tvRunning: seq(true), run, sleep: noSleep, quitAttempts: 3,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /didn't quit/);
    assert.equal(run.cmds.length, 1); // quit attempted, open never issued
  });

  it("fails honestly when CDP never answers after launch", async () => {
    const run = recorder();
    const r = await relaunchTvWithCdp({
      probeCdp: seq(false), tvRunning: seq(false), run, sleep: noSleep, cdpAttempts: 3,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, new RegExp(String(CDP_PORT)));
  });

  it("rejects a second relaunch while one is in flight", async () => {
    let release;
    const gate = new Promise((res) => { release = res; });
    const first = relaunchTvWithCdp({
      probeCdp: async () => { await gate; return true; },
      tvRunning: seq(false), run: recorder(), sleep: noSleep,
    });
    const second = await relaunchTvWithCdp({ probeCdp: seq(true), tvRunning: seq(false), run: recorder(), sleep: noSleep });
    assert.equal(second.ok, false);
    assert.match(second.error, /in progress/);
    release();
    assert.equal((await first).ok, true);
  });
});

describe("deriveLoop", () => {
  it("a dead CDP backend outranks a fresh heartbeat — the June/July blind spot", () => {
    assert.equal(deriveLoop({ hbAge: 2, turnLagSec: 0, cdpUp: false }), "down");
  });
  it("cdp unknown (null) falls through to heartbeat logic", () => {
    assert.equal(deriveLoop({ hbAge: 2, turnLagSec: 0, cdpUp: null }), "healthy");
  });
  it("preserves the original states: healthy / stale / down", () => {
    assert.equal(deriveLoop({ hbAge: 5, turnLagSec: 10, cdpUp: true }), "healthy");
    assert.equal(deriveLoop({ hbAge: 45, turnLagSec: 0, cdpUp: true }), "stale");
    assert.equal(deriveLoop({ hbAge: 10, turnLagSec: 120, cdpUp: true }), "stale");
    assert.equal(deriveLoop({ hbAge: 200, turnLagSec: 0, cdpUp: true }), "down");
    assert.equal(deriveLoop({ hbAge: Infinity, turnLagSec: 0, cdpUp: true }), "down");
  });
});
