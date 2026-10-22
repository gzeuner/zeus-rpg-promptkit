'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadResourceConfiguration, safeOutput } = require('../config/resourceAccessPlan');
const { resolveProfile, resolveProfilesConfigPaths } = require('../config/runtimeConfig');
const {
  discoverResources,
  sanitizeResourceDiscovery,
} = require('../core/resourceDiscoveryService');
const {
  collectSensitiveTermsFromEnv,
  collectSecretTermsFromEnv,
  sanitizeValue,
} = require('../security/secretMasking');
const { UiActionError } = require('./localUiActionService');

function profileSelection(profiles, names) {
  const defaults = names.filter(name => profiles[name]?.guiDefault === true);
  if (defaults.length > 1) return { profile: '', reason: 'ambiguous-default' };
  if (defaults.length === 1) return { profile: defaults[0], reason: 'configured-default' };
  if (names.length === 1) return { profile: names[0], reason: 'only-profile' };
  return { profile: '', reason: names.length ? 'choose-profile' : 'no-profiles' };
}

function configurationObject(value, keys) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every(key => keys.includes(key))
  );
}

function profileSummaries(profiles, names, env) {
  return names.map(name => {
    try {
      const profile = resolveProfile(profiles, name, { env, expandEnvPlaceholders: false });
      const purposes = new Set();
      if (profile.sourceRoot) purposes.add('local-analysis');
      if (profile.fetch && profile.fetch.enabled !== false) purposes.add('source-import');
      if (profile.db || profile.dbRoles || Object.keys(profile.jdbcConnections || {}).length)
        purposes.add('database');
      const resourcePurposes = {
        sourceCode: 'source-import',
        objects: 'object-metadata',
        metadata: 'table-metadata',
        data: 'sample-data',
      };
      for (const resource of Object.values(profile.resourceCatalog || {})) {
        if (resource.enabled !== false && resourcePurposes[resource.kind])
          purposes.add(resourcePurposes[resource.kind]);
      }
      return { name, purposes: [...purposes], resolved: true };
    } catch {
      return { name, purposes: [], resolved: false };
    }
  });
}

function createUiConfigurationService({
  cwd = process.cwd(),
  env = process.env,
  sensitiveTerms = [],
} = {}) {
  let selection = null;
  let blocked = false;
  const baseEnv = { ...env };
  const secretTerms = new Set(collectSecretTermsFromEnv(baseEnv));

  function filePath(value) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f,]/.test(value)) {
      throw new UiActionError('Enter a workspace file path.', 400);
    }
    const absolute = path.resolve(cwd, value.trim());
    safeOutput(cwd, path.relative(cwd, absolute));
    return absolute;
  }

  function catalogEntry(entry, ids) {
    if (
      !configurationObject(entry, ['id', 'label', 'profile', 'config', 'baseConfig', 'envFiles']) ||
      typeof entry.id !== 'string' ||
      !/^[a-z][a-z0-9._-]{0,63}$/.test(entry.id) ||
      ids.has(entry.id) ||
      !['label', 'profile'].every(
        key => typeof entry[key] === 'string' && /^[^\u0000-\u001f]{1,128}$/.test(entry[key])
      ) ||
      entry.profile.startsWith('_') ||
      (entry.envFiles !== undefined &&
        (!Array.isArray(entry.envFiles) || entry.envFiles.length > 20))
    ) {
      throw new Error('invalid');
    }
    ids.add(entry.id);
    return {
      id: entry.id,
      label: entry.label,
      profile: entry.profile,
      config: filePath(entry.config),
      baseConfig: entry.baseConfig === undefined ? undefined : filePath(entry.baseConfig),
      envFiles: (entry.envFiles || []).map(filePath),
    };
  }

  function configurationCatalog() {
    const file = path.join(cwd, 'config', 'local-only', 'ui-configurations.json');
    let stat;
    try {
      stat = fs.lstatSync(file);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new UiActionError('Configuration catalog is unavailable.', 400);
    }
    try {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('invalid');
      const content = fs.readFileSync(filePath(file), 'utf8');
      const catalog = JSON.parse(content);
      if (
        !configurationObject(catalog, ['schemaVersion', 'configurations']) ||
        catalog.schemaVersion !== 1 ||
        !Array.isArray(catalog.configurations) ||
        !catalog.configurations.length ||
        catalog.configurations.length > 32
      ) {
        throw new Error('invalid');
      }
      const ids = new Set();
      return {
        file,
        version: crypto.createHash('sha256').update(content).digest('hex'),
        entries: catalog.configurations.map(entry => catalogEntry(entry, ids)),
      };
    } catch {
      throw new UiActionError('Configuration catalog is invalid. Review its local file.', 400);
    }
  }

  function namedConfiguration(payload) {
    if (!configurationObject(payload, ['configurationId', 'configurationCatalogVersion']))
      throw new UiActionError('Select a configuration without overriding its files.', 400);
    const catalog = configurationCatalog();
    if (!catalog || catalog.version !== payload.configurationCatalogVersion)
      throw new UiActionError('Configuration catalog changed. Refresh configurations.', 409);
    const entry = catalog.entries.find(item => item.id === payload.configurationId);
    if (!entry) throw new UiActionError('Choose an available configuration.', 400);
    return { catalog, entry };
  }

  function sourceView(config) {
    return {
      config: path.relative(cwd, config).split(path.sep).join('/'),
      kind: /\.example\.json$/i.test(config) ? 'example' : 'personal',
    };
  }

  function configurationSources() {
    const sources = new Map();
    const paths = resolveProfilesConfigPaths({ cwd, env: baseEnv });
    const directories = new Set([
      path.join(cwd, 'config'),
      path.join(cwd, 'config', 'local-only'),
      paths.configDir,
    ]);
    for (const directory of directories) {
      let handle;
      try {
        filePath(directory);
        if (fs.lstatSync(directory).isSymbolicLink()) continue;
        handle = fs.opendirSync(directory);
        for (let inspected = 0; inspected < 512 && sources.size < 100; inspected += 1) {
          const entry = handle.readSync();
          if (!entry) break;
          if (!entry.isFile() || !/^profiles(?:\.[a-z0-9._-]+)?\.json$/i.test(entry.name)) continue;
          const file = filePath(path.join(directory, entry.name));
          if (fs.lstatSync(file).size > 1024 * 1024) continue;
          sources.set(file, sourceView(file));
        }
      } catch {
        continue;
      } finally {
        if (handle) handle.closeSync();
      }
    }
    return [...sources.values()].sort(
      (left, right) =>
        Number(left.kind === 'example') - Number(right.kind === 'example') ||
        left.config.localeCompare(right.config, 'en')
    );
  }

  function personalConfiguration() {
    const paths = resolveProfilesConfigPaths({ cwd, env: baseEnv });
    const config =
      paths.attemptedPaths.find(file => !/\.example\.json$/i.test(file) && fs.existsSync(file)) ||
      paths.attemptedPaths.find(file => /\.example\.json$/i.test(file) && fs.existsSync(file));
    if (!config) return null;
    const args = { config };
    const configuration = loadResourceConfiguration(args, { cwd, env: baseEnv });
    protect(configuration);
    return {
      args,
      configuration,
      discovery: discoverResources(args, { cwd, env: baseEnv }),
    };
  }

  function fingerprint(args, catalogFile = null, catalogVersion = null) {
    return crypto
      .createHash('sha256')
      .update(
        JSON.stringify(
          [
            catalogFile,
            args['base-config'],
            args.config,
            ...String(args['env-files'] || '').split(','),
          ]
            .filter(Boolean)
            .map(file => {
              filePath(file);
              const stat = fs.lstatSync(file);
              if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
                throw new UiActionError('Selected files must be bounded regular files.', 400);
              }
              const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
              if (file === catalogFile && hash !== catalogVersion)
                throw new UiActionError(
                  'Configuration catalog changed. Refresh configurations.',
                  409
                );
              return [file, hash];
            })
        )
      )
      .digest('hex');
  }

  function protectConnection(connection, terms) {
    if (connection.password) secretTerms.add(String(connection.password));
    for (const key of ['host', 'url', 'user', 'password']) {
      if (typeof connection[key] === 'string' && connection[key]) terms.add(connection[key]);
    }
  }

  function protect(configuration, names) {
    const terms = new Set(collectSensitiveTermsFromEnv(configuration.env));
    collectSecretTermsFromEnv(configuration.env).forEach(term => {
      secretTerms.add(term);
      terms.add(term);
    });
    for (const name of names ||
      Object.keys(configuration.profiles).filter(name => !name.startsWith('_'))) {
      try {
        const profile = resolveProfile(configuration.profiles, name, { env: configuration.env });
        for (const connection of [
          ...Object.values(profile.systems || {}),
          ...Object.values(profile.jdbcConnections || {}),
          profile.db,
          profile.fetch,
        ].filter(Boolean)) {
          protectConnection(connection, terms);
        }
      } catch {
        continue;
      }
    }
    sensitiveTerms.push(...[...terms].filter(term => !sensitiveTerms.includes(term)));
  }

  function select(payload) {
    blocked = true;
    selection = null;
    try {
      let named = null;
      if (payload && Object.hasOwn(payload, 'configurationId')) {
        named = namedConfiguration(payload);
        payload = named.entry;
        payload = {
          config: payload.config,
          baseConfig: payload.baseConfig,
          envFiles: payload.envFiles,
        };
      }
      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        Object.keys(payload).some(key => !['config', 'baseConfig', 'envFiles'].includes(key)) ||
        (payload.envFiles !== undefined &&
          (!Array.isArray(payload.envFiles) || payload.envFiles.length > 20))
      ) {
        throw new UiActionError(
          'Use config, optional baseConfig and an ordered envFiles list.',
          400
        );
      }
      const args = { config: filePath(payload.config) };
      if (payload.baseConfig) args['base-config'] = filePath(payload.baseConfig);
      if (payload.envFiles?.length) args['env-files'] = payload.envFiles.map(filePath).join(',');
      const catalogFile = named?.catalog.file || null;
      const catalogVersion = named?.catalog.version || null;
      const hash = fingerprint(args, catalogFile, catalogVersion);
      const configuration = loadResourceConfiguration(args, { cwd, env: baseEnv });
      protect(configuration, named ? [named.entry.profile] : undefined);
      const discovery = discoverResources(
        named ? { ...args, profile: named.entry.profile } : args,
        { cwd, env: baseEnv }
      );
      if (named) {
        const profile = named.entry.profile;
        if (!discovery.profileInventory.names.includes(profile))
          throw new UiActionError('The configuration profile is unavailable.', 400);
        discovery.profileInventory = { count: 1, names: [profile] };
        discovery.profiles = discovery.profiles.filter(item => item.name === profile);
      }
      if (fingerprint(args, catalogFile, catalogVersion) !== hash)
        throw new UiActionError('Selected files changed. Apply the selection again.', 409);
      selection = {
        args,
        hash,
        catalogFile,
        catalogVersion,
        activeConfiguration: named
          ? { id: named.entry.id, label: named.entry.label, profile: named.entry.profile }
          : null,
        version: crypto.randomUUID(),
        discovery,
        profileSelection: named
          ? { profile: named.entry.profile, reason: 'configuration-profile' }
          : profileSelection(configuration.profiles, discovery.profileInventory.names),
        profileSummaries: profileSummaries(
          configuration.profiles,
          discovery.profileInventory.names,
          configuration.env
        ),
      };
      blocked = false;
      return read();
    } catch (error) {
      if (error instanceof UiActionError) throw error;
      throw new UiActionError(
        'Configuration could not be loaded. Check file paths, JSON, inheritance and env references.',
        400
      );
    }
  }

  function readPersonalConfiguration(catalog) {
    let profiles = {};
    let summaries = [];
    let personal = null;
    if (!blocked && !catalog) {
      try {
        personal = personalConfiguration();
        if (personal) profiles = personal.configuration.profiles;
        summaries = profileSummaries(
          profiles,
          personal?.discovery.profileInventory.names || [],
          baseEnv
        );
      } catch {
        blocked = true;
      }
    }
    const names = personal?.discovery.profileInventory.names || [];
    return {
      mode: blocked ? 'blocked' : 'legacy',
      version: null,
      profileSource: personal ? sourceView(personal.args.config) : { kind: 'none', config: '' },
      configurationSources: configurationSources(),
      profileInventory: { count: names.length, names },
      profileSummaries: summaries,
      profileSelection: blocked
        ? { profile: '', reason: 'invalid-configuration' }
        : profileSelection(profiles, names),
      discovery: personal?.discovery || discoverResources({}, { cwd, env: baseEnv }),
    };
  }

  function read() {
    let catalog = null;
    let catalogError = null;
    try {
      catalog = configurationCatalog();
    } catch (error) {
      blocked = true;
      catalogError = error.message;
    }
    const configurationFields = {
      configurations: (catalog?.entries || []).map(({ id, label }) => ({ id, label })),
      configurationCatalogVersion: catalog?.version || null,
      configurationCatalogError: catalogError,
      activeConfiguration: selection?.activeConfiguration || null,
    };
    if (!selection) {
      return {
        ...configurationFields,
        ...readPersonalConfiguration(catalog),
      };
    }
    return {
      ...configurationFields,
      mode: blocked ? 'blocked' : 'explicit-files',
      version: selection.version,
      config: path.relative(cwd, selection.args.config).split(path.sep).join('/'),
      baseConfig: selection.args['base-config']
        ? path.relative(cwd, selection.args['base-config']).split(path.sep).join('/')
        : '',
      envFiles: String(selection.args['env-files'] || '')
        .split(',')
        .filter(Boolean)
        .map(file => path.relative(cwd, file).split(path.sep).join('/')),
      profileSelection: selection.profileSelection,
      profileSource: sourceView(selection.args.config),
      configurationSources: configurationSources(),
      profileInventory: selection.discovery.profileInventory,
      profileSummaries: selection.profileSummaries,
      discovery: selection.discovery,
    };
  }

  function personalRuntime(profile) {
    if (configurationCatalog())
      throw new UiActionError('Choose an available configuration first.', 409);
    const personal = personalConfiguration();
    if (!personal)
      throw new UiActionError('Load an existing configuration and choose a profile first.', 409);
    if (!Object.hasOwn(personal.configuration.profiles, profile))
      throw new UiActionError('Choose a profile from the loaded configuration.', 400);
    return {
      cwd,
      env: { ...baseEnv },
      configArgs: personal.args,
      profiles: personal.configuration.profiles,
      exactFile: true,
    };
  }

  function runtime(version, profile) {
    if (blocked) throw new UiActionError('Apply a valid configuration selection first.', 409);
    if (!selection) return personalRuntime(profile);
    if (version !== selection.version)
      throw new UiActionError(
        'Configuration selection changed. Refresh Setup and review again.',
        409
      );
    try {
      if (
        fingerprint(selection.args, selection.catalogFile, selection.catalogVersion) !==
        selection.hash
      ) {
        blocked = true;
        selection = null;
        throw new Error('changed');
      }
      const configuration = loadResourceConfiguration(selection.args, { cwd, env: baseEnv });
      if (
        fingerprint(selection.args, selection.catalogFile, selection.catalogVersion) !==
        selection.hash
      ) {
        blocked = true;
        selection = null;
        throw new Error('changed');
      }
      protect(configuration, selection.discovery.profileInventory.names);
      if (profile && !selection.discovery.profileInventory.names.includes(profile)) {
        throw new UiActionError('Choose a profile from the selected configuration.', 400);
      }
      return {
        cwd,
        env: configuration.env,
        configArgs: { ...selection.args },
        profiles: configuration.profiles,
        exactFile: true,
      };
    } catch (error) {
      if (error instanceof UiActionError) throw error;
      throw new UiActionError(
        'Selected files changed or are unavailable. Apply the selection again.',
        409
      );
    }
  }

  return {
    read,
    select,
    runtime,
    sanitizeConfigurationLabels: payload =>
      sanitizeValue(
        {
          configurations: payload.configurations,
          activeConfiguration: payload.activeConfiguration,
        },
        { sensitiveTerms: [...secretTerms] }
      ),
    sanitizeDiscovery: discovery =>
      sanitizeResourceDiscovery(discovery, {
        sensitiveTerms,
        secretTerms: [...secretTerms],
      }),
  };
}

module.exports = { createUiConfigurationService };
