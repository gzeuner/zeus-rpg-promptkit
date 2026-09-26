'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createProjectRetriever,
  createSnapshotEngine,
  REASON_CODES,
  probeNodeSqlite,
} = require('../src/projectIntelligence');
const { createSearchProvider } = require('../src/projectIntelligence/search/searchProvider');

const HAS_SQLITE = probeNodeSqlite().available;

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'publication-guard-'));
}

function writeSource(root, name, body) {
  const sourceDir = path.join(root, 'sources');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, name), body, 'utf8');
  return sourceDir;
}

test(
  'search rebuild failure leaves reads fail-closed instead of serving a mixed generation',
  { skip: !HAS_SQLITE },
  () => {
    const root = tempRoot();
    const knowledgeRoot = path.join(root, 'knowledge');
    const sourceDir = writeSource(root, 'unit-a.rpgle', '**free\n// unit-a\n');
    let failRebuild = false;

    const searchProviderFactory = options => {
      const provider = createSearchProvider(options);
      if (failRebuild) {
        provider.rebuild = () => {
          throw new Error('simulated search rebuild failure');
        };
      }
      return provider;
    };

    const engine = createSnapshotEngine({
      knowledgeRoot,
      projectId: 'knowledge-001',
      trustedRoots: [{ rootId: 'root-001', path: sourceDir }],
      searchProviderFactory,
    });

    try {
      const first = engine.fullRebuild();
      const firstSnapshotId = first.snapshot.snapshotId;
      fs.writeFileSync(path.join(sourceDir, 'unit-b.rpgle'), '**free\n// unit-b\n', 'utf8');
      failRebuild = true;

      assert.throws(
        () => engine.incrementalUpdate(),
        /simulated search rebuild failure|publish failed/i
      );

      const current = engine.getCurrentSnapshot();
      assert.notEqual(current.snapshotId, firstSnapshotId);

      const retriever = createProjectRetriever({
        knowledgeRoot,
        projectId: 'knowledge-001',
        trustedRoots: [{ rootId: 'root-001', path: sourceDir }],
        readOnly: true,
      });
      try {
        assert.throws(
          () => retriever.retrieve({ query: 'unit-a' }),
          error => error && error.reasonCode === REASON_CODES.MIXED_GENERATION
        );
      } finally {
        retriever.close();
      }
    } finally {
      engine.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);
