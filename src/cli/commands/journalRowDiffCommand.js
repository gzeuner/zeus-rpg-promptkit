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

const fs = require('fs');
const path = require('path');
const { createJsonOutput } = require('../helpers/jsonOutput');
const {
  resolveAnalyzeConfig,
  resolveAnalyzeDbConfig,
  loadProfiles,
  resolveProfile,
} = require('../../config/runtimeConfig');
const { isDbConfigured } = require('../../db2/db2Config');
const {
  parseColumnList,
  parseLayout,
  runJournalRowDiff,
} = require('../../db2/journalRowDiffService');
const { printDbRuntimeConflictWarnings } = require('../helpers/runtimeConfigWarnings');

function parsePositiveInt(value, fallback, allowZero = false) {
  const parsed = Number.parseInt(String(value === undefined ? fallback : value).trim(), 10);
  if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new Error(`Invalid numeric option: ${value}`);
  }
  return parsed;
}

function renderSummary(result) {
  console.log(`Status: ${result.status}`);
  console.log(`Journal entries read: ${result.entriesRead}`);
  console.log(`Before/after pairs: ${result.pairsFormed}`);
  console.log(`Unpaired: ${result.unpairedCount} | Decode errors: ${result.decodeErrors}`);
  const validation = result.keyValidation || {};
  console.log(
    `Key validation: ${validation.matched || 0}/${validation.sampled || 0} ` +
      `(${((validation.matchRate || 0) * 100).toFixed(1)}%)`
  );
  const diff = result.diff || {};
  console.log(`No-op updates: ${diff.noOpCount || 0}`);
  console.log(`Content changes: ${diff.contentChangeCount || 0}`);
  const changedColumns = Object.entries(diff.changedColumnCounts || {});
  if (changedColumns.length > 0) {
    console.log('Changed columns:');
    changedColumns
      .sort((left, right) => right[1] - left[1])
      .forEach(([name, count]) => console.log(`  ${name}: ${count}`));
  }
  if (Array.isArray(result.warnings) && result.warnings.length > 0) {
    console.log('Warnings:');
    result.warnings.forEach(warning => console.log(`  ${warning}`));
  }
}

async function runJournalRowDiffCommand(args) {
  if (!args.profile || !args.start || !args.end) {
    console.error('Required options: --profile, --start and --end.');
    process.exit(2);
  }
  const required = ['journal-library', 'journal-name', 'layout', 'key-columns', 'audit-query'];
  const missing = required.filter(key => !args[key]);
  if (missing.length > 0) {
    console.error(`Missing required options: ${missing.map(key => `--${key}`).join(', ')}.`);
    process.exit(2);
  }

  let layout;
  let keyColumns;
  let ignoreColumns = [];
  let maxPairs;
  let ccsid;
  let toleranceSeconds;
  try {
    layout = parseLayout(args.layout);
    keyColumns = parseColumnList(args['key-columns'], 'key column', layout);
    if (args['ignore-columns'])
      ignoreColumns = parseColumnList(args['ignore-columns'], 'ignored column', layout);
    maxPairs = parsePositiveInt(args['max-pairs'], 50000);
    ccsid = parsePositiveInt(args.ccsid, 273);
    toleranceSeconds = parsePositiveInt(args['tolerance-seconds'], 5, true);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  try {
    const profiles = loadProfiles({ cwd: process.cwd(), env: process.env, args });
    const profile = resolveProfile(profiles, args.profile, { env: process.env });
    if (profile && profile.productionSystem) {
      console.warn('WARNING: selected profile is marked as productionSystem=true.');
    }
    const config = resolveAnalyzeConfig(args, { cwd: process.cwd() });
    const dbConfig = resolveAnalyzeDbConfig(config, 'metadata');
    printDbRuntimeConflictWarnings(dbConfig);
    if (!isDbConfigured(dbConfig)) {
      console.error('DB2 connection configuration is incomplete for the selected profile.');
      process.exit(2);
    }
    const result = runJournalRowDiff({
      dbConfig,
      journalLibrary: args['journal-library'],
      journalName: args['journal-name'],
      start: args.start,
      end: args.end,
      maxPairs,
      auditQuery: args['audit-query'],
      layout,
      keyColumns,
      ignoreColumns,
      ccsid,
      toleranceSeconds,
    });
    if (args.save) {
      const savePath = path.resolve(process.cwd(), String(args.save));
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
      fs.writeFileSync(savePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      console.log(`Saved: ${savePath}`);
    }
    const json = createJsonOutput(args);
    if (json.isJsonMode) {
      json.print(result);
      if (result.status === 'VALIDATION_FAILED') process.exitCode = 3;
      return;
    }
    renderSummary(result);
    if (result.status === 'VALIDATION_FAILED') process.exit(3);
  } catch (error) {
    console.error(`Journal row diff failed: ${error.message}`);
    process.exit(2);
  }
}

module.exports = {
  renderSummary,
  runJournalRowDiffCommand,
};
