import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSourceHealth, isTradableSourceHealth } from '../../../app/main/strategy/context/source-health.js';

test('isTradableSourceHealth: accepts only explicit fresh, non-stale, schema-supported source health', () => {
  assert.equal(isTradableSourceHealth({ status: 'fresh', stale: false, schemaSupported: true }), true);
  assert.equal(isTradableSourceHealth({ status: 'fresh', stale: true, schemaSupported: true }), false);
  assert.equal(isTradableSourceHealth({ status: 'fresh', stale: false, schemaSupported: false }), false);
  assert.equal(isTradableSourceHealth({ status: 'blocked', stale: false, schemaSupported: true }), false);
  assert.equal(isTradableSourceHealth({}), false);
  assert.equal(isTradableSourceHealth(null), false);
});

test('evaluateSourceHealth: blocks missing engine and missing meta with machine-readable blockers', () => {
  assert.deepEqual(evaluateSourceHealth({ gates: {} }), {
    status: 'blocked',
    schemaSupported: false,
    stale: true,
    blockers: ['missing_gates_engine'],
  });

  assert.deepEqual(evaluateSourceHealth({ gates: { engine: {} } }), {
    status: 'blocked',
    schemaSupported: false,
    stale: true,
    blockers: ['missing_gates_engine_meta'],
  });
});

test('evaluateSourceHealth: blocks unsupported schema, stale data, and missing ICT rows', () => {
  const rows = [{ kind: 'fvg', dir: 'bull' }];
  const base = { gates: { engine: { meta: { schema_supported: true, stale: false } } } };
  assert.deepEqual(evaluateSourceHealth({ gates: { engine: { meta: { schema_supported: false, stale: false }, rows } } }).blockers, ['unsupported_ict_schema']);
  assert.deepEqual(evaluateSourceHealth({ gates: { engine: { meta: { schema_supported: true, stale: true }, rows } } }).blockers, ['stale_source']);
  assert.deepEqual(evaluateSourceHealth(base).blockers, ['missing_ict_engine_rows']);
});

test('evaluateSourceHealth: fresh only when schema is supported, stale is false, and ICT rows exist', () => {
  const result = evaluateSourceHealth({
    gates: {
      engine: {
        meta: { schema_supported: true, stale: false },
        rows: [{ kind: 'fvg', dir: 'bull' }],
      },
    },
  });

  assert.deepEqual(result, {
    status: 'fresh',
    schemaSupported: true,
    stale: false,
    blockers: [],
  });
});
