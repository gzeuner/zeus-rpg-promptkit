'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createZeus } = require('zeus-rpg-promptkit/api');
const {
  generateEphemeralKeyPair,
  buildUnsignedLicense,
  signLicenseDocument,
  registerWithZeus,
  KNOWN_COMMERCIAL_MODULES,
  listModuleSurfaceEntries,
  listSurfacePresets,
  getSurfacePreset,
  buildProductSurfaceMatrixDocument,
  resolveSelectedModules,
  MODULE_SURFACE_ENTRIES,
} = require('../src');

const ROOT = path.join(__dirname, '..');

function entitledLicense(privateKey, now = new Date('2026-07-19T12:00:00.000Z')) {
  return signLicenseDocument(
    buildUnsignedLicense({
      notBefore: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 3_600_000),
    }),
    privateKey
  );
}

test('product surface matrix lists known modules and presets', () => {
  const entries = listModuleSurfaceEntries();
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(e => e.key).sort(), [...KNOWN_COMMERCIAL_MODULES].sort());

  const presets = listSurfacePresets();
  assert.deepEqual(presets.map(p => p.id).sort(), ['enterprise', 'professional']);

  const pro = getSurfacePreset('professional');
  assert.ok(pro);
  assert.ok(pro.defaultModuleKeys.includes('project-intelligence'));
  assert.ok(pro.defaultModuleKeys.includes('generation-assurance'));
  assert.ok(pro.defaultModuleKeys.includes('db2-test-intelligence'));
  assert.equal(pro.defaultModuleKeys.includes('ibmi-validation'), false);
  assert.equal(pro.defaultModuleKeys.includes('reference'), false);

  const ent = getSurfacePreset('enterprise');
  assert.ok(ent.defaultModuleKeys.includes('ibmi-validation'));
  assert.ok(ent.defaultModuleKeys.includes('project-intelligence'));
});

test('package 09 live remains off in surface matrix non-claims', () => {
  const ibmi = MODULE_SURFACE_ENTRIES.find(e => e.key === 'ibmi-validation');
  assert.ok(ibmi);
  assert.equal(ibmi.edition, 'enterprise');
  assert.equal(ibmi.liveIbmiDefault, false);
  assert.equal(ibmi.includedInProfessionalDefault, false);
  assert.ok(ibmi.nonClaims.some(c => /liveAccessAuthorized/i.test(c) || /CLOSED/i.test(c)));
});

test('matrix module ids match shipped descriptors', () => {
  const { MODULE_ID: PI } = require('../src/projectIntelligence/entitled/constants');
  const { MODULE_ID: GA } = require('../src/generationAssurance/constants');
  const { MODULE_ID: DB2 } = require('../src/db2TestIntelligence/constants');
  const { MODULE_ID: IBMI } = require('../src/ibmiValidation/constants');

  const byKey = Object.fromEntries(MODULE_SURFACE_ENTRIES.map(e => [e.key, e]));
  assert.equal(byKey['project-intelligence'].moduleId, PI);
  assert.equal(byKey['generation-assurance'].moduleId, GA);
  assert.equal(byKey['db2-test-intelligence'].moduleId, DB2);
  assert.equal(byKey['ibmi-validation'].moduleId, IBMI);
  assert.equal(byKey.reference, undefined);
});

test('package exports cover professional and enterprise subpaths from matrix', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const entry of MODULE_SURFACE_ENTRIES) {
    if (!entry.packageExport) continue;
    assert.ok(
      pkg.exports[entry.packageExport],
      `missing package export ${entry.packageExport} for ${entry.key}`
    );
  }
});

test('resolveSelectedModules: explicit modules win over surface', () => {
  const resolved = resolveSelectedModules({
    modules: ['project-intelligence'],
    surface: 'enterprise',
  });
  assert.deepEqual(resolved.modules, ['project-intelligence']);
  assert.equal(resolved.source, 'modules');
  assert.equal(resolved.surface, null);
});

test('resolveSelectedModules: professional surface expands default pack', () => {
  const resolved = resolveSelectedModules({ surface: 'professional' });
  assert.equal(resolved.source, 'surface');
  assert.equal(resolved.surface, 'professional');
  assert.deepEqual(resolved.modules, getSurfacePreset('professional').defaultModuleKeys);
});

test('resolveSelectedModules: unknown surface fails closed', () => {
  assert.throws(
    () => resolveSelectedModules({ surface: 'marketplace' }),
    err => err && err.code === 'UNKNOWN_BUILT_IN_SURFACE'
  );
});

test('resolveSelectedModules: default remains project-intelligence only', () => {
  const resolved = resolveSelectedModules({});
  assert.deepEqual(resolved.modules, ['project-intelligence']);
  assert.equal(resolved.source, 'default');
});

test('registerWithZeus surface=professional registers PI pack (not ibmi)', async () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const now = new Date('2026-07-19T12:00:00.000Z');
  const zeus = createZeus();
  const result = await registerWithZeus(zeus, {
    publicKeyPem: publicKey,
    licenseDocument: entitledLicense(privateKey, now),
    now,
    surface: 'professional',
  });
  assert.equal(result.ok, true);
  assert.equal(result.surface, 'professional');
  assert.equal(result.selectionSource, 'surface');
  assert.ok(result.selected.includes('project-intelligence'));
  assert.ok(result.selected.includes('generation-assurance'));
  assert.ok(result.selected.includes('db2-test-intelligence'));
  assert.equal(result.selected.includes('ibmi-validation'), false);
  assert.ok(zeus.capabilities.get('zeus-pro.project-intelligence.status'));
  assert.ok(zeus.capabilities.get('zeus-pro.generation-assurance.run'));
  assert.ok(zeus.capabilities.get('zeus-pro.db2-test-intelligence.generate'));
  assert.equal(zeus.capabilities.get('zeus-enterprise.ibmi-compile-validation.run'), null);
});

test('buildProductSurfaceMatrixDocument is stable and redaction-safe', () => {
  const doc = buildProductSurfaceMatrixDocument();
  assert.equal(doc.documentVersion, 'zeus-pro.product-surface-matrix/v1');
  assert.ok(Array.isArray(doc.modules));
  assert.ok(Array.isArray(doc.surfaces));
  const serialized = JSON.stringify(doc);
  assert.equal(/[A-Za-z]:\\/.test(serialized), false);
  assert.equal(/password|secret|BEGIN RSA/i.test(serialized), false);
});
