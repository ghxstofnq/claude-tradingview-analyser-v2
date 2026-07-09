import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CURRENT_SCHEMA, EXPECTED_CODE_REV } from "./ict-engine-parser.js";

const SUN = 0;
const SAT = 6;
const EXPECTED_RUN_ENGINE = "deterministic-walker-chain";
const EXPECTED_TAPE_SOURCE = "backtest-engine";
const PARITY_CERT_SCHEMA = "gate-corpus-parity-certificate/v1";
const PARITY_GENERATOR = "scripts/gate-corpus/parity-diff.py";

export const DEFAULT_MANIFEST = {
  manifest_id: "gate-corpus-2026-h1-v1",
  from: "2026-01-10",
  to: "2026-07-03",
  symbols: ["MNQ1!", "MES1!"],
  sessions: ["ny-am", "ny-pm"],
  schema: CURRENT_SCHEMA,
  code_rev: EXPECTED_CODE_REV,
  run_engine: EXPECTED_RUN_ENGINE,
  tape_source: EXPECTED_TAPE_SOURCE,
  brief_timeframes: ["daily", "h4", "h1", "m30", "m15", "m5", "m1"],
  holidays: ["2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19"],
  early_close: [{ date: "2026-07-03", session: "ny-pm" }],
  session_windows: {
    "ny-am": { expected_entries: 152, first_local: "09:29", last_local: "12:00" },
    "ny-pm": { expected_entries: 182, first_local: "12:59", last_local: "16:00" },
  },
};

const ET_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function readJson(file, missingCode, malformedCode) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return { ok: false, reason: fs.existsSync(file) ? malformedCode : missingCode };
  }
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function isSafePathSegment(segment) {
  return typeof segment === "string" && segment !== "" && segment !== "." && segment !== ".." && !/[\\/]/.test(segment);
}

function underDir(parent, child) {
  const root = path.resolve(parent);
  const resolved = path.resolve(child);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function artifactPaths(btDir, run) {
  if (!isSafePathSegment(run.run_id)) return { ok: false, reason: "unsafe_run_id" };
  if (!isSafePathSegment(run.session)) return { ok: false, reason: "unsafe_session" };
  const runDir = path.resolve(btDir, run.run_id, run.session);
  const tape = path.resolve(runDir, "tape.json");
  const brief = path.resolve(runDir, "brief-bundle.json");
  if (!underDir(btDir, tape) || !underDir(btDir, brief)) return { ok: false, reason: "artifact_path_escape" };
  try {
    const realRoot = fs.realpathSync(btDir);
    for (const artifact of [tape, brief]) {
      if (fs.existsSync(artifact) && !underDir(realRoot, fs.realpathSync(artifact))) {
        return { ok: false, reason: "artifact_path_escape" };
      }
    }
  } catch {
    return { ok: false, reason: "artifact_path_unreadable" };
  }
  return { ok: true, tape, brief };
}

function weekdaysInRange(from, to, holidays) {
  const out = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd === SUN || wd === SAT) continue;
    const iso = d.toISOString().slice(0, 10);
    if (!holidays.has(iso)) out.push(iso);
  }
  return out;
}

function etParts(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = Object.fromEntries(ET_FORMAT.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return {
    epoch: d.getTime(),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function validateTape(tape, run, manifest) {
  const reasons = [];
  if (tape?.date !== run.date) reasons.push(`wrong_tape_date:${tape?.date}`);
  if (tape?.session !== run.session) reasons.push(`wrong_tape_session:${tape?.session}`);
  if (tape?.source !== (manifest.tape_source ?? EXPECTED_TAPE_SOURCE)) reasons.push(`wrong_tape_source:${tape?.source}`);

  const entries = Array.isArray(tape?.entries) ? tape.entries : [];
  const window = manifest.session_windows?.[run.session];
  if (!window) {
    reasons.push(`missing_session_window:${run.session}`);
  } else {
    if (entries.length !== window.expected_entries) reasons.push(`wrong_entry_count:${entries.length}`);
  }
  if (entries.length === 0) reasons.push("no_entries");

  let prevEpoch = null;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const ts = e?.event?.ts;
    if (e?.event?.tf !== "1m") reasons.push(`wrong_event_tf:${e?.event?.tf}`);
    const parts = typeof ts === "string" ? etParts(ts) : null;
    if (!parts) {
      reasons.push("unparseable_event_ts");
    } else {
      if (parts.date !== run.date) reasons.push(`wrong_event_date:${parts.date}`);
      if (i === 0 && window && parts.time !== window.first_local) reasons.push(`wrong_first_local:${parts.time}`);
      if (i === entries.length - 1 && window && parts.time !== window.last_local) reasons.push(`wrong_last_local:${parts.time}`);
      if (prevEpoch != null && parts.epoch !== prevEpoch + 60_000) reasons.push("non_monotonic_event_ts");
      prevEpoch = parts.epoch;
    }

    const meta = e?.inputs?.bundle?.engine?.meta;
    if (!meta) {
      reasons.push("missing_engine_evidence");
      continue;
    }
    if (meta.schema !== manifest.schema) reasons.push(`wrong_schema:${meta.schema}`);
    if (meta.code_rev !== manifest.code_rev) reasons.push(`wrong_code_rev:${meta.code_rev}`);
    if (meta.symbol !== run.symbol) reasons.push(`wrong_symbol:${meta.symbol}`);
  }
  return reasons;
}

function validateBrief(brief, run, manifest) {
  const reasons = [];
  const meta = brief?.engine?.meta;
  if (meta) {
    if (meta.schema !== manifest.schema) reasons.push(`wrong_brief_schema:${meta.schema}`);
    if (meta.code_rev !== manifest.code_rev) reasons.push(`wrong_brief_code_rev:${meta.code_rev}`);
    if (meta.symbol !== run.symbol) reasons.push(`wrong_brief_symbol:${meta.symbol}`);
  }

  const expectedTfs = manifest.brief_timeframes ?? ["daily", "h4", "h1", "m30", "m15", "m5", "m1"];
  for (const tf of expectedTfs) {
    const tfMeta = brief?.engine_by_tf?.[tf]?.meta;
    if (!tfMeta) {
      reasons.push(`missing_brief_tf_meta:${tf}`);
      continue;
    }
    if (tfMeta.schema !== manifest.schema) reasons.push(`wrong_brief_tf_schema:${tf}:${tfMeta.schema}`);
    if (tfMeta.code_rev !== manifest.code_rev) reasons.push(`wrong_brief_tf_code_rev:${tf}:${tfMeta.code_rev}`);
    if (tfMeta.symbol !== run.symbol) reasons.push(`wrong_brief_tf_symbol:${tf}:${tfMeta.symbol}`);
  }

  const health = brief?.capture_health;
  if (!health || health.ok !== true) reasons.push("brief_capture_unhealthy");
  if (!Array.isArray(health?.missing)) {
    reasons.push("brief_capture_missing_unreadable");
  } else if (health.missing.length > 0) {
    for (const item of health.missing) reasons.push(`brief_capture_missing:${item}`);
  }
  return reasons;
}

function validateRun(btDir, run, manifest) {
  const reasons = [];
  if (run.engine !== (manifest.run_engine ?? EXPECTED_RUN_ENGINE)) reasons.push(`wrong_index_engine:${run.engine}`);
  if (!Number.isFinite(Date.parse(run.created_at ?? ""))) reasons.push(`invalid_created_at:${run.created_at}`);

  const paths = artifactPaths(btDir, run);
  if (!paths.ok) return { ok: false, reasons: [paths.reason, ...reasons] };

  const tapeJson = readJson(paths.tape, "missing_tape", "malformed_tape");
  if (!tapeJson.ok) reasons.push(tapeJson.reason);
  else reasons.push(...validateTape(tapeJson.value, run, manifest));

  const briefJson = readJson(paths.brief, "missing_brief_bundle", "malformed_brief_bundle");
  if (!briefJson.ok) reasons.push(briefJson.reason);
  else reasons.push(...validateBrief(briefJson.value, run, manifest));

  const uniq = [...new Set(reasons)];
  let artifacts = null;
  if (uniq.length === 0) {
    try {
      artifacts = {
        tape_sha256: sha256File(paths.tape),
        brief_sha256: sha256File(paths.brief),
      };
    } catch {
      uniq.push("artifact_hash_unreadable");
    }
  }
  return { ok: uniq.length === 0, reasons: uniq, artifacts };
}

function runTime(run) {
  const parsed = Date.parse(run.created_at || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestFirst(a, b) {
  return (runTime(b.r) - runTime(a.r)) || String(b.r.run_id).localeCompare(String(a.r.run_id));
}

function computeSelectionDigest(symbolsOut) {
  const artifacts = [];
  for (const sym of Object.keys(symbolsOut).sort()) {
    for (const key of Object.keys(symbolsOut[sym].selected_artifacts).sort()) {
      const selected = symbolsOut[sym].selected_artifacts[key];
      artifacts.push([key, selected.run_id, selected.tape_sha256, selected.brief_sha256]);
    }
  }
  return crypto.createHash("sha256").update(JSON.stringify(artifacts)).digest("hex");
}

function parityFailure(evidence) {
  return { certified: false, evidence };
}

function validateParityCertificate(btDir, manifest, selectionDigest, selectedArtifactsByKey) {
  const artifact = path.resolve(btDir, "parity-certificate.json");
  const parsed = readJson(artifact, "missing_parity_certificate", "malformed_parity_certificate");
  if (!parsed.ok) return parityFailure("no parity certificate artifact (prose-only parity proof does not certify)");
  const cert = parsed.value;

  if (cert?.schema_version !== PARITY_CERT_SCHEMA) return parityFailure("parity certificate schema_version mismatch");
  if (cert.generator !== PARITY_GENERATOR) return parityFailure("parity certificate generator mismatch");
  if (cert.verdict !== "PASS") return parityFailure(`parity certificate verdict is ${cert.verdict}`);
  const generatedAt = Date.parse(cert.generated_at);
  if (!Number.isFinite(generatedAt)) return parityFailure("parity certificate generated_at is not ISO parseable");
  if (generatedAt > Date.now() + 5 * 60_000) return parityFailure("parity certificate generated_at is in the future");
  if (cert.manifest_id !== manifest.manifest_id) return parityFailure("parity certificate manifest_id mismatch");
  if (!/^[a-f0-9]{64}$/.test(cert.selection_digest ?? "")) return parityFailure("parity certificate selection_digest is malformed");
  if (cert.selection_digest !== selectionDigest) return parityFailure("parity certificate selection_digest mismatch");
  if (cert.engine?.schema !== manifest.schema) return parityFailure("parity certificate engine.schema mismatch");
  if (cert.engine?.code_rev !== manifest.code_rev) return parityFailure("parity certificate engine.code_rev mismatch");
  const scope = cert.scope;
  if (!scope || typeof scope.date !== "string" || typeof scope.session !== "string" || typeof scope.symbol !== "string") {
    return parityFailure("parity certificate scope is malformed");
  }
  const scopeKey = `${scope.date}|${scope.session}|${scope.symbol}`;
  const selectedArtifact = selectedArtifactsByKey.get(scopeKey);
  if (!selectedArtifact) return parityFailure("parity certificate scope does not identify a selected manifest session");
  if (cert.sources?.tape?.sha256 !== selectedArtifact.tape_sha256) {
    return parityFailure("parity certificate tape source is not the selected artifact for its scope");
  }

  const counts = cert.mismatch_counts ?? {};
  if (counts.alignment !== 0 || counts.ohlc !== 0 || counts.hard !== 0) {
    return parityFailure("parity certificate mismatch counts are nonzero");
  }

  for (const sourceName of ["tape", "live"]) {
    const source = cert.sources?.[sourceName];
    if (!source || typeof source.path !== "string" || !path.isAbsolute(source.path)) {
      return parityFailure(`parity certificate ${sourceName} source path is not absolute`);
    }
    if (!/^[a-f0-9]{64}$/.test(source.sha256 ?? "")) {
      return parityFailure(`parity certificate ${sourceName} sha256 is malformed`);
    }
    try {
      if (!fs.statSync(source.path).isFile()) {
        return parityFailure(`parity certificate ${sourceName} source is not a file`);
      }
      const actual = sha256File(source.path);
      if (source.sha256 !== actual) return parityFailure(`parity certificate ${sourceName} sha256 mismatch`);
    } catch {
      return parityFailure(`parity certificate ${sourceName} source path is not readable`);
    }
  }

  return {
    certified: true,
    artifact,
    hard_mismatches: counts.hard,
    generated_at: cert.generated_at,
    sources: {
      tape: cert.sources.tape,
      live: cert.sources.live,
    },
  };
}

export function certifyCorpus({ stateDir, manifest } = {}) {
  const m = manifest || DEFAULT_MANIFEST;
  const dir = stateDir || process.env.GOFNQ_STATE_DIR || path.resolve("state");
  const btDir = path.join(dir, "backtest");
  const blockers = [];

  const holidays = new Set(m.holidays || []);
  const earlyClose = new Set((m.early_close || []).map((e) => `${e.date}|${e.session}`));
  const days = weekdaysInRange(m.from, m.to, holidays);
  const expectedBySym = {};
  const exceptionsBySym = {};
  for (const sym of m.symbols) {
    const exp = [];
    const exc = [];
    for (const d of days) {
      for (const s of m.sessions) {
        const key = `${d}|${s}|${sym}`;
        if (earlyClose.has(`${d}|${s}`)) exc.push(key);
        else exp.push(key);
      }
    }
    expectedBySym[sym] = exp;
    exceptionsBySym[sym] = exc;
  }
  const expectedSet = new Set(m.symbols.flatMap((sym) => expectedBySym[sym]));

  const requirements = {
    from: m.from,
    to: m.to,
    symbols: m.symbols,
    sessions: m.sessions,
    schema: m.schema,
    code_rev: m.code_rev,
    run_engine: m.run_engine ?? EXPECTED_RUN_ENGINE,
    tape_source: m.tape_source ?? EXPECTED_TAPE_SOURCE,
    brief_timeframes: m.brief_timeframes ?? DEFAULT_MANIFEST.brief_timeframes,
    expected_sessions_per_symbol: expectedBySym[m.symbols[0]]?.length ?? 0,
    session_windows: m.session_windows,
  };

  let runs = [];
  const indexJson = readJson(path.join(btDir, "index.json"), "missing_index", "malformed_index");
  if (!indexJson.ok) {
    blockers.push({ code: "no_index", message: `no readable index.json under ${btDir}` });
  } else {
    runs = Array.isArray(indexJson.value?.runs) ? indexJson.value.runs : [];
  }

  const inWindow = (r) => r && r.date >= m.from && r.date <= m.to && m.sessions.includes(r.session);
  const byKey = new Map();
  const unexpectedBySym = Object.fromEntries(m.symbols.map((sym) => [sym, new Set()]));
  for (const r of runs) {
    if (!inWindow(r) || !m.symbols.includes(r.symbol)) continue;
    const key = `${r.date}|${r.session}|${r.symbol}`;
    if (!expectedSet.has(key)) {
      unexpectedBySym[r.symbol].add(key);
      continue;
    }
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }

  const symbolsOut = {};
  for (const sym of m.symbols) {
    const missing = [];
    const duplicates = [];
    const invalid = [];
    const retries = [];
    const selected = {};
    const selected_artifacts = {};
    const no_trade_sessions = [];
    let valid = 0;

    for (const key of expectedBySym[sym]) {
      const results = (byKey.get(key) || []).map((r) => ({ r, v: validateRun(btDir, r, m) })).sort(newestFirst);
      for (const x of results.filter((x) => !x.v.ok)) {
        invalid.push({ run_id: x.r.run_id, key, reasons: x.v.reasons });
      }
      const good = results.filter((x) => x.v.ok);
      if (results.length > 1) {
        retries.push({
          key,
          candidates: results.map((x) => ({
            run_id: x.r.run_id,
            created_at: x.r.created_at,
            ok: x.v.ok,
            reasons: x.v.reasons,
          })),
          selected: good[0]?.r.run_id ?? null,
          newest_invalid: results.length > 0 ? !results[0].v.ok : false,
        });
      }
      if (good.length === 0) {
        missing.push(key);
        continue;
      }
      selected[key] = good[0].r.run_id;
      selected_artifacts[key] = {
        run_id: good[0].r.run_id,
        ...good[0].v.artifacts,
      };
      if (Number(good[0].r.no_trades) > 0) no_trade_sessions.push(key);
      valid += 1;
      if (good.length > 1) {
        duplicates.push({
          key,
          run_ids: good.map((x) => x.r.run_id),
          winner: good[0].r.run_id,
          note: "latest valid created_at wins; other valid retries reported, not counted",
        });
      }
    }

    symbolsOut[sym] = {
      expected: expectedBySym[sym].length,
      valid,
      missing,
      duplicates,
      retries,
      invalid,
      selected,
      selected_artifacts,
      no_trade_sessions,
      unexpected: [...unexpectedBySym[sym]].sort(),
      exceptions: exceptionsBySym[sym],
    };
    if (missing.length) {
      blockers.push({
        code: "missing_coverage",
        symbol: sym,
        count: missing.length,
        message: `${sym}: ${missing.length} expected key(s) with no valid run`,
      });
    }
  }

  const selection_digest = computeSelectionDigest(symbolsOut);
  const selectedArtifactsByKey = new Map(
    Object.values(symbolsOut).flatMap((symbol) => Object.entries(symbol.selected_artifacts)),
  );
  const parity = validateParityCertificate(btDir, m, selection_digest, selectedArtifactsByKey);
  if (!parity.certified) blockers.push({ code: "parity_not_certified", message: parity.evidence });

  return {
    manifest_id: m.manifest_id,
    certified: blockers.length === 0,
    requirements,
    selection_digest,
    symbols: symbolsOut,
    parity,
    blockers,
  };
}
