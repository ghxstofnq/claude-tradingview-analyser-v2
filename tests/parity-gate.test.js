// Live ≡ backtest PARITY gate (the end-goal keystone, enforced in CI).
//
// For each committed fixture in tests/parity/*.parity.json, fold the SHARED brain
// over the LIVE walker-inputs and over the BACKTEST tape and assert they surface
// IDENTICAL packets (model·side·grade·entry·stop·tp1) — and that both match the
// frozen expectation. This is a mechanical agreement check (live == backtest),
// NOT a Lanto-faithfulness claim (that's the day-tape gate vs the oracle).
//
// Fixtures are built by scripts/make-parity-fixture.mjs ONLY from sessions recorded
// under the current code (post the deploy-parity arming guard, 3434ce9) — the
// builder refuses to write a fixture whose two sides disagree. A future code change
// that breaks parity makes this gate fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { foldLive, foldBacktest } from "../scripts/make-parity-fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARITY_DIR = path.join(__dirname, "parity");

const fixtures = fs.existsSync(PARITY_DIR)
  ? fs.readdirSync(PARITY_DIR).filter((f) => f.endsWith(".parity.json"))
  : [];

test("parity corpus is non-empty (the keystone must have at least one same-code proof)", () => {
  assert.ok(fixtures.length >= 1, "no tests/parity/*.parity.json fixtures — build one with scripts/make-parity-fixture.mjs");
});

for (const file of fixtures) {
  test(`parity: live ≡ backtest — ${file}`, async () => {
    const fx = JSON.parse(fs.readFileSync(path.join(PARITY_DIR, file), "utf8"));
    const liveP = await foldLive(fx.live_entries, fx.session);
    const btP = await foldBacktest(fx.tape.entries, fx.brief_payloads, fx.tape.date ?? fx.date, fx.session);
    const expected = fx.expected_packets;

    const setEq = (a, b) => a.length === b.length && a.every((s) => b.includes(s));
    assert.ok(setEq(liveP, btP), `live≠backtest in ${file}\n  live: ${JSON.stringify(liveP)}\n  bt:   ${JSON.stringify(btP)}`);
    assert.ok(setEq(liveP, expected), `live drifted from frozen expectation in ${file}\n  live:     ${JSON.stringify(liveP)}\n  expected: ${JSON.stringify(expected)}`);
    assert.ok(setEq(btP, expected), `backtest drifted from frozen expectation in ${file}\n  bt:       ${JSON.stringify(btP)}\n  expected: ${JSON.stringify(expected)}`);
  });
}

// Tamper test (A2 acceptance): prove the gate's equality check is not vacuous —
// a side-flipped expectation must NOT match the real fold.
test("parity gate is not vacuous — a side-flipped expectation is rejected", async () => {
  const traded = fixtures
    .map((f) => JSON.parse(fs.readFileSync(path.join(PARITY_DIR, f), "utf8")))
    .find((fx) => Array.isArray(fx.expected_packets) && fx.expected_packets.length > 0);
  if (!traded) return; // only no-trade fixtures present — nothing to flip
  const liveP = await foldLive(traded.live_entries, traded.session);
  const setEq = (a, b) => a.length === b.length && a.every((s) => b.includes(s));
  const flipped = traded.expected_packets.map((s) =>
    s.includes("|long|") ? s.replace("|long|", "|short|") : s.replace("|short|", "|long|"));
  assert.ok(!setEq(liveP, flipped), "the gate must reject a side-flipped expectation — the equality check is real");
});
