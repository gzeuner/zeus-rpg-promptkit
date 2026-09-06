'use strict';

const { sanitizeValue } = require('../security/secretMasking');

const AGENT_RESPONSE_CONTRACT_VERSION = 1;
const AGENT_RESPONSE_FIELDS = Object.freeze([
  'ok',
  'status',
  'safety',
  'scope',
  'evidence',
  'artifacts',
  'warnings',
  'nextCommands',
  'approvalRequired',
]);
const DEFAULT_NEXT_COMMAND = 'node cli/zeus.js agent preflight --json';

function safeText(value, fallback = null) {
  const text = sanitizeValue(String(value == null ? '' : value).trim());
  return text || fallback;
}

function uniqueSafeStrings(values = []) {
  const source = Array.isArray(values) ? values : [values];
  return [...new Set(source.map(value => safeText(value, '')).filter(Boolean))];
}

function normalizeStatus(payload, options, warnings) {
  if (options.status) return safeText(options.status, 'ready');
  if (payload.status) return safeText(payload.status, 'ready');
  if (payload.ok === false) return 'failed';
  return warnings.length > 0 ? 'needs-attention' : 'ready';
}

function normalizeSafety(payload, options, approvalRequired) {
  const source = payload.safety && typeof payload.safety === 'object' ? payload.safety : {};
  return {
    level: safeText(source.level || options.safetyLevel, 'S0'),
    approvalRequired,
    sideEffects: uniqueSafeStrings(source.sideEffects || options.sideEffects || ['local-read']),
  };
}

function normalizeScope(payload, options) {
  const source = payload.scope && typeof payload.scope === 'object' ? payload.scope : {};
  const context = options.context && typeof options.context === 'object' ? options.context : {};
  const active = context.active && typeof context.active === 'object' ? context.active : {};
  return {
    origin: safeText(source.origin || options.scopeOrigin, 'workspace'),
    profile: safeText(source.profile || options.profile || context.profile, null),
    system: safeText(source.system || active.system, null),
    library: safeText(source.library || active.library || active.schema, null),
    sourceFile: safeText(source.sourceFile || active.sourceFile, null),
    member: safeText(source.member || active.member, null),
    program: safeText(source.program || options.program, null),
    sourceRoot: safeText(source.sourceRoot || options.source, null),
    outputRoot: safeText(source.outputRoot || options.out, null),
  };
}

function normalizeEvidence(payload, options) {
  const source = payload.evidence && typeof payload.evidence === 'object' ? payload.evidence : {};
  const sources = uniqueSafeStrings(source.sources || options.evidenceSources || []);
  const unresolved = uniqueSafeStrings(source.unresolved || options.unresolved || []);
  return {
    available: source.available !== false && options.evidenceAvailable !== false,
    sources,
    count: Number.isInteger(source.count) ? source.count : Number(options.evidenceCount || 0),
    complete: source.complete !== false && options.evidenceComplete !== false,
    unresolved,
  };
}

function normalizeArtifacts(payload, options) {
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : options.artifacts || [];
  return uniqueSafeStrings(artifacts);
}

function withAgentResponseContract(payload = {}, options = {}) {
  const warnings = uniqueSafeStrings([
    ...(Array.isArray(payload.warnings) ? payload.warnings : []),
    ...(options.warnings || []),
  ]);
  const nextCommands = uniqueSafeStrings(
    Array.isArray(payload.nextCommands) && payload.nextCommands.length > 0
      ? payload.nextCommands
      : options.nextCommands || []
  );
  const approvalRequired = Boolean(
    options.approvalRequired ?? payload.approvalRequired ?? payload.safety?.approvalRequired
  );
  const result = {
    ...payload,
    contractVersion: AGENT_RESPONSE_CONTRACT_VERSION,
    status: normalizeStatus(payload, options, warnings),
    safety: normalizeSafety(payload, options, approvalRequired),
    scope: normalizeScope(payload, options),
    evidence: normalizeEvidence(payload, options),
    artifacts: normalizeArtifacts(payload, options),
    warnings,
    nextCommands,
    approvalRequired,
  };

  if (payload.ok === false || options.failureCode) {
    result.failureCode = safeText(
      options.failureCode || payload.failureCode,
      'AGENT_COMMAND_FAILED'
    );
    result.lesson = safeText(
      options.lesson || payload.lesson,
      'Inspect the failure code and follow the documented next safe step.'
    );
    result.nextSafeStep = safeText(
      options.nextSafeStep || payload.nextSafeStep || nextCommands[0],
      DEFAULT_NEXT_COMMAND
    );
  }

  return result;
}

function buildAgentErrorResponse(error, options = {}) {
  const failureCode = safeText(error?.code, 'AGENT_COMMAND_FAILED');
  const message = safeText(error?.message, 'Agent command failed.');
  return withAgentResponseContract(
    {
      ok: false,
      operation: 'error',
      service: 'zeus-rpg-promptkit',
      transport: 'cli',
      canonicalSurface: 'cli',
      mcpOptional: true,
      error: { code: failureCode, message },
    },
    {
      ...options,
      status: options.status || (failureCode === 'APPROVAL_REQUIRED' ? 'blocked' : 'failed'),
      failureCode,
      nextSafeStep: options.nextSafeStep || DEFAULT_NEXT_COMMAND,
      nextCommands: options.nextCommands || [DEFAULT_NEXT_COMMAND],
      evidenceAvailable: false,
      evidenceComplete: false,
    }
  );
}

module.exports = {
  AGENT_RESPONSE_CONTRACT_VERSION,
  AGENT_RESPONSE_FIELDS,
  buildAgentErrorResponse,
  withAgentResponseContract,
};
