'use strict';

const crypto = require('crypto');
const { LICENSE_SCHEMA, SIGNATURE_ALGORITHM, canonicalize } = require('./licenseDocument');
const { createClock } = require('./clock');
const { REASON_CODES } = require('./reasonCodes');

function redact(message) {
  return String(message || '')
    .replace(/[A-Za-z]:\\[^\s]+/g, '<redacted-path>')
    .replace(/\/(?:Users|home)\/[^\s]+/g, '<redacted-path>')
    .replace(/[A-Za-z0-9+/=]{40,}/g, '<redacted-material>');
}

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCanonicalBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function parseVerificationKey(publicKeyPem) {
  const publicKey = crypto.createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'rsa') {
    throw new Error('Verification public key must be RSA.');
  }
  if (!publicKey.asymmetricKeyDetails || publicKey.asymmetricKeyDetails.modulusLength < 2048) {
    throw new Error('Verification RSA public key must be at least 2048 bits.');
  }
  return publicKey;
}

/**
 * Offline entitlement verification.
 * Never transmits data; never embeds private signing keys.
 */
function verifyOfflineEntitlement(licenseDocument, options = {}) {
  const clock = createClock(options);
  const publicKeyPem = options.publicKeyPem;
  if (!publicKeyPem || typeof publicKeyPem !== 'string') {
    return denied(REASON_CODES.ENTITLEMENT_INVALID, 'Verification public key is required.');
  }
  if (!licenseDocument || typeof licenseDocument !== 'object') {
    return denied(REASON_CODES.ENTITLEMENT_REQUIRED, 'Entitlement document is required.');
  }

  try {
    if (Number(licenseDocument.schemaVersion) !== 1) {
      return denied(REASON_CODES.ENTITLEMENT_INVALID, 'Unsupported license schema version.');
    }
    if (licenseDocument.schemaId !== LICENSE_SCHEMA) {
      return denied(REASON_CODES.ENTITLEMENT_INVALID, 'Unsupported license schema id.');
    }
    if (!isPlainObject(licenseDocument.signature)) {
      return denied(REASON_CODES.ENTITLEMENT_INVALID, 'License signature is missing.');
    }

    const signatureKeys = Object.keys(licenseDocument.signature);
    if (
      signatureKeys.length !== 2 ||
      !signatureKeys.includes('algorithm') ||
      !signatureKeys.includes('value')
    ) {
      return denied(REASON_CODES.ENTITLEMENT_INVALID, 'License signature schema is invalid.');
    }
    if (licenseDocument.signature.algorithm !== SIGNATURE_ALGORITHM) {
      return denied(REASON_CODES.ENTITLEMENT_INVALID, 'License signature algorithm is invalid.');
    }
    if (!isCanonicalBase64(licenseDocument.signature.value)) {
      return denied(REASON_CODES.ENTITLEMENT_INVALID, 'License signature value is invalid.');
    }

    const verificationKey = parseVerificationKey(publicKeyPem);

    const { signature, ...unsigned } = licenseDocument;
    const payload = canonicalize(unsigned);
    const verify = crypto.createVerify('SHA256');
    verify.update(payload);
    verify.end();
    const ok = verify.verify(verificationKey, signature.value, 'base64');
    if (!ok) {
      return denied(REASON_CODES.ENTITLEMENT_INVALID, 'License signature verification failed.');
    }

    const expectedProduct = options.expectedProductId || 'zeus-rpg-promptkit';
    if (String(unsigned.productId) !== expectedProduct) {
      return denied(REASON_CODES.ENTITLEMENT_INVALID, 'Product scope mismatch.');
    }

    const expectedEdition = options.expectedEdition || 'professional';
    if (String(unsigned.edition) !== expectedEdition) {
      return denied(REASON_CODES.ENTITLEMENT_INVALID, 'Edition scope mismatch.');
    }

    if (options.organizationScope) {
      if (String(unsigned.organizationScope || '') !== String(options.organizationScope)) {
        return denied(REASON_CODES.POLICY_DENIED, 'Organization scope mismatch.');
      }
    }

    const now = clock.now().getTime();
    const notBefore = Date.parse(unsigned.notBefore);
    const expiresAt = Date.parse(unsigned.expiresAt);
    if (Number.isNaN(notBefore) || Number.isNaN(expiresAt)) {
      return denied(REASON_CODES.ENTITLEMENT_INVALID, 'License validity timestamps are invalid.');
    }
    if (now < notBefore) {
      return denied(REASON_CODES.ENTITLEMENT_INVALID, 'License is not yet valid.');
    }
    // Fail closed at exact expiry boundary: now >= expiresAt => expired
    if (now >= expiresAt) {
      return denied(REASON_CODES.ENTITLEMENT_EXPIRED, 'License is expired.');
    }

    return {
      ok: true,
      reasonCode: REASON_CODES.AVAILABLE,
      availability: 'available',
      productId: unsigned.productId,
      edition: unsigned.edition,
      licenseId: unsigned.licenseId,
      // never return signature material to callers
      message: 'Entitlement valid for commercial reference capability.',
    };
  } catch (error) {
    void error;
    return denied(REASON_CODES.ENTITLEMENT_INVALID, 'License validation failed.');
  }
}

function denied(reasonCode, message) {
  return {
    ok: false,
    reasonCode,
    availability: 'unavailable',
    message: redact(message),
  };
}

module.exports = {
  verifyOfflineEntitlement,
};
