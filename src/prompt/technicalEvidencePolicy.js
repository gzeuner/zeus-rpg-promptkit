/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
'use strict';

const { validateTechnicalEvidencePrompt } = require('./technicalEvidencePromptAdapter');

const TECHNICAL_EVIDENCE_REGRESSION_SCHEMA_VERSION = 1;
const TECHNICAL_EVIDENCE_REGRESSION_CONTRACT_ID = 'zeus.technical-evidence-prompt-regression';
const TECHNICAL_EVIDENCE_EGRESS_SCHEMA_VERSION = 1;
const TECHNICAL_EVIDENCE_EGRESS_CONTRACT_ID = 'zeus.technical-evidence-egress-check';
const TRUST_ZONES = Object.freeze(['local', 'private-network', 'external']);
const DESTINATIONS = Object.freeze(['local-workspace', 'private-network', 'external-provider']);
const REQUIRED_GUARDS = Object.freeze([
  'ZEUS TECHNICAL EVIDENCE REVIEW',
  'Use only the bounded technical relationships below.',
  'Do not infer private mappings, source text, names, paths, credentials, business meaning, or unstated behavior.',
  'Preserve incompleteness, warning codes, and omissions in every response.',
  'NODES',
  'EDGES',
]);

class TechnicalEvidencePolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TechnicalEvidencePolicyError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TechnicalEvidencePolicyError(code, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeToken(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value) && value.length <= 96;
}

function validateInputPrompt(prompt, label) {
  if (validateTechnicalEvidencePrompt(prompt).length > 0)
    fail('TECHNICAL_EVIDENCE_POLICY_PROMPT_INVALID', `${label} is invalid`);
  return prompt;
}

function validatePromptStructure(prompt) {
  const lines = String(prompt.prompt || '')
    .trimEnd()
    .split('\n');
  const blockers = [];
  for (const guard of REQUIRED_GUARDS) {
    if (!lines.includes(guard)) blockers.push('PROMPT_GUARD_MISSING');
  }
  const allowed = [
    /^ZEUS TECHNICAL EVIDENCE REVIEW$/,
    /^Use only the bounded technical relationships below\.$/,
    /^Do not infer private mappings, source text, names, paths, credentials, business meaning, or unstated behavior\.$/,
    /^Preserve incompleteness, warning codes, and omissions in every response\.$/,
    /^OBJECTIVE code=([A-Za-z][A-Za-z0-9_-]*)$/,
    /^COMPLETE value=(true|false)$/,
    /^WARNING_CODES values=([A-Za-z][A-Za-z0-9_-]*(,[A-Za-z][A-Za-z0-9_-]*)*|-)?$/,
    /^OMISSIONS values=([A-Za-z][A-Za-z0-9_-]*(,[A-Za-z][A-Za-z0-9_-]*)*|-)?$/,
    /^NODES$/,
    /^EDGES$/,
    /^NODE id=(?:[a-f0-9]{64}|opaque-[a-z0-9_-]{8,128}) kind=[A-Za-z][A-Za-z0-9_-]* sourceType=(?:[A-Za-z][A-Za-z0-9_-]*|-)+ family=(?:[A-Za-z][A-Za-z0-9_-]*|-)+ confidence=(?:[A-Za-z][A-Za-z0-9_-]*|-)+$/i,
    /^EDGE id=(?:[a-f0-9]{64}|opaque-[a-z0-9_-]{8,128}) kind=[A-Za-z][A-Za-z0-9_-]* from=(?:[a-f0-9]{64}|opaque-[a-z0-9_-]{8,128}) to=(?:[a-f0-9]{64}|opaque-[a-z0-9_-]{8,128}) count=(?:[0-9]+|-) confidence=(?:[A-Za-z][A-Za-z0-9_-]*|-)+$/i,
  ];
  for (const line of lines) {
    if (!allowed.some(pattern => pattern.test(line))) blockers.push('PROMPT_STRUCTURE_INVALID');
  }
  return [...new Set(blockers)];
}

function sortedDifference(left, right) {
  const rightSet = new Set(right);
  return [...new Set(left)].filter(value => !rightSet.has(value)).sort();
}

function evaluateTechnicalEvidencePromptRegression({ baseline, candidate } = {}) {
  validateInputPrompt(baseline, 'baseline prompt');
  validateInputPrompt(candidate, 'candidate prompt');
  const blockers = validatePromptStructure(candidate);
  const warnings = [];
  const changes = [];
  if (baseline.promptFingerprint !== candidate.promptFingerprint) changes.push('PROMPT_CHANGED');
  if (baseline.contextFingerprint !== candidate.contextFingerprint) changes.push('CONTEXT_CHANGED');
  if (baseline.objective.code !== candidate.objective.code) changes.push('OBJECTIVE_CHANGED');
  if (baseline.uncertainty.complete !== candidate.uncertainty.complete) {
    changes.push('COMPLETENESS_CHANGED');
    if (baseline.uncertainty.complete && !candidate.uncertainty.complete)
      blockers.push('COMPLETENESS_REGRESSION');
  }
  const droppedWarnings = sortedDifference(
    baseline.uncertainty.warningCodes,
    candidate.uncertainty.warningCodes
  );
  if (droppedWarnings.length > 0) {
    changes.push('WARNING_SET_CHANGED');
    blockers.push('WARNING_DISCARDED');
  }
  if (baseline.limits.maxTokens !== candidate.limits.maxTokens) changes.push('TOKEN_LIMIT_CHANGED');
  if (candidate.limits.maxTokens > baseline.limits.maxTokens)
    warnings.push('TOKEN_LIMIT_INCREASED');
  if (candidate.included.nodeCount < baseline.included.nodeCount)
    warnings.push('NODE_COVERAGE_REDUCED');
  if (candidate.included.edgeCount < baseline.included.edgeCount)
    warnings.push('EDGE_COVERAGE_REDUCED');
  const uniqueBlockers = [...new Set(blockers)].sort();
  const uniqueWarnings = [...new Set(warnings)].sort();
  const uniqueChanges = [...new Set(changes)].sort();
  const status =
    uniqueBlockers.length > 0 ? 'blocked' : uniqueChanges.length > 0 ? 'changed' : 'pass';
  return {
    ok: true,
    kind: 'zeus-technical-evidence-prompt-regression',
    contractId: TECHNICAL_EVIDENCE_REGRESSION_CONTRACT_ID,
    contractVersion: TECHNICAL_EVIDENCE_REGRESSION_SCHEMA_VERSION,
    schemaVersion: TECHNICAL_EVIDENCE_REGRESSION_SCHEMA_VERSION,
    readOnly: true,
    localOnly: true,
    status,
    gatePassed: status !== 'blocked',
    reviewRequired: status === 'changed',
    baseline: {
      contextFingerprint: baseline.contextFingerprint,
      promptFingerprint: baseline.promptFingerprint,
    },
    candidate: {
      contextFingerprint: candidate.contextFingerprint,
      promptFingerprint: candidate.promptFingerprint,
    },
    changes: uniqueChanges,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    automaticPromotion: false,
    promotionAllowed: false,
    externalPublicationAllowed: false,
    nextSafeStep:
      status === 'blocked'
        ? 'Resolve every regression blocker and rerun the local prompt regression check.'
        : status === 'changed'
          ? 'Review the bounded changes locally before accepting the candidate prompt.'
          : 'Keep the regression result with the exact prompt artifacts for local verification.',
  };
}

function validateTechnicalEvidencePromptRegression(value) {
  const errors = [];
  if (!isObject(value)) return ['regression result must be an object'];
  if (value.schemaVersion !== TECHNICAL_EVIDENCE_REGRESSION_SCHEMA_VERSION)
    errors.push('schemaVersion is unsupported');
  if (value.kind !== 'zeus-technical-evidence-prompt-regression') errors.push('kind is invalid');
  if (value.contractId !== TECHNICAL_EVIDENCE_REGRESSION_CONTRACT_ID)
    errors.push('contractId is invalid');
  if (value.readOnly !== true || value.localOnly !== true)
    errors.push('regression must be local-only and read-only');
  if (!['pass', 'changed', 'blocked'].includes(value.status)) errors.push('status is invalid');
  for (const identity of ['baseline', 'candidate']) {
    if (!isObject(value[identity])) errors.push(`${identity} is required`);
    else {
      if (!/^[a-f0-9]{64}$/i.test(String(value[identity].contextFingerprint || '')))
        errors.push(`${identity}.contextFingerprint is invalid`);
      if (!/^[a-f0-9]{64}$/i.test(String(value[identity].promptFingerprint || '')))
        errors.push(`${identity}.promptFingerprint is invalid`);
    }
  }
  for (const field of ['changes', 'blockers', 'warnings']) {
    if (!Array.isArray(value[field]) || value[field].some(item => !isSafeToken(item)))
      errors.push(`${field} must contain safe tokens`);
  }
  if (value.externalPublicationAllowed !== false)
    errors.push('external publication must be disabled');
  return errors;
}

function checkTechnicalEvidencePromptEgress({
  prompt,
  trustZone = 'local',
  destination = 'local-workspace',
} = {}) {
  validateInputPrompt(prompt, 'prompt');
  const blockers = [];
  if (!TRUST_ZONES.includes(trustZone)) blockers.push('TRUST_ZONE_UNKNOWN');
  if (!DESTINATIONS.includes(destination)) blockers.push('DESTINATION_UNKNOWN');
  if (trustZone !== 'local') blockers.push('LOCAL_ZONE_REQUIRED');
  if (destination !== 'local-workspace') blockers.push('LOCAL_DESTINATION_REQUIRED');
  const uniqueBlockers = [...new Set(blockers)].sort();
  const allowed = uniqueBlockers.length === 0;
  return {
    ok: true,
    kind: 'zeus-technical-evidence-egress-check',
    contractId: TECHNICAL_EVIDENCE_EGRESS_CONTRACT_ID,
    contractVersion: TECHNICAL_EVIDENCE_EGRESS_SCHEMA_VERSION,
    schemaVersion: TECHNICAL_EVIDENCE_EGRESS_SCHEMA_VERSION,
    readOnly: true,
    localOnly: true,
    status: allowed ? 'allowed' : 'blocked',
    gatePassed: allowed,
    promptFingerprint: prompt.promptFingerprint,
    contextFingerprint: prompt.contextFingerprint,
    trustZone: TRUST_ZONES.includes(trustZone) ? trustZone : 'unknown',
    destination: DESTINATIONS.includes(destination) ? destination : 'unknown',
    classification: 'anonymized-technical-evidence',
    blockers: uniqueBlockers,
    providerHandoffAllowed: false,
    externalPublicationAllowed: false,
    nextSafeStep: allowed
      ? 'Keep the prompt inside the local workspace and rerun this check before any handoff.'
      : 'Keep the prompt local; external or non-local destinations are not permitted by this contract.',
  };
}

function validateTechnicalEvidencePromptEgress(value) {
  const errors = [];
  if (!isObject(value)) return ['egress result must be an object'];
  if (value.schemaVersion !== TECHNICAL_EVIDENCE_EGRESS_SCHEMA_VERSION)
    errors.push('schemaVersion is unsupported');
  if (value.kind !== 'zeus-technical-evidence-egress-check') errors.push('kind is invalid');
  if (value.contractId !== TECHNICAL_EVIDENCE_EGRESS_CONTRACT_ID)
    errors.push('contractId is invalid');
  if (value.readOnly !== true || value.localOnly !== true)
    errors.push('egress result must be local-only and read-only');
  if (!['allowed', 'blocked'].includes(value.status)) errors.push('status is invalid');
  if (!/^[a-f0-9]{64}$/i.test(String(value.promptFingerprint || '')))
    errors.push('promptFingerprint is invalid');
  if (!/^[a-f0-9]{64}$/i.test(String(value.contextFingerprint || '')))
    errors.push('contextFingerprint is invalid');
  if (!TRUST_ZONES.includes(value.trustZone) && value.trustZone !== 'unknown')
    errors.push('trustZone is invalid');
  if (!DESTINATIONS.includes(value.destination) && value.destination !== 'unknown')
    errors.push('destination is invalid');
  if (!Array.isArray(value.blockers) || value.blockers.some(item => !isSafeToken(item)))
    errors.push('blockers must contain safe tokens');
  if (value.providerHandoffAllowed !== false) errors.push('provider handoff must be disabled');
  if (value.externalPublicationAllowed !== false)
    errors.push('external publication must be disabled');
  return errors;
}

module.exports = {
  DESTINATIONS,
  TECHNICAL_EVIDENCE_EGRESS_CONTRACT_ID,
  TECHNICAL_EVIDENCE_EGRESS_SCHEMA_VERSION,
  TECHNICAL_EVIDENCE_REGRESSION_CONTRACT_ID,
  TECHNICAL_EVIDENCE_REGRESSION_SCHEMA_VERSION,
  TRUST_ZONES,
  TechnicalEvidencePolicyError,
  checkTechnicalEvidencePromptEgress,
  evaluateTechnicalEvidencePromptRegression,
  validateTechnicalEvidencePromptEgress,
  validateTechnicalEvidencePromptRegression,
};
