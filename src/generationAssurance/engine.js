'use strict';

const defaultGenerationValidation = require('../generationValidation');
const { verifyOfflineEntitlement } = require('../entitlement/verify');
const { STOP_CODES, LIMITS, DISPOSITIONS, NON_CLAIMS } = require('./constants');
const {
  canonicalizeDiagnostics,
  buildQualityVector,
  classifyProgress,
  redactText,
} = require('./canonicalDiagnostics');
const {
  buildAttemptRecord,
  buildAttemptHistory,
  exportAttemptHistory,
} = require('./attemptHistory');
const { resolveOrganizationProfile } = require('./organizationProfiles');
const { createAssuranceValidatorRegistry } = require('./advancedValidators');
const {
  snapshotCandidateForHistory,
  snapshotCandidateFull,
  sha256Json,
  buildProviderRequest,
  invokeRepairProvider,
  authorizedSourceLocations,
} = require('./providerBridge');
const { assertEvidenceProvenancePreserved } = require('./evidence');
const { sanitizeValidationReport } = require('./sanitize');
const { writeAssuranceReviewArtifacts } = require('./reviewArtifacts');

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateExplicitScopePaths(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.maxAuthorizedLocations) {
    return { ok: false, paths: [] };
  }
  const paths = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== 'string' || /[\u0000-\u001f\u007f]/.test(raw)) {
      return { ok: false, paths: [] };
    }
    const normalized = raw
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '')
      .replace(/\/+/g, '/')
      .trim();
    const segments = normalized.split('/');
    if (
      !normalized ||
      normalized === '.' ||
      normalized.startsWith('/') ||
      /^[A-Za-z]:/.test(normalized) ||
      segments.some(segment => !segment || segment === '.' || segment === '..')
    ) {
      return { ok: false, paths: [] };
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      paths.push(normalized);
    }
  }
  return { ok: paths.length > 0, paths };
}

function diagnosticsIndicate(report, predicate) {
  const list = report && Array.isArray(report.diagnostics) ? report.diagnostics : [];
  return list.some(predicate);
}

function mapInitialStop(status, report) {
  if (status === 'review-ready') return STOP_CODES.REVIEW_READY;
  if (status === 'denied') return STOP_CODES.POLICY_DENIED;
  if (status === 'internal-validator-failure') return STOP_CODES.VALIDATOR_INTERNAL_FAILURE;
  if (
    diagnosticsIndicate(
      report,
      d =>
        d.id === 'GENVAL.SCOPE_EXPANSION' ||
        d.id === 'GENVAL.PATH_OUTSIDE_SCOPE' ||
        d.id === 'GENVAL.PATH_OUTSIDE_WORKSPACE' ||
        d.id === 'GENVAL.PATH_UNSAFE'
    )
  ) {
    return STOP_CODES.SCOPE_EXPANSION;
  }
  if (diagnosticsIndicate(report, d => d.id === 'GENVAL.VALIDATOR_MISSING')) {
    return STOP_CODES.VALIDATOR_INTERNAL_FAILURE;
  }
  if (diagnosticsIndicate(report, d => d.id === 'GENVAL.VALIDATOR_INTERNAL')) {
    return STOP_CODES.VALIDATOR_INTERNAL_FAILURE;
  }
  if (
    diagnosticsIndicate(
      report,
      d => d.id === 'GENVAL.POLICY_DENIED' || d.id === 'GENVAL.SECRET_LIKE_CONTENT'
    )
  ) {
    return STOP_CODES.POLICY_DENIED;
  }
  return null;
}

function mapPostValidationStop(status, report) {
  if (status === 'review-ready') return STOP_CODES.REVIEW_READY;
  if (status === 'denied') return STOP_CODES.POLICY_DENIED;
  if (status === 'internal-validator-failure') return STOP_CODES.VALIDATOR_INTERNAL_FAILURE;
  if (
    diagnosticsIndicate(
      report,
      d =>
        d.id === 'GENVAL.SCOPE_EXPANSION' ||
        d.id === 'GENVAL.PATH_OUTSIDE_SCOPE' ||
        d.id === 'GENVAL.PATH_OUTSIDE_WORKSPACE' ||
        d.id === 'GENVAL.PATH_UNSAFE'
    )
  ) {
    return STOP_CODES.SCOPE_EXPANSION;
  }
  if (
    diagnosticsIndicate(
      report,
      d => d.id === 'GENVAL.VALIDATOR_MISSING' || d.id === 'GENVAL.VALIDATOR_INTERNAL'
    )
  ) {
    return STOP_CODES.VALIDATOR_INTERNAL_FAILURE;
  }
  if (
    diagnosticsIndicate(
      report,
      d => d.id === 'GENVAL.POLICY_DENIED' || d.id === 'GENVAL.SECRET_LIKE_CONTENT'
    )
  ) {
    return STOP_CODES.POLICY_DENIED;
  }
  return null;
}

function verifyEntitlementForProvider(entitlementOptions) {
  if (!entitlementOptions || typeof entitlementOptions !== 'object') {
    return {
      ok: false,
      reasonCode: 'ENTITLEMENT_REQUIRED',
      message: 'Entitlement options are required before provider invocation.',
    };
  }
  return verifyOfflineEntitlement(entitlementOptions.licenseDocument, {
    publicKeyPem: entitlementOptions.publicKeyPem,
    now: entitlementOptions.now,
    expectedProductId: entitlementOptions.expectedProductId,
    expectedEdition: entitlementOptions.expectedEdition,
    organizationScope: entitlementOptions.organizationScope,
  });
}

/**
 * Run Generation Assurance: baseline validation (attempt 0) + at most two authorized
 * provider repair attempts (1 and 2). Never mutates the source workspace.
 */
async function runGenerationAssuranceInternal(input = {}) {
  const options = input.options && isPlainObject(input.options) ? input.options : {};
  const candidate = input.candidate;
  const generationValidation = options.generationValidation || defaultGenerationValidation;
  const runId = options.runId != null ? String(options.runId) : 'ga-run';
  const workspaceRoot = options.workspaceRoot || null;
  const reviewArtifactRoot = options.reviewArtifactRoot || null;
  const allowedRelativeRoots = Array.isArray(options.allowedRelativeRoots)
    ? options.allowedRelativeRoots
    : ['.'];
  const evidenceStore = options.evidenceStore || {};
  const policy = options.policy || null;
  const providerRegistry = options.providerRegistry || null;
  const providerId = options.providerId || null;
  const modelId = options.modelId || null;
  const egressPolicy = options.egressPolicy;
  const timeoutMs = options.timeoutMs;
  const signal = options.signal || null;
  const entitlementOptions = options.entitlement || null;
  const contentLimits = options.contentLimits || LIMITS;
  const correlationIdBase =
    options.correlationIdBase != null
      ? String(options.correlationIdBase)
      : candidate && candidate.correlationId
        ? String(candidate.correlationId)
        : 'ga-corr';

  const attempts = [];
  const safeReports = [];
  let providerInvocationCount = 0;
  let changedNotImprovedAllowanceUsed = false;
  let currentCandidate = null;
  let validation = null;
  let effectiveDeclaredScopePaths = null;
  let declaredScopeUsesRoots = false;

  const profileResult = resolveOrganizationProfile(options.organizationProfile);
  if (!profileResult.ok) {
    return finalize({
      ok: false,
      stopCode: STOP_CODES.POLICY_DENIED,
      history: buildAttemptHistory({
        runId,
        attempts: [],
        providerInvocationCount: 0,
        finalDecision: {
          stopCode: STOP_CODES.POLICY_DENIED,
          message: redactText(profileResult.message),
          reviewReady: false,
        },
      }),
      safeReports,
      providerInvocationCount: 0,
      reviewArtifactRoot,
      workspaceRoot,
      runId,
      finalCandidate: null,
      finalValidation: null,
    });
  }

  const orgProfile = profileResult.profile;
  const effectiveAllowedRoots =
    orgProfile && Array.isArray(orgProfile.allowedRelativeRoots)
      ? [...orgProfile.allowedRelativeRoots]
      : allowedRelativeRoots;
  const advancedValidatorIds =
    orgProfile &&
    Array.isArray(orgProfile.advancedValidatorIds) &&
    orgProfile.advancedValidatorIds.length
      ? [...orgProfile.advancedValidatorIds]
      : options.advancedValidatorIds;

  let validatorRegistry;
  try {
    validatorRegistry =
      options.validatorRegistry ||
      createAssuranceValidatorRegistry(generationValidation, {
        validatorOptions: options.validatorOptions,
        advancedValidatorIds,
      });
  } catch (error) {
    const message =
      error && error.code === 'ADVANCED_VALIDATORS_INVALID'
        ? String(error.message || 'advanced validators invalid')
        : 'Failed to construct validator registry';
    return finalize({
      ok: false,
      stopCode:
        error && error.code === 'ADVANCED_VALIDATORS_INVALID'
          ? STOP_CODES.POLICY_DENIED
          : STOP_CODES.VALIDATOR_INTERNAL_FAILURE,
      history: buildAttemptHistory({
        runId,
        attempts: [],
        providerInvocationCount: 0,
        finalDecision: {
          stopCode:
            error && error.code === 'ADVANCED_VALIDATORS_INVALID'
              ? STOP_CODES.POLICY_DENIED
              : STOP_CODES.VALIDATOR_INTERNAL_FAILURE,
          message: redactText(message),
          reviewReady: false,
        },
        organizationProfileId: orgProfile ? orgProfile.id : null,
      }),
      safeReports,
      providerInvocationCount: 0,
      reviewArtifactRoot,
      workspaceRoot,
      runId,
      finalCandidate: null,
      finalValidation: null,
    });
  }

  async function validateCandidate(cand) {
    try {
      return await generationValidation.validateGenerationCandidate(cand, {
        workspaceRoot,
        allowedRelativeRoots: effectiveAllowedRoots,
        declaredScopePaths: effectiveDeclaredScopePaths,
        evidenceStore,
        policy,
        validatorRegistry,
        reviewArtifactRoot: null,
      });
    } catch {
      return {
        status: 'internal-validator-failure',
        reviewReady: false,
        report: {
          schemaVersion: 1,
          kind: 'generation-validation-report',
          contractId: 'zeus.generation-validation-report',
          contractVersion: 1,
          candidateId: '',
          status: 'internal-validator-failure',
          reviewReady: false,
          diagnostics: [
            {
              id: 'GENVAL.VALIDATOR_INTERNAL',
              severity: 'blocking',
              validatorId: 'zeus-pro.failure-boundary',
              validatorVersion: 1,
              path: null,
              message: 'Candidate validation failed inside the isolated validator boundary.',
            },
          ],
          evidenceChecked: [],
          assumptions: [],
          uncertainties: [],
          policy: { denied: false, reason: null },
          summary: 'Validator execution failed safely.',
          notes: [],
        },
      };
    }
  }

  function recordAttempt({
    index,
    candidate: cand,
    validation: val,
    disposition,
    providerIdentity = null,
    correlationId = null,
    usage = null,
    stopCode = null,
    isFinal = false,
  }) {
    const diagnostics =
      val && val.report && Array.isArray(val.report.diagnostics) ? val.report.diagnostics : [];
    const canon = canonicalizeDiagnostics(diagnostics);
    if (!canon.ok) {
      return { limitExceeded: true };
    }
    const qualityVector = buildQualityVector(val.status, diagnostics);
    // History projection: metadata + content hashes only (never large bodies).
    const snap = snapshotCandidateForHistory(cand, { limits: contentLimits });
    const safeReport = sanitizeValidationReport(val.report);
    const record = buildAttemptRecord({
      index,
      candidateSnapshot: snap,
      candidateSha256: sha256Json(snap),
      validationReport: safeReport,
      canonicalDiagnostics: canon.canonical,
      fingerprint: canon.fingerprint,
      qualityVector,
      disposition,
      providerIdentity,
      correlationId,
      usage,
      evidenceReferences: snap.evidenceReferences,
      stopCode,
      isFinal,
    });
    attempts.push(record);
    safeReports.push(safeReport);
    return {
      limitExceeded: false,
      fingerprint: canon.fingerprint,
      qualityVector,
      record,
      safeReport,
    };
  }

  /**
   * Provider-path failure: record attempt for this index using the *current*
   * candidate (never a fabricated provider candidate) and current validation.
   */
  function recordStoppedProviderAttempt({ index, stopCode, correlationId, message }) {
    const recorded = recordAttempt({
      index,
      candidate: currentCandidate,
      validation,
      disposition: DISPOSITIONS.STOPPED,
      providerIdentity: {
        providerId,
        modelId,
      },
      correlationId,
      stopCode,
      isFinal: true,
    });
    if (recorded.limitExceeded) {
      return stopWith(STOP_CODES.DIAGNOSTICS_LIMIT_EXCEEDED, {
        message: 'Diagnostics exceeded hard bound while recording provider stop',
        reviewReady: false,
      });
    }
    return stopWith(stopCode, {
      message: redactText(message || stopCode),
      reviewReady: false,
    });
  }

  function markLastAttemptFinal(stopCode) {
    if (attempts.length) {
      attempts[attempts.length - 1].isFinal = true;
      attempts[attempts.length - 1].stopCode = stopCode;
    }
  }

  // --- Attempt 0: baseline validation ---
  if (!candidate || !isPlainObject(candidate)) {
    return finalize({
      ok: false,
      stopCode: STOP_CODES.INITIAL_NOT_REPAIRABLE,
      history: buildAttemptHistory({
        runId,
        attempts: [],
        providerInvocationCount: 0,
        finalDecision: {
          stopCode: STOP_CODES.INITIAL_NOT_REPAIRABLE,
          message: 'Initial candidate is missing or not an object',
          reviewReady: false,
        },
        organizationProfileId: orgProfile ? orgProfile.id : null,
      }),
      safeReports,
      providerInvocationCount: 0,
      reviewArtifactRoot,
      workspaceRoot,
      runId,
      finalCandidate: null,
      finalValidation: null,
    });
  }

  const hasExplicitDeclaredScope = Object.prototype.hasOwnProperty.call(
    options,
    'declaredScopePaths'
  );
  const explicitScope = hasExplicitDeclaredScope
    ? validateExplicitScopePaths(options.declaredScopePaths)
    : null;
  if (explicitScope && !explicitScope.ok) {
    return finalize({
      ok: false,
      stopCode: STOP_CODES.SCOPE_EXPANSION,
      history: buildAttemptHistory({
        runId,
        attempts: [],
        providerInvocationCount: 0,
        finalDecision: {
          stopCode: STOP_CODES.SCOPE_EXPANSION,
          message: 'Explicit declared scope is invalid or empty.',
          reviewReady: false,
        },
        organizationProfileId: orgProfile ? orgProfile.id : null,
      }),
      safeReports,
      providerInvocationCount: 0,
      reviewArtifactRoot,
      workspaceRoot,
      runId,
      finalCandidate: null,
      finalValidation: null,
    });
  }
  declaredScopeUsesRoots = hasExplicitDeclaredScope;
  effectiveDeclaredScopePaths = explicitScope
    ? explicitScope.paths
    : authorizedSourceLocations(candidate, []);

  currentCandidate = candidate;
  validation = await validateCandidate(currentCandidate);
  let recorded = recordAttempt({
    index: 0,
    candidate: currentCandidate,
    validation,
    disposition: DISPOSITIONS.BASELINE,
    correlationId: currentCandidate.correlationId || `${correlationIdBase}-0`,
    isFinal: false,
  });
  if (recorded.limitExceeded) {
    return stopWith(STOP_CODES.DIAGNOSTICS_LIMIT_EXCEEDED, {
      message: 'Baseline diagnostics exceeded hard bound',
      reviewReady: false,
    });
  }

  if (validation.reviewReady === true && validation.status === 'review-ready') {
    markLastAttemptFinal(STOP_CODES.REVIEW_READY);
    return stopWith(STOP_CODES.REVIEW_READY, {
      message: 'Initial candidate is review-ready; no provider invocation required',
      reviewReady: true,
    });
  }

  const initialHardStop = mapInitialStop(validation.status, validation.report);
  if (
    initialHardStop === STOP_CODES.POLICY_DENIED ||
    initialHardStop === STOP_CODES.SCOPE_EXPANSION ||
    initialHardStop === STOP_CODES.VALIDATOR_INTERNAL_FAILURE
  ) {
    markLastAttemptFinal(initialHardStop);
    return stopWith(initialHardStop, {
      message: `Initial candidate is not repairable (${initialHardStop})`,
      reviewReady: false,
      initialNotRepairable: true,
    });
  }

  if (validation.status === 'unsupported') {
    markLastAttemptFinal(STOP_CODES.INITIAL_NOT_REPAIRABLE);
    return stopWith(STOP_CODES.INITIAL_NOT_REPAIRABLE, {
      message: 'Initial candidate status is unsupported for repair',
      reviewReady: false,
    });
  }
  if (validation.status === 'invalid') {
    markLastAttemptFinal(STOP_CODES.INITIAL_NOT_REPAIRABLE);
    return stopWith(STOP_CODES.INITIAL_NOT_REPAIRABLE, {
      message: 'Initial candidate status is invalid and is not eligible for provider repair',
      reviewReady: false,
      initialNotRepairable: true,
    });
  }

  let previousFingerprint = recorded.fingerprint;
  let previousVector = recorded.qualityVector;

  for (let attemptIndex = 1; attemptIndex <= LIMITS.maxProviderInvocations; attemptIndex += 1) {
    if (signal && signal.aborted) {
      markLastAttemptFinal(STOP_CODES.CANCELLED);
      return stopWith(STOP_CODES.CANCELLED, {
        message: 'Cancelled before provider invocation',
        reviewReady: false,
      });
    }

    // Entitlement gate immediately before every provider invocation.
    // Not a provider attempt — do not invent a new attempt index.
    const entitlement = verifyEntitlementForProvider(entitlementOptions);
    if (!entitlement.ok) {
      markLastAttemptFinal(STOP_CODES.ENTITLEMENT_DENIED);
      return stopWith(STOP_CODES.ENTITLEMENT_DENIED, {
        message: redactText(entitlement.message || 'Entitlement denied'),
        reasonCode: entitlement.reasonCode,
        reviewReady: false,
      });
    }

    if (!providerRegistry || !providerId || !modelId) {
      markLastAttemptFinal(STOP_CODES.PROVIDER_FAILED);
      return stopWith(STOP_CODES.PROVIDER_FAILED, {
        message: 'Provider registry, providerId, and modelId are required for repair attempts',
        reviewReady: false,
      });
    }

    const correlationId = `${correlationIdBase}-a${attemptIndex}`;
    const built = buildProviderRequest({
      providerId,
      modelId,
      correlationId,
      candidate: currentCandidate,
      diagnostics: validation.report.diagnostics,
      allowedRelativeRoots: effectiveAllowedRoots,
      authorizedLocations: effectiveDeclaredScopePaths,
      attemptIndex,
      limits: contentLimits,
    });
    if (!built.ok) {
      // Request could not be built — no provider call counted.
      if (built.code === 'DIAGNOSTICS_LIMIT_EXCEEDED') {
        markLastAttemptFinal(STOP_CODES.DIAGNOSTICS_LIMIT_EXCEEDED);
        return stopWith(STOP_CODES.DIAGNOSTICS_LIMIT_EXCEEDED, {
          message: 'Cannot build provider request; diagnostics limit exceeded',
          reviewReady: false,
        });
      }
      markLastAttemptFinal(STOP_CODES.PROVIDER_FAILED);
      return stopWith(STOP_CODES.PROVIDER_FAILED, {
        message: redactText(built.message || 'provider request bounds exceeded'),
        reviewReady: false,
      });
    }

    // Count the authorized invocation attempt (even if provider fails).
    providerInvocationCount += 1;
    if (providerInvocationCount > LIMITS.maxProviderInvocations) {
      return stopWith(STOP_CODES.MAX_ATTEMPTS, {
        message: 'Provider invocation bound exceeded',
        reviewReady: false,
      });
    }

    const providerResult = await invokeRepairProvider({
      providerRegistry,
      providerId,
      modelId,
      correlationId,
      request: built.request,
      egressPolicy,
      timeoutMs,
      signal,
    });

    if (!providerResult.ok) {
      const code =
        providerResult.code === 'PROVIDER_POLICY_DENIED'
          ? STOP_CODES.PROVIDER_POLICY_DENIED
          : providerResult.code === 'PROVIDER_OUTPUT_INVALID'
            ? STOP_CODES.PROVIDER_OUTPUT_INVALID
            : providerResult.code === 'CANCELLED'
              ? STOP_CODES.CANCELLED
              : STOP_CODES.PROVIDER_FAILED;
      // Complete attempt history for this provider-path outcome (no fabricated candidate).
      return recordStoppedProviderAttempt({
        index: attemptIndex,
        stopCode: code,
        correlationId,
        message: providerResult.message || code,
      });
    }

    const providerLocations = authorizedSourceLocations(providerResult.candidate, []);
    const locationIsAuthorized = location =>
      effectiveDeclaredScopePaths.some(scopePath =>
        declaredScopeUsesRoots
          ? location === scopePath || location.startsWith(`${scopePath}/`)
          : location === scopePath
      );
    if (providerLocations.some(location => !locationIsAuthorized(location))) {
      return recordStoppedProviderAttempt({
        index: attemptIndex,
        stopCode: STOP_CODES.SCOPE_EXPANSION,
        correlationId,
        message: 'Provider candidate introduced a path outside the immutable authorized scope',
      });
    }

    // Evidence provenance: nested candidate evidence must match current (order-insensitive).
    const provenance = assertEvidenceProvenancePreserved(
      currentCandidate,
      providerResult.candidate
    );
    if (!provenance.ok) {
      return recordStoppedProviderAttempt({
        index: attemptIndex,
        stopCode: STOP_CODES.PROVIDER_OUTPUT_INVALID,
        correlationId,
        message: provenance.message,
      });
    }

    // Accept provider candidate only after identity + evidence provenance checks.
    currentCandidate = providerResult.candidate;
    validation = await validateCandidate(currentCandidate);
    recorded = recordAttempt({
      index: attemptIndex,
      candidate: currentCandidate,
      validation,
      disposition: DISPOSITIONS.PROVIDER_REPAIR,
      providerIdentity: {
        providerId,
        modelId,
      },
      correlationId,
      usage: providerResult.usage,
      isFinal: false,
    });
    if (recorded.limitExceeded) {
      return stopWith(STOP_CODES.DIAGNOSTICS_LIMIT_EXCEEDED, {
        message: 'Provider-attempt diagnostics exceeded hard bound',
        reviewReady: false,
      });
    }

    if (validation.reviewReady === true && validation.status === 'review-ready') {
      markLastAttemptFinal(STOP_CODES.REVIEW_READY);
      return stopWith(STOP_CODES.REVIEW_READY, {
        message: `Candidate became review-ready after attempt ${attemptIndex}`,
        reviewReady: true,
      });
    }

    const hardStop = mapPostValidationStop(validation.status, validation.report);
    if (hardStop) {
      markLastAttemptFinal(hardStop);
      return stopWith(hardStop, {
        message: `Repair stopped after attempt ${attemptIndex}: ${hardStop}`,
        reviewReady: false,
      });
    }

    const progress = classifyProgress({
      previousFingerprint,
      nextFingerprint: recorded.fingerprint,
      previousVector,
      nextVector: recorded.qualityVector,
    });

    if (progress.kind === 'identical') {
      markLastAttemptFinal(STOP_CODES.IDENTICAL_DIAGNOSTICS);
      return stopWith(STOP_CODES.IDENTICAL_DIAGNOSTICS, {
        message: 'Provider result produced identical canonical diagnostics',
        reviewReady: false,
      });
    }
    if (progress.kind === 'worsening') {
      markLastAttemptFinal(STOP_CODES.WORSENING_RESULT);
      return stopWith(STOP_CODES.WORSENING_RESULT, {
        message: 'Provider result worsened the quality vector',
        reviewReady: false,
      });
    }
    if (progress.kind === 'changed-not-improved') {
      const remaining = LIMITS.maxProviderInvocations - attemptIndex;
      if (remaining <= 0 || changedNotImprovedAllowanceUsed) {
        markLastAttemptFinal(STOP_CODES.CHANGED_NOT_IMPROVED);
        return stopWith(STOP_CODES.CHANGED_NOT_IMPROVED, {
          message: 'Diagnostics changed but quality did not improve; no further attempts',
          reviewReady: false,
        });
      }
      changedNotImprovedAllowanceUsed = true;
    }

    previousFingerprint = recorded.fingerprint;
    previousVector = recorded.qualityVector;
  }

  markLastAttemptFinal(STOP_CODES.MAX_ATTEMPTS);
  return stopWith(STOP_CODES.MAX_ATTEMPTS, {
    message: 'Maximum authorized provider repair attempts exhausted',
    reviewReady: false,
  });

  function stopWith(stopCode, decision) {
    const history = buildAttemptHistory({
      runId,
      attempts,
      providerInvocationCount,
      organizationProfileId: orgProfile ? orgProfile.id : null,
      finalDecision: {
        stopCode,
        message: redactText(decision.message || stopCode),
        reviewReady: decision.reviewReady === true,
        ...(decision.reasonCode ? { reasonCode: decision.reasonCode } : {}),
        ...(decision.initialNotRepairable ? { initialNotRepairable: true } : {}),
      },
    });
    return finalize({
      ok: decision.reviewReady === true,
      stopCode,
      history,
      safeReports,
      providerInvocationCount,
      reviewArtifactRoot,
      workspaceRoot,
      runId,
      finalCandidate: currentCandidate,
      finalValidation: validation,
    });
  }
}

/**
 * Total public failure boundary. Hostile accessors/proxies and injected facades
 * never escape as raw exceptions or secret-bearing messages.
 */
async function runGenerationAssurance(input = {}) {
  try {
    return await runGenerationAssuranceInternal(input);
  } catch {
    const history = buildAttemptHistory({
      runId: 'ga-run',
      attempts: [],
      providerInvocationCount: 0,
      finalDecision: {
        stopCode: STOP_CODES.VALIDATOR_INTERNAL_FAILURE,
        message: 'Generation Assurance stopped inside its isolated failure boundary.',
        reviewReady: false,
      },
    });
    return {
      ok: false,
      stopCode: STOP_CODES.VALIDATOR_INTERNAL_FAILURE,
      reviewReady: false,
      providerInvocationCount: 0,
      attempts: [],
      history,
      finalCandidate: null,
      finalValidation: null,
      reviewDiff: null,
      artifacts: { written: false, files: [] },
      claims: Object.freeze({ ...NON_CLAIMS }),
    };
  }
}

/** Never return an invalid portable contract, even if an internal invariant regresses. */
function safePortableHistory(history) {
  try {
    return exportAttemptHistory(history);
  } catch {
    return buildAttemptHistory({
      runId: 'ga-run',
      attempts: [],
      providerInvocationCount: 0,
      finalDecision: {
        stopCode: STOP_CODES.VALIDATOR_INTERNAL_FAILURE,
        reviewReady: false,
        message: 'Attempt history failed closed inside the portable contract boundary.',
      },
    });
  }
}

function finalize(state) {
  if (state.history.attempts.length > LIMITS.maxAttempts) {
    state.history.finalDecision.stopCode = STOP_CODES.MAX_ATTEMPTS;
    state.history.attempts = state.history.attempts.slice(0, LIMITS.maxAttempts);
  }
  if (state.providerInvocationCount > LIMITS.maxProviderInvocations) {
    state.providerInvocationCount = LIMITS.maxProviderInvocations;
    state.history.providerInvocationCount = LIMITS.maxProviderInvocations;
  }

  // Safe final review candidate (full body projection) + reviewDiff for artifacts.
  const safeFinalCandidate = state.finalCandidate
    ? snapshotCandidateFull(state.finalCandidate)
    : null;
  let reviewDiff = null;
  if (safeFinalCandidate) {
    try {
      const generationValidation = defaultGenerationValidation;
      const extracted = generationValidation.extractDeclaredFiles(safeFinalCandidate);
      reviewDiff = generationValidation.buildReviewDiff(extracted);
    } catch {
      reviewDiff = {
        schemaVersion: 1,
        kind: 'generation-review-diff',
        files: [],
      };
    }
  }

  // Artifacts: isolated — never throw raw exceptions/paths into the engine result.
  let artifacts = { written: false, files: [] };
  if (state.reviewArtifactRoot) {
    try {
      artifacts = writeAssuranceReviewArtifacts({
        reviewArtifactRoot: state.reviewArtifactRoot,
        sourceWorkspaceRoot: state.workspaceRoot,
        runId: state.runId,
        history: state.history,
        reports: state.safeReports || [],
        finalCandidate: safeFinalCandidate,
        reviewDiff,
      });
      if (!artifacts || artifacts.written !== true) {
        artifacts = {
          written: false,
          files: [],
          error: {
            code: 'ARTIFACT_WRITE_FAILED',
            message: 'Review artifact write failed; details redacted.',
          },
        };
      }
    } catch {
      artifacts = {
        written: false,
        files: [],
        error: {
          code: 'ARTIFACT_WRITE_FAILED',
          message: 'Review artifact write failed; details redacted.',
        },
      };
    }
  }

  const portable = safePortableHistory(state.history);
  const portableStopCode = portable.finalDecision.stopCode;
  const historyFailedClosed = portableStopCode !== state.stopCode;

  const safeFinalValidation = state.finalValidation
    ? {
        status: state.finalValidation.status,
        reviewReady: state.finalValidation.reviewReady === true,
        report: sanitizeValidationReport(state.finalValidation.report),
        claims: Object.freeze({ ...NON_CLAIMS }),
      }
    : null;

  return {
    ok: !historyFailedClosed && state.ok === true,
    stopCode: portableStopCode,
    reviewReady: portable.finalDecision.reviewReady === true,
    providerInvocationCount: portable.providerInvocationCount,
    attempts: portable.attempts,
    history: portable,
    finalCandidate: historyFailedClosed ? null : safeFinalCandidate,
    finalValidation: historyFailedClosed ? null : safeFinalValidation,
    reviewDiff: historyFailedClosed ? null : reviewDiff,
    artifacts,
    claims: Object.freeze({ ...NON_CLAIMS }),
  };
}

module.exports = {
  runGenerationAssurance,
  verifyEntitlementForProvider,
  _finalizeForTest: finalize,
};
