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
See the License for the specific language governing permissions and
limitations under the License.
*/
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { inspectInventory, printSummary } = require('./test-inventory');

const PROJECT_ROOT = path.join(__dirname, '..');
const CATEGORY_FLAGS = ['unit', 'contract', 'smoke', 'corpus', 'benchmark', 'quality'];

function main() {
  const argv = process.argv.slice(2);
  const listOnly = argv.includes('--list');
  const selectedCategories = CATEGORY_FLAGS.filter(name => argv.includes(`--${name}`));
  const explicitFiles = argv
    .filter(arg => !arg.startsWith('--'))
    .map(file => file.split(path.sep).join('/'));
  const report = inspectInventory();
  printSummary(report);
  if (report.errors.length) {
    process.stderr.write(
      `run-tests: discovery integrity failed:\n${report.errors.map(error => `- ${error}`).join('\n')}\n`
    );
    process.exit(1);
  }
  if (selectedCategories.length > 1) {
    process.stderr.write('run-tests: select exactly one primary category.\n');
    process.exit(1);
  }

  const files = selectedCategories.length
    ? report.categories[selectedCategories[0]]
    : explicitFiles;
  if (files.length === 0) {
    process.stderr.write('run-tests: no test files to run (pass files or one category flag).\n');
    process.exit(1);
  }
  for (const file of files) {
    if (!report.maintained.includes(file)) {
      process.stderr.write(`run-tests: file is not a maintained test: ${file}\n`);
      process.exit(1);
    }
  }

  if (listOnly) {
    process.stdout.write(`Selected test files: ${files.length}\n${[...files].sort().join('\n')}\n`);
    return;
  }

  process.stdout.write(`Maintained test files executed by this command: ${files.length}\n`);
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
