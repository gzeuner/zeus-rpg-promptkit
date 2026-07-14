#!/usr/bin/env node
'use strict';

/**
 * Package smoke test (pkg 10).
 * Proves packed tarball can be installed and basic ops work.
 * Exits 0 on success for CI gate.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-smoke-'));
const PACK_DIR = path.join(TMP, 'pack');
const EXPECTED_VERSION = require('../package.json').version;

function sh(cmd, cwd = ROOT) {
  console.log('$ ' + cmd);
  const r = spawnSync(cmd, { shell: true, cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error('failed: ' + cmd);
  }
  return r.stdout || '';
}

function runInstalled(file, args, cwd) {
  console.log('$ ' + [file, ...args].join(' '));
  const result = spawnSync(file, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    throw new Error('failed installed executable: ' + file + ' ' + args.join(' '));
  }
  return result.stdout || '';
}

try {
  fs.mkdirSync(PACK_DIR, { recursive: true });

  // pack
  sh('npm pack --pack-destination ' + PACK_DIR);
  const tgzs = fs.readdirSync(PACK_DIR).filter(f => f.endsWith('.tgz'));
  if (!tgzs.length) throw new Error('no tgz');
  const tgz = path.join(PACK_DIR, tgzs[0]);
  console.log('packed', tgz);

  // install test in subdir
  const inst = path.join(TMP, 'i');
  fs.mkdirSync(inst, { recursive: true });
  sh('npm init -y', inst);
  sh('npm install --no-audit --no-fund ' + tgz, inst);

  // Strictly verify the executable and public API from the temporary installation.
  const binName = process.platform === 'win32' ? 'zeus.cmd' : 'zeus';
  const bin = path.join(inst, 'node_modules', '.bin', binName);
  const resolvedBin = fs.realpathSync(bin);
  const installedNodeModules = path.join(inst, 'node_modules') + path.sep;
  if (!resolvedBin.startsWith(installedNodeModules)) {
    throw new Error('installed executable resolves outside temporary installation: ' + resolvedBin);
  }
  const longHelp = runInstalled(bin, ['--help'], inst);
  const shortHelp = runInstalled(bin, ['-h'], inst);
  if (!/Usage:\s*\n\s*zeus /.test(longHelp) || !/Usage:\s*\n\s*zeus /.test(shortHelp)) {
    throw new Error('installed help output is missing top-level usage');
  }
  sh(
    "node -e \"const p=require('zeus-rpg-promptkit/package.json');" +
      `if(p.version!=='${EXPECTED_VERSION}') process.exit(1);` +
      "require('zeus-rpg-promptkit/api')\"",
    inst
  );

  console.log('PACKAGE SMOKE PASSED');
} catch (_e) {
  console.error('SMOKE FAIL:', _e.message);
  process.exit(1);
} finally {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (_) {}
}
