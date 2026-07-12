const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeLibraryList,
  prependSchemaDirective,
  validateDefaultSchema,
} = require('../src/core/queryService');

test('validateDefaultSchema normalizes valid schema names', () => {
  assert.equal(validateDefaultSchema('schema_a'), 'SCHEMA_A');
  assert.equal(validateDefaultSchema('  schema_b  '), 'SCHEMA_B');
  assert.equal(validateDefaultSchema(undefined), null);
});

test('validateDefaultSchema rejects invalid schema names', () => {
  assert.throws(() => validateDefaultSchema('bad-schema'), /--default-schema/);
});

test('normalizeLibraryList supports comma and whitespace separated input', () => {
  assert.deepEqual(normalizeLibraryList('lib_a,lib_b'), ['LIB_A', 'LIB_B']);
  assert.deepEqual(normalizeLibraryList('lib_a lib_b lib_a'), ['LIB_A', 'LIB_B']);
  assert.deepEqual(normalizeLibraryList(['lib_a', 'LIB_B']), ['LIB_A', 'LIB_B']);
});

test('prependSchemaDirective adds SET CURRENT SCHEMA before SQL', () => {
  const sql = prependSchemaDirective('SELECT * FROM TABLE_A', 'SCHEMA_A');
  assert.equal(sql, "SET CURRENT SCHEMA = 'SCHEMA_A';\nSELECT * FROM TABLE_A");
});
