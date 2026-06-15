import { test } from "node:test";
import assert from "node:assert/strict";
import { __test } from "../app/main/bar-close.js";

const { scanBundleHasEngineRows, scanUntilEngineRows } = __test;

const withFvgs = { gates: { engine: { pillar3: { fvgs: [{}], bprs: [] } } } };
const withBprs = { gates: { engine: { pillar3: { fvgs: [], bprs: [{}] } } } };
const emptyEngine = { gates: { engine: { pillar3: { fvgs: [], bprs: [] } } } };

test("scanBundleHasEngineRows: true when fvgs or bprs present", () => {
  assert.equal(scanBundleHasEngineRows(withFvgs), true);
  assert.equal(scanBundleHasEngineRows(withBprs), true);
});

test("scanBundleHasEngineRows: false when engine empty / missing / null", () => {
  assert.equal(scanBundleHasEngineRows(emptyEngine), false);
  assert.equal(scanBundleHasEngineRows({}), false);
  assert.equal(scanBundleHasEngineRows(null), false);
});

test("scanUntilEngineRows: succeeds on the first attempt when rows are present", async () => {
  let calls = 0;
  const res = await scanUntilEngineRows({ scanFn: async () => { calls += 1; return withFvgs; }, sleep: async () => {} });
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 1);
  assert.equal(calls, 1);
});

test("scanUntilEngineRows: retries past an empty scan and succeeds with fresh rows", async () => {
  let calls = 0;
  const res = await scanUntilEngineRows({
    scanFn: async () => { calls += 1; return calls < 2 ? emptyEngine : withFvgs; },
    retries: 3, sleep: async () => {},
  });
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 2);
  assert.equal(calls, 2);
});

test("scanUntilEngineRows: gives up after N empty scans — never reuses stale rows", async () => {
  let calls = 0;
  const res = await scanUntilEngineRows({ scanFn: async () => { calls += 1; return emptyEngine; }, retries: 3, sleep: async () => {} });
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 3);
  assert.equal(calls, 3);
});

test("scanUntilEngineRows: surfaces a scan failure instead of retrying forever", async () => {
  const res = await scanUntilEngineRows({ scanFn: async () => { throw new Error("tv down"); }, retries: 3, sleep: async () => {} });
  assert.equal(res.ok, false);
  assert.equal(res.failed, true);
});
