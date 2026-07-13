'use strict';

const { execFileSync } = require('child_process');

const DEFAULT_REPOSITORY = 'gzeuner/zeus-rpg-promptkit';
const FAILURE_CONCLUSIONS = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
]);

class GithubProbeError extends Error {
  constructor(message, code = 'GITHUB_PROBE_FAILED') {
    super(message);
    this.name = 'GithubProbeError';
    this.code = code;
  }
}

function redact(value) {
  return String(value || '')
    .replace(/(token|authorization|bearer)\s*[:=]?\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 1000);
}

function assertReadOnlyGhArgs(args) {
  if (!Array.isArray(args) || args.length === 0)
    throw new GithubProbeError('Empty gh invocation', 'WRITE_OPERATION_REJECTED');
  if (args[0] === 'pr' && ['view', 'list'].includes(args[1])) return;
  if (args[0] !== 'api')
    throw new GithubProbeError(
      `GitHub operation is not read-only: gh ${args.slice(0, 2).join(' ')}`,
      'WRITE_OPERATION_REJECTED'
    );
  const methodIndex = args.findIndex(value => value === '--method' || value === '-X');
  const method = methodIndex === -1 ? 'GET' : String(args[methodIndex + 1]).toUpperCase();
  if (method !== 'GET' && !(args.includes('graphql') && method === 'POST'))
    throw new GithubProbeError(
      'Non-read-only GitHub API operation rejected',
      'WRITE_OPERATION_REJECTED'
    );
  if (args.includes('graphql')) {
    const queryIndex = args.findIndex(
      value => value === '-f' && String(args[args.indexOf(value) + 1] || '').startsWith('query=')
    );
    const queryArg = args.find(value => typeof value === 'string' && value.startsWith('query='));
    if (queryIndex === -1 && !queryArg)
      throw new GithubProbeError(
        'GraphQL operation lacks an explicit query',
        'WRITE_OPERATION_REJECTED'
      );
    if (/\bmutation\b/i.test(queryArg || ''))
      throw new GithubProbeError('GraphQL mutation rejected', 'WRITE_OPERATION_REJECTED');
  }
}

function defaultRunner(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}

function createGithubProbe({
  repository = DEFAULT_REPOSITORY,
  runner = defaultRunner,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(),
} = {}) {
  const operations = [];

  function gh(args) {
    assertReadOnlyGhArgs(args);
    operations.push({ executable: 'gh', args: [...args], access: 'read-only' });
    try {
      return runner(args);
    } catch (error) {
      throw new GithubProbeError(`GitHub read failed: ${redact(error.stderr || error.message)}`);
    }
  }

  function apiJson(endpoint, extra = []) {
    const output = gh(['api', '--method', 'GET', endpoint, ...extra]);
    return JSON.parse(output || 'null');
  }

  function paginatedJson(endpoint) {
    const pages = apiJson(endpoint, ['--paginate', '--slurp']);
    return Array.isArray(pages) ? pages : [pages];
  }

  async function fetchPrDetails(prNumber) {
    return JSON.parse(
      gh([
        'pr',
        'view',
        String(prNumber),
        '--repo',
        repository,
        '--json',
        'number,url,state,isDraft,title,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,updatedAt',
      ])
    );
  }

  async function fetchRefSha(branch) {
    const ref = apiJson(`repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`);
    return ref && ref.object && ref.object.sha;
  }

  async function fetchReviewThreads(prNumber) {
    const [owner, name] = repository.split('/');
    const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{isResolved}pageInfo{hasNextPage endCursor}}}}}`;
    let cursor = null;
    const threads = [];
    do {
      const args = [
        'api',
        'graphql',
        '--method',
        'POST',
        '-f',
        `query=${query}`,
        '-F',
        `owner=${owner}`,
        '-F',
        `name=${name}`,
        '-F',
        `number=${prNumber}`,
      ];
      if (cursor) args.push('-F', `cursor=${cursor}`);
      const data = JSON.parse(gh(args));
      const connection = data.data.repository.pullRequest.reviewThreads;
      threads.push(...connection.nodes);
      cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (cursor);
    return threads;
  }

  async function snapshotChecks(sha) {
    const checkPages = paginatedJson(`repos/${repository}/commits/${sha}/check-runs?per_page=100`);
    const statusPages = paginatedJson(`repos/${repository}/commits/${sha}/statuses?per_page=100`);
    const checkRuns = checkPages.flatMap(page => (page && page.check_runs) || []);
    const statuses = statusPages.flatMap(page => (Array.isArray(page) ? page : []));
    return {
      sha,
      checkRuns: checkRuns.map(run => ({
        id: run.id,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        started_at: run.started_at,
        completed_at: run.completed_at,
        details_url: run.details_url,
        head_sha: run.head_sha,
        attempt: run.run_attempt || 1,
      })),
      statuses: statuses.map(status => ({
        id: status.id,
        context: status.context,
        state: status.state,
        target_url: status.target_url,
        updated_at: status.updated_at,
        sha: status.sha,
      })),
    };
  }

  async function fetchChecksForSha(
    sha,
    {
      wait = false,
      timeoutSeconds = 1800,
      pollSeconds = 15,
      requiredCheckNames = [],
      verifyCurrentSha,
    } = {}
  ) {
    const started = now();
    let last = null;
    while (true) {
      if (verifyCurrentSha) {
        const current = await verifyCurrentSha();
        if (String(current).toLowerCase() !== String(sha).toLowerCase())
          throw new GithubProbeError(
            `Observed identity changed from ${sha} to ${current}`,
            'OBSERVED_SHA_CHANGED'
          );
      }
      try {
        last = await snapshotChecks(sha);
      } catch (error) {
        if (!wait || now() - started >= timeoutSeconds * 1000) throw error;
        await sleep(pollSeconds * 1000);
        continue;
      }
      if (!wait) {
        if (verifyCurrentSha) {
          const current = await verifyCurrentSha();
          if (String(current).toLowerCase() !== String(sha).toLowerCase())
            throw new GithubProbeError(
              `Observed identity changed from ${sha} to ${current}`,
              'OBSERVED_SHA_CHANGED'
            );
        }
        return last;
      }
      const latest = selectLatestChecks(last.checkRuns);
      const required = requiredCheckNames.map(name => latest.get(name)).filter(Boolean);
      const allCreated = required.length === requiredCheckNames.length;
      const pending = required.some(run =>
        ['queued', 'in_progress', 'pending', 'requested', 'waiting'].includes(run.status)
      );
      const failed = required.some(run => FAILURE_CONCLUSIONS.has(run.conclusion));
      if ((allCreated && !pending) || failed || now() - started >= timeoutSeconds * 1000) {
        if (verifyCurrentSha) {
          const current = await verifyCurrentSha();
          if (String(current).toLowerCase() !== String(sha).toLowerCase())
            throw new GithubProbeError(
              `Observed identity changed from ${sha} to ${current}`,
              'OBSERVED_SHA_CHANGED'
            );
        }
        return last;
      }
      await sleep(pollSeconds * 1000);
    }
  }

  async function fetchMainDetails(sha) {
    const commit = apiJson(`repos/${repository}/commits/${sha}`);
    return {
      sha: commit.sha || sha,
      message: commit.commit && commit.commit.message,
      author: commit.commit && commit.commit.author,
      committer: commit.commit && commit.commit.committer,
      html_url: commit.html_url,
    };
  }

  async function fetchCompare(base, head) {
    const comparison = apiJson(
      `repos/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
    );
    return {
      behind_by: comparison.behind_by,
      ahead_by: comparison.ahead_by,
      status: comparison.status,
      merge_base_commit: comparison.merge_base_commit && comparison.merge_base_commit.sha,
    };
  }

  async function fetchBranches() {
    return paginatedJson(`repos/${repository}/branches?per_page=100`).flatMap(page =>
      Array.isArray(page) ? page : []
    );
  }

  async function fetchReleases() {
    return paginatedJson(`repos/${repository}/releases?per_page=100`).flatMap(page =>
      Array.isArray(page) ? page : []
    );
  }

  async function fetchOpenPrs() {
    return JSON.parse(
      gh([
        'pr',
        'list',
        '--repo',
        repository,
        '--state',
        'open',
        '--limit',
        '1000',
        '--json',
        'number,headRefName,headRefOid,state,isDraft,url',
      ])
    );
  }

  async function fetchAssociatedPullRequests(sha) {
    return paginatedJson(`repos/${repository}/commits/${sha}/pulls?per_page=100`).flatMap(page =>
      Array.isArray(page) ? page : []
    );
  }

  return {
    fetchPrDetails,
    fetchRefSha,
    fetchReviewThreads,
    fetchChecksForSha,
    fetchMainDetails,
    fetchCompare,
    fetchBranches,
    fetchReleases,
    fetchOpenPrs,
    fetchAssociatedPullRequests,
    getOperations: () => operations.map(item => ({ ...item, args: [...item.args] })),
  };
}

function selectLatestChecks(checkRuns) {
  const selected = new Map();
  for (const run of checkRuns) {
    const current = selected.get(run.name);
    const rank = [
      Number(run.attempt || 0),
      Date.parse(run.completed_at || run.started_at || 0) || 0,
      Number(run.id || 0),
    ];
    const currentRank = current
      ? [
          Number(current.attempt || 0),
          Date.parse(current.completed_at || current.started_at || 0) || 0,
          Number(current.id || 0),
        ]
      : [-1, -1, -1];
    if (
      rank[0] > currentRank[0] ||
      (rank[0] === currentRank[0] &&
        (rank[1] > currentRank[1] || (rank[1] === currentRank[1] && rank[2] > currentRank[2])))
    )
      selected.set(run.name, run);
  }
  return selected;
}

const defaultProbe = createGithubProbe();
module.exports = {
  DEFAULT_REPOSITORY,
  GithubProbeError,
  assertReadOnlyGhArgs,
  createGithubProbe,
  selectLatestChecks,
  ...defaultProbe,
};
