'use strict';

const { LIMITS } = require('./constants');

/**
 * Enforce UTF-8 byte bounds on candidate content (per-file and total).
 * Fail closed — never silently exceed the contract.
 *
 * @param {object} candidate
 * @param {object} [limits]
 * @returns {{ ok: true, totalBytes: number } | { ok: false, code: string, message: string, filePath?: string }}
 */
function assertCandidateContentBounds(candidate, limits = LIMITS) {
  const maxPerFile = Number(limits.maxContentBytesPerFile) || LIMITS.maxContentBytesPerFile;
  const maxTotal = Number(limits.maxTotalContentBytes) || LIMITS.maxTotalContentBytes;
  const files = Array.isArray(candidate && candidate.proposedFiles) ? candidate.proposedFiles : [];
  let totalBytes = 0;
  for (const file of files) {
    if (!file || typeof file.content !== 'string') continue;
    const bytes = Buffer.byteLength(file.content, 'utf8');
    if (bytes > maxPerFile) {
      return {
        ok: false,
        code: 'REQUEST_BOUNDS_EXCEEDED',
        message: 'proposed file content exceeds maxContentBytesPerFile (UTF-8 bytes)',
        filePath: file.path != null ? String(file.path) : null,
      };
    }
    totalBytes += bytes;
    if (totalBytes > maxTotal) {
      return {
        ok: false,
        code: 'REQUEST_BOUNDS_EXCEEDED',
        message: 'total proposed content exceeds maxTotalContentBytes (UTF-8 bytes)',
      };
    }
  }
  return { ok: true, totalBytes };
}

module.exports = {
  assertCandidateContentBounds,
};
