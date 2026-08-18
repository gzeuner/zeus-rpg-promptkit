'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  createKnowledgeFirstService,
  probeNodeSqlite,
  validateProjectIntelligenceContract,
} = require('../src/projectIntelligence');
const {
  executeProjectKnowledgeMcpTool,
  listProjectKnowledgeMcpTools,
} = require('../src/projectIntelligence/adapters');
const { runProjectKnowledge } = require('../src/cli/commands/projectKnowledgeCommand');

const HAS_SQLITE = probeNodeSqlite().available;

function tempDir(label = 'knowledge-first') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
}

function setup() {
  const root = tempDir();
  const sourceRoot = path.join(root, 'legacy');
  const knowledgeRoot = path.join(root, 'knowledge');
  writeFiles(sourceRoot, {
    'QRPGLESRC/A.rpgle': '**free\n// A\n',
    'QRPGLESRC/B.rpgle': '**free\n// B\n',
  });
  const trustedRoots = [{ rootId: 'legacy-src', path: sourceRoot }];
  return { root, sourceRoot, knowledgeRoot, trustedRoots };
}

test('Knowledge First reports fresh after explicit initial sync', { skip: !HAS_SQLITE }, () => {
  const ctx = setup();
  const service = createKnowledgeFirstService({
    knowledgeRoot: ctx.knowledgeRoot,
    projectId: 'legacy-demo',
    trustedRoots: ctx.trustedRoots,
  });

  const sync = service.sync();
  assert.equal(sync.ok, true);
  assert.equal(sync.freshness.status, 'fresh');
  assert.equal(sync.authority.evidenceCheckpoint, 'published-source-backed-snapshot');
  assert.equal(sync.authority.sourceOfTruth, false);
  assert.equal(sync.freshnessScope.local, 'trusted-roots-content-and-provenance-hash');
  assert.equal(sync.freshnessScope.remote, 'not-checked');
  assert.equal(sync.remoteFreshness.status, 'unknown');
  assert.equal(sync.remoteFreshness.reason, 'remote-not-checked');

  const check = service.check();
  assert.equal(check.ok, true);
  assert.equal(check.freshness.status, 'fresh');
  assert.equal(check.freshness.diff.counts.added, 0);
});

test(
  'freshness is stale with deterministic safe added/changed/deleted identities',
  { skip: !HAS_SQLITE },
  () => {
    const ctx = setup();
    const service = createKnowledgeFirstService({
      knowledgeRoot: ctx.knowledgeRoot,
      projectId: 'legacy-demo',
      trustedRoots: ctx.trustedRoots,
    });
    service.sync();

    fs.writeFileSync(
      path.join(ctx.sourceRoot, 'QRPGLESRC/A.rpgle'),
      '**free\n// A changed\n',
      'utf8'
    );
    fs.unlinkSync(path.join(ctx.sourceRoot, 'QRPGLESRC/B.rpgle'));
    writeFiles(ctx.sourceRoot, { 'QRPGLESRC/C.rpgle': '**free\n// C\n' });

    const first = service.check();
    const second = service.check();
    assert.equal(first.freshness.status, 'stale');
    assert.deepEqual(first.freshness.diff.counts, {
      added: 1,
      changed: 1,
      deleted: 1,
      unchanged: 0,
      previous: 2,
      next: 2,
    });
    assert.deepEqual(first.freshness.diff, second.freshness.diff);
    assert.equal(first.freshness.diff.added[0].relativePath, 'QRPGLESRC/C.rpgle');
    assert.equal(first.freshness.diff.changed[0].current.relativePath, 'QRPGLESRC/A.rpgle');
    assert.equal(first.freshness.diff.deleted[0].relativePath, 'QRPGLESRC/B.rpgle');
    const publicJson = JSON.stringify(first);
    assert.equal(publicJson.includes(ctx.root), false);
    assert.equal(publicJson.includes('absolutePath'), false);
  }
);

test(
  'lookup fails closed for stale state and sync explicitly restores freshness',
  { skip: !HAS_SQLITE },
  () => {
    const ctx = setup();
    const service = createKnowledgeFirstService({
      knowledgeRoot: ctx.knowledgeRoot,
      projectId: 'legacy-demo',
      trustedRoots: ctx.trustedRoots,
    });
    service.sync();
    fs.appendFileSync(path.join(ctx.sourceRoot, 'QRPGLESRC/A.rpgle'), '// changed\n', 'utf8');

    const blocked = service.lookup({ query: 'A' });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.servable, false);
    assert.equal(blocked.freshness.status, 'stale');
    assert.equal(blocked.results, undefined);

    const synced = service.sync({ mode: 'incremental' });
    assert.equal(synced.ok, true);
    assert.equal(synced.freshness.status, 'fresh');
    const lookup = service.lookup({ query: 'A', limit: 5 });
    assert.equal(lookup.ok, true);
    assert.equal(lookup.servable, true);
    assert.ok(Array.isArray(lookup.results));
    assert.ok(
      lookup.results.some(
        item => item.location && item.location.relativePath === 'QRPGLESRC/A.rpgle'
      )
    );
    assert.equal(JSON.stringify(lookup).includes(ctx.root), false);
  }
);

test(
  'unknown freshness is explicit when no trusted roots are available',
  { skip: !HAS_SQLITE },
  () => {
    const ctx = setup();
    const withRoots = createKnowledgeFirstService({
      knowledgeRoot: ctx.knowledgeRoot,
      projectId: 'legacy-demo',
      trustedRoots: ctx.trustedRoots,
    });
    withRoots.sync();

    const withoutRoots = createKnowledgeFirstService({
      knowledgeRoot: ctx.knowledgeRoot,
      projectId: 'legacy-demo',
    });
    const check = withoutRoots.check();
    assert.equal(check.ok, true);
    assert.equal(check.freshness.status, 'unknown');
    assert.equal(check.servable, false);
    const lookup = withoutRoots.lookup({ query: 'A' });
    assert.equal(lookup.ok, false);
    assert.equal(lookup.freshness.status, 'unknown');
    assert.equal(lookup.servable, false);
  }
);

test('evidence hits retain their safe source location', { skip: !HAS_SQLITE }, () => {
  const ctx = setup();
  const service = createKnowledgeFirstService({
    knowledgeRoot: ctx.knowledgeRoot,
    projectId: 'legacy-demo',
    trustedRoots: ctx.trustedRoots,
  });
  service.sync();

  const lookup = service.lookup({ query: 'QRPGLESRC' });
  assert.equal(lookup.ok, true);
  const evidenceHit = lookup.results.find(item => item.match.kind === 'evidence');
  assert.ok(evidenceHit);
  assert.ok(evidenceHit.location);
  assert.match(evidenceHit.location.relativePath, /^QRPGLESRC\/[AB]\.rpgle$/);
  assert.equal(JSON.stringify(evidenceHit).includes(ctx.root), false);
});

test(
  'Knowledge First is exposed through neutral MCP and CLI contracts',
  { skip: !HAS_SQLITE },
  async () => {
    const ctx = setup();
    const args = {
      knowledgeRoot: ctx.knowledgeRoot,
      projectId: 'legacy-demo',
      trustedRoots: ctx.trustedRoots,
    };
    const mcpNames = new Set(listProjectKnowledgeMcpTools().map(tool => tool.name));
    assert.ok(mcpNames.has('zeus.project-knowledge.check'));
    assert.ok(mcpNames.has('zeus.project-knowledge.sync'));
    assert.ok(mcpNames.has('zeus.project-knowledge.lookup'));

    const sync = await executeProjectKnowledgeMcpTool(
      'zeus.project-knowledge.sync',
      {
        ...args,
        mode: 'full',
      },
      { cwd: ctx.root }
    );
    assert.equal(sync.ok, true);
    const lookup = await executeProjectKnowledgeMcpTool(
      'zeus.project-knowledge.lookup',
      {
        ...args,
        query: 'A',
      },
      { cwd: ctx.root }
    );
    assert.equal(lookup.ok, true);
    assert.equal(lookup.freshness.status, 'fresh');

    const previousExitCode = process.exitCode;
    process.exitCode = 0;
    try {
      const check = await runProjectKnowledge({
        _: ['check'],
        'knowledge-root': ctx.knowledgeRoot,
        'project-id': 'legacy-demo',
        'trusted-roots': JSON.stringify(ctx.trustedRoots),
        json: true,
      });
      assert.equal(check.ok, true);
      assert.equal(check.freshness.status, 'fresh');
    } finally {
      process.exitCode = previousExitCode;
    }
  }
);

test('Knowledge First MCP rejects paths outside its workspace without leaking them', async () => {
  const ctx = setup();
  const result = await executeProjectKnowledgeMcpTool(
    'zeus.project-knowledge.check',
    {
      knowledgeRoot: ctx.knowledgeRoot,
      projectId: 'legacy-demo',
      trustedRoots: ctx.trustedRoots,
    },
    { cwd: tempDir('knowledge-first-other-workspace') }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, 'ZPI.PATH_ESCAPE');
  assert.equal(JSON.stringify(result).includes(ctx.root), false);
});

test(
  'manifest provenance is sanitized and raw validation hash is compared separately',
  {
    skip: !HAS_SQLITE,
  },
  () => {
    const ctx = setup();
    const raw = fs.readFileSync(path.join(ctx.sourceRoot, 'QRPGLESRC/A.rpgle'));
    const rawHash = crypto.createHash('sha256').update(raw).digest('hex');
    writeFiles(ctx.sourceRoot, {
      'zeus-import-manifest.json': JSON.stringify({
        schemaVersion: 2,
        fetchedAt: '2026-08-18T10:00:00.000Z',
        remote: { host: 'secret.example', ifsDir: '/secret/path' },
        password: 'manifest-password-must-never-leak',
        files: [
          {
            localPath: 'QRPGLESRC/A.rpgle',
            sourceLib: 'APPLIB',
            sourceFile: 'QRPGLESRC',
            member: 'A',
            memberPath: '/QSYS.LIB/EVIL.LIB/WRONG.FILE/OTHER.MBR',
            command: 'secret command',
            validation: { sha256: rawHash },
          },
        ],
      }),
    });
    const service = createKnowledgeFirstService({
      knowledgeRoot: ctx.knowledgeRoot,
      projectId: 'legacy-demo',
      trustedRoots: [{ ...ctx.trustedRoots[0], systemAlias: 'DEV-I' }],
    });
    const sync = service.sync();
    assert.equal(sync.ok, true);
    const lookup = service.lookup({ query: 'A' });
    const result = lookup.results.find(
      item => item.location && item.location.relativePath.endsWith('/A.rpgle')
    );
    assert.ok(result);
    assert.equal(result.location.origin.systemAlias, 'DEV-I');
    assert.equal(result.location.origin.sourceLib, 'APPLIB');
    assert.equal(result.location.origin.memberPath, '/QSYS.LIB/APPLIB.LIB/QRPGLESRC.FILE/A.MBR');
    assert.equal(result.location.importedCopyIntegrity.status, 'fresh');
    const serialized = JSON.stringify(lookup);
    for (const forbidden of [
      'secret.example',
      '/secret/path',
      'secret command',
      'manifest-password-must-never-leak',
      'EVIL',
      'remotePath',
      'command',
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  }
);

test(
  'incremental sync persists a provenance-only observation change without losing facts',
  { skip: !HAS_SQLITE },
  () => {
    const ctx = setup();
    const sourcePath = path.join(ctx.sourceRoot, 'QRPGLESRC/A.rpgle');
    const rawHash = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
    const writeManifest = fetchedAt =>
      writeFiles(ctx.sourceRoot, {
        'zeus-import-manifest.json': JSON.stringify({
          schemaVersion: 2,
          fetchedAt,
          files: [
            {
              localPath: 'QRPGLESRC/A.rpgle',
              sourceLib: 'APPLIB',
              sourceFile: 'QRPGLESRC',
              member: 'A',
              validation: { sha256: rawHash },
            },
          ],
        }),
      });

    writeManifest('2026-08-18T10:00:00.000Z');
    const service = createKnowledgeFirstService({
      knowledgeRoot: ctx.knowledgeRoot,
      projectId: 'legacy-demo',
      trustedRoots: ctx.trustedRoots,
    });
    assert.equal(service.sync().ok, true);

    writeManifest('2026-08-18T11:00:00.000Z');
    const stale = service.check();
    assert.equal(stale.freshness.status, 'stale');
    const changed = stale.freshness.diff.changed.find(
      entry => entry.current.relativePath === 'QRPGLESRC/A.rpgle'
    );
    assert.ok(changed);
    assert.equal(changed.contentChanged, false);
    assert.equal(changed.importObservationChanged, true);

    const updated = service.sync({ mode: 'incremental' });
    assert.equal(updated.ok, true);
    assert.equal(updated.published, true);
    const lookup = service.lookup({ query: 'A' });
    const result = lookup.results.find(
      item => item.location && item.location.relativePath === 'QRPGLESRC/A.rpgle'
    );
    assert.ok(result);
    assert.equal(result.location.origin.fetchedAt, '2026-08-18T11:00:00.000Z');
    assert.ok(result.evidence.length > 0);

    const noop = service.sync({ mode: 'incremental' });
    assert.equal(noop.ok, true);
    assert.equal(noop.published, false);
    assert.equal(service.check().freshness.status, 'fresh');
  }
);

test(
  'missing or malformed manifests remain unknown and do not crash lookup checks',
  {
    skip: !HAS_SQLITE,
  },
  () => {
    const ctx = setup();
    const service = createKnowledgeFirstService({
      knowledgeRoot: ctx.knowledgeRoot,
      projectId: 'legacy-demo',
      trustedRoots: ctx.trustedRoots,
    });
    const initial = service.sync();
    assert.equal(initial.ok, true);
    assert.equal(initial.freshness.importedCopyIntegrity.status, 'unknown');
    fs.writeFileSync(path.join(ctx.sourceRoot, 'zeus-import-manifest.json'), '{broken', 'utf8');
    const malformed = service.check();
    assert.equal(malformed.ok, true);
    assert.equal(malformed.freshness.status, 'stale');
    assert.equal(malformed.freshness.importedCopyIntegrity.status, 'unknown');
    assert.equal(malformed.remoteFreshness.status, 'unknown');
  }
);

test('provenance-only inventory changes are diff-visible but do not count as content changes', () => {
  const { planInventoryDiff } = require('../src/projectIntelligence');
  const previous = [
    {
      trustedRootId: 'r',
      relativePath: 'A.rpgle',
      contentHash: 'a'.repeat(64),
      sizeBytes: 1,
      provenanceHash: 'b'.repeat(64),
      importObservationHash: 'c'.repeat(64),
    },
  ];
  const next = [{ ...previous[0], provenanceHash: 'd'.repeat(64) }];
  const diff = planInventoryDiff(previous, next);
  assert.equal(diff.isNoOp, false);
  assert.equal(diff.changed[0].contentChanged, false);
  assert.equal(diff.changed[0].provenanceChanged, true);
});

test('source-unit contract rejects sensitive or non-canonical origin fields', () => {
  const base = {
    schemaVersion: 1,
    kind: 'project-knowledge-source-unit',
    contractId: 'zeus.project-knowledge-source-unit',
    projectId: 'legacy-demo',
    snapshotId: 'snap-demo',
    sourceUnitId: 'su:src:A.rpgle',
    relativePath: 'A.rpgle',
    contentHash: 'a'.repeat(64),
    trustedRootId: 'src',
    hashAlgorithm: 'sha256',
  };
  const sensitive = validateProjectIntelligenceContract(base.contractId, {
    ...base,
    origin: { systemAlias: 'DEV', password: 'must-not-be-stored' },
  });
  assert.equal(sensitive.ok, false);
  const nonCanonical = validateProjectIntelligenceContract(base.contractId, {
    ...base,
    origin: {
      systemAlias: 'DEV',
      memberPath: '/QSYS.LIB/DEV.LIB/QRPGLESRC.FILE/../SECRET.MBR',
    },
  });
  assert.equal(nonCanonical.ok, false);
});

test(
  'canonical-only manifest hashes remain unknown and traversal entries are ignored',
  {
    skip: !HAS_SQLITE,
  },
  () => {
    const ctx = setup();
    const raw = Buffer.from('**free\r\n// canonicalized\r\n', 'utf8');
    fs.writeFileSync(path.join(ctx.sourceRoot, 'QRPGLESRC/C.rpgle'), raw);
    const canonicalHash = crypto
      .createHash('sha256')
      .update(Buffer.from('**free\n// canonicalized\n', 'utf8'))
      .digest('hex');
    writeFiles(ctx.sourceRoot, {
      'zeus-import-manifest.json': JSON.stringify({
        schemaVersion: 1,
        files: [
          { localPath: 'QRPGLESRC/C.rpgle', validation: { sha256: canonicalHash } },
          { localPath: '../outside.rpgle', validation: { sha256: 'a'.repeat(64) } },
        ],
      }),
    });
    const service = createKnowledgeFirstService({
      knowledgeRoot: ctx.knowledgeRoot,
      projectId: 'legacy-demo',
      trustedRoots: ctx.trustedRoots,
    });
    const sync = service.sync();
    assert.equal(sync.ok, true);
    const lookup = service.lookup({ query: 'canonicalized' });
    const result = lookup.results.find(
      item => item.location && item.location.relativePath.endsWith('/C.rpgle')
    );
    assert.ok(result);
    assert.equal(result.location.importedCopyIntegrity.status, 'unknown');
    assert.equal(result.location.importedCopyIntegrity.reason, 'raw-vs-canonical-hash-ambiguous');
    assert.equal(JSON.stringify(lookup).includes('outside.rpgle'), false);
  }
);
