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

const crypto = require('node:crypto');
const { validateTechnicalEvidenceContext } = require('../context/technicalEvidenceContext');
const { validateTechnicalEvidencePrompt } = require('./technicalEvidencePromptAdapter');
const {
  TECHNICAL_EVIDENCE_EGRESS_CONTRACT_ID,
  TECHNICAL_EVIDENCE_EGRESS_SCHEMA_VERSION,
  TECHNICAL_EVIDENCE_REGRESSION_CONTRACT_ID,
  TECHNICAL_EVIDENCE_REGRESSION_SCHEMA_VERSION,
  validateTechnicalEvidencePromptEgress,
  validateTechnicalEvidencePromptRegression,
} = require('./technicalEvidencePolicy');

const TECHNICAL_EVIDENCE_BUNDLE_SCHEMA_VERSION = 1;
const TECHNICAL_EVIDENCE_BUNDLE_CONTRACT_ID = 'zeus.technical-evidence-prompt-bundle';
const TECHNICAL_EVIDENCE_HANDOFF_SCHEMA_VERSION = 1;
const TECHNICAL_EVIDENCE_HANDOFF_CONTRACT_ID = 'zeus.technical-evidence-handoff-receipt';
const TECHNICAL_EVIDENCE_BUNDLE_CHECK_SCHEMA_VERSION = 1;
const TECHNICAL_EVIDENCE_BUNDLE_CHECK_CONTRACT_ID = 'zeus.technical-evidence-bundle-check';
const TECHNICAL_EVIDENCE_ACCEPTANCE_SCHEMA_VERSION = 1;
const TECHNICAL_EVIDENCE_ACCEPTANCE_CONTRACT_ID = 'zeus.technical-evidence-acceptance-check';
const HANDOFF_DESTINATION = 'local-review';

class TechnicalEvidenceBundleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TechnicalEvidenceBundleError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TechnicalEvidenceBundleError(code, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])])
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function requireFingerprint(value, label) {
  if (!isFingerprint(value)) fail('TECHNICAL_EVIDENCE_BUNDLE_INPUT_INVALID', `${label} is invalid`);
}

function validatePromptInputs(context, prompt) {
  if (validateTechnicalEvidenceContext(context).length > 0)
    fail('TECHNICAL_EVIDENCE_BUNDLE_CONTEXT_INVALID', 'technical evidence context is invalid');
  if (validateTechnicalEvidencePrompt(prompt).length > 0)
    fail('TECHNICAL_EVIDENCE_BUNDLE_PROMPT_INVALID', 'technical evidence prompt is invalid');
  requireFingerprint(context.contextFingerprint, 'context fingerprint');
  requireFingerprint(prompt.promptFingerprint, 'prompt fingerprint');
  if (prompt.contextFingerprint !== context.contextFingerprint)
    fail('TECHNICAL_EVIDENCE_BUNDLE_CONTEXT_MISMATCH', 'prompt is not bound to context');
}

function validateGateInputs(regression, egress, prompt, context) {
  if (validateTechnicalEvidencePromptRegression(regression).length > 0)
    fail('TECHNICAL_EVIDENCE_BUNDLE_REGRESSION_INVALID', 'regression gate is invalid');
  if (validateTechnicalEvidencePromptEgress(egress).length > 0)
    fail('TECHNICAL_EVIDENCE_BUNDLE_EGRESS_INVALID', 'egress gate is invalid');
  if (
    regression.candidate.promptFingerprint !== prompt.promptFingerprint ||
    regression.candidate.contextFingerprint !== context.contextFingerprint
  )
    fail(
      'TECHNICAL_EVIDENCE_BUNDLE_REGRESSION_MISMATCH',
      'regression gate is not bound to candidate'
    );
  if (
    egress.promptFingerprint !== prompt.promptFingerprint ||
    egress.contextFingerprint !== context.contextFingerprint
  )
    fail('TECHNICAL_EVIDENCE_BUNDLE_EGRESS_MISMATCH', 'egress gate is not bound to prompt');
}

function gateProjection(gate, fields) {
  return Object.fromEntries(fields.map(field => [field, gate[field]]));
}

function artifactReference(slot, contractId, schemaVersion, fingerprint) {
  return { slot, contractId, schemaVersion, fingerprint };
}

function bundleIdentity({ context, prompt, regression, egress }) {
  const artifacts = [
    artifactReference(
      'context',
      'zeus.technical-evidence-context',
      context.schemaVersion,
      context.contextFingerprint
    ),
    artifactReference(
      'prompt',
      'zeus.technical-evidence-prompt',
      prompt.schemaVersion,
      prompt.promptFingerprint
    ),
    artifactReference(
      'regression',
      TECHNICAL_EVIDENCE_REGRESSION_CONTRACT_ID,
      TECHNICAL_EVIDENCE_REGRESSION_SCHEMA_VERSION,
      digest(regression)
    ),
    artifactReference(
      'egress',
      TECHNICAL_EVIDENCE_EGRESS_CONTRACT_ID,
      TECHNICAL_EVIDENCE_EGRESS_SCHEMA_VERSION,
      digest(egress)
    ),
  ];
  return {
    contextFingerprint: context.contextFingerprint,
    promptFingerprint: prompt.promptFingerprint,
    artifacts,
  };
}

function bundleFingerprint(bundle) {
  return `bundle:${digest({
    schemaVersion: bundle.schemaVersion,
    identity: bundle.identity,
    gates: bundle.gates,
    constraints: bundle.constraints,
  }).slice(0, 32)}`;
}

function buildTechnicalEvidencePromptBundle({ context, prompt, regression, egress } = {}) {
  validatePromptInputs(context, prompt);
  validateGateInputs(regression, egress, prompt, context);
  const identity = bundleIdentity({ context, prompt, regression, egress });
  const gates = {
    regression: gateProjection(regression, [
      'status',
      'gatePassed',
      'reviewRequired',
      'changes',
      'blockers',
      'warnings',
    ]),
    egress: gateProjection(egress, [
      'status',
      'gatePassed',
      'trustZone',
      'destination',
      'blockers',
      'providerHandoffAllowed',
      'externalPublicationAllowed',
    ]),
  };
  gates.egress.warnings = [];
  const ready = regression.gatePassed && egress.gatePassed;
  const bundle = {
    schemaVersion: TECHNICAL_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    kind: 'zeus-technical-evidence-prompt-bundle',
    contractId: TECHNICAL_EVIDENCE_BUNDLE_CONTRACT_ID,
    contractVersion: TECHNICAL_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    readOnly: true,
    localOnly: true,
    integrity: 'fingerprints-only',
    identity,
    gates,
    constraints: {
      containsPromptContent: false,
      containsSourceText: false,
      containsSourcePaths: false,
      containsSourceNames: false,
      containsCredentials: false,
      containsBusinessTerms: false,
      externalPublicationAllowed: false,
      providerHandoffAllowed: false,
    },
    status: ready ? 'ready' : 'blocked',
    handoffAllowed: false,
    automaticPromotion: false,
    promotionAllowed: false,
    externalPublicationAllowed: false,
    bundleId: null,
    bundleFingerprint: null,
    nextSafeStep: ready
      ? 'Create a required local review check before recording a handoff receipt.'
      : 'Resolve every blocked local gate and rebuild the bundle from exact matching artifacts.',
  };
  bundle.bundleFingerprint = bundleFingerprint(bundle);
  bundle.bundleId = bundle.bundleFingerprint;
  return bundle;
}

function validateTechnicalEvidencePromptBundle(value) {
  const errors = [];
  if (!isObject(value)) return ['bundle must be an object'];
  if (value.schemaVersion !== TECHNICAL_EVIDENCE_BUNDLE_SCHEMA_VERSION)
    errors.push('schemaVersion is unsupported');
  if (value.kind !== 'zeus-technical-evidence-prompt-bundle') errors.push('kind is invalid');
  if (value.contractId !== TECHNICAL_EVIDENCE_BUNDLE_CONTRACT_ID)
    errors.push('contractId is invalid');
  if (value.readOnly !== true || value.localOnly !== true)
    errors.push('bundle must be local-only and read-only');
  if (value.integrity !== 'fingerprints-only') errors.push('integrity mode is invalid');
  if (!isObject(value.identity)) errors.push('identity is required');
  else {
    if (!isFingerprint(value.identity.contextFingerprint))
      errors.push('identity.contextFingerprint is invalid');
    if (!isFingerprint(value.identity.promptFingerprint))
      errors.push('identity.promptFingerprint is invalid');
  }
  if (!Array.isArray(value.identity?.artifacts) || value.identity.artifacts.length !== 4)
    errors.push('identity.artifacts must contain four references');
  else {
    const slots = value.identity.artifacts.map(artifact => artifact && artifact.slot);
    if (JSON.stringify(slots) !== JSON.stringify(['context', 'prompt', 'regression', 'egress']))
      errors.push('identity.artifacts slots are invalid');
    for (const artifact of value.identity.artifacts) {
      if (!isObject(artifact)) {
        errors.push('artifact reference is invalid');
        continue;
      }
      if (typeof artifact.contractId !== 'string' || !artifact.contractId)
        errors.push('artifact contractId is invalid');
      if (!Number.isInteger(artifact.schemaVersion) || artifact.schemaVersion < 1)
        errors.push('artifact schemaVersion is invalid');
      if (
        !isFingerprint(artifact.fingerprint) &&
        !/^bundle:[a-f0-9]{32}$/i.test(artifact.fingerprint || '')
      )
        errors.push('artifact fingerprint is invalid');
    }
  }
  if (!isObject(value.gates)) errors.push('gates are required');
  else {
    for (const gateName of ['regression', 'egress']) {
      const gate = value.gates[gateName];
      if (!isObject(gate)) errors.push(`${gateName} gate is invalid`);
      else {
        if (!['pass', 'changed', 'blocked', 'allowed'].includes(gate.status))
          errors.push(`${gateName} status is invalid`);
        if (typeof gate.gatePassed !== 'boolean') errors.push(`${gateName}.gatePassed is invalid`);
        if (!Array.isArray(gate.blockers) || gate.blockers.some(item => typeof item !== 'string'))
          errors.push(`${gateName}.blockers are invalid`);
        if (!Array.isArray(gate.warnings) || gate.warnings.some(item => typeof item !== 'string'))
          errors.push(`${gateName}.warnings are invalid`);
      }
    }
  }
  if (!isObject(value.constraints)) errors.push('constraints are required');
  else {
    for (const field of [
      'containsPromptContent',
      'containsSourceText',
      'containsSourcePaths',
      'containsSourceNames',
      'containsCredentials',
      'containsBusinessTerms',
      'externalPublicationAllowed',
      'providerHandoffAllowed',
    ]) {
      if (value.constraints[field] !== false) errors.push(`${field} must be false`);
    }
  }
  if (!['ready', 'blocked'].includes(value.status)) errors.push('status is invalid');
  if (value.handoffAllowed !== false) errors.push('handoff must remain disabled');
  if (value.externalPublicationAllowed !== false)
    errors.push('external publication must be disabled');
  if (value.bundleId !== value.bundleFingerprint)
    errors.push('bundle id and fingerprint must match');
  if (!/^bundle:[a-f0-9]{32}$/i.test(value.bundleFingerprint || ''))
    errors.push('bundle fingerprint is invalid');
  if (errors.length === 0 && bundleFingerprint(value) !== value.bundleFingerprint)
    errors.push('bundle fingerprint does not match content');
  return errors;
}

function bundleCheckFingerprint(bundle) {
  return bundle && typeof bundle.bundleFingerprint === 'string' ? bundle.bundleFingerprint : null;
}

function buildTechnicalEvidencePromptBundleCheck({
  bundle,
  context,
  prompt,
  regression,
  egress,
} = {}) {
  validatePromptInputs(context, prompt);
  const bundleErrors = validateTechnicalEvidencePromptBundle(bundle);
  if (bundleErrors.length > 0)
    fail('TECHNICAL_EVIDENCE_BUNDLE_CHECK_BUNDLE_INVALID', 'prompt bundle is invalid');
  const expected = buildTechnicalEvidencePromptBundle({
    context,
    prompt,
    regression,
    egress,
  });
  const mismatches = [];
  if (bundle.identity.contextFingerprint !== expected.identity.contextFingerprint)
    mismatches.push('CONTEXT_FINGERPRINT_MISMATCH');
  if (bundle.identity.promptFingerprint !== expected.identity.promptFingerprint)
    mismatches.push('PROMPT_FINGERPRINT_MISMATCH');
  if (bundle.bundleFingerprint !== expected.bundleFingerprint)
    mismatches.push('BUNDLE_FINGERPRINT_MISMATCH');
  if (stableStringify(bundle.identity.artifacts) !== stableStringify(expected.identity.artifacts))
    mismatches.push('ARTIFACT_REFERENCE_MISMATCH');
  if (stableStringify(bundle.gates) !== stableStringify(expected.gates))
    mismatches.push('GATE_PROJECTION_MISMATCH');
  const uniqueMismatches = [...new Set(mismatches)].sort();
  const verified = uniqueMismatches.length === 0;
  return {
    schemaVersion: TECHNICAL_EVIDENCE_BUNDLE_CHECK_SCHEMA_VERSION,
    kind: 'zeus-technical-evidence-bundle-check',
    contractId: TECHNICAL_EVIDENCE_BUNDLE_CHECK_CONTRACT_ID,
    contractVersion: TECHNICAL_EVIDENCE_BUNDLE_CHECK_SCHEMA_VERSION,
    readOnly: true,
    localOnly: true,
    status: verified ? 'pass' : 'blocked',
    gatePassed: verified,
    bundleFingerprint: bundleCheckFingerprint(bundle),
    replayedBundleFingerprint: expected.bundleFingerprint,
    identity: {
      contextFingerprint: context.contextFingerprint,
      promptFingerprint: prompt.promptFingerprint,
    },
    mismatches: uniqueMismatches,
    externalPublicationAllowed: false,
    providerHandoffAllowed: false,
    automaticPromotion: false,
    promotionAllowed: false,
    nextSafeStep: verified
      ? 'Keep the verified local check with the exact bundle inputs and rerun after any change.'
      : 'Restore the exact local bundle inputs, rebuild the bundle, and rerun the local check.',
  };
}

function validateTechnicalEvidencePromptBundleCheck(value) {
  const errors = [];
  if (!isObject(value)) return ['bundle check must be an object'];
  if (value.schemaVersion !== TECHNICAL_EVIDENCE_BUNDLE_CHECK_SCHEMA_VERSION)
    errors.push('schemaVersion is unsupported');
  if (value.kind !== 'zeus-technical-evidence-bundle-check') errors.push('kind is invalid');
  if (value.contractId !== TECHNICAL_EVIDENCE_BUNDLE_CHECK_CONTRACT_ID)
    errors.push('contractId is invalid');
  if (value.readOnly !== true || value.localOnly !== true)
    errors.push('bundle check must be local-only and read-only');
  if (!['pass', 'blocked'].includes(value.status)) errors.push('status is invalid');
  if (value.gatePassed !== (value.status === 'pass'))
    errors.push('gatePassed does not match status');
  if (!/^bundle:[a-f0-9]{32}$/i.test(value.bundleFingerprint || ''))
    errors.push('bundle fingerprint is invalid');
  if (!/^bundle:[a-f0-9]{32}$/i.test(value.replayedBundleFingerprint || ''))
    errors.push('replayed bundle fingerprint is invalid');
  if (!isObject(value.identity)) errors.push('identity is required');
  else {
    if (!isFingerprint(value.identity.contextFingerprint))
      errors.push('context fingerprint is invalid');
    if (!isFingerprint(value.identity.promptFingerprint))
      errors.push('prompt fingerprint is invalid');
  }
  if (!Array.isArray(value.mismatches) || value.mismatches.some(item => typeof item !== 'string'))
    errors.push('mismatches are invalid');
  if (value.externalPublicationAllowed !== false)
    errors.push('external publication must be disabled');
  if (value.providerHandoffAllowed !== false) errors.push('provider handoff must be disabled');
  if (value.automaticPromotion !== false || value.promotionAllowed !== false)
    errors.push('promotion must be disabled');
  return errors;
}

function acceptanceFingerprint(value) {
  return `acceptance:${digest({
    schemaVersion: value.schemaVersion,
    identity: value.identity,
    bundleFingerprint: value.bundleFingerprint,
    checks: value.checks,
    blockers: value.blockers,
    status: value.status,
  }).slice(0, 32)}`;
}

function buildTechnicalEvidenceAcceptanceCheck({ bundle, bundleCheck, handoff } = {}) {
  if (validateTechnicalEvidencePromptBundle(bundle).length > 0)
    fail('TECHNICAL_EVIDENCE_ACCEPTANCE_BUNDLE_INVALID', 'prompt bundle is invalid');
  if (validateTechnicalEvidencePromptBundleCheck(bundleCheck).length > 0)
    fail('TECHNICAL_EVIDENCE_ACCEPTANCE_BUNDLE_CHECK_INVALID', 'bundle check is invalid');
  if (validateTechnicalEvidenceHandoffReceipt(handoff).length > 0)
    fail('TECHNICAL_EVIDENCE_ACCEPTANCE_HANDOFF_INVALID', 'handoff receipt is invalid');

  const blockers = [];
  if (bundle.status !== 'ready') blockers.push('BUNDLE_GATE_BLOCKED');
  if (bundle.gates.regression.gatePassed !== true) blockers.push('REGRESSION_GATE_BLOCKED');
  if (bundle.gates.egress.gatePassed !== true) blockers.push('EGRESS_GATE_BLOCKED');
  if (
    bundle.gates.egress.providerHandoffAllowed !== false ||
    bundle.gates.egress.externalPublicationAllowed !== false
  )
    blockers.push('EGRESS_BOUNDARY_INVALID');
  if (bundleCheck.status !== 'pass' || bundleCheck.gatePassed !== true)
    blockers.push('BUNDLE_REPLAY_BLOCKED');
  if (bundleCheck.bundleFingerprint !== bundle.bundleFingerprint)
    blockers.push('BUNDLE_CHECK_BUNDLE_MISMATCH');
  if (bundleCheck.replayedBundleFingerprint !== bundle.bundleFingerprint)
    blockers.push('BUNDLE_REPLAY_FINGERPRINT_MISMATCH');
  if (handoff.status !== 'accepted' || handoff.handoffAllowed !== true)
    blockers.push('HANDOFF_BLOCKED');
  if (handoff.bundleFingerprint !== bundle.bundleFingerprint)
    blockers.push('HANDOFF_BUNDLE_MISMATCH');
  if (
    handoff.identity.contextFingerprint !== bundle.identity.contextFingerprint ||
    handoff.identity.promptFingerprint !== bundle.identity.promptFingerprint
  )
    blockers.push('HANDOFF_IDENTITY_MISMATCH');
  if (
    handoff.review.policy !== 'required' ||
    handoff.review.status !== 'approved' ||
    handoff.review.gatePassed !== true
  )
    blockers.push('HANDOFF_REVIEW_BLOCKED');

  const uniqueBlockers = [...new Set(blockers)].sort();
  const accepted = uniqueBlockers.length === 0;
  const result = {
    schemaVersion: TECHNICAL_EVIDENCE_ACCEPTANCE_SCHEMA_VERSION,
    kind: 'zeus-technical-evidence-acceptance-check',
    contractId: TECHNICAL_EVIDENCE_ACCEPTANCE_CONTRACT_ID,
    contractVersion: TECHNICAL_EVIDENCE_ACCEPTANCE_SCHEMA_VERSION,
    readOnly: true,
    localOnly: true,
    status: accepted ? 'accepted' : 'blocked',
    gatePassed: accepted,
    identity: {
      contextFingerprint: bundle.identity.contextFingerprint,
      promptFingerprint: bundle.identity.promptFingerprint,
    },
    bundleFingerprint: bundle.bundleFingerprint,
    checks: {
      bundleReplay: {
        status: bundleCheck.status,
        gatePassed: bundleCheck.gatePassed,
      },
      regression: {
        status: bundle.gates.regression.status,
        gatePassed: bundle.gates.regression.gatePassed,
      },
      egress: {
        status: bundle.gates.egress.status,
        gatePassed: bundle.gates.egress.gatePassed,
        trustZone: bundle.gates.egress.trustZone,
        destination: bundle.gates.egress.destination,
      },
      handoff: {
        status: handoff.status,
        handoffAllowed: handoff.handoffAllowed,
        reviewPolicy: handoff.review.policy,
        reviewStatus: handoff.review.status,
        reviewGatePassed: handoff.review.gatePassed,
      },
    },
    blockers: uniqueBlockers,
    externalPublicationAllowed: false,
    providerHandoffAllowed: false,
    automaticPromotion: false,
    promotionAllowed: false,
    acceptanceId: null,
    acceptanceFingerprint: null,
    nextSafeStep: accepted
      ? 'Keep this local acceptance check with the exact fingerprint-only artifacts; no external handoff is enabled.'
      : 'Resolve every local blocker and rerun the acceptance check from exact matching artifacts.',
  };
  result.acceptanceFingerprint = acceptanceFingerprint(result);
  result.acceptanceId = result.acceptanceFingerprint;
  return result;
}

function validateTechnicalEvidenceAcceptanceCheck(value) {
  const errors = [];
  if (!isObject(value)) return ['acceptance check must be an object'];
  if (value.schemaVersion !== TECHNICAL_EVIDENCE_ACCEPTANCE_SCHEMA_VERSION)
    errors.push('schemaVersion is unsupported');
  if (value.kind !== 'zeus-technical-evidence-acceptance-check') errors.push('kind is invalid');
  if (value.contractId !== TECHNICAL_EVIDENCE_ACCEPTANCE_CONTRACT_ID)
    errors.push('contractId is invalid');
  if (value.readOnly !== true || value.localOnly !== true)
    errors.push('acceptance check must be local-only and read-only');
  if (!['accepted', 'blocked'].includes(value.status)) errors.push('status is invalid');
  if (value.gatePassed !== (value.status === 'accepted'))
    errors.push('gatePassed does not match status');
  if (!isObject(value.identity)) errors.push('identity is required');
  else {
    if (!isFingerprint(value.identity.contextFingerprint))
      errors.push('context fingerprint is invalid');
    if (!isFingerprint(value.identity.promptFingerprint))
      errors.push('prompt fingerprint is invalid');
  }
  if (!/^bundle:[a-f0-9]{32}$/i.test(value.bundleFingerprint || ''))
    errors.push('bundle fingerprint is invalid');
  if (!isObject(value.checks)) errors.push('checks are required');
  else {
    for (const name of ['bundleReplay', 'regression', 'egress', 'handoff']) {
      if (!isObject(value.checks[name])) errors.push(`${name} check is invalid`);
    }
    if (isObject(value.checks.bundleReplay)) {
      if (!['pass', 'blocked'].includes(value.checks.bundleReplay.status))
        errors.push('bundleReplay status is invalid');
      if (typeof value.checks.bundleReplay.gatePassed !== 'boolean')
        errors.push('bundleReplay gate is invalid');
    }
    for (const name of ['regression', 'egress']) {
      if (isObject(value.checks[name])) {
        if (typeof value.checks[name].status !== 'string') errors.push(`${name} status is invalid`);
        if (typeof value.checks[name].gatePassed !== 'boolean')
          errors.push(`${name} gate is invalid`);
      }
    }
    if (isObject(value.checks.handoff)) {
      if (!['accepted', 'blocked'].includes(value.checks.handoff.status))
        errors.push('handoff status is invalid');
      if (typeof value.checks.handoff.handoffAllowed !== 'boolean')
        errors.push('handoff gate is invalid');
      if (!['off', 'advisory', 'required'].includes(value.checks.handoff.reviewPolicy))
        errors.push('handoff review policy is invalid');
      if (typeof value.checks.handoff.reviewStatus !== 'string')
        errors.push('handoff review status is invalid');
      if (typeof value.checks.handoff.reviewGatePassed !== 'boolean')
        errors.push('handoff review gate is invalid');
    }
  }
  if (!Array.isArray(value.blockers) || value.blockers.some(item => typeof item !== 'string'))
    errors.push('blockers are invalid');
  for (const field of [
    'externalPublicationAllowed',
    'providerHandoffAllowed',
    'automaticPromotion',
    'promotionAllowed',
  ]) {
    if (value[field] !== false) errors.push(`${field} must be false`);
  }
  if (!/^acceptance:[a-f0-9]{32}$/i.test(value.acceptanceId || ''))
    errors.push('acceptanceId is invalid');
  if (value.acceptanceFingerprint !== value.acceptanceId)
    errors.push('acceptance fingerprints must match');
  if (errors.length === 0 && acceptanceFingerprint(value) !== value.acceptanceFingerprint)
    errors.push('acceptance fingerprint does not match content');
  return errors;
}

function validateReviewCheck(review) {
  if (!isObject(review))
    fail('TECHNICAL_EVIDENCE_HANDOFF_REVIEW_INVALID', 'review check is required');
  if (review.kind !== 'zeus-technical-evidence-review-check')
    fail('TECHNICAL_EVIDENCE_HANDOFF_REVIEW_INVALID', 'review check kind is invalid');
  if (review.readOnly !== true || review.localOnly !== true)
    fail('TECHNICAL_EVIDENCE_HANDOFF_REVIEW_INVALID', 'review check must be local-only');
  if (!isObject(review.identity))
    fail('TECHNICAL_EVIDENCE_HANDOFF_REVIEW_INVALID', 'review identity is required');
  if (typeof review.gatePassed !== 'boolean')
    fail('TECHNICAL_EVIDENCE_HANDOFF_REVIEW_INVALID', 'review gate is invalid');
  if (!['off', 'advisory', 'required'].includes(review.policy))
    fail('TECHNICAL_EVIDENCE_HANDOFF_REVIEW_INVALID', 'review policy is invalid');
  requireFingerprint(review.identity.contextFingerprint, 'review context fingerprint');
  requireFingerprint(review.identity.promptFingerprint, 'review prompt fingerprint');
}

function handoffFingerprint(receipt) {
  return `handoff:${digest({
    schemaVersion: receipt.schemaVersion,
    identity: receipt.identity,
    bundleFingerprint: receipt.bundleFingerprint,
    review: receipt.review,
    destination: receipt.destination,
    status: receipt.status,
  }).slice(0, 32)}`;
}

function buildTechnicalEvidenceHandoffReceipt({ bundle, review } = {}) {
  if (validateTechnicalEvidencePromptBundle(bundle).length > 0)
    fail('TECHNICAL_EVIDENCE_HANDOFF_BUNDLE_INVALID', 'prompt bundle is invalid');
  validateReviewCheck(review);
  if (
    review.identity.contextFingerprint !== bundle.identity.contextFingerprint ||
    review.identity.promptFingerprint !== bundle.identity.promptFingerprint
  )
    fail('TECHNICAL_EVIDENCE_HANDOFF_IDENTITY_MISMATCH', 'review is not bound to bundle');
  const blockers = [];
  if (bundle.status !== 'ready') blockers.push('BUNDLE_GATE_BLOCKED');
  if (review.policy !== 'required') blockers.push('REVIEW_POLICY_REQUIRED');
  if (review.status !== 'approved' || review.gatePassed !== true)
    blockers.push('REVIEW_GATE_BLOCKED');
  const receipt = {
    schemaVersion: TECHNICAL_EVIDENCE_HANDOFF_SCHEMA_VERSION,
    kind: 'zeus-technical-evidence-handoff-receipt',
    contractId: TECHNICAL_EVIDENCE_HANDOFF_CONTRACT_ID,
    contractVersion: TECHNICAL_EVIDENCE_HANDOFF_SCHEMA_VERSION,
    readOnly: true,
    localOnly: true,
    destination: HANDOFF_DESTINATION,
    identity: bundle.identity,
    bundleFingerprint: bundle.bundleFingerprint,
    review: {
      policy: review.policy,
      status: review.status,
      gatePassed: review.gatePassed,
      receiptId: review.receipt?.receiptId || null,
    },
    status: blockers.length === 0 ? 'accepted' : 'blocked',
    blockers: [...new Set(blockers)].sort(),
    handoffAllowed: blockers.length === 0,
    providerHandoffAllowed: false,
    externalPublicationAllowed: false,
    automaticPromotion: false,
    promotionAllowed: false,
    receiptId: null,
    receiptFingerprint: null,
    nextSafeStep:
      blockers.length === 0
        ? 'Keep this local receipt with the exact bundle and rerun integrity checks after any change.'
        : 'Resolve every local bundle and review blocker before recording a new handoff receipt.',
  };
  receipt.receiptFingerprint = handoffFingerprint(receipt);
  receipt.receiptId = receipt.receiptFingerprint;
  return receipt;
}

function validateTechnicalEvidenceHandoffReceipt(value) {
  const errors = [];
  if (!isObject(value)) return ['handoff receipt must be an object'];
  if (value.schemaVersion !== TECHNICAL_EVIDENCE_HANDOFF_SCHEMA_VERSION)
    errors.push('schemaVersion is unsupported');
  if (value.kind !== 'zeus-technical-evidence-handoff-receipt') errors.push('kind is invalid');
  if (value.contractId !== TECHNICAL_EVIDENCE_HANDOFF_CONTRACT_ID)
    errors.push('contractId is invalid');
  if (value.readOnly !== true || value.localOnly !== true)
    errors.push('handoff receipt must be local-only and read-only');
  if (value.destination !== HANDOFF_DESTINATION) errors.push('destination is invalid');
  if (!isObject(value.identity)) errors.push('identity is required');
  else {
    if (!isFingerprint(value.identity.contextFingerprint))
      errors.push('context fingerprint is invalid');
    if (!isFingerprint(value.identity.promptFingerprint))
      errors.push('prompt fingerprint is invalid');
  }
  if (!/^bundle:[a-f0-9]{32}$/i.test(value.bundleFingerprint || ''))
    errors.push('bundle fingerprint is invalid');
  if (!isObject(value.review)) errors.push('review is required');
  else {
    if (!['off', 'advisory', 'required'].includes(value.review.policy))
      errors.push('review policy is invalid');
    if (typeof value.review.gatePassed !== 'boolean') errors.push('review gate is invalid');
  }
  if (!['accepted', 'blocked'].includes(value.status)) errors.push('status is invalid');
  if (!Array.isArray(value.blockers) || value.blockers.some(item => typeof item !== 'string'))
    errors.push('blockers are invalid');
  if (value.handoffAllowed !== (value.status === 'accepted'))
    errors.push('handoffAllowed does not match status');
  for (const field of [
    'providerHandoffAllowed',
    'externalPublicationAllowed',
    'automaticPromotion',
    'promotionAllowed',
  ]) {
    if (value[field] !== false) errors.push(`${field} must be false`);
  }
  if (!/^handoff:[a-f0-9]{32}$/i.test(value.receiptId || '')) errors.push('receiptId is invalid');
  if (value.receiptFingerprint !== value.receiptId) errors.push('receipt fingerprints must match');
  if (errors.length === 0 && handoffFingerprint(value) !== value.receiptFingerprint)
    errors.push('handoff fingerprint does not match content');
  return errors;
}

module.exports = {
  HANDOFF_DESTINATION,
  TECHNICAL_EVIDENCE_ACCEPTANCE_CONTRACT_ID,
  TECHNICAL_EVIDENCE_ACCEPTANCE_SCHEMA_VERSION,
  TECHNICAL_EVIDENCE_BUNDLE_CHECK_CONTRACT_ID,
  TECHNICAL_EVIDENCE_BUNDLE_CHECK_SCHEMA_VERSION,
  TECHNICAL_EVIDENCE_BUNDLE_CONTRACT_ID,
  TECHNICAL_EVIDENCE_BUNDLE_SCHEMA_VERSION,
  TECHNICAL_EVIDENCE_HANDOFF_CONTRACT_ID,
  TECHNICAL_EVIDENCE_HANDOFF_SCHEMA_VERSION,
  TechnicalEvidenceBundleError,
  buildTechnicalEvidenceAcceptanceCheck,
  buildTechnicalEvidenceHandoffReceipt,
  buildTechnicalEvidencePromptBundleCheck,
  buildTechnicalEvidencePromptBundle,
  validateTechnicalEvidenceAcceptanceCheck,
  validateTechnicalEvidenceHandoffReceipt,
  validateTechnicalEvidencePromptBundleCheck,
  validateTechnicalEvidencePromptBundle,
};
