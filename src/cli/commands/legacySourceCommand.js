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
'use strict';

const { createJsonOutput } = require('../helpers/jsonOutput');
const {
  DEFAULT_OUTPUT,
  runLegacySourceInventory,
} = require('../../legacySource/confidentialInventory');
const {
  DEFAULT_INVENTORY,
  DEFAULT_OUTPUT: DEFAULT_GRAPH_OUTPUT,
  runLegacySourceEvidenceGraph,
} = require('../../legacySource/confidentialEvidenceGraph');

function printHelp() {
  console.log('Confidential legacy-source commands (local-only):');
  console.log(
    `  zeus legacy-source inventory --source-root <local-root> [--out ${DEFAULT_OUTPUT}] [--json]`
  );
  console.log(
    `  zeus legacy-source graph --source-root <local-root> [--inventory ${DEFAULT_INVENTORY}] [--out ${DEFAULT_GRAPH_OUTPUT}] [--json]`
  );
  console.log('');
  console.log(
    'The source root is read-only. The result contains only anonymized counts and evidence.'
  );
  console.log('The output must stay inside .local/legacy-source-inventory/.');
}

function resultForError(error, operation = 'inventory') {
  const reasonCode = error && error.code ? String(error.code) : 'LEGACY_SOURCE_INVENTORY_FAILED';
  return {
    ok: false,
    kind: `legacy-source-${operation}-result`,
    status: 'failed',
    reasonCode,
    readOnly: true,
    safety: { level: 'S1', approvalRequired: false, sideEffects: ['local-read'] },
    scope: { origin: 'local-source-boundary', pathDisclosure: 'none', contentDisclosure: 'none' },
    evidence: { available: false, complete: false, count: 0 },
    artifacts: [],
    warnings: [reasonCode],
    nextCommands: ['node cli/zeus.js legacy-source --help'],
    approvalRequired: false,
  };
}

function printHumanSummary(result) {
  const summary = result.summary || {};
  console.log(`Status: ${result.status}`);
  console.log(
    `${result.kind.includes('graph') ? 'Graph nodes' : 'Candidate files'}: ${
      result.kind.includes('graph') ? summary.nodeCount || 0 : summary.candidateFiles || 0
    }`
  );
  console.log(
    `${result.kind.includes('graph') ? 'Graph edges' : 'Evidence entries'}: ${
      result.kind.includes('graph')
        ? summary.edgeCount || 0
        : result.evidence
          ? result.evidence.count
          : 0
    }`
  );
  console.log(`Artifact: ${(result.artifacts || [])[0] || '(none)'}`);
  if (result.warnings && result.warnings.length > 0)
    console.log(`Warnings: ${result.warnings.join(', ')}`);
}

async function runLegacySource(args = {}) {
  const positional = Array.isArray(args._) ? args._ : [];
  const subcommand = String(positional[0] || 'help')
    .trim()
    .toLowerCase();
  const json = createJsonOutput(args);
  if (!subcommand || subcommand === 'help' || args.help === true || args.h === true) {
    printHelp();
    return { ok: true, operation: 'help' };
  }
  if (subcommand !== 'inventory' && subcommand !== 'graph') {
    const result = resultForError({ code: 'LEGACY_SOURCE_INVALID_ARGUMENTS' });
    if (json.isJsonMode) json.print(result);
    else
      console.error(
        `[${result.reasonCode}] legacy-source inventory or graph arguments are required.`
      );
    process.exitCode = 2;
    return result;
  }
  try {
    const result =
      subcommand === 'inventory'
        ? runLegacySourceInventory({
            sourceRoot: args['source-root'],
            workspaceRoot: process.cwd(),
            out: args.out || DEFAULT_OUTPUT,
          })
        : runLegacySourceEvidenceGraph({
            sourceRoot: args['source-root'],
            workspaceRoot: process.cwd(),
            inventory: args.inventory || DEFAULT_INVENTORY,
            out: args.out || DEFAULT_GRAPH_OUTPUT,
          });
    if (json.isJsonMode) json.print(result);
    else printHumanSummary(result);
    return result;
  } catch (error) {
    const result = resultForError(error, subcommand);
    if (json.isJsonMode) json.print(result);
    else console.error(`[${result.reasonCode}] local legacy-source ${subcommand} was not created.`);
    process.exitCode = 2;
    return result;
  }
}

module.exports = { printHelp, runLegacySource };
