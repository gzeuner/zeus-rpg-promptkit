'use strict';

/** Provider-neutral side effects understood by the public Capability Registry. */
const CAPABILITY_SIDE_EFFECTS = Object.freeze([
  'local-artifact-write',
  'local-config-write',
  'local-listener',
  'local-process-stdio',
  'local-read',
  'local-secret-write',
  'operator-gated',
  'remote-read',
  'remote-write',
]);

module.exports = { CAPABILITY_SIDE_EFFECTS };
