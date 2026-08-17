'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  LOADER_REASON_CODES,
  COMMERCIAL_CONFIG_SOURCES,
  resolveCommercialModuleConfig,
  extractCommercialFromProfile,
  registerCommercialModules,
  createHostZeus,
  resolveBuiltInModuleRequest,
  registerBuiltInModules,
  requireCommercialPackage,
} = require('../src/modules/commercialModuleLoader');
const { createZeus } = require('../src/api/zeusApi');
const { validateProfiles } = require('../src/config/runtimeConfig');

test('not configured returns ok without loading', async () => {
  const zeus = createZeus();
  const result = await registerCommercialModules(zeus, { env: {} });
  assert.equal(result.ok, true);
  assert.equal(result.loaded, false);
  assert.equal(result.reasonCode, LOADER_REASON_CODES.NOT_CONFIGURED);
});

test('built-in module selection uses the public package without external loading', async () => {
  assert.deepEqual(resolveBuiltInModuleRequest({ args: { 'built-in-modules': 'professional' } }), {
    value: 'professional',
    source: 'args-or-env',
  });
  const zeus = createZeus();
  const result = await registerBuiltInModules(zeus, {
    builtInModules: 'professional',
    env: {},
  });
  assert.equal(result.builtIn, true);
  assert.equal(result.loaded, true);
  assert.equal(result.registration.selected.length, 3);
  assert.equal(result.registration.modules['project-intelligence'].ok, false);
});

test('resolveCommercialModuleConfig prefers args over env', () => {
  const cfg = resolveCommercialModuleConfig(
    { args: { 'commercial-module': './vendor/mod' } },
    { ZEUS_COMMERCIAL_MODULE: 'from-env' }
  );
  assert.equal(cfg.spec, './vendor/mod');
});

test('missing path fails closed without path leakage', async () => {
  const zeus = createZeus();
  const missing = path.join(os.tmpdir(), 'zeus-missing-commercial-module-xyz');
  const result = await registerCommercialModules(zeus, {
    modulePath: missing,
    env: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, LOADER_REASON_CODES.PATH_INVALID);
  assert.equal(/[A-Za-z]:\\/.test(JSON.stringify(result)), false);
});

test('package without registerWithZeus fails with ENTRY_MISSING', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-comm-mod-'));
  const pkgDir = path.join(root, 'pkg');
  fs.mkdirSync(pkgDir);
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'fake-mod', main: 'index.js' })
  );
  fs.writeFileSync(
    path.join(pkgDir, 'index.js'),
    "'use strict';\nmodule.exports = { hello: true };\n"
  );

  const zeus = createZeus();
  const result = await registerCommercialModules(zeus, {
    modulePath: pkgDir,
    env: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.loaded, true);
  assert.equal(result.reasonCode, LOADER_REASON_CODES.ENTRY_MISSING);
  fs.rmSync(root, { recursive: true, force: true });
});

test('registerWithZeus is invoked and can register a capability', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-comm-mod-'));
  const pkgDir = path.join(root, 'pkg');
  fs.mkdirSync(pkgDir);
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'fake-mod', main: 'index.js' })
  );
  fs.writeFileSync(
    path.join(pkgDir, 'index.js'),
    `'use strict';
async function registerWithZeus(zeus, options) {
  await zeus.modules.registerModule({
    descriptor: {
      descriptorVersion: 'zeus.module-descriptor/v1',
      id: 'test.commercial.loader',
      version: '1.0.0',
      edition: 'professional',
      compatibility: { moduleApi: '>=1.0.0 <2.0.0' },
      capabilities: [{ id: 'test.commercial.loader.ping', version: 1 }],
      safety: { level: 'S1', sideEffects: ['local-read'] },
      runtime: { requiredFeatures: ['node-crypto'] },
      entitlement: { mode: 'module-managed' },
      docs: { title: 'Loader test', reference: 'README.md' },
    },
    register({ capabilityRegistry }) {
      capabilityRegistry.register({
        id: 'test.commercial.loader.ping',
        version: 1,
        title: 'ping',
        description: 'test',
        category: 'test',
        safety: { level: 'S1', sideEffects: ['local-read'], requiresExplicitApproval: false },
        availability: { api: true, cli: true, mcp: true },
        execute: async () => ({ ok: true, echo: options && options.marker }),
      });
    },
    status: { availability: 'available', reasonCode: 'AVAILABLE' },
  });
  return { ok: true, modules: ['test'] };
}
module.exports = { registerWithZeus };
`
  );

  const host = await createHostZeus({
    modulePath: pkgDir,
    entitlement: { marker: 'from-loader' },
    env: {},
  });
  assert.equal(host.commercial.ok, true);
  assert.equal(host.commercial.loaded, true);
  const cap = host.zeus.capabilities.get('test.commercial.loader.ping');
  assert.ok(cap);
  const exec = await host.zeus.capabilities.execute('test.commercial.loader.ping', {}, {});
  assert.equal(exec.ok, true);
  assert.equal(exec.result.ok, true);

  fs.rmSync(root, { recursive: true, force: true });
});

test('requireCommercialPackage redacts absolute paths on failure', () => {
  const result = requireCommercialPackage(path.join(os.tmpdir(), 'nope-module'));
  assert.equal(result.ok, false);
  assert.equal(result.resolved, '<redacted-path>');
});

test('extractCommercialFromProfile reads explicit commercial fields only', () => {
  const extracted = extractCommercialFromProfile({
    commercial: {
      module: './vendor/comm',
      modules: ['project-intelligence', 'reference'],
      licenseDocumentPath: './.local/license.json',
      publicKeyPath: './.local/public.pem',
    },
  });
  assert.equal(extracted.module, './vendor/comm');
  assert.deepEqual(extracted.modules, ['project-intelligence', 'reference']);
  assert.equal(extracted.licenseDocumentPath, './.local/license.json');
  assert.equal(extracted.publicKeyPath, './.local/public.pem');
});

test('resolveCommercialModuleConfig precedence: options > env > profile', () => {
  const profile = {
    commercial: {
      module: 'from-profile',
      modules: ['profile-mod'],
    },
  };
  const fromProfile = resolveCommercialModuleConfig({ profile, env: {} }, {});
  assert.equal(fromProfile.spec, 'from-profile');
  assert.equal(fromProfile.specSource, COMMERCIAL_CONFIG_SOURCES.PROFILE);
  assert.deepEqual(fromProfile.modules, ['profile-mod']);

  const fromEnv = resolveCommercialModuleConfig(
    { profile },
    { ZEUS_COMMERCIAL_MODULE: 'from-env', ZEUS_COMMERCIAL_MODULES: 'env-mod' }
  );
  assert.equal(fromEnv.spec, 'from-env');
  assert.equal(fromEnv.specSource, COMMERCIAL_CONFIG_SOURCES.ENV);
  assert.deepEqual(fromEnv.modules, ['env-mod']);

  const fromOptions = resolveCommercialModuleConfig(
    {
      profile,
      args: { 'commercial-module': 'from-cli' },
    },
    { ZEUS_COMMERCIAL_MODULE: 'from-env' }
  );
  assert.equal(fromOptions.spec, 'from-cli');
  assert.equal(fromOptions.specSource, COMMERCIAL_CONFIG_SOURCES.OPTIONS);
});

test('registerCommercialModules loads from profile.commercial.module', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-comm-profile-'));
  const pkgDir = path.join(root, 'pkg');
  fs.mkdirSync(pkgDir);
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'fake-mod-profile', main: 'index.js' })
  );
  fs.writeFileSync(
    path.join(pkgDir, 'index.js'),
    `'use strict';
async function registerWithZeus(zeus) {
  return { ok: true, modules: ['from-profile'] };
}
module.exports = { registerWithZeus };
`
  );

  const zeus = createZeus();
  const result = await registerCommercialModules(zeus, {
    profile: { commercial: { module: pkgDir, modules: ['from-profile'] } },
    env: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.loaded, true);
  assert.equal(result.configSource, COMMERCIAL_CONFIG_SOURCES.PROFILE);
  assert.equal(result.registration.modules[0], 'from-profile');
  assert.equal(/[A-Za-z]:\\/.test(JSON.stringify(result)), false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('validateProfiles rejects discovery-like commercial keys', () => {
  assert.throws(
    () =>
      validateProfiles({
        demo: {
          commercial: { module: 'x', marketplaceUrl: 'https://evil' },
        },
      }),
    /not allowed/
  );
});

test('validateProfiles accepts profile.commercial block', () => {
  assert.doesNotThrow(() =>
    validateProfiles({
      demo: {
        outputRoot: 'analysis',
        commercial: {
          module: 'some-package',
          modules: ['project-intelligence'],
          licenseDocumentPath: '${env:ZEUS_LICENSE_DOCUMENT_PATH}',
          publicKeyPath: '${env:ZEUS_LICENSE_PUBLIC_KEY_PATH}',
          _comment: 'ok',
        },
      },
    })
  );
});
