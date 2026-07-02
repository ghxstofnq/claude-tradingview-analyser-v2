// Regression for audit C29: the cite-or-reject resolver (constraint #6) is now
// a shared module so live LLM output can be checked with the SAME logic as the
// fixture harness. Value-resolving, not syntax-only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getByPath, approxEqual, extractCitations, verifyCitations } from "../cli/lib/cite-check.js";

const bundle = {
  quote: { last: 29172.75 },
  engine_by_tf: { h4: { fvgs: [{ top: 29302.75, bottom: 29290.0 }] } },
  pair: { symbols: { "MNQ1!": { quote: { last: 21000.25 } } } },
};

describe("getByPath", () => {
  it("resolves dotted + indexed + bang paths", () => {
    assert.equal(getByPath(bundle, "quote.last"), 29172.75);
    assert.equal(getByPath(bundle, "engine_by_tf.h4.fvgs[0].top"), 29302.75);
    assert.equal(getByPath(bundle, "pair.symbols.MNQ1!.quote.last"), 21000.25);
    assert.equal(getByPath(bundle, "quote.missing"), undefined);
  });
});

describe("extractCitations", () => {
  it("captures path-shaped parentheticals", () => {
    const cites = extractCitations("entry 29172.75 (quote.last), tp 29302.75 (engine_by_tf.h4.fvgs[0].top)");
    assert.deepEqual(cites.map((c) => c.path), ["quote.last", "engine_by_tf.h4.fvgs[0].top"]);
  });
  it("skips parentheticals that are not path-shaped (multi-word prose)", () => {
    const cites = extractCitations("held 29160 (prior day close) then 29172.75 (quote.last)");
    assert.deepEqual(cites.map((c) => c.path), ["quote.last"]);
  });
  it("a bare single-word parenthetical like (close) IS treated as a path so #6 catches it", () => {
    // constraint #6 forbids '29160 (close)'; the checker must flag it, not ignore it.
    const { violations } = verifyCitations("29160 (close)", bundle);
    assert.equal(violations.length, 1);
    assert.match(violations[0].reason, /not present/);
  });
});

describe("verifyCitations (value-resolving)", () => {
  it("passes when cited numbers match the bundle", () => {
    const { violations, checked } = verifyCitations("29172.75 (quote.last) and 29302.75 (engine_by_tf.h4.fvgs[0].top)", bundle);
    assert.equal(violations.length, 0);
    assert.equal(checked.length, 2);
  });
  it("flags a hallucinated value (right path, wrong number)", () => {
    const { violations } = verifyCitations("29999.99 (quote.last)", bundle);
    assert.equal(violations.length, 1);
    assert.match(violations[0].reason, /bundle has 29172.75/);
  });
  it("flags a hallucinated path (not present)", () => {
    const { violations } = verifyCitations("100 (quote.nonexistent)", bundle);
    assert.equal(violations.length, 1);
    assert.match(violations[0].reason, /not present/);
  });
  it("approxEqual tolerates sub-tick float noise", () => {
    assert.ok(approxEqual(29172.75, 29172.75000001));
    assert.ok(!approxEqual(29172.75, 29172.8));
  });
});
