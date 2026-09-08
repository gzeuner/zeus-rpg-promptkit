'use strict';

const CONTRACT_IDS = require('../contractIds');
const { PROCESS_STATUSES } = require('../constants');
const { validateProjectIntelligenceContract } = require('../validate');
const { sha256, stableValue } = require('./discovery');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('process candidate is required');
  const process = candidate.process;
  const version = candidate.version;
  if (!process || !version) throw new Error('candidate must contain process and version');
  if (
    version.status !== PROCESS_STATUSES.CANDIDATE ||
    process.status !== PROCESS_STATUSES.CANDIDATE
  ) {
    throw new Error('only candidate process knowledge may be described');
  }
  return {
    process,
    version,
    steps: candidate.steps || [],
    claims: candidate.claims || [],
    relationships: candidate.relationships || [],
  };
}

function buildProcessDescription(candidate) {
  const { process, version, steps, claims, relationships } = requireCandidate(candidate);
  const describedVersion = clone(version);
  const entryNames = (process.entryPoints || [])
    .map(entry => entry.name || entry.id)
    .filter(Boolean);
  describedVersion.description = {
    trigger:
      entryNames.length > 0
        ? `Technical entry point detected: ${entryNames.join(', ')}.`
        : 'No technical entry point was resolved.',
    goal: 'Business outcome is not established by the available technical evidence.',
    steps: steps.map(step => ({
      id: step.stepId,
      sequence: step.sequence,
      kind: step.stepKind,
      title: step.title,
      evidenceReferences: step.evidenceReferences,
    })),
    decisions: describedVersion.decisions || [],
    interfaces: describedVersion.interfaces || [],
    data: describedVersion.dataObjects || [],
    exceptions: describedVersion.exceptions || [],
    roles: describedVersion.actors || [],
    evidence: describedVersion.evidenceReferences || [],
    uncertainty: [
      ...(describedVersion.uncertainty || []),
      ...claims.filter(claim => claim.claimType === 'open-question').map(claim => claim.text),
    ],
    openQuestions: describedVersion.openQuestions || [],
  };
  describedVersion.openQuestions = Array.from(new Set(describedVersion.description.openQuestions));
  describedVersion.uncertainty = Array.from(new Set(describedVersion.description.uncertainty));
  const validation = validateProcessCandidate({
    ...candidate,
    version: describedVersion,
  });
  if (!validation.ok) {
    const error = new Error('process description failed contract validation');
    error.validation = validation;
    throw error;
  }
  return {
    ...candidate,
    process: clone(process),
    version: describedVersion,
    steps: clone(steps),
    claims: clone(claims),
    relationships: clone(relationships),
  };
}

function reviewProcessDescription(candidate, review = {}) {
  const described = buildProcessDescription(candidate);
  const reviewerId = String(review.reviewerId || '').trim();
  const reviewedAt = String(review.reviewedAt || '').trim();
  if (!reviewerId || !reviewedAt || review.approved !== true) {
    throw new Error(
      'explicit approved review with reviewerId, reviewedAt, and approved=true is required'
    );
  }
  if (Number.isNaN(Date.parse(reviewedAt))) throw new Error('reviewedAt must be an ISO timestamp');
  const version = clone(described.version);
  const process = clone(described.process);
  version.status = PROCESS_STATUSES.REVIEWED;
  process.status = PROCESS_STATUSES.REVIEWED;
  version.review = {
    reviewerId,
    reviewedAt,
    approved: true,
    changedFields: ['description', 'status', 'review'],
    candidateFingerprint: sha256(stableValue(described.version)),
  };
  const reviewed = {
    ...described,
    process,
    version,
  };
  const validation = validateProcessCandidate(reviewed);
  if (!validation.ok) {
    const error = new Error('reviewed process description failed contract validation');
    error.validation = validation;
    throw error;
  }
  return reviewed;
}

function publishProcessDescription(reviewedCandidate, publication = {}) {
  if (
    !reviewedCandidate ||
    !reviewedCandidate.version ||
    reviewedCandidate.version.status !== PROCESS_STATUSES.REVIEWED
  ) {
    throw new Error('a reviewed process description is required before publishing');
  }
  const publishedAt = String(publication.publishedAt || '').trim();
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) {
    throw new Error('explicit publishedAt ISO timestamp is required');
  }
  const result = {
    ...reviewedCandidate,
    process: { ...clone(reviewedCandidate.process), status: PROCESS_STATUSES.PUBLISHED },
    version: {
      ...clone(reviewedCandidate.version),
      status: PROCESS_STATUSES.PUBLISHED,
      publishedAt,
    },
  };
  const validation = validateProcessCandidate(result);
  if (!validation.ok) {
    const error = new Error('published process description failed contract validation');
    error.validation = validation;
    throw error;
  }
  return result;
}

function validateProcessCandidate(candidate) {
  const values = [
    [CONTRACT_IDS.BUSINESS_PROCESS, candidate && candidate.process],
    [CONTRACT_IDS.PROCESS_VERSION, candidate && candidate.version],
    ...((candidate && candidate.steps) || []).map(value => [CONTRACT_IDS.PROCESS_STEP, value]),
    ...((candidate && candidate.claims) || []).map(value => [CONTRACT_IDS.PROCESS_CLAIM, value]),
    ...((candidate && candidate.relationships) || []).map(value => [
      CONTRACT_IDS.PROCESS_RELATIONSHIP,
      value,
    ]),
  ];
  const errors = [];
  for (const [contractId, value] of values) {
    const result = validateProjectIntelligenceContract(contractId, value);
    if (!result.ok) errors.push({ contractId, errors: result.errors });
  }
  if (candidate && candidate.process && candidate.version) {
    if (candidate.process.processVersionId !== candidate.version.processVersionId) {
      errors.push({
        path: '/processVersionId',
        message: 'process and version must reference the same processVersionId',
      });
    }
    const stepIds = new Set((candidate.steps || []).map(step => step.stepId));
    for (const id of candidate.version.stepIds || []) {
      if (!stepIds.has(id))
        errors.push({ path: '/version/stepIds', message: `missing step ${id}` });
    }
  }
  return { ok: errors.length === 0, errors };
}

function buildProcessDescriptionPrompt(candidate) {
  const { process, version, steps, claims, relationships } = requireCandidate(candidate);
  const evidence = {
    process,
    version,
    steps,
    claims,
    relationships,
  };
  return [
    'Describe the supplied legacy-system process candidate as strict JSON.',
    'Use only the supplied evidence. Do not invent business goals, actors, rules, interfaces, or steps.',
    'Keep unsupported facts in uncertainty or openQuestions and preserve every evidence reference.',
    'The result must contain trigger, goal, steps, decisions, interfaces, data, exceptions, roles, evidence, uncertainty, and openQuestions.',
    'The result is a candidate until a human review explicitly approves it; never publish it automatically.',
    JSON.stringify(stableValue(evidence), null, 2),
  ].join('\n\n');
}

module.exports = {
  buildProcessDescription,
  buildProcessDescriptionPrompt,
  reviewProcessDescription,
  publishProcessDescription,
  validateProcessCandidate,
};
