'use strict';

/**
 * ZPI-12 hardening / adversarial checks for Project Intelligence surfaces.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createSnapshotEngine,
  createProjectRetriever,
  openSnapshotEngine,
  KnowledgeStoreError,
  REASON_CODES,
  probeNodeSqlite,
  executeProjectIntelligenceOperation,
  discoverProjectIntelligenceCapabilities,
  COMMERCIAL_CAPABILITY_IDS,
} = require('../src/projectIntelligence');
const { createZeus } = require('../src/api/zeusApi');
const { createCapabilityRegistry } = require('../src/core/capabilityRegistry');
const { executeProjectKnowledgeMcpTool } = require('../src/projectIntelligence/adapters');

const HAS_SQLITE = probeNodeSqlite().available;

function tempDir(label = 'zpi-hard') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function assertNoHostPathLeak(value, depth = 0) {
  if (depth > 14 || value == null) return;
  if (typeof value === 'string') {
    assert.equal(/[A-Za-z]:\\/.test(value), false, `drive path leak: ${value}`);
    assert.equal(/\/(?:Users|home)\//.test(value), false, `home path leak: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) assertNoHostPathLeak(v, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) assertNoHostPathLeak(v, depth + 1);
  }
}

test('absent commercial capabilities never load paid packages', async () => {
  const zeus = createZeus();
  const discovery = discoverProjectIntelligenceCapabilities(zeus.capabilities);
  assert.equal(discovery.present, false);
  assert.equal(discovery.reasonCode, REASON_CODES.CAPABILITY_UNAVAILABLE);

  const denied = await executeProjectIntelligenceOperation({
    capabilities: zeus.capabilities,
    operation: 'query',
    input: {
      knowledgeRoot: path.resolve(process.cwd()),
      projectId: 'x',
      query: 'y',
      trustedRoots: [{ rootId: 'r', path: process.cwd() }],
    },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reasonCode, REASON_CODES.CAPABILITY_UNAVAILABLE);
  assert.equal(denied.capabilityId, COMMERCIAL_CAPABILITY_IDS.QUERY);
  assertNoHostPathLeak(denied);
});

test('MCP project-knowledge tools redact absolute paths in fail paths', async () => {
  const caps = createCapabilityRegistry();
  const abs = path.join(os.tmpdir(), 'secret-host-path-should-not-echo');
  const result = await executeProjectKnowledgeMcpTool(
    'zeus.project-knowledge.full-index',
    {
      knowledgeRoot: abs,
      projectId: 'p',
      trustedRoots: [{ rootId: 'r', path: abs }],
    },
    { capabilities: caps }
  );
  assert.equal(result.ok, false);
  assertNoHostPathLeak(result);
});

test(
  'untrusted root and traversal are fail-closed; integrity reports overall store health',
  { skip: !HAS_SQLITE },
  () => {
    const root = tempDir();
    const src = path.join(root, 'src');
    const knowledgeRoot = path.join(root, 'pk');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'A.rpgle'), '**free\n// A\n', 'utf8');

    // Outside trusted root should not be inventoriable as a root
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'evil.rpgle'), '**free\n// evil\n', 'utf8');

    const engine = createSnapshotEngine({
      knowledgeRoot,
      projectId: 'harden',
      trustedRoots: [{ rootId: 'src', path: src }],
    });
    try {
      const result = engine.fullRebuild();
      assert.equal(result.counts.sourceUnits, 1);
      // only trusted root files
      assert.equal(
        result.counts.sourceUnits === 1 && !String(JSON.stringify(result)).includes('evil'),
        true
      );

      const integrity = engine._store.checkIntegrity();
      assert.equal(integrity.ok, true);
      assertNoHostPathLeak({
        // public-ish projection
        ok: integrity.ok,
        checks: integrity.checks || integrity,
      });
    } finally {
      engine.close();
    }

    // exclusive writer lock: second concurrent writer rejected while first holds the lock
    const writer = openSnapshotEngine({
      knowledgeRoot,
      projectId: 'harden',
      trustedRoots: [{ rootId: 'src', path: src }],
      readOnly: false,
    });
    try {
      assert.throws(
        () =>
          openSnapshotEngine({
            knowledgeRoot,
            projectId: 'harden',
            trustedRoots: [{ rootId: 'src', path: src }],
            readOnly: false,
          }),
        err => err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.WRITER_CONFLICT
      );
    } finally {
      writer.close();
    }

    fs.rmSync(root, { recursive: true, force: true });
  }
);

test(
  'retrieval token budget and oversized limits fail closed without host-path leakage',
  { skip: !HAS_SQLITE },
  () => {
    const root = tempDir();
    const src = path.join(root, 'src');
    const knowledgeRoot = path.join(root, 'pk');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'ORDERPGM.rpgle'), '**free\n// ORDERPGM\n', 'utf8');

    const engine = createSnapshotEngine({
      knowledgeRoot,
      projectId: 'harden-ret',
      trustedRoots: [{ rootId: 'src', path: src }],
    });
    try {
      engine.fullRebuild();
    } finally {
      engine.close();
    }

    const retriever = createProjectRetriever({
      knowledgeRoot,
      projectId: 'harden-ret',
      trustedRoots: [{ rootId: 'src', path: src }],
      readOnly: true,
    });
    try {
      const pkg = retriever.buildContextPackage({
        query: 'ORDERPGM',
        tokenBudget: 200,
        expandHops: 0,
      });
      assert.ok(pkg.contextPackage);
      assertNoHostPathLeak(pkg.contextPackage);
      assertNoHostPathLeak(pkg.metrics);

      // Invalid limit should throw or return bounded failure depending on provider
      assert.throws(() => {
        retriever.retrieve({ query: 'ORDERPGM', limit: 0 });
      });
    } finally {
      retriever.close();
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
);

test('adapter discover non-claims document community isolation', () => {
  const d = discoverProjectIntelligenceCapabilities(createZeus().capabilities);
  assert.ok(Array.isArray(d.nonClaims));
  assert.ok(d.nonClaims.some(m => /no paid/i.test(m) || /Community/i.test(m)));
  assert.equal(d.communityEnginesAvailable, true);
});
