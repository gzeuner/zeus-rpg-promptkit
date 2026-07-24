'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const projectIntelligence = require('../src/projectIntelligence');
const {
  CONTRACT_IDS,
  DERIVATION_CLASSES,
  REASON_CODES,
  PROJECT_INTELLIGENCE_SCHEMAS,
  validateProjectIntelligenceContract,
  createProjectIntelligenceRegistry,
  runProjectIntelligenceContractTests,
  fixtures,
  projectSchema,
  symbolSchema,
  sourceUnitSchema,
  contextPackageSchema,
  operationResultSchema,
  isSafeRelativePath,
} = projectIntelligence;

const { createSchemaRegistry } = require('../src/core/contracts');
const { CONTRACT_IDS: CORE_IDS, INITIAL_SCHEMAS } = require('../src/core/contracts/schemas');
const { createZeus } = require('../src/api/zeusApi');

test('ZPI contract ids are registered in INITIAL_SCHEMAS and core CONTRACT_IDS', () => {
  for (const id of Object.values(CONTRACT_IDS)) {
    assert.ok(INITIAL_SCHEMAS[id], `missing INITIAL_SCHEMAS entry for ${id}`);
    assert.equal(INITIAL_SCHEMAS[id].version, 1);
  }
  assert.equal(CORE_IDS.PROJECT_KNOWLEDGE_PROJECT, CONTRACT_IDS.PROJECT);
  assert.equal(CORE_IDS.PROJECT_KNOWLEDGE_OPERATION_RESULT, CONTRACT_IDS.OPERATION_RESULT);
  assert.equal(Object.keys(PROJECT_INTELLIGENCE_SCHEMAS).length, 12);
});

test('package export surface is available via api createZeus', () => {
  const api = createZeus();
  assert.ok(api.projectIntelligence);
  assert.equal(api.projectIntelligence.CONTRACT_IDS.PROJECT, CONTRACT_IDS.PROJECT);
  assert.equal(typeof api.projectIntelligence.validateProjectIntelligenceContract, 'function');
});

test('valid fixtures pass schema validation', () => {
  const cases = [
    [CONTRACT_IDS.PROJECT, fixtures.project()],
    [CONTRACT_IDS.SNAPSHOT, fixtures.snapshot()],
    [CONTRACT_IDS.SOURCE_UNIT, fixtures.sourceUnit()],
    [CONTRACT_IDS.SOURCE_SPAN, fixtures.sourceSpan()],
    [CONTRACT_IDS.SYMBOL, fixtures.symbol()],
    [CONTRACT_IDS.RELATIONSHIP, fixtures.relationship()],
    [CONTRACT_IDS.ANALYZER_RUN, fixtures.analyzerRun()],
    [CONTRACT_IDS.EVIDENCE, fixtures.evidence()],
    [CONTRACT_IDS.SUMMARY, fixtures.summary()],
    [CONTRACT_IDS.DIAGNOSTIC, fixtures.diagnostic()],
    [CONTRACT_IDS.CONTEXT_PACKAGE, fixtures.contextPackage()],
    [CONTRACT_IDS.OPERATION_RESULT, fixtures.operationResultOk()],
    [CONTRACT_IDS.OPERATION_RESULT, fixtures.operationResultFail()],
  ];
  for (const [id, value] of cases) {
    const result = validateProjectIntelligenceContract(id, value);
    assert.equal(result.ok, true, `${id}: ${JSON.stringify(result.errors)}`);
  }
});

test('unknown schema version fails closed with stable reason code', () => {
  const result = validateProjectIntelligenceContract(
    CONTRACT_IDS.SNAPSHOT,
    fixtures.snapshot({ schemaVersion: 2 })
  );
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.SCHEMA_VERSION_UNSUPPORTED);
  assert.ok(result.errors.some(e => e.path === '/schemaVersion'));
});

test('unknown enum values fail closed', () => {
  assert.ok(
    symbolSchema(
      fixtures.symbol({
        symbolKind: 'NOT_A_KIND',
        provenance: fixtures.provenance({ derivationClass: DERIVATION_CLASSES.INFERRED }),
        evidenceReferences: undefined,
      })
    ).some(e => e.path === '/symbolKind')
  );
  assert.ok(
    projectIntelligence
      .diagnosticSchema(fixtures.diagnostic({ reasonCode: 'ZPI.NOT_REAL' }))
      .some(e => e.path === '/reasonCode')
  );
});

test('VERIFIED requires evidence references', () => {
  const errors = symbolSchema(
    fixtures.symbol({
      provenance: fixtures.provenance({ derivationClass: DERIVATION_CLASSES.VERIFIED }),
      evidenceReferences: [],
    })
  );
  assert.ok(errors.some(e => e.path === '/evidenceReferences'));
});

test('derived packages cannot claim source of truth', () => {
  assert.ok(
    projectIntelligence
      .summarySchema(fixtures.summary({ sourceOfTruth: true }))
      .some(e => e.path === '/sourceOfTruth')
  );
  assert.ok(
    contextPackageSchema(fixtures.contextPackage({ sourceOfTruth: true })).some(
      e => e.path === '/sourceOfTruth'
    )
  );
  assert.ok(
    projectIntelligence
      .summarySchema(fixtures.summary({ derivationClass: DERIVATION_CLASSES.VERIFIED }))
      .some(e => e.path === '/derivationClass')
  );
});

test('source unit relative paths reject traversal and absolute forms', () => {
  const badPaths = [
    '../escape.rpgle',
    '/etc/passwd',
    'C:\\Windows\\a.rpgle',
    '\\\\server\\share\\a.rpgle',
    'a\u0000b.rpgle',
  ];
  for (const relativePath of badPaths) {
    assert.equal(isSafeRelativePath(relativePath), false, relativePath);
    const errors = sourceUnitSchema(fixtures.sourceUnit({ relativePath }));
    assert.ok(
      errors.some(e => e.path === '/relativePath'),
      `expected path error for ${relativePath}`
    );
  }
  assert.equal(sourceUnitSchema(fixtures.sourceUnit()).length, 0);
});

test('content hash must be lowercase sha256 hex', () => {
  const errors = sourceUnitSchema(fixtures.sourceUnit({ contentHash: 'NOT-A-HASH' }));
  assert.ok(errors.some(e => e.path === '/contentHash'));
});

test('failed operation results require reasonCode and message', () => {
  assert.equal(operationResultSchema(fixtures.operationResultFail()).length, 0);
  const missing = operationResultSchema(
    fixtures.operationResultFail({ reasonCode: undefined, message: undefined })
  );
  assert.ok(missing.some(e => e.path === '/reasonCode'));
  assert.ok(missing.some(e => e.path === '/message'));
});

test('context package omissions require closed reason codes', () => {
  const errors = contextPackageSchema(
    fixtures.contextPackage({
      omissions: [{ reasonCode: 'OPEN_ENDED', description: 'x' }],
    })
  );
  assert.ok(errors.some(e => e.path === '/omissions/0/reasonCode'));
});

test('registry validation matches direct schema functions', () => {
  const registry = createProjectIntelligenceRegistry();
  const direct = projectSchema(fixtures.project());
  const via = registry.validate(CONTRACT_IDS.PROJECT, 1, fixtures.project());
  assert.equal(direct.length, 0);
  assert.equal(via.ok, true);

  const bad = registry.validate(CONTRACT_IDS.PROJECT, 1, { schemaVersion: 1 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => e.path === '/projectId'));
});

test('core INITIAL_SCHEMAS registry accepts ZPI contracts', () => {
  const registry = createSchemaRegistry();
  for (const [id, { version, schema }] of Object.entries(INITIAL_SCHEMAS)) {
    registry.register({ id, version, schema });
  }
  const result = registry.validate(CONTRACT_IDS.CONTEXT_PACKAGE, 1, fixtures.contextPackage());
  assert.equal(result.ok, true);
});

test('public contract test kit passes', async () => {
  const report = await runProjectIntelligenceContractTests();
  assert.equal(report.ok, true);
  assert.ok(report.results.length >= 10);
  assert.ok(report.results.every(r => r.ok));
});

test('reason code messages are complete and free of host-path leakage', () => {
  for (const [key, code] of Object.entries(REASON_CODES)) {
    assert.equal(typeof projectIntelligence.REASON_CODE_MESSAGES[code], 'string', key);
    const msg = projectIntelligence.REASON_CODE_MESSAGES[code];
    assert.ok(!msg.includes('C:\\'), key);
    assert.ok(!msg.includes('/Users/'), key);
    assert.ok(!msg.includes('\\\\server'), key);
    // Messages may mention the concept of secrets, but must not embed values.
    assert.ok(!/=[A-Za-z0-9+/=]{16,}/.test(msg), key);
  }
});
