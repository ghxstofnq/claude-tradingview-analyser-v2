// Fresh-oracle blocker regression — 2026-02-09 MNQ.
//
// 02-09 is the documented A+ multi-alignment example: a 5m FVG rebalance plus
// a 1m bearish-FVG-to-bullish iFVG alignment confirm one long around
// 09:54–09:56 ET. Per entry-models.md and the active stage-G label, this is a
// multi-alignment Trend/iFVG-entry case; "Inversion" is an entry mechanism, not
// automatically the packet model for this row.
//
// This test intentionally does NOT force-green the old/stale 14:36/25562.5 tape
// metadata. It locks the approved current authority instead: fresh direct context
// must rebuild the TL-light HTF bullish read and fold the two-and-one evidence
// into the approved multi-alignment Trend long at the documented 09:54–09:56
// window.

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
const TAPE = join(HERE, "tapes", "fresh-oracle", "2026-02-09-mnq-ny-am-replay.tape.json");

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

function etMinute(isoOrMs) {
  const t = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(t);
}

function isDocumentedEntryZone(row) {
  const top = Number(row?.top);
  const bottom = Number(row?.bottom);
  return String(row?.kind) === "ifvg"
    && String(row?.dir) === "bull"
    && Number.isFinite(top)
    && Number.isFinite(bottom)
    && bottom >= 25629
    && top <= 25640;
}

function currentBarBullIfvgConfirmsInWindow(tape, { from = "09:54", to = "09:56" } = {}) {
  const out = [];
  for (const entry of tape.entries ?? []) {
    const minute = etMinute(entry?.event?.ts);
    if (minute < from || minute > to) continue;
    const lastBar = entry?.inputs?.bundle?.bars?.last_5_bars?.at(-1);
    const barOpenMs = Number(lastBar?.time) * 1000;
    const rows = entry?.inputs?.bundle?.gates?.engine?.pillar3?.fvgs ?? [];
    for (const row of rows) {
      const confirmMs = Number(row?.confirm_ms);
      const currentBar = Number.isFinite(barOpenMs)
        && Number.isFinite(confirmMs)
        && confirmMs >= barOpenMs
        && confirmMs <= barOpenMs + 60_000;
      if (isDocumentedEntryZone(row)
        && row?.confirm_close === true
        && row?.confirm_dir === "bull"
        && row?.ce_held === true
        && currentBar) {
        out.push({ eventTs: entry.event.ts, row });
      }
    }
  }
  return out;
}

function historicalDocumentedZoneConfirm(tape) {
  for (const entry of tape.entries ?? []) {
    for (const row of entry?.inputs?.bundle?.gates?.engine?.pillar3?.fvgs ?? []) {
      if (isDocumentedEntryZone(row)
        && row?.confirm_close === true
        && row?.confirm_dir === "bull"
        && row?.ce_held === true
        && Number(row?.confirm_ms) > 0) {
        return row;
      }
    }
  }
  return null;
}

test("fresh 2026-02-09 MNQ folds to the approved multi-alignment Trend/iFVG-entry long", async (t) => {
  if (!existsSync(TAPE)) {
    t.skip(`fresh oracle tape not available: ${TAPE}`);
    return;
  }
  const tape = JSON.parse(readFileSync(TAPE, "utf8"));
  const tapeForFold = clone(tape);
  const context = directContextForFreshTape(tapeForFold);

  assert.ok(context, "fresh direct-session context should build");
  assert.equal(context.session_state?.pillar1?.status, "pass", "pillar1 context should pass");
  assert.equal(context.session_state?.pillar1?.htfBias, "bullish", "TL-light HTF read should be bullish");
  assert.equal(context.session_state?.pillar1?.primaryDraw?.vote_reason, "filled-rebalanced-tl-light");
  assert.equal(context.session_state?.pillar1?.primaryDraw?.took_liq, false, "TL-light draw must not be misrepresented as took-liq");

  // Guardrail: the approved Trend/iFVG-entry path must not be implemented by
  // reusing the 09:42 iFVG as a fake current-bar 09:54 confirmation.
  const historical = historicalDocumentedZoneConfirm(tape);
  assert.ok(historical, "expected the tape to carry the documented-zone IFVG confirmation historically");
  assert.equal(etMinute(Number(historical.confirm_ms)), "09:42", "documented-zone IFVG confirm remains historical");
  assert.deepEqual(
    currentBarBullIfvgConfirmsInWindow(tape),
    [],
    "do not relax the bridge to reuse historical iFVG confirmation as current-bar evidence",
  );

  const surfaced = [];
  const outcomes = [];
  const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") surfaced.push(e.setup);
    if (e.type === "setup_outcome") outcomes.push(e);
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
    stateDir: tmpStateDir("fresh-02-09-multi-align-approved-"),
  });

  const first = surfaced[0] ?? null;
  assert.ok(first, "fresh fold should surface the approved multi-alignment Trend packet");
  assert.equal(first.model, "Trend", "model");
  assert.equal(first.side, "long", "side");
  assert.equal(first.grade, "A+", "grade");
  assert.equal(first.entry, 25632, "entry");
  assert.equal(first.stop, 25605, "stop");
  assert.equal(first.tp1, 25696.75, "tp1"); // no-lookahead packet-time NYAM.H; 25707 is not present in 09:54–09:56 closed-bar evidence
  assert.equal(first.tp2, 25855.25, "tp2");
  assert.ok(["09:54", "09:55", "09:56"].includes(etMinute(first.event_ts)), "entry should surface in the documented 09:54–09:56 ET window");
  assert.equal(new Set(surfaced.map((s) => `${s.model}:${s.side}`)).size, 1, "one primary trade per session");
  assert.ok(!surfaced.some((s) => s.entry === 25562.5 || s.stop === 25492.75), "stale 14:36 expected values must not be treated as authority");
  assert.ok(outcomes.some((e) => e.outcome === "tp2_hit"), "approved long should reach TP2 on the fresh tape");
});
