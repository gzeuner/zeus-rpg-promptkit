const crypto = require('crypto');

const REPRODUCIBLE_TIMESTAMP = '2000-01-01T00:00:00.000Z';

const REPRODUCIBLE_PATHS = Object.freeze({
  workspaceRoot: 'WORKSPACE_ROOT',
  sourceRoot: 'SOURCE_ROOT',
  outputRoot: 'OUTPUT_ROOT',
});

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function normalizeReproducibilitySettings(value) {
  if (value === true) {
    return {
      enabled: true,
      stableTimestamp: REPRODUCIBLE_TIMESTAMP,
    };
  }

  if (!value || typeof value !== 'object') {
    return {
      enabled: false,
      stableTimestamp: REPRODUCIBLE_TIMESTAMP,
    };
  }

  return {
    enabled: Boolean(value.enabled),
    stableTimestamp: value.stableTimestamp || REPRODUCIBLE_TIMESTAMP,
  };
}

function resolveTimestamp(reproducibility, fallbackValue = null) {
  const settings = normalizeReproducibilitySettings(reproducibility);
  if (settings.enabled) {
    return settings.stableTimestamp;
  }
  return fallbackValue || new Date().toISOString();
}

function resolveDurationMs(reproducibility, actualDurationMs) {
  const settings = normalizeReproducibilitySettings(reproducibility);
  if (settings.enabled) {
    return 0;
  }
  return Number(actualDurationMs) || 0;
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .reduce((acc, key) => {
      acc[key] = sortKeysDeep(value[key]);
      return acc;
    }, {});
}

function hashNormalizedValue(value) {
  return hashContent(JSON.stringify(sortKeysDeep(value)));
}

function buildReproducibilityMetadata(reproducibility, contentFingerprint, extras = {}) {
  const settings = normalizeReproducibilitySettings(reproducibility);
  return {
    enabled: settings.enabled,
    stableTimestamp: settings.enabled ? settings.stableTimestamp : null,
    contentFingerprint: String(contentFingerprint || ''),
    ...extras,
  };
}

function buildReproduciblePathReplacements({ cwd, sourceRoot, outputRoot, outputProgramDir, program }) {
  const normalizedProgram = String(program || '').trim().toUpperCase() || 'PROGRAM';
  const replacements = new Map();

  if (outputProgramDir) {
    replacements.set(String(outputProgramDir), `${REPRODUCIBLE_PATHS.outputRoot}/${normalizedProgram}`);
  }
  if (outputRoot) {
    replacements.set(String(outputRoot), REPRODUCIBLE_PATHS.outputRoot);
  }
  if (sourceRoot) {
    replacements.set(String(sourceRoot), REPRODUCIBLE_PATHS.sourceRoot);
  }
  if (cwd) {
    replacements.set(String(cwd), REPRODUCIBLE_PATHS.workspaceRoot);
  }

  return replacements;
}

function replaceStringWithReplacements(value, replacements) {
  let result = String(value || '');
  const entries = Array.from(replacements.entries())
    .sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));

  for (const [rawValue, replacement] of entries) {
    if (!rawValue) continue;
    result = result.split(rawValue).join(replacement);
  }

  return result;
}

function replaceExactStringsDeep(value, replacements) {
  if (Array.isArray(value)) {
    return value.map((entry) => replaceExactStringsDeep(entry, replacements));
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      return replaceStringWithReplacements(value, replacements);
    }
    return value;
  }

  return Object.entries(value).reduce((acc, [key, entry]) => {
    acc[key] = replaceExactStringsDeep(entry, replacements);
    return acc;
  }, {});
}

module.exports = {
  REPRODUCIBLE_PATHS,
  REPRODUCIBLE_TIMESTAMP,
  buildReproducibilityMetadata,
  buildReproduciblePathReplacements,
  hashContent,
  hashNormalizedValue,
  normalizeReproducibilitySettings,
  replaceExactStringsDeep,
  resolveDurationMs,
  resolveTimestamp,
  sortKeysDeep,
};
