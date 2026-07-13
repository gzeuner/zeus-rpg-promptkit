'use strict';

const defaultProbes = require('./githubProbe');
const { getLocalSha } = require('./gitProbe');

function addBlocker(report, code, message, evidence = {}) {
  report.blockers.push({ code, message, ...evidence, source: 'evaluation' });
}
function addWarning(report, code, message, evidence = {}) {
  report.warnings.push({ code, message, ...evidence, source: 'evaluation' });
}
function addUnknown(report, code, message, evidence = {}) {
  report.unknowns.push({ code, message, ...evidence, source: 'evaluation' });
}

function applyPolicy(report, level, code, message, evidence = {}) {
  if (level === 'block') addBlocker(report, code, message, evidence);
  else if (level === 'warning') addWarning(report, code, message, evidence);
}

function errorEvidence(error) {
  return {
    errorCode: error && error.code ? error.code : 'PROBE_FAILED',
    error: String((error && error.message) || error).slice(0, 1000),
  };
}

function finalizeDecision(report, scope, strict) {
  if (report.blockers.length > 0) {
    report.technicalDecision = scope === 'pr' ? 'BLOCKED' : 'UNHEALTHY';
  } else if (report.unknowns.length > 0) {
    report.technicalDecision = 'UNKNOWN';
  } else {
    report.technicalDecision = scope === 'pr' ? 'READY' : 'HEALTHY';
  }
  report.decision = report.technicalDecision;
  if (strict && (report.unknowns.length > 0 || report.warnings.length > 0)) {
    report.decision = scope === 'pr' ? 'BLOCKED' : 'UNHEALTHY';
  }
  return report.decision;
}

function evaluateRequiredChecks(report, checks, required, allowedByName, sha, prefix = '') {
  const latest = defaultProbes.selectLatestChecks(checks.checkRuns || []);
  for (const name of required) {
    const run = latest.get(name);
    const codePrefix = prefix ? `${prefix}_` : '';
    if (!run) {
      addBlocker(
        report,
        `${codePrefix}REQUIRED_CHECK_MISSING`,
        `Required check "${name}" is missing for ${sha}`
      );
      continue;
    }
    if (String(run.head_sha).toLowerCase() !== String(sha).toLowerCase()) {
      addBlocker(
        report,
        `${codePrefix}STALE_CHECK`,
        `Required check "${name}" is not for observed SHA`,
        { checkSha: run.head_sha, observedSha: sha }
      );
      continue;
    }
    if (['queued', 'in_progress', 'pending', 'requested', 'waiting'].includes(run.status)) {
      addBlocker(report, `${codePrefix}CHECK_PENDING`, `Required check "${name}" is ${run.status}`);
      continue;
    }
    const allowed = allowedByName[name] || [];
    if (!run.conclusion || !allowed.includes(run.conclusion)) {
      addBlocker(
        report,
        `${codePrefix}CHECK_FAILED`,
        `Required check "${name}" concluded ${run.conclusion || 'without a conclusion'}`,
        { allowedConclusions: allowed, url: run.details_url }
      );
    }
  }
}

async function evaluatePr({
  report,
  prNumber,
  localSha,
  wait,
  timeoutSeconds,
  pollSeconds,
  config,
  probes = defaultProbes,
}) {
  let pr;
  try {
    pr = await probes.fetchPrDetails(prNumber);
  } catch (error) {
    addUnknown(report, 'PR_FETCH_FAILED', `Failed to fetch PR #${prNumber}`, errorEvidence(error));
    return;
  }
  report.pullRequests = [pr];
  report.observedSha = pr.headRefOid;
  const observedSha = pr.headRefOid;

  if (pr.state !== 'OPEN')
    addBlocker(report, 'PR_NOT_OPEN', `PR #${prNumber} is not open`, { state: pr.state });
  if (pr.isDraft)
    applyPolicy(report, config.policies.draftPullRequest, 'PR_IS_DRAFT', 'Pull request is a draft');
  if (pr.baseRefName !== config.defaultBranch)
    addBlocker(
      report,
      'PR_WRONG_BASE',
      `Base branch is ${pr.baseRefName}, expected ${config.defaultBranch}`
    );
  if (pr.mergeable === 'CONFLICTING')
    applyPolicy(
      report,
      config.policies.mergeability,
      'PR_CONFLICTING',
      'Pull request has merge conflicts'
    );
  else if (!pr.mergeable || pr.mergeable === 'UNKNOWN')
    addUnknown(
      report,
      'PR_MERGEABILITY_UNKNOWN',
      'GitHub has not determined pull-request mergeability'
    );
  const badMergeStates = new Set(['DIRTY', 'BLOCKED']);
  if (badMergeStates.has(pr.mergeStateStatus))
    applyPolicy(
      report,
      config.policies.mergeState,
      'PR_MERGE_STATE_BLOCKED',
      `Pull request merge state is ${pr.mergeStateStatus}`
    );
  else if (!pr.mergeStateStatus || pr.mergeStateStatus === 'UNKNOWN')
    addUnknown(report, 'PR_MERGE_STATE_UNKNOWN', 'GitHub merge state is unknown');

  if (localSha) {
    const normalized = getLocalSha(localSha);
    report.localCandidateSha = normalized;
    if (!normalized)
      addBlocker(report, 'LOCAL_SHA_INVALID', `--local-sha ${localSha} cannot be resolved`);
    else if (normalized.toLowerCase() !== observedSha.toLowerCase())
      addBlocker(report, 'SHA_MISMATCH', 'Local candidate SHA does not match remote PR head SHA', {
        local: normalized,
        remote: observedSha,
      });
  }

  try {
    const comparison = await probes.fetchCompare(config.defaultBranch, observedSha);
    report.branches.push({ ref: pr.headRefName, ...comparison });
    if (config.policies.branchMustContainMain && comparison.behind_by > 0)
      applyPolicy(
        report,
        config.policies.prBehindMain,
        'PR_BEHIND_MAIN',
        `PR head is ${comparison.behind_by} commits behind ${config.defaultBranch}`
      );
  } catch (error) {
    addUnknown(
      report,
      'COMPARE_FAILED',
      'Could not compare PR head with main',
      errorEvidence(error)
    );
  }

  try {
    const threads = await probes.fetchReviewThreads(prNumber);
    const unresolved = threads.filter(thread => !thread.isResolved).length;
    if (unresolved)
      applyPolicy(
        report,
        config.policies.unresolvedReviewThreads,
        'UNRESOLVED_REVIEW_THREADS',
        `Pull request has ${unresolved} unresolved review thread(s)`,
        { count: unresolved }
      );
  } catch (error) {
    addUnknown(
      report,
      'REVIEW_THREADS_UNKNOWN',
      'Could not determine unresolved review threads',
      errorEvidence(error)
    );
  }
  if (pr.reviewDecision === 'CHANGES_REQUESTED')
    applyPolicy(
      report,
      config.policies.changesRequested,
      'CHANGES_REQUESTED',
      'Review decision is CHANGES_REQUESTED'
    );

  try {
    const verifyCurrentSha = async () => (await probes.fetchPrDetails(prNumber)).headRefOid;
    const checks = await probes.fetchChecksForSha(observedSha, {
      wait,
      timeoutSeconds,
      pollSeconds,
      requiredCheckNames: config.requiredChecks.pullRequest,
      verifyCurrentSha,
    });
    report.checks = [
      ...checks.checkRuns,
      ...checks.statuses.map(status => ({
        name: status.context,
        status: status.state,
        head_sha: status.sha,
      })),
    ];
    evaluateRequiredChecks(
      report,
      checks,
      config.requiredChecks.pullRequest,
      config.checkConclusions.pullRequest,
      observedSha
    );
  } catch (error) {
    const code = error.code === 'OBSERVED_SHA_CHANGED' ? 'PR_HEAD_CHANGED' : 'CHECKS_FETCH_FAILED';
    addUnknown(report, code, 'Could not obtain stable checks for the observed PR SHA', {
      sha: observedSha,
      ...errorEvidence(error),
    });
  }
}

async function evaluateMain({
  report,
  wait,
  timeoutSeconds,
  pollSeconds,
  config,
  probes = defaultProbes,
  packageVersion = require('../../package.json').version,
}) {
  let sha;
  try {
    sha = await probes.fetchRefSha(config.defaultBranch);
  } catch (error) {
    addUnknown(
      report,
      'MAIN_SHA_UNKNOWN',
      'Could not determine remote main SHA',
      errorEvidence(error)
    );
    return;
  }
  if (!sha) {
    addUnknown(report, 'MAIN_SHA_UNKNOWN', 'Remote main ref did not contain a SHA');
    return;
  }
  report.observedSha = sha;
  try {
    report.main = await probes.fetchMainDetails(sha);
  } catch (error) {
    addUnknown(
      report,
      'MAIN_DETAILS_FAILED',
      'Could not retrieve main commit details',
      errorEvidence(error)
    );
  }

  try {
    const checks = await probes.fetchChecksForSha(sha, {
      wait,
      timeoutSeconds,
      pollSeconds,
      requiredCheckNames: config.requiredChecks.main,
      verifyCurrentSha: () => probes.fetchRefSha(config.defaultBranch),
    });
    report.checks = [
      ...checks.checkRuns,
      ...checks.statuses.map(status => ({
        name: status.context,
        status: status.state,
        head_sha: status.sha,
      })),
    ];
    evaluateRequiredChecks(
      report,
      checks,
      config.requiredChecks.main,
      config.checkConclusions.main,
      sha,
      'MAIN'
    );
  } catch (error) {
    const code = error.code === 'OBSERVED_SHA_CHANGED' ? 'MAIN_SHA_CHANGED' : 'MAIN_CHECKS_FAILED';
    addUnknown(report, code, 'Could not obtain stable checks for the observed main SHA', {
      sha,
      ...errorEvidence(error),
    });
  }

  try {
    const associated = await probes.fetchAssociatedPullRequests(sha);
    report.main = {
      ...(report.main || { sha }),
      associatedPullRequests: associated.map(pr => ({
        number: pr.number,
        url: pr.html_url,
        mergedAt: pr.merged_at,
      })),
    };
    if (!associated.some(pr => pr.merged_at))
      applyPolicy(
        report,
        config.policies.directMainCommit,
        'DIRECT_MAIN_COMMIT',
        `Main commit ${sha} is not associated with a merged pull request`
      );
  } catch (error) {
    addUnknown(
      report,
      'MAIN_PR_ASSOCIATION_UNKNOWN',
      'Could not determine commit-to-PR association',
      errorEvidence(error)
    );
  }

  try {
    const releases = await probes.fetchReleases();
    report.release = releases[0] || null;
    if (report.release) {
      const tagVersion = String(report.release.tag_name || '').replace(/^v/, '');
      if (tagVersion !== packageVersion)
        applyPolicy(
          report,
          config.policies.releaseVersionMismatch,
          'RELEASE_VERSION_MISMATCH',
          `Latest release ${tagVersion || '(untagged)'} differs from package ${packageVersion}`,
          { releaseTag: report.release.tag_name, packageVersion }
        );
      if (report.release.tag_name) {
        const comparison = await probes.fetchCompare(report.release.tag_name, sha);
        report.release = {
          ...report.release,
          mainAheadBy: comparison.ahead_by,
          mainBehindBy: comparison.behind_by,
          consistency:
            comparison.behind_by > 0
              ? 'RELEASE_NOT_ANCESTOR_OF_MAIN'
              : 'MAIN_AT_OR_AHEAD_OF_RELEASE',
        };
        if (comparison.behind_by > 0)
          applyPolicy(
            report,
            config.policies.releaseVersionMismatch,
            'RELEASE_NOT_ON_MAIN',
            `Latest release ${report.release.tag_name} is not an ancestor of main`
          );
      }
    }
  } catch (error) {
    addUnknown(
      report,
      'RELEASE_EVALUATION_UNKNOWN',
      'Could not evaluate release consistency',
      errorEvidence(error)
    );
  }
}

async function evaluateOverview({
  report,
  wait,
  timeoutSeconds,
  pollSeconds,
  config,
  probes = defaultProbes,
  packageVersion,
}) {
  await evaluateMain({
    report,
    wait,
    timeoutSeconds,
    pollSeconds,
    config,
    probes,
    ...(packageVersion ? { packageVersion } : {}),
  });
  try {
    report.pullRequests = await probes.fetchOpenPrs();
  } catch (error) {
    addUnknown(
      report,
      'OPEN_PR_LIST_FAILED',
      'Could not list open pull requests',
      errorEvidence(error)
    );
  }
  try {
    const openHeads = new Set(report.pullRequests.map(pr => pr.headRefName));
    const branches = await probes.fetchBranches();
    for (const branch of branches) {
      if (branch.name === config.defaultBranch) continue;
      let comparison;
      try {
        comparison = await probes.fetchCompare(config.defaultBranch, branch.commit.sha);
      } catch (error) {
        addUnknown(
          report,
          'BRANCH_COMPARE_FAILED',
          `Could not classify branch ${branch.name}`,
          errorEvidence(error)
        );
        continue;
      }
      let associated = [];
      try {
        associated = await probes.fetchAssociatedPullRequests(branch.commit.sha);
      } catch (error) {
        addUnknown(
          report,
          'BRANCH_PR_ASSOCIATION_UNKNOWN',
          `Could not find PR association for ${branch.name}`,
          errorEvidence(error)
        );
      }
      const merged = associated.filter(pr => pr.merged_at);
      const classification = openHeads.has(branch.name)
        ? 'OPEN_PR'
        : merged.length
          ? 'MERGED_RETAINED'
          : comparison.ahead_by > 0
            ? 'AHEAD_WITHOUT_PR'
            : 'STALE';
      report.branches.push({
        name: branch.name,
        sha: branch.commit.sha,
        classification,
        behind: comparison.behind_by,
        ahead: comparison.ahead_by,
        associatedPullRequests: associated.map(pr => pr.number),
      });
      if (classification === 'MERGED_RETAINED' && config.policies.mergedBranchRetentionDays === 0)
        addWarning(
          report,
          'MERGED_BRANCH_RETAINED',
          `Merged branch ${branch.name} is still present`
        );
    }
  } catch (error) {
    addUnknown(report, 'BRANCH_LIST_FAILED', 'Could not list branches', errorEvidence(error));
  }
}

module.exports = {
  addBlocker,
  addUnknown,
  addWarning,
  applyPolicy,
  evaluateMain,
  evaluateOverview,
  evaluatePr,
  evaluateRequiredChecks,
  finalizeDecision,
};
