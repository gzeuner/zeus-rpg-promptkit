'use strict';

const {
  CONTRACT_ID,
  CONTRACT_VERSION,
  CONTRACT_REF,
  STOP_CODES,
  LIMITS,
  NON_CLAIMS,
  DISPOSITIONS,
} = require('./constants');
const { redactText } = require('./canonicalDiagnostics');
const { sanitizeValidationReport, sanitizeValue } = require('./sanitize');

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundString(value, maxChars) {
  const text = redactText(value == null ? '' : String(value));
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

const STOP_CODE_SET = new Set(Object.values(STOP_CODES));
const DISPOSITION_SET = new Set(Object.values(DISPOSITIONS));

/**
 * Build one attempt record for the portable history contract.
 * Validation reports are sanitized; never store raw secret-bearing reports.
 */
function buildAttemptRecord({
  index,
  candidateSnapshot,
  candidateSha256,
  validationReport,
  canonicalDiagnostics,
  fingerprint,
  qualityVector,
  disposition,
  providerIdentity = null,
  correlationId = null,
  usage = null,
  evidenceReferences = null,
  stopCode = null,
  isFinal = false,
}) {
  const safeReport = sanitizeValidationReport(validationReport);
  const safeSnapshot = sanitizeValue(candidateSnapshot) || {};
  const record = {
    index: Number(index),
    disposition: String(disposition),
    candidate: {
      snapshot: deepClone(safeSnapshot),
      sha256: String(candidateSha256 || ''),
    },
    validationReport: deepClone(safeReport),
    canonicalDiagnostics: deepClone(canonicalDiagnostics || []),
    fingerprint: String(fingerprint || ''),
    qualityVector: Array.isArray(qualityVector) ? qualityVector.map(Number) : [],
    isFinal: isFinal === true,
  };
  if (stopCode) {
    const code = String(stopCode);
    if (!STOP_CODE_SET.has(code)) {
      throw new Error(`unknown stop code: ${code}`);
    }
    record.stopCode = code;
  }
  if (providerIdentity && isPlainObject(providerIdentity)) {
    record.providerIdentity = {
      providerId: providerIdentity.providerId ? String(providerIdentity.providerId) : null,
      modelId: providerIdentity.modelId
        ? String(providerIdentity.modelId)
        : providerIdentity.model
          ? String(providerIdentity.model)
          : null,
      advisoryOnly: true,
      sourceOfTruth: false,
    };
  }
  if (correlationId != null) {
    record.correlationId = boundString(correlationId, LIMITS.maxCorrelationIdChars);
  }
  if (usage && isPlainObject(usage)) {
    const bounded = {};
    for (const key of ['inputUnits', 'outputUnits', 'totalUnits']) {
      if (usage[key] !== undefined && Number.isInteger(usage[key]) && usage[key] >= 0) {
        bounded[key] = usage[key];
      }
    }
    if (Object.keys(bounded).length) record.usage = bounded;
  }
  if (Array.isArray(evidenceReferences)) {
    record.evidenceReferences = evidenceReferences
      .slice(0, LIMITS.maxEvidenceReferences)
      .map(ref => ({
        id: boundString(ref && ref.id, 128),
        kind: boundString(ref && (ref.kind || ref.contract), 128),
        ...(ref && ref.path != null ? { path: boundString(ref.path, 256) } : {}),
      }));
  }
  return deepClone(record);
}

/**
 * Portable contract: zeus-pro.generation-assurance-attempt-history@1
 * Readable/exportable without entitlement or provider.
 */
function buildAttemptHistory({
  runId = 'run',
  attempts = [],
  finalDecision,
  providerInvocationCount = 0,
  organizationProfileId = null,
}) {
  const history = {
    schemaVersion: 1,
    kind: 'generation-assurance-attempt-history',
    contractId: CONTRACT_ID,
    contractVersion: CONTRACT_VERSION,
    contract: CONTRACT_REF,
    runId: boundString(runId, 128),
    attempts: deepClone(attempts),
    providerInvocationCount: Number(providerInvocationCount) || 0,
    finalDecision: sanitizeValue(finalDecision),
    nonClaims: { ...NON_CLAIMS },
    notes: [
      'Attempt history is advisory and portable without entitlement.',
      'review-ready means structural/policy validation only.',
      'Not compiled, not approved, not deployable; source workspace is never mutated.',
    ],
  };
  if (organizationProfileId != null) {
    history.organizationProfileId = boundString(organizationProfileId, 128);
  }
  return deepClone(history);
}

/**
 * Fail-closed validation of the portable history contract.
 * - sequential unique indices starting at 0 for non-empty history
 * - provider identity on indices > 0 where a provider request occurred
 * - closed stop codes
 * - no oversized serialized history
 */
function validateAttemptHistory(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: [{ path: '', message: 'expected an object' }] };
  }
  if (Number(value.schemaVersion) !== 1) {
    errors.push({ path: '/schemaVersion', message: 'expected 1' });
  }
  if (value.contractId !== CONTRACT_ID) {
    errors.push({ path: '/contractId', message: 'expected exact contract id' });
  }
  if (value.contract !== CONTRACT_REF) {
    errors.push({ path: '/contract', message: 'expected exact contract reference' });
  }
  if (Number(value.contractVersion) !== CONTRACT_VERSION) {
    errors.push({ path: '/contractVersion', message: 'expected exact contract version' });
  }
  if (value.kind !== 'generation-assurance-attempt-history') {
    errors.push({ path: '/kind', message: 'expected attempt-history kind' });
  }
  if (!Array.isArray(value.attempts)) {
    errors.push({ path: '/attempts', message: 'attempts must be an array' });
  } else {
    if (value.attempts.length > LIMITS.maxAttempts) {
      errors.push({ path: '/attempts', message: 'attempts exceed hard bound' });
    }
    const seen = new Set();
    let providerAttemptCount = 0;
    let finalAttemptCount = 0;
    value.attempts.forEach((attempt, i) => {
      if (!isPlainObject(attempt)) {
        errors.push({ path: `/attempts/${i}`, message: 'attempt must be an object' });
        return;
      }
      if (!Number.isInteger(attempt.index) || attempt.index < 0 || attempt.index > 2) {
        errors.push({ path: `/attempts/${i}/index`, message: 'index must be 0..2' });
      } else {
        if (seen.has(attempt.index)) {
          errors.push({ path: `/attempts/${i}/index`, message: 'duplicate attempt index' });
        }
        seen.add(attempt.index);
        // Sequential unique indices starting at 0 for non-empty history
        if (attempt.index !== i) {
          errors.push({
            path: `/attempts/${i}/index`,
            message: 'attempt indices must be sequential starting at 0',
          });
        }
      }
      if (!attempt.candidate || !/^[a-f0-9]{64}$/.test(String(attempt.candidate.sha256 || ''))) {
        errors.push({
          path: `/attempts/${i}/candidate`,
          message: 'candidate sha256 must be lowercase 64-hex',
        });
      }
      if (!Array.isArray(attempt.qualityVector) || attempt.qualityVector.length !== 6) {
        errors.push({
          path: `/attempts/${i}/qualityVector`,
          message: 'qualityVector must have length 6',
        });
      }
      if (!DISPOSITION_SET.has(String(attempt.disposition))) {
        errors.push({ path: `/attempts/${i}/disposition`, message: 'unknown disposition' });
      }
      if (i === 0 && attempt.disposition !== DISPOSITIONS.BASELINE) {
        errors.push({ path: '/attempts/0/disposition', message: 'attempt 0 must be baseline' });
      }
      if (
        i > 0 &&
        attempt.disposition !== DISPOSITIONS.PROVIDER_REPAIR &&
        attempt.disposition !== DISPOSITIONS.STOPPED
      ) {
        errors.push({
          path: `/attempts/${i}/disposition`,
          message: 'post-baseline attempt must be a provider disposition',
        });
      }
      if (attempt.stopCode != null && !STOP_CODE_SET.has(String(attempt.stopCode))) {
        errors.push({ path: `/attempts/${i}/stopCode`, message: 'unknown stop code' });
      }
      if (attempt.isFinal === true) finalAttemptCount += 1;
      // Provider attempt identity on indices > 0 where a request occurred
      // (provider-repair success path or stopped after provider request).
      if (i > 0) {
        providerAttemptCount += 1;
        if (
          !attempt.providerIdentity ||
          typeof attempt.providerIdentity.providerId !== 'string' ||
          !attempt.providerIdentity.providerId
        ) {
          errors.push({
            path: `/attempts/${i}/providerIdentity`,
            message: 'provider identity required for provider attempts',
          });
        }
        if (
          !attempt.providerIdentity ||
          typeof attempt.providerIdentity.modelId !== 'string' ||
          !attempt.providerIdentity.modelId
        ) {
          errors.push({
            path: `/attempts/${i}/providerIdentity/modelId`,
            message: 'provider model identity required for provider attempts',
          });
        }
        if (attempt.correlationId == null || String(attempt.correlationId).trim() === '') {
          errors.push({
            path: `/attempts/${i}/correlationId`,
            message: 'correlationId required for provider attempts',
          });
        }
      }
    });
    if (value.attempts.length > 0) {
      const last = value.attempts[value.attempts.length - 1];
      if (finalAttemptCount !== 1 || last.isFinal !== true) {
        errors.push({ path: '/attempts', message: 'exactly the last attempt must be final' });
      }
      if (!STOP_CODE_SET.has(String(last.stopCode))) {
        errors.push({
          path: `/attempts/${value.attempts.length - 1}/stopCode`,
          message: 'final attempt requires a closed stop code',
        });
      }
      if (
        isPlainObject(value.finalDecision) &&
        String(value.finalDecision.stopCode) !== String(last.stopCode)
      ) {
        errors.push({
          path: '/finalDecision/stopCode',
          message: 'final decision must match final attempt stop code',
        });
      }
    }
    if (Number(value.providerInvocationCount) !== providerAttemptCount) {
      errors.push({
        path: '/providerInvocationCount',
        message: 'provider invocation count must equal recorded provider attempts',
      });
    }
  }
  if (
    !Number.isInteger(value.providerInvocationCount) ||
    value.providerInvocationCount < 0 ||
    value.providerInvocationCount > LIMITS.maxProviderInvocations
  ) {
    errors.push({
      path: '/providerInvocationCount',
      message: 'providerInvocationCount must be 0..2',
    });
  }
  if (!isPlainObject(value.finalDecision)) {
    errors.push({ path: '/finalDecision', message: 'finalDecision is required' });
  } else if (!STOP_CODE_SET.has(String(value.finalDecision.stopCode))) {
    errors.push({ path: '/finalDecision/stopCode', message: 'unknown stop code' });
  } else if (
    value.finalDecision.reviewReady === true &&
    value.finalDecision.stopCode !== STOP_CODES.REVIEW_READY
  ) {
    errors.push({
      path: '/finalDecision/reviewReady',
      message: 'reviewReady requires REVIEW_READY stop code',
    });
  } else if (
    value.finalDecision.stopCode === STOP_CODES.REVIEW_READY &&
    value.finalDecision.reviewReady !== true
  ) {
    errors.push({
      path: '/finalDecision/reviewReady',
      message: 'REVIEW_READY requires reviewReady true',
    });
  } else if (
    value.finalDecision.stopCode === STOP_CODES.REVIEW_READY &&
    Array.isArray(value.attempts) &&
    value.attempts.length === 0
  ) {
    errors.push({ path: '/attempts', message: 'REVIEW_READY requires a final validated attempt' });
  }
  if (!isPlainObject(value.nonClaims)) {
    errors.push({ path: '/nonClaims', message: 'nonClaims is required' });
  } else {
    for (const key of Object.keys(NON_CLAIMS)) {
      if (value.nonClaims[key] !== false) {
        errors.push({ path: `/nonClaims/${key}`, message: 'non-claim must be explicit false' });
      }
    }
  }

  // Oversized serialized history fails closed.
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > LIMITS.maxHistoryJsonBytes) {
      errors.push({ path: '', message: 'serialized attempt history exceeds maxHistoryJsonBytes' });
    }
  } catch {
    errors.push({ path: '', message: 'attempt history cannot be serialized' });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Export a defensive deep copy safe for callers to mutate.
 * Readable without entitlement or provider.
 */
function exportAttemptHistory(history) {
  const validation = validateAttemptHistory(history);
  if (!validation.ok) {
    const error = new Error('attempt history failed contract validation');
    error.code = 'ATTEMPT_HISTORY_INVALID';
    error.details = validation.errors;
    throw error;
  }
  return deepClone(history);
}

module.exports = {
  buildAttemptRecord,
  buildAttemptHistory,
  validateAttemptHistory,
  exportAttemptHistory,
  deepClone,
};
