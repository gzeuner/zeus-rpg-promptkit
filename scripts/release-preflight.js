#!/usr/bin/env node
'use strict';

/**
 * Read-only preflight for a requested release version.
 * It never creates a tag, release, artifact attestation, or publication.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_NAME = 'zeus-rpg-promptkit';

function run(file, args, options = {}) {
  return spawnSync(file, args, {
    cwd: ROOT,
    encoding: 'utf8',
    ...options,
  });
}

function fail(message) {
  console.error('RELEASE PREFLIGHT FAILED:', message);
  process.exit(1);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

const requestedVersion = argument('--version');
const checkRemote = process.argv.includes('--check-remote');
if (!requestedVersion) fail('missing required --version argument');
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(requestedVersion)) {
  fail('version is not valid semantic version syntax');
}

console.log('Preflight for version:', requestedVersion);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
if (pkg.name !== EXPECTED_NAME) fail(`unexpected package name: ${pkg.name}`);
if (pkg.version !== requestedVersion) {
  fail(`package.json version ${pkg.version} != requested ${requestedVersion}`);
}
if (lock.version !== requestedVersion || lock.packages?.['']?.version !== requestedVersion) {
  fail('package-lock version does not match the requested version');
}
if (!pkg.main || !pkg.exports || !pkg.bin) fail('package metadata missing main/exports/bin');

const status = run('git', ['status', '--porcelain']);
if (status.status !== 0) fail('unable to inspect worktree status');
if (status.stdout.trim()) {
  console.error(`Dirty files:\n${status.stdout}`);
  fail('worktree is dirty');
}

const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## [${requestedVersion}]`)) {
  fail('CHANGELOG.md does not contain the target version section');
}
const releaseNotes = path.join(ROOT, '.github', `RELEASE_NOTES_v${requestedVersion}.md`);
if (!fs.existsSync(releaseNotes)) fail('versioned release notes are missing');

const packDry = run('npm', ['pack', '--dry-run', '--json']);
if (packDry.status !== 0) fail('npm pack dry run failed');
let packResult;
try {
  packResult = JSON.parse(packDry.stdout);
} catch {
  fail('npm pack dry run did not return JSON');
}
const expectedTarball = `${EXPECTED_NAME}-${requestedVersion}.tgz`;
if (!Array.isArray(packResult) || packResult.length !== 1) fail('unexpected npm pack result');
if (packResult[0].filename !== expectedTarball) {
  fail(`tarball name ${packResult[0].filename} != expected ${expectedTarball}`);
}
const packedPaths = (packResult[0].files || []).map(entry => entry.path);
const forbiddenPrefixes = ['.github/', '.git/', '.local/', 'node_modules/', 'coverage/'];
for (const prefix of forbiddenPrefixes) {
  if (packedPaths.some(file => file === prefix.slice(0, -1) || file.startsWith(prefix))) {
    fail(`package would include forbidden path: ${prefix}`);
  }
}
console.log('Expected tarball:', expectedTarball);

if (checkRemote) {
  const tag = `v${requestedVersion}`;
  const tagCheck = run('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`]);
  if (tagCheck.status === 0) fail(`target tag ${tag} already exists`);
  if (tagCheck.status !== 2) fail('unable to determine whether the target tag exists');

  const releaseCheck = run('gh', ['api', `repos/gzeuner/zeus-rpg-promptkit/releases/tags/${tag}`]);
  if (releaseCheck.status === 0) fail(`target release ${tag} already exists`);
  if (!/HTTP 404/.test(releaseCheck.stderr)) {
    fail('unable to determine whether the target release exists');
  }
}

console.log('RELEASE PREFLIGHT PASSED for', requestedVersion);
