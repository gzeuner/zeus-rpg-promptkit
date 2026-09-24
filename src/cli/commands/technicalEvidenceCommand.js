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
const { buildTechnicalEvidencePrompt } = require('../../prompt/technicalEvidencePromptAdapter');
const {
  buildTechnicalEvidenceReviewReceipt,
  checkTechnicalEvidenceReview,
} = require('../../context/technicalEvidenceReview');
const {
  checkTechnicalEvidencePromptEgress,
  evaluateTechnicalEvidencePromptRegression,
} = require('../../prompt/technicalEvidencePolicy');
const {
  buildTechnicalEvidencePromptBundleCheck,
  buildTechnicalEvidenceHandoffReceipt,
  buildTechnicalEvidencePromptBundle,
} = require('../../prompt/technicalEvidenceBundle');

const DEFAULT_INPUT = '.local/technical-evidence/evidence-graph.json';
const DEFAULT_OUTPUT = '.local/technical-evidence/context.json';
const DEFAULT_PROMPT_OUTPUT = '.local/technical-evidence/prompt.json';
const DEFAULT_REVIEW_OUTPUT = '.local/technical-evidence/review.json';
const DEFAULT_REGRESSION_OUTPUT = '.local/technical-evidence/regression.json';
const DEFAULT_EGRESS_OUTPUT = '.local/technical-evidence/egress-check.json';
const DEFAULT_BUNDLE_OUTPUT = '.local/technical-evidence/bundle.json';
const DEFAULT_HANDOFF_OUTPUT = '.local/technical-evidence/handoff-receipt.json';
const DEFAULT_BUNDLE_CHECK_OUTPUT = '.local/technical-evidence/bundle-check.json';

function printHelp() {
  console.log('Technical evidence context commands (local-only):');
  console.log(
    `  zeus technical-evidence context --input <relative-anonymized-graph> [--out ${DEFAULT_OUTPUT}] [--goal-code <code>] [--target-id <opaque-id[,opaque-id...]>] [--max-nodes <n>] [--max-edges <n>] [--token-budget <n>] [--json]`
  );
  console.log(
    `  zeus technical-evidence prompt --context <relative-context> [--out ${DEFAULT_PROMPT_OUTPUT}] [--max-tokens <n>] [--json]`
  );
  console.log(
    `  zeus technical-evidence review --context <relative-context> --prompt <relative-prompt> --decision <approve|reject|defer> --reviewer <local-reviewer> [--reviewed-at <ISO>] [--fresh-days <n>] [--out ${DEFAULT_REVIEW_OUTPUT}] [--json]`
  );
  console.log(
    '  zeus technical-evidence review-check --context <relative-context> --prompt <relative-prompt> --receipt <relative-receipt> [--policy <off|advisory|required>] [--as-of <ISO>] [--fresh-days <n>] [--json]'
  );
  console.log(
    `  zeus technical-evidence regression --baseline <relative-prompt> --candidate <relative-prompt> [--out ${DEFAULT_REGRESSION_OUTPUT}] [--json]`
  );
  console.log(
    `  zeus technical-evidence policy-check --prompt <relative-prompt> [--trust-zone <local|private-network|external>] [--destination <local-workspace|private-network|external-provider>] [--out ${DEFAULT_EGRESS_OUTPUT}] [--json]`
  );
  console.log(
    `  zeus technical-evidence bundle --context <relative-context> --prompt <relative-prompt> --regression <relative-regression> --egress <relative-egress> [--out ${DEFAULT_BUNDLE_OUTPUT}] [--json]`
  );
  console.log(
    `  zeus technical-evidence handoff --bundle <relative-bundle> --context <relative-context> --prompt <relative-prompt> --receipt <relative-review-receipt> [--policy required] [--as-of <ISO>] [--fresh-days <n>] [--out ${DEFAULT_HANDOFF_OUTPUT}] [--json]`
  );
  console.log(
    `  zeus technical-evidence bundle-check --bundle <relative-bundle> --context <relative-context> --prompt <relative-prompt> --regression <relative-regression> --egress <relative-egress> [--out ${DEFAULT_BUNDLE_CHECK_OUTPUT}] [--json]`
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

function readJsonArtifact(inputPath, code) {
  let text;
  try {
    text = fs.readFileSync(inputPath.absolute, 'utf8');
  } catch (_) {
    throw new TechnicalEvidenceContextError(code, 'the required local artifact is unavailable');
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new TechnicalEvidenceContextError(code, 'the required local artifact is not valid JSON');
  }
}

function writeLocalArtifact(output, value) {
  fs.mkdirSync(path.dirname(output.absolute), { recursive: true });
  fs.writeFileSync(output.absolute, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
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
  if (
    ![
      'context',
      'prompt',
      'review',
      'review-check',
      'regression',
      'policy-check',
      'bundle',
      'handoff',
      'bundle-check',
    ].includes(subcommand)
  ) {
    const result = resultForError({ code: 'TECHNICAL_EVIDENCE_INVALID_ARGUMENTS' });
    if (json.isJsonMode) json.print(result);
    else console.error(`[${result.reasonCode}] technical-evidence subcommand is required.`);
    process.exitCode = 2;
    return result;
  }

  try {
    if (subcommand === 'context') {
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
      writeLocalArtifact(output, context);
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
    }

    if (subcommand === 'prompt') {
      const contextPath = resolveWorkspaceFile(args.context, DEFAULT_OUTPUT);
      const output = resolveWorkspaceFile(args.out, DEFAULT_PROMPT_OUTPUT);
      const prompt = buildTechnicalEvidencePrompt({
        context: readJsonArtifact(contextPath, 'TECHNICAL_EVIDENCE_PROMPT_INPUT_UNAVAILABLE'),
        maxTokens: args['max-tokens'],
      });
      writeLocalArtifact(output, prompt);
      const result = {
        ok: true,
        kind: 'technical-evidence-prompt-result',
        status: prompt.uncertainty.complete ? 'ready' : 'needs-attention',
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
        prompt,
        artifacts: [output.relative],
        warnings: prompt.uncertainty.warningCodes,
        approvalRequired: false,
      };
      if (json.isJsonMode) json.print(result);
      else printHumanSummary(result);
      return result;
    }

    if (subcommand === 'review') {
      const contextPath = resolveWorkspaceFile(args.context, DEFAULT_OUTPUT);
      const promptPath = resolveWorkspaceFile(args.prompt, DEFAULT_PROMPT_OUTPUT);
      const output = resolveWorkspaceFile(args.out, DEFAULT_REVIEW_OUTPUT);
      const receipt = buildTechnicalEvidenceReviewReceipt({
        context: readJsonArtifact(contextPath, 'TECHNICAL_EVIDENCE_REVIEW_CONTEXT_UNAVAILABLE'),
        prompt: readJsonArtifact(promptPath, 'TECHNICAL_EVIDENCE_REVIEW_PROMPT_UNAVAILABLE'),
        decision: args.decision,
        reviewer: args.reviewer,
        reviewedAt: args['reviewed-at'],
        freshDays: args['fresh-days'],
      });
      writeLocalArtifact(output, receipt);
      const result = {
        ok: true,
        kind: 'technical-evidence-review-result',
        status: receipt.decision === 'approve' ? 'approved' : 'needs-attention',
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
        receipt,
        artifacts: [output.relative],
        warnings: receipt.decision === 'approve' ? [] : ['TECHNICAL_EVIDENCE_REVIEW_NOT_APPROVED'],
        approvalRequired: false,
      };
      if (json.isJsonMode) json.print(result);
      else printHumanSummary(result);
      return result;
    }

    if (subcommand === 'regression') {
      const baselinePath = resolveWorkspaceFile(args.baseline, DEFAULT_PROMPT_OUTPUT);
      const candidatePath = resolveWorkspaceFile(args.candidate, DEFAULT_PROMPT_OUTPUT);
      const output = resolveWorkspaceFile(args.out, DEFAULT_REGRESSION_OUTPUT);
      const regression = evaluateTechnicalEvidencePromptRegression({
        baseline: readJsonArtifact(
          baselinePath,
          'TECHNICAL_EVIDENCE_REGRESSION_BASELINE_UNAVAILABLE'
        ),
        candidate: readJsonArtifact(
          candidatePath,
          'TECHNICAL_EVIDENCE_REGRESSION_CANDIDATE_UNAVAILABLE'
        ),
      });
      writeLocalArtifact(output, regression);
      const result = {
        ok: true,
        kind: 'technical-evidence-regression-result',
        status: regression.status,
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
        regression,
        artifacts: [output.relative],
        warnings: [...regression.warnings, ...regression.blockers],
        approvalRequired: false,
      };
      if (json.isJsonMode) json.print(result);
      else printHumanSummary(result);
      if (!regression.gatePassed) process.exitCode = 2;
      return result;
    }

    if (subcommand === 'policy-check') {
      const promptPath = resolveWorkspaceFile(args.prompt, DEFAULT_PROMPT_OUTPUT);
      const output = resolveWorkspaceFile(args.out, DEFAULT_EGRESS_OUTPUT);
      const egress = checkTechnicalEvidencePromptEgress({
        prompt: readJsonArtifact(promptPath, 'TECHNICAL_EVIDENCE_EGRESS_PROMPT_UNAVAILABLE'),
        trustZone: args['trust-zone'],
        destination: args.destination,
      });
      writeLocalArtifact(output, egress);
      const result = {
        ok: true,
        kind: 'technical-evidence-egress-result',
        status: egress.status,
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
        egress,
        artifacts: [output.relative],
        warnings: egress.blockers,
        approvalRequired: false,
      };
      if (json.isJsonMode) json.print(result);
      else printHumanSummary(result);
      if (!egress.gatePassed) process.exitCode = 2;
      return result;
    }

    if (subcommand === 'bundle') {
      const contextPath = resolveWorkspaceFile(args.context, DEFAULT_OUTPUT);
      const promptPath = resolveWorkspaceFile(args.prompt, DEFAULT_PROMPT_OUTPUT);
      const regressionPath = resolveWorkspaceFile(args.regression, DEFAULT_REGRESSION_OUTPUT);
      const egressPath = resolveWorkspaceFile(args.egress, DEFAULT_EGRESS_OUTPUT);
      const output = resolveWorkspaceFile(args.out, DEFAULT_BUNDLE_OUTPUT);
      const bundle = buildTechnicalEvidencePromptBundle({
        context: readJsonArtifact(contextPath, 'TECHNICAL_EVIDENCE_BUNDLE_CONTEXT_UNAVAILABLE'),
        prompt: readJsonArtifact(promptPath, 'TECHNICAL_EVIDENCE_BUNDLE_PROMPT_UNAVAILABLE'),
        regression: readJsonArtifact(
          regressionPath,
          'TECHNICAL_EVIDENCE_BUNDLE_REGRESSION_UNAVAILABLE'
        ),
        egress: readJsonArtifact(egressPath, 'TECHNICAL_EVIDENCE_BUNDLE_EGRESS_UNAVAILABLE'),
      });
      writeLocalArtifact(output, bundle);
      const result = {
        ok: true,
        kind: 'technical-evidence-bundle-result',
        status: bundle.status,
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
        bundle,
        artifacts: [output.relative],
        warnings: [
          ...bundle.gates.regression.blockers,
          ...bundle.gates.regression.warnings,
          ...bundle.gates.egress.blockers,
        ],
        approvalRequired: false,
      };
      if (json.isJsonMode) json.print(result);
      else printHumanSummary(result);
      if (bundle.status !== 'ready') process.exitCode = 2;
      return result;
    }

    if (subcommand === 'handoff') {
      const bundlePath = resolveWorkspaceFile(args.bundle, DEFAULT_BUNDLE_OUTPUT);
      const contextPath = resolveWorkspaceFile(args.context, DEFAULT_OUTPUT);
      const promptPath = resolveWorkspaceFile(args.prompt, DEFAULT_PROMPT_OUTPUT);
      const receiptPath = resolveWorkspaceFile(args.receipt, DEFAULT_REVIEW_OUTPUT);
      const output = resolveWorkspaceFile(args.out, DEFAULT_HANDOFF_OUTPUT);
      const bundle = readJsonArtifact(bundlePath, 'TECHNICAL_EVIDENCE_HANDOFF_BUNDLE_UNAVAILABLE');
      const context = readJsonArtifact(
        contextPath,
        'TECHNICAL_EVIDENCE_HANDOFF_CONTEXT_UNAVAILABLE'
      );
      const prompt = readJsonArtifact(promptPath, 'TECHNICAL_EVIDENCE_HANDOFF_PROMPT_UNAVAILABLE');
      const review = checkTechnicalEvidenceReview({
        context,
        prompt,
        receipt: readJsonArtifact(receiptPath, 'TECHNICAL_EVIDENCE_HANDOFF_RECEIPT_UNAVAILABLE'),
        policy: args.policy || 'required',
        asOf: args['as-of'],
        freshDays: args['fresh-days'],
      });
      const handoff = buildTechnicalEvidenceHandoffReceipt({ bundle, review });
      writeLocalArtifact(output, handoff);
      const result = {
        ok: true,
        kind: 'technical-evidence-handoff-result',
        status: handoff.status,
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
        handoff,
        artifacts: [output.relative],
        warnings: handoff.blockers,
        approvalRequired: false,
      };
      if (json.isJsonMode) json.print(result);
      else printHumanSummary(result);
      if (!handoff.handoffAllowed) process.exitCode = 2;
      return result;
    }

    if (subcommand === 'bundle-check') {
      const bundlePath = resolveWorkspaceFile(args.bundle, DEFAULT_BUNDLE_OUTPUT);
      const contextPath = resolveWorkspaceFile(args.context, DEFAULT_OUTPUT);
      const promptPath = resolveWorkspaceFile(args.prompt, DEFAULT_PROMPT_OUTPUT);
      const regressionPath = resolveWorkspaceFile(args.regression, DEFAULT_REGRESSION_OUTPUT);
      const egressPath = resolveWorkspaceFile(args.egress, DEFAULT_EGRESS_OUTPUT);
      const output = resolveWorkspaceFile(args.out, DEFAULT_BUNDLE_CHECK_OUTPUT);
      const check = buildTechnicalEvidencePromptBundleCheck({
        bundle: readJsonArtifact(bundlePath, 'TECHNICAL_EVIDENCE_BUNDLE_CHECK_BUNDLE_UNAVAILABLE'),
        context: readJsonArtifact(
          contextPath,
          'TECHNICAL_EVIDENCE_BUNDLE_CHECK_CONTEXT_UNAVAILABLE'
        ),
        prompt: readJsonArtifact(promptPath, 'TECHNICAL_EVIDENCE_BUNDLE_CHECK_PROMPT_UNAVAILABLE'),
        regression: readJsonArtifact(
          regressionPath,
          'TECHNICAL_EVIDENCE_BUNDLE_CHECK_REGRESSION_UNAVAILABLE'
        ),
        egress: readJsonArtifact(egressPath, 'TECHNICAL_EVIDENCE_BUNDLE_CHECK_EGRESS_UNAVAILABLE'),
      });
      writeLocalArtifact(output, check);
      const result = {
        ok: true,
        kind: 'technical-evidence-bundle-check-result',
        status: check.status,
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
        check,
        artifacts: [output.relative],
        warnings: check.mismatches,
        approvalRequired: false,
      };
      if (json.isJsonMode) json.print(result);
      else printHumanSummary(result);
      if (!check.gatePassed) process.exitCode = 2;
      return result;
    }

    const contextPath = resolveWorkspaceFile(args.context, DEFAULT_OUTPUT);
    const promptPath = resolveWorkspaceFile(args.prompt, DEFAULT_PROMPT_OUTPUT);
    const receiptPath = resolveWorkspaceFile(args.receipt, DEFAULT_REVIEW_OUTPUT);
    const receipt = readJsonArtifact(receiptPath, 'TECHNICAL_EVIDENCE_REVIEW_RECEIPT_UNAVAILABLE');
    const result = checkTechnicalEvidenceReview({
      context: readJsonArtifact(contextPath, 'TECHNICAL_EVIDENCE_REVIEW_CONTEXT_UNAVAILABLE'),
      prompt: readJsonArtifact(promptPath, 'TECHNICAL_EVIDENCE_REVIEW_PROMPT_UNAVAILABLE'),
      receipt,
      policy: args.policy,
      asOf: args['as-of'],
      freshDays: args['fresh-days'],
    });
    if (json.isJsonMode) json.print(result);
    else printHumanSummary(result);
    if (!result.gatePassed) process.exitCode = 2;
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
