const BLOCKED_HEALTH = (blockers) => ({
  status: 'blocked',
  schemaSupported: false,
  stale: true,
  blockers,
});

function hasRows(value) {
  return Array.isArray(value) && value.length > 0;
}

export function getIctEngineRows(engine = {}) {
  if (hasRows(engine.rows)) return engine.rows;
  if (hasRows(engine.ict_engine_rows)) return engine.ict_engine_rows;
  if (hasRows(engine.ictEngineRows)) return engine.ictEngineRows;
  if (hasRows(engine.tables?.rows)) return engine.tables.rows;
  if (hasRows(engine.pineTables?.rows)) return engine.pineTables.rows;
  if (Array.isArray(engine.studies)) {
    return engine.studies.flatMap((study) =>
      (study?.tables ?? []).flatMap((table) => table?.rows ?? [])
    );
  }
  return [];
}

export function evaluateSourceHealth(bundle = {}) {
  const engine = bundle?.gates?.engine;
  if (!engine) return BLOCKED_HEALTH(['missing_gates_engine']);

  const meta = engine.meta;
  if (!meta) return BLOCKED_HEALTH(['missing_gates_engine_meta']);

  const schemaSupported = meta.schemaSupported === true || meta.schema_supported === true;
  const stale = meta.stale;
  const rows = getIctEngineRows(engine);
  const blockers = [];

  if (!schemaSupported) blockers.push('unsupported_ict_schema');
  if (stale !== false) blockers.push('stale_source');
  if (rows.length === 0) blockers.push('missing_ict_engine_rows');

  if (blockers.length > 0) {
    return {
      status: 'blocked',
      schemaSupported,
      stale: stale !== false,
      blockers,
    };
  }

  return {
    status: 'fresh',
    schemaSupported: true,
    stale: false,
    blockers: [],
  };
}

export function isTradableSourceHealth(sourceHealth) {
  const blockers = sourceHealth?.blockers ?? [];
  return sourceHealth?.status === 'fresh'
    && sourceHealth?.stale === false
    && sourceHealth?.schemaSupported === true
    && Array.isArray(blockers)
    && blockers.length === 0;
}
