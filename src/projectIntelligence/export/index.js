'use strict';

const portable = require('./portableSnapshotPackage');

module.exports = {
  PORTABLE_PACKAGE_SCHEMA: portable.PORTABLE_PACKAGE_SCHEMA,
  PORTABLE_PACKAGE_KIND: portable.PORTABLE_PACKAGE_KIND,
  exportPortableSnapshotPackage: portable.exportPortableSnapshotPackage,
  openPortableSnapshotPackage: portable.openPortableSnapshotPackage,
  stripAbsolutePathsDeep: portable.stripAbsolutePathsDeep,
};
