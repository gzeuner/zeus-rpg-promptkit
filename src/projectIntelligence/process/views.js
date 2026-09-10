'use strict';

const CONTRACT_IDS = require('../contractIds');
const { processRoleViewSchema } = require('./contracts');
const { describeProcess, queryProcesses } = require('./retrieval');

const ROLE_IDS = Object.freeze(['product-owner', 'architect', 'developer', 'tester']);

function normalizeRole(value) {
  const normalized = String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  return ROLE_IDS.includes(normalized) ? normalized : null;
}

function uniqueStrings(values) {
  return [
    ...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean)),
  ].sort();
}

function references(values) {
  const seen = new Set();
  return (values || [])
    .filter(value => value && typeof value === 'object' && String(value.id || '').trim())
    .map(value => ({
      id: String(value.id).trim(),
      ...(value.kind ? { kind: String(value.kind).trim() } : {}),
      ...(value.name ? { name: String(value.name).trim() } : {}),
    }))
    .filter(value => {
      const key = `${value.id}|${value.kind || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${a.id}|${a.kind || ''}`.localeCompare(`${b.id}|${b.kind || ''}`));
}

function stepSummary(step) {
  return {
    stepId: step.stepId,
    sequence: step.sequence,
    stepKind: step.stepKind,
    title: step.title,
    ...(step.description ? { description: step.description } : {}),
    technicalRefs: [...(step.technicalRefs || [])].sort(),
    evidenceReferences: references(step.evidenceReferences),
  };
}

function claimSummary(claim) {
  return {
    claimId: claim.claimId,
    claimType: claim.claimType,
    text: claim.text,
    status: claim.status,
    confidence: claim.confidence,
    supportingRefs: [...(claim.supportingRefs || [])].sort(),
    evidenceReferences: references(claim.evidenceReferences),
  };
}

function projectionFor(role, description) {
  const process = description.process || {};
  const version = description.version || {};
  const metadata = version.description || {};
  const steps = description.steps || [];
  const claims = description.claims || [];
  const relationships = description.relationships || [];
  const base = {
    title: version.title || process.name || null,
    entryPoints: references(process.entryPoints),
    actors: references(version.actors || []),
    openQuestions: uniqueStrings([
      ...(version.openQuestions || []),
      ...(metadata.openQuestions || []),
    ]),
  };

  if (role === 'product-owner') {
    return {
      ...base,
      goal: metadata.goal || null,
      trigger: metadata.trigger || null,
      outcomes: steps.filter(step => step.stepKind === 'outcome').map(stepSummary),
      decisions: references(version.decisions || []),
      exceptions: references(version.exceptions || []),
      businessClaims: claims
        .filter(claim => claim.claimType === 'business-interpretation')
        .map(claimSummary),
    };
  }

  if (role === 'architect') {
    return {
      ...base,
      systems: references(version.systems || []),
      interfaces: references(version.interfaces || []),
      dataObjects: references(version.dataObjects || []),
      decisions: references(version.decisions || []),
      exceptions: references(version.exceptions || []),
      relationships,
    };
  }

  if (role === 'developer') {
    return {
      ...base,
      steps: steps.map(stepSummary),
      claims: claims.map(claimSummary),
      interfaces: references(version.interfaces || []),
      dataObjects: references(version.dataObjects || []),
      exceptions: references(version.exceptions || []),
      relationships,
      technicalRefs: uniqueStrings([
        ...steps.flatMap(step => step.technicalRefs || []),
        ...claims.flatMap(claim => claim.supportingRefs || []),
      ]),
    };
  }

  return {
    ...base,
    scenarios: steps
      .filter(step =>
        ['trigger', 'action', 'decision', 'exception', 'outcome'].includes(step.stepKind)
      )
      .map(stepSummary),
    decisionPoints: steps.filter(step => step.stepKind === 'decision').map(stepSummary),
    errorPaths: steps.filter(step => step.stepKind === 'exception').map(stepSummary),
    acceptanceEvidence: references(description.evidenceReferences),
    claims: claims.map(claimSummary),
  };
}

function roleUnknowns(role, description) {
  const unknowns = [...(description.unknowns || [])];
  if (role === 'product-owner' && !(description.version && description.version.description?.goal)) {
    unknowns.push('No reviewed business goal is present in the process description.');
  }
  if (role === 'tester' && (description.steps || []).length === 0) {
    unknowns.push('No documented process steps are available for scenario design.');
  }
  return uniqueStrings(unknowns);
}

function roleQuestions(role, description) {
  const questions = [...(description.unknowns || [])].filter(value =>
    /\?|review|owner|goal/i.test(value)
  );
  if (role === 'product-owner' && !(description.version && description.version.description?.goal)) {
    questions.push('Which business outcome and owner should be confirmed for this process?');
  }
  if (role === 'tester' && (description.steps || []).some(step => step.stepKind === 'decision')) {
    questions.push('Which expected result should be asserted for each documented decision branch?');
  }
  return uniqueStrings(questions);
}

function buildProcessRoleView(catalog, requestedId, role, options = {}) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) {
    return {
      ok: false,
      operation: 'view',
      reasonCode: 'PROCESS_ROLE_UNSUPPORTED',
      message: `Role must be one of: ${ROLE_IDS.join(', ')}.`,
      nextSafeStep: 'Choose a closed role and rerun process view with --role <role>.',
    };
  }
  const description = describeProcess(catalog, requestedId, options);
  if (description.ok === false) return description;
  const process = description.process || {};
  const version = description.version || {};
  const result = {
    ok: true,
    schemaVersion: 1,
    kind: 'project-knowledge-process-role-view',
    contractId: CONTRACT_IDS.PROCESS_ROLE_VIEW,
    operation: 'view',
    projectId: description.projectId || 'unknown-project',
    snapshotId: description.snapshotId || 'unknown-snapshot',
    processId: process.processId,
    processVersionId: version.processVersionId || process.processVersionId,
    role: normalizedRole,
    status: description.status,
    confidence: description.confidence,
    freshness: description.freshness,
    view: projectionFor(normalizedRole, description),
    evidenceReferences: description.evidenceReferences,
    unknowns: roleUnknowns(normalizedRole, description),
    nextQuestions: roleQuestions(normalizedRole, description),
    sourceOfTruth: false,
    advisory: true,
  };
  const errors = processRoleViewSchema(result);
  if (errors.length > 0) {
    const error = new Error('process role view failed contract validation');
    error.code = 'PROCESS_ROLE_VIEW_INVALID';
    error.validationErrors = errors;
    throw error;
  }
  return result;
}

/**
 * Local chat adapter: intentionally delegates to the deterministic query
 * contract. No network, model call, persistence, or answer invention occurs.
 */
function chatProcess(catalog, question, options = {}) {
  return {
    ...queryProcesses(catalog, question, options),
    operation: 'chat',
    adapter: 'local-read-only',
  };
}

module.exports = {
  ROLE_IDS,
  normalizeRole,
  buildProcessRoleView,
  chatProcess,
};
