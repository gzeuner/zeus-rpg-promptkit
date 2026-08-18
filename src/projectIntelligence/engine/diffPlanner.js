'use strict';

const { inventoryUnitKey, hashInventory } = require('./inventory');

/**
 * Classify source units as added / changed / deleted / unchanged.
 * Identity key: trustedRootId + relativePath.
 * Content changes and provenance/observation changes are tracked separately.
 *
 * @param {Array<object>} previousUnits from last published snapshot (no _canonicalBytes needed)
 * @param {Array<object>} nextUnits from current inventory scan
 */
function planInventoryDiff(previousUnits = [], nextUnits = []) {
  const prevMap = new Map();
  for (const u of previousUnits) {
    prevMap.set(inventoryUnitKey(u), u);
  }
  const nextMap = new Map();
  for (const u of nextUnits) {
    nextMap.set(inventoryUnitKey(u), u);
  }

  const added = [];
  const changed = [];
  const unchanged = [];
  const deleted = [];

  for (const [key, next] of nextMap) {
    const prev = prevMap.get(key);
    if (!prev) {
      added.push(next);
    } else if (
      prev.contentHash !== next.contentHash ||
      prev.provenanceHash !== next.provenanceHash ||
      prev.importObservationHash !== next.importObservationHash
    ) {
      changed.push({
        previous: prev,
        next,
        contentChanged: prev.contentHash !== next.contentHash,
        provenanceChanged: prev.provenanceHash !== next.provenanceHash,
        importObservationChanged: prev.importObservationHash !== next.importObservationHash,
      });
    } else {
      unchanged.push({ previous: prev, next });
    }
  }
  for (const [key, prev] of prevMap) {
    if (!nextMap.has(key)) {
      deleted.push(prev);
    }
  }

  // Deterministic ordering
  const byPath = (a, b) => {
    const ua = a.next || a.previous || a;
    const ub = b.next || b.previous || b;
    return inventoryUnitKey(ua).localeCompare(inventoryUnitKey(ub));
  };
  added.sort((a, b) => inventoryUnitKey(a).localeCompare(inventoryUnitKey(b)));
  changed.sort(byPath);
  unchanged.sort(byPath);
  deleted.sort((a, b) => inventoryUnitKey(a).localeCompare(inventoryUnitKey(b)));

  return {
    added,
    changed,
    deleted,
    unchanged,
    counts: {
      added: added.length,
      changed: changed.length,
      deleted: deleted.length,
      unchanged: unchanged.length,
      previous: previousUnits.length,
      next: nextUnits.length,
    },
    previousInventoryHash: hashInventory(previousUnits),
    nextInventoryHash: hashInventory(nextUnits),
    isNoOp:
      added.length === 0 &&
      changed.length === 0 &&
      deleted.length === 0 &&
      previousUnits.length === nextUnits.length,
  };
}

module.exports = {
  planInventoryDiff,
};
