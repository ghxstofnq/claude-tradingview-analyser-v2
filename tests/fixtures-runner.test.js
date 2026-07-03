// tests/fixtures-runner.test.js — the System-page fixtures runner. Read-only:
// lists tests/fixtures and shells the existing smoke/verify scripts. No writes,
// no orders. Ids are derived from listFixtures() so it survives fixture churn.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listFixtures, runFixture, runAllFixtures, readFixtureExpected } from "../app/main/fixtures.js";

describe("fixtures runner", () => {
  const listed = listFixtures();

  it("lists fixture pairs from tests/fixtures", () => {
    assert.equal(listed.ok, true);
    assert.ok(listed.fixtures.length >= 10);
    for (const f of listed.fixtures) {
      assert.match(f.bundlePath, /\.bundle\.json$/);
      assert.equal(typeof f.hasExpected, "boolean");
    }
  });

  it("runs a fixture with an expected.md and reports pass", async () => {
    const withExp = listed.fixtures.find((f) => f.hasExpected);
    assert.ok(withExp, "expected at least one fixture with an expected.md");
    const r = await runFixture(withExp.id);
    assert.equal(r.ok, true, r.output);
    assert.equal(r.status, "pass");
  });

  it("a schema-only fixture (no expected.md) reports skipped", async () => {
    const noExp = listed.fixtures.find((f) => !f.hasExpected);
    if (!noExp) return; // every fixture happens to have an expected.md
    const r = await runFixture(noExp.id);
    assert.equal(r.status, "skipped");
    assert.equal(r.ok, true);
  });

  it("unknown fixture → fail", async () => {
    const r = await runFixture("does-not-exist-xyz");
    assert.equal(r.ok, false);
    assert.equal(r.status, "fail");
  });

  it("rejects path traversal without touching disk", async () => {
    assert.equal((await runFixture("../../etc/passwd")).ok, false);
    assert.equal(readFixtureExpected("a/b").ok, false);
  });

  it("runAll parses the summary line", async () => {
    const r = await runAllFixtures();
    assert.equal(typeof r.total, "number");
    assert.ok(r.fixtures >= 10);
  });
});
