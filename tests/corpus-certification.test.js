import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { certifyCorpus, DEFAULT_MANIFEST } from "../cli/lib/corpus-certification.js";
import { CURRENT_SCHEMA, EXPECTED_CODE_REV } from "../cli/lib/ict-engine-parser.js";

const TINY = {
  manifest_id: "test-manifest",
  from: "2026-06-01",
  to: "2026-06-02",
  symbols: ["MNQ1!", "MES1!"],
  sessions: ["ny-am", "ny-pm"],
  schema: CURRENT_SCHEMA,
  code_rev: EXPECTED_CODE_REV,
  run_engine: "deterministic-walker-chain",
  tape_source: "backtest-engine",
  holidays: [],
  early_close: [],
  session_windows: {
    "ny-am": { expected_entries: 3, first_local: "09:29", last_local: "09:31" },
    "ny-pm": { expected_entries: 3, first_local: "12:59", last_local: "13:01" },
  },
};

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function etIso(date, hhmm, addMinutes = 0) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 5, Number(date.slice(8, 10)), h + 4, m + addMinutes, 0)).toISOString();
}

function mkEntries(r) {
  const win = TINY.session_windows[r.session];
  const count = r.entryCount ?? win.expected_entries;
  const first = r.firstLocal ?? win.first_local;
  return Array.from({ length: count }, (_, i) => {
    const meta = {
      schema: r.schema ?? CURRENT_SCHEMA,
      code_rev: "code_rev" in r ? r.code_rev : EXPECTED_CODE_REV,
      symbol: r.metaSymbol ?? r.symbol,
      tf: "1",
    };
    if (r.omitCodeRev) delete meta.code_rev;
    if (r.badMiddleEntry && i === 1) meta.symbol = "MES1!";
    return {
      event: {
        ts: etIso(r.date, first, r.nonMonotonic && i === 2 ? 0 : i),
        tf: r.eventTf ?? "1m",
      },
      inputs: { bundle: { engine: { meta } } },
    };
  });
}

function mkTape(r) {
  return {
    date: r.tapeDate ?? r.date,
    session: r.tapeSession ?? r.session,
    source: r.tapeSource ?? "backtest-engine",
    verified: false,
    entries: r.entries ?? mkEntries(r),
  };
}

function mkBrief(r) {
  const meta = {
    schema: r.briefSchema ?? CURRENT_SCHEMA,
    code_rev: "briefCodeRev" in r ? r.briefCodeRev : EXPECTED_CODE_REV,
    symbol: r.briefSymbol ?? r.symbol,
  };
  const tfMeta = (tf) => ({
    ...meta,
    tf,
    code_rev: tf === "240" && "briefTfCodeRev" in r ? r.briefTfCodeRev : meta.code_rev,
  });
  return {
    engine: r.briefEngineNull ? null : { meta },
    engine_by_tf: {
      daily: { meta: tfMeta("1D") },
      h4: { meta: tfMeta("240") },
      h1: { meta: tfMeta("60") },
      m30: { meta: tfMeta("30") },
      m15: { meta: tfMeta("15") },
      m5: { meta: tfMeta("5") },
      m1: { meta: tfMeta("1") },
    },
    capture_health: r.capture_health ?? { ok: true, missing: [] },
  };
}

function fullValidRuns() {
  const runs = [];
  for (const sym of TINY.symbols) {
    for (const d of ["2026-06-01", "2026-06-02"]) {
      for (const s of ["ny-am", "ny-pm"]) {
        runs.push({
          run_id: `${sym}-${d}-${s}`,
          date: d,
          session: s,
          symbol: sym,
          engine: "deterministic-walker-chain",
        });
      }
    }
  }
  return runs;
}

function writeStructuredCertificate(btDir, digest, overrides = {}) {
  const selectedTape = path.join(btDir, RID_MNQ_01_AM, "ny-am", "tape.json");
  const tapeSource = overrides.tapePath ?? (fs.existsSync(selectedTape) ? selectedTape : path.join(btDir, "parity-tape.json"));
  const liveSource = overrides.livePath ?? path.join(btDir, "parity-live.jsonl");
  if (!fs.existsSync(tapeSource)) fs.writeFileSync(tapeSource, JSON.stringify({ ok: true }));
  if (!fs.existsSync(liveSource)) fs.writeFileSync(liveSource, `${JSON.stringify({ ok: true })}\n`);
  const cert = {
    schema_version: "gate-corpus-parity-certificate/v1",
    generator: "scripts/gate-corpus/parity-diff.py",
    verdict: "PASS",
    generated_at: "2026-07-09T00:00:00Z",
    manifest_id: TINY.manifest_id,
    selection_digest: digest,
    engine: { schema: CURRENT_SCHEMA, code_rev: EXPECTED_CODE_REV },
    scope: { date: "2026-06-01", session: "ny-am", symbol: "MNQ1!" },
    sources: {
      tape: { path: path.resolve(tapeSource), sha256: sha256File(tapeSource) },
      live: { path: path.resolve(liveSource), sha256: sha256File(liveSource) },
    },
    mismatch_counts: { alignment: 0, ohlc: 0, hard: 0 },
    ...overrides.certificatePatch,
  };
  fs.writeFileSync(path.join(btDir, "parity-certificate.json"), JSON.stringify(cert, null, 2));
  return cert;
}

function mkCorpus(runs, { parity = "valid" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cert-"));
  const btDir = path.join(dir, "backtest");
  fs.mkdirSync(btDir, { recursive: true });
  const index = { runs: [] };
  for (const r of runs) {
    index.runs.push({
      run_id: r.run_id,
      date: r.date,
      session: r.session,
      symbol: r.symbol,
      created_at: r.created_at ?? "2026-06-05T00:00:00Z",
      bars: r.bars ?? 30,
      engine: r.engine ?? "deterministic-walker-chain",
      no_trades: r.no_trades ?? 0,
    });
    if (r.run_id === "" || /[\\/]/.test(r.run_id)) continue;
    const rd = path.join(btDir, r.run_id, r.session);
    fs.mkdirSync(rd, { recursive: true });
    if (r.tape !== null) {
      fs.writeFileSync(
        path.join(rd, "tape.json"),
        r.tapeRaw != null ? r.tapeRaw : JSON.stringify(mkTape(r)),
      );
    }
    if (r.brief !== null) {
      fs.writeFileSync(
        path.join(rd, "brief-bundle.json"),
        r.briefRaw != null ? r.briefRaw : JSON.stringify(mkBrief(r)),
      );
    }
  }
  fs.writeFileSync(path.join(btDir, "index.json"), JSON.stringify(index));
  if (parity === "free-form") {
    fs.writeFileSync(path.join(btDir, "parity-certificate.json"), JSON.stringify({ certified: true, evidence: "handwritten" }));
  } else if (parity === "valid") {
    const pre = certifyCorpus({ stateDir: dir, manifest: TINY });
    writeStructuredCertificate(btDir, pre.selection_digest);
  } else if (typeof parity === "function") {
    const pre = certifyCorpus({ stateDir: dir, manifest: TINY });
    parity(btDir, pre);
  }
  return dir;
}

function withMutation(runId, patch) {
  return fullValidRuns().map((r) => (r.run_id === runId ? { ...r, ...patch } : r));
}

const K_MNQ_01_AM = "2026-06-01|ny-am|MNQ1!";
const RID_MNQ_01_AM = "MNQ1!-2026-06-01-ny-am";

test("default manifest expects 239 full sessions per symbol and encodes exact tape windows", () => {
  const rep = certifyCorpus({ stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "empty-cert-")) });
  assert.equal(rep.requirements.expected_sessions_per_symbol, 239);
  assert.deepEqual(rep.requirements.session_windows, {
    "ny-am": { expected_entries: 152, first_local: "09:29", last_local: "12:00" },
    "ny-pm": { expected_entries: 182, first_local: "12:59", last_local: "16:00" },
  });
  for (const sym of DEFAULT_MANIFEST.symbols) assert.equal(rep.symbols[sym].expected, 239);
});

test("complete valid manifest certifies with structured parity certificate", () => {
  const dir = mkCorpus(fullValidRuns());
  const rep = certifyCorpus({ stateDir: dir, manifest: TINY });
  assert.equal(rep.manifest_id, "test-manifest");
  assert.equal(rep.certified, true);
  assert.match(rep.selection_digest, /^[a-f0-9]{64}$/);
  for (const sym of TINY.symbols) {
    const s = rep.symbols[sym];
    assert.equal(s.expected, 4);
    assert.equal(s.valid, 4);
    assert.deepEqual(s.missing, []);
    assert.deepEqual(s.duplicates, []);
    assert.deepEqual(s.invalid, []);
    assert.deepEqual(s.retries, []);
    assert.equal(Object.keys(s.selected).length, 4);
  }
  assert.equal(rep.parity.certified, true);
  assert.equal(rep.parity.hard_mismatches, 0);
  assert.deepEqual(rep.blockers, []);
});

test("full-session evidence rejects a one-entry or wrong-window tape", () => {
  const shortRep = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { entryCount: 1 })),
    manifest: TINY,
  });
  assert.ok(shortRep.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("wrong_entry_count:1")));
  assert.ok(shortRep.symbols["MNQ1!"].missing.includes(K_MNQ_01_AM));

  const wrongWindowRep = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { firstLocal: "09:30" })),
    manifest: TINY,
  });
  assert.ok(wrongWindowRep.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("wrong_first_local:09:30")));
});

test("timestamp checks reject non-monotonic or wrong-ET-date entries", () => {
  const nonMono = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { nonMonotonic: true })),
    manifest: TINY,
  });
  assert.ok(nonMono.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("non_monotonic_event_ts")));

  const wrongDate = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { entries: [{
      event: { ts: "2026-06-02T13:29:00.000Z" },
      inputs: { bundle: { engine: { meta: { schema: CURRENT_SCHEMA, code_rev: EXPECTED_CODE_REV, symbol: "MNQ1!" } } } },
    }] })),
    manifest: TINY,
  });
  assert.ok(wrongDate.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("wrong_entry_count:1")));
  assert.ok(wrongDate.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("wrong_event_date:2026-06-02")));
});

test("artifact identity rejects unsafe run_id, wrong index engine, and wrong tape top-level fields", () => {
  const unsafe = certifyCorpus({
    stateDir: mkCorpus([
      ...fullValidRuns().filter((r) => r.run_id !== RID_MNQ_01_AM),
      { run_id: "../escape", date: "2026-06-01", session: "ny-am", symbol: "MNQ1!" },
    ]),
    manifest: TINY,
  });
  assert.ok(unsafe.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("unsafe_run_id")));

  const wrongEngine = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { engine: "legacy" })),
    manifest: TINY,
  });
  assert.ok(wrongEngine.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("wrong_index_engine:legacy")));

  const badCreatedAt = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { created_at: "not-a-timestamp" })),
    manifest: TINY,
  });
  assert.ok(badCreatedAt.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("invalid_created_at:not-a-timestamp")));

  const wrongTape = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { tapeSession: "ny-pm", tapeSource: "manual" })),
    manifest: TINY,
  });
  assert.ok(wrongTape.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("wrong_tape_session:ny-pm")));
  assert.ok(wrongTape.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("wrong_tape_source:manual")));
});

test("artifact identity rejects non-1m events and symlink escapes", () => {
  const wrongTf = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { eventTf: "5m" })),
    manifest: TINY,
  });
  assert.ok(wrongTf.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("wrong_event_tf:5m")));

  const dir = mkCorpus(fullValidRuns(), { parity: null });
  const btDir = path.join(dir, "backtest");
  const runDir = path.join(btDir, RID_MNQ_01_AM, "ny-am");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cert-escape-"));
  fs.cpSync(runDir, outside, { recursive: true });
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.symlinkSync(outside, runDir, "dir");
  const escaped = certifyCorpus({ stateDir: dir, manifest: TINY });
  assert.ok(escaped.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("artifact_path_escape")));
});

test("brief-bundle is required and capture_health must be explicitly healthy", () => {
  const missingBrief = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { brief: null })),
    manifest: TINY,
  });
  assert.ok(missingBrief.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("missing_brief_bundle")));

  const unhealthy = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { capture_health: { ok: false, missing: ["h1"] } })),
    manifest: TINY,
  });
  assert.ok(unhealthy.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("brief_capture_unhealthy")));
  assert.ok(unhealthy.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("brief_capture_missing:h1")));

  const wrongMeta = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { briefCodeRev: 0, briefSymbol: "MES1!" })),
    manifest: TINY,
  });
  assert.ok(wrongMeta.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("wrong_brief_code_rev:0")));
  assert.ok(wrongMeta.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("wrong_brief_symbol:MES1!")));

  const wrongTfMeta = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { briefTfCodeRev: 0 })),
    manifest: TINY,
  });
  assert.ok(wrongTfMeta.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("wrong_brief_tf_code_rev:h4:0")));
});

test("healthy multi-TF brief evidence does not require a duplicate top-level engine", () => {
  const rep = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { briefEngineNull: true })),
    manifest: TINY,
  });
  assert.equal(rep.symbols["MNQ1!"].valid, 4);
  assert.equal(rep.certified, true);
});

test("valid deterministic no-trade sessions remain selected and are reported", () => {
  const rep = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { no_trades: 1 })),
    manifest: TINY,
  });
  assert.equal(rep.symbols["MNQ1!"].valid, 4);
  assert.deepEqual(rep.symbols["MNQ1!"].no_trade_sessions, [K_MNQ_01_AM]);
  assert.equal(rep.certified, true);
});

test("selection digest binds selected tape and brief artifact bytes", () => {
  const dir = mkCorpus(fullValidRuns());
  const before = certifyCorpus({ stateDir: dir, manifest: TINY });
  assert.equal(before.certified, true);

  const briefPath = path.join(dir, "backtest", RID_MNQ_01_AM, "ny-am", "brief-bundle.json");
  const brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
  brief.audit_note = "content changed without changing run_id";
  fs.writeFileSync(briefPath, JSON.stringify(brief));

  const after = certifyCorpus({ stateDir: dir, manifest: TINY });
  assert.notEqual(after.selection_digest, before.selection_digest);
  assert.equal(after.parity.certified, false);
  assert.match(after.parity.evidence, /selection_digest/);
});

test("every tape entry must carry matching engine meta, not just first and last", () => {
  const rep = certifyCorpus({
    stateDir: mkCorpus(withMutation(RID_MNQ_01_AM, { badMiddleEntry: true })),
    manifest: TINY,
  });
  assert.ok(rep.symbols["MNQ1!"].invalid.some((x) => x.reasons.includes("wrong_symbol:MES1!")));
  assert.equal(rep.certified, false);
});

test("retry transparency reports valid plus invalid retries without invalidating older valid artifact", () => {
  const runs = [
    ...fullValidRuns(),
    {
      run_id: `${RID_MNQ_01_AM}-BAD-NEWER`,
      date: "2026-06-01",
      session: "ny-am",
      symbol: "MNQ1!",
      created_at: "2026-06-06T00:00:00Z",
      schema: 3,
    },
  ];
  const rep = certifyCorpus({ stateDir: mkCorpus(runs), manifest: TINY });
  const s = rep.symbols["MNQ1!"];
  assert.equal(s.valid, 4);
  assert.equal(s.selected[K_MNQ_01_AM], RID_MNQ_01_AM);
  assert.deepEqual(s.duplicates, []);
  assert.equal(s.retries.length, 1);
  assert.equal(s.retries[0].key, K_MNQ_01_AM);
  assert.equal(s.retries[0].selected, RID_MNQ_01_AM);
  assert.equal(s.retries[0].newest_invalid, true);
  assert.equal(s.retries[0].candidates[0].created_at, "2026-06-06T00:00:00Z");
  assert.deepEqual(s.retries[0].candidates.map((c) => c.run_id), [`${RID_MNQ_01_AM}-BAD-NEWER`, RID_MNQ_01_AM]);
  assert.equal(s.retries[0].candidates[0].ok, false);
  assert.ok(s.retries[0].candidates[0].reasons.includes("wrong_schema:3"));
  assert.equal(rep.certified, true);
});

test("duplicate valid candidates remain visible separately from retry failures", () => {
  const runs = [
    ...fullValidRuns(),
    {
      run_id: `${RID_MNQ_01_AM}-VALID-NEWER`,
      date: "2026-06-01",
      session: "ny-am",
      symbol: "MNQ1!",
      created_at: "2026-06-06T00:00:00Z",
    },
  ];
  const rep = certifyCorpus({ stateDir: mkCorpus(runs), manifest: TINY });
  const s = rep.symbols["MNQ1!"];
  assert.equal(s.duplicates.length, 1);
  assert.equal(s.duplicates[0].winner, `${RID_MNQ_01_AM}-VALID-NEWER`);
  assert.equal(s.retries.length, 1);
  assert.equal(s.retries[0].newest_invalid, false);
  assert.equal(rep.certified, true);
});

test("free-form parity certificate is rejected", () => {
  const rep = certifyCorpus({ stateDir: mkCorpus(fullValidRuns(), { parity: "free-form" }), manifest: TINY });
  assert.equal(rep.parity.certified, false);
  assert.ok(rep.blockers.some((b) => b.code === "parity_not_certified"));
  assert.equal(rep.certified, false);
});

test("parity certificate fails closed on selection digest drift and source hash drift", () => {
  const drift = certifyCorpus({
    stateDir: mkCorpus(fullValidRuns(), {
      parity: (btDir, pre) => writeStructuredCertificate(btDir, pre.selection_digest, {
        certificatePatch: { selection_digest: "sha256:not-current" },
      }),
    }),
    manifest: TINY,
  });
  assert.equal(drift.parity.certified, false);
  assert.match(drift.parity.evidence, /selection_digest/);

  const hashDriftDir = mkCorpus(fullValidRuns(), {
    parity: (btDir, pre) => {
      const cert = writeStructuredCertificate(btDir, pre.selection_digest);
      fs.appendFileSync(cert.sources.live.path, "drift");
    },
  });
  const hashDrift = certifyCorpus({ stateDir: hashDriftDir, manifest: TINY });
  assert.equal(hashDrift.parity.certified, false);
  assert.match(hashDrift.parity.evidence, /sha256/);
});

test("parity certificate scope must identify a selected manifest session", () => {
  const rep = certifyCorpus({
    stateDir: mkCorpus(fullValidRuns(), {
      parity: (btDir, pre) => writeStructuredCertificate(btDir, pre.selection_digest, {
        certificatePatch: { scope: { date: "2025-12-31", session: "ny-am", symbol: "MNQ1!" } },
      }),
    }),
    manifest: TINY,
  });
  assert.equal(rep.parity.certified, false);
  assert.match(rep.parity.evidence, /scope/);
});

test("parity certificate tape source must be the selected artifact for its scope", () => {
  const dir = mkCorpus(fullValidRuns(), {
    parity: (btDir, pre) => writeStructuredCertificate(btDir, pre.selection_digest, {
      tapePath: path.join(btDir, "unselected-parity-tape.json"),
    }),
  });
  const rep = certifyCorpus({ stateDir: dir, manifest: TINY });
  assert.equal(rep.parity.certified, false);
  assert.match(rep.parity.evidence, /selected artifact/);
});

test("missing parity evidence and missing index fail closed", () => {
  const noParity = certifyCorpus({ stateDir: mkCorpus(fullValidRuns(), { parity: null }), manifest: TINY });
  assert.equal(noParity.parity.certified, false);
  assert.ok(noParity.blockers.some((b) => b.code === "parity_not_certified"));
  assert.equal(noParity.certified, false);

  const dir = mkCorpus(fullValidRuns());
  fs.rmSync(path.join(dir, "backtest", "index.json"));
  const noIndex = certifyCorpus({ stateDir: dir, manifest: TINY });
  assert.ok(noIndex.blockers.some((b) => b.code === "no_index"));
  assert.equal(noIndex.certified, false);
});
