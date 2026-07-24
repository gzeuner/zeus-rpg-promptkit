'use strict';

/**
 * Canonical source normalization for content-addressed storage.
 *
 * Rules (Community v1):
 * - Binary mode: bytes stored as-is (no transformation)
 * - Text mode: UTF-8 decode (fail closed on invalid sequences when strict),
 *   normalize newlines to LF, strip UTF-8 BOM
 *
 * Normalization is applied *before* hashing so identical logical source
 * yields identical content hashes across platforms.
 */

const { fail, REASON_CODES } = require('../store/errors');
const { isSafeRelativePath } = require('../helpers');

/**
 * @param {Buffer|string} input
 * @param {{ mode?: 'binary'|'text', strictUtf8?: boolean }} [options]
 * @returns {{ bytes: Buffer, mode: string, normalized: boolean }}
 */
function canonicalizeContent(input, options = {}) {
  const mode = options.mode === 'text' ? 'text' : 'binary';
  const strictUtf8 = options.strictUtf8 !== false;

  if (mode === 'binary') {
    const bytes = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(String(input), 'utf8');
    return { bytes, mode, normalized: false };
  }

  let text;
  if (typeof input === 'string') {
    text = input;
  } else if (Buffer.isBuffer(input)) {
    if (strictUtf8) {
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        text = decoder.decode(input);
      } catch {
        fail(REASON_CODES.CONTENT_CORRUPT, 'source content is not valid UTF-8');
      }
    } else {
      text = input.toString('utf8');
    }
  } else {
    fail(REASON_CODES.SCHEMA_INVALID, 'content input must be a Buffer or string');
  }

  const before = text;
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  // CRLF / CR -> LF
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return {
    bytes: Buffer.from(text, 'utf8'),
    mode: 'text',
    normalized: text !== before,
  };
}

/**
 * Normalize relative source paths for inventory identity (posix, no traversal).
 */
function canonicalizeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    fail(REASON_CODES.PATH_UNSAFE, 'relative path is required');
  }
  const posix = relativePath
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');
  if (!isSafeRelativePath(posix)) {
    fail(
      REASON_CODES.PATH_TRAVERSAL,
      'relative path must be safe (no absolute, drive, UNC, or traversal)'
    );
  }
  return posix;
}

module.exports = {
  canonicalizeContent,
  canonicalizeRelativePath,
};
