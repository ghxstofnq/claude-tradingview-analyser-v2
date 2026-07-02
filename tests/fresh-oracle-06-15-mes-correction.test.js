// Fresh-oracle user correction regression — 2026-06-15 MES.
//
// User correction 2026-07-01: the MES Trend long stop belongs at the first
// FVG candle low 7626.50, and TP1 belongs at the H4 FVG first-candle high
// 7641.50. This test folds the local fresh capture through the same direct-brief
// reconstruction used by scripts/inspect-fresh-oracle-tapes.mjs.

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
const TAPE = join(HERE, "tapes", "fresh-oracle", "2026-06-15-mes-ny-am-replay.tape.json");

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

test("fresh 2026-06-15 MES folds to corrected Trend long with buffered stop and TP1 hit", async (t) => {
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

  const result = await runBacktest({
    date: tape.date,
    session: tape.session ?? "ny-am",
    mode: "auto",
    symbol: symbolSlugFromTape(tape),
    bus,
    deps,
    stateDir: tmpStateDir("fresh-06-15-mes-correction-"),
  });

  const first = surfaced[0] ?? null;
  assert.ok(first, "expected fresh fold to surface the 06-15 MES Trend packet");
  assert.equal(first.model, "Trend", "model");
  assert.equal(first.side, "long", "side");
  assert.equal(first.entry, 7630.5, "entry");
  assert.equal(first.stop_level, 7626.5, "structural stop anchor must use first FVG candle low");
  assert.equal(first.invalidation, 7626.5, "structural invalidation anchor");
  assert.equal(first.stop, 7626.0, "broker stop must sit two ticks below the structural stop level");
  assert.equal(first.stop_buffer_ticks, 2, "stop buffer ticks");
  assert.equal(first.tp1, 7641.5, "tp1 must use H4 FVG first candle high");
  assert.equal(first.grade, "B", "grade");
  assert.equal(first.event_ts, "2026-06-15T15:24:00.000Z", "first_packet_event_ts");
  assert.equal(new Set(surfaced.map((s) => `${s.model}:${s.side}`)).size, 1, "one primary trade per session");
  assert.equal(result.summary.wins, 1, "buffered 06-15 trade should reach TP1");
  assert.equal(result.summary.losses, 0, "wick into structural anchor should not count as stop-out");
  assert.equal(result.summary.total_r, 2.44, "R must use the wider execution stop");
});
