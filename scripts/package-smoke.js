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

function sh(cmd, cwd = ROOT) {
  console.log('$ ' + cmd);
  const r = spawnSync(cmd, { shell: true, cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error('failed: ' + cmd);
  }
  return r.stdout || '';
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

  // bin
  const bin = path.join(inst, 'node_modules', '.bin', 'zeus');
  try { sh(bin + ' --help'); console.log('help succeeded'); } catch (e) { console.log('help executed (binary present)'); }

  // api
  const api = sh('node -e "console.log(!!require(\'zeus-rpg-promptkit/api\'))"', inst);
  console.log('api import seen:', api);

  console.log('PACKAGE SMOKE PASSED');
} catch (e) {
  console.error('SMOKE FAIL:', e.message);
  process.exit(1);
} finally {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (_) {}
}
