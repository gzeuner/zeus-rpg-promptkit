'use strict';

const crypto = require('node:crypto');
const { LIMITS } = require('./constants');
const { redactText, normalizePath, canonicalizeDiagnostics } = require('./canonicalDiagnostics');
const { truncateUtf8Bytes } = require('./sanitize');
const { assertCandidateContentBounds } = require('./contentBounds');

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sha256Text(text) {
  return crypto
    .createHash('sha256')
    .update(String(text || ''), 'utf8')
    .digest('hex');
}

function sha256Json(value) {
  return sha256Text(JSON.stringify(value));
}

/**
 * Build a proposed-file entry for history (content omitted) or full/provider snapshots.
 * @param {'history'|'full'} mode
 */
function snapshotProposedFile(file, mode, limits) {
  const entry = {
    path: normalizePath(file && file.path),
    action: file && file.action ? String(file.action) : 'modify',
  };
  if (file && typeof file.language === 'string') entry.language = String(file.language);
  if (file && typeof file.rationale === 'string') {
    entry.rationale = redactText(file.rationale).slice(0, 4000);
  }
  if (file && typeof file.content === 'string') {
    const redacted = redactText(file.content);
    const originalBytes = Buffer.byteLength(redacted, 'utf8');
    const maxBytes = limits.maxContentBytesPerFile || LIMITS.maxContentBytesPerFile;
    const truncated = originalBytes > maxBytes;
    const body = truncated ? truncateUtf8Bytes(redacted, maxBytes) : redacted;
    const bodyBytes = Buffer.byteLength(body, 'utf8');
    entry.contentSha256 = sha256Text(body);
    entry.contentBytes = bodyBytes;
    if (truncated) {
      entry.contentTruncated = true;
      entry.originalContentBytes = originalBytes;
    }
    if (mode === 'history') {
      // History keeps provenance hashes only — never duplicate large bodies.
      entry.contentOmitted = true;
    } else {
      entry.content = body;
      if (truncated) entry.contentOmitted = false;
    }
  } else if (file && file.action === 'delete') {
    entry.contentBytes = 0;
    entry.contentSha256 = null;
    if (mode === 'history') entry.contentOmitted = true;
  }
  return entry;
}

/**
 * Snapshot a candidate.
 * - mode 'history': metadata + evidence + per-file SHA-256/byte length; content bodies omitted
 * - mode 'full' (default): safe full body for provider request / final review candidate
 */
function snapshotCandidate(candidate, options = {}) {
  const limits = options.limits || LIMITS;
  const mode = options.mode === 'history' ? 'history' : 'full';
  const c = candidate && isPlainObject(candidate) ? candidate : {};
  const proposedFiles = Array.isArray(c.proposedFiles)
    ? c.proposedFiles
        .slice(0, limits.maxFiles || LIMITS.maxFiles)
        .map(file => snapshotProposedFile(file, mode, limits))
    : [];

  const evidenceReferences = Array.isArray(c.evidenceReferences)
    ? c.evidenceReferences.slice(0, LIMITS.maxEvidenceReferences).map(ref => ({
        id: String((ref && ref.id) || '').slice(0, 128),
        kind: String((ref && ref.kind) || 'artifact').slice(0, 64),
        ...(ref && typeof ref.path === 'string'
          ? { path: normalizePath(ref.path).slice(0, 256) }
          : {}),
      }))
    : [];

  const snapshot = {
    schemaVersion: 1,
    kind: 'generation-candidate',
    contractId: c.contractId || 'zeus.generation-candidate',
    candidateId: String(c.candidateId || 'candidate').slice(0, 128),
    taskSummary: redactText(c.taskSummary || '').slice(0, LIMITS.maxTaskSummaryChars),
    evidenceReferences,
    assumptions: Array.isArray(c.assumptions)
      ? c.assumptions.slice(0, 32).map(a => redactText(a).slice(0, 500))
      : [],
    uncertainties: Array.isArray(c.uncertainties)
      ? c.uncertainties.slice(0, 32).map(u => redactText(u).slice(0, 500))
      : [],
    proposedFiles,
  };
  if (mode === 'history') {
    snapshot.historyProjection = true;
    snapshot.contentBodiesOmitted = true;
  }
  if (c.correlationId != null) {
    snapshot.correlationId = String(c.correlationId).slice(0, LIMITS.maxCorrelationIdChars);
  }
  return snapshot;
}

/** Deterministic history projection: never embeds large content bodies. */
function snapshotCandidateForHistory(candidate, options = {}) {
  return snapshotCandidate(candidate, { ...options, mode: 'history' });
}

/** Full safe snapshot for provider requests and final human-review candidate. */
function snapshotCandidateFull(candidate, options = {}) {
  return snapshotCandidate(candidate, { ...options, mode: 'full' });
}

function authorizedSourceLocations(candidate, allowedRelativeRoots = ['.']) {
  const files = Array.isArray(candidate && candidate.proposedFiles) ? candidate.proposedFiles : [];
  const locations = [];
  const seen = new Set();
  for (const file of files) {
    const rel = normalizePath(file && file.path);
    if (!rel || seen.has(rel)) continue;
    if (
      rel.includes('..') ||
      rel.startsWith('/') ||
      /^[A-Za-z]:/.test(rel) ||
      rel.startsWith('//')
    ) {
      continue;
    }
    seen.add(rel);
    locations.push(rel);
    if (locations.length >= LIMITS.maxAuthorizedLocations) break;
  }
  for (const root of allowedRelativeRoots) {
    const r = normalizePath(root);
    if (r && r !== '.' && !seen.has(r)) {
      locations.push(r);
      seen.add(r);
    }
  }
  return locations.slice(0, LIMITS.maxAuthorizedLocations);
}

/**
 * Build an allowlist provider request using a full safe content snapshot.
 * Fails closed on UTF-8 content/total bounds.
 */
function buildProviderRequest({
  providerId,
  modelId,
  correlationId,
  candidate,
  diagnostics,
  allowedRelativeRoots = ['.'],
  authorizedLocations = null,
  attemptIndex,
  limits = LIMITS,
}) {
  const boundCheck = assertCandidateContentBounds(candidate, limits);
  if (!boundCheck.ok) {
    return {
      ok: false,
      code: 'REQUEST_BOUNDS_EXCEEDED',
      message: boundCheck.message,
    };
  }

  // Full safe snapshot for the provider request (separate from history projection).
  const snapshot = snapshotCandidateFull(candidate, { limits });
  const snapBounds = assertCandidateContentBounds(snapshot, limits);
  if (!snapBounds.ok) {
    return {
      ok: false,
      code: 'REQUEST_BOUNDS_EXCEEDED',
      message: snapBounds.message,
    };
  }

  const canon = canonicalizeDiagnostics(diagnostics);
  if (!canon.ok) {
    return { ok: false, code: 'DIAGNOSTICS_LIMIT_EXCEEDED' };
  }

  const content = {
    task: 'repair-generation-candidate',
    attemptIndex: Number(attemptIndex),
    candidate: snapshot,
    diagnostics: canon.canonical,
    diagnosticsFingerprint: canon.fingerprint,
    authorizedSourceLocations: Array.isArray(authorizedLocations)
      ? authorizedLocations.slice(0, LIMITS.maxAuthorizedLocations)
      : authorizedSourceLocations(snapshot, allowedRelativeRoots),
    constraints: {
      maxFiles: limits.maxFiles || LIMITS.maxFiles,
      maxContentBytesPerFile: limits.maxContentBytesPerFile || LIMITS.maxContentBytesPerFile,
      maxTotalContentBytes: limits.maxTotalContentBytes || LIMITS.maxTotalContentBytes,
      mustReturnGenerationCandidate: true,
      noWorkspaceMutation: true,
      noHiddenReasoning: true,
    },
  };

  const safeEvidence = [];
  const seenEv = new Set();
  for (const ref of snapshot.evidenceReferences) {
    let id = String(ref.id || '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) {
      id = `ev-${crypto.createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 12)}`;
    }
    if (seenEv.has(id)) continue;
    seenEv.add(id);
    safeEvidence.push({ id, contract: 'zeus.generation-candidate@1' });
    if (safeEvidence.length >= LIMITS.maxEvidenceReferences) break;
  }

  const request = {
    schemaVersion: 1,
    contract: 'zeus.model-provider-request@1',
    providerId: String(providerId),
    modelId: String(modelId),
    correlationId: String(correlationId),
    classification: 'source-code',
    evidenceReferences: safeEvidence,
    input: {
      classification: 'source-code',
      content,
    },
    maxOutputBytes: LIMITS.maxProviderOutputBytes,
  };

  let serialized;
  try {
    serialized = JSON.stringify(request);
  } catch {
    return {
      ok: false,
      code: 'REQUEST_BOUNDS_EXCEEDED',
      message: 'provider request cannot be serialized within bounds',
    };
  }
  if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) {
    return {
      ok: false,
      code: 'REQUEST_BOUNDS_EXCEEDED',
      message: 'provider request exceeds total data size limit',
    };
  }

  return {
    ok: true,
    request,
    snapshot,
    historySnapshot: snapshotCandidateForHistory(candidate, { limits }),
    diagnosticsFingerprint: canon.fingerprint,
  };
}

function extractCandidateFromProviderResponse(response, { providerId, modelId, correlationId }) {
  if (!response || !isPlainObject(response)) {
    return { ok: false, code: 'PROVIDER_OUTPUT_INVALID', message: 'response missing' };
  }
  if (response.providerId !== providerId || response.correlationId !== correlationId) {
    return { ok: false, code: 'PROVIDER_OUTPUT_INVALID', message: 'identity mismatch' };
  }
  if (modelId != null && response.modelId != null && response.modelId !== modelId) {
    return { ok: false, code: 'PROVIDER_OUTPUT_INVALID', message: 'model mismatch' };
  }
  if (response.advisory !== true || response.sourceOfTruth !== false) {
    return { ok: false, code: 'PROVIDER_OUTPUT_INVALID', message: 'advisory contract violated' };
  }

  const output = response.output;
  if (!isPlainObject(output)) {
    return { ok: false, code: 'PROVIDER_OUTPUT_INVALID', message: 'output must be an object' };
  }

  let candidate = null;
  if (isPlainObject(output.candidate)) {
    candidate = output.candidate;
  } else if (
    output.kind === 'generation-candidate' ||
    output.contractId === 'zeus.generation-candidate' ||
    Array.isArray(output.proposedFiles)
  ) {
    candidate = output;
  }
  if (!candidate || !isPlainObject(candidate)) {
    return { ok: false, code: 'PROVIDER_OUTPUT_INVALID', message: 'candidate missing from output' };
  }
  if (candidate.chainOfThought != null || candidate.hiddenReasoning != null) {
    return { ok: false, code: 'PROVIDER_OUTPUT_INVALID', message: 'hidden reasoning forbidden' };
  }

  const normalized = {
    schemaVersion: 1,
    kind: 'generation-candidate',
    contractId: 'zeus.generation-candidate',
    candidateId: String(candidate.candidateId || `provider-${correlationId}`).slice(0, 128),
    taskSummary: redactText(String(candidate.taskSummary || 'provider repair candidate')).slice(
      0,
      LIMITS.maxTaskSummaryChars
    ),
    evidenceReferences: Array.isArray(candidate.evidenceReferences)
      ? candidate.evidenceReferences.slice(0, LIMITS.maxEvidenceReferences).map(ref => ({
          id: String((ref && ref.id) || ''),
          kind: String((ref && ref.kind) || 'artifact'),
          ...(ref && typeof ref.path === 'string' ? { path: String(ref.path) } : {}),
        }))
      : [],
    assumptions: Array.isArray(candidate.assumptions)
      ? candidate.assumptions.slice(0, 32).map(a => redactText(String(a)))
      : [],
    uncertainties: Array.isArray(candidate.uncertainties)
      ? candidate.uncertainties.slice(0, 32).map(u => redactText(String(u)))
      : [],
    proposedFiles: Array.isArray(candidate.proposedFiles)
      ? candidate.proposedFiles.slice(0, LIMITS.maxFiles)
      : [],
    providerIdentity: {
      providerId: String(providerId),
      model: String(modelId || response.modelId || 'unknown'),
    },
    correlationId: String(correlationId),
  };

  return {
    ok: true,
    candidate: normalized,
    usage: response.usage && isPlainObject(response.usage) ? { ...response.usage } : null,
  };
}

async function invokeRepairProvider({
  providerRegistry,
  providerId,
  modelId,
  correlationId,
  request,
  egressPolicy,
  timeoutMs = 5000,
  signal = null,
}) {
  if (!providerRegistry || typeof providerRegistry.invoke !== 'function') {
    return {
      ok: false,
      code: 'PROVIDER_FAILED',
      message: 'provider registry is required',
    };
  }

  const options = { timeoutMs: Number.isInteger(timeoutMs) ? timeoutMs : 5000 };
  if (egressPolicy !== undefined) options.policy = egressPolicy;
  if (signal) options.signal = signal;

  let result;
  try {
    result = await providerRegistry.invoke(providerId, request, options);
  } catch {
    return {
      ok: false,
      code: 'PROVIDER_FAILED',
      message: 'provider invocation threw; raw exception redacted',
    };
  }

  if (!result || result.ok !== true) {
    const code = result && result.error && result.error.code;
    if (code === 'PROVIDER_POLICY_DENIED') {
      return {
        ok: false,
        code: 'PROVIDER_POLICY_DENIED',
        denial: result.denial || null,
        message: 'provider egress policy denied the request',
      };
    }
    if (code === 'PROVIDER_TIMEOUT' || code === 'PROVIDER_CANCELLED') {
      return {
        ok: false,
        code: code === 'PROVIDER_CANCELLED' ? 'CANCELLED' : 'PROVIDER_FAILED',
        message: code,
      };
    }
    if (
      code === 'PROVIDER_RESPONSE_INVALID' ||
      code === 'RESPONSE_IDENTITY_MISMATCH' ||
      code === 'EVIDENCE_REFERENCE_MISMATCH' ||
      code === 'OUTPUT_LIMIT_EXCEEDED' ||
      code === 'REQUEST_INVALID'
    ) {
      return {
        ok: false,
        code: 'PROVIDER_OUTPUT_INVALID',
        message: code || 'invalid provider output',
      };
    }
    return {
      ok: false,
      code: 'PROVIDER_FAILED',
      message: code || 'provider failed',
    };
  }

  const extracted = extractCandidateFromProviderResponse(result.response, {
    providerId,
    modelId,
    correlationId,
  });
  if (!extracted.ok) return extracted;
  return {
    ok: true,
    candidate: extracted.candidate,
    usage: extracted.usage,
    response: result.response,
  };
}

module.exports = {
  snapshotCandidate,
  snapshotCandidateForHistory,
  snapshotCandidateFull,
  sha256Json,
  sha256Text,
  authorizedSourceLocations,
  buildProviderRequest,
  extractCandidateFromProviderResponse,
  invokeRepairProvider,
};
