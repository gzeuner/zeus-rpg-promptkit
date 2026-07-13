'use strict';

const { execFileSync } = require('child_process');

function gh(args) {
  try {
    const out = execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
    return out.trim();
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    const err = new Error(`gh ${args.join(' ')} failed: ${stderr || e.message}`);
    err.status = e.status;
    err.stderr = stderr;
    throw err;
  }
}

function ghJson(args) {
  const out = gh([
    ...args,
    '--json',
    'number,url,state,isDraft,title,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,headRef',
  ]);
  return JSON.parse(out);
}

async function fetchPrDetails(prNumber) {
  // Use gh pr view for rich data
  const data = JSON.parse(
    gh([
      'pr',
      'view',
      String(prNumber),
      '--json',
      'number,url,state,isDraft,title,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup',
    ])
  );
  return data;
}

async function fetchChecksForSha(
  sha,
  { wait = false, timeoutSeconds = 1800, pollSeconds = 15 } = {}
) {
  // Use gh pr checks or workflow runs, but for exact SHA we use commit checks
  // gh api for check-runs on the commit
  const start = Date.now();
  let last = null;

  while (true) {
    try {
      const runs = JSON.parse(
        gh(['api', `repos/gzeuner/zeus-rpg-promptkit/commits/${sha}/check-runs?per_page=100`])
      );
      const checkRuns = runs.check_runs || [];

      // Also get combined status for legacy
      let combined = { statuses: [] };
      try {
        combined = JSON.parse(
          gh(['api', `repos/gzeuner/zeus-rpg-promptkit/commits/${sha}/status`])
        );
      } catch (_) {}

      const result = {
        sha,
        checkRuns: checkRuns.map(r => ({
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          started_at: r.started_at,
          completed_at: r.completed_at,
          details_url: r.details_url,
          head_sha: r.head_sha,
          attempt: r.run_attempt || 1,
        })),
        statuses: (combined.statuses || []).map(s => ({
          context: s.context,
          state: s.state,
          target_url: s.target_url,
          updated_at: s.updated_at,
        })),
      };

      last = result;

      if (!wait) return result;

      const pending = result.checkRuns.filter(c => ['queued', 'in_progress'].includes(c.status));
      const hasFailure = result.checkRuns.some(c =>
        ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(
          c.conclusion
        )
      );

      if (pending.length === 0 && !hasFailure) {
        return result;
      }

      if (Date.now() - start > timeoutSeconds * 1000) {
        return result;
      }

      await new Promise(r => setTimeout(r, pollSeconds * 1000));
    } catch (e) {
      if (!wait) throw e;
      if (Date.now() - start > timeoutSeconds * 1000) {
        if (last) return last;
        throw e;
      }
      await new Promise(r => setTimeout(r, pollSeconds * 1000));
    }
  }
}

async function fetchMainDetails(sha) {
  const commit = JSON.parse(gh(['api', `repos/gzeuner/zeus-rpg-promptkit/commits/${sha}`]));
  return {
    sha,
    message: commit.commit && commit.commit.message,
    author: commit.commit && commit.commit.author,
    committer: commit.commit && commit.commit.committer,
    html_url: commit.html_url,
  };
}

async function fetchCompare(base, head) {
  const cmp = JSON.parse(gh(['api', `repos/gzeuner/zeus-rpg-promptkit/compare/${base}...${head}`]));
  return {
    behind_by: cmp.behind_by,
    ahead_by: cmp.ahead_by,
    status: cmp.status,
    merge_base_commit: cmp.merge_base_commit && cmp.merge_base_commit.sha,
  };
}

async function fetchBranches() {
  return JSON.parse(gh(['api', 'repos/gzeuner/zeus-rpg-promptkit/branches?per_page=100']));
}

async function fetchReleases() {
  return JSON.parse(gh(['api', 'repos/gzeuner/zeus-rpg-promptkit/releases?per_page=20']));
}

module.exports = {
  fetchPrDetails,
  fetchChecksForSha,
  fetchMainDetails,
  fetchCompare,
  fetchBranches,
  fetchReleases,
};
