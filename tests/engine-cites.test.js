import { test } from "node:test";
import assert from "node:assert/strict";
import { annotateEngineByTfCites } from "../cli/lib/engine-cites.js";

// Stamp resolvable JSON-path cites on every engine zone so any consumer that
// picks one (the gate's pickPrimaryDraw → the forwarded draw) carries a citeable
// reference (constraint #6). Symbol-relative path, mirroring brief-digest.js.

test("stamps engine_by_tf.<tf>.fvgs[idx] / bprs[idx] / structures[idx] by index", () => {
  const e = {
    h4: {
      fvgs: [{ dir: "bull" }, { dir: "bear" }],
      bprs: [{ dir: "bull" }],
      structures: [{ event: "mss" }],
    },
    h1: { fvgs: [{ dir: "bear" }] },
  };
  annotateEngineByTfCites(e);
  assert.equal(e.h4.fvgs[0].cite, "engine_by_tf.h4.fvgs[0]");
  assert.equal(e.h4.fvgs[1].cite, "engine_by_tf.h4.fvgs[1]");
  assert.equal(e.h4.bprs[0].cite, "engine_by_tf.h4.bprs[0]");
  assert.equal(e.h4.structures[0].cite, "engine_by_tf.h4.structures[0]");
  assert.equal(e.h1.fvgs[0].cite, "engine_by_tf.h1.fvgs[0]");
});

test("idempotent — does not overwrite an existing cite", () => {
  const e = { h4: { fvgs: [{ dir: "bull", cite: "already.set[0]" }] } };
  annotateEngineByTfCites(e);
  assert.equal(e.h4.fvgs[0].cite, "already.set[0]");
});

test("fills a null/empty cite", () => {
  const e = { h4: { fvgs: [{ dir: "bull", cite: null }, { dir: "bear", cite: "" }] } };
  annotateEngineByTfCites(e);
  assert.equal(e.h4.fvgs[0].cite, "engine_by_tf.h4.fvgs[0]");
  assert.equal(e.h4.fvgs[1].cite, "engine_by_tf.h4.fvgs[1]");
});

test("no-op on null / non-object / missing arrays", () => {
  assert.equal(annotateEngineByTfCites(null), null);
  assert.doesNotThrow(() => annotateEngineByTfCites({ h4: null }));
  assert.doesNotThrow(() => annotateEngineByTfCites({ h4: { fvgs: "nope" } }));
});

test("returns the same (mutated) object", () => {
  const e = { h4: { fvgs: [{ dir: "bull" }] } };
  assert.equal(annotateEngineByTfCites(e), e);
});
