#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const RUNTIME_COMPONENT_NAME = 'zeus-rpg-promptkit-jdbc-runtime';

function parseManifest(text) {
  const attributes = {};
  let activeKey = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith(' ') && activeKey) {
      attributes[activeKey] += line.slice(1);
      continue;
    }
    const separator = line.indexOf(':');
    if (separator <= 0) {
      activeKey = null;
      continue;
    }
    activeKey = line.slice(0, separator).trim();
    attributes[activeKey] = line.slice(separator + 1).trim();
  }
  return attributes;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJarComponent(filePath) {
  const archive = new AdmZip(filePath);
  const manifestEntry = archive.getEntry('META-INF/MANIFEST.MF');
  const manifest = manifestEntry ? parseManifest(archive.readAsText(manifestEntry)) : {};
  const fileName = path.basename(filePath);
  const properties = [{ name: 'zeus:runtime-jar', value: fileName }];
  if (manifest['Implementation-Title']) {
    properties.push({ name: 'zeus:manifest-title', value: manifest['Implementation-Title'] });
  }
  if (manifest['Implementation-Vendor']) {
    properties.push({ name: 'zeus:manifest-vendor', value: manifest['Implementation-Vendor'] });
  }
  return {
    type: 'library',
    name: path.basename(fileName, path.extname(fileName)),
    version: manifest['Implementation-Version'] || manifest['Specification-Version'] || 'unknown',
    hashes: [{ alg: 'SHA-256', content: sha256File(filePath) }],
    properties,
  };
}

function buildJdbcRuntimeSbom({ repoRoot, jarDirectory, version } = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot || path.resolve(__dirname, '..'));
  const resolvedJarDirectory = path.resolve(
    jarDirectory || path.join(resolvedRepoRoot, 'java', 'lib')
  );
  const jarFiles = fs.existsSync(resolvedJarDirectory)
    ? fs
        .readdirSync(resolvedJarDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.jar'))
        .map(entry => path.join(resolvedJarDirectory, entry.name))
        .sort((left, right) => left.localeCompare(right))
    : [];
  if (jarFiles.length === 0) {
    throw new Error(
      `No JDBC runtime JARs found in ${path.relative(resolvedRepoRoot, resolvedJarDirectory)}`
    );
  }

  const packageVersion = version || require(path.join(resolvedRepoRoot, 'package.json')).version;
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: RUNTIME_COMPONENT_NAME,
        version: packageVersion,
        properties: [{ name: 'zeus:scope', value: 'local-operator-installed-jdbc-runtime' }],
      },
    },
    components: jarFiles.map(readJarComponent),
  };
}

function writeJdbcRuntimeSbom({ repoRoot, outputPath, jarDirectory, version } = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot || path.resolve(__dirname, '..'));
  const resolvedOutputPath = path.resolve(
    outputPath || path.join(resolvedRepoRoot, 'output', 'jdbc-runtime.sbom.cdx.json')
  );
  const sbom = buildJdbcRuntimeSbom({ repoRoot: resolvedRepoRoot, jarDirectory, version });
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
  return { outputPath: resolvedOutputPath, sbom };
}

if (require.main === module) {
  try {
    const { outputPath, sbom } = writeJdbcRuntimeSbom();
    const repoRoot = path.resolve(__dirname, '..');
    console.log(
      `JDBC runtime SBOM written: ${path.relative(repoRoot, outputPath).replace(/\\/g, '/')}`
    );
    console.log(`Components: ${sbom.components.length}`);
  } catch (error) {
    console.error(`JDBC runtime SBOM generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  RUNTIME_COMPONENT_NAME,
  buildJdbcRuntimeSbom,
  parseManifest,
  readJarComponent,
  writeJdbcRuntimeSbom,
};
