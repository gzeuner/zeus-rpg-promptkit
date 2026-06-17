const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildResolveObjectDiagnosticLines,
  normalizeRequireColumns,
} = require('../src/cli/commands/resolveObjectCommand');

test('normalizeRequireColumns normalizes scalar and array input', () => {
  assert.deepEqual(normalizeRequireColumns(' order_id '), ['order_id']);
  assert.deepEqual(normalizeRequireColumns([' order_id ', '', 'CUSTOMER_ID']), ['order_id', 'CUSTOMER_ID']);
  assert.deepEqual(normalizeRequireColumns(false), []);
});

test('buildResolveObjectDiagnosticLines renders search guidance for schema-free lookups', () => {
  const lines = buildResolveObjectDiagnosticLines({
    diagnostics: {
      searchMode: 'schema-discovery',
      schemaProvided: false,
      attemptCount: 2,
      elapsedMs: 4123,
      fallbackUsed: true,
      catalogVariant: 'without-system-table-name',
      recommendations: [
        'Schema-free resolution searches across visible schemas and can be slower on shared systems.',
        'Use --schema ZEUS1 for faster follow-up checks.',
      ],
    },
  });

  assert.deepEqual(lines, [
    'Search mode: schema-discovery (all visible schemas)',
    'Catalog attempts: 2',
    'Elapsed: 4123 ms',
    'Catalog fallback: without-system-table-name',
    'Hint: Schema-free resolution searches across visible schemas and can be slower on shared systems.',
    'Hint: Use --schema ZEUS1 for faster follow-up checks.',
  ]);
});
