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
'use strict';

const { loadProfiles, getProfilesMetadata, resolveProfile } = require('../../config/runtimeConfig');
const { describeConnectionTarget } = require('../../config/connectionTargetMetadata');
const { createJsonOutput } = require('../helpers/jsonOutput');

const GLOBAL_PROFILE_KEYS = new Set(['contextOptimizer', 'testData', 'analysisLimits', 'presets']);
const PREFERRED_PROFILE_ORDER = ['dev', 'demo', 'sftp-fetch', 'readonly-db2', 'combined-fetch-and-query'];

// Env-Vars die ein Profil mit DB-Konfiguration braucht
const DB_ENV_VARS = [
  { name: 'ZEUS_DB_HOST', hint: 'IBM i Hostname', required: true },
  { name: 'ZEUS_DB_USER', hint: 'DB-Username', required: true },
  { name: 'ZEUS_DB_PASSWORD', hint: 'DB-Passwort', required: true },
  { name: 'ZEUS_DB_DEFAULT_SCHEMA', hint: 'Standard-Schema (optional)', required: false },
  { name: 'ZEUS_DB_URL', hint: 'JDBC-URL (alternativ zu HOST)', required: false },
];
const FETCH_ENV_VARS = [
  { name: 'ZEUS_FETCH_HOST', hint: 'IBM i Hostname fuer Source-Fetch', required: true },
  { name: 'ZEUS_FETCH_USER', hint: 'Fetch-Username', required: true },
  { name: 'ZEUS_FETCH_PASSWORD', hint: 'Fetch-Passwort', required: true },
  { name: 'ZEUS_FETCH_SOURCE_LIB|ZEUS_FETCH_SOURCE_LIBRARY', hint: 'Source-Library fuer Fetch', required: true },
];

function checkEnvStatus(name) {
  const val = name.includes('|')
    ? name.split('|').map((entry) => process.env[entry]).find((entry) => entry && entry.trim())
    : process.env[name];
  if (val && val.trim()) return '[PASS] gesetzt';
  return '[FAIL] nicht gesetzt';
}

function maskSecret(value) {
  if (!value || typeof value !== 'string' || !value.trim()) return '(nicht gesetzt)';
  if (value.startsWith('${env:')) return value; // env-placeholder — nicht maskieren
  return '***';
}

function describeProfileEntry(name, profile) {
  const metadataDb = (profile.dbRoles && profile.dbRoles.metadata) || profile.db || {};
  const testDataDb = (profile.dbRoles && profile.dbRoles.testData) || metadataDb;
  const fetch = profile.fetch || {};
  const isProd = profile.productionSystem ? ' [PROD]' : '';
  const extendsTag = profile.extends ? ` extends: ${Array.isArray(profile.extends) ? profile.extends.join(', ') : profile.extends}` : '';
  const lines = [`  Profil: ${name}${isProd}${extendsTag}`];
  lines.push(`    Metadata DB: ${describeConnectionTarget(metadataDb)}  User=${metadataDb.user || '?'}  Password=${maskSecret(metadataDb.password)}`);
  if (testDataDb && testDataDb !== metadataDb) {
    lines.push(`    Test Data:   ${describeConnectionTarget(testDataDb)}  User=${testDataDb.user || '?'}  Password=${maskSecret(testDataDb.password)}`);
  }
  if (fetch && (fetch.host || fetch.url || fetch.sourceLib || fetch.sourceLibrary)) {
    const sourceLib = fetch.sourceLib || fetch.sourceLibrary || '(keine Source-Library)';
    lines.push(`    Fetch:       ${describeConnectionTarget(fetch)}  SourceLib=${sourceLib}`);
  }
  return lines.join('\n');
}

function orderProfileNames(profileNames) {
  const nameSet = new Set(profileNames);
  const preferred = PREFERRED_PROFILE_ORDER.filter((name) => nameSet.has(name));
  const remaining = profileNames
    .filter((name) => !preferred.includes(name))
    .sort((left, right) => left.localeCompare(right));
  return [...preferred, ...remaining];
}

async function runProfiles(args) {
  let profiles;
  try {
    profiles = loadProfiles({ cwd: process.cwd(), env: process.env, args });
  } catch (err) {
    console.error(`Fehler beim Laden der Profile: ${err.message}`);
    process.exit(2);
  }

  const meta = getProfilesMetadata(profiles);
  if (meta && (meta.sourceFileLabel || meta.profilePath || meta.description)) {
    console.log(`Konfigurationsdatei: ${meta.sourceFileLabel || meta.profilePath || meta.description}`);
  }
  console.log('');

  const names = Object.keys(profiles).filter((k) => !GLOBAL_PROFILE_KEYS.has(k) && !k.startsWith('_'));
  if (names.length === 0) {
    console.log('Keine Profile gefunden.');
    return;
  }

  const filterName = args.profile ? String(args.profile).trim() : null;
  const toShow = filterName ? names.filter((n) => n === filterName) : orderProfileNames(names);

  if (toShow.length === 0) {
    console.error(`Profil "${filterName}" nicht gefunden. Verfuegbar: ${names.join(', ')}`);
    process.exit(2);
  }

  const showEnv = Boolean(args['show-env']);

  if (!filterName) {
    const preferred = PREFERRED_PROFILE_ORDER.filter((name) => names.includes(name));
    if (preferred.length > 0) {
      console.log(`Empfohlene Startprofile: ${preferred.join(', ')}`);
      console.log('Legacy-Profile (sample-*) bleiben als Alias weiterhin unterstuetzt.');
      console.log('');
    }
  }

  for (const name of toShow) {
    let resolved;
    try {
      resolved = resolveProfile(profiles, name, { env: process.env });
    } catch (_) {
      resolved = profiles[name];
    }
    console.log(describeProfileEntry(name, resolved || profiles[name]));

    if (showEnv) {
      const profile = resolved || profiles[name] || {};
      const hasDb = Boolean(profile.db || (profile.dbRoles && profile.dbRoles.metadata));
      const hasMetadataDb = Boolean(profile.dbRoles && profile.dbRoles.metadata);
      const hasTestDataDb = Boolean(profile.dbRoles && profile.dbRoles.testData);
      const hasFetch = Boolean(profile.fetch);
      console.log('    Env-Vars:');
      const envVarsToCheck = [
        ...(hasDb ? DB_ENV_VARS : []),
        ...(hasMetadataDb ? [
          { name: 'ZEUS_METADATA_DB_HOST', hint: 'Metadata-DB Hostname', required: true },
          { name: 'ZEUS_METADATA_DB_USER', hint: 'Metadata-DB Username', required: true },
          { name: 'ZEUS_METADATA_DB_PASSWORD', hint: 'Metadata-DB Passwort', required: true },
          { name: 'ZEUS_METADATA_DB_URL', hint: 'Metadata-DB JDBC-URL (optional)', required: false },
        ] : []),
        ...(hasTestDataDb ? [
          { name: 'ZEUS_TESTDATA_DB_HOST', hint: 'TestData-DB Hostname', required: true },
          { name: 'ZEUS_TESTDATA_DB_USER', hint: 'TestData-DB Username', required: true },
          { name: 'ZEUS_TESTDATA_DB_PASSWORD', hint: 'TestData-DB Passwort', required: true },
          { name: 'ZEUS_TESTDATA_DB_URL', hint: 'TestData-DB JDBC-URL (optional)', required: false },
        ] : []),
        ...(hasFetch ? FETCH_ENV_VARS : []),
        ...(!hasDb && !hasFetch ? DB_ENV_VARS : []),
      ];
      for (const { name: varName, hint, required } of envVarsToCheck) {
        const status = checkEnvStatus(varName);
        const req = required ? '' : ' (optional)';
        console.log(`      ${status.padEnd(20)} ${varName}${req}  # ${hint}`);
      }
    }
    console.log('');
  }

  if (!filterName) {
    console.log(`${toShow.length} Profil(e) gefunden.`);
  }

  const json = createJsonOutput(args);
  if (json.isJsonMode) {
    const jsonProfiles = {};
    for (const name of toShow) {
      jsonProfiles[name] = profiles[name];
    }
    json.print({ profiles: jsonProfiles, count: toShow.length });
  }
}

module.exports = { runProfiles };
