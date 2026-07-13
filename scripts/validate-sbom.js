#!/usr/bin/env node
'use strict';

/**
 * Focused SBOM validation for release artifacts.
 * Usage: node scripts/validate-sbom.js <sbom.json> <expected-version>
 */

const fs = require('fs');
const path = require('path');

const file = process.argv[2];
const expectedVersion = process.argv[3];

if (!file || !expectedVersion) {
  console.error('Usage: node scripts/validate-sbom.js <sbom.json> <expected-version>');
  process.exit(1);
}

try {
  const sbom = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (sbom.bomFormat !== 'CycloneDX') throw new Error('bomFormat must be CycloneDX');
  const comp = sbom.metadata && sbom.metadata.component;
  if (!comp) throw new Error('missing metadata.component');
  if (comp.name !== 'zeus-rpg-promptkit') throw new Error('wrong package name: ' + comp.name);
  if (comp.version !== expectedVersion) throw new Error('wrong version: ' + comp.version);
  if (!Array.isArray(sbom.components) || sbom.components.length === 0)
    throw new Error('no components inventory');
  // no absolute local paths
  const str = JSON.stringify(sbom);
  if (/\/home\/|C:\\\\|\/Users\//.test(str)) throw new Error('SBOM contains local absolute paths');
  console.log('SBOM OK:', comp.name, comp.version, 'components:', sbom.components.length);
} catch (e) {
  console.error('SBOM VALIDATION FAILED:', e.message);
  process.exit(1);
}
