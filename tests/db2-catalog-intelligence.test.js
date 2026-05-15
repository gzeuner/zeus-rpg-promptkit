const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildCanonicalAnalysisModel } = require('../src/context/canonicalAnalysisModel');
const { buildContext } = require('../src/context/contextBuilder');
const { buildDb2SourceLinkage } = require('../src/db2/db2EvidenceLinker');
const { buildDb2CatalogSemanticUpdates } = require('../src/db2/catalogSemanticModel');
const {
  buildExtractionPlan,
  buildTestDataPolicy,
  resolveMaskingPlanForTable,
} = require('../src/db2/testDataExportService');

function createCanonicalFixture(tempRoot) {
  const sourceFile = path.join(tempRoot, 'ORDERPGM.rpgle');
  fs.writeFileSync(sourceFile, '      * ENTRY\n', 'utf8');

  const canonicalAnalysis = buildCanonicalAnalysisModel({
    program: 'ORDERPGM',
    sourceRoot: tempRoot,
    sourceFiles: [{
      path: sourceFile,
      sizeBytes: 16,
      lines: 1,
      sourceType: 'RPGLE',
    }],
    dependencies: {
      tables: [{
        name: 'CUSTPF',
        evidence: [{ file: sourceFile, line: 10 }],
      }],
      calls: [{
        name: 'INVOICEP',
        evidence: [{ file: sourceFile, line: 22 }],
      }],
      copyMembers: [],
      sqlStatements: [],
      procedures: [],
      prototypes: [{
        name: 'POSTINV',
        ownerProgram: 'ORDERPGM',
        sourceFile,
        startLine: 30,
        endLine: 30,
        sourceForm: 'FREE',
        imported: true,
        externalName: 'POSTINV',
        evidence: [{ file: sourceFile, line: 30 }],
      }],
      procedureCalls: [],
      nativeFiles: [],
      nativeFileAccesses: [],
      modules: [],
      bindingDirectories: [],
      servicePrograms: [],
    },
    notes: [],
  });

  return {
    canonicalAnalysis,
    context: buildContext({ canonicalAnalysis }),
  };
}

test('DB2 linkage resolves requested tables by SQL name or system name', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2-catalog-linkage-'));
  try {
    const { canonicalAnalysis, context } = createCanonicalFixture(tempRoot);
    const exportedTables = [{
      schema: 'APP',
      table: 'CUSTOMERS',
      systemSchema: 'APP',
      systemName: 'CUSTPF',
      objectType: 'TABLE',
      lookupStrategy: 'IBM_I_CATALOG',
      columns: [{ name: 'CUSTNO', type: 'DECIMAL' }],
      foreignKeys: [],
      triggers: [],
      derivedObjects: [],
    }];

    const linkage = buildDb2SourceLinkage({
      requestedTables: ['CUSTPF', 'CUSTOMERS'],
      exportedTables,
      canonicalAnalysis,
      context,
    });

    const systemNameLink = linkage.tableLinks.find((entry) => entry.requestedName === 'CUSTPF');
    const sqlNameLink = linkage.tableLinks.find((entry) => entry.requestedName === 'CUSTOMERS');

    assert.equal(systemNameLink.matchStatus, 'resolved');
    assert.equal(systemNameLink.matches[0].matchType, 'SYSTEM_NAME');
    assert.equal(sqlNameLink.matchStatus, 'resolved');
    assert.equal(sqlNameLink.matches[0].matchType, 'SQL_NAME');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('DB2 test-data extraction plan matches metadata by dual name and skips ambiguous matches', () => {
  const metadataPayload = {
    tables: [
      {
        schema: 'APP',
        table: 'CUSTOMERS',
        systemSchema: 'APP',
        systemName: 'CUSTPF',
        columns: [{ name: 'CUSTNO', primaryKey: true }],
      },
      {
        schema: 'APP2',
        table: 'CUSTOMERS_ARCHIVE',
        systemSchema: 'APP2',
        systemName: 'CUSTPF',
        columns: [{ name: 'CUSTNO', primaryKey: true }],
      },
    ],
  };

  const resolvedPlan = buildExtractionPlan({
    requestedTables: [{ schema: '', table: 'CUSTOMERS' }],
    metadataPayload,
    defaultSchema: 'APP',
  });
  const ambiguousPlan = buildExtractionPlan({
    requestedTables: [{ schema: '', table: 'CUSTPF' }],
    metadataPayload,
    defaultSchema: 'APP',
  });

  assert.equal(resolvedPlan[0].status, 'pending');
  assert.equal(resolvedPlan[0].table, 'CUSTOMERS');
  assert.equal(resolvedPlan[0].systemName, 'CUSTPF');

  const skippedEntry = ambiguousPlan.find((entry) => entry.table === 'CUSTPF' && entry.status === 'skipped');
  assert.ok(skippedEntry);
  assert.match(skippedEntry.note, /matched multiple DB2 catalog objects/i);
});

test('DB2 test-data extraction plan applies allowlists and denylists before extraction', () => {
  const metadataPayload = {
    tables: [
      {
        schema: 'APP',
        table: 'CUSTOMERS',
        systemSchema: 'APP',
        systemName: 'CUSTPF',
        columns: [{ name: 'CUSTNO', primaryKey: true }],
      },
      {
        schema: 'APP',
        table: 'AUDITLOG',
        systemSchema: 'APP',
        systemName: 'AUDITPF',
        columns: [{ name: 'AUDITNO', primaryKey: true }],
      },
    ],
  };
  const policy = buildTestDataPolicy({
    allowTables: ['APP.CUSTOMERS', 'APP.AUDITLOG'],
    denyTables: ['APP.AUDITLOG'],
  });

  const plan = buildExtractionPlan({
    requestedTables: [{ schema: 'APP', table: 'CUSTOMERS' }, { schema: 'APP', table: 'AUDITLOG' }],
    metadataPayload,
    defaultSchema: 'APP',
    policy,
  });

  const customers = plan.find((entry) => entry.table === 'CUSTOMERS');
  const auditLog = plan.find((entry) => entry.table === 'AUDITLOG');
  assert.equal(customers.status, 'pending');
  assert.equal(customers.policyDecision.eligibility, 'eligible');
  assert.equal(auditLog.status, 'skipped');
  assert.equal(auditLog.policyDecision.eligibility, 'denied');
  assert.match(auditLog.note, /denylist/i);
});

test('DB2 test-data masking plan merges global and table-specific masking rules', () => {
  const policy = buildTestDataPolicy({
    maskColumns: ['EMAIL'],
    maskRules: [{
      schema: 'APP',
      table: 'CUSTOMERS',
      columns: ['PHONE'],
      value: 'MASKED_PHONE',
    }],
  });

  const maskingPlan = resolveMaskingPlanForTable({
    schema: 'APP',
    table: 'CUSTOMERS',
    systemSchema: 'APP',
    systemName: 'CUSTPF',
  }, policy);

  assert.deepEqual(maskingPlan.maskedColumns, ['EMAIL', 'PHONE']);
  assert.equal(maskingPlan.maskedColumnValues.get('EMAIL').value, 'MASKED');
  assert.equal(maskingPlan.maskedColumnValues.get('PHONE').value, 'MASKED_PHONE');
  assert.equal(maskingPlan.matchedRules.length, 1);
});

test('DB2 catalog semantic updates attach table identity, trigger relations, FK rules, and external object resolution', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2-semantic-updates-'));
  try {
    const { canonicalAnalysis, context } = createCanonicalFixture(tempRoot);
    const exportedTables = [{
      schema: 'APP',
      table: 'CUSTOMERS',
      systemSchema: 'APP',
      systemName: 'CUSTPF',
      objectType: 'TABLE',
      textDescription: 'Customer master',
      estimatedRowCount: 2400,
      lookupStrategy: 'IBM_I_CATALOG',
      columns: [{ name: 'CUSTNO', type: 'DECIMAL', primaryKey: true }],
      foreignKeys: [{
        column: 'COMPANY',
        referencesSchema: 'APP',
        referencesTable: 'COMPANY',
        referencesColumn: 'COMPANY',
        deleteRule: 'CASCADE',
        updateRule: 'RESTRICT',
      }],
      triggers: [{
        schema: 'APP',
        name: 'CUSTOMER_AUDIT',
        eventManipulation: 'INSERT',
        actionTiming: 'AFTER',
        actionOrientation: 'ROW',
      }],
      derivedObjects: [{
        schema: 'APP',
        name: 'CUSTOMERS_VIEW',
        objectType: 'VIEW',
      }],
    }];
    const linkage = buildDb2SourceLinkage({
      requestedTables: ['CUSTPF'],
      exportedTables,
      canonicalAnalysis,
      context,
    });

    const updates = buildDb2CatalogSemanticUpdates({
      canonicalAnalysis,
      tableLinks: linkage.tableLinks,
      exportedTables,
      externalObjects: [{
        requestedName: 'INVOICEP',
        library: 'APP',
        schema: 'APP',
        sqlName: 'INVOICE_PROCESS',
        systemName: 'INVOICEP',
        objectType: '*PGM',
        evidenceSource: 'OBJECT_STATISTICS',
        matchedBy: 'SYSTEM_NAME',
      }],
    });

    assert.ok(updates.entities.tables.some((entry) => entry.db2Identity && entry.db2Identity.systemName === 'CUSTPF'));
    assert.ok(updates.entities.db2Triggers.some((entry) => entry.name === 'CUSTOMER_AUDIT'));
    assert.ok(updates.entities.externalObjects.some((entry) => entry.systemName === 'INVOICEP'));
    assert.ok(updates.entities.programs.some((entry) => entry.name === 'INVOICEP' && entry.resolutionSource === 'CATALOG'));
    assert.ok(updates.relations.some((entry) => entry.type === 'HAS_TRIGGER'));
    assert.ok(updates.relations.some((entry) => entry.type === 'DERIVES_OBJECT'));
    assert.ok(updates.relations.some((entry) => entry.type === 'REFERENCES_TABLE' && entry.attributes.deleteRule === 'CASCADE'));
    assert.ok(updates.relations.some((entry) => entry.type === 'RESOLVES_TO_EXTERNAL_OBJECT'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
