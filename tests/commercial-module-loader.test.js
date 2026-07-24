'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  LOADER_REASON_CODES,
  resolveCommercialModuleConfig,
  registerCommercialModules,
  createHostZeus,
  requireCommercialPackage,
} = require('../src/modules/commercialModuleLoader');
const { createZeus } = require('../src/api/zeusApi');

test('not configured returns ok without loading', async () => {
  const zeus = createZeus();
  const result = await registerCommercialModules(zeus, { env: {} });
  assert.equal(result.ok, true);
  assert.equal(result.loaded, false);
  assert.equal(result.reasonCode, LOADER_REASON_CODES.NOT_CONFIGURED);
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
