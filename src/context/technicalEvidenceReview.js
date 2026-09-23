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
const { validateTechnicalEvidenceContext } = require('./technicalEvidenceContext');
const { validateTechnicalEvidencePrompt } = require('../prompt/technicalEvidencePromptAdapter');

const TECHNICAL_EVIDENCE_REVIEW_SCHEMA_VERSION = 1;
const TECHNICAL_EVIDENCE_REVIEW_CONTRACT_ID = 'zeus.technical-evidence-review';
const REVIEW_DECISIONS = Object.freeze(['approve', 'reject', 'defer']);
const REVIEW_POLICIES = Object.freeze(['off', 'advisory', 'required']);
const DEFAULT_REVIEW_FRESH_DAYS = 30;
const MAX_REVIEW_DAYS = 3650;

class TechnicalEvidenceReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TechnicalEvidenceReviewError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TechnicalEvidenceReviewError(code, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function digest(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function requireFingerprint(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value))
    fail('TECHNICAL_EVIDENCE_REVIEW_INPUT_INVALID', `${label} must be a fingerprint`);
}

function normalizeDecision(value) {
  const decision = String(value || '')
    .trim()
    .toLowerCase();
  if (!REVIEW_DECISIONS.includes(decision))
    fail('TECHNICAL_EVIDENCE_REVIEW_DECISION_INVALID', 'review decision is not supported');
  return decision;
}

function normalizeReviewer(value) {
  const reviewer = String(value || '').trim();
  if (!reviewer || reviewer.length > 200)
    fail('TECHNICAL_EVIDENCE_REVIEWER_INVALID', 'reviewer is required and bounded');
  return reviewer;
}

function normalizeTimestamp(value, label, fallback = new Date()) {
  const date = value === undefined || value === '' ? fallback : new Date(String(value));
  if (!(date instanceof Date) || Number.isNaN(date.getTime()))
    fail('TECHNICAL_EVIDENCE_REVIEW_TIMESTAMP_INVALID', `${label} must be an ISO timestamp`);
  return date.toISOString();
}

function normalizeDays(value) {
  const days = value === undefined || value === '' ? DEFAULT_REVIEW_FRESH_DAYS : Number(value);
  if (!Number.isInteger(days) || days < 1 || days > MAX_REVIEW_DAYS)
    fail('TECHNICAL_EVIDENCE_REVIEW_POLICY_INVALID', 'freshDays is outside the approved bound');
  return days;
}

function reviewerHash(reviewer) {
  return `reviewer:${digest(normalizeReviewer(reviewer)).slice(0, 16)}`;
}

function identityFor(context, prompt) {
  requireFingerprint(context.contextFingerprint, 'context fingerprint');
  requireFingerprint(prompt.promptFingerprint, 'prompt fingerprint');
  if (prompt.contextFingerprint !== context.contextFingerprint)
    fail('TECHNICAL_EVIDENCE_REVIEW_CONTEXT_MISMATCH', 'prompt is not bound to context');
  return {
    contextFingerprint: context.contextFingerprint,
    promptFingerprint: prompt.promptFingerprint,
  };
}

function receiptFingerprint({ identity, decision, reviewerHashValue, reviewedAt, freshDays }) {
  return `receipt:${digest({ identity, decision, reviewerHash: reviewerHashValue, reviewedAt, freshDays }).slice(0, 16)}`;
}

function validateInputs(context, prompt) {
  if (validateTechnicalEvidenceContext(context).length > 0)
    fail('TECHNICAL_EVIDENCE_REVIEW_CONTEXT_INVALID', 'technical evidence context is invalid');
  if (validateTechnicalEvidencePrompt(prompt).length > 0)
    fail('TECHNICAL_EVIDENCE_REVIEW_PROMPT_INVALID', 'technical evidence prompt is invalid');
}

function buildTechnicalEvidenceReviewReceipt({
  context,
  prompt,
  decision,
  reviewer,
  reviewedAt,
  freshDays,
} = {}) {
  validateInputs(context, prompt);
  const identity = identityFor(context, prompt);
  const normalizedDecision = normalizeDecision(decision);
  const reviewerHashValue = reviewerHash(reviewer);
  const normalizedReviewedAt = normalizeTimestamp(reviewedAt, 'reviewedAt');
  const normalizedFreshDays = normalizeDays(freshDays);
  const fingerprint = receiptFingerprint({
    identity,
    decision: normalizedDecision,
    reviewerHashValue,
    reviewedAt: normalizedReviewedAt,
    freshDays: normalizedFreshDays,
  });
  return {
    schemaVersion: TECHNICAL_EVIDENCE_REVIEW_SCHEMA_VERSION,
    kind: 'zeus-technical-evidence-review-receipt',
    contractId: TECHNICAL_EVIDENCE_REVIEW_CONTRACT_ID,
    contractVersion: TECHNICAL_EVIDENCE_REVIEW_SCHEMA_VERSION,
    readOnly: true,
    localOnly: true,
    identity,
    decision: normalizedDecision,
    reviewerHash: reviewerHashValue,
    reviewedAt: normalizedReviewedAt,
    freshDays: normalizedFreshDays,
    receiptId: fingerprint,
    receiptFingerprint: fingerprint,
    automaticPromotion: false,
    promotionAllowed: false,
    automaticDeployment: false,
    deploymentAllowed: false,
    externalPublicationAllowed: false,
    nextSafeStep:
      normalizedDecision === 'approve'
        ? 'Run the local review check again before using this prompt artifact.'
        : 'Resolve the local review decision and record a new receipt for the exact prompt artifact.',
  };
}

function validateTechnicalEvidenceReviewReceipt(value) {
  const errors = [];
  if (!isObject(value)) return ['receipt must be an object'];
  if (value.schemaVersion !== TECHNICAL_EVIDENCE_REVIEW_SCHEMA_VERSION)
    errors.push('schemaVersion is unsupported');
  if (value.kind !== 'zeus-technical-evidence-review-receipt') errors.push('kind is invalid');
  if (value.contractId !== TECHNICAL_EVIDENCE_REVIEW_CONTRACT_ID)
    errors.push('contractId is invalid');
  if (value.readOnly !== true || value.localOnly !== true)
    errors.push('receipt must be local-only and read-only');
  if (!isObject(value.identity)) errors.push('identity is required');
  else {
    if (!/^[a-f0-9]{64}$/i.test(String(value.identity.contextFingerprint || '')))
      errors.push('identity.contextFingerprint is invalid');
    if (!/^[a-f0-9]{64}$/i.test(String(value.identity.promptFingerprint || '')))
      errors.push('identity.promptFingerprint is invalid');
  }
  if (!REVIEW_DECISIONS.includes(value.decision)) errors.push('decision is invalid');
  if (!/^reviewer:[a-f0-9]{16}$/i.test(String(value.reviewerHash || '')))
    errors.push('reviewerHash is invalid');
  if (typeof value.reviewedAt !== 'string' || Number.isNaN(new Date(value.reviewedAt).getTime()))
    errors.push('reviewedAt is invalid');
  if (
    !Number.isInteger(value.freshDays) ||
    value.freshDays < 1 ||
    value.freshDays > MAX_REVIEW_DAYS
  )
    errors.push('freshDays is invalid');
  for (const field of [
    'automaticPromotion',
    'promotionAllowed',
    'automaticDeployment',
    'deploymentAllowed',
    'externalPublicationAllowed',
  ]) {
    if (value[field] !== false) errors.push(`${field} must be false`);
  }
  if (errors.length === 0) {
    const expected = receiptFingerprint({
      identity: value.identity,
      decision: value.decision,
      reviewerHashValue: value.reviewerHash,
      reviewedAt: new Date(value.reviewedAt).toISOString(),
      freshDays: value.freshDays,
    });
    if (value.receiptId !== expected || value.receiptFingerprint !== expected)
      errors.push('receipt fingerprint does not match content');
  }
  return errors;
}

function identityMismatches(expected, actual) {
  const blockers = [];
  if (expected.contextFingerprint !== actual.contextFingerprint)
    blockers.push('CONTEXT_FINGERPRINT_MISMATCH');
  if (expected.promptFingerprint !== actual.promptFingerprint)
    blockers.push('PROMPT_FINGERPRINT_MISMATCH');
  return blockers;
}

function classifyFreshness(reviewedAt, asOf, freshDays) {
  const reviewedMs = new Date(reviewedAt).getTime();
  const asOfMs = new Date(asOf).getTime();
  if (Number.isNaN(reviewedMs) || Number.isNaN(asOfMs)) return { status: 'invalid', ageDays: null };
  const ageMs = asOfMs - reviewedMs;
  if (ageMs < 0) return { status: 'future', ageDays: 0 };
  const ageDays = Math.floor(ageMs / 86_400_000);
  return { status: ageDays <= freshDays ? 'fresh' : 'expired', ageDays };
}

function checkTechnicalEvidenceReview({
  context,
  prompt,
  receipt,
  policy = 'off',
  asOf,
  freshDays,
} = {}) {
  validateInputs(context, prompt);
  const normalizedPolicy = String(policy || 'off')
    .trim()
    .toLowerCase();
  if (!REVIEW_POLICIES.includes(normalizedPolicy))
    fail('TECHNICAL_EVIDENCE_REVIEW_POLICY_INVALID', 'review policy is not supported');
  const identity = identityFor(context, prompt);
  const blockers = [];
  const normalizedFreshDays = normalizeDays(freshDays);
  const inspectedAt = normalizeTimestamp(asOf, 'asOf');
  if (!receipt) blockers.push('TECHNICAL_EVIDENCE_REVIEW_MISSING');
  else {
    blockers.push(
      ...validateTechnicalEvidenceReviewReceipt(receipt).map(
        () => 'TECHNICAL_EVIDENCE_REVIEW_INVALID'
      )
    );
    blockers.push(...identityMismatches(identity, receipt.identity || {}));
    if (receipt.decision !== 'approve') blockers.push('TECHNICAL_EVIDENCE_REVIEW_NOT_APPROVED');
    if (receipt.freshDays !== normalizedFreshDays)
      blockers.push('TECHNICAL_EVIDENCE_REVIEW_POLICY_MISMATCH');
    if (typeof receipt.reviewedAt === 'string') {
      const freshness = classifyFreshness(receipt.reviewedAt, inspectedAt, normalizedFreshDays);
      if (freshness.status === 'future') blockers.push('TECHNICAL_EVIDENCE_REVIEW_IN_FUTURE');
      if (freshness.status === 'expired') blockers.push('TECHNICAL_EVIDENCE_REVIEW_EXPIRED');
    }
  }
  const uniqueBlockers = [...new Set(blockers)];
  const valid = uniqueBlockers.length === 0;
  const gatePassed = normalizedPolicy !== 'required' || valid;
  return {
    ok: true,
    kind: 'zeus-technical-evidence-review-check',
    schemaVersion: TECHNICAL_EVIDENCE_REVIEW_SCHEMA_VERSION,
    readOnly: true,
    localOnly: true,
    status:
      normalizedPolicy === 'off'
        ? 'not-required'
        : valid
          ? 'approved'
          : normalizedPolicy === 'advisory'
            ? 'warning'
            : 'blocked',
    policy: normalizedPolicy,
    gatePassed,
    reviewRequired: normalizedPolicy === 'required',
    identity,
    receipt: receipt
      ? {
          status: 'loaded',
          receiptId: receipt.receiptId || null,
          decision: receipt.decision || null,
          reviewerHash: receipt.reviewerHash || null,
          reviewedAt: receipt.reviewedAt || null,
          freshness: receipt.reviewedAt
            ? classifyFreshness(receipt.reviewedAt, inspectedAt, normalizedFreshDays)
            : null,
        }
      : {
          status: 'missing',
          receiptId: null,
          decision: null,
          reviewerHash: null,
          reviewedAt: null,
          freshness: null,
        },
    blockers: uniqueBlockers,
    warnings: normalizedPolicy === 'advisory' ? uniqueBlockers : [],
    automaticPromotion: false,
    promotionAllowed: false,
    automaticDeployment: false,
    deploymentAllowed: false,
    externalPublicationAllowed: false,
    nextSafeStep: valid
      ? 'Keep the receipt with the exact context and prompt artifacts and rerun after any change.'
      : 'Record a fresh approved receipt for the exact context and prompt artifacts, then rerun the local check.',
  };
}

module.exports = {
  DEFAULT_REVIEW_FRESH_DAYS,
  REVIEW_DECISIONS,
  REVIEW_POLICIES,
  TECHNICAL_EVIDENCE_REVIEW_CONTRACT_ID,
  TECHNICAL_EVIDENCE_REVIEW_SCHEMA_VERSION,
  TechnicalEvidenceReviewError,
  buildTechnicalEvidenceReviewReceipt,
  checkTechnicalEvidenceReview,
  validateTechnicalEvidenceReviewReceipt,
};
