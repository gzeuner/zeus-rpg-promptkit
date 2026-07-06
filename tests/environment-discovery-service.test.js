const test = require('node:test');
const assert = require('node:assert/strict');

const {
  discoverEnvironment,
  suggestResourcesConfig,
  buildSchemaInventoryQuery,
  buildSourceFileInventoryQuery,
  buildTableInventoryQuery,
  buildMemberInventoryQuery,
  KNOWN_SOURCE_FILE_NAMES,
  isSystemSchema,
} = require('../src/config/environmentDiscoveryService');

function makeFakeRunner(handlers) {
  const calls = [];
  return {
    calls,
    runQuery: ({ query }) => {
      calls.push(query);
      for (const [needle, rows] of handlers) {
        if (query.includes(needle)) {
          return { columns: [], rows };
        }
      }
      return { columns: [], rows: [] };
    },
  };
}

test('query builders are read-only and escape identifiers', () => {
  const schemaQuery = buildSchemaInventoryQuery({ schemas: ["AP'PLIB"] });
  assert.match(schemaQuery, /^SELECT/);
  assert.match(schemaQuery, /QSYS2\.SYSSCHEMAS/);
  assert.match(schemaQuery, /AP''PLIB/); // single quote escaped

  const sourceQuery = buildSourceFileInventoryQuery({ libraries: ['DEVLIB'] });
  for (const name of KNOWN_SOURCE_FILE_NAMES) {
    assert.ok(sourceQuery.includes(`'${name}'`), `expected ${name} in source query`);
  }
  assert.match(sourceQuery, /TABLE_SCHEMA IN \('DEVLIB'\)/);

  const tableQuery = buildTableInventoryQuery({ schema: 'appdata' });
  assert.match(tableQuery, /TABLE_SCHEMA = 'APPDATA'/);

  const memberQuery = buildMemberInventoryQuery({ schema: 'devlib', sourceFile: 'qrpglesrc' });
  assert.match(memberQuery, /SYSPARTITIONSTAT/);
  assert.match(memberQuery, /'DEVLIB'/);
  assert.match(memberQuery, /'QRPGLESRC'/);

  // Builders must reject injection attempts via invalid identifiers.
  assert.throws(() => buildTableInventoryQuery({ schema: 'A; DROP TABLE X' }), /Invalid schema/);
});

test('discoverEnvironment assembles a sanitized report from injected rows', async () => {
  const { runQuery, calls } = makeFakeRunner([
    ['SYSSCHEMAS', [{ SCHEMA_NAME: 'DEVLIB' }, { SCHEMA_NAME: 'APPDATA' }]],
    ['SYSTABLES WHERE TABLE_NAME IN', [
      { TABLE_SCHEMA: 'DEVLIB', TABLE_NAME: 'QRPGLESRC', TABLE_TEXT: 'RPG source' },
      { TABLE_SCHEMA: 'DEVLIB', TABLE_NAME: 'QDDSSRC', TABLE_TEXT: 'DDS source' },
    ]],
    ['TABLE_NAME NOT IN', [
      { TABLE_SCHEMA: 'APPDATA', TABLE_NAME: 'CUSTOMER', TABLE_TYPE: 'T' },
      { TABLE_SCHEMA: 'APPDATA', TABLE_NAME: 'ORDERS', TABLE_TYPE: 'T' },
    ]],
    ['SYSPARTITIONSTAT WHERE TABLE_SCHEMA = \'DEVLIB\' AND TABLE_NAME = \'QRPGLESRC\'', [{ MEMBER_NAME: 'ORDERPGM' }, { MEMBER_NAME: 'CUSTSRV' }]],
  ]);

  const report = await discoverEnvironment({
    dbConfig: { host: 'test.example.local', user: 'u', password: 'p' },
    scope: { libraries: ['DEVLIB'], includeMembers: true },
    runQuery,
    options: { includeMembers: true },
  });

  assert.equal(report.kind, 'environment-discovery-report');
  assert.equal(report.target.host.toLowerCase(), 'test.example.local');
  assert.deepEqual(report.sourceLibraries, ['DEVLIB']);
  assert.deepEqual(report.sourceFiles.map((f) => f.name), ['QDDSSRC', 'QRPGLESRC']);
  assert.deepEqual(report.tables.map((t) => t.name), ['CUSTOMER', 'ORDERS']);
  assert.deepEqual(report.members.map((m) => m.name), ['CUSTSRV', 'ORDERPGM']);

  // No secrets leak into the report.
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /"password"/);
  assert.ok(calls.length >= 3);
});

test('discoverEnvironment records notes when a query fails (best-effort, read-only)', async () => {
  const runQuery = ({ query }) => {
    if (query.includes('SYSSCHEMAS')) {
      throw new Error('SQL0204 not authorized');
    }
    return { rows: [] };
  };
  const report = await discoverEnvironment({
    dbConfig: { host: 'h', user: 'u', password: 'p' },
    runQuery,
  });
  assert.ok(report.notes.some((note) => /Schema discovery skipped/.test(note)));
});

test('suggestResourcesConfig builds a paste-ready resources skeleton', () => {
  const report = {
    sourceLibraries: ['DEVLIB'],
    sourceFiles: [{ schema: 'DEVLIB', name: 'QRPGLESRC' }, { schema: 'DEVLIB', name: 'QDDSSRC' }],
    schemas: ['DEVLIB', 'APPDATA'],
    tables: [{ schema: 'APPDATA', name: 'CUSTOMER' }],
    members: [{ schema: 'DEVLIB', sourceFile: 'QRPGLESRC', name: 'ORDERPGM' }],
  };
  const skeleton = suggestResourcesConfig(report, { system: 'test' });
  assert.equal(skeleton.sourceCode.system, 'test');
  assert.deepEqual(skeleton.sourceCode.libraries, ['DEVLIB']);
  assert.deepEqual(skeleton.sourceCode.sourceFiles, ['QDDSSRC', 'QRPGLESRC']);
  assert.deepEqual(skeleton.sourceCode.members, ['ORDERPGM']);
  assert.deepEqual(skeleton.objects.objectTypes, ['*PGM', '*SRVPGM']);
  assert.deepEqual(skeleton.data.schemas, ['APPDATA']);
  assert.equal(skeleton.metadata.system, 'test');
});

test('suggestResourcesConfig omits system when none is provided', () => {
  const skeleton = suggestResourcesConfig({ sourceLibraries: ['L'], sourceFiles: [{ name: 'QRPGLESRC' }] });
  assert.equal(skeleton.sourceCode.system, undefined);
  assert.deepEqual(skeleton.sourceCode.sourceFiles, ['QRPGLESRC']);
});

test('KNOWN_SOURCE_FILE_NAMES includes QTBLSRC (SQL DDL table source)', () => {
  assert.ok(KNOWN_SOURCE_FILE_NAMES.includes('QTBLSRC'));
  const sourceQuery = buildSourceFileInventoryQuery({});
  assert.ok(sourceQuery.includes("'QTBLSRC'"));
});

test('isSystemSchema flags IBM-supplied / tooling libraries', () => {
  for (const name of ['QGPL', 'QSYS2', 'SYSIBM', '#CGULIB', '$$EDHJRN', '@TOOLS', '']) {
    assert.equal(isSystemSchema(name), true, `${name} should be a system schema`);
  }
  for (const name of ['DEVLIB', 'APPDATA', 'OBJEKTTEST', 'REPORTING']) {
    assert.equal(isSystemSchema(name), false, `${name} should be a user schema`);
  }
});

test('discoverEnvironment skips system schemas for bounded table discovery', async () => {
  // Inventory returns system libs first (alphabetical), like a real IBM i.
  const { runQuery } = makeFakeRunner([
    ['SYSSCHEMAS', [
      { SCHEMA_NAME: '#CGULIB' },
      { SCHEMA_NAME: '$$EDHJRN' },
      { SCHEMA_NAME: 'APPDATA' },
      { SCHEMA_NAME: 'QGPL' },
    ]],
    ['TABLE_NAME NOT IN', [{ TABLE_SCHEMA: 'APPDATA', TABLE_NAME: 'CUSTOMER', TABLE_TYPE: 'T' }]],
  ]);

  const report = await discoverEnvironment({
    dbConfig: { host: 'h', user: 'u', password: 'p' },
    runQuery,
    options: { maxSchemasForTables: 2 },
  });

  // Without filtering, the budget (2) would be spent on '#CGULIB' and '$$EDHJRN'
  // (which validateSqlIdentifier rejects) and produce only noise notes.
  assert.deepEqual(report.tables.map((t) => t.name), ['CUSTOMER']);
  assert.equal(report.notes.length, 0);
});

test('suggestResourcesConfig filters system schemas and bounds the list', () => {
  const manyUserSchemas = Array.from({ length: 40 }, (_, i) => `USERLIB${String(i).padStart(2, '0')}`);
  const report = {
    sourceLibraries: ['DEVLIB'],
    sourceFiles: [{ schema: 'DEVLIB', name: 'QRPGLESRC' }],
    schemas: ['#CGULIB', '$$EDHJRN', 'QGPL', 'SYSIBM', ...manyUserSchemas],
    tables: [],
  };
  const skeleton = suggestResourcesConfig(report);
  // No system schemas leak into the skeleton.
  assert.ok(!skeleton.metadata.schemas.some((s) => isSystemSchema(s)));
  assert.ok(!skeleton.data.schemas.some((s) => isSystemSchema(s)));
  // Bounded to a usable size, not all discovered schemas.
  assert.ok(skeleton.metadata.schemas.length <= 25);
  assert.ok(skeleton.metadata.schemas.includes('USERLIB00'));
});

