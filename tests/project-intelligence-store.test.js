'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createProjectKnowledgeStore,
  openProjectKnowledgeStore,
  probeNodeSqlite,
  KnowledgeStoreError,
  REASON_CODES,
  fixtures,
  store,
} = require('../src/projectIntelligence');

const HAS_SQLITE = probeNodeSqlite().available;

function tempRoot(label = 'zpi-store') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function skipWithoutSqlite(t) {
  if (!HAS_SQLITE) {
    t.skip('node:sqlite DatabaseSync is unavailable on this Node runtime');
    return true;
  }
  return false;
}

test('probeNodeSqlite reports availability shape', () => {
  const probe = probeNodeSqlite();
  assert.equal(typeof probe.available, 'boolean');
  if (probe.available) {
    assert.equal(typeof probe.DatabaseSync, 'function');
  }
});

test('writer lock is exclusive and detects stale locks', () => {
  const root = tempRoot('zpi-lock');
  const lockPath = path.join(root, 'locks', 'writer.lock');
  const first = store.acquireWriterLock(lockPath, { owner: 'a' });
  assert.equal(typeof first.token, 'string');

  assert.throws(
    () => store.acquireWriterLock(lockPath, { owner: 'b' }),
    err => err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.WRITER_CONFLICT
  );

  // Stale by age
  const stalePath = path.join(root, 'locks', 'stale.lock');
  fs.mkdirSync(path.dirname(stalePath), { recursive: true });
  fs.writeFileSync(
    stalePath,
    JSON.stringify({
      token: 'old',
      pid: 99999999,
      acquiredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }),
    'utf8'
  );
  const recovered = store.acquireWriterLock(stalePath, { staleMs: 1000, owner: 'recover' });
  assert.ok(recovered.token);
  recovered.release();
  first.release();
});

test('Windows-style absolute knowledge roots resolve safely', () => {
  const root = tempRoot('zpi-winpath');
  const resolved = store.resolveKnowledgeRoot(root);
  assert.equal(path.isAbsolute(resolved), true);
  // path with mixed separators should still resolve
  const mixed = root.includes('\\') ? root.replace(/\\/g, '/') : root;
  assert.equal(store.resolveKnowledgeRoot(mixed), path.resolve(mixed));
});

test(
  'create/open store, put entities, publish snapshot, reopen current',
  { skip: !HAS_SQLITE },
  () => {
    const root = tempRoot('zpi-crud');
    const handle = createProjectKnowledgeStore({
      rootPath: root,
      projectId: 'proj-demo',
      displayName: 'Demo',
      trustedRoots: [{ rootId: 'root-src', relativeLabel: 'QRPGLESRC' }],
    });

    try {
      const project = handle.getProject();
      assert.equal(project.projectId, 'proj-demo');

      const snap = fixtures.snapshot({
        projectId: 'proj-demo',
        snapshotId: 'snap-001',
        status: 'building',
        isCurrent: false,
        publishedAt: undefined,
      });
      handle.putSnapshot(snap);
      handle.putSourceUnit(fixtures.sourceUnit({ projectId: 'proj-demo', snapshotId: 'snap-001' }));
      handle.putSymbol(fixtures.symbol({ projectId: 'proj-demo', snapshotId: 'snap-001' }));
      handle.putRelationship(
        fixtures.relationship({ projectId: 'proj-demo', snapshotId: 'snap-001' })
      );
      handle.putAnalyzerRun(
        fixtures.analyzerRun({ projectId: 'proj-demo', snapshotId: 'snap-001' })
      );
      handle.putEvidenceMeta(fixtures.evidence({ projectId: 'proj-demo', snapshotId: 'snap-001' }));

      const published = handle.publishSnapshot('proj-demo', 'snap-001');
      assert.equal(published.status, 'published');
      assert.equal(published.isCurrent, true);

      const current = handle.getCurrentSnapshot();
      assert.equal(current.snapshotId, 'snap-001');

      const integrity = handle.checkIntegrity();
      assert.equal(integrity.ok, true);

      assert.equal(handle.listSourceUnits('proj-demo', 'snap-001').length, 1);
      assert.equal(handle.listSymbols('proj-demo', 'snap-001').length, 1);
      assert.equal(handle.listRelationships('proj-demo', 'snap-001').length, 1);
    } finally {
      handle.close();
    }

    // Reopen read-only and read current
    const reopened = openProjectKnowledgeStore({
      rootPath: root,
      projectId: 'proj-demo',
      readOnly: true,
    });
    try {
      const current = reopened.getCurrentSnapshot();
      assert.equal(current.snapshotId, 'snap-001');
      assert.equal(reopened.checkIntegrity().ok, true);
    } finally {
      reopened.close();
    }
  }
);

test('parallel writer is rejected with WRITER_CONFLICT', { skip: !HAS_SQLITE }, () => {
  const root = tempRoot('zpi-conflict');
  const a = createProjectKnowledgeStore({ rootPath: root, projectId: 'proj-a' });
  try {
    assert.throws(
      () => openProjectKnowledgeStore({ rootPath: root, projectId: 'proj-a', readOnly: false }),
      err => err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.WRITER_CONFLICT
    );
  } finally {
    a.close();
  }
});

test('published snapshot is immutable', { skip: !HAS_SQLITE }, () => {
  const root = tempRoot('zpi-immut');
  const handle = createProjectKnowledgeStore({ rootPath: root, projectId: 'proj-demo' });
  try {
    handle.putSnapshot(
      fixtures.snapshot({
        projectId: 'proj-demo',
        snapshotId: 'snap-001',
        status: 'building',
        isCurrent: false,
        publishedAt: undefined,
      })
    );
    handle.publishSnapshot('proj-demo', 'snap-001');
    assert.throws(
      () =>
        handle.putSnapshot(
          fixtures.snapshot({
            projectId: 'proj-demo',
            snapshotId: 'snap-001',
            status: 'building',
            isCurrent: false,
          })
        ),
      err =>
        err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.SNAPSHOT_IMMUTABLE
    );
  } finally {
    handle.close();
  }
});

test('transaction rollback leaves no partial snapshot pointer', { skip: !HAS_SQLITE }, () => {
  const root = tempRoot('zpi-tx');
  const handle = createProjectKnowledgeStore({ rootPath: root, projectId: 'proj-demo' });
  try {
    handle.putSnapshot(
      fixtures.snapshot({
        projectId: 'proj-demo',
        snapshotId: 'snap-ok',
        status: 'building',
        isCurrent: false,
        publishedAt: undefined,
      })
    );
    handle.publishSnapshot('proj-demo', 'snap-ok');

    assert.throws(() => {
      handle.withTransaction(() => {
        handle.putSnapshot(
          fixtures.snapshot({
            projectId: 'proj-demo',
            snapshotId: 'snap-bad',
            status: 'building',
            isCurrent: false,
            publishedAt: undefined,
          })
        );
        throw new Error('simulated crash');
      });
    }, /simulated crash|transaction failed/i);

    // Current pointer still the first published snapshot
    assert.equal(handle.getCurrentSnapshot().snapshotId, 'snap-ok');
    // Rolled-back insert should not be visible
    assert.throws(
      () => handle.getSnapshot('proj-demo', 'snap-bad'),
      err =>
        err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.SNAPSHOT_NOT_FOUND
    );
  } finally {
    handle.close();
  }
});

test('building snapshot is not served as current', { skip: !HAS_SQLITE }, () => {
  const root = tempRoot('zpi-building');
  const handle = createProjectKnowledgeStore({ rootPath: root, projectId: 'proj-demo' });
  try {
    handle.putSnapshot(
      fixtures.snapshot({
        projectId: 'proj-demo',
        snapshotId: 'snap-building',
        status: 'building',
        isCurrent: false,
        publishedAt: undefined,
      })
    );
    assert.throws(
      () => handle.getCurrentSnapshot(),
      err =>
        err instanceof KnowledgeStoreError &&
        (err.reasonCode === REASON_CODES.SNAPSHOT_NOT_CURRENT ||
          err.reasonCode === REASON_CODES.CURRENT_POINTER_MISMATCH)
    );
  } finally {
    handle.close();
  }
});

test('corrupt sqlite file fails closed on open', { skip: !HAS_SQLITE }, () => {
  const root = tempRoot('zpi-corrupt');
  // Create valid store first
  const handle = createProjectKnowledgeStore({ rootPath: root, projectId: 'proj-demo' });
  handle.close();

  // Overwrite sqlite with garbage
  const sqlitePath = path.join(root, 'knowledge.sqlite');
  fs.writeFileSync(sqlitePath, 'this is not a database', 'utf8');

  assert.throws(
    () => openProjectKnowledgeStore({ rootPath: root, projectId: 'proj-demo', readOnly: true }),
    err =>
      err instanceof KnowledgeStoreError &&
      (err.reasonCode === REASON_CODES.STORE_CORRUPT ||
        err.reasonCode === REASON_CODES.STORE_UNAVAILABLE)
  );
});

test('invalid contract payload is rejected by store', { skip: !HAS_SQLITE }, () => {
  const root = tempRoot('zpi-schema');
  const handle = createProjectKnowledgeStore({ rootPath: root, projectId: 'proj-demo' });
  try {
    assert.throws(
      () =>
        handle.putSnapshot({
          schemaVersion: 1,
          projectId: 'proj-demo',
          snapshotId: 'x',
          // missing required fields
        }),
      err => err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.SCHEMA_INVALID
    );
  } finally {
    handle.close();
  }
});

test('second publish supersedes previous current', { skip: !HAS_SQLITE }, () => {
  const root = tempRoot('zpi-supersede');
  const handle = createProjectKnowledgeStore({ rootPath: root, projectId: 'proj-demo' });
  try {
    handle.putSnapshot(
      fixtures.snapshot({
        projectId: 'proj-demo',
        snapshotId: 'snap-1',
        status: 'building',
        isCurrent: false,
        publishedAt: undefined,
      })
    );
    handle.publishSnapshot('proj-demo', 'snap-1');

    handle.putSnapshot(
      fixtures.snapshot({
        projectId: 'proj-demo',
        snapshotId: 'snap-2',
        status: 'building',
        isCurrent: false,
        publishedAt: undefined,
      })
    );
    handle.publishSnapshot('proj-demo', 'snap-2');

    assert.equal(handle.getCurrentSnapshot().snapshotId, 'snap-2');
    const first = handle.getSnapshot('proj-demo', 'snap-1');
    assert.equal(first.isCurrent, false);
    assert.equal(first.status, 'superseded');
  } finally {
    handle.close();
  }
});

// Silence unused when skipped
void skipWithoutSqlite;
