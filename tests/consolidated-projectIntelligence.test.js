'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createZeus } = require('zeus-rpg-promptkit/api');
const { probeNodeSqlite } = require('zeus-rpg-promptkit/project-intelligence-contracts');
const {
  generateEphemeralKeyPair,
  buildUnsignedLicense,
  signLicenseDocument,
  REASON_CODES,
  registerProjectIntelligenceModule,
  PROJECT_INTELLIGENCE_MODULE_ID,
  PROJECT_INTELLIGENCE_CAPABILITY_IDS,
  PROJECT_INTELLIGENCE_NON_CLAIMS,
  projectIntelligence,
} = require('../src');

/** Community pin carrying ZPI-02..08 engines + ZPI-11 thin adapters */
const PUBLIC_CORE_PIN = '84822a68309f123c43e848c7ed2158853364fd46';
const CAPS = PROJECT_INTELLIGENCE_CAPABILITY_IDS;
const HAS_SQLITE = probeNodeSqlite().available;

function entitledLicense(privateKey, now = new Date('2026-07-24T12:00:00.000Z')) {
  return signLicenseDocument(
    buildUnsignedLicense({
      notBefore: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 3_600_000),
    }),
    privateKey
  );
}

function tempDir(label = 'zpi-pro') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
}

function assertNoAbsoluteHostPath(value, depth = 0) {
  if (depth > 14 || value == null) return;
  if (typeof value === 'string') {
    assert.equal(/[A-Za-z]:\\/.test(value), false, `leaked drive path: ${value}`);
    assert.equal(/\/(?:Users|home)\//.test(value), false, `leaked unix home path: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoAbsoluteHostPath(item, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) assertNoAbsoluteHostPath(v, depth + 1);
  }
}

async function registerEntitled(zeus, overrides = {}) {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const now = overrides.now || new Date('2026-07-24T12:00:00.000Z');
  const options = {
    publicKeyPem: publicKey,
    licenseDocument: entitledLicense(privateKey, now),
    now,
    ...overrides.options,
  };
  const result = await registerProjectIntelligenceModule(zeus.modules, options);
  assert.equal(result.ok, true);
  return { options, publicKey, privateKey, now };
}

test(`Project Intelligence integrates against public core pin ${PUBLIC_CORE_PIN}`, async () => {
  const zeus = createZeus();
  assert.equal(typeof zeus.modules.registerModule, 'function');
  assert.equal(typeof zeus.projectIntelligence.createProjectRetriever, 'function');
  assert.equal(typeof registerProjectIntelligenceModule, 'function');
  assert.equal(PROJECT_INTELLIGENCE_MODULE_ID, 'zeus-pro.project-intelligence');
  assert.equal(PROJECT_INTELLIGENCE_NON_CLAIMS.sourceOfTruth, false);
  assert.equal(typeof projectIntelligence.fullIndex, 'function');
  assert.equal(typeof projectIntelligence.queryKnowledge, 'function');
});

test('denied entitlement registers nothing', async () => {
  const zeus = createZeus();
  const result = await registerProjectIntelligenceModule(zeus.modules, {
    publicKeyPem: 'not-a-key',
    licenseDocument: null,
  });
  assert.equal(result.ok, false);
  assert.ok(result.entitlement.reasonCode);
  assert.equal(zeus.capabilities.get(CAPS.STATUS), null);
  assert.equal(zeus.capabilities.get(CAPS.FULL_INDEX), null);
  // Community remains usable
  assert.equal(typeof zeus.analyze, 'function');
  assert.equal(typeof zeus.projectIntelligence.createSnapshotEngine, 'function');
});

test('valid entitlement registers PI capabilities including operations', async () => {
  const zeus = createZeus();
  await registerEntitled(zeus);

  assert.ok(zeus.capabilities.get(CAPS.STATUS));
  assert.ok(zeus.capabilities.get(CAPS.INSPECT_POLICY));
  assert.ok(zeus.capabilities.get(CAPS.CREATE_PROJECT));
  assert.ok(zeus.capabilities.get(CAPS.FULL_INDEX));
  assert.ok(zeus.capabilities.get(CAPS.INCREMENTAL_UPDATE));
  assert.ok(zeus.capabilities.get(CAPS.QUERY));
  assert.ok(zeus.capabilities.get(CAPS.IMPACT_ANALYSIS));
  assert.ok(zeus.capabilities.get(CAPS.BUILD_CONTEXT_PACKAGE));
  assert.ok(zeus.capabilities.get(CAPS.INSPECT_SNAPSHOT));
  assert.ok(zeus.capabilities.get(CAPS.VERIFY_INTEGRITY));

  const status = await zeus.capabilities.execute(CAPS.STATUS, {}, {});
  assert.equal(status.ok, true);
  assert.equal(status.result.commercial, true);
  assert.equal(status.result.claims.sourceOfTruth, false);
  assert.equal(status.result.operationsAvailable, true);
  assert.ok(Array.isArray(status.result.nonClaims));
  assert.equal(status.result.resourcePolicy.allowImplicitWorkspaceScan, false);
  assert.ok(status.result.capabilities.includes(CAPS.FULL_INDEX));
});

test('execute-time entitlement recheck denies after expiry', async () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const registerNow = new Date('2026-07-24T12:00:00.000Z');
  const license = signLicenseDocument(
    buildUnsignedLicense({
      notBefore: new Date(registerNow.getTime() - 60_000),
      expiresAt: new Date(registerNow.getTime() + 60_000),
    }),
    privateKey
  );
  const options = {
    publicKeyPem: publicKey,
    licenseDocument: license,
    now: registerNow,
  };
  const zeus = createZeus();
  const reg = await registerProjectIntelligenceModule(zeus.modules, options);
  assert.equal(reg.ok, true);

  options.now = new Date(registerNow.getTime() + 120_000);
  const exec = await zeus.capabilities.execute(CAPS.STATUS, {}, {});
  assert.equal(exec.ok, true);
  assert.equal(exec.result.ok, false);
  assert.equal(exec.result.reasonCode, REASON_CODES.ENTITLEMENT_EXPIRED);
  assert.equal(exec.result.claims.sourceOfTruth, false);

  const deniedOp = await zeus.capabilities.execute(
    CAPS.CREATE_PROJECT,
    {},
    {
      knowledgeRoot: path.join(os.tmpdir(), 'x'),
      projectId: 'p',
      trustedRoots: [{ rootId: 'r', path: os.tmpdir() }],
    }
  );
  assert.equal(deniedOp.result.ok, false);
  assert.equal(deniedOp.result.reasonCode, REASON_CODES.ENTITLEMENT_EXPIRED);
});

test('inspect-policy requires explicit trusted roots and redacts paths', async () => {
  const zeus = createZeus();
  await registerEntitled(zeus);

  const missing = await zeus.capabilities.execute(CAPS.INSPECT_POLICY, {}, {});
  assert.equal(missing.result.ok, false);
  assert.equal(missing.result.reasonCode, REASON_CODES.POLICY_DENIED);

  const rootDir = tempDir('zpi-pro-root');
  try {
    const ok = await zeus.capabilities.execute(
      CAPS.INSPECT_POLICY,
      {},
      {
        trustedRoots: [{ rootId: 'r1', path: rootDir }],
      }
    );
    assert.equal(ok.result.ok, true);
    assert.equal(ok.result.rootCount, 1);
    assert.equal(ok.result.trustedRoots[0].pathPresent, true);
    assert.equal(ok.result.trustedRoots[0].path, undefined);
    assert.equal(ok.result.policy.allowImplicitWorkspaceScan, false);
    assertNoAbsoluteHostPath(ok.result);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('descriptor declares all ZPI-10 capabilities and non-claims', () => {
  const d = projectIntelligence.buildDescriptor();
  assert.equal(d.id, PROJECT_INTELLIGENCE_MODULE_ID);
  assert.equal(d.entitlement.mode, 'module-managed');
  assert.equal(d.edition, 'professional');
  assert.equal(d.capabilities.length, Object.keys(CAPS).length);
  assert.ok(d.runtime.requiredFeatures.includes('offline-only'));
  assert.ok(d.safety.sideEffects.includes('local-artifact-write'));
});

test('package export surface includes ops helpers', () => {
  const sub = require('../src/projectIntelligence');
  assert.equal(typeof sub.registerProjectIntelligenceModule, 'function');
  assert.equal(typeof sub.validateTrustedRoots, 'function');
  assert.equal(typeof sub.evaluateResourcePolicy, 'function');
  assert.equal(typeof sub.createProjectKnowledge, 'function');
  assert.equal(typeof sub.fullIndex, 'function');
  assert.equal(typeof sub.queryKnowledge, 'function');
  assert.equal(typeof sub.impactAnalysis, 'function');
  assert.equal(typeof sub.buildContextPackage, 'function');
  assert.equal(typeof sub.inspectSnapshot, 'function');
  assert.equal(typeof sub.verifyIntegrity, 'function');
});

test('ops deny missing trusted roots and relative knowledgeRoot', () => {
  const denied = projectIntelligence.createProjectKnowledge(
    {
      knowledgeRoot: 'relative/not/absolute',
      projectId: 'p1',
      trustedRoots: [],
    },
    { resourcePolicy: projectIntelligence.DEFAULT_RESOURCE_POLICY }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.reasonCode, REASON_CODES.POLICY_DENIED);
  assert.equal(denied.claims.sourceOfTruth, false);
});

test(
  'entitled ops: create → full-index → query → impact → context → inspect → verify → incremental',
  { skip: !HAS_SQLITE },
  async () => {
    const root = tempDir('zpi10-ops');
    const src = path.join(root, 'src');
    const knowledgeRoot = path.join(root, 'pk');
    writeTree(src, {
      'ORDERPGM.rpgle': '**free\n// ORDERPGM calls CUSTINQ\n',
      'CUSTINQ.rpgle': '**free\n// CUSTINQ helper\n',
    });
    const trustedRoots = [{ rootId: 'root-src', path: src }];
    const projectId = 'proj-commercial-demo';

    const zeus = createZeus();
    await registerEntitled(zeus);

    const baseInput = { knowledgeRoot, projectId, trustedRoots };

    try {
      const created = await zeus.capabilities.execute(CAPS.CREATE_PROJECT, {}, baseInput);
      assert.equal(created.result.ok, true, created.result.message);
      assert.equal(created.result.operation, 'create-project');
      assert.equal(created.result.projectId, projectId);
      assert.equal(created.result.knowledgeRootSet, true);
      assertNoAbsoluteHostPath(created.result);

      const indexed = await zeus.capabilities.execute(CAPS.FULL_INDEX, {}, baseInput);
      assert.equal(indexed.result.ok, true, indexed.result.message);
      assert.equal(indexed.result.operation, 'full-index');
      assert.equal(indexed.result.published, true);
      assert.ok(indexed.result.snapshotId);
      assert.equal(indexed.result.counts.sourceUnits, 2);
      assertNoAbsoluteHostPath(indexed.result);

      const queried = await zeus.capabilities.execute(
        CAPS.QUERY,
        {},
        { ...baseInput, query: 'ORDERPGM', limit: 10 }
      );
      assert.equal(queried.result.ok, true, queried.result.message);
      assert.equal(queried.result.operation, 'query');
      assert.ok(Array.isArray(queried.result.hits));
      assertNoAbsoluteHostPath(queried.result);

      const impact = await zeus.capabilities.execute(
        CAPS.IMPACT_ANALYSIS,
        {},
        { ...baseInput, query: 'ORDERPGM', expandHops: 1 }
      );
      assert.equal(impact.result.ok, true, impact.result.message);
      assert.equal(impact.result.operation, 'impact-analysis');
      assert.ok(Array.isArray(impact.result.impactedSymbols));
      assertNoAbsoluteHostPath(impact.result);

      const ctxPkg = await zeus.capabilities.execute(
        CAPS.BUILD_CONTEXT_PACKAGE,
        {},
        { ...baseInput, query: 'CUSTINQ', tokenBudget: 2000 }
      );
      assert.equal(ctxPkg.result.ok, true, ctxPkg.result.message);
      assert.equal(ctxPkg.result.operation, 'build-context-package');
      assert.ok(ctxPkg.result.contextPackage);
      assertNoAbsoluteHostPath(ctxPkg.result);

      const overBudget = await zeus.capabilities.execute(
        CAPS.BUILD_CONTEXT_PACKAGE,
        {},
        { ...baseInput, query: 'x', tokenBudget: 999999 }
      );
      assert.equal(overBudget.result.ok, false);
      assert.equal(overBudget.result.reasonCode, REASON_CODES.POLICY_DENIED);

      const inspected = await zeus.capabilities.execute(CAPS.INSPECT_SNAPSHOT, {}, baseInput);
      assert.equal(inspected.result.ok, true, inspected.result.message);
      assert.equal(inspected.result.operation, 'inspect-snapshot');
      assert.equal(inspected.result.counts.sourceUnits, 2);
      assertNoAbsoluteHostPath(inspected.result);

      const verified = await zeus.capabilities.execute(CAPS.VERIFY_INTEGRITY, {}, baseInput);
      assert.equal(verified.result.ok, true, verified.result.message);
      assert.equal(verified.result.operation, 'verify-integrity');
      assert.equal(verified.result.overallOk, true);
      assertNoAbsoluteHostPath(verified.result);

      // Touch a file then incremental update
      fs.writeFileSync(path.join(src, 'ORDERPGM.rpgle'), '**free\n// ORDERPGM updated\n', 'utf8');
      const incr = await zeus.capabilities.execute(CAPS.INCREMENTAL_UPDATE, {}, baseInput);
      assert.equal(incr.result.ok, true, incr.result.message);
      assert.equal(incr.result.operation, 'incremental-update');
      assertNoAbsoluteHostPath(incr.result);

      // Missing roots still denied
      const noRoots = await zeus.capabilities.execute(
        CAPS.QUERY,
        {},
        { knowledgeRoot, projectId, query: 'x' }
      );
      assert.equal(noRoots.result.ok, false);
      assert.equal(noRoots.result.reasonCode, REASON_CODES.POLICY_DENIED);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);

test('ZPI-11 Community adapters see present capabilities after registration', async () => {
  const {
    discoverProjectIntelligenceCapabilities,
    executeProjectIntelligenceOperation,
    listProjectKnowledgeMcpTools,
  } = require('zeus-rpg-promptkit/project-intelligence-contracts');

  const zeus = createZeus();
  const absent = discoverProjectIntelligenceCapabilities(zeus.capabilities);
  assert.equal(absent.present, false);

  await registerEntitled(zeus);
  const present = discoverProjectIntelligenceCapabilities(zeus.capabilities);
  assert.equal(present.present, true);
  assert.equal(present.presentCount, present.totalOperations);
  assert.ok(present.operations.every(op => op.present === true));

  const status = await executeProjectIntelligenceOperation({
    capabilities: zeus.capabilities,
    operation: 'status',
    input: {},
  });
  assert.equal(status.ok, true);
  assert.equal(status.result.operationsAvailable, true);
  assert.equal(status.capabilityId, CAPS.STATUS);

  // Registered capabilities advertise CLI/MCP for Community thin adapters
  const cap = zeus.capabilities.get(CAPS.FULL_INDEX);
  assert.ok(cap);
  assert.equal(cap.availability.cli, true);
  assert.equal(cap.availability.mcp, true);
  assert.equal(cap.availability.api, true);

  const mcpTools = listProjectKnowledgeMcpTools();
  assert.ok(mcpTools.some(t => t.name === 'zeus.project-knowledge.full-index'));
});

test('registerWithZeus host entry registers project-intelligence by default', async () => {
  const {
    registerWithZeus,
    generateEphemeralKeyPair,
    buildUnsignedLicense,
    signLicenseDocument,
    PROJECT_INTELLIGENCE_CAPABILITY_IDS,
  } = require('../src');
  const { createZeus } = require('zeus-rpg-promptkit/api');
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const now = new Date('2026-07-24T12:00:00.000Z');
  const licenseDocument = signLicenseDocument(
    buildUnsignedLicense({
      notBefore: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 3_600_000),
    }),
    privateKey
  );
  const zeus = createZeus();
  const result = await registerWithZeus(zeus, {
    publicKeyPem: publicKey,
    licenseDocument,
    now,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.selected, ['project-intelligence']);
  assert.ok(result.modules['project-intelligence']);
  assert.ok(zeus.capabilities.get(PROJECT_INTELLIGENCE_CAPABILITY_IDS.STATUS));
  assert.ok(zeus.capabilities.get(PROJECT_INTELLIGENCE_CAPABILITY_IDS.FULL_INDEX));
});
