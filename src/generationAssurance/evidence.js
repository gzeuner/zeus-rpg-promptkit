'use strict';

const { normalizePath } = require('./canonicalDiagnostics');

/**
 * Canonical evidence reference key: id|kind|path (order-insensitive set comparison).
 */
function canonicalizeEvidenceReference(ref) {
  const id = String((ref && ref.id) || '').trim();
  const kind = String((ref && ref.kind) || '').trim();
  const path =
    ref && ref.path != null && String(ref.path).trim() !== '' ? normalizePath(ref.path) : '';
  return { id, kind, path, key: `${id}|${kind}|${path}` };
}

function canonicalizeEvidenceReferences(refs) {
  const list = Array.isArray(refs) ? refs : [];
  return list
    .map(canonicalizeEvidenceReference)
    .sort(
      (a, b) =>
        a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path)
    );
}

/**
 * Order-insensitive equality over all relevant id/kind/path fields.
 * Any added/dropped/changed reference is a mismatch.
 */
function evidenceReferencesEqual(left, right) {
  const a = canonicalizeEvidenceReferences(left);
  const b = canonicalizeEvidenceReferences(right);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].key !== b[i].key) return false;
  }
  return true;
}

/**
 * Compare provider candidate evidence provenance against the current candidate.
 * Fail closed on any change before revalidation.
 */
function assertEvidenceProvenancePreserved(currentCandidate, providerCandidate) {
  const current = currentCandidate && currentCandidate.evidenceReferences;
  const next = providerCandidate && providerCandidate.evidenceReferences;
  if (evidenceReferencesEqual(current, next)) {
    return { ok: true };
  }
  return {
    ok: false,
    code: 'PROVIDER_OUTPUT_INVALID',
    message: 'provider candidate evidenceReferences must match current candidate provenance',
  };
}

module.exports = {
  canonicalizeEvidenceReference,
  canonicalizeEvidenceReferences,
  evidenceReferencesEqual,
  assertEvidenceProvenancePreserved,
};
