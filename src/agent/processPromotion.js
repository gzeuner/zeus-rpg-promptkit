'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { redactAgentText } = require('./agentExperience');
const { validateWorkspacePath } = require('../generationValidation/pathSafety');

const PROCESS_PROMOTION_SCHEMA_VERSION = 1;
const DEFAULT_PROCESS_PROMOTION_ARTIFACT = '.zeus/process-promotion-readiness.json';
const MAX_INPUT_ARTIFACTS = 20;
const MAX_FIXTURES = 50;
const MAX_CANDIDATES = 50;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

function processPromotionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap(item => String(item == null ? '' : item).split(','))
    .map(item => item.trim())
    .filter(Boolean);
}

function resolvePromotionJsonPath({ cwd = process.cwd(), input, label }) {
  const raw = String(input || '').trim();
  const result = validateWorkspacePath(raw, {
    workspaceRoot: path.resolve(String(cwd || process.cwd())),
    allowedRelativeRoots: ['.zeus'],
    allowAbsolute: false,
  });
  if (!result.ok || !result.relativePath.toLowerCase().endsWith('.json')) {
    throw processPromotionError(
      'PATH_OUTSIDE_WORKSPACE',
      `${label} must be a relative JSON path inside .zeus/.`
    );
  }
  return result;
}

function readBoundedJson(location, label) {
  if (!fs.existsSync(location.absolutePath)) {
    throw processPromotionError('PROCESS_PROMOTION_INPUT_MISSING', `${label} does not exist.`);
  }
  const stats = fs.statSync(location.absolutePath);
  if (!stats.isFile() || stats.size > MAX_ARTIFACT_BYTES) {
    throw processPromotionError(
      'PROCESS_PROMOTION_INPUT_INVALID',
      `${label} must be a regular JSON file no larger than 2 MiB.`
    );
  }
  try {
    return JSON.parse(fs.readFileSync(location.absolutePath, 'utf8'));
  } catch {
    throw processPromotionError('PROCESS_PROMOTION_INPUT_INVALID', `${label} is not valid JSON.`);
  }
}

function normalizedCandidateKey(candidate) {
  const glossaryTerms = Array.isArray(candidate.glossaryTerms)
    ? candidate.glossaryTerms
        .map(term => redactAgentText(term).toLocaleLowerCase('de-DE'))
        .filter(Boolean)
        .sort()
        .join(',')
    : '';
  return [
    redactAgentText(candidate.issue).toLowerCase(),
    redactAgentText(candidate.targetSurface).toLowerCase(),
    glossaryTerms,
  ].join('|');
}

function stableCandidateId(key) {
  return `process-improvement:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function readImprovementArtifacts({ cwd, candidatePaths }) {
  const paths = normalizeList(candidatePaths);
  if (paths.length === 0) {
    throw processPromotionError(
      'PROCESS_CANDIDATE_REQUIRED',
      'At least one --candidate .zeus/process-improvements.json is required.'
    );
  }
  if (paths.length > MAX_INPUT_ARTIFACTS) {
    throw processPromotionError(
      'PROCESS_PROMOTION_INPUT_INVALID',
      `At most ${MAX_INPUT_ARTIFACTS} candidate artifacts may be combined.`
    );
  }
  return paths.map(input => {
    const location = resolvePromotionJsonPath({ cwd, input, label: 'Candidate artifact' });
    const report = readBoundedJson(location, 'Candidate artifact');
    if (
      !report ||
      report.kind !== 'process-improvement-report' ||
      report.schemaVersion !== PROCESS_PROMOTION_SCHEMA_VERSION ||
      report.automaticPromotion !== false ||
      !Array.isArray(report.candidates)
    ) {
      throw processPromotionError(
        'PROCESS_PROMOTION_INPUT_INVALID',
        `${location.relativePath} is not a compatible review-only process-improvement report.`
      );
    }
    return {
      path: location.relativePath,
      candidates: report.candidates.slice(0, MAX_CANDIDATES),
    };
  });
}

function readRegressionFixtures({ cwd, fixturePaths }) {
  const paths = normalizeList(fixturePaths);
  if (paths.length > MAX_FIXTURES) {
    throw processPromotionError(
      'PROCESS_PROMOTION_INPUT_INVALID',
      `At most ${MAX_FIXTURES} regression fixtures may be supplied.`
    );
  }
  return paths.map(input => {
    const location = resolvePromotionJsonPath({ cwd, input, label: 'Regression fixture' });
    const fixture = readBoundedJson(location, 'Regression fixture');
    const valid =
      fixture &&
      fixture.kind === 'process-regression-fixture' &&
      fixture.sanitized === true &&
      fixture.containsCredentials === false &&
      fixture.containsPrivateProjectIdentifiers === false &&
      (fixture.fixtureId || fixture.scenarioId);
    return {
      path: location.relativePath,
      fixtureId: redactAgentText(fixture && (fixture.fixtureId || fixture.scenarioId)) || null,
      candidateIds: Array.isArray(fixture && fixture.candidateIds)
        ? fixture.candidateIds.map(redactAgentText).filter(Boolean).slice(0, MAX_CANDIDATES)
        : [],
      valid: Boolean(valid),
    };
  });
}

function buildProcessPromotionCandidates(artifacts, fixtures) {
  const groups = new Map();
  for (const artifact of artifacts) {
    for (const candidate of artifact.candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const key = normalizedCandidateKey(candidate);
      if (key === '||') continue;
      const group = groups.get(key) || {
        key,
        candidateIds: new Set(),
        issue: redactAgentText(candidate.issue).toLowerCase(),
        targetSurface: redactAgentText(candidate.targetSurface).toLowerCase(),
        glossaryTerms: new Set(),
        signalCount: 0,
        catalogFingerprints: new Set(),
        sourceArtifacts: new Set(),
        sourceCandidateIds: new Set(),
        proposedChange: redactAgentText(candidate.proposedChange),
      };
      const sourceCandidateId = redactAgentText(candidate.candidateId);
      if (sourceCandidateId) {
        group.candidateIds.add(sourceCandidateId);
        group.sourceCandidateIds.add(sourceCandidateId);
      }
      for (const term of Array.isArray(candidate.glossaryTerms) ? candidate.glossaryTerms : []) {
        const normalized = redactAgentText(term);
        if (normalized) group.glossaryTerms.add(normalized);
      }
      const count = Number(candidate.count);
      group.signalCount += Number.isInteger(count) && count > 0 ? count : 1;
      for (const fingerprint of Array.isArray(candidate.catalogFingerprints)
        ? candidate.catalogFingerprints
        : []) {
        const normalized = redactAgentText(fingerprint);
        if (/^catalog:[a-f0-9]{16}$/i.test(normalized)) {
          group.catalogFingerprints.add(normalized.toLowerCase());
        }
      }
      group.sourceArtifacts.add(artifact.path);
      groups.set(key, group);
    }
  }

  const validFixtures = fixtures.filter(fixture => fixture.valid);
  return [...groups.values()]
    .sort(
      (left, right) => right.signalCount - left.signalCount || left.key.localeCompare(right.key)
    )
    .slice(0, MAX_CANDIDATES)
    .map(group => {
      const candidateId = [...group.candidateIds].sort()[0] || stableCandidateId(group.key);
      const matchingFixtures = validFixtures.filter(
        fixture => fixture.candidateIds.length > 0 && fixture.candidateIds.includes(candidateId)
      );
      const blockers = [];
      if (group.signalCount < 2) blockers.push('INSUFFICIENT_SANITIZED_SIGNALS');
      if (group.catalogFingerprints.size < 2) blockers.push('CROSS_CATALOG_CONFIRMATION_MISSING');
      if (matchingFixtures.length === 0) blockers.push('SANITIZED_REGRESSION_FIXTURE_MISSING');
      return {
        candidateId,
        issue: group.issue,
        targetSurface: group.targetSurface,
        glossaryTerms: [...group.glossaryTerms].sort(),
        signalCount: group.signalCount,
        catalogCount: group.catalogFingerprints.size,
        catalogFingerprints: [...group.catalogFingerprints].sort(),
        sourceArtifacts: [...group.sourceArtifacts].sort(),
        sourceCandidateIds: [...group.sourceCandidateIds].sort(),
        fixtureIds: matchingFixtures.map(fixture => fixture.fixtureId).sort(),
        status: blockers.length === 0 ? 'ready-for-human-review' : 'not-ready',
        blockers,
        proposedChange: group.proposedChange || null,
        review: {
          required: true,
          eligible: blockers.length === 0,
          automaticPromotion: false,
          promotionAllowed: false,
        },
      };
    });
}

function buildProcessPromotionReadiness({
  cwd = process.cwd(),
  candidatePaths,
  fixturePaths,
} = {}) {
  const artifacts = readImprovementArtifacts({ cwd, candidatePaths });
  const fixtures = readRegressionFixtures({ cwd, fixturePaths });
  const candidates = buildProcessPromotionCandidates(artifacts, fixtures);
  const readyCount = candidates.filter(
    candidate => candidate.status === 'ready-for-human-review'
  ).length;
  return {
    ok: true,
    operation: 'promotion-check',
    kind: 'process-promotion-readiness',
    schemaVersion: PROCESS_PROMOTION_SCHEMA_VERSION,
    readOnly: true,
    automaticPromotion: false,
    promotionAllowed: false,
    inputs: {
      candidateArtifacts: artifacts.map(artifact => artifact.path),
      regressionFixtures: fixtures.map(fixture => ({
        path: fixture.path,
        fixtureId: fixture.fixtureId,
        valid: fixture.valid,
      })),
    },
    candidates,
    review: {
      required: candidates.length > 0,
      candidateCount: candidates.length,
      readyForHumanReview: readyCount,
      blocked: candidates.length - readyCount,
      policy:
        'Cross-catalog evidence and a sanitized regression fixture make a candidate ready for human review only. A domain owner must approve and change the authoritative surface explicitly; this command never publishes or promotes process knowledge.',
    },
    nextSafeStep:
      readyCount > 0
        ? 'Have a domain owner review the ready candidate, verify its evidence, and make the smallest explicit change to the authoritative surface.'
        : 'Collect the missing cross-catalog signal or sanitized regression fixture, then run the promotion check again.',
  };
}

function resolveProcessPromotionArtifactPath({
  cwd = process.cwd(),
  out = DEFAULT_PROCESS_PROMOTION_ARTIFACT,
} = {}) {
  return resolvePromotionJsonPath({ cwd, input: out, label: 'Promotion readiness artifact' });
}

function writeProcessPromotionArtifact(payload, options = {}) {
  const location = resolveProcessPromotionArtifactPath(options);
  fs.mkdirSync(path.dirname(location.absolutePath), { recursive: true });
  fs.writeFileSync(location.absolutePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(location.absolutePath, 0o600);
  } catch {
    // chmod is not supported or meaningful on every platform.
  }
  return location.relativePath;
}

module.exports = {
  DEFAULT_PROCESS_PROMOTION_ARTIFACT,
  PROCESS_PROMOTION_SCHEMA_VERSION,
  buildProcessPromotionCandidates,
  buildProcessPromotionReadiness,
  resolveProcessPromotionArtifactPath,
  writeProcessPromotionArtifact,
};
