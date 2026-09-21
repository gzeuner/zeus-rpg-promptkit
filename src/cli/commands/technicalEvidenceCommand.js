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

const fs = require('node:fs');
const path = require('node:path');
const { createJsonOutput } = require('../helpers/jsonOutput');
const {
  buildTechnicalEvidenceContext,
  TechnicalEvidenceContextError,
} = require('../../context/technicalEvidenceContext');

const DEFAULT_INPUT = '.local/technical-evidence/evidence-graph.json';
const DEFAULT_OUTPUT = '.local/technical-evidence/context.json';

function printHelp() {
  console.log('Technical evidence context commands (local-only):');
  console.log(
    `  zeus technical-evidence context --input <relative-anonymized-graph> [--out ${DEFAULT_OUTPUT}] [--goal-code <code>] [--target-id <opaque-id[,opaque-id...]>] [--max-nodes <n>] [--max-edges <n>] [--token-budget <n>] [--json]`
  );
  console.log('');
  console.log('The input must already satisfy the anonymized technical-evidence boundary.');
  console.log('No source text, paths, names, credentials, or business terms are accepted.');
}

function resolveWorkspaceFile(value, fallback) {
  const relative = String(value || fallback).trim();
  if (!relative || path.isAbsolute(relative)) {
    const error = new TechnicalEvidenceContextError(
      'TECHNICAL_EVIDENCE_PATH_UNSAFE',
      'input and output must be relative workspace files'
    );
    throw error;
  }
  const workspaceRoot = path.resolve(process.cwd());
  const absolute = path.resolve(workspaceRoot, relative);
  const withinWorkspace =
    absolute === workspaceRoot || absolute.startsWith(`${workspaceRoot}${path.sep}`);
  if (!withinWorkspace) {
    throw new TechnicalEvidenceContextError(
      'TECHNICAL_EVIDENCE_PATH_UNSAFE',
      'input and output must stay inside the workspace'
    );
  }
  return { absolute, relative: path.relative(workspaceRoot, absolute).split(path.sep).join('/') };
}

function readEvidence(inputPath) {
  let text;
  try {
    text = fs.readFileSync(inputPath.absolute, 'utf8');
  } catch (_) {
    throw new TechnicalEvidenceContextError(
      'TECHNICAL_EVIDENCE_INPUT_UNAVAILABLE',
      'an anonymized technical-evidence input is required'
    );
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new TechnicalEvidenceContextError(
      'TECHNICAL_EVIDENCE_INPUT_INVALID',
      'the technical-evidence input is not valid JSON'
    );
  }
}

function resultForError(error) {
  const reasonCode = error && error.code ? String(error.code) : 'TECHNICAL_EVIDENCE_CONTEXT_FAILED';
  return {
    ok: false,
    kind: 'technical-evidence-context-result',
    status: 'failed',
    reasonCode,
    readOnly: true,
    safety: { level: 'S1', approvalRequired: false, sideEffects: ['local-read'] },
    scope: {
      origin: 'local-anonymized-evidence',
      pathDisclosure: 'none',
      contentDisclosure: 'none',
    },
    artifacts: [],
    warnings: [reasonCode],
    approvalRequired: false,
  };
}

function printHumanSummary(result) {
  console.log(`Status: ${result.status}`);
  if (result.context) {
    console.log(`Context nodes: ${result.context.evidence.nodeCount}`);
    console.log(`Context edges: ${result.context.evidence.edgeCount}`);
    console.log(`Complete: ${result.context.uncertainty.complete ? 'yes' : 'no'}`);
    console.log(`Warnings: ${result.context.uncertainty.warningCodes.join(', ') || '(none)'}`);
  }
  console.log(`Artifact: ${(result.artifacts || [])[0] || '(none)'}`);
  if (result.warnings && result.warnings.length > 0)
    console.log(`Warnings: ${result.warnings.join(', ')}`);
}

async function runTechnicalEvidence(args = {}) {
  const positional = Array.isArray(args._) ? args._ : [];
  const subcommand = String(positional[0] || 'help')
    .trim()
    .toLowerCase();
  const json = createJsonOutput(args);
  if (!subcommand || subcommand === 'help' || args.help === true || args.h === true) {
    printHelp();
    return { ok: true, operation: 'help' };
  }
  if (subcommand !== 'context') {
    const result = resultForError({ code: 'TECHNICAL_EVIDENCE_INVALID_ARGUMENTS' });
    if (json.isJsonMode) json.print(result);
    else console.error(`[${result.reasonCode}] technical-evidence context is required.`);
    process.exitCode = 2;
    return result;
  }

  try {
    const input = resolveWorkspaceFile(args.input, DEFAULT_INPUT);
    const output = resolveWorkspaceFile(args.out, DEFAULT_OUTPUT);
    const context = buildTechnicalEvidenceContext({
      evidence: readEvidence(input),
      goalCode: args['goal-code'],
      targetIds: args['target-id'],
      maxNodes: args['max-nodes'],
      maxEdges: args['max-edges'],
      tokenBudget: args['token-budget'],
    });
    fs.mkdirSync(path.dirname(output.absolute), { recursive: true });
    fs.writeFileSync(output.absolute, `${JSON.stringify(context, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    const result = {
      ok: true,
      kind: 'technical-evidence-context-result',
      status: context.uncertainty.complete ? 'ready' : 'needs-attention',
      readOnly: true,
      safety: {
        level: 'S1',
        approvalRequired: false,
        sideEffects: ['local-read', 'local-artifact-write'],
      },
      scope: {
        origin: 'local-anonymized-evidence',
        pathDisclosure: 'none',
        contentDisclosure: 'none',
      },
      context,
      artifacts: [output.relative],
      warnings: context.uncertainty.warningCodes,
      nextCommands: ['node cli/zeus.js agent log summary --json'],
      approvalRequired: false,
    };
    if (json.isJsonMode) json.print(result);
    else printHumanSummary(result);
    return result;
  } catch (error) {
    const result = resultForError(error);
    if (json.isJsonMode) json.print(result);
    else console.error(`[${result.reasonCode}] technical-evidence context was not created.`);
    process.exitCode = 2;
    return result;
  }
}

module.exports = {
  DEFAULT_INPUT,
  DEFAULT_OUTPUT,
  printHelp,
  runTechnicalEvidence,
};
