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
const fs = require('fs');
const path = require('path');
const { PROFILES_METADATA_KEY } = require('./runtimeConfigDefaults');
const { detectPlaintextSecrets } = require('../security/plaintextSecretDetector');

let warnedPlaintextProfiles = false;

/**
 * Walk upwards from startDir looking for a config directory that contains
 * profile definitions. This makes profile and env discovery robust when
 * the user runs the CLI from a subdirectory or a different terminal CWD
 * in multi-root workspaces.
 */
function findNearestConfigDir(startDir) {
  let current = path.resolve(startDir || process.cwd());
  const maxDepth = 12;
  for (let i = 0; i < maxDepth; i += 1) {
    const configDir = path.join(current, 'config');
    const hasProfiles =
      fs.existsSync(path.join(configDir, 'profiles.json')) ||
      fs.existsSync(path.join(configDir, 'local-only', 'profiles.json')) ||
      fs.existsSync(path.join(configDir, 'profiles.example.json'));
    if (hasProfiles) {
      return configDir;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function attachProfilesMetadata(profiles, metadata) {
  Object.defineProperty(profiles, PROFILES_METADATA_KEY, {
    value: metadata,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return profiles;
}

function getProfilesMetadata(profiles) {
  if (!profiles || typeof profiles !== 'object') {
    return null;
  }
  return profiles[PROFILES_METADATA_KEY] || null;
}

function resolveProfilesConfigPaths({ args = {}, cwd = process.cwd(), env = process.env } = {}) {
  const cliConfig =
    args && args.config !== undefined && args.config !== null && args.config !== true
      ? String(args.config).trim()
      : '';
  const envConfig = env.ZEUS_CONFIG_DIR ? String(env.ZEUS_CONFIG_DIR).trim() : '';
  const rawLocation = cliConfig || envConfig;
  const source = cliConfig ? 'cli' : envConfig ? 'env' : 'default';
  const explicitLocation = source !== 'default';

  let resolvedLocation;
  if (rawLocation) {
    resolvedLocation = path.resolve(cwd, rawLocation);
  } else {
    const nearest = findNearestConfigDir(cwd);
    resolvedLocation = nearest || path.resolve(cwd, 'config');
  }
  const looksLikeJsonFile = resolvedLocation.toLowerCase().endsWith('.json');

  if (looksLikeJsonFile) {
    return {
      source,
      explicitLocation,
      configDir: path.dirname(resolvedLocation),
      preferredPath: resolvedLocation,
      fallbackPath: null,
      attemptedPaths: [resolvedLocation],
      description: resolvedLocation,
    };
  }

  const preferredPath = path.join(resolvedLocation, 'local-only', 'profiles.json');
  const secondaryPath = path.join(resolvedLocation, 'profiles.json');
  const fallbackPath = path.join(resolvedLocation, 'profiles.example.json');
  return {
    source,
    explicitLocation,
    configDir: resolvedLocation,
    preferredPath,
    secondaryPath,
    fallbackPath,
    attemptedPaths: [preferredPath, secondaryPath, fallbackPath],
    description: resolvedLocation,
  };
}

function loadProfiles({
  cwd = process.cwd(),
  env = process.env,
  args = {},
  fsModule = fs,
  mergeConfigLayers,
  validateProfiles,
} = {}) {
  const configPaths = resolveProfilesConfigPaths({ args, cwd, env });
  const candidatePaths = (
    configPaths.attemptedPaths || [configPaths.preferredPath, configPaths.fallbackPath]
  ).filter(Boolean);
  const profilePath = candidatePaths.find(candidate => fsModule.existsSync(candidate)) || null;
  const baseFileName = profilePath ? path.basename(profilePath).toLowerCase() : '';
  const shouldLoadOverlays =
    !profilePath || baseFileName === 'profiles.json' || baseFileName === 'profiles.example.json';
  const overlayPaths = shouldLoadOverlays
    ? configPaths.configDir && fsModule.existsSync(configPaths.configDir)
      ? fsModule
          .readdirSync(configPaths.configDir)
          .filter(entry => /^profiles\.[^.]+\.json$/i.test(entry))
          .map(entry => path.join(configPaths.configDir, entry))
          .filter(entry => fsModule.existsSync(entry))
          .sort((left, right) => left.localeCompare(right))
      : []
    : [];

  if (!profilePath) {
    return attachProfilesMetadata(
      {},
      {
        ...configPaths,
        profilePath: null,
        sourceFileLabel: [...candidatePaths, ...overlayPaths].join(' or '),
      }
    );
  }

  try {
    const raw = fsModule.readFileSync(profilePath, 'utf8');
    const parsed = JSON.parse(raw);
    let profiles = parsed && typeof parsed === 'object' ? parsed : {};

    for (const overlayPath of overlayPaths) {
      const overlayRaw = fsModule.readFileSync(overlayPath, 'utf8');
      const overlayParsed = JSON.parse(overlayRaw);
      const overlayProfiles =
        overlayParsed && typeof overlayParsed === 'object' ? overlayParsed : {};
      profiles = mergeConfigLayers(profiles, overlayProfiles);
    }

    validateProfiles(profiles);

    // Secrets-Hygiene: warn on profile load if plaintext credentials still present (once per process)
    if (!warnedPlaintextProfiles) {
      try {
        const hygiene = detectPlaintextSecrets({ cwd, checkProfiles: true, env: process.env });
        if (hygiene.length > 0) {
          console.warn(
            `[WARN] Secrets-Hygiene: ${hygiene.length} Klartext-Credential(s) in .env oder Profilen erkannt beim Laden von Profilen.`
          );
          console.warn(
            '  Migriere mit "zeus secret encrypt". Details im "zeus doctor" oder "zeus secret status".'
          );
          warnedPlaintextProfiles = true;
        }
      } catch (_) {}
    }

    return attachProfilesMetadata(profiles, {
      ...configPaths,
      profilePath,
      attemptedPaths: [...candidatePaths, ...overlayPaths],
      sourceFileLabel: [profilePath, ...overlayPaths].join(' + '),
    });
  } catch (error) {
    throw new Error(`Failed to load profiles from ${profilePath}: ${error.message}`);
  }
}

function describeProfilesLocation(profiles) {
  const metadata = getProfilesMetadata(profiles);
  if (!metadata) {
    return 'config/local-only/profiles.json or config/profiles.json or config/profiles.example.json';
  }
  if (metadata.profilePath) {
    return metadata.profilePath;
  }
  return (
    (metadata.attemptedPaths || []).join(' or ') ||
    metadata.description ||
    'config/local-only/profiles.json'
  );
}

module.exports = {
  describeProfilesLocation,
  findNearestConfigDir,
  getProfilesMetadata,
  loadProfiles,
  resolveProfilesConfigPaths,
};
