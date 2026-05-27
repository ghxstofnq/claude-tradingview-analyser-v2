import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compareBundles, isVolatilePath } from "../scripts/diff-bundle.js";

test("identical bundles report ok with no issues", () => {
  const a = { quote: { last: 29800.25 }, chart: { symbol: "MNQ1!" } };
  const b = { quote: { last: 29800.25 }, chart: { symbol: "MNQ1!" } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("number drift within 0.25pt tolerance passes", () => {
  const a = { quote: { last: 29800.25 } };
  const b = { quote: { last: 29800.50 } }; // +0.25pt — at threshold
  const result = compareBundles(a, b);
  assert.equal(result.ok, true);
});

test("number drift exceeding 0.25pt tolerance fails", () => {
  // Use a non-volatile path (engine.levels[].price is a static session level)
  const a = { engine: { levels: [{ price: 29800.25 }] } };
  const b = { engine: { levels: [{ price: 29801.00 }] } }; // +0.75pt
  const result = compareBundles(a, b);
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].kind, "number-drift");
  assert.equal(result.issues[0].path, "engine.levels[0].price");
});

test("missing key in b is reported", () => {
  const a = { quote: { last: 29800.25, bid: 29800.00 } };
  const b = { quote: { last: 29800.25 } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].kind, "missing-key");
  assert.equal(result.issues[0].path, "quote.bid");
});

test("extra key in b is reported", () => {
  const a = { quote: { last: 29800.25 } };
  const b = { quote: { last: 29800.25, extra: 1 } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].kind, "extra-key");
  assert.equal(result.issues[0].path, "quote.extra");
});

test("type mismatch (number vs string) is reported", () => {
  // Use a non-volatile path
  const a = { engine: { levels: [{ price: 29800.25 }] } };
  const b = { engine: { levels: [{ price: "29800.25" }] } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].kind, "type-mismatch");
});

test("array length mismatch is reported", () => {
  const a = { bars: [1, 2, 3] };
  const b = { bars: [1, 2] };
  const result = compareBundles(a, b);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].kind, "array-length");
  assert.equal(result.issues[0].path, "bars");
});

test("string mismatch is reported", () => {
  const a = { chart: { symbol: "MNQ1!" } };
  const b = { chart: { symbol: "MES1!" } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].kind, "string-mismatch");
});

test("nested arrays compared element-wise", () => {
  const a = { bars: [{ close: 29800 }, { close: 29810 }] };
  const b = { bars: [{ close: 29800.10 }, { close: 29810.20 }] }; // both within 0.25
  const result = compareBundles(a, b);
  assert.equal(result.ok, true);
});

test("volatile top-level timestamp is skipped", () => {
  const a = { timestamp: "2026-05-27T14:32:00.000Z", quote: { last: 29800 } };
  const b = { timestamp: "2026-05-27T14:32:45.000Z", quote: { last: 29800 } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, true);
});

test("volatile nested emit_ms is skipped", () => {
  const a = { gates: { engine: { meta: { emit_ms: 1779836400000 } } } };
  const b = { gates: { engine: { meta: { emit_ms: 1779836460000 } } } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, true);
});

test("volatile path emit_age_seconds is skipped", () => {
  const a = { gates: { engine: { meta: { emit_age_seconds: 12 } } } };
  const b = { gates: { engine: { meta: { emit_age_seconds: 47 } } } };
  const result = compareBundles(a, b);
  assert.equal(result.ok, true);
});

test("isVolatilePath matches documented volatile patterns", () => {
  // Wall-clock + emit-time fields (always advance between captures)
  assert.equal(isVolatilePath("timestamp"), true);
  assert.equal(isVolatilePath("gates.engine.meta.emit_ms"), true);
  assert.equal(isVolatilePath("gates.engine.meta.emit_age_seconds"), true);
  assert.equal(isVolatilePath("gates.engine.meta.stale"), true);
  assert.equal(isVolatilePath("gates.session.timestamp_et"), true);
  assert.equal(isVolatilePath("candidates.meta.timestamp_ms"), true);
  assert.equal(isVolatilePath("candidates.meta.bar_close_ms"), true);

  // Live tick / aggregates (change every tick)
  assert.equal(isVolatilePath("quote.last"), true);
  assert.equal(isVolatilePath("quote.time"), true);
  assert.equal(isVolatilePath("bars.open"), true);
  assert.equal(isVolatilePath("bars.last_5_bars"), true);
  assert.equal(isVolatilePath("bars_by_tf.daily.high"), true);
  assert.equal(isVolatilePath("bars_by_tf.h4.last_5_bars"), true);
  assert.equal(isVolatilePath("visible_range.bars_range.from"), true);

  // Engine quality + meta (recomputed each bar close)
  assert.equal(isVolatilePath("engine.quality.range_3h"), true);
  assert.equal(isVolatilePath("engine.quality.atr_14"), true);
  assert.equal(isVolatilePath("engine_by_tf.h1.meta.emit_ms"), true);
  assert.equal(isVolatilePath("gates.engine.confirmation.last_bar"), true);

  // Indicators payload (intentionally variable across chart setups)
  assert.equal(isVolatilePath("indicators"), true);
  assert.equal(isVolatilePath("indicators.studies"), true);

  // Non-volatile (must still be compared)
  assert.equal(isVolatilePath("chart.symbol"), false);
  assert.equal(isVolatilePath("chart.resolution"), false);
  assert.equal(isVolatilePath("engine.schema"), false);
  assert.equal(isVolatilePath("engine.levels"), false);
  assert.equal(isVolatilePath("engine.fvgs"), false);
  assert.equal(isVolatilePath("gates.engine.pillar1"), false);
  assert.equal(isVolatilePath("candidates.best_candidate"), false);
});

test("null/undefined handled correctly", () => {
  const a = { engine_by_tf: null };
  const b = { engine_by_tf: null };
  assert.equal(compareBundles(a, b).ok, true);

  const c = { engine_by_tf: null };
  const d = { engine_by_tf: { daily: {} } };
  assert.equal(compareBundles(c, d).ok, false);
});

test("two identical real fixture bundles compare ok", () => {
  // Self-compare guards against the diff falsely flagging real bundle shapes.
  // Uses an existing fixture so we exercise the full nested shape, not toys.
  const bundle = JSON.parse(
    fs.readFileSync(path.resolve("tests/fixtures/001-current.bundle.json"), "utf8")
  );
  const copy = JSON.parse(JSON.stringify(bundle));
  const result = compareBundles(bundle, copy);
  assert.equal(result.ok, true, `unexpected issues: ${JSON.stringify(result.issues.slice(0, 3))}`);
});
