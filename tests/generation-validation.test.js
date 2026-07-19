'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validateGenerationCandidate,
  createDefaultValidatorRegistry,
  createValidatorRegistry,
  extractDeclaredFiles,
  validateWorkspacePath,
  CONTRACT_IDS,
  STATUS,
  DIAGNOSTIC_IDS,
  generationCandidateSchema,
  generationValidationReportSchema,
} = require('../src/generationValidation');
const { CONTRACT_IDS: CORE_IDS, INITIAL_SCHEMAS } = require('../src/core/contracts/schemas');
const contracts = require('../src/core/contracts');
const { createZeus } = require('../src/api/zeusApi');

function minimalCandidate(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'generation-candidate',
    contractId: CONTRACT_IDS.GENERATION_CANDIDATE,
    candidateId: 'cand-1',
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
    validationPlan: { requiredValidators: ['schema', 'workspace-path'] },
    providerIdentity: { providerId: 'mock-local', model: 'mock-1' },
    correlationId: 'corr-1',
    ...overrides,
  };
}

function evidenceStore() {
  return {
    'ev-canonical': { kind: 'artifact', path: 'canonical-analysis.json' },
  };
}

test('contracts are registered in INITIAL_SCHEMAS', () => {
  assert.ok(INITIAL_SCHEMAS[CONTRACT_IDS.GENERATION_CANDIDATE]);
  assert.ok(INITIAL_SCHEMAS[CONTRACT_IDS.GENERATION_VALIDATION_REPORT]);
  assert.ok(INITIAL_SCHEMAS[CONTRACT_IDS.EXTERNAL_LINTER_ADAPTER]);
  assert.equal(CORE_IDS.GENERATION_CANDIDATE, 'zeus.generation-candidate');
});

test('schema accepts minimal valid candidate and rejects bad version', () => {
  assert.equal(generationCandidateSchema(minimalCandidate()).length, 0);
  const bad = generationCandidateSchema(minimalCandidate({ schemaVersion: 99 }));
  assert.ok(bad.some(e => e.path === '/schemaVersion'));
});

test('schema rejects chain-of-thought fields', () => {
  const errors = generationCandidateSchema(minimalCandidate({ chainOfThought: 'secret thoughts' }));
  assert.ok(errors.length > 0);
});

test('extractDeclaredFiles ignores undeclared side channels', () => {
  const candidate = minimalCandidate({
    additionalFiles: [{ path: 'evil.rpgle', content: 'x' }],
    freeText: '```rpgle\n// not declared\n```',
  });
  const extracted = extractDeclaredFiles(candidate);
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].path, 'QRPGLESRC/ORDERPGM.rpgle');
});

test('path safety rejects traversal, absolute, drive, unc, and control chars', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-genval-ws-'));
  try {
    assert.equal(validateWorkspacePath('../escape.rpgle', { workspaceRoot: root }).ok, false);
    assert.equal(validateWorkspacePath('/etc/passwd', { workspaceRoot: root }).ok, false);
    assert.equal(validateWorkspacePath('C:\\Windows\\a.rpgle', { workspaceRoot: root }).ok, false);
    assert.equal(
      validateWorkspacePath('\\\\server\\share\\a.rpgle', { workspaceRoot: root }).ok,
      false
    );
    assert.equal(validateWorkspacePath('a\u0000b.rpgle', { workspaceRoot: root }).ok, false);
    assert.equal(
      validateWorkspacePath('QRPGLESRC/ORDERPGM.rpgle', { workspaceRoot: root }).ok,
      true
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('valid candidate with evidence becomes review-ready without mutating workspace', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-genval-src-'));
  const marker = path.join(root, 'untouched.txt');
  fs.writeFileSync(marker, 'keep\n', 'utf8');
  const before = fs.readFileSync(marker, 'utf8');
  try {
    const result = await validateGenerationCandidate(minimalCandidate(), {
      workspaceRoot: root,
      evidenceStore: evidenceStore(),
    });
    assert.equal(result.status, STATUS.REVIEW_READY);
    assert.equal(result.reviewReady, true);
    assert.equal(result.claims.compiled, false);
    assert.equal(result.claims.sourceWorkspaceMutated, false);
    assert.equal(fs.readFileSync(marker, 'utf8'), before);
    assert.equal(generationValidationReportSchema(result.report).length, 0);
    assert.equal(result.report.providerIdentity.advisoryOnly, true);
    assert.equal(result.report.providerIdentity.sourceOfTruth, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing evidence is not review-ready', async () => {
  const result = await validateGenerationCandidate(minimalCandidate(), {
    evidenceStore: {},
  });
  assert.notEqual(result.status, STATUS.REVIEW_READY);
  assert.equal(result.reviewReady, false);
  assert.ok(result.report.diagnostics.some(d => d.id === DIAGNOSTIC_IDS.EVIDENCE_UNKNOWN));
});

test('policy denial cannot become review-ready', async () => {
  const result = await validateGenerationCandidate(minimalCandidate(), {
    evidenceStore: evidenceStore(),
    policy: { deny: true, reason: 'org policy blocks generation review' },
  });
  assert.equal(result.status, STATUS.DENIED);
  assert.equal(result.reviewReady, false);
  assert.ok(result.report.diagnostics.some(d => d.id === DIAGNOSTIC_IDS.POLICY_DENIED));
});

test('traversal path fails closed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-genval-trav-'));
  try {
    const result = await validateGenerationCandidate(
      minimalCandidate({
        proposedFiles: [
          {
            path: '../outside.rpgle',
            action: 'create',
            content: 'x\n',
          },
        ],
      }),
      { workspaceRoot: root, evidenceStore: evidenceStore() }
    );
    assert.equal(result.reviewReady, false);
    assert.ok(result.report.diagnostics.some(d => d.id === DIAGNOSTIC_IDS.PATH_UNSAFE));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate targets and disallowed types fail', async () => {
  const result = await validateGenerationCandidate(
    minimalCandidate({
      proposedFiles: [
        { path: 'QRPGLESRC/A.rpgle', action: 'modify', content: 'a\n' },
        { path: 'qrpglesrc/a.rpgle', action: 'modify', content: 'b\n' },
        { path: 'bin/tool.exe', action: 'create', content: 'MZ' },
      ],
    }),
    { evidenceStore: evidenceStore() }
  );
  assert.equal(result.reviewReady, false);
  assert.ok(result.report.diagnostics.some(d => d.id === DIAGNOSTIC_IDS.DUPLICATE_TARGET));
  assert.ok(result.report.diagnostics.some(d => d.id === DIAGNOSTIC_IDS.FILE_TYPE_DENIED));
});

test('scope expansion fails closed', async () => {
  const result = await validateGenerationCandidate(minimalCandidate(), {
    evidenceStore: evidenceStore(),
    declaredScopePaths: ['QCLLESRC'],
  });
  assert.equal(result.reviewReady, false);
  assert.ok(result.report.diagnostics.some(d => d.id === DIAGNOSTIC_IDS.SCOPE_EXPANSION));
});

test('secret-like content is denied', async () => {
  const result = await validateGenerationCandidate(
    minimalCandidate({
      proposedFiles: [
        {
          path: 'QRPGLESRC/X.rpgle',
          action: 'modify',
          content: "password = 'super-secret-value-123'\n",
        },
      ],
    }),
    { evidenceStore: evidenceStore() }
  );
  assert.equal(result.status, STATUS.DENIED);
  assert.equal(result.reviewReady, false);
});

test('validator registry isolates failures and keeps required order', async () => {
  const registry = createValidatorRegistry({ requiredIds: ['a', 'b'] });
  const seen = [];
  registry.register({
    id: 'a',
    version: 1,
    order: 1,
    validate() {
      seen.push('a');
      throw new Error('boom with secret=abc');
    },
  });
  registry.register({
    id: 'b',
    version: 1,
    order: 2,
    validate() {
      seen.push('b');
      return [{ id: 'GENVAL.TEST', severity: 'warning', message: 'ok' }];
    },
  });
  const { diagnostics } = await registry.runAll({});
  assert.deepEqual(seen, ['a', 'b']);
  assert.ok(diagnostics.some(d => d.id === DIAGNOSTIC_IDS.VALIDATOR_INTERNAL));
  assert.ok(!JSON.stringify(diagnostics).includes('secret=abc'));
  assert.ok(diagnostics.some(d => d.validatorId === 'b'));
});

test('duplicate validator registration fails', () => {
  const registry = createDefaultValidatorRegistry();
  assert.throws(() => {
    registry.register({ id: 'schema', version: 1, validate: () => [] });
  }, /duplicate validator id/);
});

test('review artifacts write only outside source workspace', async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-genval-source-'));
  const review = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-genval-review-'));
  try {
    const result = await validateGenerationCandidate(minimalCandidate(), {
      workspaceRoot: source,
      reviewArtifactRoot: review,
      evidenceStore: evidenceStore(),
    });
    assert.equal(result.reviewReady, true);
    assert.equal(result.artifacts.written, true);
    assert.ok(fs.existsSync(path.join(review, 'cand-1', 'validation-report.json')));
    assert.ok(fs.existsSync(path.join(review, 'cand-1', 'review-diff.json')));
    assert.ok(fs.existsSync(path.join(review, 'cand-1', 'manifest.json')));
    // source remains empty of generated patches
    assert.deepEqual(fs.readdirSync(source), []);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(review, { recursive: true, force: true });
  }
});

test('writing review artifacts into source workspace is rejected', async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-genval-badreview-'));
  try {
    await assert.rejects(
      () =>
        validateGenerationCandidate(minimalCandidate(), {
          workspaceRoot: source,
          reviewArtifactRoot: source,
          evidenceStore: evidenceStore(),
        }),
      /must not be inside the source workspace/
    );
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('reports are deterministic across repeated runs', async () => {
  const options = { evidenceStore: evidenceStore() };
  const a = await validateGenerationCandidate(minimalCandidate(), options);
  const b = await validateGenerationCandidate(minimalCandidate(), options);
  assert.equal(JSON.stringify(a.report), JSON.stringify(b.report));
  assert.equal(JSON.stringify(a.reviewDiff), JSON.stringify(b.reviewDiff));
});

test('public API exposes generationValidation namespace', async () => {
  const zeus = createZeus();
  assert.equal(typeof zeus.generationValidation.validateGenerationCandidate, 'function');
  const result = await zeus.generationValidation.validateGenerationCandidate(minimalCandidate(), {
    evidenceStore: evidenceStore(),
  });
  assert.equal(result.reviewReady, true);
  assert.ok(contracts.generationValidation);
});

test('unsupported contract version is invalid', async () => {
  const result = await validateGenerationCandidate(minimalCandidate({ schemaVersion: 2 }), {
    evidenceStore: evidenceStore(),
  });
  assert.equal(result.status, STATUS.INVALID);
  assert.equal(result.reviewReady, false);
});

test('content size limit fails closed', async () => {
  const big = 'x'.repeat(300 * 1024);
  const result = await validateGenerationCandidate(
    minimalCandidate({
      proposedFiles: [{ path: 'QRPGLESRC/BIG.rpgle', action: 'modify', content: big }],
    }),
    { evidenceStore: evidenceStore() }
  );
  assert.equal(result.reviewReady, false);
  assert.ok(result.report.diagnostics.some(d => d.id === DIAGNOSTIC_IDS.CONTENT_TOO_LARGE));
});
