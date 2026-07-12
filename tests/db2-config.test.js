const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildJdbcUrl,
  normalizeLibraryList,
  resolveDefaultSchema,
} = require('../src/db2/db2Config');

test('resolveDefaultSchema prefers defaultSchema over fallback schema keys', () => {
  assert.equal(resolveDefaultSchema({ defaultSchema: 'schema_a' }), 'SCHEMA_A');
  assert.equal(resolveDefaultSchema({ defaultLibrary: 'lib_a' }), 'LIB_A');
  assert.equal(resolveDefaultSchema({ schema: 'schema_b' }), 'SCHEMA_B');
  assert.equal(resolveDefaultSchema({ library: 'lib_b' }), 'LIB_B');
});

test('buildJdbcUrl appends libraries to JDBC URLs when defaultSchema is configured', () => {
  const url = buildJdbcUrl(
    {
      url: 'jdbc:as400://ibmi.example.com;naming=system',
    },
    'SCHEMA_A'
  );

  assert.equal(url, 'jdbc:as400://ibmi.example.com;naming=system;libraries=SCHEMA_A');
});

test('buildJdbcUrl overrides existing libraries when defaultSchema is configured', () => {
  const url = buildJdbcUrl(
    {
      url: 'jdbc:as400://ibmi.example.com;naming=system;libraries=SCHEMA_B',
    },
    'SCHEMA_A'
  );

  assert.equal(url, 'jdbc:as400://ibmi.example.com;naming=system;libraries=SCHEMA_A');
});

test('normalizeLibraryList returns a canonical comma-separated list', () => {
  assert.equal(normalizeLibraryList(['lib_a', 'lib_b', 'lib_a']), 'LIB_A,LIB_B');
  assert.equal(normalizeLibraryList('lib_a lib_b'), 'LIB_A,LIB_B');
});

test('buildJdbcUrl replaces existing libraries when libraryList is configured', () => {
  const url = buildJdbcUrl(
    {
      url: 'jdbc:as400://ibmi.example.com;naming=system;libraries=SCHEMA_B',
      libraryList: ['LIB_A', 'LIB_B'],
    },
    'SCHEMA_B'
  );

  assert.equal(url, 'jdbc:as400://ibmi.example.com;naming=system;libraries=LIB_A,LIB_B');
});
