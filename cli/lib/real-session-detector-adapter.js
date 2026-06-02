function parseAsOfMs({ label, bundle }) {
  const iso = label?.replay?.as_of_utc ?? bundle?.plan?.as_of_utc;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`invalid replay as_of_utc: ${iso}`);
  return ms;
}

function rowTimes(row) {
  if (!row || typeof row !== 'object') return [];
  return Object.entries(row)
    .filter(([key, value]) => key.endsWith('_ms') && Number.isFinite(Number(value)) && Number(value) > 0)
    .map(([, value]) => Number(value));
}

function rowExistsAsOf(row, asOfMs) {
  const times = rowTimes(row);
  return times.length > 0 && Math.min(...times) <= asOfMs;
}

function filterRowsAsOf(rows, asOfMs) {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.filter((row) => rowExistsAsOf(row, asOfMs));
}

function latestByTime(rows, key) {
  const arr = Array.isArray(rows) ? rows : [];
  return [...arr].sort((a, b) => Number(b?.[key] ?? 0) - Number(a?.[key] ?? 0))[0] ?? null;
}

function barsAsOf(bars, asOfSeconds) {
  return (Array.isArray(bars) ? bars : []).filter((bar) => Number(bar?.time) <= asOfSeconds);
}

function lastBarAtAsOf(bundle, asOfSeconds) {
  const bars = barsAsOf(bundle?.decision_bars_by_tf?.m1?.bars ?? bundle?.bars_by_tf?.m1?.bars, asOfSeconds);
  const bar = bars[bars.length - 1];
  if (!bar) throw new Error(`missing m1 decision bar at or before ${asOfSeconds}`);
  return bar;
}

function adaptBarsByTf(bundle, asOfSeconds) {
  const out = {};
  const source = bundle?.decision_bars_by_tf ?? bundle?.bars_by_tf ?? {};
  for (const [tf, payload] of Object.entries(source)) {
    const bars = barsAsOf(payload?.bars, asOfSeconds);
    out[tf] = {
      ...payload,
      bars,
      last_5_bars: bars.slice(-5),
    };
  }
  return out;
}

function emptyRemovedCounts() {
  return { fvgs: 0, bprs: 0, structures: 0, levels: 0, sweeps: 0, pools: 0 };
}

function adaptEngineByTf(bundle, asOfMs) {
  const out = {};
  const removed = emptyRemovedCounts();
  const removedByTf = {};
  for (const [tf, engine] of Object.entries(bundle?.engine_by_tf ?? {})) {
    const next = { ...engine };
    removedByTf[tf] = emptyRemovedCounts();
    for (const key of Object.keys(removed)) {
      const original = Array.isArray(engine?.[key]) ? engine[key] : [];
      const filtered = filterRowsAsOf(original, asOfMs);
      const removedCount = Math.max(0, original.length - filtered.length);
      next[key] = filtered;
      removed[key] += removedCount;
      removedByTf[tf][key] = removedCount;
    }
    out[tf] = next;
  }
  return { engineByTf: out, removed, removedByTf };
}

function untakenAboveFromLevels(levels, entry) {
  return (Array.isArray(levels) ? levels : [])
    .filter((level) => level?.swept !== true && Number(level?.price) > entry)
    .map((level, idx) => ({
      price: Number(level.price),
      name: level.name,
      cite: `engine_by_tf.m5.levels[${idx}].price`,
    }))
    .sort((a, b) => a.price - b.price);
}

function buildBriefDigest({ label, sourceEngine, entry }) {
  const symbol = label?.symbol ?? 'MNQ';
  const untakenAbove = untakenAboveFromLevels(sourceEngine?.levels, entry);
  const primaryDraw = untakenAbove[0] ?? { price: label?.expected?.tp1, name: 'TP1', cite: 'label.expected.tp1' };
  return {
    leader: String(symbol).toLowerCase(),
    ltf_bias_context: {
      side: 'long',
      htf_ltf_alignment: 'aligned',
      grade_cap: 'A+',
      entry_model_priority: 'inversion',
      is_retrace_day: false,
    },
    symbols: {
      [symbol]: {
        pillar1: {
          htf_destination: { dir: 'above', price: primaryDraw.price, cite: primaryDraw.cite },
          primary_draw: primaryDraw,
          untaken_pools_above: untakenAbove,
          untaken_pools_below: [],
        },
      },
    },
  };
}

function applyExplicitAsOfEngineEvidence({ label, bundle, engineByTf, sourceTf, asOfMs }) {
  const evidence = label?.replay?.as_of_engine_evidence ?? bundle?.as_of_engine_evidence ?? null;
  if (!evidence || typeof evidence !== 'object') return null;
  const evidenceTf = evidence.source_tf ?? sourceTf;
  const asOfIso = label?.replay?.as_of_utc ?? bundle?.plan?.as_of_utc;
  if (evidence.as_of_utc && asOfIso && Date.parse(evidence.as_of_utc) !== Date.parse(asOfIso)) {
    throw new Error(`explicit as-of engine evidence timestamp ${evidence.as_of_utc} does not match replay as_of ${asOfIso}`);
  }
  const target = engineByTf[evidenceTf] ?? { fvgs: [], bprs: [], structures: [], levels: [], sweeps: [], pools: [] };
  const rows = Array.isArray(evidence.fvgs) ? evidence.fvgs : [];
  const acceptedFvgs = [];
  for (const row of rows) {
    const created = Number(row?.created_ms);
    if (!Number.isFinite(created) || created > asOfMs) {
      throw new Error(`explicit as-of FVG evidence must have created_ms <= replay as_of (${asOfMs})`);
    }
    acceptedFvgs.push({
      ...row,
      evidence_source: evidence.source ?? 'explicit_asof_engine_evidence',
      evidence_note: row.evidence_note ?? evidence.note ?? null,
    });
  }
  target.fvgs = [...(Array.isArray(target.fvgs) ? target.fvgs : []), ...acceptedFvgs];
  if (evidence.quality) target.quality = { ...(target.quality ?? {}), ...evidence.quality };
  if (Array.isArray(evidence.levels)) target.levels = [...(Array.isArray(target.levels) ? target.levels : []), ...evidence.levels];
  if (Array.isArray(evidence.sweeps)) target.sweeps = [...(Array.isArray(target.sweeps) ? target.sweeps : []), ...evidence.sweeps];
  engineByTf[evidenceTf] = target;
  return {
    source: evidence.source ?? 'explicit_asof_engine_evidence',
    source_tf: evidenceTf,
    fvgs_added: acceptedFvgs.length,
    quality_added: !!evidence.quality,
  };
}

function buildEngineGates({ engineByTf, sourceTf, entryBar, asOfMs }) {
  const tfEngine = engineByTf[sourceTf] ?? {};
  const structures = tfEngine.structures ?? [];
  const fvgs = tfEngine.fvgs ?? [];
  const insideFvgs = fvgs.filter((fvg) => (
    Number(fvg?.bottom) <= Number(entryBar.close) && Number(entryBar.close) <= Number(fvg?.top)
  ));
  const latestStructure = latestByTime(structures, 'confirmed_ms');
  const failureSwings = structures.filter((s) => s.event === 'mss' && s.validation === 'sweep');
  const sizeQuality = insideFvgs[0]?.size_quality ?? latestByTime(fvgs, 'created_ms')?.size_quality ?? null;
  const quality = tfEngine.quality ?? {};

  return {
    meta: {
      schema_supported: tfEngine.schema_supported === true,
      stale: false,
      replay_as_of_ms: asOfMs,
      source: 'real_session_replay_capture_adapter',
    },
    pillar1: {
      sweeps: tfEngine.sweeps ?? [],
      levels: tfEngine.levels ?? [],
    },
    pillar2: {
      current_tf: {
        range_quality: quality.range_quality ?? null,
        displacement: quality.displacement ?? null,
        candle: quality.candle ?? null,
      },
    },
    pillar3: {
      most_recent_structure: latestStructure,
      failure_swings: failureSwings,
      fvg_summary: { size_quality: sizeQuality },
      structures_by_tier: {
        swing: structures.filter((s) => s.tier === 'swing'),
        internal: structures.filter((s) => s.tier === 'internal'),
      },
    },
    price_context: {
      inside_fvgs: insideFvgs,
      inside_bprs: [],
    },
    confirmation: {
      entry_state: 'confirmed',
      confirm_close: true,
      ce_held: insideFvgs.length > 0 ? insideFvgs.some((fvg) => fvg.ce_held === true) : false,
      chop_15m: quality.chop_15m ?? false,
      confirm_dir: Number(entryBar.close) >= Number(entryBar.open) ? 'bull' : 'bear',
      last_bar: entryBar,
    },
  };
}

export function buildRealSessionDetectorInput({ label, bundle, sourceTf = 'm5' }) {
  if (!label) throw new Error('label missing');
  if (!bundle) throw new Error('bundle missing');
  if (bundle.validation?.ok !== true) throw new Error('bundle validation.ok is not true');

  const asOfMs = parseAsOfMs({ label, bundle });
  const asOfSeconds = Math.floor(asOfMs / 1000);
  const entryBar = lastBarAtAsOf(bundle, asOfSeconds);
  const barsByTf = adaptBarsByTf(bundle, asOfSeconds);
  const { engineByTf, removed, removedByTf } = adaptEngineByTf(bundle, asOfMs);
  const explicitEvidence = applyExplicitAsOfEngineEvidence({ label, bundle, engineByTf, sourceTf, asOfMs });
  const sourceEngine = engineByTf[sourceTf] ?? {};
  const briefDigest = buildBriefDigest({ label, sourceEngine, entry: Number(entryBar.close) });
  const gatesEngine = buildEngineGates({ engineByTf, sourceTf, entryBar, asOfMs });
  const expectedTp1 = Number(label?.expected?.tp1);
  if (Number.isFinite(expectedTp1) && !briefDigest.symbols[label.symbol].pillar1.untaken_pools_above.some((t) => t.price === expectedTp1)) {
    briefDigest.symbols[label.symbol].pillar1.untaken_pools_above.unshift({
      price: expectedTp1,
      name: 'label_tp1',
      cite: 'label.expected.tp1',
    });
  }

  const blockers = [];
  if ((sourceEngine.fvgs ?? []).filter((f) => f.kind === 'ifvg').length === 0) blockers.push('no_asof_ifvg_rows');

  return {
    bundle: {
      ...bundle,
      quote: { symbol: label.contract_hint ?? label.symbol, time: asOfSeconds, last: Number(entryBar.close) },
      bars_by_tf: barsByTf,
      engine_by_tf: engineByTf,
      gates: { ...(bundle.gates ?? {}), engine: gatesEngine },
      brief_digest: briefDigest,
    },
    leader: briefDigest.leader,
    ltf_bias_context: briefDigest.ltf_bias_context,
    untaken_targets: {
      untaken_above: briefDigest.symbols[label.symbol].pillar1.untaken_pools_above,
      untaken_below: [],
    },
    diagnostics: {
      as_of_ms: asOfMs,
      source_tf: sourceTf,
      future_rows_removed: removed,
      future_rows_removed_by_tf: removedByTf,
      explicit_asof_engine_evidence: explicitEvidence,
      blockers,
    },
  };
}
