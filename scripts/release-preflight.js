#!/usr/bin/env node
'use strict';

/**
 * Release preflight checks for v0.2.0-beta.2 preparation.
 * Run locally or in release workflow.
 * Fails fast on any inconsistency.
 *
 * Usage:
 *   node scripts/release-preflight.js --version 0.2.0-beta.2
 *   npm run release:preflight -- --version 0.2.0-beta.2
 *
 * Does NOT:
 * - create tags, releases, or push
 * - modify files
 * - read secrets
 * - contact external systems like IBM i
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// No external semver dep added for release tooling. Use regex + basic checks.

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_NAME = 'zeus-rpg-promptkit';

function sh(cmd, opts = {}) {
  const res = spawnSync(cmd, { shell: true, cwd: ROOT, encoding: 'utf8', ...opts });
  return res;
}

function fail(msg) {
  console.error('RELEASE PREFLIGHT FAILED:', msg);
  process.exit(1);
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const requestedVersion = getArg('--version');
if (!requestedVersion) {
  fail('missing required --version argument');
}

console.log('Preflight for version:', requestedVersion);

// 1. package.json matches requested
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.version !== requestedVersion) {
  fail(`package.json version ${pkg.version} != requested ${requestedVersion}`);
}
if (pkg.name !== EXPECTED_NAME) {
  fail(`unexpected package name: ${pkg.name}`);
}

// 2. package-lock.json matches
const lockPath = path.join(ROOT, 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
if (lock.version !== requestedVersion) {
  fail(`package-lock.json version ${lock.version} != ${requestedVersion}`);
}
if (lock.packages && lock.packages[''] && lock.packages[''].version !== requestedVersion) {
  fail(`package-lock root version mismatch`);
}

// 3. valid semver and expected prerelease form for this series
const basicSemver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(requestedVersion);
if (!basicSemver) {
  fail('version is not valid semver');
}
if (!/-beta\.\d+$/.test(requestedVersion)) {
  fail('version is not the expected prerelease form (e.g. 0.2.0-beta.2)');
}

// 4. worktree clean
const status = sh('git status --porcelain');
if (status.stdout && status.stdout.trim().length > 0) {
  console.error('Dirty files:\n' + status.stdout);
  fail('worktree is dirty');
}

// 5. required release files present and contain target version
const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## [${requestedVersion}]`)) {
  fail('CHANGELOG.md does not contain target version section');
}

const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
if (!readme.includes(`Beta status (${requestedVersion})`)) {
  fail('README.md still claims previous beta as current');
}

// 6. package metadata basic consistency
if (!pkg.main || !pkg.exports || !pkg.bin) {
  fail('package metadata missing main/exports/bin');
}

// 7. simulate tarball name from npm pack (dry)
const packDry = sh('npm pack --dry-run --json 2>/dev/null || npm pack --dry-run 2>&1');
let tarballName = null;
try {
  const json = JSON.parse(packDry.stdout || '[]');
  if (Array.isArray(json) && json[0] && json[0].filename) {
    tarballName = json[0].filename;
  }
} catch (_) {
  const m = (packDry.stdout || '').match(/([a-z0-9-]+-\d+\.\d+\.\d+[^ ]*\.tgz)/i);
  if (m) tarballName = m[1];
}
const expectedTarball = `${EXPECTED_NAME}-${requestedVersion}.tgz`;
if (tarballName && tarballName !== expectedTarball) {
  fail(`tarball name ${tarballName} != expected ${expectedTarball}`);
}
console.log('Expected tarball:', expectedTarball);

// 8. inspect would-be contents for forbidden items (using dry-run or pack temp)
const listDry = sh(`npm pack --dry-run 2>&1 | cat`);
const forbidden = [
  '.env',
  'node_modules',
  '.git',
  '.local',
  'coverage',
  'test-output',
  'agent',
  'planning',
  'scratch',
  'token',
  'secret',
  'private',
];
for (const f of forbidden) {
  if (listDry.stdout && listDry.stdout.toLowerCase().includes(f.toLowerCase() + '/')) {
    // only warn on broad; actual tar will be checked in CI
    console.warn('Warning: possible sensitive path pattern in pack list:', f);
  }
}

// 9. local-only: basic remote tag/release absence can be checked by caller via gh
// (script itself avoids requiring gh token in all contexts)
if (hasFlag('--check-remote')) {
  // best effort, non-fatal if no gh
  const tagCheck = sh(
    `git ls-remote --exit-code --tags origin "refs/tags/v${requestedVersion}" 2>&1 || true`
  );
  if (tagCheck.status === 0) {
    fail(`target tag v${requestedVersion} already exists (remote)`);
  }
  const relCheck = sh(`gh release view v${requestedVersion} --json tagName 2>&1 || true`);
  if (relCheck.status === 0 && relCheck.stdout.includes(requestedVersion)) {
    fail(`target release v${requestedVersion} already exists`);
  }
}

console.log('RELEASE PREFLIGHT PASSED for', requestedVersion);
process.exit(0);
