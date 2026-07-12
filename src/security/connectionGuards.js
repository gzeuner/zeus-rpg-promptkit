'use strict';

const { collectSensitiveTermsFromEnv, maskSecretsInText } = require('./secretMasking');

const DB2_PROBE_SQL = 'SELECT 1 AS HEALTHCHECK FROM SYSIBM.SYSDUMMY1';
const FETCH_PROBE_COMMAND = 'CHKOBJ OBJ(QSYS/QSYS) OBJTYPE(*LIB)';

const dbGuardState = new Map();
const fetchGuardState = new Map();

const AUTH_OR_CONNECTION_ERROR_PATTERN =
  /SQL30082|SQLSTATE\s*[=:]?\s*(08001|08004|08S01)|CPF22E2|CPF2204|CPF2203|invalid password|authentication|authorization|not authorized|signon|user profile|disabled|connection refused|timed out|timeout|unknown host|unknownhost|communication link failure|socket|ssl/i;

function normalizeKeyPart(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function buildDbGuardKey(dbConfig = {}) {
  return [
    normalizeKeyPart(dbConfig.url || dbConfig.host),
    normalizeKeyPart(dbConfig.user),
    normalizeKeyPart(
      dbConfig.defaultSchema || dbConfig.defaultLibrary || dbConfig.schema || dbConfig.library
    ),
  ].join('|');
}

function buildFetchGuardKey(fetchConfig = {}) {
  return [normalizeKeyPart(fetchConfig.host), normalizeKeyPart(fetchConfig.user)].join('|');
}

function sanitizeProbeError(error, env = process.env) {
  const rawMessage =
    String(error && error.message ? error.message : error || '').trim() || 'Unknown remote error.';
  const masked = maskSecretsInText(
    maskSecretsInText(rawMessage),
    collectSensitiveTermsFromEnv(env)
  );
  return masked || 'Unknown remote error.';
}

function buildProbeFailureMessage(scopeLabel, cause, { repeated = false } = {}) {
  const prefix = repeated
    ? `[guard] Pre-flight login check already failed for ${scopeLabel}.`
    : `[guard] Pre-flight login check failed for ${scopeLabel}.`;
  const suffix = repeated
    ? 'Skipping additional remote calls in this run to avoid repeated sign-on or connection failures.'
    : 'Aborting before additional remote calls are executed.';
  return `${prefix} ${suffix} Cause: ${cause}`;
}

function shouldCacheFailure(error) {
  return AUTH_OR_CONNECTION_ERROR_PATTERN.test(
    String(error && error.message ? error.message : error || '')
  );
}

function ensureCachedGuardState(stateMap, cacheKey, scopeLabel) {
  const existing = stateMap.get(cacheKey);
  if (!existing) {
    return null;
  }
  if (existing.status === 'ok') {
    return existing;
  }
  throw new Error(buildProbeFailureMessage(scopeLabel, existing.cause, { repeated: true }));
}

function markGuardSuccess(stateMap, cacheKey) {
  stateMap.set(cacheKey, {
    status: 'ok',
    timestamp: Date.now(),
  });
}

function markGuardFailure(stateMap, cacheKey, scopeLabel, error, env = process.env) {
  const cause = sanitizeProbeError(error, env);
  if (shouldCacheFailure(error)) {
    stateMap.set(cacheKey, {
      status: 'failed',
      cause,
      timestamp: Date.now(),
    });
  }
  throw new Error(buildProbeFailureMessage(scopeLabel, cause));
}

function ensureDb2ConnectionGuard({
  dbConfig,
  probe,
  scopeLabel = 'DB2 connection',
  env = process.env,
} = {}) {
  const cacheKey = buildDbGuardKey(dbConfig);
  if (!cacheKey.replace(/\|/g, '')) {
    return;
  }

  ensureCachedGuardState(dbGuardState, cacheKey, scopeLabel);

  try {
    probe({
      dbConfig,
      query: DB2_PROBE_SQL,
      maxRows: 1,
    });
    markGuardSuccess(dbGuardState, cacheKey);
  } catch (error) {
    markGuardFailure(dbGuardState, cacheKey, scopeLabel, error, env);
  }
}

function ensureFetchConnectionGuard({
  fetchConfig,
  probe,
  scopeLabel = 'IBM i fetch connection',
  env = process.env,
} = {}) {
  const cacheKey = buildFetchGuardKey(fetchConfig);
  if (!cacheKey.replace(/\|/g, '')) {
    return;
  }

  ensureCachedGuardState(fetchGuardState, cacheKey, scopeLabel);

  try {
    probe({
      host: fetchConfig.host,
      user: fetchConfig.user,
      password: fetchConfig.password,
      command: FETCH_PROBE_COMMAND,
      verbose: false,
    });
    markGuardSuccess(fetchGuardState, cacheKey);
  } catch (error) {
    markGuardFailure(fetchGuardState, cacheKey, scopeLabel, error, env);
  }
}

function resetConnectionGuardState() {
  dbGuardState.clear();
  fetchGuardState.clear();
}

module.exports = {
  DB2_PROBE_SQL,
  FETCH_PROBE_COMMAND,
  buildDbGuardKey,
  buildFetchGuardKey,
  ensureDb2ConnectionGuard,
  ensureFetchConnectionGuard,
  resetConnectionGuardState,
};
