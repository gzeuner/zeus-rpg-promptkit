'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { buildTechnicalEvidenceContext } = require('../src/context/technicalEvidenceContext');
const {
  buildTechnicalEvidencePrompt,
  validateTechnicalEvidencePrompt,
} = require('../src/prompt/technicalEvidencePromptAdapter');
const {
  buildTechnicalEvidenceReviewReceipt,
  checkTechnicalEvidenceReview,
  validateTechnicalEvidenceReviewReceipt,
} = require('../src/context/technicalEvidenceReview');
const zeusApi = require('../src/api/zeusApi');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');
const IDS = Object.freeze({
  one: 'a'.repeat(64),
  two: 'b'.repeat(64),
  edge: 'c'.repeat(64),
});

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

function contextFixture() {
  return buildTechnicalEvidenceContext({
    evidence: graphFixture(),
    goalCode: 'dependency-impact',
    targetIds: [IDS.one],
    maxNodes: 2,
    maxEdges: 1,
    tokenBudget: 1000,
  });
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

test('technical evidence prompt adapter is deterministic and source-neutral', () => {
  const context = contextFixture();
  const first = buildTechnicalEvidencePrompt({ context, maxTokens: 1000 });
  const second = buildTechnicalEvidencePrompt({ context, maxTokens: 1000 });

  assert.deepEqual(first, second);
  assert.deepEqual(validateTechnicalEvidencePrompt(first), []);
  assert.match(first.prompt, /OBJECTIVE code=dependency-impact/);
  assert.match(first.prompt, /NODE id=/);
  assert.match(first.prompt, /EDGE id=/);
  assert.doesNotMatch(JSON.stringify(first), /private-name-canary|C:\\|SELECT\s+\*/i);
  assert.equal(first.privacy.containsRawSource, false);
  assert.equal(first.privacy.containsBusinessTerms, false);
});

test('technical evidence prompt adapter rejects unsupported free-form fields', () => {
  const context = contextFixture();
  context.evidence.nodes[0].name = 'private-name-canary';
  assert.throws(
    () => buildTechnicalEvidencePrompt({ context }),
    error => error.code === 'TECHNICAL_EVIDENCE_PROMPT_UNSAFE'
  );
});

test('local review receipt binds exact context and prompt fingerprints', () => {
  const context = contextFixture();
  const prompt = buildTechnicalEvidencePrompt({ context });
  const receipt = buildTechnicalEvidenceReviewReceipt({
    context,
    prompt,
    decision: 'approve',
    reviewer: 'synthetic-reviewer',
    reviewedAt: '2026-09-20T12:00:00.000Z',
  });

  assert.deepEqual(validateTechnicalEvidenceReviewReceipt(receipt), []);
  assert.match(receipt.receiptId, /^receipt:[a-f0-9]{16}$/);
  assert.match(receipt.reviewerHash, /^reviewer:[a-f0-9]{16}$/);
  assert.doesNotMatch(JSON.stringify(receipt), /synthetic-reviewer/);
  assert.equal(receipt.externalPublicationAllowed, false);

  const approved = checkTechnicalEvidenceReview({
    context,
    prompt,
    receipt,
    policy: 'required',
    asOf: '2026-09-21T00:00:00.000Z',
  });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.gatePassed, true);
  assert.deepEqual(approved.blockers, []);

  const changedPrompt = { ...prompt, prompt: `${prompt.prompt}X` };
  assert.throws(
    () =>
      checkTechnicalEvidenceReview({
        context,
        prompt: changedPrompt,
        receipt,
        policy: 'required',
        asOf: '2026-09-21T00:00:00.000Z',
      }),
    error => error.code === 'TECHNICAL_EVIDENCE_REVIEW_PROMPT_INVALID'
  );
});

test('technical evidence prompt, receipt, and review-check CLI remain local and bounded', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-technical-evidence-review-'));
  try {
    fs.writeFileSync(
      path.join(cwd, 'context.json'),
      `${JSON.stringify(contextFixture())}\n`,
      'utf8'
    );
    const promptRun = runCli(
      [
        'technical-evidence',
        'prompt',
        '--context',
        'context.json',
        '--out',
        '.local/prompt.json',
        '--json',
      ],
      cwd
    );
    assert.equal(promptRun.status, 0, promptRun.stderr);
    const promptPayload = JSON.parse(promptRun.stdout);
    assert.equal(promptPayload.ok, true);
    assert.deepEqual(promptPayload.artifacts, ['.local/prompt.json']);

    const reviewRun = runCli(
      [
        'technical-evidence',
        'review',
        '--context',
        'context.json',
        '--prompt',
        '.local/prompt.json',
        '--decision',
        'approve',
        '--reviewer',
        'synthetic-reviewer',
        '--reviewed-at',
        '2026-09-20T12:00:00.000Z',
        '--out',
        '.local/review.json',
        '--json',
      ],
      cwd
    );
    assert.equal(reviewRun.status, 0, reviewRun.stderr);
    assert.doesNotMatch(reviewRun.stdout, /synthetic-reviewer|C:\\|private-name-canary/i);

    const checkRun = runCli(
      [
        'technical-evidence',
        'review-check',
        '--context',
        'context.json',
        '--prompt',
        '.local/prompt.json',
        '--receipt',
        '.local/review.json',
        '--policy',
        'required',
        '--as-of',
        '2026-09-21T00:00:00.000Z',
        '--json',
      ],
      cwd
    );
    assert.equal(checkRun.status, 0, checkRun.stderr);
    assert.equal(JSON.parse(checkRun.stdout).status, 'approved');

    const absoluteRun = runCli(
      ['technical-evidence', 'prompt', '--context', path.join(cwd, 'context.json'), '--json'],
      cwd
    );
    assert.equal(absoluteRun.status, 2);
    assert.match(absoluteRun.stdout, /TECHNICAL_EVIDENCE_PATH_UNSAFE/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('public API exposes prompt and review contracts', () => {
  assert.equal(typeof zeusApi.buildTechnicalEvidencePrompt, 'function');
  assert.equal(typeof zeusApi.buildTechnicalEvidenceReviewReceipt, 'function');
  assert.deepEqual(zeusApi.technicalEvidencePromptContract, {
    id: 'zeus.technical-evidence-prompt',
    version: 1,
  });
  assert.deepEqual(zeusApi.technicalEvidenceReviewContract, {
    id: 'zeus.technical-evidence-review',
    version: 1,
  });
});
