'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveProfile } = require('../config/runtimeConfig');
const {
  loadResourceConfiguration,
  resolveResourceJobProfile,
  validateResourceCatalog,
  connectionIdentity,
  planResourceJob,
  safeOutput,
  resolveResourceValue,
} = require('../config/resourceAccessPlan');
const {
  sanitizeValue,
  collectSecretTermsFromEnv,
  collectSensitiveTermsFromEnv,
  maskSecretsInText,
} = require('../security/secretMasking');
const { validateJdbcConnectionConfig } = require('../jdbc/readOnlyJdbcQueryService');

const PURPOSES = {
  sourceCode: 'Copy exact source members into new local files',
  objects: 'Read object metadata without invoking programs',
  metadata: 'Read table column definitions, not business rows',
  data: 'Read explicitly approved bounded and masked samples',
};
const SELECTORS = {
  sourceCode: ['sourceFiles', 'members'],
  objects: ['libraries', 'objectTypes', 'objects'],
  metadata: ['schemas', 'tables'],
  data: ['schemas', 'tables', 'columns'],
};
const GLOBAL_KEYS = new Set(['contextOptimizer', 'testData', 'analysisLimits', 'presets']);
function deny(code) {
  throw Object.assign(new Error(code), { code });
}
function refs(value) {
  return [
    ...new Set(
      [...JSON.stringify(value || {}).matchAll(/\$\{env:([A-Z0-9_]+)\}/gi)].map(match => match[1])
    ),
  ].sort((left, right) => left.localeCompare(right, 'en'));
}
function loadingArgs(args) {
  return ['config', 'base-config', 'env-files'].flatMap(key =>
    args[key] ? [`--${key}`, args[key]] : []
  );
}
function invocation(args, profile) {
  return {
    command: 'resources',
    argv: [
      'resources',
      ...loadingArgs(args),
      '--profile',
      profile,
      '--wizard',
      '--out',
      '<workspace-relative-job.json>',
    ],
    missingInputs: ['resource selection', 'exact selectors', 'job output path'],
    executionStarted: false,
  };
}
function candidates(cwd) {
  const relative = [
    'config/local-only/profiles.json',
    'config/profiles.json',
    'config/profiles.example.json',
  ];
  return relative.map(file => ({
    path: path.resolve(cwd, file),
    exists: fs.existsSync(path.resolve(cwd, file)),
  }));
}
function envCandidates(cwd) {
  const directory = path.resolve(cwd, 'config/local-only');
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter(file => /^\.env(?:\.[a-z0-9_-]+)?\.local$/i.test(file))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .slice(0, 100)
    .map(file => path.join(directory, file));
}
function resourceView(ref, entry, raw, configuration, terms, secretTerms) {
  const connection = entry.system
    ? raw.systems?.[entry.system]
    : raw.jdbcConnections?.[entry.connection];
  const requiredEnv = refs(connection);
  const missingEnv = requiredEnv.filter(key => !configuration.env[key]);
  let targetFingerprint = null;
  let code = null;
  if (!connection) code = 'RESOURCE_CONNECTION_UNKNOWN';
  else if (missingEnv.length) code = 'RESOURCE_ENV_REFERENCE_MISSING';
  else {
    try {
      const resolved = resolveResourceValue(connection, configuration.env);
      ['host', 'url', 'user', 'password']
        .map(key => resolved[key])
        .filter(Boolean)
        .forEach(value => terms.add(String(value)));
      if (resolved.password) secretTerms.add(String(resolved.password));
      if (entry.connection) validateJdbcConnectionConfig(resolved);
      if (!resolved.user || !resolved.password) code = 'RESOURCE_CONNECTION_INCOMPLETE';
      targetFingerprint = connectionIdentity(resolved);
    } catch {
      code = 'RESOURCE_CONNECTION_INVALID';
    }
  }
  const scope = Object.fromEntries(
    [
      'library',
      'libraries',
      'sourceFiles',
      'members',
      'schemas',
      'tables',
      'objectTypes',
      'columns',
      'maskColumns',
    ]
      .filter(key => entry[key] !== undefined)
      .map(key => [key, entry[key]])
  );
  return {
    ref,
    kind: entry.kind,
    purpose: PURPOSES[entry.kind],
    target: entry.system || entry.connection,
    scope,
    limits: {
      maxRows: entry.maxRows || 50,
      maxMembers: entry.maxMembers || 50,
      maxRequests: entry.maxRequests || 50,
    },
    requiredSelectors: SELECTORS[entry.kind],
    investigation: {
      supported: entry.kind === 'data',
      mode: 'structured-select-session',
      executor: 'cli-only',
      approval: 'not-granted',
      grantExportable: false,
    },
    requiredEnv,
    missingEnv,
    targetFingerprint,
    readiness: {
      configured: !code,
      localValidation: code ? 'blocked' : 'valid',
      live: 'not-checked',
      approval: 'not-granted',
    },
    enabled: entry.enabled !== false,
    failureCode: code,
  };
}
function profileView(name, configuration, args, terms, secretTerms) {
  try {
    const raw = resolveProfile(configuration.profiles, name, {
      env: configuration.env,
      expandEnvPlaceholders: false,
    });
    for (const connection of [
      ...Object.values(raw.systems || {}),
      ...Object.values(raw.jdbcConnections || {}),
    ]) {
      if (connection.password) {
        try {
          secretTerms.add(String(resolveResourceValue(connection.password, configuration.env)));
        } catch {
          continue;
        }
      }
    }
    if (!raw.resourceCatalog)
      return {
        name,
        mode: raw.fetch || raw.db || raw.dbRoles ? 'legacy' : 'local-only',
        resources: [],
        status: 'no-resource-catalog',
        warning:
          'No fixed resource catalog. Legacy remote settings may be environment-routed; local analysis settings are not a remote access grant.',
      };
    const catalog = resolveResourceValue(raw.resourceCatalog, configuration.env);
    validateResourceCatalog(catalog);
    const resources = Object.entries(catalog)
      .filter(([, entry]) => !args.kind || entry.kind === args.kind)
      .map(([ref, entry]) => resourceView(ref, entry, raw, configuration, terms, secretTerms));
    const parent = configuration.profiles[name].extends;
    const replacement =
      typeof parent === 'string' && configuration.profiles[parent]?.resourceCatalog ? parent : null;
    return {
      name,
      mode: 'resource-catalog',
      status: resources.some(resource => resource.readiness.configured && resource.enabled)
        ? 'configured'
        : 'needs-attention',
      replacement,
      resources,
      nextCommand: invocation(args, name),
    };
  } catch {
    return {
      name,
      mode: 'unresolved',
      status: 'blocked',
      resources: [],
      failureCode: 'RESOURCE_PROFILE_INVALID',
    };
  }
}

function sanitizeResourceDiscovery(discovery, { sensitiveTerms = [], secretTerms = [] } = {}) {
  const terms = [...sensitiveTerms, ...secretTerms];
  const sanitized = sanitizeValue(discovery, { sensitiveTerms: terms });
  if (discovery?.kind !== 'resource-discovery' || !Array.isArray(discovery.profiles))
    return sanitized;
  const identifier = value => {
    if (Array.isArray(value)) return value.map(identifier);
    if (typeof value !== 'string' || !/^[A-Z_#$@][A-Z0-9_#$@]{0,127}$/i.test(value))
      return sanitizeValue(value, { sensitiveTerms: terms });
    if (secretTerms.some(term => term && value.includes(term))) return '[REDACTED]';
    return sanitizeValue(value, { sensitiveTerms: secretTerms });
  };
  for (const [profileIndex, profile] of discovery.profiles.entries()) {
    for (const [resourceIndex, resource] of (profile.resources || []).entries()) {
      const fields =
        {
          sourceCode: ['library'],
          objects: ['libraries'],
          metadata: ['schemas'],
          data: ['schemas'],
        }[resource.kind] || [];
      const scope = sanitized.profiles[profileIndex].resources[resourceIndex].scope;
      for (const field of fields) {
        if (resource.scope?.[field] !== undefined) scope[field] = identifier(resource.scope[field]);
      }
    }
  }
  return sanitized;
}

function discoverResources(args = {}, { cwd = process.cwd(), env = process.env } = {}) {
  if (args.kind && !Object.hasOwn(PURPOSES, args.kind)) deny('RESOURCE_KIND_INVALID');
  if (!args.config)
    return sanitizeValue(
      {
        schemaVersion: 1,
        kind: 'resource-discovery',
        status: 'needs-selection',
        readOnly: true,
        executionStarted: false,
        configuration: {
          candidates: candidates(cwd),
          baseCandidate: path.resolve(cwd, 'config/profiles.example.json'),
          envCandidates: envCandidates(cwd),
          automaticSelection: false,
        },
        profiles: [],
        missingInputs: [
          'absolute --config',
          'optional explicit --base-config',
          'ordered --env-files',
        ],
      },
      { sensitiveTerms: collectSensitiveTermsFromEnv(env) }
    );
  const configuration = loadResourceConfiguration(args, { cwd, env });
  const names = Object.keys(configuration.profiles)
    .filter(name => !name.startsWith('_') && !GLOBAL_KEYS.has(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const profileInventory = { count: names.length, names: [...names] };
  if (names.length > 200) deny('RESOURCE_DISCOVERY_LIMIT_EXCEEDED');
  if (args.profile && !names.includes(args.profile)) deny('RESOURCE_PROFILE_REQUIRED');
  const terms = new Set(collectSensitiveTermsFromEnv(configuration.env));
  const secretTerms = new Set(collectSecretTermsFromEnv(configuration.env));
  const profiles = names
    .filter(name => !args.profile || name === args.profile)
    .map(name => profileView(name, configuration, args, terms, secretTerms));
  return sanitizeResourceDiscovery(
    {
      schemaVersion: 1,
      kind: 'resource-discovery',
      status: profiles.some(profile => profile.status === 'configured')
        ? 'configured'
        : 'needs-attention',
      readOnly: true,
      executionStarted: false,
      remoteMutation: false,
      configuration: {
        configSources: configuration.configSources,
        envFiles: configuration.envFiles,
        precedence: 'explicit-files-only; env-files-left-to-right; no-legacy-overrides',
      },
      profiles,
      profileInventory,
    },
    { sensitiveTerms: [...terms], secretTerms: [...secretTerms] }
  );
}

function profileSensitiveTerms(profile, env) {
  const connections = [
    ...Object.values(profile.systems || {}),
    ...Object.values(profile.jdbcConnections || {}),
  ];
  return [
    ...collectSensitiveTermsFromEnv(env),
    ...connections.flatMap(connection =>
      ['host', 'url', 'user', 'password'].map(field => connection[field]).filter(Boolean)
    ),
  ].map(String);
}

function prepareResourceJob(args, job, { cwd = process.cwd(), env = process.env } = {}) {
  const configuration = loadResourceConfiguration(args, { cwd, env });
  const profile = resolveResourceJobProfile(configuration, args.profile, job.resources);
  const plan = planResourceJob({
    profile,
    job,
    cwd,
    configPath: fs.realpathSync(args.config),
    profileName: args.profile,
    configSources: configuration.configSources,
    envFiles: configuration.envFiles,
  });
  const serialized = `${JSON.stringify(job, null, 2)}\n`;
  const terms = profileSensitiveTerms(profile, configuration.env);
  if (maskSecretsInText(serialized) !== serialized) deny('RESOURCE_JOB_DISCLOSURE_DENIED');
  if (sanitizeValue(job.goal, { sensitiveTerms: terms }) !== job.goal)
    deny('RESOURCE_JOB_DISCLOSURE_DENIED');
  let jobPath = null;
  if (args.out) {
    jobPath = safeOutput(cwd, args.out);
    const destination = path.resolve(cwd, jobPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try {
      fs.writeFileSync(destination, serialized, { flag: 'wx' });
    } catch (error) {
      deny(error.code === 'EEXIST' ? 'RESOURCE_OUTPUT_EXISTS' : 'RESOURCE_JOB_WRITE_FAILED');
    }
  }
  return sanitizeValue(
    {
      schemaVersion: 1,
      kind: 'resource-job-preview',
      status: 'planned',
      plan,
      jobPath,
      executionStarted: false,
      approvalRequired: true,
      nextCommand: jobPath
        ? {
            command: 'resources',
            argv: [
              'resources',
              ...loadingArgs(args),
              '--profile',
              args.profile,
              '--job',
              path.resolve(cwd, jobPath),
            ],
            executionStarted: false,
          }
        : null,
      executionCommand: jobPath
        ? {
            command: 'resources',
            argv: [
              'resources',
              ...loadingArgs(args),
              '--profile',
              args.profile,
              '--job',
              path.resolve(cwd, jobPath),
              '--execute',
              '--approve-plan',
              plan.planHash,
            ],
            requiresExplicitApproval: true,
          }
        : null,
    },
    { sensitiveTerms: terms }
  );
}

async function choose(ask, label, values, display = value => value) {
  const choices = values.map((value, index) => `  ${index + 1}. ${display(value)}`).join('\n');
  const answer = await ask(`${label}\n${choices}\nSelect numbers, comma-separated: `);
  const indices = String(answer)
    .split(',')
    .map(value => Number(value.trim()));
  if (
    !indices.length ||
    indices.some(index => !Number.isInteger(index) || index < 1 || index > values.length)
  )
    deny('RESOURCE_SELECTION_INVALID');
  return [...new Set(indices)].map(index => values[index - 1]);
}
async function selectionFor(ask, ref, entry) {
  const selection = { ref };
  await SELECTORS[entry.kind].reduce(async (previous, field) => {
    await previous;
    if (entry[field]) selection[field] = await choose(ask, `${ref}: ${field}`, entry[field]);
    else
      selection[field] = String(await ask(`${ref}: exact ${field}, comma-separated: `))
        .split(',')
        .map(value => value.trim());
  }, Promise.resolve());
  if (entry.kind !== 'sourceCode') {
    const answer = String(
      await ask(`${ref}: max rows [${Math.min(entry.maxRows || 50, 50)}]: `)
    ).trim();
    selection.maxRows = answer ? Number(answer) : Math.min(entry.maxRows || 50, 50);
  }
  return selection;
}
async function collectResourceJob(args, { ask, cwd = process.cwd(), env = process.env } = {}) {
  const discovery = discoverResources(args, { cwd, env });
  const usable = discovery.profiles.filter(profile => profile.mode === 'resource-catalog');
  if (!usable.length) deny('RESOURCE_PROFILE_REQUIRED');
  const selectedProfiles = args.profile
    ? usable
    : await choose(ask, 'Profile', usable, profile => profile.name);
  if (selectedProfiles.length !== 1) deny('RESOURCE_PROFILE_REQUIRED');
  const profileName = selectedProfiles[0].name;
  const configuration = loadResourceConfiguration(args, { cwd, env });
  const raw = resolveProfile(configuration.profiles, profileName, {
    env: configuration.env,
    expandEnvPlaceholders: false,
  });
  const catalog = resolveResourceValue(raw.resourceCatalog, configuration.env);
  validateResourceCatalog(catalog);
  const safeAsk = prompt =>
    ask(sanitizeValue(prompt, { sensitiveTerms: profileSensitiveTerms(raw, configuration.env) }));
  const choices = Object.entries(catalog).filter(
    ([, entry]) => entry.enabled !== false && (!args.kind || entry.kind === args.kind)
  );
  const selected = await choose(
    safeAsk,
    'Resources',
    choices,
    ([ref, entry]) => `${ref}: ${entry.kind} / ${entry.system || entry.connection}`
  );
  const resources = await selected.reduce(async (previous, [ref, entry]) => {
    const collected = await previous;
    return [...collected, await selectionFor(safeAsk, ref, entry)];
  }, Promise.resolve([]));
  const sourceSelected = selected.some(([, entry]) => entry.kind === 'sourceCode');
  const job = {
    schemaVersion: 1,
    goal: args.goal || 'Selected resource access',
    dataAccess: selected.some(([, entry]) => entry.kind === 'data') ? 'samples' : 'metadata-only',
    resources,
  };
  if (sourceSelected)
    job.outputRoot = await ask('New local source directory (workspace-relative): ');
  return prepareResourceJob({ ...args, profile: profileName }, job, { cwd, env });
}

module.exports = {
  discoverResources,
  sanitizeResourceDiscovery,
  prepareResourceJob,
  collectResourceJob,
};
