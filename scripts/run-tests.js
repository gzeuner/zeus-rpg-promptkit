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
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const { spawnSync } = require('child_process');
const { inspectInventory, printSummary } = require('./test-inventory');
const { createEvidenceCollector } = require('./test-evidence-reporter');

const PROJECT_ROOT = path.join(__dirname, '..');
const CATEGORY_FLAGS = ['unit', 'contract', 'smoke', 'corpus', 'benchmark', 'quality', 'resource'];

function createTestEnvironment(parent, homeDir) {
  const allowed = new Set([
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'WINDIR',
    'COMSPEC',
    'JAVA_HOME',
    'NUMBER_OF_PROCESSORS',
    'OS',
    'PROCESSOR_ARCHITECTURE',
    'CI',
    'NPM_EXECPATH',
  ]);
  return {
    ...Object.fromEntries(Object.entries(parent).filter(([key]) => allowed.has(key.toUpperCase()))),
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: homeDir,
    LOCALAPPDATA: homeDir,
    TMPDIR: homeDir,
    TMP: homeDir,
    TEMP: homeDir,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
  };
}

function completeTestEvidence(text, status, files, selection) {
  let evidence;
  try {
    evidence = JSON.parse(text);
    if (
      evidence.kind !== 'zeus-test-evidence' ||
      !Array.isArray(evidence.results) ||
      !evidence.counts
    )
      throw new Error('Invalid test evidence');
  } catch {
    evidence = createEvidenceCollector().report();
    evidence.reason = 'REPORTER_DID_NOT_COMPLETE';
    status = 1;
  }
  evidence.runStatus = status === 0 ? 'passed' : 'failed';
  evidence.selection = selection;
  evidence.unreported = files
    .filter(file => !evidence.results.some(row => row.file === file))
    .map(file => ({
      file,
      status: 'not_available',
      reason: 'TEST_FILE_NOT_REPORTED',
      requirement: 'MAINTAINED-TESTS',
    }));
  if (evidence.unreported.length || !evidence.counts.executed) evidence.runStatus = 'failed';
  return evidence;
}

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
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-test-home-'));
  try {
    const reportPath = path.join(homeDir, 'evidence.json');
    const result = spawnSync(
      process.execPath,
      [
        '--test',
        '--test-reporter=spec',
        '--test-reporter-destination=stdout',
        '--test-reporter=./scripts/test-evidence-reporter.js',
        `--test-reporter-destination=${reportPath}`,
        ...files,
      ],
      {
        stdio: 'inherit',
        cwd: PROJECT_ROOT,
        env: createTestEnvironment(process.env, homeDir),
      }
    );
    let reportText;
    try {
      reportText = fs.readFileSync(reportPath, 'utf8');
    } catch {
      reportText = undefined;
    }
    const evidence = completeTestEvidence(
      reportText,
      result.status,
      files,
      selectedCategories[0] || 'selected'
    );
    process.exitCode = evidence.runStatus === 'passed' ? 0 : 1;
    const evidenceDir = path.join(PROJECT_ROOT, 'output', 'test-evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const name = `${process.platform}-node${process.versions.node.split('.')[0]}-${evidence.selection}-${randomUUID()}.json`;
    fs.writeFileSync(path.join(evidenceDir, name), `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`Test evidence: output/test-evidence/${name}\n`);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

if (require.main === module) main();
module.exports = { createTestEnvironment, completeTestEvidence };
