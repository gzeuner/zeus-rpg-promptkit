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
const { runDoctorChecks } = require('../cli/commands/doctorCommand');

const ALLOWED_DOCTOR_KEYS = new Set(['profile', 'showResolved']);
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

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

function mapDoctorOutcome({ hasCriticalFailure, summary }) {
  if (hasCriticalFailure) return 'failed';
  if (summary.warn > 0) return 'warning';
  return 'ready';
}

function defaultDoctorExecutor(args, runtime) {
  return runDoctorChecks(args, runtime);
}

function createLocalUiActionService({
  cwd = process.cwd(),
  env = process.env,
  doctorExecutor = defaultDoctorExecutor,
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
    const summary = summarizeDoctorChecks(checks);
    const finishedAt = new Date();

    return {
      action: 'doctor',
      status: mapDoctorOutcome({
        hasCriticalFailure: Boolean(doctorResult && doctorResult.hasCriticalFailure),
        summary,
      }),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      input: payload,
      result: {
        hasCriticalFailure: Boolean(doctorResult && doctorResult.hasCriticalFailure),
        summary,
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

  async function executeAction(actionName, payload) {
    const normalizedAction = String(actionName || '').trim().toLowerCase();
    if (!normalizedAction) {
      throw new UiActionError('Unknown action', 404);
    }

    if (normalizedAction === 'doctor') {
      return runDoctorAction(payload);
    }

    throw new UiActionError(`Unknown action: ${normalizedAction}`, 404);
  }

  return {
    executeAction,
    normalizeDoctorPayload,
    validateProfileName,
  };
}

module.exports = {
  UiActionError,
  createLocalUiActionService,
  normalizeDoctorPayload,
  validateProfileName,
};
