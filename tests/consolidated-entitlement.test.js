'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  generateEphemeralKeyPair,
  buildUnsignedLicense,
  signLicenseDocument,
  verifyOfflineEntitlement,
  REASON_CODES,
} = require('../src');

function validWindow(now = new Date('2026-07-19T12:00:00.000Z')) {
  const notBefore = new Date(now.getTime() - 60_000);
  const expiresAt = new Date(now.getTime() + 3_600_000);
  return { now, notBefore, expiresAt };
}

test('valid signed license is accepted offline', () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const { now, notBefore, expiresAt } = validWindow();
  const unsigned = buildUnsignedLicense({ notBefore, expiresAt });
  const signed = signLicenseDocument(unsigned, privateKey);
  const result = verifyOfflineEntitlement(signed, { publicKeyPem: publicKey, now });
  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, REASON_CODES.AVAILABLE);
  assert.equal(result.signature, undefined);
});

test('payload mutation fails signature check', () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const { now, notBefore, expiresAt } = validWindow();
  const signed = signLicenseDocument(buildUnsignedLicense({ notBefore, expiresAt }), privateKey);
  signed.edition = 'enterprise';
  const result = verifyOfflineEntitlement(signed, { publicKeyPem: publicKey, now });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_INVALID);
});

test('unknown signature algorithm fails closed', () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const { now, notBefore, expiresAt } = validWindow();
  const signed = signLicenseDocument(buildUnsignedLicense({ notBefore, expiresAt }), privateKey);
  signed.signature.algorithm = 'TOTALLY-UNSUPPORTED';

  const result = verifyOfflineEntitlement(signed, { publicKeyPem: publicKey, now });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_INVALID);
});

test('mismatched signature algorithm fails closed', () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const { now, notBefore, expiresAt } = validWindow();
  const signed = signLicenseDocument(buildUnsignedLicense({ notBefore, expiresAt }), privateKey);
  signed.signature.algorithm = 'RSA-SHA512';

  const result = verifyOfflineEntitlement(signed, { publicKeyPem: publicKey, now });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_INVALID);
});

test('missing signature algorithm fails closed', () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const { now, notBefore, expiresAt } = validWindow();
  const signed = signLicenseDocument(buildUnsignedLicense({ notBefore, expiresAt }), privateKey);
  delete signed.signature.algorithm;

  const result = verifyOfflineEntitlement(signed, { publicKeyPem: publicKey, now });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_INVALID);
});

test('unknown cryptographic signature fields fail closed', () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const { now, notBefore, expiresAt } = validWindow();
  const signed = signLicenseDocument(buildUnsignedLicense({ notBefore, expiresAt }), privateKey);
  signed.signature.keyType = 'EC';

  const result = verifyOfflineEntitlement(signed, { publicKeyPem: publicKey, now });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_INVALID);
});

test('EC verification key fails closed', () => {
  const { privateKey } = generateEphemeralKeyPair();
  const { publicKey: ecPublicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const { now, notBefore, expiresAt } = validWindow();
  const signed = signLicenseDocument(buildUnsignedLicense({ notBefore, expiresAt }), privateKey);

  const result = verifyOfflineEntitlement(signed, { publicKeyPem: ecPublicKey, now });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_INVALID);
});

test('RSA-1024 verification key fails closed', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const { now, notBefore, expiresAt } = validWindow();
  const signed = signLicenseDocument(buildUnsignedLicense({ notBefore, expiresAt }), privateKey);

  const result = verifyOfflineEntitlement(signed, { publicKeyPem: publicKey, now });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_INVALID);
});

test('wrong verification key fails signature check', () => {
  const signer = generateEphemeralKeyPair();
  const verifier = generateEphemeralKeyPair();
  const { now, notBefore, expiresAt } = validWindow();
  const signed = signLicenseDocument(
    buildUnsignedLicense({ notBefore, expiresAt }),
    signer.privateKey
  );

  const result = verifyOfflineEntitlement(signed, {
    publicKeyPem: verifier.publicKey,
    now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_INVALID);
});

test('corrupted signature fails signature check', () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const { now, notBefore, expiresAt } = validWindow();
  const signed = signLicenseDocument(buildUnsignedLicense({ notBefore, expiresAt }), privateKey);
  const first = signed.signature.value[0];
  signed.signature.value = `${first === 'A' ? 'B' : 'A'}${signed.signature.value.slice(1)}`;

  const result = verifyOfflineEntitlement(signed, { publicKeyPem: publicKey, now });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_INVALID);
});

test('non-canonical signature encodings fail closed', () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const { now, notBefore, expiresAt } = validWindow();
  const signed = signLicenseDocument(buildUnsignedLicense({ notBefore, expiresAt }), privateKey);
  assert.match(signed.signature.value, /==$/);

  for (const value of [
    signed.signature.value.slice(0, -2),
    `${signed.signature.value}\n`,
    Buffer.from(signed.signature.value, 'utf8'),
  ]) {
    const result = verifyOfflineEntitlement(
      { ...signed, signature: { ...signed.signature, value } },
      { publicKeyPem: publicKey, now }
    );
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_INVALID);
  }
});

test('expired license fails closed at boundary', () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const now = new Date('2026-07-19T12:00:00.000Z');
  const signed = signLicenseDocument(
    buildUnsignedLicense({
      notBefore: new Date('2026-07-01T00:00:00.000Z'),
      expiresAt: now,
    }),
    privateKey
  );
  const result = verifyOfflineEntitlement(signed, { publicKeyPem: publicKey, now });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_EXPIRED);
});

test('missing license requires entitlement', () => {
  const { publicKey } = generateEphemeralKeyPair();
  const result = verifyOfflineEntitlement(null, { publicKeyPem: publicKey });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_REQUIRED);
});

test('organization scope mismatch is policy denied', () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const { now, notBefore, expiresAt } = validWindow();
  const signed = signLicenseDocument(
    buildUnsignedLicense({ notBefore, expiresAt, organizationScope: 'ORG-A' }),
    privateKey
  );
  const result = verifyOfflineEntitlement(signed, {
    publicKeyPem: publicKey,
    now,
    organizationScope: 'ORG-B',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.POLICY_DENIED);
});

test('private key material is not embedded in module source exports', () => {
  const src = require('fs').readFileSync(require.resolve('../src/index.js'), 'utf8');
  assert.equal(src.includes('BEGIN PRIVATE KEY'), false);
  assert.equal(src.includes('BEGIN RSA PRIVATE KEY'), false);
});
