#!/usr/bin/env node
'use strict';

/**
 * Guard intentionally versioned neutral fixtures and demo artifacts against
 * broad ignore-rule regressions. A clean checkout/rebuild must keep these
 * files available for documentation, tests and reproducible examples.
 *
 * Run via: npm run check:tracked-fixtures
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_TRACKED_PATHS = [
  'docs/ai/ai-knowledge-projection.md',
  'tests/fixtures/sanitized-corpus/prompt/workflow-ai-knowledge.json',
  'tests/fixtures/prompt-contracts/orderpgm-ai-knowledge.json',
  'examples/demo-rpg-mini-system/rpg_sources/QCLLESRC/DRIVER_100.clle',
  'examples/demo-rpg-mini-system/rpg_sources/QDDSSRC/FILE_100.pf',
  'examples/demo-rpg-mini-system/rpg_sources/QDDSSRC/FILE_200.lf',
  'examples/demo-rpg-mini-system/rpg_sources/QSQLSRC/TABLE_100.sql',
  'examples/demo-rpg-mini-system/rpg_sources/QRPGLESRC/PROGRAM_100.rpgle',
  'examples/demo-rpg-mini-system/rpg_sources/QRPGLESRC/PROGRAM_200.sqlrpgle',
  'examples/demo-rpg-mini-system/output-baseline/PROGRAM_100/ai-knowledge.json',
  'examples/demo-rpg-mini-system/output-baseline/PROGRAM_100/architecture-report.md',
  'examples/demo-rpg-mini-system/output-baseline/PROGRAM_100/canonical-analysis.json',
  'examples/demo-rpg-mini-system/output-baseline/PROGRAM_100/context.json',
  'examples/demo-rpg-mini-system/output-baseline/PROGRAM_100/dependency-graph.mmd',
  'examples/demo-rpg-mini-system/output-baseline/PROGRAM_100/optimized-context.json',
  'examples/demo-rpg-mini-system/output-baseline/PROGRAM_100/report.md',
  'examples/demo-rpg-mini-system/templates/ai-session-prompt.template.md',
];

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function isIgnored(filePath) {
  try {
    git(['check-ignore', '--no-index', '--quiet', '--', filePath]);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

function main() {
  const tracked = new Set(git(['ls-files', '-z']).split('\0').filter(Boolean));
  const missing = [];
  const untracked = [];
  const ignored = [];

  for (const filePath of EXPECTED_TRACKED_PATHS) {
    if (!fs.existsSync(path.join(ROOT, filePath))) missing.push(filePath);
    if (!tracked.has(filePath)) untracked.push(filePath);
    if (isIgnored(filePath)) ignored.push(filePath);
  }

  if (missing.length || untracked.length || ignored.length) {
    console.error('Tracked fixture guard failed:');
    if (missing.length)
      console.error(`Missing files:\n${missing.map(file => `  - ${file}`).join('\n')}`);
    if (untracked.length)
      console.error(`Not tracked by Git:\n${untracked.map(file => `  - ${file}`).join('\n')}`);
    if (ignored.length)
      console.error(`Still ignored by Git:\n${ignored.map(file => `  - ${file}`).join('\n')}`);
    process.exit(1);
  }

  console.log(`Tracked fixture guard passed (${EXPECTED_TRACKED_PATHS.length} paths).`);
}

main();
