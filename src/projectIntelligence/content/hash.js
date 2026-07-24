'use strict';

const crypto = require('crypto');
const { CONTENT_HASH_ALGORITHM } = require('./constants');
const { isSha256Hex } = require('../helpers');
const { fail, REASON_CODES } = require('../store/errors');

function sha256Hex(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return crypto.createHash(CONTENT_HASH_ALGORITHM).update(buf).digest('hex');
}

function requireContentHash(contentHash) {
  if (!isSha256Hex(contentHash)) {
    fail(
      REASON_CODES.CONTENT_HASH_MISMATCH,
      'content hash must be lowercase sha256 hex (64 chars)'
    );
  }
  return contentHash;
}

/**
 * Object path segments for sha256: objects/ab/abcd...64
 * Prevents flat directories with millions of files.
 */
function contentObjectRelativePath(contentHash) {
  const hash = requireContentHash(contentHash);
  const prefix = hash.slice(0, 2);
  return `${prefix}/${hash}`;
}

module.exports = {
  CONTENT_HASH_ALGORITHM,
  sha256Hex,
  requireContentHash,
  contentObjectRelativePath,
  isSha256Hex,
};
