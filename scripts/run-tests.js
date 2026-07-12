#!/usr/bin/env node
/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

// Hermetic test runner.
//
// Two modes:
//   node scripts/run-tests.js --unit            # auto-discover the unit test set
//   node scripts/run-tests.js tests/a.test.js … # run the given files
//
// The run is HERMETIC by default: ZEUS_* environment variables are stripped so a
// developer's dot-sourced credentials cannot corrupt fixtures (secret-masking
// would otherwise redact leaked literal values — e.g. a source-file name — in
// output and break otherwise-passing tests). Opt out with ZEUS_TEST_KEEP_ENV=1.
//
// Flags:
//   --unit        Discover unit tests (tests/*.test.js minus the sets below).
//   --list        Print the resolved file list and exit.

const { readdirSync } = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const TESTS_DIR = path.join(PROJECT_ROOT, 'tests');

// Covered by test:contract / test:smoke / test:corpus / test:benchmark.
// Excluded from the auto-discovered unit set to avoid double execution.
const COVERED_BY_OTHER_SCRIPTS = new Set([
  // contract
  'analyze-run-manifest.test.js',
  'bundle-manifest.test.js',
  'fetch-readability-contract.test.js',
  'ai-knowledge-projection.test.js',
  'task-oriented-analysis-index.test.js',
  'workflow-presets.test.js',
  // smoke
  'v1-smoke.test.js',
  'safe-sharing.test.js',
  'reproducible-output.test.js',
  // corpus
  'scanner-corpus.test.js',
  // benchmark
  'analyze-benchmark.test.js',
]);

// Known-broken suites, excluded with a documented reason. Add entries here (with a
// one-line reason) if a suite is broken or requires a live connection. Currently empty.
const EXCLUDED_KNOWN_ISSUES = new Set([
  // (none)
]);

function discoverUnitTestFiles() {
  return readdirSync(TESTS_DIR)
    .filter(name => name.endsWith('.test.js'))
    .filter(name => !COVERED_BY_OTHER_SCRIPTS.has(name))
    .filter(name => !EXCLUDED_KNOWN_ISSUES.has(name))
    .sort()
    .map(name => path.posix.join('tests', name));
}

function main() {
  const argv = process.argv.slice(2);
  const listOnly = argv.includes('--list');
  const unitMode = argv.includes('--unit');
  const explicitFiles = argv.filter(arg => !arg.startsWith('--'));

  const files = unitMode ? discoverUnitTestFiles() : explicitFiles;

  if (files.length === 0) {
    process.stderr.write('run-tests: no test files to run (pass files or --unit).\n');
    process.exit(1);
  }

  if (listOnly) {
    process.stdout.write(`${files.length} test file(s):\n${files.join('\n')}\n`);
    return;
  }

  // Hermetic by default: strip ZEUS_* so leaked shell credentials can't corrupt
  // fixtures. Opt out with ZEUS_TEST_KEEP_ENV=1 when a test genuinely needs them.
  let childEnv = process.env;
  if (process.env.ZEUS_TEST_KEEP_ENV !== '1') {
    childEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('ZEUS_'))
    );
  }

  const result = spawnSync(process.execPath, ['--test', ...files], {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
    env: childEnv,
  });
  process.exit(result.status === null ? 1 : result.status);
}

main();
