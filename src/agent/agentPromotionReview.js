'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { sanitizeValue } = require('../security/secretMasking');
const { validateWorkspacePath } = require('../generationValidation/pathSafety');

const AGENT_PROMOTION_REVIEW_SCHEMA_VERSION = 1;
const MAX_REVIEW_FILE_BYTES = 128 * 1024;
const MAX_DIFF_PREVIEW_LINES = 40;

function promotionReviewError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveReviewPath({ cwd = process.cwd(), rawPath, defaultPath = null, label }) {
  const requested = String(rawPath || defaultPath || '').trim();
  if (!requested) {
    throw promotionReviewError('TOOL_INVALID_ARGUMENTS', `${label} path is required.`);
  }
  const result = validateWorkspacePath(requested, {
    workspaceRoot: path.resolve(String(cwd || process.cwd())),
    allowedRelativeRoots: ['.'],
    allowAbsolute: false,
  });
  if (!result.ok) {
    throw promotionReviewError(
      'PATH_OUTSIDE_WORKSPACE',
      `${label} must be a workspace-relative path without traversal.`
    );
  }
  return result;
}

function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\r\n?/g, '\n');
}

function hashText(value) {
  return crypto.createHash('sha256').update(normalizeText(value), 'utf8').digest('hex');
}

function readReviewFile(location, label) {
  let stats;
  try {
    stats = fs.statSync(location.absolutePath);
  } catch {
    throw promotionReviewError('PROMOTION_FILE_MISSING', `${label} does not exist.`);
  }
  if (!stats.isFile()) {
    throw promotionReviewError('PROMOTION_FILE_INVALID', `${label} must be a regular file.`);
  }
  if (stats.size > MAX_REVIEW_FILE_BYTES) {
    throw promotionReviewError(
      'PROMOTION_FILE_TOO_LARGE',
      `${label} exceeds the ${MAX_REVIEW_FILE_BYTES}-byte review limit.`
    );
  }

  const content = fs.readFileSync(location.absolutePath, 'utf8');
  if (sanitizeValue(content) !== content) {
    throw promotionReviewError(
      'PROMOTION_FILE_UNSANITIZED',
      `${label} contains a value that would be redacted; do not review credential-bearing content.`
    );
  }
  return {
    path: location.relativePath,
    absolutePath: location.absolutePath,
    content,
    normalizedContent: normalizeText(content),
    sha256: hashText(content),
  };
}

function parseJsonFile(file, label) {
  try {
    return JSON.parse(file.content);
  } catch {
    throw promotionReviewError('PROMOTION_FILE_INVALID', `${label} must contain valid JSON.`);
  }
}

function uniqueStrings(values) {
  return [
    ...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim())),
  ]
    .filter(Boolean)
    .sort();
}

function getReviewFindings(candidate) {
  const candidateChanges = Array.isArray(candidate?.candidateChanges)
    ? candidate.candidateChanges.filter(value => value && typeof value === 'object')
    : [];
  const evaluationFindings = Array.isArray(candidate?.evaluationFindings)
    ? candidate.evaluationFindings.filter(value => value && typeof value === 'object')
    : [];
  return { candidateChanges, evaluationFindings };
}

function countLines(lines) {
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1);
  return counts;
}

function countDelta(beforeLines, afterLines) {
  const before = countLines(beforeLines);
  const after = countLines(afterLines);
  let count = 0;
  for (const [line, amount] of after.entries()) {
    count += Math.max(0, amount - (before.get(line) || 0));
  }
  return count;
}

function buildContractDiff(beforeFile, afterFile) {
  const beforeLines = beforeFile.normalizedContent.split('\n');
  const afterLines = afterFile.normalizedContent.split('\n');
  const preview = [];
  const lineCount = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < lineCount && preview.length < MAX_DIFF_PREVIEW_LINES; index += 1) {
    const before = beforeLines[index];
    const after = afterLines[index];
    if (before !== after) {
      preview.push({
        line: index + 1,
        before: before === undefined ? null : sanitizeValue(before),
        after: after === undefined ? null : sanitizeValue(after),
      });
    }
  }

  return {
    changed: beforeFile.normalizedContent !== afterFile.normalizedContent,
    before: {
      path: beforeFile.path,
      sha256: beforeFile.sha256,
      lineCount: beforeLines.length,
    },
    after: {
      path: afterFile.path,
      sha256: afterFile.sha256,
      lineCount: afterLines.length,
    },
    addedLines: countDelta(beforeLines, afterLines),
    removedLines: countDelta(afterLines, beforeLines),
    preview,
    previewTruncated: preview.length >= MAX_DIFF_PREVIEW_LINES && lineCount > preview.length,
  };
}

function validateFixture(fixture) {
  const blockers = [];
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
    return ['FIXTURE_SCHEMA_INVALID'];
  }
  if (fixture.schemaVersion !== AGENT_PROMOTION_REVIEW_SCHEMA_VERSION) {
    blockers.push('FIXTURE_SCHEMA_INVALID');
  }
  if (fixture.kind !== 'agent-regression-fixture') blockers.push('FIXTURE_KIND_INVALID');
  if (fixture.sanitized !== true) blockers.push('FIXTURE_NOT_MARKED_SANITIZED');
  if (fixture.containsCredentials !== false) blockers.push('FIXTURE_CREDENTIAL_FLAG_MISSING');
  if (fixture.containsPrivateProjectIdentifiers !== false) {
    blockers.push('FIXTURE_PRIVATE_CONTENT_FLAG_MISSING');
  }
  if (!String(fixture.fixtureId || '').trim()) blockers.push('FIXTURE_ID_MISSING');
  const assertions = Array.isArray(fixture.assertions)
    ? fixture.assertions.filter(value => typeof value === 'string' && value.trim())
    : [];
  if (assertions.length === 0) blockers.push('FIXTURE_ASSERTIONS_MISSING');
  const scenarios = uniqueStrings([
    fixture.scenarioId,
    ...(Array.isArray(fixture.scenarios) ? fixture.scenarios : []),
  ]);
  if (scenarios.length === 0) blockers.push('FIXTURE_SCENARIO_MISSING');
  return { blockers, assertions, scenarios };
}

function buildAgentPromotionReview({
  cwd = process.cwd(),
  candidatePath = '.zeus/agent-feedback.json',
  beforePath,
  afterPath,
  fixturePath,
} = {}) {
  const candidateLocation = resolveReviewPath({
    cwd,
    rawPath: candidatePath,
    label: 'candidate',
  });
  const beforeLocation = resolveReviewPath({ cwd, rawPath: beforePath, label: 'contract before' });
  const afterLocation = resolveReviewPath({ cwd, rawPath: afterPath, label: 'contract after' });
  const fixtureLocation = resolveReviewPath({ cwd, rawPath: fixturePath, label: 'fixture' });

  const candidateFile = readReviewFile(candidateLocation, 'candidate');
  const beforeFile = readReviewFile(beforeLocation, 'contract before');
  const afterFile = readReviewFile(afterLocation, 'contract after');
  const fixtureFile = readReviewFile(fixtureLocation, 'fixture');

  const candidate = parseJsonFile(candidateFile, 'candidate');
  const fixture = parseJsonFile(fixtureFile, 'fixture');
  const { candidateChanges, evaluationFindings } = getReviewFindings(candidate);
  const findings = [...candidateChanges, ...evaluationFindings];
  const blockers = [];

  if (findings.length === 0) blockers.push('NO_REVIEWABLE_FINDINGS');
  if (candidate.review?.automaticPromotion === true) {
    blockers.push('AUTOMATIC_PROMOTION_NOT_ALLOWED');
  }

  const reviewableStatuses = findings.filter(
    finding => finding.status === 'candidate' || finding.confirmed === true
  );
  if (reviewableStatuses.length !== findings.length) blockers.push('FINDINGS_NOT_CONFIRMED');

  const scenarios = uniqueStrings(findings.map(finding => finding.regressionScenario));
  if (scenarios.length === 0) blockers.push('REGRESSION_SCENARIO_MISSING');

  const fixtureCheck = validateFixture(fixture);
  if (Array.isArray(fixtureCheck)) blockers.push(...fixtureCheck);
  else {
    blockers.push(...fixtureCheck.blockers);
    const missingScenarios = scenarios.filter(
      scenario => !fixtureCheck.scenarios.includes(scenario)
    );
    if (missingScenarios.length > 0) blockers.push('FIXTURE_SCENARIO_MISMATCH');
  }

  const contractDiff = buildContractDiff(beforeFile, afterFile);
  if (!contractDiff.changed) blockers.push('CONTRACT_DIFF_MISSING');

  const uniqueBlockers = uniqueStrings(blockers);
  const eligible = uniqueBlockers.length === 0;
  return {
    ok: true,
    operation: 'feedback-promotion-review',
    service: 'zeus-rpg-promptkit',
    schemaVersion: AGENT_PROMOTION_REVIEW_SCHEMA_VERSION,
    transport: 'cli',
    canonicalSurface: 'cli',
    mcpOptional: true,
    readOnly: true,
    executionStarted: false,
    candidate: {
      path: candidateFile.path,
      sha256: candidateFile.sha256,
      schemaVersion: candidate.schemaVersion || null,
      candidateChangeCount: candidateChanges.length,
      evaluationFindingCount: evaluationFindings.length,
      reviewableFindingCount: reviewableStatuses.length,
      regressionScenarios: scenarios,
    },
    regressionFixture: {
      path: fixtureFile.path,
      sha256: fixtureFile.sha256,
      fixtureId: String(fixture.fixtureId || '').trim() || null,
      scenarios: Array.isArray(fixtureCheck) ? [] : fixtureCheck.scenarios,
      assertions: Array.isArray(fixtureCheck) ? [] : fixtureCheck.assertions.length,
      sanitized: fixture.sanitized === true,
    },
    contractDiff,
    review: {
      eligible,
      automaticPromotion: false,
      blockers: uniqueBlockers,
      policy:
        'Promotion requires a confirmed candidate, a sanitized regression fixture for every regression scenario, and a non-empty explicit contract diff. This command never applies the change.',
    },
    nextSafeStep: eligible
      ? 'Apply the reviewed contract diff manually, run the regression fixture and tests, then record the merge reference.'
      : 'Resolve every promotion blocker, keep the fixture sanitized, and run the review again before changing an authoritative contract.',
  };
}

module.exports = {
  AGENT_PROMOTION_REVIEW_SCHEMA_VERSION,
  MAX_REVIEW_FILE_BYTES,
  buildAgentPromotionReview,
  buildContractDiff,
  promotionReviewError,
  resolveReviewPath,
};
