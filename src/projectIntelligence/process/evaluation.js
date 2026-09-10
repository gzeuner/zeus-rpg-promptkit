'use strict';

const crypto = require('crypto');
const fs = require('fs');

const CONTRACT_IDS = require('../contractIds');
const { processEvaluationResultSchema } = require('./contracts');
const { listProcesses, queryProcesses, resolveCatalogPath } = require('./retrieval');

const FRESHNESS_RANK = Object.freeze({
  fresh: 4,
  published: 4,
  reviewed: 3,
  candidate: 2,
  stale: 1,
  unknown: 0,
});

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function uniqueStrings(values) {
  return [
    ...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean)),
  ].sort();
}

function catalogItems(catalog, field, candidateField) {
  const values = [
    ...(Array.isArray(catalog[field]) ? catalog[field] : []),
    ...(Array.isArray(catalog.candidates)
      ? catalog.candidates.flatMap(candidate => (candidate && candidate[candidateField]) || [])
      : []),
  ];
  const idField =
    field === 'processes'
      ? 'processId'
      : field === 'versions'
        ? 'processVersionId'
        : field === 'steps'
          ? 'stepId'
          : field === 'claims'
            ? 'claimId'
            : 'relationshipId';
  const seen = new Set();
  return values.filter(value => {
    const id = String((value && value[idField]) || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function normalizeScenarios(scenarios) {
  const values = Array.isArray(scenarios)
    ? scenarios
    : scenarios && Array.isArray(scenarios.scenarios)
      ? scenarios.scenarios
      : [];
  return values.slice(0, 50).map((scenario, index) => ({
    id: String((scenario && scenario.id) || `scenario:${index + 1}`).trim(),
    question: String((scenario && scenario.question) || '')
      .trim()
      .slice(0, 1800),
    expectedProcessIds: uniqueStrings(scenario && scenario.expectedProcessIds),
    requireEvidence: scenario?.requireEvidence !== false,
    maxFreshness: String((scenario && scenario.maxFreshness) || 'published')
      .trim()
      .toLowerCase(),
    limit: Number.isInteger(scenario?.limit) ? Math.max(1, Math.min(20, scenario.limit)) : 5,
  }));
}

function readProcessEvaluationScenarios(filePath, options = {}) {
  const raw = String(filePath || '').trim();
  if (!raw) {
    const error = new Error('--scenarios is required when a scenario file is requested');
    error.code = 'PROCESS_SCENARIOS_REQUIRED';
    throw error;
  }
  const resolved = resolveCatalogPath(raw, options.cwd || process.cwd());
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    const wrapped = new Error('process scenario file could not be read as JSON');
    wrapped.code = 'PROCESS_SCENARIOS_INVALID';
    throw wrapped;
  }
  return normalizeScenarios(parsed);
}

function roundRatio(value) {
  return Math.round(value * 1000) / 1000;
}

function evaluateProcessCatalog(catalog, scenarios = [], options = {}) {
  const listed = listProcesses(catalog, options);
  const processes = catalogItems(catalog, 'processes', 'process');
  const versions = catalogItems(catalog, 'versions', 'version');
  const relationships = catalogItems(catalog, 'relationships', 'relationships');
  const steps = catalogItems(catalog, 'steps', 'steps');
  const claims = catalogItems(catalog, 'claims', 'claims');
  const processIds = new Set(processes.map(value => value && value.processId).filter(Boolean));
  const versionIds = new Set(
    versions.map(value => value && value.processVersionId).filter(Boolean)
  );
  const allKnownIds = new Set([
    ...processIds,
    ...versionIds,
    ...steps.map(value => value.stepId),
    ...claims.map(value => value.claimId),
  ]);
  const evidenceCovered = processes.filter(
    value => Array.isArray(value.evidenceReferences) && value.evidenceReferences.length > 0
  ).length;
  const unresolvedRelationships = relationships.filter(
    relationship =>
      !allKnownIds.has(relationship && relationship.fromId) ||
      !allKnownIds.has(relationship && relationship.toId)
  ).length;
  const unknownCount = [
    ...processes.flatMap(value => value.unknowns || []),
    ...versions.flatMap(value => [...(value.uncertainty || []), ...(value.openQuestions || [])]),
  ].length;
  const candidateCount = listed.processes.filter(value => value.status === 'candidate').length;
  const staleCount = listed.processes.filter(value => value.status === 'stale').length;
  const processCount = listed.total;
  const evidenceCoverage = processCount === 0 ? 0 : roundRatio(evidenceCovered / processCount);
  const findings = [];
  if (processCount === 0) findings.push('NO_PROCESS_PROJECTIONS');
  if (evidenceCoverage < 0.8) findings.push('EVIDENCE_COVERAGE_LOW');
  if (listed.freshness.status === 'unknown') findings.push('FRESHNESS_UNKNOWN');
  if (listed.freshness.status === 'stale' || staleCount > 0)
    findings.push('STALE_PROCESS_PROJECTIONS');
  if (unresolvedRelationships > 0) findings.push('UNRESOLVED_RELATIONSHIPS');
  if (candidateCount > 0 || unknownCount > 0) findings.push('REVIEW_REQUIRED');

  const scenarioResults = [];
  for (const scenario of normalizeScenarios(scenarios)) {
    const result = scenario.question
      ? queryProcesses(catalog, scenario.question, { ...options, limit: scenario.limit })
      : null;
    const matchedProcessIds = result ? result.matches.map(match => match.id) : [];
    const expectedSatisfied =
      scenario.expectedProcessIds.length === 0
        ? matchedProcessIds.length > 0
        : scenario.expectedProcessIds.every(id => matchedProcessIds.includes(id));
    const evidenceSatisfied =
      !scenario.requireEvidence || Boolean(result && result.evidenceReferences.length > 0);
    const freshnessSatisfied = Boolean(
      result &&
      (FRESHNESS_RANK[result.freshness.status] || 0) >=
        (FRESHNESS_RANK[scenario.maxFreshness] ?? FRESHNESS_RANK.published)
    );
    const status = expectedSatisfied && evidenceSatisfied && freshnessSatisfied ? 'pass' : 'fail';
    scenarioResults.push({
      id: scenario.id,
      status,
      matchedProcessIds,
      unknowns: result ? result.unknowns : ['Scenario question is empty.'],
    });
  }
  const failedScenarios = scenarioResults.filter(scenario => scenario.status === 'fail').length;
  if (failedScenarios > 0) findings.push('SCENARIO_COVERAGE_LOW');
  const status =
    processCount === 0 || evidenceCoverage === 0 || failedScenarios > 0
      ? 'fail'
      : findings.length > 0
        ? 'needs-review'
        : 'pass';
  const evaluationId = `evaluation:${stableHash(
    JSON.stringify({
      projectId: catalog.projectId || null,
      snapshotId: catalog.snapshotId || null,
      scenarios: normalizeScenarios(scenarios).map(scenario => ({
        id: scenario.id,
        question: scenario.question,
      })),
    })
  ).slice(0, 16)}`;
  const evidenceReferences = [
    ...(Array.isArray(catalog.evidenceCatalog) ? catalog.evidenceCatalog.slice(0, 50) : []),
    { id: evaluationId, kind: 'derived-reference' },
  ];
  const output = {
    ok: true,
    schemaVersion: 1,
    kind: 'project-knowledge-process-evaluation-result',
    contractId: CONTRACT_IDS.PROCESS_EVALUATION_RESULT,
    operation: 'evaluate',
    projectId: String(catalog.projectId || '').trim() || 'unknown-project',
    snapshotId: String(catalog.snapshotId || '').trim() || 'unknown-snapshot',
    evaluationId,
    status,
    freshness: listed.freshness,
    metrics: {
      processCount,
      versionCount: versions.length,
      candidateCount,
      staleCount,
      evidenceCoverage,
      unknownCount,
      unresolvedRelationships,
      scenarioCount: scenarioResults.length,
      failedScenarioCount: failedScenarios,
    },
    findings: uniqueStrings(findings),
    scenarios: scenarioResults,
    evidenceReferences,
    sourceOfTruth: false,
    advisory: true,
  };
  const errors = processEvaluationResultSchema(output);
  if (errors.length > 0) {
    const error = new Error('process evaluation result failed contract validation');
    error.code = 'PROCESS_EVALUATION_RESULT_INVALID';
    error.validationErrors = errors;
    throw error;
  }
  return output;
}

module.exports = {
  normalizeScenarios,
  readProcessEvaluationScenarios,
  evaluateProcessCatalog,
};
