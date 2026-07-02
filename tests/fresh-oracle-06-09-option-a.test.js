// Fresh-oracle Option A regression — 2026-06-09 MNQ.
//
// The active 06-09 oracle row is the evidence-backed Option-A Inversion short.
// The fresh capture-only corpus is the newer source recording; folding the fresh
// MNQ tape through the same direct-brief reconstruction used by
// scripts/inspect-fresh-oracle-tapes.mjs must reproduce that active row before
// the fresh corpus can be treated as reconciled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";

import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { computeEngineGates } from "../cli/lib/compute-engine-gates.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { runBacktest } from "../app/main/backtest-engine.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as barClose } from "../app/main/bar-close.js";
import { tmpStateDir } from "./helpers/tmp-state.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TAPE = join(HERE, "tapes", "fresh-oracle", "2026-06-09-mnq-ny-am-replay.tape.json");

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function symbolSlugFromTape(tape) {
  return String(tape?.entries?.[0]?.inputs?.leader ?? tape?.entries?.[0]?.inputs?.bundle?.chart?.symbol ?? "")
    .replace(/^[A-Z_]+:/, "") || null;
}

function recomputeGate(bundle) {
  const b = clone(bundle);
  const c = b?.gates?.engine?.confirmation ?? {};
  const g = computeEngineGates({
    engine: b.engine,
    engineByTf: b.engine_by_tf,
    last: b?.quote?.last,
    lastBar: c.last_bar ?? null,
    lastBarAgeSeconds: c.last_bar_age_seconds ?? 0,
    m5LastBar: c.m5_last_bar ?? null,
    m15LastBar: c.m15_last_bar ?? null,
    quoteTimeMs: Date.now(),
  });
  b.gates = { ...(b.gates || {}), engine: { ...(b.gates?.engine || {}), ...g } };
  return b;
}

function directContextForFreshTape(tape) {
  const symbol = symbolSlugFromTape(tape);
  const anchorBundle = recomputeGate(tape.entries?.[0]?.inputs?.bundle ?? {});
  const digest = buildBriefDigest(anchorBundle);
  const payloads = buildDirectSessionBriefPayloads({
    session: tape.session ?? "ny-am",
    bundle: { ...anchorBundle, brief_digest: digest },
    symbols: [symbol],
  });
  return contextFromBriefPayloads({ session: tape.session ?? "ny-am", payloads });
}

test("fresh 2026-06-09 MNQ folds to the active Option-A Inversion short", async (t) => {
  if (!existsSync(TAPE)) {
    t.skip(`fresh oracle tape not available: ${TAPE}`);
    return;
  }
  const tape = JSON.parse(readFileSync(TAPE, "utf8"));
  const tapeForFold = clone(tape);
  const context = directContextForFreshTape(tapeForFold);
  assert.ok(context, "fresh direct-session context should build");

  const surfaced = [];
  const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") surfaced.push(e.setup);
  });

  const deps = {
    recordEntries: async () => ({ entries: tapeForFold.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => context,
    truthFn: barClose.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };

  await runBacktest({
    date: tape.date,
    session: tape.session ?? "ny-am",
    mode: "auto",
    symbol: symbolSlugFromTape(tape),
    bus,
    deps,
    stateDir: tmpStateDir("fresh-06-09-option-a-"),
  });

  const first = surfaced[0] ?? null;
  assert.ok(first, "expected fresh fold to surface the approved 06-09 Option-A packet");
  assert.equal(first.model, "Inversion", "model");
  assert.equal(first.side, "short", "side");
  assert.equal(first.entry, 29760, "entry");
  assert.equal(first.stop_level, 29818.75, "structural stop anchor");
  assert.equal(first.stop, 29819.25, "execution stop");
  assert.equal(first.tp1, 29595.25, "tp1");
  assert.equal(first.grade, "B", "grade");
  assert.equal(first.event_ts, "2026-06-09T14:27:00.000Z", "first_packet_event_ts");
  assert.equal(new Set(surfaced.map((s) => `${s.model}:${s.side}`)).size, 1, "one primary trade per session");
});
