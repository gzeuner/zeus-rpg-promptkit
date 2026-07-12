#!/usr/bin/env node
'use strict';

/**
 * Repository path portability check.
 * Rejects tracked paths containing Windows-invalid characters or reserved names.
 *
 * Windows forbids in paths:
 *   < > : " / \ | ? *
 *   and reserved basenames: CON, PRN, AUX, NUL, COM1-9, LPT1-9 (with or without extension)
 *   also trailing . or space in basename.
 *
 * Run via: npm run check:repo-portability
 * Integrated into CI quality gate.
 */

const { execSync } = require('child_process');

const RESERVED_BASENAMES = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\..*)?$/i;

function isWindowsInvalidPath(filePath) {
  // Check for forbidden characters anywhere in path
  if (/[<>:"|?*]/.test(filePath)) {
    return { invalid: true, reason: 'contains Windows-forbidden characters (< > : " | ? *)' };
  }

  // Check each path segment (basename)
  const segments = filePath.split(/[\\/]/);
  for (const seg of segments) {
    if (!seg) continue;
    // trailing dot or space
    if (/[\s.]$/.test(seg)) {
      return {
        invalid: true,
        reason: `basename "${seg}" ends with dot or space (invalid on Windows)`,
      };
    }
    const base = seg.split('.')[0]; // for reserved check, before ext? but reserved even with .ext
    if (RESERVED_BASENAMES.test(seg) || RESERVED_BASENAMES.test(base)) {
      return { invalid: true, reason: `uses Windows reserved name "${seg}"` };
    }
  }

  return { invalid: false };
}

function main() {
  let tracked;
  try {
    const out = execSync('git ls-files -z', { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 });
    tracked = out.toString('utf8').split('\0').filter(Boolean);
  } catch (e) {
    console.error('check:repo-portability: failed to list tracked files:', e.message);
    process.exit(1);
  }

  const bad = [];
  for (const p of tracked) {
    const check = isWindowsInvalidPath(p);
    if (check.invalid) {
      bad.push({ path: p, reason: check.reason });
    }
  }

  if (bad.length > 0) {
    console.error('Repository contains tracked paths that are invalid on Windows:');
    for (const b of bad) {
      console.error(`  ${b.path} — ${b.reason}`);
    }
    console.error('\nRemove these from Git tracking (git rm --cached) and add ignore rules.');
    console.error('See examples/demo-rpg-mini-system/output/.zeus-cache/ for previous offenders.');
    process.exit(1);
  }

  console.log(`check:repo-portability: OK (${tracked.length} tracked paths are Windows-portable)`);
}

main();
