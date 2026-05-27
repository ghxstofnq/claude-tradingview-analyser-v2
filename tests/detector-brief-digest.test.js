import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtfDestination, attachDetectorBriefDigest } from "../cli/lib/detector-brief-digest.js";

// ---------- parseHtfDestination ----------

test("parseHtfDestination: 'below ...' prose → dir: below", () => {
  const result = parseHtfDestination("below 29876 sell-side then 30192.25 buy-side");
  assert.equal(result.dir, "below");
  assert.equal(result.text, "below 29876 sell-side then 30192.25 buy-side");
});

test("parseHtfDestination: 'above ...' prose → dir: above", () => {
  const result = parseHtfDestination("above 30000 buy-side");
  assert.equal(result.dir, "above");
  assert.equal(result.text, "above 30000 buy-side");
});

test("parseHtfDestination: 'balanced' or unknown prefix → dir: null", () => {
  assert.equal(parseHtfDestination("balanced").dir, null);
  assert.equal(parseHtfDestination("undecided no direction").dir, null);
});

test("parseHtfDestination: empty / non-string inputs → null", () => {
  assert.equal(parseHtfDestination(""), null);
  assert.equal(parseHtfDestination("   "), null);
  assert.equal(parseHtfDestination(null), null);
  assert.equal(parseHtfDestination(undefined), null);
  assert.equal(parseHtfDestination(42), null);
});

test("parseHtfDestination: case-insensitive prefix matching", () => {
  assert.equal(parseHtfDestination("ABOVE 30000").dir, "above");
  assert.equal(parseHtfDestination("Below 29000").dir, "below");
});

// ---------- attachDetectorBriefDigest ----------

test("attaches brief_digest when bundle is missing it entirely (single-symbol mode)", () => {
  const bundle = { quote: { last: 30000 } }; // no brief_digest at all
  const brief = { htf_destination: "above 30100 buy-side", primary_draw: { dir: "bull", top: 30050, bottom: 30000 } };
  const out = attachDetectorBriefDigest(bundle, brief, "mnq");
  assert.equal(out.brief_digest.symbols["MNQ1!"].pillar1.htf_destination.dir, "above");
  assert.deepEqual(out.brief_digest.symbols["MNQ1!"].pillar1.primary_draw, brief.primary_draw);
});

test("merges into existing brief_digest.symbols (paired mode)", () => {
  const bundle = {
    brief_digest: {
      symbols: { "MES1!": { htf: { daily: {} }, pillar1: { existing: "data" } } },
    },
  };
  const brief = { htf_destination: "below 7400 sell-side", primary_draw: { dir: "bear" } };
  const out = attachDetectorBriefDigest(bundle, brief, "mes");
  // Existing field preserved.
  assert.equal(out.brief_digest.symbols["MES1!"].pillar1.existing, "data");
  // New fields added.
  assert.equal(out.brief_digest.symbols["MES1!"].pillar1.htf_destination.dir, "below");
  assert.equal(out.brief_digest.symbols["MES1!"].pillar1.primary_draw.dir, "bear");
  // Sibling symbol's htf block untouched.
  assert.ok(out.brief_digest.symbols["MES1!"].htf);
});

test("creates symbols[leader] when bundle has brief_digest but not the leader's entry", () => {
  const bundle = { brief_digest: { symbols: { "MES1!": { pillar1: {} } } } };
  const brief = { htf_destination: "above 30100 buy-side", primary_draw: { dir: "bull" } };
  const out = attachDetectorBriefDigest(bundle, brief, "mnq");
  assert.ok(out.brief_digest.symbols["MNQ1!"]);
  assert.equal(out.brief_digest.symbols["MNQ1!"].pillar1.htf_destination.dir, "above");
  // MES1! preserved.
  assert.ok(out.brief_digest.symbols["MES1!"]);
});

test("returns bundle unchanged when brief is missing", () => {
  const bundle = { brief_digest: { symbols: {} } };
  const before = JSON.stringify(bundle);
  const out = attachDetectorBriefDigest(bundle, null, "mnq");
  assert.equal(JSON.stringify(out), before);
});

test("returns bundle unchanged when leader is missing", () => {
  const bundle = { brief_digest: { symbols: {} } };
  const brief = { htf_destination: "above 30000 buy-side" };
  const before = JSON.stringify(bundle);
  const out = attachDetectorBriefDigest(bundle, brief, null);
  assert.equal(JSON.stringify(out), before);
});

test("falls back to 'PRIMARY' symbol key for non-mnq/mes leaders", () => {
  const bundle = {};
  const brief = { htf_destination: "above 5000 buy-side", primary_draw: { dir: "bull" } };
  const out = attachDetectorBriefDigest(bundle, brief, "spy");
  assert.ok(out.brief_digest.symbols.PRIMARY);
  assert.equal(out.brief_digest.symbols.PRIMARY.pillar1.htf_destination.dir, "above");
});

test("does not clobber htf_destination when brief.htf_destination is missing", () => {
  const bundle = {
    brief_digest: {
      symbols: { "MNQ1!": { pillar1: { htf_destination: { dir: "above", text: "stays" } } } },
    },
  };
  const brief = { primary_draw: { dir: "bull" } }; // no htf_destination
  const out = attachDetectorBriefDigest(bundle, brief, "mnq");
  assert.equal(out.brief_digest.symbols["MNQ1!"].pillar1.htf_destination.text, "stays");
  assert.equal(out.brief_digest.symbols["MNQ1!"].pillar1.primary_draw.dir, "bull");
});

test("regression: post-pair-decision single-symbol bundle now passes detector's brief_digest gate", () => {
  // Reproduces 2026-05-27 NY PM bug: detector returned
  // "Awaiting brief. Run brief phase first." every bar because
  // bundle.brief_digest was undefined in single-symbol mode.
  const bundle = {
    quote: { last: 29800 },
    gates: { engine: { pillar3: { failure_swings: [], structures_by_tier: { swing: [], internal: [] } } } },
  };
  const brief = {
    htf_destination: "below 29876 sell-side then 30192.25 buy-side",
    primary_draw: { tf: "h1", kind: "fvg", dir: "bull", top: 29805.25, bottom: 29578, ce: 29691.625 },
  };
  attachDetectorBriefDigest(bundle, brief, "mnq");
  // The detector's gate is `!bundle?.brief_digest?.symbols` — assert that
  // path now resolves to a truthy object.
  assert.ok(bundle.brief_digest?.symbols, "brief_digest.symbols must exist after synthesis");
  assert.ok(bundle.brief_digest.symbols["MNQ1!"]?.pillar1?.htf_destination, "htf_destination must be attached");
  assert.equal(bundle.brief_digest.symbols["MNQ1!"].pillar1.htf_destination.dir, "below");
});
