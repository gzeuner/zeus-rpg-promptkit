'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { buildTechnicalEvidenceContext } = require('../src/context/technicalEvidenceContext');
const { buildTechnicalEvidencePrompt } = require('../src/prompt/technicalEvidencePromptAdapter');
const {
  checkTechnicalEvidencePromptEgress,
  evaluateTechnicalEvidencePromptRegression,
  validateTechnicalEvidencePromptEgress,
  validateTechnicalEvidencePromptRegression,
} = require('../src/prompt/technicalEvidencePolicy');
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

function graphFixture({ complete = true, warnings = [] } = {}) {
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
    warnings,
    graph: {
      complete,
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

function promptFixture(options) {
  return buildTechnicalEvidencePrompt({
    context: buildTechnicalEvidenceContext({
      evidence: graphFixture(options),
      goalCode: options?.goalCode || 'dependency-impact',
      targetIds: [IDS.one],
      maxNodes: 2,
      maxEdges: 1,
      tokenBudget: 1000,
    }),
  });
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

test('prompt regression is deterministic, bounded, and review-aware', () => {
  const baseline = promptFixture({ goalCode: 'dependency-impact' });
  const candidate = promptFixture({ goalCode: 'architecture' });
  const result = evaluateTechnicalEvidencePromptRegression({ baseline, candidate });

  assert.equal(result.status, 'changed');
  assert.equal(result.gatePassed, true);
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(validateTechnicalEvidencePromptRegression(result), []);
  assert.ok(result.changes.includes('CONTEXT_CHANGED'));
  assert.ok(result.changes.includes('OBJECTIVE_CHANGED'));
  assert.doesNotMatch(JSON.stringify(result), /private-name-canary|C:\\|SELECT\s+\*/i);
  assert.equal(result.externalPublicationAllowed, false);
});

test('prompt regression blocks completeness and warning loss', () => {
  const baseline = promptFixture({ complete: true, warnings: ['SCANNER_PARTIAL_FAILURE'] });
  const candidate = promptFixture({ complete: false, warnings: [] });
  const result = evaluateTechnicalEvidencePromptRegression({ baseline, candidate });

  assert.equal(result.status, 'blocked');
  assert.equal(result.gatePassed, false);
  assert.ok(result.blockers.includes('COMPLETENESS_REGRESSION'));
  assert.ok(result.blockers.includes('WARNING_DISCARDED'));
});

test('technical evidence egress is local-only and fail-closed', () => {
  const prompt = promptFixture({});
  const local = checkTechnicalEvidencePromptEgress({ prompt });
  assert.equal(local.status, 'allowed');
  assert.equal(local.gatePassed, true);
  assert.deepEqual(validateTechnicalEvidencePromptEgress(local), []);
  assert.equal(local.providerHandoffAllowed, false);

  const external = checkTechnicalEvidencePromptEgress({
    prompt,
    trustZone: 'external',
    destination: 'external-provider',
  });
  assert.equal(external.status, 'blocked');
  assert.equal(external.gatePassed, false);
  assert.ok(external.blockers.includes('LOCAL_ZONE_REQUIRED'));
  assert.ok(external.blockers.includes('LOCAL_DESTINATION_REQUIRED'));
  assert.doesNotMatch(JSON.stringify(external), /private-name-canary|C:\\|SELECT\s+\*/i);
});

test('policy contracts are registered and exposed through the public API', () => {
  const registry = createSchemaRegistry();
  for (const [id, definition] of Object.entries(INITIAL_SCHEMAS))
    registry.register({ id, ...definition });
  const prompt = promptFixture({});
  const egress = checkTechnicalEvidencePromptEgress({ prompt });
  const regression = evaluateTechnicalEvidencePromptRegression({
    baseline: prompt,
    candidate: prompt,
  });

  assert.equal(registry.validate(CONTRACT_IDS.TECHNICAL_EVIDENCE_EGRESS_CHECK, 1, egress).ok, true);
  assert.equal(
    registry.validate(CONTRACT_IDS.TECHNICAL_EVIDENCE_PROMPT_REGRESSION, 1, regression).ok,
    true
  );
  assert.deepEqual(zeusApi.technicalEvidenceEgressContract, {
    id: 'zeus.technical-evidence-egress-check',
    version: 1,
  });
  assert.deepEqual(zeusApi.technicalEvidencePromptRegressionContract, {
    id: 'zeus.technical-evidence-prompt-regression',
    version: 1,
  });
});

test('regression and policy CLI keep artifacts workspace-relative', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-technical-evidence-policy-'));
  try {
    fs.writeFileSync(
      path.join(cwd, 'baseline.json'),
      `${JSON.stringify(promptFixture({}))}\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(cwd, 'candidate.json'),
      `${JSON.stringify(promptFixture({ goalCode: 'architecture' }))}\n`,
      'utf8'
    );

    const regressionRun = runCli(
      [
        'technical-evidence',
        'regression',
        '--baseline',
        'baseline.json',
        '--candidate',
        'candidate.json',
        '--out',
        '.local/regression.json',
        '--json',
      ],
      cwd
    );
    assert.equal(regressionRun.status, 0, regressionRun.stderr);
    assert.equal(JSON.parse(regressionRun.stdout).status, 'changed');
    assert.deepEqual(JSON.parse(regressionRun.stdout).artifacts, ['.local/regression.json']);

    const localRun = runCli(
      [
        'technical-evidence',
        'policy-check',
        '--prompt',
        'candidate.json',
        '--out',
        '.local/egress.json',
        '--json',
      ],
      cwd
    );
    assert.equal(localRun.status, 0, localRun.stderr);
    assert.equal(JSON.parse(localRun.stdout).status, 'allowed');

    const externalRun = runCli(
      [
        'technical-evidence',
        'policy-check',
        '--prompt',
        'candidate.json',
        '--trust-zone',
        'external',
        '--destination',
        'external-provider',
        '--json',
      ],
      cwd
    );
    assert.equal(externalRun.status, 2);
    assert.equal(JSON.parse(externalRun.stdout).status, 'blocked');

    const absoluteRun = runCli(
      [
        'technical-evidence',
        'policy-check',
        '--prompt',
        path.join(cwd, 'candidate.json'),
        '--json',
      ],
      cwd
    );
    assert.equal(absoluteRun.status, 2);
    assert.match(absoluteRun.stdout, /TECHNICAL_EVIDENCE_PATH_UNSAFE/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
