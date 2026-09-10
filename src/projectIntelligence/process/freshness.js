'use strict';

/**
 * Compare the catalog's recorded source identity with an optional current
 * source signal. This is deliberately conservative: without a comparable
 * signal, freshness stays at the supplied value or becomes unknown.
 */
function normalize(value) {
  return String(value == null ? '' : value).trim();
}

function assessProcessFreshness(catalog = {}, options = {}) {
  const supplied = options.freshness || catalog.freshness || catalog.snapshot || {};
  const recordedSnapshotId = normalize(
    options.snapshotId || catalog.snapshotId || supplied.snapshotId
  );
  const recordedSourceHash = normalize(
    supplied.sourceHash || catalog.sourceHash || catalog.snapshotSourceHash
  );
  const currentSnapshotId = normalize(options.currentSnapshotId || options.currentSnapshot);
  const currentSourceHash = normalize(options.currentSourceHash || options.currentSource);
  const suppliedStatus = normalize(
    supplied.status ||
      supplied.state ||
      catalog.snapshotStatus ||
      catalog.freshnessStatus ||
      'unknown'
  ).toLowerCase();

  const freshness = {
    status: suppliedStatus || 'unknown',
    snapshotId: recordedSnapshotId || null,
  };
  if (recordedSourceHash) freshness.sourceHash = recordedSourceHash;
  if (currentSnapshotId) freshness.currentSnapshotId = currentSnapshotId;
  if (currentSourceHash) freshness.currentSourceHash = currentSourceHash;
  for (const field of ['asOf', 'checkedAt', 'reason']) {
    if (supplied[field] != null && normalize(supplied[field])) {
      freshness[field] = normalize(supplied[field]);
    }
  }

  const snapshotChanged =
    Boolean(currentSnapshotId && recordedSnapshotId) && currentSnapshotId !== recordedSnapshotId;
  const sourceChanged =
    Boolean(currentSourceHash && recordedSourceHash) && currentSourceHash !== recordedSourceHash;
  const hasComparableSignal = Boolean(currentSnapshotId || currentSourceHash);
  const hasComparableIdentity = Boolean(
    (currentSnapshotId && recordedSnapshotId) || (currentSourceHash && recordedSourceHash)
  );

  if (snapshotChanged || sourceChanged) {
    freshness.status = 'stale';
    freshness.reason = snapshotChanged ? 'snapshot-id-changed' : 'source-hash-changed';
  } else if (hasComparableSignal && !hasComparableIdentity) {
    freshness.status = 'unknown';
    freshness.reason = 'catalog-freshness-not-comparable';
  } else if (hasComparableIdentity && suppliedStatus === 'stale') {
    freshness.status = 'stale';
    freshness.reason = freshness.reason || 'catalog-marked-stale';
  } else if (hasComparableIdentity && !freshness.reason) {
    freshness.reason = 'source-identity-matches';
  }

  if (freshness.status === 'unknown' && !freshness.reason) {
    freshness.reason = 'catalog-freshness-not-supplied';
  }
  return freshness;
}

module.exports = {
  assessProcessFreshness,
};
