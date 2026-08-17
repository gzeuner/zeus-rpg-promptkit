'use strict';

const crypto = require('crypto');

const LICENSE_SCHEMA = 'zeus.commercial-offline-license/v1';
const SIGNATURE_ALGORITHM = 'RSA-SHA256';

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Canonical JSON for signing (sorted keys, no whitespace variance).
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

function buildUnsignedLicense({
  productId = 'zeus-rpg-promptkit',
  edition = 'professional',
  notBefore,
  expiresAt,
  organizationScope = null,
  licenseId = crypto.randomUUID(),
} = {}) {
  const doc = {
    schemaVersion: 1,
    schemaId: LICENSE_SCHEMA,
    licenseId: String(licenseId),
    productId: String(productId),
    edition: String(edition),
    notBefore: new Date(notBefore).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
  if (organizationScope) {
    doc.organizationScope = String(organizationScope);
  }
  return doc;
}

function signLicenseDocument(unsignedDoc, privateKeyPem) {
  if (!isPlainObject(unsignedDoc)) throw new Error('license document required');
  if (unsignedDoc.signature) throw new Error('document already signed');
  const payload = canonicalize(unsignedDoc);
  const sign = crypto.createSign('SHA256');
  sign.update(payload);
  sign.end();
  const signature = sign.sign(privateKeyPem, 'base64');
  return {
    ...unsignedDoc,
    signature: {
      algorithm: SIGNATURE_ALGORITHM,
      value: signature,
    },
  };
}

function generateEphemeralKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

module.exports = {
  LICENSE_SCHEMA,
  SIGNATURE_ALGORITHM,
  canonicalize,
  buildUnsignedLicense,
  signLicenseDocument,
  generateEphemeralKeyPair,
};
