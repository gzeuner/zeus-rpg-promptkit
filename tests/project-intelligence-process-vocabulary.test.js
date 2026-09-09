'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const zpi = require('../src/projectIntelligence');

function glossaryEntry(overrides = {}) {
  return zpi.fixtures.glossaryEntry({
    entryId: 'glossary:order-intake',
    term: 'Order intake',
    definition: 'The technical flow that accepts an order.',
    status: 'published',
    confidence: 'high',
    aliases: ['ORDER-API'],
    technicalRefs: ['interface:order-api'],
    relatedProcessIds: ['process:order-flow'],
    ...overrides,
  });
}

function glossaryCatalog(entries, overrides = {}) {
  return zpi.buildGlossaryCatalog(entries, {
    projectId: 'proj-demo',
    snapshotId: 'snap-glossary-001',
    freshness: { status: 'published', checkedAt: '2026-09-08T12:00:00.000Z' },
    ...overrides,
  });
}

function processCatalog() {
  const process = zpi.fixtures.businessProcess({
    processId: 'process:order-flow',
    processVersionId: 'process:order-flow:v1',
    name: 'Order processing flow',
    entryPoints: [{ id: 'PROGRAM:ORDERPGM', kind: 'program', name: 'ORDERPGM' }],
  });
  const version = zpi.fixtures.processVersion({
    processId: process.processId,
    processVersionId: process.processVersionId,
    title: process.name,
    interfaces: [{ id: 'interface:order-api', kind: 'interface', name: 'ORDER-API' }],
  });
  return {
    schemaVersion: 1,
    kind: 'process-candidate-catalog',
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    freshness: { status: 'published', checkedAt: '2026-09-08T12:00:00.000Z' },
    candidates: [
      {
        process,
        version,
        steps: [],
        claims: [],
        relationships: [],
      },
    ],
  };
}

test('glossary contract accepts scoped metadata and rejects invalid scope combinations', () => {
  const valid = zpi.validateProjectIntelligenceContract(
    zpi.CONTRACT_IDS.GLOSSARY_ENTRY,
    glossaryEntry({ scopeType: 'project', scopeId: 'proj-demo' })
  );
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));

  const globalWithId = zpi.glossaryEntrySchema(
    glossaryEntry({ scopeType: 'global', scopeId: 'should-not-exist' })
  );
  assert.ok(globalWithId.some(error => error.path === '/scopeId'));

  const missingScopeId = zpi.glossaryEntrySchema(
    glossaryEntry({ scopeType: 'organization', scopeId: undefined })
  );
  assert.ok(missingScopeId.some(error => error.path === '/scopeId'));
});

test('glossary catalogs are validated and sorted by stable entry id', () => {
  const catalog = glossaryCatalog([
    glossaryEntry({ entryId: 'glossary:z-term', term: 'Z term' }),
    glossaryEntry({ entryId: 'glossary:a-term', term: 'A term' }),
  ]);
  assert.deepEqual(
    catalog.entries.map(entry => entry.entryId),
    ['glossary:a-term', 'glossary:z-term']
  );
  assert.equal(zpi.validateGlossaryCatalog(catalog).ok, true);
  assert.equal(catalog.summary.entryCount, 2);
});

test('glossary resolution prefers the most specific applicable scope', () => {
  const catalog = glossaryCatalog([
    glossaryEntry({
      entryId: 'glossary:global-order',
      scopeType: 'global',
      term: 'Order',
      aliases: ['ORDER-API'],
    }),
    glossaryEntry({
      entryId: 'glossary:organization-order',
      scopeType: 'organization',
      scopeId: 'org-demo',
      term: 'Order',
      aliases: ['ORDER-API'],
    }),
    glossaryEntry({
      entryId: 'glossary:project-order',
      scopeType: 'project',
      scopeId: 'proj-demo',
      term: 'Order',
      aliases: ['ORDER-API'],
    }),
    glossaryEntry({
      entryId: 'glossary:task-order',
      scopeType: 'task',
      scopeId: 'task-42',
      term: 'Order',
      aliases: ['ORDER-API'],
    }),
  ]);

  const project = zpi.resolveGlossaryTerm(catalog, 'ORDER-API', {
    organizationId: 'org-demo',
  });
  assert.equal(project.status, 'resolved');
  assert.equal(project.selected.id, 'glossary:project-order');

  const task = zpi.resolveGlossaryTerm(catalog, 'ORDER-API', {
    organizationId: 'org-demo',
    taskId: 'task-42',
  });
  assert.equal(task.selected.id, 'glossary:task-order');
  assert.equal(task.selected.scope.scopeType, 'task');
});

test('glossary resolution makes same-scope collisions and unknown terms explicit', () => {
  const catalog = glossaryCatalog([
    glossaryEntry({
      entryId: 'glossary:duplicate-a',
      term: 'Duplicate',
      aliases: ['SHARED-ALIAS'],
      relatedProcessIds: [],
    }),
    glossaryEntry({
      entryId: 'glossary:duplicate-b',
      term: 'Duplicate',
      aliases: ['SHARED-ALIAS'],
      relatedProcessIds: [],
    }),
  ]);
  const ambiguous = zpi.resolveGlossaryTerm(catalog, 'SHARED-ALIAS');
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.selected, null);
  assert.ok(ambiguous.nextQuestions.some(value => /scope|identifier/i.test(value)));

  const unknown = zpi.resolveGlossaryTerm(catalog, 'UNMAPPED-TERM');
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.selected, null);
  assert.ok(unknown.unknowns[0].includes('UNMAPPED-TERM'));
  assert.equal(unknown.freshness.status, 'published');
});

test('process query uses only resolved glossary mappings and exposes their evidence', () => {
  const glossary = glossaryCatalog([
    glossaryEntry({
      evidenceReferences: [{ id: 'ev:glossary-order', kind: 'business-review' }],
    }),
  ]);
  const result = zpi.queryProcesses(processCatalog(), 'Was macht ORDER-API?', {
    glossaryCatalog: glossary,
  });
  assert.equal(result.matches[0].id, 'process:order-flow');
  assert.equal(result.glossaryResolutions[0].status, 'resolved');
  assert.ok(result.evidenceReferences.some(reference => reference.id === 'ev:glossary-order'));
  assert.match(result.answer, /Vocabulary resolution used/i);

  const ambiguousGlossary = glossaryCatalog([
    glossaryEntry({ entryId: 'glossary:ambiguous-a', relatedProcessIds: [] }),
    glossaryEntry({ entryId: 'glossary:ambiguous-b', relatedProcessIds: [] }),
  ]);
  const ambiguous = zpi.queryProcesses(processCatalog(), 'Was macht ORDER-API?', {
    glossaryCatalog: ambiguousGlossary,
  });
  assert.equal(ambiguous.glossaryResolutions[0].status, 'ambiguous');
  assert.equal(ambiguous.glossaryResolutions[0].selected, null);
  assert.ok(ambiguous.unknowns.some(value => /ambiguous/i.test(value)));
});

test('glossary CLI routes are workspace-relative and machine-readable', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-glossary-'));
  const glossaryPath = path.join(tempRoot, 'glossary.json');
  const catalogPath = path.join(tempRoot, 'catalog.json');
  fs.writeFileSync(glossaryPath, JSON.stringify(glossaryCatalog([glossaryEntry()])), 'utf8');
  fs.writeFileSync(catalogPath, JSON.stringify(processCatalog()), 'utf8');

  assert.throws(
    () => zpi.resolveGlossaryCatalogPath('../glossary.json', tempRoot),
    error => error.code === 'GLOSSARY_CATALOG_PATH_UNSAFE'
  );

  const cliPath = path.resolve(__dirname, '..', 'cli', 'zeus.js');
  const resolveRun = spawnSync(
    process.execPath,
    [
      cliPath,
      'process',
      'glossary',
      'resolve',
      '--glossary',
      'glossary.json',
      '--term',
      'ORDER-API',
      '--json',
    ],
    { cwd: tempRoot, encoding: 'utf8' }
  );
  assert.equal(resolveRun.status, 0, resolveRun.stderr);
  const resolvedOutput = JSON.parse(resolveRun.stdout);
  assert.equal(resolvedOutput.operation, 'glossary resolve');
  assert.equal(resolvedOutput.result.status, 'resolved');

  const queryRun = spawnSync(
    process.execPath,
    [
      cliPath,
      'process',
      'query',
      '--catalog',
      'catalog.json',
      '--glossary',
      'glossary.json',
      '--question',
      'Was macht ORDER-API?',
      '--json',
    ],
    { cwd: tempRoot, encoding: 'utf8' }
  );
  assert.equal(queryRun.status, 0, queryRun.stderr);
  const queryOutput = JSON.parse(queryRun.stdout);
  assert.equal(queryOutput.result.matches[0].id, 'process:order-flow');
  assert.equal(queryOutput.result.glossaryResolutions[0].status, 'resolved');
});
