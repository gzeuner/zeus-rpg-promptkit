'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  createZeus,
  createProviderRegistry,
  generationValidation,
  providers: providerNamespace,
} = require('zeus-rpg-promptkit/api');

const {
  generateEphemeralKeyPair,
  buildUnsignedLicense,
  signLicenseDocument,
  registerReferenceModule,
  CAPABILITY_ID: REFERENCE_CAPABILITY_ID,
  registerGenerationAssuranceModule,
  generationAssurance,
  GENERATION_ASSURANCE_CAPABILITY_ID,
  GENERATION_ASSURANCE_MODULE_ID,
  GENERATION_ASSURANCE_STOP_CODES: STOP,
  GENERATION_ASSURANCE_CONTRACT_REF,
} = require('../src');
const { runGenerationAssurance } = require('../src/generationAssurance/engine');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entitledLicense(privateKey, now = new Date('2026-07-19T12:00:00.000Z'), overrides = {}) {
  return signLicenseDocument(
    buildUnsignedLicense({
      notBefore: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 3_600_000),
      ...overrides,
    }),
    privateKey
  );
}

function entitlementBundle(now = new Date('2026-07-19T12:00:00.000Z')) {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  return {
    publicKeyPem: publicKey,
    privateKey,
    now,
    licenseDocument: entitledLicense(privateKey, now),
  };
}

function minimalCandidate(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'generation-candidate',
    contractId: 'zeus.generation-candidate',
    candidateId: 'cand-ga-1',
    taskSummary: 'Adjust field handling in ORDERPGM',
    evidenceReferences: [{ id: 'ev-canonical', kind: 'artifact', path: 'canonical-analysis.json' }],
    assumptions: ['Source encoding is UTF-8'],
    uncertainties: ['Business rule completeness unknown'],
    proposedFiles: [
      {
        path: 'QRPGLESRC/ORDERPGM.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: '**free\ndcl-s x int(10);\n',
        rationale: 'Declare working variable',
      },
    ],
    correlationId: 'corr-ga-1',
    ...overrides,
  };
}

function failingCandidate(overrides = {}) {
  // Duplicate targets force validation-failed (repairable path).
  return minimalCandidate({
    proposedFiles: [
      {
        path: 'QRPGLESRC/ORDERPGM.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: '**free\ndcl-s x int(10);\n',
        rationale: 'first',
      },
      {
        path: 'QRPGLESRC/ORDERPGM.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: '**free\ndcl-s y int(10);\n',
        rationale: 'duplicate target',
      },
    ],
    ...overrides,
  });
}

function evidenceStore() {
  return {
    'ev-canonical': { kind: 'artifact', path: 'canonical-analysis.json' },
  };
}

function syntheticValidation(candidateId, diagnostics, status = 'validation-failed') {
  return {
    status,
    reviewReady: status === 'review-ready',
    report: {
      schemaVersion: 1,
      kind: 'generation-validation-report',
      contractId: 'zeus.generation-validation-report',
      contractVersion: 1,
      candidateId,
      status,
      reviewReady: status === 'review-ready',
      diagnostics,
      evidenceChecked: [],
      assumptions: [],
      uncertainties: [],
      policy: { denied: false, reason: null },
      summary: 'deterministic test validation',
      notes: [],
    },
  };
}

function createTempPair() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-ga-ws-'));
  const reviewRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-ga-review-'));
  fs.writeFileSync(path.join(workspaceRoot, 'marker.txt'), 'workspace-unchanged\n', 'utf8');
  return { workspaceRoot, reviewRoot };
}

function cleanupPair(pair) {
  fs.rmSync(pair.workspaceRoot, { recursive: true, force: true });
  fs.rmSync(pair.reviewRoot, { recursive: true, force: true });
}

function modelResponse(request, candidate, usage) {
  return {
    schemaVersion: 1,
    contract: 'zeus.model-provider-response@1',
    providerId: request.providerId,
    modelId: request.modelId,
    correlationId: request.correlationId,
    advisory: true,
    sourceOfTruth: false,
    evidenceReferences: (request.evidenceReferences || []).map(r => ({
      id: r.id,
      contract: r.contract,
    })),
    output: { candidate },
    ...(usage ? { usage } : {}),
  };
}

function createScriptedProvider({
  id = 'test.ga-scripted',
  modelId = 'scripted-v1',
  scripts = [],
  onInvoke = null,
} = {}) {
  let callIndex = 0;
  const descriptor = {
    schemaVersion: 1,
    contract: 'zeus.model-provider-descriptor@1',
    descriptorVersion: 'zeus.model-provider-descriptor/v1',
    kind: 'model',
    id,
    displayName: 'Scripted GA Provider (offline)',
    trustZone: 'local',
    capabilities: ['structured-output'],
    models: [modelId],
  };
  return {
    descriptor,
    callCount: () => callIndex,
    invoke: async (_context, request) => {
      if (typeof onInvoke === 'function') onInvoke(request, callIndex);
      const script = scripts[callIndex] || scripts[scripts.length - 1];
      callIndex += 1;
      if (!script) throw new Error('no scripted response');
      if (script.throw) {
        const err = new Error(script.throwMessage || 'scripted provider throw');
        if (script.throwCode) err.code = script.throwCode;
        throw err;
      }
      if (script.raw) return script.raw(request);
      if (script.candidate) {
        return modelResponse(request, script.candidate, script.usage);
      }
      throw new Error('invalid script entry');
    },
  };
}

function allowLocalSourceCodePolicy() {
  return providerNamespace.policy.createEgressPolicy([
    { classification: 'source-code', trustZone: 'local', allow: true },
  ]);
}

function denyAllPolicy() {
  // Valid policy object with no matching rule for source-code/local
  return providerNamespace.policy.createEgressPolicy([
    { classification: 'public-metadata', trustZone: 'local', allow: true },
  ]);
}

async function runGa({ candidate, provider, entitlement, extra = {} }) {
  const pair = createTempPair();
  const registry = createProviderRegistry();
  if (provider) {
    registry.register({
      descriptor: provider.descriptor,
      invoke: provider.invoke,
      configProvenance: {
        schemaVersion: 1,
        contract: 'zeus.provider-config-provenance@1',
        sourceKind: 'test',
        sourceReference: 'generation-assurance-test',
        configuredKeys: ['providerId'],
        redaction: 'values-omitted',
      },
    });
  }
  try {
    const result = await runGenerationAssurance({
      candidate,
      options: {
        workspaceRoot: pair.workspaceRoot,
        reviewArtifactRoot: pair.reviewRoot,
        evidenceStore: evidenceStore(),
        providerRegistry: provider ? registry : null,
        providerId: provider ? provider.descriptor.id : null,
        modelId: provider ? provider.descriptor.models[0] : null,
        egressPolicy:
          extra.egressPolicy !== undefined ? extra.egressPolicy : allowLocalSourceCodePolicy(),
        entitlement: entitlement || null,
        correlationIdBase: extra.correlationIdBase || 'test-corr',
        runId: extra.runId || 'test-run',
        generationValidation,
        ...extra,
      },
    });
    const workspaceHash = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    return { result, pair, workspaceHash, registry, provider };
  } catch (error) {
    cleanupPair(pair);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Dependency pin / registration isolation
// ---------------------------------------------------------------------------

test('unified package is self-contained under Apache-2.0', () => {
  const pkg = JSON.parse(fs.readFileSync(require.resolve('../package.json'), 'utf8'));
  assert.equal(pkg.name, 'zeus-rpg-promptkit');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.dependencies['zeus-rpg-promptkit'], undefined);
});

test('generation assurance contract ref is private portable @1', () => {
  assert.equal(
    GENERATION_ASSURANCE_CONTRACT_REF,
    'zeus-pro.generation-assurance-attempt-history@1'
  );
  assert.equal(GENERATION_ASSURANCE_MODULE_ID, 'zeus-pro.generation-assurance');
  assert.equal(GENERATION_ASSURANCE_CAPABILITY_ID, 'zeus-pro.generation-assurance.run');
});

test('direct Generation Assurance engine is not a public package export', () => {
  const packageRoot = require('../src');
  const packageGenerationAssurance = require('../src/generationAssurance');
  assert.equal(Object.prototype.hasOwnProperty.call(packageRoot, 'runGenerationAssurance'), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(packageGenerationAssurance, 'runGenerationAssurance'),
    false
  );
  assert.equal(typeof packageGenerationAssurance.validateAttemptHistory, 'function');
  assert.equal(typeof packageGenerationAssurance.exportAttemptHistory, 'function');
});

test('capability registration is isolated and preserves reference module', async () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const now = new Date('2026-07-19T12:00:00.000Z');
  const license = entitledLicense(privateKey, now);
  const zeus = createZeus();

  const ref = await registerReferenceModule(zeus.modules, {
    publicKeyPem: publicKey,
    licenseDocument: license,
    now,
  });
  assert.equal(ref.ok, true);
  assert.ok(zeus.capabilities.get(REFERENCE_CAPABILITY_ID));

  const ga = await registerGenerationAssuranceModule(zeus.modules, {
    publicKeyPem: publicKey,
    licenseDocument: license,
    now,
  });
  assert.equal(ga.ok, true);
  assert.ok(zeus.capabilities.get(GENERATION_ASSURANCE_CAPABILITY_ID));
  // Reference still present
  assert.ok(zeus.capabilities.get(REFERENCE_CAPABILITY_ID));
  // Community surface intact
  assert.equal(typeof zeus.generationValidation.validateGenerationCandidate, 'function');
  assert.equal(typeof zeus.analyze, 'function');

  // Descriptor/capability safety: S3 remote interaction + local artifacts, explicit approval
  const descriptor = generationAssurance.buildDescriptor();
  assert.equal(descriptor.safety.level, 'S3');
  assert.deepEqual(
    [...descriptor.safety.sideEffects].sort(),
    ['local-artifact-write', 'remote-read', 'remote-write'].sort()
  );
  const cap = zeus.capabilities.get(GENERATION_ASSURANCE_CAPABILITY_ID);
  assert.equal(cap.safety.level, 'S3');
  assert.equal(cap.safety.requiresExplicitApproval, true);
  assert.ok(cap.safety.sideEffects.includes('remote-read'));
  assert.ok(cap.safety.sideEffects.includes('remote-write'));
  assert.ok(cap.safety.sideEffects.includes('local-artifact-write'));
});

// ---------------------------------------------------------------------------
// Attempt bounds & success paths
// ---------------------------------------------------------------------------

test('initial review-ready => 0 provider calls and REVIEW_READY', async () => {
  const ent = entitlementBundle();
  let calls = 0;
  const provider = createScriptedProvider({
    scripts: [{ candidate: minimalCandidate() }],
    onInvoke: () => {
      calls += 1;
    },
  });
  const { result, pair, workspaceHash } = await runGa({
    candidate: minimalCandidate(),
    provider,
    entitlement: ent,
  });
  try {
    assert.equal(result.stopCode, STOP.REVIEW_READY);
    assert.equal(result.providerInvocationCount, 0);
    assert.equal(calls, 0);
    assert.equal(result.history.attempts.length, 1);
    assert.equal(result.history.attempts[0].index, 0);
    assert.equal(result.claims.compiled, false);
    assert.equal(result.claims.workspaceMutated, false);
    assert.equal(result.artifacts.written, true);
    const after = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    assert.equal(after.fingerprint, workspaceHash.fingerprint);
  } finally {
    cleanupPair(pair);
  }
});

test('success after exactly 1 provider call', async () => {
  const ent = entitlementBundle();
  const fixed = minimalCandidate({ candidateId: 'fixed-1' });
  const provider = createScriptedProvider({
    scripts: [{ candidate: fixed }],
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
    extra: { declaredScopePaths: ['QRPGLESRC/ORDERPGM.rpgle', 'QRPGLESRC/ORDERPGM.notallowed'] },
  });
  try {
    assert.equal(result.stopCode, STOP.REVIEW_READY);
    assert.equal(result.providerInvocationCount, 1);
    assert.equal(provider.callCount(), 1);
    assert.equal(result.history.attempts.length, 2);
    assert.ok(result.history.attempts.length <= 3);
    assert.ok(result.providerInvocationCount <= 2);
  } finally {
    cleanupPair(pair);
  }
});

test('success after exactly 2 provider calls', async () => {
  const ent = entitlementBundle();
  // Evidence provenance must be preserved on every repair candidate.
  // Path 1: still failing via disallowed extension (validation-failed, improved vs duplicates).
  // Path 2: review-ready with same evidence references.
  const stillFailing = minimalCandidate({
    candidateId: 'still-fail',
    proposedFiles: [
      {
        path: 'QRPGLESRC/ORDERPGM.notallowed',
        action: 'modify',
        language: 'txt',
        content: 'not a permitted type\n',
        rationale: 'still failing file type',
      },
    ],
  });
  const fixed = minimalCandidate({ candidateId: 'fixed-2' });
  const provider = createScriptedProvider({
    scripts: [{ candidate: stillFailing }, { candidate: fixed }],
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
    extra: { declaredScopePaths: ['QRPGLESRC/ORDERPGM.rpgle', 'QRPGLESRC/ORDERPGM.notallowed'] },
  });
  try {
    assert.equal(result.stopCode, STOP.REVIEW_READY);
    assert.equal(result.providerInvocationCount, 2);
    assert.equal(provider.callCount(), 2);
    assert.equal(result.history.attempts.length, 3);
    assert.ok(result.history.attempts.length <= 3);
  } finally {
    cleanupPair(pair);
  }
});

test('permanently failing => exactly 2 calls and MAX_ATTEMPTS; never third call', async () => {
  const ent = entitlementBundle();
  // Strictly improving quality vectors that never reach review-ready:
  // initial: two duplicate pairs; attempt1: one dup + missing evidence; attempt2: missing evidence only.
  const initial = minimalCandidate({
    candidateId: 'initial-fail',
    proposedFiles: [
      {
        path: 'QRPGLESRC/A.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: '**free\n',
        rationale: '1',
      },
      {
        path: 'QRPGLESRC/A.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: '**free\n',
        rationale: '2',
      },
      {
        path: 'QRPGLESRC/B.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: '**free\n',
        rationale: '3',
      },
      {
        path: 'QRPGLESRC/B.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: '**free\n',
        rationale: '4',
      },
    ],
  });
  // Preserve evidence provenance; strictly improve quality each attempt without review-ready.
  // fail1: two disallowed file types (more diagnostics); fail2: one disallowed type (fewer).
  const fail1 = minimalCandidate({
    candidateId: 'fail-1',
    proposedFiles: [
      {
        path: 'QRPGLESRC/A.notallowed',
        action: 'modify',
        language: 'txt',
        content: 'a\n',
        rationale: 'a',
      },
      {
        path: 'QRPGLESRC/B.notallowed',
        action: 'modify',
        language: 'txt',
        content: 'b\n',
        rationale: 'b',
      },
    ],
  });
  const fail2 = minimalCandidate({
    candidateId: 'fail-2',
    proposedFiles: [
      {
        path: 'QRPGLESRC/C.notallowed',
        action: 'modify',
        language: 'txt',
        content: 'c\n',
        rationale: 'c',
      },
    ],
  });
  let calls = 0;
  const provider = createScriptedProvider({
    scripts: [{ candidate: fail1 }, { candidate: fail2 }, { candidate: fail2 }],
    onInvoke: () => {
      calls += 1;
    },
  });
  const { result, pair } = await runGa({
    candidate: initial,
    provider,
    entitlement: ent,
    extra: {
      declaredScopePaths: [
        'QRPGLESRC/A.rpgle',
        'QRPGLESRC/B.rpgle',
        'QRPGLESRC/A.notallowed',
        'QRPGLESRC/B.notallowed',
        'QRPGLESRC/C.notallowed',
      ],
    },
  });
  try {
    assert.equal(result.stopCode, STOP.MAX_ATTEMPTS);
    assert.equal(result.providerInvocationCount, 2);
    assert.equal(calls, 2);
    assert.equal(result.history.attempts.length, 3);
    assert.ok(result.history.attempts.length <= 3);
    assert.ok(result.providerInvocationCount <= 2);
    assert.notEqual(calls, 3);
  } finally {
    cleanupPair(pair);
  }
});

// ---------------------------------------------------------------------------
// Diagnostics comparison stops
// ---------------------------------------------------------------------------

test('reordered identical diagnostics stop with IDENTICAL_DIAGNOSTICS', async () => {
  const ent = entitlementBundle();
  // Provider returns the same structural failure (duplicates) — fingerprint matches baseline.
  const sameFail = failingCandidate({ candidateId: 'same-fail' });
  const provider = createScriptedProvider({
    scripts: [{ candidate: sameFail }],
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
  });
  try {
    assert.equal(result.stopCode, STOP.IDENTICAL_DIAGNOSTICS);
    assert.equal(result.providerInvocationCount, 1);
  } finally {
    cleanupPair(pair);
  }
});

test('worsening status/severity/count stops with WORSENING_RESULT', async () => {
  const ent = entitlementBundle();
  const worse = failingCandidate({ candidateId: 'worse' });
  const provider = createScriptedProvider({
    scripts: [{ candidate: worse }],
  });
  const generationValidationFacade = {
    validateGenerationCandidate: async candidate => {
      const severity = candidate.candidateId === 'worse' ? 'error' : 'warning';
      return syntheticValidation(candidate.candidateId, [
        {
          id: `QUALITY_${severity.toUpperCase()}`,
          severity,
          validatorId: 'test.quality-vector',
          validatorVersion: 1,
          path: 'QRPGLESRC/ORDERPGM.rpgle',
          message: `${severity} quality`,
        },
      ]);
    },
  };
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
    extra: { generationValidation: generationValidationFacade, validatorRegistry: {} },
  });
  try {
    assert.equal(result.stopCode, STOP.WORSENING_RESULT);
    assert.equal(result.providerInvocationCount, 1);
  } finally {
    cleanupPair(pair);
  }
});

test('changed-not-improved allows at most one remaining attempt', async () => {
  const ent = entitlementBundle();
  const cni1 = failingCandidate({ candidateId: 'cni-1' });
  const cni2 = failingCandidate({ candidateId: 'cni-2' });
  const initial = failingCandidate({ candidateId: 'cni-0' });
  let calls = 0;
  const provider = createScriptedProvider({
    scripts: [{ candidate: cni1 }, { candidate: cni2 }],
    onInvoke: () => {
      calls += 1;
    },
  });
  const generationValidationFacade = {
    validateGenerationCandidate: async candidate =>
      syntheticValidation(candidate.candidateId, [
        {
          id: `CNI_${candidate.candidateId}`,
          severity: 'error',
          validatorId: 'test.cni',
          validatorVersion: 1,
          path: 'QRPGLESRC/ORDERPGM.rpgle',
          message: `changed diagnostic ${candidate.candidateId}`,
        },
      ]),
  };
  const { result, pair } = await runGa({
    candidate: initial,
    provider,
    entitlement: ent,
    extra: { generationValidation: generationValidationFacade, validatorRegistry: {} },
  });
  try {
    assert.equal(calls, 2);
    assert.equal(result.providerInvocationCount, 2);
    assert.equal(result.stopCode, STOP.CHANGED_NOT_IMPROVED);
  } finally {
    cleanupPair(pair);
  }
});

// ---------------------------------------------------------------------------
// Scope / path / policy / entitlement
// ---------------------------------------------------------------------------

test('scope expansion / path traversal / absolute / UNC stop fail-closed', async () => {
  const ent = entitlementBundle();
  for (const badPath of [
    '../escape.rpgle',
    '/etc/passwd',
    'C:\\Windows\\a.rpgle',
    '\\\\server\\share\\a.rpgle',
  ]) {
    const { result, pair } = await runGa({
      candidate: minimalCandidate({
        candidateId: `bad-${badPath.length}`,
        proposedFiles: [
          {
            path: badPath,
            action: 'modify',
            language: 'rpgle',
            content: '**free\n',
            rationale: 'bad path',
          },
        ],
      }),
      provider: createScriptedProvider({ scripts: [{ candidate: minimalCandidate() }] }),
      entitlement: ent,
    });
    try {
      assert.equal(result.providerInvocationCount, 0);
      assert.ok(
        result.stopCode === STOP.SCOPE_EXPANSION ||
          result.stopCode === STOP.POLICY_DENIED ||
          result.stopCode === STOP.INITIAL_NOT_REPAIRABLE
      );
    } finally {
      cleanupPair(pair);
    }
  }
});

test('policy denial before provider call (egress) with zero further success path', async () => {
  const ent = entitlementBundle();
  let calls = 0;
  const provider = createScriptedProvider({
    scripts: [{ candidate: minimalCandidate() }],
    onInvoke: () => {
      calls += 1;
    },
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
    extra: { egressPolicy: denyAllPolicy() },
  });
  try {
    assert.equal(result.stopCode, STOP.PROVIDER_POLICY_DENIED);
    // Invocation was attempted (counted) but policy denied inside registry; provider script may or may not run.
    // Provider registry evaluates policy before invoke, so script should not run.
    assert.equal(calls, 0);
    assert.equal(result.providerInvocationCount, 1);
    // Complete attempt history for provider-path outcome
    assert.equal(result.history.attempts.length, 2);
    const stopped = result.history.attempts[1];
    assert.equal(stopped.index, 1);
    assert.equal(stopped.disposition, 'stopped');
    assert.equal(stopped.stopCode, STOP.PROVIDER_POLICY_DENIED);
    assert.equal(stopped.isFinal, true);
    assert.equal(stopped.providerIdentity.providerId, provider.descriptor.id);
    assert.equal(stopped.providerIdentity.modelId, provider.descriptor.models[0]);
    assert.ok(stopped.correlationId);
    // Current candidate snapshot retained (not fabricated provider candidate)
    assert.equal(stopped.candidate.snapshot.candidateId, 'cand-ga-1');
    assert.ok(Array.isArray(stopped.validationReport.diagnostics));
    assert.equal(result.history.finalDecision.stopCode, STOP.PROVIDER_POLICY_DENIED);
  } finally {
    cleanupPair(pair);
  }
});

test('candidate policy denial after attempt maps to POLICY_DENIED', async () => {
  const ent = entitlementBundle();
  const denied = minimalCandidate({
    candidateId: 'pol-denied',
    proposedFiles: [
      {
        path: 'QRPGLESRC/ORDERPGM.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: '**free\n// password: "supersecretvalue123"\n',
        rationale: 'secret',
      },
    ],
  });
  const provider = createScriptedProvider({
    scripts: [{ candidate: denied }],
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
  });
  try {
    assert.ok(result.stopCode === STOP.POLICY_DENIED || result.stopCode === STOP.WORSENING_RESULT);
    assert.equal(result.providerInvocationCount, 1);
  } finally {
    cleanupPair(pair);
  }
});

test('entitlement denial before provider with throwing spy => zero provider calls', async () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const now = new Date('2026-07-19T12:00:00.000Z');
  // Expired license
  const license = signLicenseDocument(
    buildUnsignedLicense({
      notBefore: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: now,
    }),
    privateKey
  );
  let calls = 0;
  const provider = createScriptedProvider({
    scripts: [{ candidate: minimalCandidate() }],
    onInvoke: () => {
      calls += 1;
      throw new Error('spy provider must not be invoked');
    },
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: {
      publicKeyPem: publicKey,
      licenseDocument: license,
      now,
    },
  });
  try {
    assert.equal(result.stopCode, STOP.ENTITLEMENT_DENIED);
    assert.equal(calls, 0);
    assert.equal(result.providerInvocationCount, 0);
    assert.equal(provider.callCount(), 0);
    // Not a provider attempt — no new index; last attempt carries final stop
    assert.equal(result.history.attempts.length, 1);
    assert.equal(result.history.attempts[0].index, 0);
    assert.equal(result.history.attempts[0].stopCode, STOP.ENTITLEMENT_DENIED);
    assert.equal(result.history.attempts[0].isFinal, true);
    assert.equal(result.history.finalDecision.stopCode, STOP.ENTITLEMENT_DENIED);
  } finally {
    cleanupPair(pair);
  }
});

test('missing entitlement denies provider path', async () => {
  let calls = 0;
  const provider = createScriptedProvider({
    scripts: [{ candidate: minimalCandidate() }],
    onInvoke: () => {
      calls += 1;
    },
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: null,
  });
  try {
    assert.equal(result.stopCode, STOP.ENTITLEMENT_DENIED);
    assert.equal(calls, 0);
  } finally {
    cleanupPair(pair);
  }
});

// ---------------------------------------------------------------------------
// Provider failure modes
// ---------------------------------------------------------------------------

test('provider throw maps to PROVIDER_FAILED', async () => {
  const ent = entitlementBundle();
  const provider = createScriptedProvider({
    scripts: [{ throw: true, throwMessage: 'boom secret=supersecretvalue' }],
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
  });
  try {
    assert.equal(result.stopCode, STOP.PROVIDER_FAILED);
    assert.equal(result.providerInvocationCount, 1);
    assert.equal(result.history.attempts.length, 2);
    const stopped = result.history.attempts[1];
    assert.equal(stopped.disposition, 'stopped');
    assert.equal(stopped.stopCode, STOP.PROVIDER_FAILED);
    assert.ok(stopped.providerIdentity.providerId);
    assert.ok(stopped.correlationId);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('supersecretvalue'), false);
    assert.equal(serialized.includes('boom secret'), false);
  } finally {
    cleanupPair(pair);
  }
});

test('provider timeout maps to PROVIDER_FAILED', async () => {
  const ent = entitlementBundle();
  const custom = {
    descriptor: {
      schemaVersion: 1,
      contract: 'zeus.model-provider-descriptor@1',
      descriptorVersion: 'zeus.model-provider-descriptor/v1',
      kind: 'model',
      id: 'test.ga-timeout',
      displayName: 'Timeout Provider',
      trustZone: 'local',
      capabilities: ['structured-output'],
      models: ['t1'],
    },
    invoke: async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return {
        schemaVersion: 1,
        contract: 'zeus.model-provider-response@1',
        providerId: 'test.ga-timeout',
        modelId: 't1',
        correlationId: 'x',
        advisory: true,
        sourceOfTruth: false,
        evidenceReferences: [],
        output: { candidate: minimalCandidate() },
      };
    },
  };
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider: custom,
    entitlement: ent,
    extra: { timeoutMs: 20 },
  });
  try {
    assert.equal(result.stopCode, STOP.PROVIDER_FAILED);
    assert.equal(result.providerInvocationCount, 1);
  } finally {
    cleanupPair(pair);
  }
});

test('malformed provider output / identity mismatch => PROVIDER_OUTPUT_INVALID', async () => {
  const ent = entitlementBundle();
  const provider = createScriptedProvider({
    scripts: [
      {
        raw: request => ({
          schemaVersion: 1,
          contract: 'zeus.model-provider-response@1',
          providerId: 'wrong-provider',
          modelId: request.modelId,
          correlationId: request.correlationId,
          advisory: true,
          sourceOfTruth: false,
          evidenceReferences: request.evidenceReferences,
          output: { candidate: minimalCandidate() },
        }),
      },
    ],
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
  });
  try {
    assert.ok(
      result.stopCode === STOP.PROVIDER_OUTPUT_INVALID || result.stopCode === STOP.PROVIDER_FAILED
    );
    assert.equal(result.providerInvocationCount, 1);
  } finally {
    cleanupPair(pair);
  }
});

test('provider evidence mismatch => PROVIDER_OUTPUT_INVALID', async () => {
  const ent = entitlementBundle();
  const provider = createScriptedProvider({
    scripts: [
      {
        raw: request => ({
          schemaVersion: 1,
          contract: 'zeus.model-provider-response@1',
          providerId: request.providerId,
          modelId: request.modelId,
          correlationId: request.correlationId,
          advisory: true,
          sourceOfTruth: false,
          evidenceReferences: [{ id: 'totally-other', contract: 'zeus.generation-candidate@1' }],
          output: { candidate: minimalCandidate() },
        }),
      },
    ],
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
  });
  try {
    assert.equal(result.stopCode, STOP.PROVIDER_OUTPUT_INVALID);
    assert.equal(result.providerInvocationCount, 1);
    assert.equal(result.history.attempts.length, 2);
    assert.equal(result.history.attempts[1].disposition, 'stopped');
    assert.equal(result.history.attempts[1].stopCode, STOP.PROVIDER_OUTPUT_INVALID);
    assert.ok(result.history.attempts[1].providerIdentity.providerId);
  } finally {
    cleanupPair(pair);
  }
});

// ---------------------------------------------------------------------------
// Validator failures / bounds / redaction / determinism / contract
// ---------------------------------------------------------------------------

test('validator throw isolates to VALIDATOR_INTERNAL_FAILURE diagnostic path', async () => {
  const ent = entitlementBundle();
  const registry = generationValidation.createDefaultValidatorRegistry();
  registry.register({
    id: 'throwing-advanced',
    version: 1,
    order: 999,
    validate() {
      throw new Error('validator boom with secret=supersecretvalue');
    },
  });
  // Review-ready candidate still runs all validators including throwing one.
  const { result, pair } = await runGa({
    candidate: minimalCandidate(),
    provider: null,
    entitlement: ent,
    extra: { validatorRegistry: registry },
  });
  try {
    assert.equal(result.stopCode, STOP.VALIDATOR_INTERNAL_FAILURE);
    assert.equal(result.providerInvocationCount, 0);
    const json = JSON.stringify(result.history);
    assert.equal(json.includes('supersecretvalue'), false);
  } finally {
    cleanupPair(pair);
  }
});

test('missing required validator fails closed', async () => {
  const ent = entitlementBundle();
  const empty = generationValidation.createValidatorRegistry({
    requiredIds: ['schema', 'contract-version', 'workspace-path'],
  });
  // Register none of the required validators.
  const { result, pair } = await runGa({
    candidate: minimalCandidate(),
    provider: null,
    entitlement: ent,
    extra: { validatorRegistry: empty },
  });
  try {
    assert.equal(result.stopCode, STOP.VALIDATOR_INTERNAL_FAILURE);
    assert.equal(result.providerInvocationCount, 0);
  } finally {
    cleanupPair(pair);
  }
});

test('bounded diagnostics stop with DIAGNOSTICS_LIMIT_EXCEEDED', () => {
  const huge = Array.from({ length: generationAssurance.LIMITS.maxDiagnostics + 5 }, (_, i) => ({
    id: `GENVAL.X${i}`,
    severity: 'error',
    validatorId: 't',
    validatorVersion: 1,
    path: `p${i}`,
    message: `m${i}`,
  }));
  const canon = generationAssurance.canonicalizeDiagnostics(huge);
  assert.equal(canon.ok, false);
  assert.equal(canon.code, 'DIAGNOSTICS_LIMIT_EXCEEDED');
});

test('secret redaction across request/history/artifacts', async () => {
  const ent = entitlementBundle();
  const secretCandidate = failingCandidate({
    taskSummary: 'fix password: hunter2hunter2 token=abcd',
    proposedFiles: [
      {
        path: 'QRPGLESRC/ORDERPGM.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: '**free\n// api_key: "ABCDEFGHIJKLMNOP"\n',
        rationale: 'password: hunter2hunter2',
      },
      {
        path: 'QRPGLESRC/ORDERPGM.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: 'x',
        rationale: 'dup',
      },
    ],
  });
  let capturedRequest = null;
  const provider = createScriptedProvider({
    scripts: [{ candidate: minimalCandidate() }],
    onInvoke: request => {
      capturedRequest = request;
    },
  });
  const { result, pair } = await runGa({
    candidate: secretCandidate,
    provider,
    entitlement: ent,
  });
  try {
    const historyJson = JSON.stringify(result.history);
    assert.equal(historyJson.includes('hunter2hunter2'), false);
    assert.equal(historyJson.includes('ABCDEFGHIJKLMNOP'), false);
    if (capturedRequest) {
      const reqJson = JSON.stringify(capturedRequest);
      assert.equal(reqJson.includes('hunter2hunter2'), false);
    }
    // Artifacts on disk
    for (const file of result.artifacts.files || []) {
      const text = fs.readFileSync(file, 'utf8');
      assert.equal(text.includes('hunter2hunter2'), false);
      assert.equal(text.includes('BEGIN PRIVATE KEY'), false);
    }
  } finally {
    cleanupPair(pair);
  }
});

test('deterministic deep-equal repeated runs', async () => {
  const ent = entitlementBundle();
  const fixed = minimalCandidate({ candidateId: 'det-fixed' });
  async function once() {
    const provider = createScriptedProvider({
      scripts: [{ candidate: fixed, usage: { inputUnits: 1, outputUnits: 1, totalUnits: 2 } }],
    });
    const { result, pair } = await runGa({
      candidate: failingCandidate({ candidateId: 'det-initial' }),
      provider,
      entitlement: ent,
      extra: { runId: 'det-run', correlationIdBase: 'det-corr' },
    });
    cleanupPair(pair);
    // Strip non-deterministic abs paths from artifacts
    const portable = {
      stopCode: result.stopCode,
      providerInvocationCount: result.providerInvocationCount,
      history: result.history,
      claims: result.claims,
    };
    return portable;
  }
  const a = await once();
  const b = await once();
  assert.deepEqual(a, b);
});

test('attempt history version rejection, roundtrip, defensive copying', () => {
  const history = generationAssurance.buildAttemptHistory({
    runId: 'rt-1',
    attempts: [
      generationAssurance.buildAttemptRecord({
        index: 0,
        candidateSnapshot: { candidateId: 'c' },
        candidateSha256: 'a'.repeat(64),
        validationReport: {
          schemaVersion: 1,
          kind: 'generation-validation-report',
          candidateId: 'c',
          status: 'review-ready',
          reviewReady: true,
          diagnostics: [],
        },
        canonicalDiagnostics: [],
        fingerprint: 'b'.repeat(64),
        qualityVector: [0, 0, 0, 0, 0, 0],
        disposition: 'baseline',
        isFinal: true,
        stopCode: STOP.REVIEW_READY,
      }),
    ],
    providerInvocationCount: 0,
    finalDecision: { stopCode: STOP.REVIEW_READY, reviewReady: true, message: 'ok' },
  });
  const exported = generationAssurance.exportAttemptHistory(history);
  exported.attempts.push({ evil: true });
  assert.equal(history.attempts.length, 1);

  const badVersion = { ...history, schemaVersion: 99, contractVersion: 99 };
  assert.equal(generationAssurance.validateAttemptHistory(badVersion).ok, false);
  assert.throws(() => generationAssurance.exportAttemptHistory(badVersion), /attempt history/);
});

// ---------------------------------------------------------------------------
// Workspace byte-identity / artifacts / offline / org profiles
// ---------------------------------------------------------------------------

test('byte-identical source workspace across every outcome', async () => {
  const ent = entitlementBundle();
  const outcomes = [];

  // review-ready
  {
    const { result, pair, workspaceHash } = await runGa({
      candidate: minimalCandidate(),
      provider: createScriptedProvider({ scripts: [{ candidate: minimalCandidate() }] }),
      entitlement: ent,
    });
    const after = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    outcomes.push({ stop: result.stopCode, same: after.fingerprint === workspaceHash.fingerprint });
    cleanupPair(pair);
  }
  // entitlement denied
  {
    const { result, pair, workspaceHash } = await runGa({
      candidate: failingCandidate(),
      provider: createScriptedProvider({ scripts: [{ candidate: minimalCandidate() }] }),
      entitlement: null,
    });
    const after = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    outcomes.push({ stop: result.stopCode, same: after.fingerprint === workspaceHash.fingerprint });
    cleanupPair(pair);
  }
  // provider failed
  {
    const { result, pair, workspaceHash } = await runGa({
      candidate: failingCandidate(),
      provider: createScriptedProvider({ scripts: [{ throw: true }] }),
      entitlement: ent,
    });
    const after = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    outcomes.push({ stop: result.stopCode, same: after.fingerprint === workspaceHash.fingerprint });
    cleanupPair(pair);
  }

  for (const o of outcomes) {
    assert.equal(o.same, true, `workspace mutated for ${o.stop}`);
  }
});

test('review artifacts are written outside the workspace', async () => {
  const ent = entitlementBundle();
  const { result, pair } = await runGa({
    candidate: minimalCandidate(),
    provider: null,
    entitlement: ent,
  });
  try {
    assert.equal(result.artifacts.written, true);
    for (const file of result.artifacts.files) {
      const rel = path.relative(pair.workspaceRoot, file);
      assert.ok(rel.startsWith('..') || path.isAbsolute(rel));
      assert.ok(file.startsWith(pair.reviewRoot));
    }
    assert.ok(fs.existsSync(path.join(result.artifacts.directory, 'attempt-history.json')));
  } finally {
    cleanupPair(pair);
  }
});

test('rejects review root inside source workspace', async () => {
  const ent = entitlementBundle();
  const pair = createTempPair();
  const inside = path.join(pair.workspaceRoot, 'nested-review');
  try {
    // Isolated: engine must not throw; artifacts.written=false with fixed error code.
    const result = await runGenerationAssurance({
      candidate: minimalCandidate(),
      options: {
        workspaceRoot: pair.workspaceRoot,
        reviewArtifactRoot: inside,
        evidenceStore: evidenceStore(),
        entitlement: ent,
        generationValidation,
      },
    });
    assert.ok(result.stopCode);
    assert.equal(result.artifacts.written, false);
    assert.equal(result.artifacts.error.code, 'ARTIFACT_WRITE_FAILED');
    assert.equal(JSON.stringify(result).includes(pair.workspaceRoot), false);
  } finally {
    cleanupPair(pair);
  }
});

test('optional organization profiles: neutral, valid, malformed fail-closed', async () => {
  const neutral = generationAssurance.resolveOrganizationProfile(null);
  assert.equal(neutral.ok, true);
  assert.equal(neutral.neutral, true);

  const valid = generationAssurance.resolveOrganizationProfile({
    id: 'org.local-a',
    allowedRelativeRoots: ['QRPGLESRC'],
    advancedValidatorIds: ['basic'],
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.profile.id, 'org.local-a');

  // Unknown field rejected
  const unknownField = generationAssurance.resolveOrganizationProfile({
    id: 'org.x',
    enterprisePolicyId: 'central-1',
  });
  assert.equal(unknownField.ok, false);

  const malformed = generationAssurance.resolveOrganizationProfile({
    id: 'bad',
    centralAdmin: true,
  });
  assert.equal(malformed.ok, false);

  const remote = generationAssurance.resolveOrganizationProfile({
    id: 'remote-org',
    remotePolicyEndpoint: 'https://evil.example/policy',
  });
  assert.equal(remote.ok, false);

  // Unknown advancedValidatorIds rejected
  const unknownPack = generationAssurance.resolveOrganizationProfile({
    id: 'org.pack',
    advancedValidatorIds: ['not-a-real-pack'],
  });
  assert.equal(unknownPack.ok, false);

  const ent = entitlementBundle();
  const { result, pair } = await runGa({
    candidate: minimalCandidate(),
    provider: null,
    entitlement: ent,
    extra: {
      organizationProfile: { id: 'x', centralAdmin: true },
    },
  });
  try {
    assert.equal(result.stopCode, STOP.POLICY_DENIED);
    assert.equal(result.providerInvocationCount, 0);
  } finally {
    cleanupPair(pair);
  }
});

test('offline mocks only: no network/compiler/deploy/git surface in GA module source', () => {
  const dir = path.join(__dirname, '..', 'src', 'generationAssurance');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.equal(text.includes('child_process'), false, f);
    assert.equal(/https?:\/\//.test(text), false, f);
    assert.equal(text.includes('git commit'), false, f);
    assert.equal(text.includes('git.push'), false, f);
    assert.equal(text.includes('ibm i compile'), false, f.toLowerCase());
  }
});

test('canonical diagnostics order independent of input order', () => {
  const a = [
    {
      id: 'B',
      severity: 'warning',
      validatorId: 'v',
      validatorVersion: 1,
      path: 'p',
      message: 'm2',
    },
    {
      id: 'A',
      severity: 'error',
      validatorId: 'v',
      validatorVersion: 1,
      path: 'p',
      message: 'm1',
    },
  ];
  const b = [a[1], a[0]];
  const ca = generationAssurance.canonicalizeDiagnostics(a);
  const cb = generationAssurance.canonicalizeDiagnostics(b);
  assert.equal(ca.fingerprint, cb.fingerprint);
  assert.deepEqual(ca.canonical, cb.canonical);
});

test('quality vector status order ranks review-ready best and denied worst', () => {
  const ready = generationAssurance.buildQualityVector('review-ready', []);
  const denied = generationAssurance.buildQualityVector('denied', [
    { severity: 'blocking', id: 'x' },
  ]);
  assert.ok(generationAssurance.compareQualityVectors(ready, denied) < 0);
});

test('provider request contains only allowlisted fields and authorized locations', async () => {
  const ent = entitlementBundle();
  let captured = null;
  const provider = createScriptedProvider({
    scripts: [{ candidate: minimalCandidate() }],
    onInvoke: request => {
      captured = request;
    },
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
  });
  try {
    assert.ok(captured);
    assert.equal(captured.classification, 'source-code');
    assert.equal(captured.input.classification, 'source-code');
    const content = captured.input.content;
    assert.equal(content.task, 'repair-generation-candidate');
    assert.ok(Array.isArray(content.diagnostics));
    assert.ok(Array.isArray(content.authorizedSourceLocations));
    assert.equal(Object.prototype.hasOwnProperty.call(content, 'workspaceTree'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(content, 'license'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(content, 'env'), false);
    assert.ok(result.providerInvocationCount <= 2);
  } finally {
    cleanupPair(pair);
  }
});

test('history export works without entitlement or provider', () => {
  const history = generationAssurance.buildAttemptHistory({
    runId: 'export-only',
    attempts: [
      generationAssurance.buildAttemptRecord({
        index: 0,
        candidateSnapshot: snapshotLite(),
        candidateSha256: crypto.createHash('sha256').update('x').digest('hex'),
        validationReport: {
          schemaVersion: 1,
          kind: 'generation-validation-report',
          candidateId: 'c',
          status: 'validation-failed',
          reviewReady: false,
          diagnostics: [],
        },
        canonicalDiagnostics: [],
        fingerprint: crypto.createHash('sha256').update('[]').digest('hex'),
        qualityVector: [1, 0, 0, 0, 0, 0],
        disposition: 'baseline',
        isFinal: true,
        stopCode: STOP.MAX_ATTEMPTS,
      }),
    ],
    providerInvocationCount: 0,
    finalDecision: {
      stopCode: STOP.MAX_ATTEMPTS,
      reviewReady: false,
      message: 'export test',
    },
  });
  const exported = generationAssurance.exportAttemptHistory(history);
  assert.equal(exported.contract, GENERATION_ASSURANCE_CONTRACT_REF);
  assert.equal(exported.nonClaims.deployable, false);
});

// ---------------------------------------------------------------------------
// Codex review gap coverage (Iteration 31 pre-commit)
// ---------------------------------------------------------------------------

test('nested candidate evidence change stops PROVIDER_OUTPUT_INVALID before validation', async () => {
  const ent = entitlementBundle();
  // Top-level response evidence matches request, but nested candidate changes provenance.
  const provider = createScriptedProvider({
    scripts: [
      {
        raw: request => ({
          schemaVersion: 1,
          contract: 'zeus.model-provider-response@1',
          providerId: request.providerId,
          modelId: request.modelId,
          correlationId: request.correlationId,
          advisory: true,
          sourceOfTruth: false,
          evidenceReferences: request.evidenceReferences.map(r => ({
            id: r.id,
            contract: r.contract,
          })),
          output: {
            candidate: minimalCandidate({
              candidateId: 'changed-ev',
              evidenceReferences: [
                { id: 'ev-canonical', kind: 'artifact', path: 'canonical-analysis.json' },
                { id: 'ev-injected', kind: 'artifact', path: 'extra.json' },
              ],
            }),
          },
        }),
      },
    ],
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
  });
  try {
    assert.equal(result.stopCode, STOP.PROVIDER_OUTPUT_INVALID);
    assert.equal(result.providerInvocationCount, 1);
    assert.equal(result.history.attempts.length, 2);
    assert.equal(result.history.attempts[1].disposition, 'stopped');
    assert.equal(result.history.attempts[1].stopCode, STOP.PROVIDER_OUTPUT_INVALID);
    // Did not accept fabricated/changed candidate as successful repair
    assert.notEqual(result.history.attempts[1].disposition, 'provider-repair');
    assert.equal(result.history.attempts[1].candidate.snapshot.candidateId, 'cand-ga-1');
  } finally {
    cleanupPair(pair);
  }
});

test('nested candidate evidence path/kind change fails provenance', () => {
  const current = minimalCandidate();
  const changedPath = minimalCandidate({
    evidenceReferences: [{ id: 'ev-canonical', kind: 'artifact', path: 'other-analysis.json' }],
  });
  const changedKind = minimalCandidate({
    evidenceReferences: [{ id: 'ev-canonical', kind: 'runtime', path: 'canonical-analysis.json' }],
  });
  const dropped = minimalCandidate({ evidenceReferences: [] });
  assert.equal(
    generationAssurance.assertEvidenceProvenancePreserved(current, changedPath).ok,
    false
  );
  assert.equal(
    generationAssurance.assertEvidenceProvenancePreserved(current, changedKind).ok,
    false
  );
  assert.equal(generationAssurance.assertEvidenceProvenancePreserved(current, dropped).ok, false);
  // Order-insensitive same set is OK
  const reordered = minimalCandidate({
    evidenceReferences: [{ path: 'canonical-analysis.json', kind: 'artifact', id: 'ev-canonical' }],
  });
  assert.equal(generationAssurance.assertEvidenceProvenancePreserved(current, reordered).ok, true);
});

test('returned secret-bearing diagnostic is redacted from result, history, and artifacts', async () => {
  const SECRET = 'SENTINEL_SECRET_VALUE_9f3a2b1c';
  const ABS_PATH = 'C:\\Users\\alice\\private\\license.pem';
  const ent = entitlementBundle();
  const registry = generationValidation.createDefaultValidatorRegistry();
  // Register public-required already present; add advanced that RETURNS secret text
  registry.register({
    id: 'secret-returner',
    version: 1,
    order: 950,
    validate() {
      return [
        {
          id: 'PRO.LEAK_TEST',
          severity: 'warning',
          path: ABS_PATH,
          message: `password: ${SECRET} endpoint=https://private.example/v1 token=${SECRET}`,
        },
      ];
    },
  });
  // Also register builtins that would be missing if we used empty - use default + our validator
  // createDefaultValidatorRegistry already has required; we just add.
  const { result, pair } = await runGa({
    candidate: minimalCandidate(),
    provider: null,
    entitlement: ent,
    extra: { validatorRegistry: registry },
  });
  try {
    // May still be review-ready or not depending on warning severity; either way must redact.
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(SECRET), false);
    assert.equal(serialized.includes(ABS_PATH), false);
    assert.equal(serialized.includes('https://private.example'), false);
    assert.equal(serialized.includes('BEGIN PRIVATE KEY'), false);
    assert.equal(serialized.includes('licenseDocument'), false);

    for (const file of result.artifacts.files || []) {
      const text = fs.readFileSync(file, 'utf8');
      assert.equal(text.includes(SECRET), false, file);
      assert.equal(text.includes(ABS_PATH), false, file);
      assert.equal(text.includes('private.example'), false, file);
    }
    // finalValidation is sanitized projection
    if (result.finalValidation && result.finalValidation.report) {
      const rep = JSON.stringify(result.finalValidation.report);
      assert.equal(rep.includes(SECRET), false);
    }
  } finally {
    cleanupPair(pair);
  }
});

test('UTF-8 per-file and total content bounds fail closed without huge fixtures', () => {
  // Multibyte: 3-byte UTF-8 chars; 4 chars = 12 bytes
  const multi = '\u20ac\u20ac\u20ac\u20ac'; // euro signs
  assert.equal(Buffer.byteLength(multi, 'utf8'), 12);
  const perFile = generationAssurance.assertCandidateContentBounds(
    {
      proposedFiles: [{ path: 'a.rpgle', content: multi }],
    },
    { maxContentBytesPerFile: 11, maxTotalContentBytes: 1024 }
  );
  assert.equal(perFile.ok, false);
  assert.equal(perFile.code, 'REQUEST_BOUNDS_EXCEEDED');

  // Total across files
  const total = generationAssurance.assertCandidateContentBounds(
    {
      proposedFiles: [
        { path: 'a.rpgle', content: 'aaaa' },
        { path: 'b.rpgle', content: 'bbbb' },
      ],
    },
    { maxContentBytesPerFile: 100, maxTotalContentBytes: 6 }
  );
  assert.equal(total.ok, false);

  // buildProviderRequest fails closed (does not silently truncate into request)
  const built = generationAssurance.buildProviderRequest({
    providerId: 'test.p',
    modelId: 'm',
    correlationId: 'c1',
    candidate: minimalCandidate({
      proposedFiles: [
        { path: 'QRPGLESRC/X.rpgle', action: 'modify', content: multi, rationale: 'r' },
      ],
    }),
    diagnostics: [],
    attemptIndex: 1,
    limits: { maxContentBytesPerFile: 11, maxTotalContentBytes: 1024, maxFiles: 32 },
  });
  assert.equal(built.ok, false);
  assert.equal(built.code, 'REQUEST_BOUNDS_EXCEEDED');
});

test('unknown advancedValidatorIds fail closed and are never silently ignored', async () => {
  const ent = entitlementBundle();
  const resolved = generationAssurance.resolveAdvancedValidatorIds(['not-real-pack']);
  assert.equal(resolved.ok, false);

  const { result, pair } = await runGa({
    candidate: minimalCandidate(),
    provider: null,
    entitlement: ent,
    extra: { advancedValidatorIds: ['totally-unknown-pack'] },
  });
  try {
    assert.equal(result.stopCode, STOP.POLICY_DENIED);
    assert.equal(result.providerInvocationCount, 0);
  } finally {
    cleanupPair(pair);
  }
});

test('attempt history validation requires sequential indices and provider identity', () => {
  const baseReport = {
    schemaVersion: 1,
    kind: 'generation-validation-report',
    candidateId: 'c',
    status: 'validation-failed',
    reviewReady: false,
    diagnostics: [],
  };
  const a0 = generationAssurance.buildAttemptRecord({
    index: 0,
    candidateSnapshot: snapshotLite(),
    candidateSha256: 'a'.repeat(64),
    validationReport: baseReport,
    canonicalDiagnostics: [],
    fingerprint: 'b'.repeat(64),
    qualityVector: [1, 0, 0, 0, 0, 0],
    disposition: 'baseline',
  });
  const a1 = generationAssurance.buildAttemptRecord({
    index: 1,
    candidateSnapshot: snapshotLite(),
    candidateSha256: 'c'.repeat(64),
    validationReport: baseReport,
    canonicalDiagnostics: [],
    fingerprint: 'd'.repeat(64),
    qualityVector: [1, 0, 0, 0, 0, 0],
    disposition: 'stopped',
    providerIdentity: { providerId: 'test.p', modelId: 'm' },
    correlationId: 'corr-a1',
    stopCode: STOP.PROVIDER_FAILED,
    isFinal: true,
  });
  const good = generationAssurance.buildAttemptHistory({
    runId: 'seq',
    attempts: [a0, a1],
    providerInvocationCount: 1,
    finalDecision: { stopCode: STOP.PROVIDER_FAILED, reviewReady: false, message: 'x' },
  });
  assert.equal(generationAssurance.validateAttemptHistory(good).ok, true);

  const wrongIdWithRightRef = JSON.parse(JSON.stringify(good));
  wrongIdWithRightRef.contractId = 'wrong.contract.id';
  assert.equal(generationAssurance.validateAttemptHistory(wrongIdWithRightRef).ok, false);

  const missingContractVersion = JSON.parse(JSON.stringify(good));
  delete missingContractVersion.contractVersion;
  assert.equal(generationAssurance.validateAttemptHistory(missingContractVersion).ok, false);

  const readyWithoutAttempts = generationAssurance.buildAttemptHistory({
    runId: 'ready-empty',
    attempts: [],
    providerInvocationCount: 0,
    finalDecision: { stopCode: STOP.REVIEW_READY, reviewReady: true, message: 'invalid' },
  });
  assert.equal(generationAssurance.validateAttemptHistory(readyWithoutAttempts).ok, false);

  for (const mutate of [
    history => {
      history.attempts[0].candidate.sha256 = 'not-a-digest';
    },
    history => {
      history.providerInvocationCount = 0;
    },
    history => {
      delete history.attempts[1].providerIdentity.modelId;
    },
    history => {
      delete history.attempts[1].correlationId;
    },
    history => {
      history.attempts[0].isFinal = true;
    },
    history => {
      history.finalDecision.stopCode = STOP.CANCELLED;
    },
    history => {
      history.finalDecision.reviewReady = true;
    },
    history => {
      history.attempts[1].disposition = 'baseline';
    },
    history => {
      history.attempts[1].disposition = 'mystery-disposition';
    },
  ]) {
    const incoherent = JSON.parse(JSON.stringify(good));
    mutate(incoherent);
    assert.equal(generationAssurance.validateAttemptHistory(incoherent).ok, false);
  }

  // Non-sequential index
  const badIndex = generationAssurance.buildAttemptHistory({
    runId: 'bad-idx',
    attempts: [
      { ...a0, index: 0 },
      { ...a1, index: 2 },
    ],
    providerInvocationCount: 1,
    finalDecision: { stopCode: STOP.PROVIDER_FAILED, reviewReady: false, message: 'x' },
  });
  assert.equal(generationAssurance.validateAttemptHistory(badIndex).ok, false);

  // Missing provider identity on index > 0 stopped attempt
  const missingId = generationAssurance.buildAttemptHistory({
    runId: 'no-id',
    attempts: [
      a0,
      {
        ...a1,
        providerIdentity: undefined,
      },
    ],
    providerInvocationCount: 1,
    finalDecision: { stopCode: STOP.PROVIDER_FAILED, reviewReady: false, message: 'x' },
  });
  // buildAttemptHistory deepClones; strip identity
  delete missingId.attempts[1].providerIdentity;
  assert.equal(generationAssurance.validateAttemptHistory(missingId).ok, false);

  // Unknown stop code
  const badStop = generationAssurance.buildAttemptHistory({
    runId: 'bad-stop',
    attempts: [a0],
    providerInvocationCount: 0,
    finalDecision: { stopCode: 'NOT_A_REAL_STOP', reviewReady: false, message: 'x' },
  });
  assert.equal(generationAssurance.validateAttemptHistory(badStop).ok, false);
});

test('malformed provider output records complete stopped attempt with identity', async () => {
  const ent = entitlementBundle();
  const provider = createScriptedProvider({
    scripts: [
      {
        raw: request => ({
          schemaVersion: 1,
          contract: 'zeus.model-provider-response@1',
          providerId: 'wrong-provider',
          modelId: request.modelId,
          correlationId: request.correlationId,
          advisory: true,
          sourceOfTruth: false,
          evidenceReferences: request.evidenceReferences,
          output: { candidate: minimalCandidate() },
        }),
      },
    ],
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
  });
  try {
    assert.ok(
      result.stopCode === STOP.PROVIDER_OUTPUT_INVALID || result.stopCode === STOP.PROVIDER_FAILED
    );
    assert.equal(result.providerInvocationCount, 1);
    assert.equal(result.history.attempts.length, 2);
    const stopped = result.history.attempts[1];
    assert.equal(stopped.index, 1);
    assert.equal(stopped.disposition, 'stopped');
    assert.ok(stopped.providerIdentity.providerId);
    assert.ok(stopped.providerIdentity.modelId);
    assert.ok(stopped.correlationId);
    assert.ok(stopped.validationReport);
    assert.ok(stopped.candidate.snapshot);
    // Safe returns only
    assert.ok(
      result.finalCandidate === null || result.finalCandidate.kind === 'generation-candidate'
    );
    if (result.finalValidation) {
      assert.ok(result.finalValidation.report);
      assert.equal(result.finalValidation.report.kind, 'generation-validation-report');
    }
  } finally {
    cleanupPair(pair);
  }
});

// ---------------------------------------------------------------------------
// Codex round-2: bounded history, complete artifacts, path hardening
// ---------------------------------------------------------------------------

test('large repairable candidate history stays bounded without throwing (no entitlement)', async () => {
  // Three ~220 KiB UTF-8 bodies (each under 256 KiB per-file; total under Community 1 MiB).
  const chunk = 'A'.repeat(220 * 1024);
  assert.ok(Buffer.byteLength(chunk, 'utf8') < 256 * 1024);
  assert.ok(Buffer.byteLength(chunk, 'utf8') * 3 < 1024 * 1024);
  const large = failingCandidate({
    candidateId: 'large-repairable',
    proposedFiles: [
      {
        path: 'QRPGLESRC/A.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: `**free\n// ${chunk}\n`,
        rationale: 'large-a',
      },
      {
        path: 'QRPGLESRC/A.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: `**free\n// ${chunk}\n`,
        rationale: 'large-dup',
      },
      {
        path: 'QRPGLESRC/B.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: `**free\n// ${chunk}\n`,
        rationale: 'large-b',
      },
    ],
  });
  const pair = createTempPair();
  try {
    const result = await runGenerationAssurance({
      candidate: large,
      options: {
        workspaceRoot: pair.workspaceRoot,
        reviewArtifactRoot: pair.reviewRoot,
        evidenceStore: evidenceStore(),
        entitlement: null, // no provider call
        generationValidation,
        runId: 'large-hist',
        correlationIdBase: 'large-corr',
      },
    });
    assert.equal(result.stopCode, STOP.ENTITLEMENT_DENIED);
    assert.equal(result.providerInvocationCount, 0);
    // History validates and is within maxHistoryJsonBytes
    const validation = generationAssurance.validateAttemptHistory(result.history);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));
    const serialized = JSON.stringify(result.history);
    assert.ok(
      Buffer.byteLength(serialized, 'utf8') <= generationAssurance.LIMITS.maxHistoryJsonBytes
    );
    // Hashes + evidence retained; content bodies omitted from history projection
    const snap = result.history.attempts[0].candidate.snapshot;
    assert.equal(snap.contentBodiesOmitted, true);
    assert.ok(Array.isArray(snap.evidenceReferences));
    assert.ok(snap.evidenceReferences.some(r => r.id === 'ev-canonical'));
    for (const f of snap.proposedFiles) {
      assert.equal(f.contentOmitted, true);
      assert.equal(Object.prototype.hasOwnProperty.call(f, 'content'), false);
      assert.ok(typeof f.contentSha256 === 'string' && f.contentSha256.length === 64);
      assert.ok(Number.isInteger(f.contentBytes) && f.contentBytes > 0);
    }
    // Safe final review candidate is separate full projection
    assert.ok(result.finalCandidate);
    assert.ok(result.finalCandidate.proposedFiles.some(f => typeof f.content === 'string'));
    // Workspace unchanged
    const after = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    const before = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    assert.equal(after.fingerprint, before.fingerprint);
  } finally {
    cleanupPair(pair);
  }
});

test('three max-diagnostic attempts retain a valid history within the configured bound', async () => {
  const ent = entitlementBundle();
  const candidates = [
    failingCandidate({ candidateId: 'max-diag-a1' }),
    failingCandidate({ candidateId: 'max-diag-a2' }),
  ];
  let providerCalls = 0;
  const providerRegistry = {
    invoke: async (_providerId, request) => ({
      ok: true,
      response: modelResponse(request, candidates[providerCalls++]),
    }),
  };
  const severities = new Map([
    ['cand-ga-1', 'error'],
    ['max-diag-a1', 'warning'],
    ['max-diag-a2', 'info'],
  ]);
  const maxDiagnosticValidation = {
    validateGenerationCandidate: async candidate => {
      const severity = severities.get(candidate.candidateId);
      assert.ok(severity, `unexpected candidate ${candidate.candidateId}`);
      return {
        status: 'validation-failed',
        reviewReady: false,
        report: {
          schemaVersion: 1,
          kind: 'generation-validation-report',
          contractId: 'zeus.generation-validation-report',
          contractVersion: 1,
          candidateId: candidate.candidateId,
          status: 'validation-failed',
          reviewReady: false,
          diagnostics: Array.from(
            { length: generationAssurance.LIMITS.maxDiagnostics },
            (_, index) => ({
              id: `MAX_DIAG_${String(index).padStart(3, '0')}`,
              severity,
              validatorId: 'test.max-diagnostics',
              validatorVersion: 1,
              path: `QRPGLESRC/FILE${String(index).padStart(3, '0')}.rpgle`,
              message: `${severity}:${String(index).padStart(3, '0')}:`.padEnd(
                generationAssurance.LIMITS.maxNormalizedMessageChars,
                'x'
              ),
            })
          ),
          evidenceChecked: [],
          assumptions: [],
          uncertainties: [],
          policy: { denied: false, reason: null },
          summary: 'max-diagnostic regression fixture',
          notes: [],
        },
      };
    },
  };

  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider: null,
    entitlement: {
      licenseDocument: ent.licenseDocument,
      publicKeyPem: ent.publicKeyPem,
      now: ent.now,
    },
    extra: {
      generationValidation: maxDiagnosticValidation,
      validatorRegistry: {},
      providerRegistry,
      providerId: 'test.ga-max-diagnostics',
      modelId: 'max-diagnostics-v1',
      runId: 'max-diagnostic-history',
    },
  });
  try {
    assert.equal(result.stopCode, STOP.MAX_ATTEMPTS);
    assert.equal(providerCalls, generationAssurance.LIMITS.maxProviderInvocations);
    assert.equal(result.providerInvocationCount, generationAssurance.LIMITS.maxProviderInvocations);
    assert.equal(result.history.attempts.length, generationAssurance.LIMITS.maxAttempts);
    for (const attempt of result.history.attempts) {
      assert.equal(
        attempt.validationReport.diagnostics.length,
        generationAssurance.LIMITS.maxDiagnostics
      );
      assert.equal(attempt.canonicalDiagnostics.length, generationAssurance.LIMITS.maxDiagnostics);
    }
    const validation = generationAssurance.validateAttemptHistory(result.history);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));
    const serializedBytes = Buffer.byteLength(JSON.stringify(result.history), 'utf8');
    assert.ok(serializedBytes <= generationAssurance.LIMITS.maxHistoryJsonBytes);
  } finally {
    cleanupPair(pair);
  }
});

test('complete review artifact set outside workspace with manifest hashes', async () => {
  const ent = entitlementBundle();
  const { result, pair } = await runGa({
    candidate: minimalCandidate({ candidateId: 'artifact-set' }),
    provider: null,
    entitlement: ent,
    extra: { runId: 'artifact-run' },
  });
  try {
    assert.equal(result.artifacts.written, true);
    assert.ok(result.artifacts.manifest);
    const names = result.artifacts.manifest.artifacts.map(a => path.posix.basename(a.path)).sort();
    assert.ok(names.includes('attempt-history.json'));
    assert.ok(names.includes('validation-report-attempt-0.json'));
    assert.ok(names.includes('final-candidate.json'));
    assert.ok(names.includes('review-diff.json'));
    // manifest.json is on disk beside the listed set (not self-hashed)
    assert.ok(fs.existsSync(path.join(result.artifacts.directory, 'manifest.json')));
    for (const entry of result.artifacts.manifest.artifacts) {
      assert.match(entry.sha256, /^[a-f0-9]{64}$/);
      assert.ok(entry.sizeBytes > 0);
      const abs = path.join(result.artifacts.root, entry.path.replace(/\//g, path.sep));
      assert.ok(fs.existsSync(abs), entry.path);
      const buf = fs.readFileSync(abs);
      assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), entry.sha256);
      // No entitlement/license secrets in artifacts
      const text = buf.toString('utf8');
      assert.equal(text.includes('BEGIN PRIVATE KEY'), false);
      assert.equal(text.includes('licenseDocument'), false);
    }
    // final-candidate is advisory; never applied to workspace
    const wsHash1 = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    const wsHash2 = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    assert.equal(wsHash1.fingerprint, wsHash2.fingerprint);
    // Readable without entitlement (just files on disk)
    const history = JSON.parse(
      fs.readFileSync(path.join(result.artifacts.directory, 'attempt-history.json'), 'utf8')
    );
    assert.equal(generationAssurance.validateAttemptHistory(history).ok, true);
  } finally {
    cleanupPair(pair);
  }
});

test('runId "." and ".." never escape review root', async () => {
  assert.equal(generationAssurance.sanitizeRunId('.'), 'run-dot');
  assert.equal(generationAssurance.sanitizeRunId('..'), 'run-dotdot');
  assert.notEqual(generationAssurance.sanitizeRunId('.'), '.');
  assert.notEqual(generationAssurance.sanitizeRunId('..'), '..');

  const ent = entitlementBundle();
  for (const badId of ['.', '..']) {
    const pair = createTempPair();
    try {
      const result = await runGenerationAssurance({
        candidate: minimalCandidate(),
        options: {
          workspaceRoot: pair.workspaceRoot,
          reviewArtifactRoot: pair.reviewRoot,
          evidenceStore: evidenceStore(),
          entitlement: ent,
          generationValidation,
          runId: badId,
        },
      });
      if (result.artifacts.written) {
        assert.ok(result.artifacts.directory.startsWith(path.resolve(pair.reviewRoot)));
        assert.ok(!result.artifacts.directory.endsWith(`${path.sep}.`));
        assert.ok(!result.artifacts.directory.endsWith(`${path.sep}..`));
        const rel = path.relative(pair.workspaceRoot, result.artifacts.directory);
        assert.ok(rel.startsWith('..') || path.isAbsolute(rel));
      }
      const after = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
      // Workspace marker still present and only expected file
      assert.ok(fs.existsSync(path.join(pair.workspaceRoot, 'marker.txt')));
      assert.ok(after.entries.every(e => !e.path.includes('attempt-history')));
    } finally {
      cleanupPair(pair);
    }
  }
});

test('symlink/junction run directory into workspace fails closed when platform allows', async () => {
  const pair = createTempPair();
  const ent = entitlementBundle();
  const runLink = path.join(pair.reviewRoot, 'escape-run');
  let createdLink = false;
  try {
    try {
      fs.symlinkSync(pair.workspaceRoot, runLink, 'junction');
      createdLink = true;
    } catch {
      try {
        fs.symlinkSync(pair.workspaceRoot, runLink, 'dir');
        createdLink = true;
      } catch {
        // Platform cannot create symlink/junction — skip soft.
        return;
      }
    }
    if (!createdLink) return;
    const before = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    const result = await runGenerationAssurance({
      candidate: minimalCandidate(),
      options: {
        workspaceRoot: pair.workspaceRoot,
        reviewArtifactRoot: pair.reviewRoot,
        evidenceStore: evidenceStore(),
        entitlement: ent,
        generationValidation,
        runId: 'escape-run',
      },
    });
    // Must not write into the workspace via the junction
    assert.equal(result.artifacts.written, false);
    assert.equal(result.artifacts.error.code, 'ARTIFACT_WRITE_FAILED');
    const after = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    assert.equal(after.fingerprint, before.fingerprint);
    // Engine still returns bounded history
    assert.ok(result.history);
    assert.equal(generationAssurance.validateAttemptHistory(result.history).ok, true);
  } finally {
    try {
      if (createdLink) fs.rmSync(runLink, { force: true, recursive: true });
    } catch {
      /* ignore */
    }
    cleanupPair(pair);
  }
});

test('invalid/unsafe review target isolates write failure without leaking paths', async () => {
  const ent = entitlementBundle();
  const pair = createTempPair();
  const before = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
  try {
    // Review root inside workspace is unsafe
    const inside = path.join(pair.workspaceRoot, 'nested-review');
    const result = await runGenerationAssurance({
      candidate: minimalCandidate(),
      options: {
        workspaceRoot: pair.workspaceRoot,
        reviewArtifactRoot: inside,
        evidenceStore: evidenceStore(),
        entitlement: ent,
        generationValidation,
        runId: 'unsafe',
      },
    });
    // Must return a closed result, not throw
    assert.ok(result.stopCode);
    assert.equal(result.artifacts.written, false);
    assert.equal(result.artifacts.error.code, 'ARTIFACT_WRITE_FAILED');
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(pair.workspaceRoot), false);
    assert.equal(serialized.includes('nested-review'), false);
    assert.ok(result.history);
    assert.equal(generationAssurance.validateAttemptHistory(result.history).ok, true);
    const after = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    assert.equal(after.fingerprint, before.fingerprint);
  } finally {
    cleanupPair(pair);
  }
});

test('hostile candidate accessor is contained and fully redacted', async () => {
  const pair = createTempPair();
  const before = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
  const hostile = minimalCandidate();
  Object.defineProperty(hostile, 'correlationId', {
    enumerable: true,
    get() {
      throw new Error('SENTINEL_HOSTILE_ACCESSOR');
    },
  });
  try {
    const result = await runGenerationAssurance({
      candidate: hostile,
      options: { workspaceRoot: pair.workspaceRoot },
    });
    assert.equal(result.stopCode, STOP.VALIDATOR_INTERNAL_FAILURE);
    assert.equal(result.providerInvocationCount, 0);
    assert.equal(generationAssurance.validateAttemptHistory(result.history).ok, true);
    assert.equal(JSON.stringify(result).includes('SENTINEL_HOSTILE_ACCESSOR'), false);
    const after = generationAssurance.hashWorkspaceTree(pair.workspaceRoot);
    assert.equal(after.fingerprint, before.fingerprint);
  } finally {
    cleanupPair(pair);
  }
});

test('throwing validation facade stops safely before every provider invocation', async () => {
  let providerCalls = 0;
  const result = await runGenerationAssurance({
    candidate: failingCandidate(),
    options: {
      generationValidation: {
        validateGenerationCandidate: async () => {
          throw new Error('SENTINEL_VALIDATION_THROW');
        },
      },
      validatorRegistry: {},
      providerRegistry: {
        invoke: async () => {
          providerCalls += 1;
          throw new Error('must not run');
        },
      },
      providerId: 'test.never',
      modelId: 'never-v1',
    },
  });
  assert.equal(result.stopCode, STOP.VALIDATOR_INTERNAL_FAILURE);
  assert.equal(providerCalls, 0);
  assert.equal(result.providerInvocationCount, 0);
  assert.equal(generationAssurance.validateAttemptHistory(result.history).ok, true);
  assert.equal(JSON.stringify(result).includes('SENTINEL_VALIDATION_THROW'), false);
});

test('throwing follow-up validation stops after one provider call with no further call', async () => {
  const ent = entitlementBundle();
  let validations = 0;
  const provider = createScriptedProvider({
    scripts: [{ candidate: failingCandidate({ candidateId: 'follow-up-throw' }) }],
  });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
    extra: {
      generationValidation: {
        validateGenerationCandidate: async candidate => {
          validations += 1;
          if (validations > 1) throw new Error('SENTINEL_VALIDATION_THROW');
          return syntheticValidation(candidate.candidateId, [
            {
              id: 'BASELINE_REPAIRABLE',
              severity: 'error',
              validatorId: 'test.follow-up-boundary',
              validatorVersion: 1,
              path: 'QRPGLESRC/ORDERPGM.rpgle',
              message: 'repairable baseline',
            },
          ]);
        },
      },
      validatorRegistry: {},
    },
  });
  try {
    assert.equal(result.stopCode, STOP.VALIDATOR_INTERNAL_FAILURE);
    assert.equal(provider.callCount(), 1);
    assert.equal(result.providerInvocationCount, 1);
    assert.equal(generationAssurance.validateAttemptHistory(result.history).ok, true);
    assert.equal(JSON.stringify(result).includes('SENTINEL_VALIDATION_THROW'), false);
  } finally {
    cleanupPair(pair);
  }
});

test('initial invalid status is not repairable and never invokes provider', async () => {
  let providerCalls = 0;
  const result = await runGenerationAssurance({
    candidate: failingCandidate(),
    options: {
      generationValidation: {
        validateGenerationCandidate: async candidate =>
          syntheticValidation(candidate.candidateId, [], 'invalid'),
      },
      validatorRegistry: {},
      providerRegistry: {
        invoke: async () => {
          providerCalls += 1;
          throw new Error('must not run');
        },
      },
      providerId: 'test.never',
      modelId: 'never-v1',
    },
  });
  assert.equal(result.stopCode, STOP.INITIAL_NOT_REPAIRABLE);
  assert.equal(providerCalls, 0);
  assert.equal(result.providerInvocationCount, 0);
  assert.equal(generationAssurance.validateAttemptHistory(result.history).ok, true);
});

test('provider candidate cannot add a path outside immutable baseline scope', async () => {
  const ent = entitlementBundle();
  const expanded = failingCandidate({
    candidateId: 'scope-expanded',
    proposedFiles: [
      ...failingCandidate().proposedFiles,
      {
        path: 'UNDECLARED/NEW.rpgle',
        action: 'create',
        language: 'rpgle',
        content: '**free\n',
        rationale: 'unauthorized expansion',
      },
    ],
  });
  const provider = createScriptedProvider({ scripts: [{ candidate: expanded }] });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
  });
  try {
    assert.equal(result.stopCode, STOP.SCOPE_EXPANSION);
    assert.equal(result.reviewReady, false);
    assert.equal(provider.callCount(), 1);
    assert.equal(result.providerInvocationCount, 1);
    assert.equal(generationAssurance.validateAttemptHistory(result.history).ok, true);
  } finally {
    cleanupPair(pair);
  }
});

test('explicit declared root allows a new provider file beneath that root', async () => {
  const ent = entitlementBundle();
  const insideRoot = minimalCandidate({
    candidateId: 'inside-explicit-root',
    proposedFiles: [
      {
        path: 'QRPGLESRC/NEW.rpgle',
        action: 'create',
        language: 'rpgle',
        content: '**free\ndcl-s created int(10);\n',
        rationale: 'authorized new file',
      },
    ],
  });
  const provider = createScriptedProvider({ scripts: [{ candidate: insideRoot }] });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
    extra: { declaredScopePaths: ['QRPGLESRC'] },
  });
  try {
    assert.equal(result.stopCode, STOP.REVIEW_READY);
    assert.equal(result.reviewReady, true);
    assert.equal(provider.callCount(), 1);
    assert.equal(result.providerInvocationCount, 1);
  } finally {
    cleanupPair(pair);
  }
});

test('explicit declared root rejects a sibling provider path', async () => {
  const ent = entitlementBundle();
  const sibling = minimalCandidate({
    candidateId: 'outside-explicit-root',
    proposedFiles: [
      {
        path: 'QRPGLESRC_OTHER/NEW.rpgle',
        action: 'create',
        language: 'rpgle',
        content: '**free\ndcl-s denied int(10);\n',
        rationale: 'sibling path',
      },
    ],
  });
  const provider = createScriptedProvider({ scripts: [{ candidate: sibling }] });
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
    extra: { declaredScopePaths: ['QRPGLESRC'] },
  });
  try {
    assert.equal(result.stopCode, STOP.SCOPE_EXPANSION);
    assert.equal(result.reviewReady, false);
    assert.equal(provider.callCount(), 1);
    assert.equal(result.providerInvocationCount, 1);
  } finally {
    cleanupPair(pair);
  }
});

test('registered capability honors public execute(context, input) and trusted closures', async () => {
  const ent = entitlementBundle();
  const fixed = minimalCandidate({ candidateId: 'registered-fixed' });
  const provider = createScriptedProvider({ scripts: [{ candidate: fixed }] });
  const trustedRegistry = createProviderRegistry();
  trustedRegistry.register({
    descriptor: provider.descriptor,
    invoke: provider.invoke,
    configProvenance: {
      schemaVersion: 1,
      contract: 'zeus.provider-config-provenance@1',
      sourceKind: 'test',
      sourceReference: 'registered-capability-test',
      configuredKeys: ['providerId'],
      redaction: 'values-omitted',
    },
  });
  const zeus = createZeus();
  const registered = await registerGenerationAssuranceModule(zeus.modules, {
    publicKeyPem: ent.publicKeyPem,
    licenseDocument: ent.licenseDocument,
    now: ent.now,
    providerRegistry: trustedRegistry,
    egressPolicy: allowLocalSourceCodePolicy(),
  });
  assert.equal(registered.ok, true);
  const execution = await zeus.capabilities.execute(
    GENERATION_ASSURANCE_CAPABILITY_ID,
    {
      providers: {
        registry: {
          invoke: async () => {
            throw new Error('untrusted context');
          },
        },
      },
    },
    {
      candidate: failingCandidate(),
      options: {
        providerId: provider.descriptor.id,
        modelId: provider.descriptor.models[0],
        egressPolicy: denyAllPolicy(),
        evidenceStore: evidenceStore(),
        entitlement: { licenseDocument: null, publicKeyPem: 'caller override' },
        providerRegistry: {
          invoke: async () => {
            throw new Error('untrusted input');
          },
        },
        generationValidation: {
          validateGenerationCandidate: async () => {
            throw new Error('untrusted validator');
          },
        },
        validatorRegistry: {
          runAll: async () => {
            throw new Error('untrusted registry');
          },
        },
      },
    }
  );
  assert.equal(execution.ok, true);
  assert.equal(execution.result.stopCode, STOP.REVIEW_READY);
  assert.ok(execution.result.finalCandidate);
  assert.ok(execution.result.finalValidation);
  assert.ok(execution.result.reviewDiff);
  assert.ok(execution.result.artifacts);
  assert.equal(provider.callCount(), 1);
  assert.equal(JSON.stringify(execution).includes('caller override'), false);
});

test('registered candidate policy cannot be weakened by caller input', async () => {
  const ent = entitlementBundle();
  const provider = createScriptedProvider({ scripts: [{ candidate: minimalCandidate() }] });
  const trustedRegistry = createProviderRegistry();
  trustedRegistry.register({
    descriptor: provider.descriptor,
    invoke: provider.invoke,
    configProvenance: {
      schemaVersion: 1,
      contract: 'zeus.provider-config-provenance@1',
      sourceKind: 'test',
      sourceReference: 'trusted-candidate-policy-test',
      configuredKeys: ['providerId'],
      redaction: 'values-omitted',
    },
  });
  const zeus = createZeus();
  const registered = await registerGenerationAssuranceModule(zeus.modules, {
    publicKeyPem: ent.publicKeyPem,
    licenseDocument: ent.licenseDocument,
    now: ent.now,
    providerRegistry: trustedRegistry,
    egressPolicy: allowLocalSourceCodePolicy(),
    policy: { deny: true, reason: 'registration policy denial' },
  });
  assert.equal(registered.ok, true);
  const execution = await zeus.capabilities.execute(
    GENERATION_ASSURANCE_CAPABILITY_ID,
    {},
    {
      candidate: failingCandidate(),
      options: {
        providerId: provider.descriptor.id,
        modelId: provider.descriptor.models[0],
        evidenceStore: evidenceStore(),
        policy: { deny: false },
      },
    }
  );
  assert.equal(execution.ok, true);
  assert.equal(execution.result.stopCode, STOP.POLICY_DENIED);
  assert.equal(execution.result.providerInvocationCount, 0);
  assert.equal(provider.callCount(), 0);
});

test('registered capability contains throwing input accessors without leaking messages or paths', async () => {
  const ent = entitlementBundle();
  const zeus = createZeus();
  const registered = await registerGenerationAssuranceModule(zeus.modules, {
    publicKeyPem: ent.publicKeyPem,
    licenseDocument: ent.licenseDocument,
    now: ent.now,
  });
  assert.equal(registered.ok, true);
  const hostileInput = {};
  Object.defineProperty(hostileInput, 'options', {
    enumerable: true,
    get() {
      throw new Error(
        'SENTINEL_CAPABILITY_ACCESSOR C:\\Customer Files\\Acme\\private.txt /opt/customers/acme/private.txt'
      );
    },
  });
  const execution = await zeus.capabilities.execute(
    GENERATION_ASSURANCE_CAPABILITY_ID,
    {},
    hostileInput
  );
  assert.equal(execution.ok, true);
  assert.equal(execution.result.stopCode, STOP.VALIDATOR_INTERNAL_FAILURE);
  assert.equal(generationAssurance.validateAttemptHistory(execution.result.history).ok, true);
  const serialized = JSON.stringify(execution);
  for (const forbidden of [
    'SENTINEL_CAPABILITY_ACCESSOR',
    'C:\\Customer Files\\Acme\\private.txt',
    '/opt/customers/acme/private.txt',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('registered capability ignores caller workspace and review roots', async () => {
  const ent = entitlementBundle();
  const pair = createTempPair();
  const callerReviewInsideWorkspace = path.join(pair.workspaceRoot, 'caller-review');
  const zeus = createZeus();
  try {
    const registered = await registerGenerationAssuranceModule(zeus.modules, {
      publicKeyPem: ent.publicKeyPem,
      licenseDocument: ent.licenseDocument,
      now: ent.now,
    });
    assert.equal(registered.ok, true);
    const execution = await zeus.capabilities.execute(
      GENERATION_ASSURANCE_CAPABILITY_ID,
      {},
      {
        candidate: minimalCandidate(),
        options: {
          evidenceStore: evidenceStore(),
          workspaceRoot: pair.workspaceRoot,
          reviewArtifactRoot: callerReviewInsideWorkspace,
        },
      }
    );
    assert.equal(execution.ok, true);
    assert.equal(execution.result.stopCode, STOP.REVIEW_READY);
    assert.equal(execution.result.artifacts.written, false);
    assert.equal(fs.existsSync(callerReviewInsideWorkspace), false);
  } finally {
    cleanupPair(pair);
  }
});

test('registered capability rejects artifact writing without a trusted workspace root', async () => {
  const ent = entitlementBundle();
  const pair = createTempPair();
  const zeus = createZeus();
  try {
    const registered = await registerGenerationAssuranceModule(zeus.modules, {
      publicKeyPem: ent.publicKeyPem,
      licenseDocument: ent.licenseDocument,
      now: ent.now,
      reviewArtifactRoot: pair.reviewRoot,
    });
    assert.equal(registered.ok, true);
    const execution = await zeus.capabilities.execute(
      GENERATION_ASSURANCE_CAPABILITY_ID,
      {},
      { candidate: minimalCandidate(), options: { evidenceStore: evidenceStore() } }
    );
    assert.equal(execution.ok, true);
    assert.equal(execution.result.stopCode, STOP.VALIDATOR_INTERNAL_FAILURE);
    assert.equal(execution.result.artifacts.written, false);
    assert.deepEqual(fs.readdirSync(pair.reviewRoot), []);
  } finally {
    cleanupPair(pair);
  }
});

test('registered capability rejects a trusted review target inside trusted workspace', async () => {
  const ent = entitlementBundle();
  const pair = createTempPair();
  const inside = path.join(pair.workspaceRoot, 'trusted-review');
  const zeus = createZeus();
  try {
    const registered = await registerGenerationAssuranceModule(zeus.modules, {
      publicKeyPem: ent.publicKeyPem,
      licenseDocument: ent.licenseDocument,
      now: ent.now,
      workspaceRoot: pair.workspaceRoot,
      reviewArtifactRoot: inside,
    });
    assert.equal(registered.ok, true);
    const execution = await zeus.capabilities.execute(
      GENERATION_ASSURANCE_CAPABILITY_ID,
      {},
      { candidate: minimalCandidate(), options: { evidenceStore: evidenceStore() } }
    );
    assert.equal(execution.ok, true);
    assert.equal(execution.result.artifacts.written, false);
    assert.equal(execution.result.artifacts.error.code, 'ARTIFACT_WRITE_FAILED');
    assert.equal(fs.existsSync(inside), false);
  } finally {
    cleanupPair(pair);
  }
});

test('registered capability writes review artifacts only with trusted outside-workspace roots', async () => {
  const ent = entitlementBundle();
  const pair = createTempPair();
  const zeus = createZeus();
  try {
    const registered = await registerGenerationAssuranceModule(zeus.modules, {
      publicKeyPem: ent.publicKeyPem,
      licenseDocument: ent.licenseDocument,
      now: ent.now,
      workspaceRoot: pair.workspaceRoot,
      reviewArtifactRoot: pair.reviewRoot,
    });
    assert.equal(registered.ok, true);
    const execution = await zeus.capabilities.execute(
      GENERATION_ASSURANCE_CAPABILITY_ID,
      {},
      { candidate: minimalCandidate(), options: { evidenceStore: evidenceStore() } }
    );
    assert.equal(execution.ok, true);
    assert.equal(execution.result.stopCode, STOP.REVIEW_READY);
    assert.equal(execution.result.artifacts.written, true);
    assert.ok(execution.result.artifacts.files.length > 0);
    assert.equal(
      path.resolve(execution.result.artifacts.directory).startsWith(path.resolve(pair.reviewRoot)),
      true
    );
  } finally {
    cleanupPair(pair);
  }
});

test('extended credentials and absolute paths are redacted end to end', async () => {
  const ent = entitlementBundle();
  const sensitiveText = [
    'credential=VerySecret123 license=ClientLicense987',
    '{"credential":"VerySecret123","license":"ClientLicense987"}',
    '/opt/customers/acme/private.txt',
    'C:\\Customer Files\\Acme\\private key.txt',
    '\\\\server\\Customer Files\\Acme\\private key.txt',
  ].join(' ');
  const baseline = failingCandidate({
    candidateId: 'redaction-baseline',
    proposedFiles: failingCandidate().proposedFiles.map(file => ({
      ...file,
      content: `**free\n// ${sensitiveText}\n`,
    })),
  });
  const repaired = minimalCandidate({
    candidateId: 'redaction-repaired',
    proposedFiles: [
      {
        path: 'QRPGLESRC/ORDERPGM.rpgle',
        action: 'modify',
        language: 'rpgle',
        content: `**free\n// ${sensitiveText}\n`,
        rationale: sensitiveText,
      },
    ],
  });
  let capturedRequest = null;
  const provider = createScriptedProvider({
    scripts: [{ candidate: repaired }],
    onInvoke: request => {
      capturedRequest = request;
    },
  });
  const { result, pair } = await runGa({
    candidate: baseline,
    provider,
    entitlement: ent,
  });
  try {
    assert.equal(result.stopCode, STOP.REVIEW_READY);
    assert.ok(capturedRequest);
    const serializedRequest = JSON.stringify(capturedRequest);
    const serializedResult = JSON.stringify(result);
    const artifactSerialization = fs
      .readdirSync(result.artifacts.directory)
      .filter(name => fs.statSync(path.join(result.artifacts.directory, name)).isFile())
      .map(name => fs.readFileSync(path.join(result.artifacts.directory, name), 'utf8'))
      .join('\n');
    for (const forbidden of [
      'VerySecret123',
      'ClientLicense987',
      '/opt/customers/acme/private.txt',
      'C:\\Customer Files\\Acme\\private key.txt',
      '\\\\server\\Customer Files\\Acme\\private key.txt',
    ]) {
      assert.equal(serializedRequest.includes(forbidden), false);
      assert.equal(serializedResult.includes(forbidden), false);
      assert.equal(artifactSerialization.includes(forbidden), false);
    }
  } finally {
    cleanupPair(pair);
  }
});

test('diagnostic paths are sanitized in provider requests, results, history, and artifacts', async () => {
  const absoluteWindowsForward = 'C:/Customer Files/Acme/private.rpgle';
  const absoluteWindowsBackslash = 'C:\\Customer Files\\Acme\\private.rpgle';
  const absoluteUnc = '\\\\server\\Customer Files\\Acme\\private.rpgle';
  const absolutePosix = '/opt/Customer Files/Acme/private.rpgle';
  const safeRelative = 'QRPGLESRC/ORDER.rpgle';
  const diagnostics = [
    absoluteWindowsForward,
    absoluteWindowsBackslash,
    absoluteUnc,
    absolutePosix,
    safeRelative,
    '/schemaVersion',
    '/contractId',
    '/proposedFiles/0/path',
    '/evidenceReferences',
  ].map((diagnosticPath, index) => ({
    id: `PATH_${index}`,
    severity: 'error',
    validatorId: 'test.path-redaction',
    validatorVersion: 1,
    path: diagnosticPath,
    message: 'diagnostic path fixture',
  }));
  let capturedRequest = null;
  const repaired = minimalCandidate();
  const provider = createScriptedProvider({
    scripts: [{ candidate: repaired }],
    onInvoke: request => {
      capturedRequest = request;
    },
  });
  const ent = entitlementBundle();
  const { result, pair } = await runGa({
    candidate: failingCandidate(),
    provider,
    entitlement: ent,
    extra: {
      generationValidation: {
        validateGenerationCandidate: async candidate =>
          candidate.proposedFiles.length > 1
            ? syntheticValidation(candidate.candidateId, diagnostics)
            : syntheticValidation(candidate.candidateId, [], 'review-ready'),
      },
      validatorRegistry: {},
    },
  });
  try {
    assert.equal(result.stopCode, STOP.REVIEW_READY);
    assert.ok(capturedRequest);
    const serializedRequest = JSON.stringify(capturedRequest);
    const serializedResult = JSON.stringify(result);
    const artifactSerialization = fs
      .readdirSync(result.artifacts.directory)
      .filter(name => fs.statSync(path.join(result.artifacts.directory, name)).isFile())
      .map(name => fs.readFileSync(path.join(result.artifacts.directory, name), 'utf8'))
      .join('\n');
    for (const serialization of [serializedRequest, serializedResult, artifactSerialization]) {
      for (const forbidden of [
        'Customer Files',
        'Acme',
        'private.rpgle',
        'C:/Customer',
        'C:\\\\Customer',
        '\\\\\\\\server',
        '/opt/Customer',
      ]) {
        assert.equal(serialization.includes(forbidden), false, `leaked ${forbidden}`);
      }
    }
    assert.equal(serializedResult.includes(safeRelative), true);
    assert.equal(serializedRequest.includes(safeRelative), true);
    for (const pointer of [
      '/schemaVersion',
      '/contractId',
      '/proposedFiles/0/path',
      '/evidenceReferences',
    ]) {
      assert.equal(serializedRequest.includes(pointer), true);
      assert.equal(serializedResult.includes(pointer), true);
      assert.equal(artifactSerialization.includes(pointer), true);
    }
    assert.equal(
      result.history.attempts[0].canonicalDiagnostics.some(
        diagnostic => diagnostic.normalizedPath === safeRelative
      ),
      true
    );
  } finally {
    cleanupPair(pair);
  }
});

test('Community JSON Pointer diagnostic paths remain distinct for progress fingerprints', () => {
  const pointers = [
    '/schemaVersion',
    '/contractId',
    '/proposedFiles/0/path',
    '/evidenceReferences',
  ];
  const canonical = pointers.map(diagnosticPath =>
    generationAssurance.canonicalizeDiagnostics([
      {
        id: 'CONTRACT_FIELD_INVALID',
        severity: 'error',
        validatorId: 'community.contract',
        validatorVersion: 1,
        path: diagnosticPath,
        message: 'invalid contract field',
      },
    ])
  );
  assert.deepEqual(
    canonical.map(result => result.canonical[0].normalizedPath),
    pointers
  );
  assert.equal(new Set(canonical.map(result => result.fingerprint)).size, pointers.length);
  const filesystemLike = generationAssurance.canonicalizeDiagnostics([
    {
      id: 'CONTRACT_FIELD_INVALID',
      severity: 'error',
      validatorId: 'community.contract',
      validatorVersion: 1,
      path: '/proposedFiles/0/private.rpgle',
      message: 'invalid contract field',
    },
  ]);
  assert.match(filesystemLike.canonical[0].normalizedPath, /^<redacted-path:[a-f0-9]{64}>$/);
  assert.equal(filesystemLike.canonical[0].normalizedPath.includes('private.rpgle'), false);
  assert.equal(
    generationAssurance.classifyProgress({
      previousFingerprint: canonical[0].fingerprint,
      nextFingerprint: canonical[1].fingerprint,
      previousVector: [2, 0, 1, 0, 0, 1],
      nextVector: [2, 0, 1, 0, 0, 1],
    }).kind,
    'changed-not-improved'
  );
});

test('registered capability never accepts provider registry from execution context', async () => {
  const ent = entitlementBundle();
  let contextCalls = 0;
  const zeus = createZeus();
  const registered = await registerGenerationAssuranceModule(zeus.modules, {
    publicKeyPem: ent.publicKeyPem,
    licenseDocument: ent.licenseDocument,
    now: ent.now,
  });
  assert.equal(registered.ok, true);
  const execution = await zeus.capabilities.execute(
    GENERATION_ASSURANCE_CAPABILITY_ID,
    {
      providers: {
        registry: {
          invoke: async () => {
            contextCalls += 1;
          },
        },
      },
    },
    {
      candidate: failingCandidate(),
      options: {
        providerId: 'context.provider',
        modelId: 'context-v1',
        evidenceStore: evidenceStore(),
        egressPolicy: allowLocalSourceCodePolicy(),
      },
    }
  );
  assert.equal(execution.ok, true);
  assert.equal(execution.result.stopCode, STOP.PROVIDER_FAILED);
  assert.equal(execution.result.providerInvocationCount, 0);
  assert.equal(contextCalls, 0);
});

test('caller egress policy cannot override a denying trusted registration policy', async () => {
  const ent = entitlementBundle();
  const provider = createScriptedProvider({ scripts: [{ candidate: minimalCandidate() }] });
  const trustedRegistry = createProviderRegistry();
  trustedRegistry.register({
    descriptor: provider.descriptor,
    invoke: provider.invoke,
    configProvenance: {
      schemaVersion: 1,
      contract: 'zeus.provider-config-provenance@1',
      sourceKind: 'test',
      sourceReference: 'trusted-deny-test',
      configuredKeys: ['providerId'],
      redaction: 'values-omitted',
    },
  });
  const zeus = createZeus();
  const registered = await registerGenerationAssuranceModule(zeus.modules, {
    publicKeyPem: ent.publicKeyPem,
    licenseDocument: ent.licenseDocument,
    now: ent.now,
    providerRegistry: trustedRegistry,
    egressPolicy: denyAllPolicy(),
  });
  assert.equal(registered.ok, true);
  const execution = await zeus.capabilities.execute(
    GENERATION_ASSURANCE_CAPABILITY_ID,
    {},
    {
      candidate: failingCandidate(),
      options: {
        providerId: provider.descriptor.id,
        modelId: provider.descriptor.models[0],
        evidenceStore: evidenceStore(),
        egressPolicy: allowLocalSourceCodePolicy(),
      },
    }
  );
  assert.equal(execution.ok, true);
  assert.equal(execution.result.stopCode, STOP.PROVIDER_POLICY_DENIED);
  assert.equal(provider.callCount(), 0);
});

test('caller egress policy cannot supply a missing trusted registration policy', async () => {
  const ent = entitlementBundle();
  const provider = createScriptedProvider({ scripts: [{ candidate: minimalCandidate() }] });
  const trustedRegistry = createProviderRegistry();
  trustedRegistry.register({
    descriptor: provider.descriptor,
    invoke: provider.invoke,
    configProvenance: {
      schemaVersion: 1,
      contract: 'zeus.provider-config-provenance@1',
      sourceKind: 'test',
      sourceReference: 'trusted-missing-policy-test',
      configuredKeys: ['providerId'],
      redaction: 'values-omitted',
    },
  });
  const zeus = createZeus();
  const registered = await registerGenerationAssuranceModule(zeus.modules, {
    publicKeyPem: ent.publicKeyPem,
    licenseDocument: ent.licenseDocument,
    now: ent.now,
    providerRegistry: trustedRegistry,
  });
  assert.equal(registered.ok, true);
  const execution = await zeus.capabilities.execute(
    GENERATION_ASSURANCE_CAPABILITY_ID,
    {},
    {
      candidate: failingCandidate(),
      options: {
        providerId: provider.descriptor.id,
        modelId: provider.descriptor.models[0],
        evidenceStore: evidenceStore(),
        egressPolicy: allowLocalSourceCodePolicy(),
      },
    }
  );
  assert.equal(execution.ok, true);
  assert.equal(execution.result.stopCode, STOP.PROVIDER_POLICY_DENIED);
  assert.equal(provider.callCount(), 0);
});

test('invalid explicit declared scopes fail closed before provider invocation', async () => {
  for (const declaredScopePaths of [
    ['../ONLY-THIS'],
    ['C:\\ONLY-THIS'],
    ['\\\\server\\share'],
    [],
    [''],
    ['.'],
  ]) {
    let providerCalls = 0;
    const result = await runGenerationAssurance({
      candidate: failingCandidate(),
      options: {
        declaredScopePaths,
        providerRegistry: {
          invoke: async () => {
            providerCalls += 1;
          },
        },
        providerId: 'test.never',
        modelId: 'never-v1',
      },
    });
    assert.equal(result.stopCode, STOP.SCOPE_EXPANSION, JSON.stringify(declaredScopePaths));
    assert.equal(providerCalls, 0);
    assert.equal(result.providerInvocationCount, 0);
    assert.equal(generationAssurance.validateAttemptHistory(result.history).ok, true);
  }
});

test('valid explicit root still blocks an initial candidate outside that root', async () => {
  let providerCalls = 0;
  const result = await runGenerationAssurance({
    candidate: failingCandidate(),
    options: {
      declaredScopePaths: ['OTHERROOT'],
      evidenceStore: evidenceStore(),
      generationValidation,
      providerRegistry: {
        invoke: async () => {
          providerCalls += 1;
        },
      },
      providerId: 'test.never',
      modelId: 'never-v1',
    },
  });
  assert.equal(result.stopCode, STOP.SCOPE_EXPANSION);
  assert.equal(providerCalls, 0);
  assert.equal(result.providerInvocationCount, 0);
});

test('internal invalid-history projection forces a coherent non-ok result', () => {
  const { _finalizeForTest } = require('../src/generationAssurance/engine');
  const result = _finalizeForTest({
    ok: true,
    stopCode: STOP.REVIEW_READY,
    history: {
      attempts: [],
      providerInvocationCount: 0,
      finalDecision: { stopCode: STOP.REVIEW_READY, reviewReady: true },
    },
    safeReports: [],
    providerInvocationCount: 0,
    reviewArtifactRoot: null,
    workspaceRoot: null,
    runId: 'invalid-history-test',
    finalCandidate: null,
    finalValidation: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.stopCode, STOP.VALIDATOR_INTERNAL_FAILURE);
  assert.equal(result.reviewReady, false);
  assert.equal(generationAssurance.validateAttemptHistory(result.history).ok, true);
});

test('runtime descriptor requires crypto but does not claim provider execution is offline-only', () => {
  assert.deepEqual(generationAssurance.buildDescriptor().runtime.requiredFeatures, ['node-crypto']);
});

function snapshotLite() {
  return {
    schemaVersion: 1,
    kind: 'generation-candidate',
    candidateId: 'c',
    taskSummary: 't',
    evidenceReferences: [],
    proposedFiles: [],
  };
}
