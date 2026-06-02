/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const path = require('path');
const { runDoctorChecks } = require('../cli/commands/doctorCommand');
const { executeAnalyze } = require('../core/analyzeService');
const { resolveAnalyzeConfig } = require('../config/runtimeConfig');
const { ANALYZE_RUN_MANIFEST_FILE } = require('../analyze/analyzeRunManifest');
const {
  buildEnvProfileConflictMessage,
  summarizeTargetValue,
} = require('../cli/helpers/runtimeConfigWarnings');

const ALLOWED_DOCTOR_KEYS = new Set(['profile', 'showResolved']);
const ALLOWED_ANALYZE_WORKSPACE_KEYS = new Set(['profile', 'program', 'member', 'safeSharing']);
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const OBJECT_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const SECRET_LIKE_PATTERN = /(PASS|PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|CREDENTIAL|PWD)/i;
const KNOWN_ANALYZE_FAILURE_CODES = new Set([
  'PROGRAM_REQUIRED',
  'SOURCE_REQUIRED',
  'SOURCE_ROOT_MISSING',
]);

class UiActionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'UiActionError';
    this.statusCode = statusCode;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateProfileName(profileName) {
  const value = String(profileName || '').trim();
  if (!value) {
    throw new UiActionError('Invalid payload: profile is required', 400);
  }
  if (value.includes('..')) {
    throw new UiActionError('Invalid payload: profile must not contain ".."', 400);
  }
  if (!PROFILE_NAME_PATTERN.test(value)) {
    throw new UiActionError('Invalid payload: profile name contains unsupported characters', 400);
  }
  return value;
}

function validateObjectName(value, fieldName) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  if (!OBJECT_NAME_PATTERN.test(trimmed)) {
    throw new UiActionError(`Invalid payload: ${fieldName} contains unsupported characters`, 400);
  }
  return trimmed.toUpperCase();
}

function normalizeDoctorPayload(rawPayload) {
  if (!isPlainObject(rawPayload)) {
    throw new UiActionError('Invalid payload: expected JSON object', 400);
  }

  const unknownKeys = Object.keys(rawPayload).filter((key) => !ALLOWED_DOCTOR_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new UiActionError(`Invalid payload: unsupported key(s): ${unknownKeys.join(', ')}`, 400);
  }

  const profile = validateProfileName(rawPayload.profile);
  const showResolved = rawPayload.showResolved === undefined ? false : Boolean(rawPayload.showResolved);
  return {
    profile,
    showResolved,
  };
}

function normalizeAnalyzeExistingWorkspacePayload(rawPayload) {
  if (!isPlainObject(rawPayload)) {
    throw new UiActionError('Invalid payload: expected JSON object', 400);
  }

  const unknownKeys = Object.keys(rawPayload).filter((key) => !ALLOWED_ANALYZE_WORKSPACE_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new UiActionError(`Invalid payload: unsupported key(s): ${unknownKeys.join(', ')}`, 400);
  }

  const profile = validateProfileName(rawPayload.profile);
  const program = validateObjectName(rawPayload.program, 'program');
  const member = validateObjectName(rawPayload.member, 'member');
  if (!program && !member) {
    throw new UiActionError('Invalid payload: program or member is required', 400);
  }

  return {
    profile,
    program: program || null,
    member: member || null,
    safeSharing: rawPayload.safeSharing === undefined ? true : Boolean(rawPayload.safeSharing),
  };
}

function summarizeDoctorChecks(checks = []) {
  const summary = {
    total: checks.length,
    pass: 0,
    fail: 0,
    warn: 0,
    info: 0,
    skip: 0,
  };
  for (const check of checks) {
    const status = String((check && check.status) || '').toUpperCase();
    if (status === 'PASS') summary.pass += 1;
    else if (status === 'FAIL') summary.fail += 1;
    else if (status === 'WARN') summary.warn += 1;
    else if (status === 'INFO') summary.info += 1;
    else summary.skip += 1;
  }
  return summary;
}

function summarizeDoctorDiagnostics(diagnostics = []) {
  const summary = {
    total: diagnostics.length,
    warn: 0,
    error: 0,
  };
  for (const diagnostic of diagnostics) {
    const severity = String((diagnostic && diagnostic.severity) || '').toUpperCase();
    if (severity === 'ERROR' || severity === 'FAIL') summary.error += 1;
    else if (severity === 'WARN' || severity === 'WARNING') summary.warn += 1;
  }
  return summary;
}

function isSensitiveDiagnosticField(path, envVar) {
  const normalizedPath = String(path || '').trim();
  const normalizedEnvVar = String(envVar || '').trim();
  return /password|secret|token|key|credential|pwd/i.test(normalizedPath)
    || SECRET_LIKE_PATTERN.test(normalizedEnvVar);
}

function normalizeDoctorDiagnostics(diagnostics = []) {
  if (!Array.isArray(diagnostics)) {
    return [];
  }

  return diagnostics
    .filter((entry) => isPlainObject(entry))
    .map((entry) => {
      const code = String(entry.code || '').trim() || 'DOCTOR_DIAGNOSTIC';
      const severity = String(entry.severity || '').trim().toUpperCase() || 'INFO';
      const path = String(entry.path || '').trim();
      const profile = String(entry.profile || '').trim();
      const envVar = String(entry.envVar || '').trim();
      const sensitive = isSensitiveDiagnosticField(path, envVar);
      const profileValue = sensitive
        ? '(redacted)'
        : summarizeTargetValue(path, entry.profileValue);
      const effectiveValue = sensitive
        ? '(redacted)'
        : summarizeTargetValue(path, entry.effectiveValue);
      const message = code === 'ENV_PROFILE_CONFLICT'
        ? buildEnvProfileConflictMessage({
          profile,
          path,
          profileValue,
          envVar,
          effectiveValue,
        })
        : String(entry.message || '').trim();

      return {
        code,
        severity,
        path,
        profile,
        profileValue,
        envVar,
        effectiveValue,
        message,
      };
    })
    .filter((entry) => entry.message || entry.code || entry.path);
}

function mapDoctorOutcome({ hasCriticalFailure, summary, diagnosticsSummary }) {
  if (hasCriticalFailure) return 'failed';
  if ((diagnosticsSummary && diagnosticsSummary.error > 0) || summary.fail > 0) return 'failed';
  if ((diagnosticsSummary && diagnosticsSummary.warn > 0) || summary.warn > 0) return 'warning';
  return 'ready';
}

function defaultDoctorExecutor(args, runtime) {
  return runDoctorChecks(args, runtime);
}

function defaultAnalyzeExecutor(args, runtime) {
  return executeAnalyze(args, runtime);
}

function defaultAnalyzeConfigResolver(args, runtime) {
  return resolveAnalyzeConfig(args, runtime);
}

function sanitizeWorkspacePathForUi(value, cwd) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }

  if (!path.isAbsolute(trimmed)) {
    return trimmed.replace(/\\/g, '/');
  }

  const relative = path.relative(cwd, trimmed);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return '(configured outside project root)';
  }

  const normalized = relative.split(path.sep).join('/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

function isExpectedAnalyzeFailure(error) {
  const code = String(error && error.code || '').trim().toUpperCase();
  if (KNOWN_ANALYZE_FAILURE_CODES.has(code)) {
    return true;
  }

  const message = String(error && error.message || '');
  return /failed to load profiles|profile ".*" not found|missing required option|source directory not found|member ".*" not found|ambiguous/i.test(message);
}

function summarizeAnalyzeFailure(error) {
  const code = String(error && error.code || '').trim().toUpperCase();
  const message = String(error && error.message || '').trim();
  if (/source directory not found/i.test(message)) {
    return 'The selected profile source root was not found locally.';
  }
  if (code === 'PROGRAM_REQUIRED') {
    return 'The selected profile requires a program name or a member that resolves to a program.';
  }
  if (code === 'SOURCE_REQUIRED' || code === 'SOURCE_ROOT_MISSING') {
    return 'The selected profile does not resolve to a usable local source root for analysis.';
  }
  if (/member ".*" not found/i.test(message)) {
    return message.replace(/ under .*/i, ' under the configured local source root.');
  }
  if (/ambiguous/i.test(message)) {
    return message.replace(/ under .*/i, '.');
  }
  if (/failed to load profiles/i.test(message) || /profile ".*" not found/i.test(message)) {
    return message;
  }
  return 'Analyze Workspace failed for the selected input.';
}

function summarizeAnalyzeDiagnostics(manifest) {
  const summary = manifest && manifest.summary && typeof manifest.summary === 'object'
    ? manifest.summary
    : {};
  const warningCount = Number(summary.warningCount || 0);
  const errorCount = Number(summary.errorCount || 0);
  if (warningCount <= 0 && errorCount <= 0) {
    return [];
  }

  return [{
    code: errorCount > 0 ? 'ANALYZE_ERRORS' : 'ANALYZE_WARNINGS',
    severity: errorCount > 0 ? 'ERROR' : 'WARN',
    message: errorCount > 0
      ? `Analysis completed with ${errorCount} error(s) and ${warningCount} warning(s).`
      : `Analysis completed with ${warningCount} warning(s).`,
    errorCount,
    warningCount,
  }];
}

function buildAnalyzeWorkspaceOutput(program, manifest) {
  const artifacts = Array.isArray(manifest && manifest.artifacts) ? manifest.artifacts : [];
  const reportArtifact = artifacts.find((artifact) => artifact && artifact.path === 'report.md');
  const manifestPath = `${program}/${ANALYZE_RUN_MANIFEST_FILE}`;
  const reportArtifactPath = reportArtifact ? `${program}/report.md` : null;

  return {
    runId: program,
    program,
    manifestPath,
    runApiPath: `/api/runs/${encodeURIComponent(program)}`,
    viewsApiPath: `/api/runs/${encodeURIComponent(program)}/views`,
    reportArtifactPath,
    reportUrl: reportArtifact
      ? `/runs/${encodeURIComponent(program)}/artifacts/raw?path=${encodeURIComponent('report.md')}`
      : null,
  };
}

function buildAnalyzeWorkspaceContext(payload, config, cwd) {
  const safeSourceRoot = sanitizeWorkspacePathForUi(config && config.sourceRoot, cwd);
  const safeOutputRoot = sanitizeWorkspacePathForUi(config && config.outputRoot, cwd);
  return {
    profile: payload.profile,
    sourceRoot: safeSourceRoot,
    outputRoot: safeOutputRoot,
    sourceRootOrigin: 'profile',
  };
}

function createLocalUiActionService({
  cwd = process.cwd(),
  env = process.env,
  doctorExecutor = defaultDoctorExecutor,
  analyzeExecutor = defaultAnalyzeExecutor,
  analyzeConfigResolver = defaultAnalyzeConfigResolver,
} = {}) {
  async function runDoctorAction(rawPayload) {
    const startedAt = new Date();
    const payload = normalizeDoctorPayload(rawPayload || {});
    const args = {
      profile: payload.profile,
      'show-resolved': payload.showResolved,
    };

    const doctorResult = await Promise.resolve(doctorExecutor(args, { cwd, env }));
    const checks = Array.isArray(doctorResult && doctorResult.checks) ? doctorResult.checks : [];
    const diagnostics = normalizeDoctorDiagnostics(doctorResult && doctorResult.diagnostics);
    const summary = summarizeDoctorChecks(checks);
    const diagnosticsSummary = summarizeDoctorDiagnostics(diagnostics);
    const finishedAt = new Date();

    return {
      action: 'doctor',
      status: mapDoctorOutcome({
        hasCriticalFailure: Boolean(doctorResult && doctorResult.hasCriticalFailure),
        summary,
        diagnosticsSummary,
      }),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      input: payload,
      diagnostics,
      result: {
        hasCriticalFailure: Boolean(doctorResult && doctorResult.hasCriticalFailure),
        summary,
        diagnosticsSummary,
        checks: checks.map((entry) => ({
          name: entry.name,
          status: entry.status,
          details: entry.details,
        })),
      },
      notes: payload.showResolved
        ? ['showResolved is accepted, but resolved connection internals are intentionally not exposed in UI action responses.']
        : [],
    };
  }

  async function runAnalyzeExistingWorkspaceAction(rawPayload) {
    const startedAt = new Date();
    const payload = normalizeAnalyzeExistingWorkspacePayload(rawPayload || {});
    const analyzeArgs = {
      profile: payload.profile,
      program: payload.program || undefined,
      member: payload.member || undefined,
      'safe-sharing': payload.safeSharing,
    };

    let analyzeConfig = null;
    try {
      analyzeConfig = analyzeConfigResolver({ profile: payload.profile }, { cwd, env });
    } catch (error) {
      if (!isExpectedAnalyzeFailure(error)) {
        throw error;
      }
      const finishedAt = new Date();
      return {
        action: 'analyze-existing-workspace',
        status: 'failed',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        input: payload,
        workspace: buildAnalyzeWorkspaceContext(payload, null, cwd),
        diagnostics: [{
          code: 'ANALYZE_FAILED',
          severity: 'ERROR',
          message: summarizeAnalyzeFailure(error),
        }],
        result: {
          code: String(error.code || '').trim() || 'ANALYZE_FAILED',
          message: summarizeAnalyzeFailure(error),
        },
        notes: ['Analyze Workspace uses the configured local profile source root and does not accept browser-provided filesystem paths.'],
      };
    }

    try {
      const execution = await Promise.resolve(analyzeExecutor(analyzeArgs, { cwd, env }));
      const manifest = execution && execution.analyzeManifest ? execution.analyzeManifest : null;
      const diagnostics = summarizeAnalyzeDiagnostics(manifest);
      const finishedAt = new Date();
      const status = diagnostics.some((entry) => String(entry.severity || '').toUpperCase() === 'ERROR')
        ? 'failed'
        : diagnostics.length > 0
          ? 'warning'
          : 'completed';

      return {
        action: 'analyze-existing-workspace',
        status,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        input: payload,
        workspace: buildAnalyzeWorkspaceContext(payload, analyzeConfig, cwd),
        diagnostics,
        output: buildAnalyzeWorkspaceOutput(execution.program, manifest),
        result: {
          program: execution.program,
          member: payload.member,
          summary: manifest && manifest.summary ? {
            stageCount: Number(manifest.summary.stageCount || 0),
            diagnosticCount: Number(manifest.summary.diagnosticCount || 0),
            warningCount: Number(manifest.summary.warningCount || 0),
            errorCount: Number(manifest.summary.errorCount || 0),
            generatedArtifactCount: Number(manifest.summary.generatedArtifactCount || 0),
            sourceFileCount: Number(manifest.summary.sourceFileCount || 0),
          } : null,
          manifestStatus: manifest && manifest.run ? manifest.run.status || null : null,
        },
        notes: [
          'Analyze Workspace reuses the existing local analyze pipeline and does not fetch remote sources.',
          payload.safeSharing ? 'Safe-sharing artifacts were generated for this run.' : null,
          payload.member && !payload.program ? 'Program resolution was derived from the selected member within the configured source root.' : null,
        ].filter(Boolean),
      };
    } catch (error) {
      if (!isExpectedAnalyzeFailure(error)) {
        throw error;
      }
      const finishedAt = new Date();
      return {
        action: 'analyze-existing-workspace',
        status: 'failed',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        input: payload,
        workspace: buildAnalyzeWorkspaceContext(payload, analyzeConfig, cwd),
        diagnostics: [{
          code: 'ANALYZE_FAILED',
          severity: 'ERROR',
          message: summarizeAnalyzeFailure(error),
        }],
        result: {
          code: String(error.code || '').trim() || 'ANALYZE_FAILED',
          message: summarizeAnalyzeFailure(error),
          manifestStatus: error && error.analyzeManifest && error.analyzeManifest.run
            ? error.analyzeManifest.run.status || null
            : null,
        },
        notes: [
          'Analyze Workspace uses the configured local profile source root and does not accept browser-provided filesystem paths.',
        ],
      };
    }
  }

  async function executeAction(actionName, payload) {
    const normalizedAction = String(actionName || '').trim().toLowerCase();
    if (!normalizedAction) {
      throw new UiActionError('Unknown action', 404);
    }

    if (normalizedAction === 'doctor') {
      return runDoctorAction(payload);
    }
    if (normalizedAction === 'analyze-existing-workspace') {
      return runAnalyzeExistingWorkspaceAction(payload);
    }

    throw new UiActionError(`Unknown action: ${normalizedAction}`, 404);
  }

  return {
    executeAction,
    normalizeAnalyzeExistingWorkspacePayload,
    normalizeDoctorPayload,
    validateProfileName,
    validateObjectName,
  };
}

module.exports = {
  UiActionError,
  createLocalUiActionService,
  normalizeAnalyzeExistingWorkspacePayload,
  normalizeDoctorPayload,
  normalizeDoctorDiagnostics,
  validateProfileName,
  validateObjectName,
};
