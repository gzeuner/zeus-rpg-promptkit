'use strict';

/**
 * Garbage collection design for the Community content store (ZPI-04).
 *
 * Runtime GC is intentionally NOT implemented in this package.
 * This module freezes the design contract so later packages can implement
 * collection without changing content-address identity rules.
 *
 * Design summary:
 * 1. Content objects are immutable and content-addressed (sha256).
 * 2. Live set = union of content hashes referenced by:
 *    - published snapshots' source units / evidence meta
 *    - optional building snapshot still under writer lock
 * 3. Unreferenced objects become GC candidates only after:
 *    - no current or building snapshot references them
 *    - optional grace period (not configured in v1)
 * 4. GC must never delete an object that is being written (tmp/ staging)
 *    or that fails hash verification (quarantine instead).
 * 5. GC execution requires an exclusive writer lock on the knowledge root.
 * 6. Quarantine path: move corrupt objects to `quarantine/` rather than silent delete.
 *
 * @module projectIntelligence/content/gcDesign
 */

const { GC_STATUS } = require('./constants');
const { fail, REASON_CODES } = require('../store/errors');

/**
 * Describe the GC design (no side effects).
 */
function describeContentGarbageCollection() {
  return {
    status: GC_STATUS.DESIGN_ONLY,
    algorithm: 'mark-and-sweep-by-hash-reference',
    hashAlgorithm: 'sha256',
    liveReferenceSources: [
      'snapshots.source_units.content_hash',
      'snapshots.evidence_meta.content_hash',
      'optional in-progress building snapshot under writer lock',
    ],
    deletionPolicy: 'unreferenced-after-grace',
    quarantinePolicy: 'hash-mismatch-or-corrupt-to-quarantine',
    requiresWriterLock: true,
    implemented: false,
  };
}

/**
 * Runtime GC entry point — fail closed until a later approved package.
 */
function runContentGarbageCollection() {
  fail(
    REASON_CODES.OPERATION_UNAVAILABLE,
    'content garbage collection is design-only in ZPI-04 and is not implemented'
  );
}

module.exports = {
  describeContentGarbageCollection,
  runContentGarbageCollection,
  GC_STATUS,
};
