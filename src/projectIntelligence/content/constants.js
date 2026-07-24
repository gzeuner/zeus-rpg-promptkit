'use strict';

/** Content-addressed object algorithm for Community default. */
const CONTENT_HASH_ALGORITHM = 'sha256';

/** Layout under the project-knowledge `content/` directory. */
const CONTENT_LAYOUT = Object.freeze({
  OBJECTS_DIR: 'objects',
  TMP_DIR: 'tmp',
  MANIFEST: 'content-manifest.json',
});

/** Default max payload size (64 MiB) for a single put. */
const DEFAULT_MAX_OBJECT_BYTES = 64 * 1024 * 1024;

/**
 * Garbage collection is design-only in ZPI-04.
 * Runtime GC execution is intentionally unavailable.
 */
const GC_STATUS = Object.freeze({
  DESIGN_ONLY: 'design-only',
  NOT_IMPLEMENTED: 'not-implemented',
});

module.exports = {
  CONTENT_HASH_ALGORITHM,
  CONTENT_LAYOUT,
  DEFAULT_MAX_OBJECT_BYTES,
  GC_STATUS,
};
