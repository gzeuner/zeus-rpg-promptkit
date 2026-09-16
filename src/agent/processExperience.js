'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  appendAgentExperience,
  listAgentExperience,
  redactAgentText,
} = require('./agentExperience');
const { validateWorkspacePath } = require('../generationValidation/pathSafety');

const PROCESS_EXPERIENCE_SCHEMA_VERSION = 1;
const DEFAULT_PROCESS_IMPROVEMENT_ARTIFACT = '.zeus/process-improvements.json';
const MIN_PROCESS_REPEATS_TO_CANDIDATE = 2;
const MAX_PROCESS_CANDIDATES = 20;
const MAX_PROCESS_EXAMPLES = 3;

const PROCESS_ISSUES = Object.freeze(['blocked', 'ambiguous', 'incomplete', 'stale', 'corrected']);

const TARGET_SURFACES = Object.freeze(['glossary-entry', 'extraction-rule', 'prompt', 'contract']);

const DEFAULT_TARGET_SURFACES = Object.freeze({
  blocked: 'prompt',
  ambiguous: 'glossary-entry',
  incomplete: 'extraction-rule',
  stale: 'contract',
  corrected: 'prompt',
});

const IMPROVEMENT_TEXT = Object.freeze({
  'glossary-entry':
    'Review the scoped business or legacy term and add a glossary mapping only after domain confirmation.',
  'extraction-rule':
    'Review the evidence extraction or process-boundary rule and add a sanitized regression fixture before changing it.',
  prompt:
    'Clarify the agent route so this process question states its evidence, uncertainty, and smallest safe next step explicitly.',
  contract:
    'Review the machine-readable contract only after confirming the repeated finding and adding a sanitized regression fixture.',
});

function processExperienceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeChoice(value, allowed, label) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!allowed.includes(normalized)) {
    throw processExperienceError(
      'PROCESS_EXPERIENCE_INVALID',
      `${label} must be one of: ${allowed.join(', ')}`
    );
  }
  return normalized;
}

function normalizeProcessIssue(value) {
  return normalizeChoice(value, PROCESS_ISSUES, 'process experience outcome');
}

function normalizeTargetSurface(value, issue) {
  return value == null || String(value).trim() === ''
    ? DEFAULT_TARGET_SURFACES[issue]
    : normalizeChoice(value, TARGET_SURFACES, 'target surface');
}

function overallOutcomeForIssue(issue) {
  if (issue === 'blocked') return 'blocked';
  if (issue === 'corrected') return 'success';
  return 'partial';
}

function defaultLesson(issue) {
  return {
    blocked:
      'The process question could not proceed; preserve the missing prerequisite instead of guessing.',
    ambiguous:
      'The process question matched more than one meaning; preserve the ambiguity and request a scoped clarification.',
    incomplete:
      'The process projection did not cover the requested path; preserve the gap and identify the next evidence source.',
    stale:
      'The process projection is not current; do not present it as authoritative until the source snapshot is reanalyzed.',
    corrected:
      'A process answer was corrected; preserve the correction as a reviewable learning signal, not as published process truth.',
  }[issue];
}

function defaultNextStep(issue) {
  return {
    blocked:
      'Inspect the missing prerequisite and record a bounded retry only after it is available.',
    ambiguous:
      'Resolve the term or identifier with an explicit scope before repeating process retrieval.',
    incomplete:
      'Locate the next evidence source or extraction rule and rerun the deterministic process evaluation.',
    stale:
      'Compare the catalog identity with the current source snapshot before relying on the process answer.',
    corrected:
      'Review the correction, add a sanitized regression scenario, and require human approval before promotion.',
  }[issue];
}

function recordProcessExperience({
  cwd = process.cwd(),
  experienceLog,
  question,
  outcome,
  processId = null,
  processVersionId = null,
  catalog = null,
  glossaryTerm = null,
  targetSurface = null,
  correction = null,
  evidenceSummary = null,
  lesson = null,
  nextStep = null,
  command = 'node cli/zeus.js process experience',
  recordedAt,
} = {}) {
  const normalizedQuestion = redactAgentText(question);
  if (!normalizedQuestion) {
    throw processExperienceError('PROCESS_QUESTION_REQUIRED', 'question is required.');
  }
  const issue = normalizeProcessIssue(outcome);
  const surface = normalizeTargetSurface(targetSurface, issue);
  const event = appendAgentExperience(
    {
      event: 'lesson',
      outcome: overallOutcomeForIssue(issue),
      topic: 'process',
      command,
      failureCode: `PROCESS_${issue.toUpperCase()}`,
      goal: normalizedQuestion,
      question: normalizedQuestion,
      processId,
      processVersionId,
      catalog,
      processIssue: issue,
      targetSurface: surface,
      glossaryTerm,
      correction,
      evidenceSummary,
      lesson: lesson || defaultLesson(issue),
      nextStep: nextStep || defaultNextStep(issue),
      recordedAt,
      tags: ['process-experience', issue, surface],
    },
    { cwd, out: experienceLog }
  );
  return {
    ok: true,
    operation: 'experience',
    kind: 'process-experience-record',
    schemaVersion: PROCESS_EXPERIENCE_SCHEMA_VERSION,
    readOnly: false,
    automaticPromotion: false,
    path: event.path,
    event: event.event,
    nextSafeStep: 'Run node cli/zeus.js process improvements --json for reviewable candidates.',
  };
}

function candidateKey(event) {
  const glossaryTerm = event.glossaryTerm
    ? String(event.glossaryTerm).trim().toLocaleLowerCase('de-DE')
    : '';
  return [
    event.processIssue,
    event.targetSurface || DEFAULT_TARGET_SURFACES[event.processIssue],
    glossaryTerm,
  ].join('|');
}

function candidateId(key) {
  return `process-improvement:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function catalogFingerprint(value) {
  const normalized = redactAgentText(value);
  if (!normalized) return null;
  return `catalog:${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}

function buildProcessImprovementCandidates(events) {
  const groups = new Map();
  for (const event of events) {
    const issue = String(event.processIssue || '').toLowerCase();
    if (!PROCESS_ISSUES.includes(issue)) continue;
    let surface;
    try {
      surface = normalizeTargetSurface(event.targetSurface, issue);
    } catch {
      surface = DEFAULT_TARGET_SURFACES[issue];
    }
    const key = candidateKey({ ...event, processIssue: issue, targetSurface: surface });
    const group = groups.get(key) || {
      key,
      issue,
      targetSurface: surface,
      count: 0,
      eventIds: [],
      processIds: new Set(),
      processVersionIds: new Set(),
      glossaryTerms: new Set(),
      catalogFingerprints: new Set(),
      questions: [],
      corrections: [],
      lastRecordedAt: null,
    };
    group.count += 1;
    group.eventIds.push(event.eventId);
    if (event.processId) group.processIds.add(event.processId);
    if (event.processVersionId) group.processVersionIds.add(event.processVersionId);
    if (event.glossaryTerm) group.glossaryTerms.add(event.glossaryTerm);
    const fingerprint = catalogFingerprint(event.catalog);
    if (fingerprint) group.catalogFingerprints.add(fingerprint);
    if (event.question && group.questions.length < MAX_PROCESS_EXAMPLES) {
      group.questions.push(event.question);
    }
    if (event.correction && group.corrections.length < MAX_PROCESS_EXAMPLES) {
      group.corrections.push(event.correction);
    }
    if (!group.lastRecordedAt || String(event.recordedAt) > group.lastRecordedAt) {
      group.lastRecordedAt = event.recordedAt;
    }
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
    .slice(0, MAX_PROCESS_CANDIDATES)
    .map(group => ({
      candidateId: candidateId(group.key),
      issue: group.issue,
      targetSurface: group.targetSurface,
      status: group.count >= MIN_PROCESS_REPEATS_TO_CANDIDATE ? 'candidate' : 'observed',
      count: group.count,
      processIds: [...group.processIds].sort(),
      processVersionIds: [...group.processVersionIds].sort(),
      glossaryTerms: [...group.glossaryTerms].sort(),
      catalogFingerprints: [...group.catalogFingerprints].sort(),
      catalogCount: group.catalogFingerprints.size,
      questionExamples: group.questions.map(redactAgentText),
      correctionExamples: group.corrections.map(redactAgentText),
      eventIds: group.eventIds.slice(-MAX_PROCESS_EXAMPLES),
      lastRecordedAt: group.lastRecordedAt,
      proposedChange: IMPROVEMENT_TEXT[group.targetSurface],
      review: {
        required: true,
        automaticPromotion: false,
        requiresSanitizedRegressionFixture: true,
      },
    }));
}

function buildProcessImprovementReport({
  cwd = process.cwd(),
  experienceLog,
  limit = MAX_PROCESS_CANDIDATES,
} = {}) {
  const listed = listAgentExperience({ cwd, out: experienceLog, limit: 100 });
  const processEvents = listed.events.filter(event => event.topic === 'process');
  const candidates = buildProcessImprovementCandidates(processEvents).slice(
    0,
    Math.min(Math.max(Number(limit) || MAX_PROCESS_CANDIDATES, 1), MAX_PROCESS_CANDIDATES)
  );
  const candidateCount = candidates.filter(candidate => candidate.status === 'candidate').length;
  return {
    ok: true,
    operation: 'improvements',
    kind: 'process-improvement-report',
    schemaVersion: PROCESS_EXPERIENCE_SCHEMA_VERSION,
    readOnly: true,
    automaticPromotion: false,
    source: {
      experienceLog: listed.path,
      experienceExists: listed.exists,
      totalExperienceEvents: listed.eventCount,
      processExperienceEvents: processEvents.length,
      malformedCount: listed.malformedCount,
      repeatedSignalThreshold: MIN_PROCESS_REPEATS_TO_CANDIDATE,
    },
    candidates,
    review: {
      required: candidates.length > 0,
      candidateCount,
      automaticPromotion: false,
      policy:
        'Review candidates with a domain owner, add a sanitized regression fixture, and explicitly change the authoritative surface. Process experience never publishes process knowledge or edits contracts automatically.',
    },
    nextSafeStep:
      candidates.length > 0
        ? 'Review the candidate, add a sanitized regression fixture, and run the relevant deterministic tests before promotion.'
        : 'Record a sanitized process experience after the next blocked, ambiguous, incomplete, stale, or corrected question.',
  };
}

function resolveProcessImprovementArtifactPath({
  cwd = process.cwd(),
  out = DEFAULT_PROCESS_IMPROVEMENT_ARTIFACT,
} = {}) {
  const workspaceRoot = path.resolve(String(cwd || process.cwd()));
  const result = validateWorkspacePath(String(out || DEFAULT_PROCESS_IMPROVEMENT_ARTIFACT), {
    workspaceRoot,
    allowedRelativeRoots: ['.zeus'],
    allowAbsolute: false,
  });
  if (!result.ok) {
    throw processExperienceError(
      'PATH_OUTSIDE_WORKSPACE',
      'Process improvement artifact must be a relative JSON path inside .zeus/.'
    );
  }
  if (!result.relativePath.toLowerCase().endsWith('.json')) {
    throw processExperienceError(
      'PROCESS_EXPERIENCE_INVALID',
      'Process improvement artifact must use .json.'
    );
  }
  return result;
}

function writeProcessImprovementArtifact(payload, options = {}) {
  const location = resolveProcessImprovementArtifactPath(options);
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
  DEFAULT_PROCESS_IMPROVEMENT_ARTIFACT,
  MAX_PROCESS_CANDIDATES,
  MIN_PROCESS_REPEATS_TO_CANDIDATE,
  PROCESS_EXPERIENCE_SCHEMA_VERSION,
  PROCESS_ISSUES,
  TARGET_SURFACES,
  buildProcessImprovementCandidates,
  buildProcessImprovementReport,
  recordProcessExperience,
  resolveProcessImprovementArtifactPath,
  writeProcessImprovementArtifact,
};
