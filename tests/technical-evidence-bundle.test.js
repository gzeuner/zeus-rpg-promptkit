'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { buildTechnicalEvidenceContext } = require('../src/context/technicalEvidenceContext');
const {
  buildTechnicalEvidenceReviewReceipt,
  checkTechnicalEvidenceReview,
} = require('../src/context/technicalEvidenceReview');
const { buildTechnicalEvidencePrompt } = require('../src/prompt/technicalEvidencePromptAdapter');
const {
  checkTechnicalEvidencePromptEgress,
  evaluateTechnicalEvidencePromptRegression,
} = require('../src/prompt/technicalEvidencePolicy');
const {
  buildTechnicalEvidencePromptBundleCheck,
  buildTechnicalEvidenceHandoffReceipt,
  buildTechnicalEvidencePromptBundle,
  validateTechnicalEvidenceHandoffReceipt,
  validateTechnicalEvidencePromptBundleCheck,
  validateTechnicalEvidencePromptBundle,
} = require('../src/prompt/technicalEvidenceBundle');
const { createSchemaRegistry } = require('../src/core/contracts');
const { CONTRACT_IDS, INITIAL_SCHEMAS } = require('../src/core/contracts/schemas');
const zeusApi = require('../src/api/zeusApi');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');
const IDS = Object.freeze({
  one: '1'.repeat(64),
  two: '2'.repeat(64),
  edge: '3'.repeat(64),
});
const REVIEWED_AT = '2026-09-24T12:00:00.000Z';

function graphFixture() {
  return {
    schemaVersion: 1,
    kind: 'zeus-anonymized-technical-evidence-graph',
    readOnly: true,
    sourceBoundary: {
      mode: 'local-read-only',
      followsSymlinks: false,
      pathDisclosure: 'none',
      contentDisclosure: 'none',
    },
    privacy: {
      containsRawSource: false,
      containsSourcePaths: false,
      containsSourceNames: false,
      containsCredentials: false,
      containsBusinessTerms: false,
      hashAlgorithm: 'hmac-sha256',
    },
    warnings: [],
    graph: {
      complete: true,
      nodes: [
        { id: IDS.one, kind: 'program', family: 'RPG' },
        { id: IDS.two, kind: 'data-object', family: 'SQL' },
      ],
      edges: [
        { id: IDS.edge, kind: 'REFERENCES_DATA_OBJECT', from: IDS.one, to: IDS.two, count: 1 },
      ],
    },
  };
}

function artifacts() {
  const context = buildTechnicalEvidenceContext({
    evidence: graphFixture(),
    goalCode: 'dependency-impact',
    targetIds: [IDS.one],
    maxNodes: 2,
    maxEdges: 1,
    tokenBudget: 1000,
  });
  const prompt = buildTechnicalEvidencePrompt({ context });
  const regression = evaluateTechnicalEvidencePromptRegression({
    baseline: prompt,
    candidate: prompt,
  });
  const egress = checkTechnicalEvidencePromptEgress({ prompt });
  const reviewReceipt = buildTechnicalEvidenceReviewReceipt({
    context,
    prompt,
    decision: 'approve',
    reviewer: 'synthetic-reviewer',
    reviewedAt: REVIEWED_AT,
    freshDays: 30,
  });
  const review = checkTechnicalEvidenceReview({
    context,
    prompt,
    receipt: reviewReceipt,
    policy: 'required',
    asOf: REVIEWED_AT,
    freshDays: 30,
  });
  return { context, prompt, regression, egress, reviewReceipt, review };
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

test('fingerprint-only bundle is deterministic and schema-valid', () => {
  const first = artifacts();
  const second = artifacts();
  const bundle = buildTechnicalEvidencePromptBundle(first);
  const repeat = buildTechnicalEvidencePromptBundle(second);

  assert.deepEqual(bundle, repeat);
  assert.equal(bundle.status, 'ready');
  assert.equal(bundle.handoffAllowed, false);
  assert.deepEqual(validateTechnicalEvidencePromptBundle(bundle), []);
  assert.equal(bundle.identity.artifacts.length, 4);
  assert.doesNotMatch(
    JSON.stringify(bundle),
    /ZEUS TECHNICAL EVIDENCE REVIEW|private-name-canary|C:\\|SELECT\s+\*/i
  );
  assert.equal(bundle.constraints.containsPromptContent, false);
});

test('bundle binds exact gates and fails closed on tampering', () => {
  const input = artifacts();
  const bundle = buildTechnicalEvidencePromptBundle(input);
  const tampered = {
    ...bundle,
    gates: { ...bundle.gates, regression: { ...bundle.gates.regression, status: 'blocked' } },
  };
  assert.notDeepEqual(validateTechnicalEvidencePromptBundle(tampered), []);

  assert.throws(
    () =>
      buildTechnicalEvidencePromptBundle({
        ...input,
        egress: { ...input.egress, promptFingerprint: 'f'.repeat(64) },
      }),
    error => error.code === 'TECHNICAL_EVIDENCE_BUNDLE_EGRESS_MISMATCH'
  );
});

test('bundle replay check is deterministic and detects changed gate inputs', () => {
  const input = artifacts();
  const bundle = buildTechnicalEvidencePromptBundle(input);
  const verified = buildTechnicalEvidencePromptBundleCheck({ ...input, bundle });
  assert.equal(verified.status, 'pass');
  assert.equal(verified.gatePassed, true);
  assert.deepEqual(validateTechnicalEvidencePromptBundleCheck(verified), []);
  assert.equal(verified.bundleFingerprint, verified.replayedBundleFingerprint);

  const changed = buildTechnicalEvidencePromptBundleCheck({
    ...input,
    bundle,
    regression: { ...input.regression, warnings: ['TOKEN_LIMIT_INCREASED'] },
  });
  assert.equal(changed.status, 'blocked');
  assert.equal(changed.gatePassed, false);
  assert.ok(changed.mismatches.includes('BUNDLE_FINGERPRINT_MISMATCH'));
  assert.doesNotMatch(JSON.stringify(changed), /private-name-canary|C:\\|SELECT\s+\*/i);
});

test('handoff receipt requires a required approved local review', () => {
  const input = artifacts();
  const bundle = buildTechnicalEvidencePromptBundle(input);
  const accepted = buildTechnicalEvidenceHandoffReceipt({ bundle, review: input.review });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.handoffAllowed, true);
  assert.deepEqual(validateTechnicalEvidenceHandoffReceipt(accepted), []);
  assert.equal(accepted.externalPublicationAllowed, false);
  assert.doesNotMatch(
    JSON.stringify(accepted),
    /synthetic-reviewer|private-name-canary|C:\\|SELECT\s+\*/i
  );

  const advisory = buildTechnicalEvidenceHandoffReceipt({
    bundle,
    review: { ...input.review, policy: 'advisory' },
  });
  assert.equal(advisory.status, 'blocked');
  assert.ok(advisory.blockers.includes('REVIEW_POLICY_REQUIRED'));
});

test('bundle and handoff contracts are registered and public', () => {
  const registry = createSchemaRegistry();
  for (const [id, definition] of Object.entries(INITIAL_SCHEMAS))
    registry.register({ id, ...definition });
  const input = artifacts();
  const bundle = buildTechnicalEvidencePromptBundle(input);
  const handoff = buildTechnicalEvidenceHandoffReceipt({ bundle, review: input.review });

  assert.equal(
    registry.validate(CONTRACT_IDS.TECHNICAL_EVIDENCE_PROMPT_BUNDLE, 1, bundle).ok,
    true
  );
  assert.equal(
    registry.validate(CONTRACT_IDS.TECHNICAL_EVIDENCE_HANDOFF_RECEIPT, 1, handoff).ok,
    true
  );
  const bundleCheck = buildTechnicalEvidencePromptBundleCheck({ ...input, bundle });
  assert.equal(
    registry.validate(CONTRACT_IDS.TECHNICAL_EVIDENCE_BUNDLE_CHECK, 1, bundleCheck).ok,
    true
  );
  assert.deepEqual(zeusApi.technicalEvidencePromptBundleContract, {
    id: 'zeus.technical-evidence-prompt-bundle',
    version: 1,
  });
  assert.deepEqual(zeusApi.technicalEvidenceHandoffContract, {
    id: 'zeus.technical-evidence-handoff-receipt',
    version: 1,
  });
});

test('CLI writes only local bundle and handoff metadata artifacts', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-technical-evidence-bundle-'));
  try {
    const input = artifacts();
    for (const [name, value] of Object.entries({
      context: input.context,
      prompt: input.prompt,
      regression: input.regression,
      egress: input.egress,
      review: input.reviewReceipt,
    })) {
      fs.writeFileSync(path.join(cwd, `${name}.json`), `${JSON.stringify(value)}\n`, 'utf8');
    }

    const bundleRun = runCli(
      [
        'technical-evidence',
        'bundle',
        '--context',
        'context.json',
        '--prompt',
        'prompt.json',
        '--regression',
        'regression.json',
        '--egress',
        'egress.json',
        '--out',
        '.local/bundle.json',
        '--json',
      ],
      cwd
    );
    assert.equal(bundleRun.status, 0, bundleRun.stderr);
    assert.equal(JSON.parse(bundleRun.stdout).status, 'ready');
    assert.deepEqual(JSON.parse(bundleRun.stdout).artifacts, ['.local/bundle.json']);

    const handoffRun = runCli(
      [
        'technical-evidence',
        'handoff',
        '--bundle',
        '.local/bundle.json',
        '--context',
        'context.json',
        '--prompt',
        'prompt.json',
        '--receipt',
        'review.json',
        '--as-of',
        REVIEWED_AT,
        '--out',
        '.local/handoff.json',
        '--json',
      ],
      cwd
    );
    assert.equal(handoffRun.status, 0, handoffRun.stderr);
    assert.equal(JSON.parse(handoffRun.stdout).status, 'accepted');
    assert.deepEqual(JSON.parse(handoffRun.stdout).artifacts, ['.local/handoff.json']);

    const checkRun = runCli(
      [
        'technical-evidence',
        'bundle-check',
        '--bundle',
        '.local/bundle.json',
        '--context',
        'context.json',
        '--prompt',
        'prompt.json',
        '--regression',
        'regression.json',
        '--egress',
        'egress.json',
        '--out',
        '.local/bundle-check.json',
        '--json',
      ],
      cwd
    );
    assert.equal(checkRun.status, 0, checkRun.stderr);
    assert.equal(JSON.parse(checkRun.stdout).status, 'pass');
    assert.deepEqual(JSON.parse(checkRun.stdout).artifacts, ['.local/bundle-check.json']);

    const unsafeRun = runCli(
      ['technical-evidence', 'handoff', '--bundle', path.join(cwd, 'bundle.json'), '--json'],
      cwd
    );
    assert.equal(unsafeRun.status, 2);
    assert.match(unsafeRun.stdout, /TECHNICAL_EVIDENCE_PATH_UNSAFE/);
    assert.doesNotMatch(unsafeRun.stdout, new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
