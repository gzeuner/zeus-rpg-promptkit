'use strict';

const { getRemoteMainSha, compareWithMain, getLocalSha } = require('./gitProbe');
const {
  fetchPrDetails,
  fetchChecksForSha,
  fetchMainDetails,
  fetchCompare,
  fetchBranches,
  fetchReleases,
} = require('./githubProbe');

function addBlocker(report, code, message, evidence = {}) {
  report.blockers.push({ code, message, ...evidence, source: 'evaluation' });
}

function addWarning(report, code, message, evidence = {}) {
  report.warnings.push({ code, message, ...evidence, source: 'evaluation' });
}

function addUnknown(report, code, message, evidence = {}) {
  report.unknowns.push({ code, message, ...evidence, source: 'evaluation' });
}

async function evaluatePr({
  report,
  prNumber,
  localSha,
  wait,
  timeoutSeconds,
  pollSeconds,
  strict,
  config,
}) {
  report.observedAt = report.reproducible ? 'REPRODUCIBLE' : new Date().toISOString();

  let pr;
  try {
    pr = await fetchPrDetails(prNumber);
  } catch (e) {
    addUnknown(report, 'PR_FETCH_FAILED', `Failed to fetch PR #${prNumber}`, {
      error: String(e.message || e),
    });
    report.decision = 'UNKNOWN';
    return;
  }

  report.pullRequests.push(pr);
  report.observedSha = pr.headRefOid;

  if (pr.state !== 'OPEN') {
    addBlocker(report, 'PR_NOT_OPEN', `PR #${prNumber} is not OPEN (state=${pr.state})`);
  }
  if (pr.isDraft) {
    addBlocker(report, 'PR_IS_DRAFT', 'Pull request is a draft');
  }
  if (pr.baseRefName !== config.defaultBranch) {
    addBlocker(
      report,
      'PR_WRONG_BASE',
      `Base branch is ${pr.baseRefName}, expected ${config.defaultBranch}`
    );
  }

  // Exact SHA comparison if local provided
  if (localSha) {
    const normalizedLocal = getLocalSha(localSha);
    if (!normalizedLocal) {
      addBlocker(report, 'LOCAL_SHA_INVALID', `--local-sha ${localSha} could not be resolved`);
    } else if (normalizedLocal.toLowerCase() !== String(pr.headRefOid).toLowerCase()) {
      addBlocker(report, 'SHA_MISMATCH', 'Local candidate SHA does not match remote PR head SHA', {
        local: normalizedLocal,
        remote: pr.headRefOid,
      });
    }
    report.localCandidateSha = normalizedLocal;
  }

  // Branch currency
  try {
    const cmp = await fetchCompare(config.defaultBranch, pr.headRefOid);
    report.branches.push({ ref: pr.headRefName, ...cmp });
    if (config.policies.prBehindMain && cmp.behind_by > 0) {
      addBlocker(
        report,
        'PR_BEHIND_MAIN',
        `PR head is ${cmp.behind_by} commits behind ${config.defaultBranch}`
      );
    }
  } catch (e) {
    addUnknown(report, 'COMPARE_FAILED', 'Could not compare PR head with main', {
      error: String(e.message),
    });
  }

  // Checks for exact head SHA
  let checks;
  try {
    checks = await fetchChecksForSha(pr.headRefOid, { wait, timeoutSeconds, pollSeconds });
  } catch (e) {
    addUnknown(report, 'CHECKS_FETCH_FAILED', 'Failed to retrieve checks for PR head SHA', {
      sha: pr.headRefOid,
      error: String(e.message),
    });
    checks = { checkRuns: [], statuses: [] };
  }

  report.checks = checks.checkRuns.concat(
    checks.statuses.map(s => ({ name: s.context, status: s.state }))
  );

  const required = config.requiredChecks.pullRequest || [];
  const seen = new Set();

  for (const req of required) {
    const matching = checks.checkRuns.filter(c => c.name === req);
    if (matching.length === 0) {
      addBlocker(
        report,
        'REQUIRED_CHECK_MISSING',
        `Required check "${req}" is missing for SHA ${pr.headRefOid}`
      );
      continue;
    }

    // Take the latest by completed_at or started_at
    const latest = matching.sort((a, b) => {
      const ta = new Date(a.completed_at || a.started_at || 0).getTime();
      const tb = new Date(b.completed_at || b.started_at || 0).getTime();
      return tb - ta;
    })[0];

    if (latest.head_sha !== pr.headRefOid) {
      addBlocker(report, 'STALE_CHECK', `Check "${req}" is not for the current PR head SHA`, {
        checkSha: latest.head_sha,
        prSha: pr.headRefOid,
      });
      continue;
    }

    if (['queued', 'in_progress'].includes(latest.status)) {
      addBlocker(report, 'CHECK_PENDING', `Required check "${req}" is still pending`);
      continue;
    }

    if (latest.conclusion && !['success', 'neutral'].includes(latest.conclusion)) {
      addBlocker(report, 'CHECK_FAILED', `Required check "${req}" concluded ${latest.conclusion}`, {
        url: latest.details_url,
      });
    }

    seen.add(req);
  }

  // Reviews
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    addBlocker(report, 'CHANGES_REQUESTED', 'Review decision is CHANGES_REQUESTED');
  }

  // If we have unknowns that are critical
  if (strict && report.unknowns.length > 0) {
    // already will be treated as block in final decision
  }

  report.decision = report.blockers.length === 0 ? 'READY' : 'BLOCKED';
}

async function evaluateMain({ report, wait, timeoutSeconds, pollSeconds, strict, config }) {
  report.observedAt = report.reproducible ? 'REPRODUCIBLE' : new Date().toISOString();

  let mainSha;
  try {
    mainSha = (await fetchMainDetails('HEAD')).sha; // better to use git or explicit
  } catch (_) {
    // fallback
  }

  // Prefer asking git for the remote main we are comparing against
  const remoteMain = require('./gitProbe').getRemoteMainSha
    ? require('./gitProbe').getRemoteMainSha()
    : null;

  const sha = remoteMain || mainSha;

  if (!sha) {
    addUnknown(report, 'MAIN_SHA_UNKNOWN', 'Could not determine current origin/main SHA');
    report.decision = 'UNKNOWN';
    return;
  }

  report.observedSha = sha;
  report.main = await fetchMainDetails(sha);

  let checks;
  try {
    checks = await fetchChecksForSha(sha, { wait, timeoutSeconds, pollSeconds });
  } catch (e) {
    addUnknown(report, 'MAIN_CHECKS_FAILED', 'Failed to fetch checks for current main SHA', {
      sha,
      error: String(e.message),
    });
    checks = { checkRuns: [], statuses: [] };
  }

  report.checks = checks.checkRuns;

  const required = config.requiredChecks.main || [];
  for (const req of required) {
    const match = checks.checkRuns.find(c => c.name === req && c.head_sha === sha);
    if (!match) {
      addBlocker(
        report,
        'REQUIRED_MAIN_CHECK_MISSING',
        `Required main check "${req}" missing or not on current SHA ${sha}`
      );
      continue;
    }
    if (['queued', 'in_progress'].includes(match.status)) {
      addBlocker(report, 'MAIN_CHECK_PENDING', `Main check "${req}" pending on ${sha}`);
    } else if (match.conclusion && match.conclusion !== 'success') {
      addBlocker(report, 'MAIN_CHECK_FAILED', `Main check "${req}" ${match.conclusion}`, {
        url: match.details_url,
      });
    }
  }

  // Direct push detection (best effort)
  try {
    const associated = await fetchCompare('HEAD~1', sha); // rough
    // In practice we rely on GitHub PR association in overview
  } catch (_) {}

  report.decision = report.blockers.length === 0 ? 'HEALTHY' : 'UNHEALTHY';
}

async function evaluateOverview({ report, wait, timeoutSeconds, pollSeconds, strict, config }) {
  report.observedAt = report.reproducible ? 'REPRODUCIBLE' : new Date().toISOString();

  // Main health (light)
  let mainSha;
  try {
    mainSha = require('./gitProbe').getRemoteMainSha();
    report.main = { sha: mainSha };
    const mainChecks = await fetchChecksForSha(mainSha, { wait: false });
    report.checks.push(...mainChecks.checkRuns);
  } catch (e) {
    addUnknown(report, 'MAIN_PROBE_FAILED', 'Could not probe current main', {
      error: String(e.message),
    });
  }

  // Open PRs
  try {
    const openPrs = JSON.parse(
      require('child_process').execFileSync(
        'gh',
        ['pr', 'list', '--state', 'open', '--json', 'number,headRefName,headRefOid,state,isDraft'],
        { encoding: 'utf8' }
      )
    );
    report.pullRequests = openPrs;
  } catch (e) {
    addUnknown(report, 'OPEN_PR_LIST_FAILED', 'Could not list open PRs');
  }

  // Branches
  try {
    const branches = await require('./githubProbe').fetchBranches();
    for (const b of branches) {
      if (b.name === config.defaultBranch) continue;
      const cmp = await require('./githubProbe')
        .fetchCompare(config.defaultBranch, b.commit.sha)
        .catch(() => ({}));
      const classification = cmp.behind_by > 0 ? 'BEHIND_MAIN' : 'AHEAD_WITHOUT_PR';
      report.branches.push({
        name: b.name,
        sha: b.commit.sha,
        classification,
        behind: cmp.behind_by,
        ahead: cmp.ahead_by,
      });
    }
  } catch (e) {
    addUnknown(report, 'BRANCH_LIST_FAILED', 'Could not list branches');
  }

  // Release
  try {
    const releases = await require('./githubProbe').fetchReleases();
    report.release = releases[0] || null;
  } catch (e) {}

  if (report.blockers.length === 0 && report.unknowns.length === 0) {
    report.decision = 'HEALTHY';
  } else if (report.blockers.length > 0) {
    report.decision = 'UNHEALTHY';
  } else {
    report.decision = 'UNKNOWN';
  }
}

module.exports = {
  evaluatePr,
  evaluateMain,
  evaluateOverview,
};
