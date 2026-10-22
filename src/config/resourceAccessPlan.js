'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bindings = new WeakMap();
const KINDS = new Set(['sourceCode', 'objects', 'metadata', 'data']);
const OBJECT_TYPES = new Set(['*PGM', '*SRVPGM', '*MODULE', '*FILE', '*BNDDIR']);

function compareNames(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function deny(code) {
  throw Object.assign(new Error(code), { code });
}
function identifier(value) {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z][A-Za-z0-9_#$@]*$/.test(value))
    deny('RESOURCE_SCOPE_INVALID');
  return value;
}
function names(value) {
  if (!Array.isArray(value) || !value.length || value.length > 50) deny('RESOURCE_SCOPE_INVALID');
  return [...new Set(value.map(identifier))];
}
function ibmiNames(value) {
  if (value.some(name => name.length > 10 || name !== name.toUpperCase()))
    deny('RESOURCE_SCOPE_INVALID');
}
function subset(selected, allowed) {
  const list = names(selected);
  if (!Array.isArray(allowed) || list.some(value => !allowed.includes(value)))
    deny('RESOURCE_SCOPE_DENIED');
  return list;
}
function closed(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !fields.includes(key) && key !== '_comment')
  )
    deny('RESOURCE_FIELDS_INVALID');
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function connectionIdentity(config) {
  const raw = String(config.url || config.host || '');
  if (!raw || /\$\{env:/.test(raw)) deny('RESOURCE_CONNECTION_INCOMPLETE');
  try {
    const address = raw.replace(/^jdbc:(?:jtds:)?[a-z0-9]+:/i, '');
    const target = new URL(
      address.startsWith('//') ? `http:${address.split(';')[0]}` : `http://${address.split(';')[0]}`
    );
    const properties = raw
      .split(';')
      .slice(1)
      .filter(property =>
        /^(databaseName|database|schema|currentSchema|libraries|naming|instanceName)=/i.test(
          property
        )
      )
      .sort(compareNames);
    return crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          authority: `${target.hostname.toLowerCase()}:${target.port}${target.pathname}`,
          host: String(config.host || '').toLowerCase(),
          properties,
          driver: config.driver || null,
          defaultLibrary: config.defaultLibrary || null,
          defaultSchema: config.defaultSchema || null,
        })
      )
      .digest('hex');
  } catch {
    deny('RESOURCE_CONNECTION_INVALID');
  }
}
function safeOutput(cwd, relative) {
  if (
    typeof relative !== 'string' ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes('..')
  )
    deny('RESOURCE_OUTPUT_INVALID');
  const root = fs.realpathSync(cwd);
  const resolved = path.resolve(root, relative);
  const local = path.relative(root, resolved);
  if (!local || local.startsWith('..') || path.isAbsolute(local)) deny('RESOURCE_OUTPUT_INVALID');
  let cursor = root;
  for (const part of local.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink())
      deny('RESOURCE_OUTPUT_INVALID');
  }
  return local.split(path.sep).join('/');
}

function validateResourceCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog))
    deny('RESOURCE_CATALOG_INVALID');
  for (const [ref, entry] of Object.entries(catalog)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref)) deny('RESOURCE_REFERENCE_INVALID');
    validateCatalogEntry(entry);
  }
  return catalog;
}

function validateCatalogEntry(entry) {
  const fields = {
    sourceCode: ['library', 'sourceFiles', 'members', 'maxMembers'],
    objects: ['libraries', 'objectTypes', 'maxRows'],
    metadata: ['schemas', 'tables', 'maxRows'],
    data: ['schemas', 'tables', 'columns', 'maskColumns', 'maxRows'],
  };
  closed(entry, [
    'kind',
    'system',
    'connection',
    'enabled',
    'maxRequests',
    ...(fields[entry?.kind] || []),
  ]);
  if (!KINDS.has(entry.kind) || Boolean(entry.system) === Boolean(entry.connection))
    deny('RESOURCE_CATALOG_INVALID');
  if (typeof (entry.system || entry.connection) !== 'string') deny('RESOURCE_CATALOG_INVALID');
  for (const field of ['libraries', 'sourceFiles', 'members', 'schemas', 'tables', 'columns'])
    if (entry[field] !== undefined) names(entry[field]);
  if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean')
    deny('RESOURCE_CATALOG_INVALID');
  validateCatalogLimits(entry);
  const validators = {
    sourceCode: validateSourceScope,
    objects: validateObjectScope,
    metadata: validateTableScope,
    data: validateTableScope,
  };
  validators[entry.kind](entry);
}

function validateCatalogLimits(entry) {
  for (const field of ['maxRows', 'maxMembers', 'maxRequests']) {
    const value = entry[field];
    const maximum = field === 'maxRows' ? 500 : 50;
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > maximum))
      deny('RESOURCE_LIMIT_INVALID');
  }
}

function validateSourceScope(entry) {
  if (!entry.library || !entry.sourceFiles || !entry.system) deny('RESOURCE_CATALOG_INVALID');
  identifier(entry.library);
  ibmiNames([entry.library, ...entry.sourceFiles, ...(entry.members || [])]);
}

function validateObjectScope(entry) {
  if (
    !entry.libraries ||
    !entry.system ||
    !Array.isArray(entry.objectTypes) ||
    !entry.objectTypes.length
  )
    deny('RESOURCE_CATALOG_INVALID');
  if (entry.objectTypes.some(type => !OBJECT_TYPES.has(type))) deny('RESOURCE_CATALOG_INVALID');
  ibmiNames(entry.libraries);
}

function validateTableScope(entry) {
  if (!entry.schemas) deny('RESOURCE_CATALOG_INVALID');
  if (entry.kind !== 'data') return;
  if (!entry.tables || !entry.columns) deny('RESOURCE_DATA_POLICY_REQUIRED');
  if (
    !Array.isArray(entry.maskColumns) ||
    entry.maskColumns.some(column => !entry.columns.includes(column))
  )
    deny('RESOURCE_DATA_POLICY_REQUIRED');
}

function validateJob(job) {
  closed(job, ['schemaVersion', 'goal', 'resources', 'outputRoot', 'dataAccess']);
  if (
    !job.goal ||
    typeof job.goal !== 'string' ||
    job.goal.length > 500 ||
    !Array.isArray(job.resources) ||
    !job.resources.length ||
    job.resources.length > 20 ||
    (job.schemaVersion !== undefined && job.schemaVersion !== 1)
  )
    deny('RESOURCE_JOB_INVALID');
  if (job.dataAccess !== undefined && !['metadata-only', 'samples'].includes(job.dataAccess))
    deny('RESOURCE_JOB_INVALID');
}

function buildSourceJobScope({ entry, selected, output }) {
  if (!output) deny('RESOURCE_OUTPUT_REQUIRED');
  const scope = {
    library: entry.library,
    sourceFiles: subset(selected.sourceFiles, entry.sourceFiles),
    members: entry.members ? subset(selected.members, entry.members) : names(selected.members),
    outputRoot: `${output}/${selected.ref}/${entry.library}`,
  };
  ibmiNames(scope.members);
  if (scope.members.length > (entry.maxMembers || 50)) deny('RESOURCE_LIMIT_EXCEEDED');
  return { scope, requests: scope.sourceFiles.length * scope.members.length };
}

function buildObjectJobScope({ entry, selected }) {
  if (
    !Array.isArray(selected.objectTypes) ||
    !selected.objectTypes.length ||
    selected.objectTypes.some(type => !entry.objectTypes.includes(type))
  )
    deny('RESOURCE_SCOPE_DENIED');
  const scope = {
    libraries: subset(selected.libraries, entry.libraries),
    objectTypes: [...new Set(selected.objectTypes)],
    objects: names(selected.objects),
  };
  ibmiNames(scope.objects);
  return {
    scope,
    requests: scope.libraries.length * scope.objectTypes.length * scope.objects.length,
  };
}

function buildTableJobScope({ entry, selected, job }) {
  const scope = {
    schemas: subset(selected.schemas, entry.schemas),
    tables: entry.tables ? subset(selected.tables, entry.tables) : names(selected.tables),
  };
  if (entry.kind === 'data') {
    if (job.dataAccess !== 'samples') deny('RESOURCE_DATA_APPROVAL_REQUIRED');
    scope.columns = subset(selected.columns, entry.columns);
    scope.maskColumns = entry.maskColumns;
  }
  return { scope, requests: scope.schemas.length * scope.tables.length };
}

function selectRowLimit(entry, selected) {
  const limit =
    selected.maxRows === undefined ? Math.min(entry.maxRows || 50, 50) : selected.maxRows;
  if (!Number.isInteger(limit) || limit < 1 || limit > (entry.maxRows || 50))
    deny('RESOURCE_LIMIT_EXCEEDED');
  return limit;
}

function planSelection(profile, catalog, selected, output, job) {
  closed(selected, [
    'ref',
    'sourceFiles',
    'members',
    'libraries',
    'objectTypes',
    'objects',
    'schemas',
    'tables',
    'columns',
    'maxRows',
  ]);
  const entry = Object.hasOwn(catalog, selected.ref) ? catalog[selected.ref] : null;
  if (!entry) deny('RESOURCE_REFERENCE_UNKNOWN');
  const fields = {
    sourceCode: ['sourceFiles', 'members'],
    objects: ['libraries', 'objectTypes', 'objects'],
    metadata: ['schemas', 'tables'],
    data: ['schemas', 'tables', 'columns'],
  };
  closed(selected, [
    'ref',
    ...(entry.kind === 'sourceCode' ? [] : ['maxRows']),
    ...fields[entry.kind],
  ]);
  if (entry.enabled === false) deny('RESOURCE_DISABLED');
  const connection = entry.system
    ? profile.systems?.[entry.system]
    : profile.jdbcConnections?.[entry.connection];
  if (!connection) deny('RESOURCE_CONNECTION_UNKNOWN');
  if (!connection.user || !connection.password) deny('RESOURCE_CONNECTION_INCOMPLETE');
  const identity = connectionIdentity(connection);
  const builders = {
    sourceCode: buildSourceJobScope,
    objects: buildObjectJobScope,
    metadata: buildTableJobScope,
    data: buildTableJobScope,
  };
  const { scope, requests } = builders[entry.kind]({ entry, selected, output, job });
  if (entry.kind !== 'sourceCode') scope.maxRows = selectRowLimit(entry, selected);
  if (requests > (entry.maxRequests || 50)) deny('RESOURCE_LIMIT_EXCEEDED');
  return {
    operation: {
      ref: selected.ref,
      kind: entry.kind,
      system: entry.system || null,
      connection: entry.connection || null,
      targetFingerprint: identity,
      scope,
      requests,
    },
    binding: { config: freeze(structuredClone(connection)), identity },
  };
}

function planResourceJob({
  profile,
  job,
  cwd = process.cwd(),
  configPath,
  profileName,
  configSources = [],
  envFiles = [],
  jobFileHash = null,
}) {
  validateJob(job);
  if (jobFileHash !== null && !/^[a-f0-9]{64}$/.test(jobFileHash)) deny('RESOURCE_JOB_INVALID');
  const catalog = validateResourceCatalog(profile.resourceCatalog);
  const output = job.outputRoot ? safeOutput(cwd, job.outputRoot) : null;
  const selections = job.resources.map(selected =>
    planSelection(profile, catalog, selected, output, job)
  );
  const operations = selections.map(selection => selection.operation);
  const privateEntries = selections.map(selection => selection.binding);
  if (operations.reduce((total, operation) => total + operation.requests, 0) > 100)
    deny('RESOURCE_LIMIT_EXCEEDED');
  const publicPlan = {
    schemaVersion: 1,
    kind: 'resource-access-plan',
    goal: job.goal,
    dataAccess: job.dataAccess || 'metadata-only',
    profile: profileName || null,
    configPath: configPath || null,
    configSources,
    envFiles,
    jobFileHash,
    workspace: fs.realpathSync(cwd),
    systems: [
      ...new Set(operations.map(operation => operation.system || operation.connection)),
    ].sort(compareNames),
    operations,
    connectionValidation: 'existing-read-only-guards',
    remoteMutation: false,
    localArtifactWrite: operations.some(operation => operation.kind === 'sourceCode'),
    approvalRequired: true,
  };
  const serialized = JSON.stringify(publicPlan);
  if (
    privateEntries.some(entry =>
      [entry.config.password, entry.config.url]
        .filter(value => typeof value === 'string' && value.length > 2)
        .some(value => serialized.includes(value))
    )
  )
    deny('RESOURCE_PLAN_DISCLOSURE_DENIED');
  const plan = freeze({
    ...publicPlan,
    planHash: crypto.createHash('sha256').update(JSON.stringify(publicPlan)).digest('hex'),
  });
  bindings.set(plan, { entries: privateEntries, cwd: fs.realpathSync(cwd) });
  return plan;
}

function approveResourceJob(plan, approve) {
  const binding = bindings.get(plan);
  if (!binding) deny('RESOURCE_PLAN_INVALID');
  if (approve !== plan.planHash) deny('RESOURCE_PLAN_APPROVAL_REQUIRED');
  for (const [index, operation] of plan.operations.entries())
    if (connectionIdentity(binding.entries[index].config) !== operation.targetFingerprint)
      deny('RESOURCE_PLAN_INVALID');
  return binding;
}

function resourceBindingFingerprint(plan) {
  const binding = approveResourceJob(plan, plan.planHash);
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareNames)
        .map(key => [key, canonical(value[key])])
    );
  };
  const files = [
    ...plan.configSources,
    ...plan.envFiles.map(entry => (typeof entry === 'string' ? entry : entry.file)),
  ];
  if (files.length > 32) deny('RESOURCE_INPUT_LIMIT_EXCEEDED');
  const fingerprints = files.map(file => {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
      deny('RESOURCE_INPUT_INVALID');
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  });
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        planHash: plan.planHash,
        entries: canonical(binding.entries),
        fingerprints,
      })
    )
    .digest('hex');
}

module.exports = {
  validateResourceCatalog,
  planResourceJob,
  approveResourceJob,
  safeOutput,
  resourceBindingFingerprint,
};

function loadResourceConfiguration(args, { cwd = process.cwd(), env = process.env } = {}) {
  if (typeof args.config !== 'string' || !path.isAbsolute(args.config))
    deny('RESOURCE_FILES_EXPLICIT_REQUIRED');
  const { loadExplicitEnvFiles } = require('./envFileLoader');
  const files = typeof args['env-files'] === 'string' ? args['env-files'].split(',') : [];
  const loaded = files.length
    ? loadExplicitEnvFiles(files, { env })
    : { env: { ...env }, files: [] };
  const { loadProfiles } = require('./runtimeConfig');
  const { mergeConfigLayers } = require('./runtimeConfigCore');
  const readProfiles = file => {
    if (
      !path.isAbsolute(file) ||
      !fs.lstatSync(file).isFile() ||
      fs.lstatSync(file).isSymbolicLink() ||
      fs.statSync(file).size > 1024 * 1024
    )
      deny('RESOURCE_FILES_EXPLICIT_REQUIRED');
    return loadProfiles({ cwd, env: loaded.env, args: { config: file }, exactFile: true });
  };
  const profiles = args['base-config']
    ? mergeConfigLayers(readProfiles(args['base-config']), readProfiles(args.config))
    : readProfiles(args.config);
  return {
    profiles,
    env: loaded.env,
    envFiles: loaded.files,
    configSources: [args['base-config'], args.config]
      .filter(Boolean)
      .map(file => fs.realpathSync(file)),
    baseConfig: args['base-config'] ? fs.realpathSync(args['base-config']) : null,
  };
}

function loadResourceJob(args, { cwd = process.cwd(), env = process.env } = {}) {
  if (typeof args.job !== 'string' || !path.isAbsolute(args.job))
    deny('RESOURCE_FILES_EXPLICIT_REQUIRED');
  const {
    profiles,
    env: selectedEnv,
    envFiles,
    configSources,
    baseConfig,
  } = loadResourceConfiguration(args, { cwd, env });
  if (!args.profile || !profiles[args.profile]) deny('RESOURCE_PROFILE_REQUIRED');
  const jobStat = fs.lstatSync(args.job);
  if (!jobStat.isFile() || jobStat.isSymbolicLink() || jobStat.size > 1024 * 1024)
    deny('RESOURCE_JOB_INVALID');
  const jobBytes = fs.readFileSync(args.job);
  if (jobBytes.length > 1024 * 1024) deny('RESOURCE_JOB_INVALID');
  const job = JSON.parse(jobBytes.toString('utf8'));
  const jobFileHash = crypto.createHash('sha256').update(jobBytes).digest('hex');
  const profile = resolveResourceJobProfile(
    { profiles, env: selectedEnv },
    args.profile,
    job.resources
  );
  const plan = planResourceJob({
    profile,
    job,
    cwd,
    configPath: fs.realpathSync(args.config),
    profileName: args.profile,
    configSources,
    envFiles,
    jobFileHash,
  });
  return { plan, envFiles, baseConfig };
}

function resolveResourceJobProfile({ profiles, env }, profileName, resources) {
  const { resolveProfile } = require('./runtimeConfig');
  if (!profileName || !profiles[profileName]) deny('RESOURCE_PROFILE_REQUIRED');
  const raw = resolveProfile(profiles, profileName, {
    env,
    expandEnvPlaceholders: false,
  });
  const selected = (resources || [])
    .map(selection => raw.resourceCatalog?.[selection.ref])
    .filter(Boolean);
  for (const entry of selected) {
    const rawConnection = entry.system
      ? raw.systems?.[entry.system]
      : raw.jdbcConnections?.[entry.connection];
    const refs = [...JSON.stringify(rawConnection || {}).matchAll(/\$\{env:([A-Z0-9_]+)\}/gi)].map(
      match => match[1]
    );
    if (refs.some(key => !env[key])) deny('RESOURCE_ENV_REFERENCE_MISSING');
  }
  return resolveProfile(profiles, profileName, { env });
}

module.exports.connectionIdentity = connectionIdentity;
module.exports.resolveResourceValue = (value, env) =>
  require('./runtimeConfigEnv').resolveEnvPlaceholdersDeep(value, env);
module.exports.resolveResourceJobProfile = resolveResourceJobProfile;
module.exports.loadResourceConfiguration = loadResourceConfiguration;
module.exports.loadResourceJob = loadResourceJob;
