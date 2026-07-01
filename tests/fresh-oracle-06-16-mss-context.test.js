// Fresh-oracle context regression — 2026-06-16 MNQ.
//
// The promoted 06-16 oracle row is the fresh-approved MNQ MSS / Reversal-FVG
// short: B grade, 30864.25 / 30905 / 30750.75 at 09:57 ET. The post-merge
// fresh-context inspection exposed a direct-brief-only mismatch: the same fresh
// capture rebuilt via scripts/inspect-fresh-oracle-tapes.mjs surfaced an earlier
// A+ Trend short at 09:45 ET. This regression locks the promoted packet in the
// direct-brief fresh-context path too.

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
const TAPE = join(HERE, "tapes", "fresh-oracle", "2026-06-16-mnq-ny-am-replay.tape.json");

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

test("fresh 2026-06-16 MNQ direct-context fold uses promoted MSS short, not the early A+ Trend", async (t) => {
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
    stateDir: tmpStateDir("fresh-06-16-mss-context-"),
  });

  assert.equal(
    surfaced.some((s) => s.model === "Trend" && s.side === "short" && s.grade === "A+" && s.entry === 30820),
    false,
    `fresh context must not surface the early A+ Trend short: ${JSON.stringify(surfaced)}`,
  );

  const first = surfaced[0] ?? null;
  assert.ok(first, "expected fresh fold to surface the promoted 06-16 MSS packet");
  assert.equal(first.model, "MSS", "model");
  assert.equal(first.side, "short", "side");
  assert.equal(first.grade, "B", "grade");
  assert.equal(first.entry, 30864.25, "entry");
  assert.equal(first.stop, 30905, "stop");
  assert.equal(first.tp1, 30750.75, "tp1");
  // The audited move eventually bottomed at NYAM.L 30561.75, but that level is
  // not knowable at the 09:57 ET packet. The no-lookahead executable packet must
  // not force a future NYAM.L as TP2; B execution banks TP1 anyway.
  assert.notEqual(first.tp2, 30561.75, "tp2 must not use future NYAM.L lookahead");
  assert.equal(first.event_ts, "2026-06-16T13:57:00.000Z", "first_packet_event_ts");
  assert.equal(new Set(surfaced.map((s) => `${s.model}:${s.side}`)).size, 1, "one primary trade per session");
});
