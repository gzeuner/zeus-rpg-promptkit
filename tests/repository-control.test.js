'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/repository-control.js');
const CONFIG_PATH = path.join(ROOT, '.github/repository-control.json');
const {
  ConfigError,
  loadConfig,
  resolveSafePath,
  validateConfig,
} = require('../scripts/repository-control/config');
const {
  assertReadOnlyGhArgs,
  createGithubProbe,
  selectLatestChecks,
} = require('../scripts/repository-control/githubProbe');
const {
  evaluateMain,
  evaluateOverview,
  evaluatePr,
  evaluateRequiredChecks,
  finalizeDecision,
} = require('../scripts/repository-control/checkEvaluation');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function run(args, options = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: options.cwd || ROOT,
    env: { ...process.env, GH_TOKEN: '', ...options.env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
  });
}

function config() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}
function report(scope = 'pr') {
  return {
    scope,
    observedSha: null,
    localCandidateSha: null,
    blockers: [],
    warnings: [],
    unknowns: [],
    checks: [],
    pullRequests: [],
    branches: [],
    main: null,
    release: null,
  };
}
function successRun(name, sha = SHA_A, extra = {}) {
  return {
    id: 1,
    name,
    status: 'completed',
    conclusion: 'success',
    head_sha: sha,
    attempt: 1,
    completed_at: '2026-01-01T00:00:00Z',
    ...extra,
  };
}
function successfulChecks(cfg, scope, sha = SHA_A) {
  return {
    checkRuns: cfg.requiredChecks[scope].map((name, index) =>
      successRun(name, sha, { id: index + 1 })
    ),
    statuses: [],
  };
}

function prProbes(cfg, overrides = {}) {
  const pr = {
    number: 7,
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'feature',
    headRefOid: SHA_A,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
  };
  return {
    fetchPrDetails: async () => pr,
    fetchCompare: async () => ({ behind_by: 0, ahead_by: 1, status: 'ahead' }),
    fetchReviewThreads: async () => [],
    fetchChecksForSha: async (_sha, options) => {
      assert.deepEqual(options.requiredCheckNames, cfg.requiredChecks.pullRequest);
      assert.equal(await options.verifyCurrentSha(), SHA_A);
      return successfulChecks(cfg, 'pullRequest');
    },
    ...overrides,
  };
}

function mainProbes(cfg, overrides = {}) {
  return {
    fetchRefSha: async () => SHA_A,
    fetchMainDetails: async sha => ({ sha }),
    fetchChecksForSha: async (_sha, options) => {
      assert.deepEqual(options.requiredCheckNames, cfg.requiredChecks.main);
      assert.equal(await options.verifyCurrentSha(), SHA_A);
      return successfulChecks(cfg, 'main');
    },
    fetchAssociatedPullRequests: async () => [
      { number: 7, merged_at: '2026-01-01T00:00:00Z', html_url: 'https://example.test/7' },
    ],
    fetchReleases: async () => [{ tag_name: 'v0.2.0-beta.2' }],
    fetchCompare: async () => ({ ahead_by: 3, behind_by: 0 }),
    ...overrides,
  };
}

test('help exits 0 without configuration or GitHub access', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Repository Control \(read-only\)/);
});

test('unknown CLI options and invalid scopes exit 64', () => {
  assert.equal(run(['--unknown']).status, 64);
  assert.equal(run(['--scope', 'invalid']).status, 64);
});

test('PR scope requires a positive integer and full local SHA', () => {
  assert.equal(run(['--scope', 'pr']).status, 64);
  assert.equal(run(['--scope', 'pr', '--pr', '-1']).status, 64);
  assert.equal(run(['--scope', 'pr', '--pr', '1', '--local-sha', 'abc']).status, 64);
});

test('missing configuration fails closed with exit 64', () => {
  const result = run(['--config', path.join(os.tmpdir(), `missing-${process.pid}.json`)]);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /missing or unreadable/);
});

test('invalid JSON and empty required-check contracts fail closed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-control-config-'));
  const invalid = path.join(directory, 'invalid.json');
  const empty = path.join(directory, 'empty.json');
  fs.writeFileSync(invalid, '{');
  const value = config();
  value.requiredChecks.pullRequest = [];
  fs.writeFileSync(empty, JSON.stringify(value));
  assert.throws(() => loadConfig(invalid), ConfigError);
  assert.throws(() => loadConfig(empty), /non-empty/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('configuration validates explicit per-check conclusions and policy values', () => {
  const value = config();
  delete value.checkConclusions.pullRequest[value.requiredChecks.pullRequest[0]];
  assert.throws(() => validateConfig(value, 'test'), /checkConclusions/);
  const badPolicy = config();
  badPolicy.policies.mergeability = 'maybe';
  assert.throws(() => validateConfig(badPolicy, 'test'), /ignore, warning, or block/);
});

test('relative parent traversal is rejected before any GitHub probe', () => {
  const result = run(['--scope', 'overview', '--json-output', '../escaped.json']);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /parent traversal/);
});

test('absolute paths outside repository and temporary directory are rejected', () => {
  assert.throws(
    () => resolveSafePath('/var/repository-control-escape.json'),
    /inside the repository or temporary/
  );
});

test('symlink escape is rejected for output and configuration paths', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-control-links-'));
  const work = path.join(directory, 'work');
  const outside = path.join(directory, 'outside');
  fs.mkdirSync(work);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(work, 'link'));
  assert.throws(() => resolveSafePath(path.join(work, 'link', 'report.json')), /symbolic links/);
  const linkedConfig = path.join(work, 'config.json');
  fs.symlinkSync(CONFIG_PATH, linkedConfig);
  assert.throws(() => loadConfig(linkedConfig), /symbolic links/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('read-only allowlist rejects mutating gh commands and GraphQL mutations', () => {
  assert.doesNotThrow(() => assertReadOnlyGhArgs(['pr', 'view', '1']));
  assert.doesNotThrow(() => assertReadOnlyGhArgs(['api', '--method', 'GET', 'repos/o/r']));
  assert.throws(() => assertReadOnlyGhArgs(['pr', 'merge', '1']), /not read-only/);
  assert.throws(
    () => assertReadOnlyGhArgs(['api', '--method', 'DELETE', 'repos/o/r']),
    /Non-read-only/
  );
  assert.throws(
    () =>
      assertReadOnlyGhArgs([
        'api',
        'graphql',
        '--method',
        'POST',
        '-f',
        'query=mutation { deleteProjectV2(input:{}) { clientMutationId } }',
      ]),
    /mutation rejected/
  );
});

test('GitHub operation audit records executable, arguments, and read-only access', async () => {
  const probe = createGithubProbe({
    runner: args =>
      args[0] === 'pr' ? JSON.stringify({ number: 1 }) : JSON.stringify({ sha: SHA_A, commit: {} }),
  });
  await probe.fetchPrDetails(1);
  await probe.fetchMainDetails(SHA_A);
  const operations = probe.getOperations();
  assert.equal(operations.length, 2);
  assert.ok(operations.every(item => item.executable === 'gh' && item.access === 'read-only'));
  assert.ok(operations.every(item => Array.isArray(item.args)));
});

test('check and status pages are flattened without truncation', async () => {
  const probe = createGithubProbe({
    runner: args => {
      const endpoint = args.find(arg => arg.includes('/commits/'));
      if (endpoint.includes('check-runs'))
        return JSON.stringify([
          { check_runs: [successRun('one')] },
          { check_runs: [successRun('two')] },
        ]);
      return JSON.stringify([
        [{ id: 1, context: 'legacy-one', state: 'success', sha: SHA_A }],
        [{ id: 2, context: 'legacy-two', state: 'success', sha: SHA_A }],
      ]);
    },
  });
  const checks = await probe.fetchChecksForSha(SHA_A);
  assert.deepEqual(
    checks.checkRuns.map(item => item.name),
    ['one', 'two']
  );
  assert.deepEqual(
    checks.statuses.map(item => item.context),
    ['legacy-one', 'legacy-two']
  );
});

test('rerun ordering prefers attempt, then completion time, then id', () => {
  const selected = selectLatestChecks([
    successRun('gate', SHA_A, { id: 99, attempt: 1, completed_at: '2026-02-01T00:00:00Z' }),
    successRun('gate', SHA_A, {
      id: 1,
      attempt: 2,
      completed_at: '2026-01-01T00:00:00Z',
      conclusion: 'failure',
    }),
  ]);
  assert.equal(selected.get('gate').attempt, 2);
  assert.equal(selected.get('gate').conclusion, 'failure');
});

test('polling waits for delayed required-check creation', async () => {
  let checkCalls = 0;
  let clock = 0;
  const probe = createGithubProbe({
    now: () => clock++,
    sleep: async () => {},
    runner: args => {
      const endpoint = args.find(arg => arg.includes('/commits/'));
      if (endpoint.includes('check-runs')) {
        checkCalls += 1;
        return JSON.stringify([{ check_runs: checkCalls === 1 ? [] : [successRun('gate')] }]);
      }
      return JSON.stringify([[]]);
    },
  });
  const result = await probe.fetchChecksForSha(SHA_A, {
    wait: true,
    timeoutSeconds: 20,
    pollSeconds: 5,
    requiredCheckNames: ['gate'],
    verifyCurrentSha: async () => SHA_A,
  });
  assert.equal(checkCalls, 2);
  assert.equal(result.checkRuns[0].name, 'gate');
});

test('polling rejects PR-head or main-ref changes during one snapshot', async () => {
  let identityCalls = 0;
  const probe = createGithubProbe({
    runner: args =>
      args.some(arg => arg.includes('check-runs'))
        ? JSON.stringify([{ check_runs: [successRun('gate')] }])
        : JSON.stringify([[]]),
  });
  await assert.rejects(
    () =>
      probe.fetchChecksForSha(SHA_A, {
        requiredCheckNames: ['gate'],
        verifyCurrentSha: async () => (++identityCalls === 1 ? SHA_A : SHA_B),
      }),
    error => error.code === 'OBSERVED_SHA_CHANGED'
  );
});

test('neutral required conclusion blocks unless explicitly configured for that check', () => {
  const neutral = {
    checkRuns: [successRun('gate', SHA_A, { conclusion: 'neutral' })],
    statuses: [],
  };
  const blocked = report();
  evaluateRequiredChecks(blocked, neutral, ['gate'], { gate: ['success'] }, SHA_A);
  assert.equal(blocked.blockers[0].code, 'CHECK_FAILED');
  const allowed = report();
  evaluateRequiredChecks(allowed, neutral, ['gate'], { gate: ['success', 'neutral'] }, SHA_A);
  assert.equal(allowed.blockers.length, 0);
});

test('missing, pending, stale, failed and successful checks have distinct decisions', () => {
  const cases = [
    [{ checkRuns: [], statuses: [] }, 'REQUIRED_CHECK_MISSING'],
    [
      {
        checkRuns: [successRun('gate', SHA_A, { status: 'in_progress', conclusion: null })],
        statuses: [],
      },
      'CHECK_PENDING',
    ],
    [{ checkRuns: [successRun('gate', SHA_B)], statuses: [] }, 'STALE_CHECK'],
    [
      { checkRuns: [successRun('gate', SHA_A, { conclusion: 'failure' })], statuses: [] },
      'CHECK_FAILED',
    ],
  ];
  for (const [checks, code] of cases) {
    const value = report();
    evaluateRequiredChecks(value, checks, ['gate'], { gate: ['success'] }, SHA_A);
    assert.equal(value.blockers[0].code, code);
  }
  const healthy = report();
  evaluateRequiredChecks(
    healthy,
    { checkRuns: [successRun('gate')], statuses: [] },
    ['gate'],
    { gate: ['success'] },
    SHA_A
  );
  assert.equal(healthy.blockers.length, 0);
});

test('final decision matrix preserves technical UNKNOWN and applies strict promotion', () => {
  const healthy = report('main');
  assert.equal(finalizeDecision(healthy, 'main', true), 'HEALTHY');
  const blocked = report();
  blocked.blockers.push({ code: 'X' });
  assert.equal(finalizeDecision(blocked, 'pr', false), 'BLOCKED');
  const unknown = report('main');
  unknown.unknowns.push({ code: 'X' });
  assert.equal(finalizeDecision(unknown, 'main', false), 'UNKNOWN');
  assert.equal(finalizeDecision(unknown, 'main', true), 'UNHEALTHY');
  assert.equal(unknown.technicalDecision, 'UNKNOWN');
  const warning = report();
  warning.warnings.push({ code: 'X' });
  assert.equal(finalizeDecision(warning, 'pr', false), 'READY');
  assert.equal(finalizeDecision(warning, 'pr', true), 'BLOCKED');
  assert.equal(warning.technicalDecision, 'READY');
});

test('PR happy path is offline and ready at the exact SHA', async () => {
  const cfg = config();
  const value = report();
  await evaluatePr({
    report: value,
    prNumber: 7,
    wait: true,
    timeoutSeconds: 20,
    pollSeconds: 5,
    config: cfg,
    probes: prProbes(cfg),
  });
  assert.equal(value.observedSha, SHA_A);
  assert.deepEqual(value.blockers, []);
  assert.deepEqual(value.unknowns, []);
});

test('PR policies cover draft, conflicts, behind main, changes and unresolved threads', async () => {
  const cfg = config();
  const base = prProbes(cfg);
  const value = report();
  await evaluatePr({
    report: value,
    prNumber: 7,
    wait: false,
    timeoutSeconds: 20,
    pollSeconds: 5,
    config: cfg,
    probes: prProbes(cfg, {
      fetchPrDetails: async () => ({
        ...(await base.fetchPrDetails()),
        isDraft: true,
        mergeable: 'CONFLICTING',
        mergeStateStatus: 'DIRTY',
        reviewDecision: 'CHANGES_REQUESTED',
      }),
      fetchCompare: async () => ({ behind_by: 2, ahead_by: 1 }),
      fetchReviewThreads: async () => [{ isResolved: false }],
    }),
  });
  const codes = new Set(value.blockers.map(item => item.code));
  for (const code of [
    'PR_IS_DRAFT',
    'PR_CONFLICTING',
    'PR_BEHIND_MAIN',
    'CHANGES_REQUESTED',
    'UNRESOLVED_REVIEW_THREADS',
  ])
    assert.ok(codes.has(code), code);
});

test('unknown mergeability, review permissions and head changes remain UNKNOWN evidence', async () => {
  const cfg = config();
  const base = prProbes(cfg);
  const value = report();
  await evaluatePr({
    report: value,
    prNumber: 7,
    wait: false,
    timeoutSeconds: 20,
    pollSeconds: 5,
    config: cfg,
    probes: prProbes(cfg, {
      fetchPrDetails: async () => ({ ...(await base.fetchPrDetails()), mergeable: 'UNKNOWN' }),
      fetchReviewThreads: async () => {
        throw new Error('denied');
      },
      fetchChecksForSha: async () => {
        const error = new Error('changed');
        error.code = 'OBSERVED_SHA_CHANGED';
        throw error;
      },
    }),
  });
  const codes = new Set(value.unknowns.map(item => item.code));
  for (const code of ['PR_MERGEABILITY_UNKNOWN', 'REVIEW_THREADS_UNKNOWN', 'PR_HEAD_CHANGED'])
    assert.ok(codes.has(code), code);
});

test('main uses commit-to-PR association and release policy', async () => {
  const cfg = config();
  const value = report('main');
  await evaluateMain({
    report: value,
    wait: true,
    timeoutSeconds: 20,
    pollSeconds: 5,
    config: cfg,
    probes: mainProbes(cfg, {
      fetchAssociatedPullRequests: async () => [],
      fetchReleases: async () => [{ tag_name: 'v0.1.0' }],
      fetchCompare: async () => ({ ahead_by: 1, behind_by: 0 }),
    }),
    packageVersion: '0.2.0',
  });
  assert.ok(value.warnings.some(item => item.code === 'DIRECT_MAIN_COMMIT'));
  assert.ok(value.warnings.some(item => item.code === 'RELEASE_VERSION_MISMATCH'));
});

test('main SHA changes are not reported healthy', async () => {
  const cfg = config();
  const value = report('main');
  const error = new Error('changed');
  error.code = 'OBSERVED_SHA_CHANGED';
  await evaluateMain({
    report: value,
    wait: true,
    timeoutSeconds: 20,
    pollSeconds: 5,
    config: cfg,
    probes: mainProbes(cfg, {
      fetchChecksForSha: async () => {
        throw error;
      },
    }),
  });
  assert.ok(value.unknowns.some(item => item.code === 'MAIN_SHA_CHANGED'));
});

test('overview classifies open, merged-retained, ahead and stale branches', async () => {
  const cfg = config();
  const branches = [
    { name: 'main', commit: { sha: SHA_A } },
    { name: 'open', commit: { sha: '1' } },
    { name: 'merged', commit: { sha: '2' } },
    { name: 'ahead', commit: { sha: '3' } },
    { name: 'stale', commit: { sha: '4' } },
  ];
  const probes = mainProbes(cfg, {
    fetchOpenPrs: async () => [{ headRefName: 'open' }],
    fetchBranches: async () => branches,
    fetchCompare: async (_base, sha) => ({
      ahead_by: sha === '4' ? 0 : 1,
      behind_by: sha === '4' ? 2 : 0,
    }),
    fetchAssociatedPullRequests: async sha =>
      sha === '2'
        ? [{ number: 2, merged_at: '2026-01-01' }]
        : sha === SHA_A
          ? [{ number: 1, merged_at: '2026-01-01' }]
          : [],
  });
  const value = report('overview');
  await evaluateOverview({
    report: value,
    wait: false,
    timeoutSeconds: 20,
    pollSeconds: 5,
    config: cfg,
    probes,
    packageVersion: '0.2.0-beta.2',
  });
  assert.deepEqual(
    value.branches.map(item => item.classification),
    ['OPEN_PR', 'MERGED_RETAINED', 'AHEAD_WITHOUT_PR', 'STALE']
  );
});

test('workflow propagates both PR and main gate exit codes with read-only permissions', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const controlSection = workflow.slice(workflow.indexOf('repository-control:'));
  assert.doesNotMatch(controlSection, /\|\|\s*true|continue-on-error/);
  assert.match(controlSection, /--scope pr[\s\S]*--wait[\s\S]*--strict/);
  assert.match(controlSection, /Repository Control Main[\s\S]*--scope main --wait --strict/);
  for (const permission of [
    'contents: read',
    'checks: read',
    'statuses: read',
    'pull-requests: read',
  ])
    assert.match(workflow, new RegExp(permission));
});

test('repository-control tests contain no live GitHub invocation', () => {
  const source = fs.readFileSync(__filename, 'utf8');
  assert.doesNotMatch(source, /spawnSync\(['"]gh['"]|execFileSync\(['"]gh['"]/);
});

test('all production gh execution is centralized behind the read-only allowlist', () => {
  const files = [
    SCRIPT,
    ...fs
      .readdirSync(path.join(ROOT, 'scripts/repository-control'))
      .filter(name => name.endsWith('.js'))
      .map(name => path.join(ROOT, 'scripts/repository-control', name)),
  ];
  const executors = files.filter(file =>
    /execFileSync\(['"]gh['"]/.test(fs.readFileSync(file, 'utf8'))
  );
  assert.deepEqual(executors, [path.join(ROOT, 'scripts/repository-control', 'githubProbe.js')]);
  assert.match(fs.readFileSync(executors[0], 'utf8'), /assertReadOnlyGhArgs\(args\)/);
});
