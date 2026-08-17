'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createZeus } = require('zeus-rpg-promptkit/api');
const {
  generateEphemeralKeyPair,
  buildUnsignedLicense,
  signLicenseDocument,
  registerReferenceModule,
  CAPABILITY_ID,
  REASON_CODES,
} = require('../src');

const PUBLIC_CORE_HINT = '84822a68309f123c43e848c7ed2158853364fd46';

function entitledLicense(privateKey, now = new Date('2026-07-19T12:00:00.000Z')) {
  return signLicenseDocument(
    buildUnsignedLicense({
      notBefore: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 3_600_000),
    }),
    privateKey
  );
}

test(`integrates against public core module contracts (${PUBLIC_CORE_HINT})`, async () => {
  const zeus = createZeus();
  assert.equal(typeof zeus.modules.registerModule, 'function');
  assert.ok(zeus.moduleContracts);
  assert.equal(zeus.modules.listModules().length, 0);

  // Core remains usable without commercial module
  assert.equal(typeof zeus.analyze, 'function');
  assert.equal(typeof zeus.generationValidation.validateGenerationCandidate, 'function');
});

test('valid entitlement registers commercial reference capability', async () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const now = new Date('2026-07-19T12:00:00.000Z');
  const zeus = createZeus();
  const result = await registerReferenceModule(zeus.modules, {
    publicKeyPem: publicKey,
    licenseDocument: entitledLicense(privateKey, now),
    now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.entitlement.reasonCode, REASON_CODES.AVAILABLE);
  assert.ok(zeus.capabilities.get(CAPABILITY_ID));
  const exec = await zeus.capabilities.execute(CAPABILITY_ID, {}, {});
  assert.equal(exec.ok, true);
  assert.equal(exec.result.commercial, true);
});

test('expired entitlement does not enable commercial capability', async () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const now = new Date('2026-07-19T12:00:00.000Z');
  const license = signLicenseDocument(
    buildUnsignedLicense({
      notBefore: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: now,
    }),
    privateKey
  );
  const zeus = createZeus();
  const result = await registerReferenceModule(zeus.modules, {
    publicKeyPem: publicKey,
    licenseDocument: license,
    now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.entitlement.reasonCode, REASON_CODES.ENTITLEMENT_EXPIRED);
  assert.equal(zeus.capabilities.get(CAPABILITY_ID), null);
  // Community surface still present
  assert.equal(typeof zeus.analyze, 'function');
});

test('invalid signature disables only commercial registration', async () => {
  const { privateKey } = generateEphemeralKeyPair();
  const other = generateEphemeralKeyPair();
  const now = new Date('2026-07-19T12:00:00.000Z');
  const license = entitledLicense(privateKey, now);
  const zeus = createZeus();
  const result = await registerReferenceModule(zeus.modules, {
    publicKeyPem: other.publicKey,
    licenseDocument: license,
    now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.entitlement.reasonCode, REASON_CODES.ENTITLEMENT_INVALID);
  assert.equal(zeus.capabilities.get(CAPABILITY_ID), null);
});
