'use strict';

const { createJsonOutput } = require('../helpers/jsonOutput');
const {
  listProcesses,
  describeProcess,
  queryProcesses,
  impactProcess,
  diffProcess,
  readProcessCatalog,
} = require('../../projectIntelligence/process/retrieval');
const {
  ROLE_IDS,
  buildProcessRoleView,
  chatProcess,
} = require('../../projectIntelligence/process/views');
const {
  evaluateProcessCatalog,
  readProcessEvaluationScenarios,
} = require('../../projectIntelligence/process/evaluation');
const {
  PROCESS_ISSUES,
  TARGET_SURFACES,
  buildProcessImprovementReport,
  recordProcessExperience,
  writeProcessImprovementArtifact,
} = require('../../agent/processExperience');
const {
  buildProcessPromotionReadiness,
  writeProcessPromotionArtifact,
} = require('../../agent/processPromotion');
const {
  buildProcessAnswerRegression,
  writeProcessAnswerRegressionArtifact,
} = require('../../agent/processAnswerRegression');
const {
  buildProcessAnswerDrift,
  writeProcessAnswerDriftArtifact,
} = require('../../agent/processAnswerDrift');
const {
  buildProcessAnswerReview,
  buildProcessAnswerReviewSummary,
  writeProcessAnswerReviewArtifact,
  writeProcessAnswerReviewSummaryArtifact,
} = require('../../agent/processAnswerReview');
const {
  listGlossaryEntries,
  resolveGlossaryTerm,
  readGlossaryCatalog,
} = require('../../projectIntelligence/process/vocabulary');

const OPERATIONS = new Set([
  'list',
  'describe',
  'query',
  'chat',
  'view',
  'impact',
  'diff',
  'evaluate',
  'experience',
  'improvements',
  'promotion-check',
  'regression-check',
  'drift-check',
  'drift-review',
  'drift-review-summary',
  'glossary',
]);

function printHelp() {
  console.log('Process Intelligence (local, read-mostly) commands:');
  console.log('  zeus process list --catalog <relative-path> [--status <status>] [--json]');
  console.log('  zeus process describe --catalog <relative-path> --id <process-id> [--json]');
  console.log(
    '  zeus process query --catalog <relative-path> --question "<question>" [--limit <n>] [--json]'
  );
  console.log(
    '  zeus process chat --catalog <relative-path> --question "<question>" [--glossary <relative-path>] [--json]'
  );
  console.log(
    `  zeus process view --catalog <relative-path> --id <process-id> --role <${ROLE_IDS.join('|')}> [--json]`
  );
  console.log(
    '  zeus process query --catalog <relative-path> --glossary <relative-path> --question "<question>" [scope options] [--json]'
  );
  console.log(
    '  zeus process impact --catalog <relative-path> --id <process-id> [--changed-evidence-id <id[,id]>] [--json]'
  );
  console.log('  zeus process diff --catalog <relative-path> --id <process-id> [--json]');
  console.log(
    '  zeus process evaluate --catalog <relative-path> [--scenarios <relative-path>] [--json]'
  );
  console.log(
    `  zeus process experience --question "<question>" --outcome <${PROCESS_ISSUES.join('|')}> [--process-id <id>] [--target-surface <${TARGET_SURFACES.join('|')}>] [--json]`
  );
  console.log(
    '  zeus process improvements [--experience-log <.zeus/file.jsonl>] [--out <.zeus/file.json>] [--json]'
  );
  console.log(
    '  zeus process promotion-check --candidate <.zeus/process-improvements.json> [--candidate <.zeus/file.json>] [--fixture <.zeus/file.json>] [--out <.zeus/file.json>] [--json]'
  );
  console.log(
    '  zeus process regression-check --catalog <relative-path> --corpus <relative-path> [--decision <.zeus/file.json>] [--out <.zeus/file.json>] [--json]'
  );
  console.log(
    '  zeus process drift-check --baseline <.zeus/file.json> --current <.zeus/file.json> [--out <.zeus/file.json>] [--json]'
  );
  console.log(
    '  zeus process drift-review --drift <.zeus/file.json> [--history <.zeus/file.json>] [--out <.zeus/file.json>] [--json]'
  );
  console.log(
    '  zeus process drift-review-summary --history <.zeus/file.json> [--out <.zeus/file.json>] [--json]'
  );
  console.log(
    '  zeus process glossary list --glossary <relative-path> [--only-applicable] [--json]'
  );
  console.log(
    '  zeus process glossary resolve --glossary <relative-path> --term "<term>" [scope options] [--json]'
  );
  console.log('');
  console.log(
    'The catalog must be a local workspace-relative process-candidate-catalog JSON file.'
  );
  console.log(
    'The optional glossary is a local workspace-relative process-glossary-catalog JSON file with global, environment, organization, project, or task scope.'
  );
  console.log(
    'Results preserve lifecycle status, freshness, evidence references, confidence, and unknowns. View and chat are local read-only projections; evaluate is deterministic and never calls a model. Experience is local and sanitized; improvements are review-only and never auto-promote.'
  );
}

function errorOutcome(operation, error) {
  return {
    ok: false,
    schemaVersion: 1,
    kind: 'process-command-result',
    operation,
    service: 'zeus.process',
    reasonCode: error.code || 'PROCESS_COMMAND_FAILED',
    message: error.message || 'process operation failed',
    nextSafeStep:
      error.code === 'PROCESS_CATALOG_REQUIRED'
        ? 'Provide --catalog <relative-path> for a generated process-candidate-catalog JSON file.'
        : error.code === 'GLOSSARY_CATALOG_REQUIRED'
          ? 'Provide --glossary <relative-path> for a process-glossary-catalog JSON file.'
          : 'Run zeus process --help and correct the local, read-only command arguments.',
  };
}

function requireValue(args, key, label = `--${key}`) {
  const value = args[key];
  if (value == null || value === true || String(value).trim() === '') {
    const error = new Error(`${label} is required`);
    error.code = `PROCESS_${key.replace(/-/g, '_').toUpperCase()}_REQUIRED`;
    throw error;
  }
  return String(value).trim();
}

function scopeOptions(args) {
  const result = {};
  for (const key of ['environment-id', 'organization-id', 'project-id', 'task-id']) {
    if (args[key] != null && args[key] !== true && String(args[key]).trim()) {
      result[`${key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}`] = String(
        args[key]
      ).trim();
    }
  }
  if (args['scope-type'] != null && args['scope-type'] !== true) {
    result.scopeType = String(args['scope-type']).trim();
  }
  return result;
}

function freshnessOptions(args) {
  const result = {};
  if (args['current-snapshot-id'] != null && args['current-snapshot-id'] !== true) {
    result.currentSnapshotId = String(args['current-snapshot-id']).trim();
  }
  if (args['current-source-hash'] != null && args['current-source-hash'] !== true) {
    const sourceHash = String(args['current-source-hash']).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sourceHash)) {
      const error = new Error('--current-source-hash must be a 64-character SHA-256 value');
      error.code = 'PROCESS_CURRENT_SOURCE_HASH_INVALID';
      throw error;
    }
    result.currentSourceHash = sourceHash;
  }
  return result;
}

function changedEvidenceOptions(args) {
  const supplied = args['changed-evidence-id'];
  if (supplied == null || supplied === true) return {};
  const values = Array.isArray(supplied) ? supplied : [supplied];
  return {
    changedEvidenceIds: values
      .flatMap(value => String(value).split(','))
      .map(value => value.trim())
      .filter(Boolean)
      .slice(0, 100),
  };
}

function repeatedOptions(args, key) {
  const supplied = args[key];
  if (supplied == null || supplied === true) return [];
  return (Array.isArray(supplied) ? supplied : [supplied])
    .flatMap(value => String(value).split(','))
    .map(value => value.trim())
    .filter(Boolean);
}

function printHuman(operation, result) {
  if (operation === 'list') {
    console.log(`Processes: ${result.total} (freshness: ${result.freshness.status})`);
    for (const process of result.processes) {
      console.log(
        `- ${process.processId} | ${process.name} | ${process.status} | ${process.confidence} | version=${process.processVersionId}`
      );
    }
    if (result.unknowns.length > 0) console.log(`Unknowns: ${result.unknowns.join('; ')}`);
    return;
  }
  if (operation === 'query' || operation === 'chat') {
    console.log(result.answer);
    console.log(
      `Status: ${result.status}; confidence: ${result.confidence}; freshness: ${result.freshness.status}`
    );
    console.log(`Evidence references: ${result.evidenceReferences.length}`);
    for (const match of result.matches || []) {
      console.log(`- match: ${match.id} | ${match.name}`);
    }
    if (result.unknowns.length > 0) console.log(`Unknowns: ${result.unknowns.join('; ')}`);
    return;
  }
  if (operation === 'view') {
    console.log(
      `Role view: ${result.role} | ${result.processId} | freshness: ${result.freshness.status}`
    );
    console.log(JSON.stringify(result.view, null, 2));
    if (result.unknowns.length > 0) console.log(`Unknowns: ${result.unknowns.join('; ')}`);
    return;
  }
  if (operation === 'evaluate') {
    console.log(`Process quality: ${result.status}`);
    console.log(JSON.stringify(result.metrics, null, 2));
    if (result.findings.length > 0) console.log(`Findings: ${result.findings.join('; ')}`);
    return;
  }
  if (operation === 'glossary list') {
    console.log(`Glossary entries: ${result.total} (freshness: ${result.freshness.status})`);
    for (const entry of result.entries) {
      console.log(
        `- ${entry.entryId} | ${entry.term} | scope=${entry.scopeType || 'project'}${entry.scopeId ? `:${entry.scopeId}` : ''} | ${entry.status} | ${entry.confidence}`
      );
    }
    if (result.unknowns.length > 0) console.log(`Unknowns: ${result.unknowns.join('; ')}`);
    return;
  }
  if (operation === 'glossary resolve') {
    console.log(`Glossary resolution: ${result.status} for "${result.query}"`);
    if (result.selected) console.log(`- ${result.selected.term}: ${result.selected.definition}`);
    for (const match of result.matches || []) {
      console.log(`- match: ${match.term} | ${match.matchType} | score=${match.score}`);
    }
    if (result.unknowns.length > 0) console.log(`Unknowns: ${result.unknowns.join('; ')}`);
    return;
  }
  if (operation === 'experience') {
    console.log(`Process experience recorded: ${result.event.eventId}`);
    console.log(`Outcome: ${result.event.processIssue}; target: ${result.event.targetSurface}`);
    console.log(`Log: ${result.path}`);
    return;
  }
  if (operation === 'improvements') {
    console.log(`Process improvement candidates: ${result.candidates.length}`);
    for (const candidate of result.candidates) {
      console.log(
        `- ${candidate.status} ${candidate.issue} -> ${candidate.targetSurface} (${candidate.count})`
      );
    }
    if (result.artifact) console.log(`Artifact: ${result.artifact}`);
    return;
  }
  if (operation === 'promotion-check') {
    console.log(
      `Process promotion readiness: ${result.review.readyForHumanReview} ready, ${result.review.blocked} blocked`
    );
    for (const candidate of result.candidates) {
      console.log(
        `- ${candidate.status} ${candidate.issue} -> ${candidate.targetSurface} (signals=${candidate.signalCount}, catalogs=${candidate.catalogCount})`
      );
    }
    if (result.artifact) console.log(`Artifact: ${result.artifact}`);
    return;
  }
  if (operation === 'regression-check') {
    console.log(`Process-answer regression: ${result.status}`);
    console.log(
      `Scenarios: ${result.metrics.passedScenarioCount}/${result.metrics.scenarioCount} passed; reviewer: ${result.review.status}`
    );
    if (result.blockers.length > 0) console.log(`Blockers: ${result.blockers.join('; ')}`);
    if (result.artifact) console.log(`Artifact: ${result.artifact}`);
    return;
  }
  if (operation === 'drift-check') {
    console.log(`Process-answer drift: ${result.status}`);
    console.log(
      `Compared scenarios: ${result.metrics.comparedScenarioCount}; introduced regressions: ${result.metrics.introducedRegressionCount}`
    );
    if (result.blockers.length > 0) console.log(`Blockers: ${result.blockers.join('; ')}`);
    if (result.artifact) console.log(`Artifact: ${result.artifact}`);
    return;
  }
  if (operation === 'drift-review') {
    console.log(`Process-answer review: ${result.status}`);
    console.log(
      `Drift: ${result.driftStatus}; review: ${result.approval.status}; explanations: ${result.explanations.length}`
    );
    for (const explanation of result.explanations) {
      console.log(`- ${explanation.severity} ${explanation.code}: ${explanation.summary}`);
    }
    if (result.artifact) console.log(`Artifact: ${result.artifact}`);
    return;
  }
  if (operation === 'drift-review-summary') {
    console.log(`Process-answer review summary: ${result.status}`);
    console.log(
      `Drift identities: ${result.metrics.driftIdentityCount}; unresolved: ${result.metrics.unresolvedDriftCount}; stale decisions: ${result.metrics.staleDecisionCount}`
    );
    for (const finding of result.findings) {
      console.log(`- ${finding.code}: ${finding.driftCount} drift identities`);
    }
    if (result.artifact) console.log(`Artifact: ${result.artifact}`);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Run the process retrieval/query family. Retrieval remains local read-only;
 * experience recording is an explicit bounded local write.
 */
function runProcess(args = {}) {
  const positional = Array.isArray(args._) ? args._ : [];
  const operation = String(positional[0] || 'help')
    .trim()
    .toLowerCase();
  if (operation === 'help' || args.help === true || args.h === true) {
    printHelp();
    return { ok: true, operation: 'help' };
  }
  if (!OPERATIONS.has(operation)) {
    printHelp();
    const error = new Error(`unknown process operation: ${operation}`);
    error.code = 'PROCESS_OPERATION_UNKNOWN';
    process.exitCode = 2;
    return errorOutcome(operation, error);
  }

  const json = createJsonOutput(args);
  try {
    let result;
    let outputOperation = operation;
    const scope = scopeOptions(args);
    const freshness = freshnessOptions(args);
    const changedEvidence = changedEvidenceOptions(args);
    if (operation === 'experience') {
      result = recordProcessExperience({
        cwd: process.cwd(),
        experienceLog: args['experience-log'],
        question: requireValue(args, 'question'),
        outcome: requireValue(args, 'outcome'),
        processId: args['process-id'] || args.processId || null,
        processVersionId: args['process-version-id'] || args.processVersionId || null,
        catalog: args.catalog || null,
        glossaryTerm: args['glossary-term'] || args.term || null,
        targetSurface: args['target-surface'] || args.targetSurface || null,
        correction: args.correction || null,
        evidenceSummary: args['evidence-summary'] || null,
        lesson: args.lesson || null,
        nextStep: args['next-step'] || args.nextStep || null,
      });
    } else if (operation === 'improvements') {
      result = buildProcessImprovementReport({
        cwd: process.cwd(),
        experienceLog: args['experience-log'],
        limit: args.limit,
      });
      if (args.out) {
        result.artifact = writeProcessImprovementArtifact(result, {
          cwd: process.cwd(),
          out: args.out,
        });
      }
    } else if (operation === 'promotion-check') {
      result = buildProcessPromotionReadiness({
        cwd: process.cwd(),
        candidatePaths: repeatedOptions(args, 'candidate'),
        fixturePaths: repeatedOptions(args, 'fixture'),
      });
      if (args.out) {
        result.artifact = writeProcessPromotionArtifact(result, {
          cwd: process.cwd(),
          out: args.out,
        });
      }
    } else if (operation === 'regression-check') {
      const catalog = readProcessCatalog(requireValue(args, 'catalog'));
      result = buildProcessAnswerRegression({
        cwd: process.cwd(),
        catalog,
        corpus: requireValue(args, 'corpus'),
        decision: args.decision,
      });
      if (args.out) {
        result.artifact = writeProcessAnswerRegressionArtifact(result, {
          cwd: process.cwd(),
          out: args.out,
        });
      }
    } else if (operation === 'drift-check') {
      result = buildProcessAnswerDrift({
        cwd: process.cwd(),
        baseline: requireValue(args, 'baseline'),
        current: requireValue(args, 'current'),
      });
      if (args.out) {
        result.artifact = writeProcessAnswerDriftArtifact(result, {
          cwd: process.cwd(),
          out: args.out,
        });
      }
    } else if (operation === 'drift-review') {
      result = buildProcessAnswerReview({
        cwd: process.cwd(),
        drift: requireValue(args, 'drift'),
        history: args.history,
      });
      if (args.out) {
        result.artifact = writeProcessAnswerReviewArtifact(result, {
          cwd: process.cwd(),
          out: args.out,
        });
      }
    } else if (operation === 'drift-review-summary') {
      result = buildProcessAnswerReviewSummary({
        cwd: process.cwd(),
        history: requireValue(args, 'history'),
      });
      if (args.out) {
        result.artifact = writeProcessAnswerReviewSummaryArtifact(result, {
          cwd: process.cwd(),
          out: args.out,
        });
      }
    } else if (operation === 'glossary') {
      const suboperation = String(positional[1] || 'help')
        .trim()
        .toLowerCase();
      outputOperation = `glossary ${suboperation}`;
      if (!['list', 'resolve'].includes(suboperation)) {
        printHelp();
        const error = new Error(`unknown process glossary operation: ${suboperation}`);
        error.code = 'PROCESS_GLOSSARY_OPERATION_UNKNOWN';
        throw error;
      }
      const glossaryPath = args.glossary || args.catalog;
      const glossary = readGlossaryCatalog(requireValue({ glossary: glossaryPath }, 'glossary'));
      result =
        suboperation === 'list'
          ? listGlossaryEntries(glossary, {
              ...scope,
              scopeType: args['scope-type'],
              onlyApplicable: args['only-applicable'] === true,
            })
          : resolveGlossaryTerm(glossary, requireValue(args, 'term'), scope);
    } else {
      const catalog = readProcessCatalog(requireValue(args, 'catalog'));
      if (operation === 'list') {
        result = listProcesses(catalog, { status: args.status, ...freshness });
      } else if (operation === 'describe') {
        result = describeProcess(catalog, requireValue(args, 'id'), freshness);
      } else if (operation === 'query' || operation === 'chat') {
        const limit = args.limit == null || args.limit === true ? undefined : Number(args.limit);
        if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > 20)) {
          const error = new Error('--limit must be an integer from 1 to 20');
          error.code = 'PROCESS_LIMIT_INVALID';
          throw error;
        }
        const glossary = args.glossary
          ? readGlossaryCatalog(requireValue(args, 'glossary'))
          : undefined;
        const queryOptions = {
          limit,
          glossaryCatalog: glossary,
          ...scope,
          ...freshness,
        };
        result =
          operation === 'chat'
            ? chatProcess(catalog, requireValue(args, 'question'), queryOptions)
            : queryProcesses(catalog, requireValue(args, 'question'), queryOptions);
      } else if (operation === 'view') {
        result = buildProcessRoleView(
          catalog,
          requireValue(args, 'id'),
          requireValue(args, 'role'),
          freshness
        );
      } else if (operation === 'impact') {
        result = impactProcess(catalog, requireValue(args, 'id'), {
          ...freshness,
          ...changedEvidence,
        });
      } else if (operation === 'diff') {
        result = diffProcess(catalog, requireValue(args, 'id'), freshness);
      } else {
        const scenarios = args.scenarios
          ? readProcessEvaluationScenarios(requireValue(args, 'scenarios'))
          : [];
        result = evaluateProcessCatalog(catalog, scenarios, freshness);
      }
    }

    const outcome = {
      ok: result.ok !== false,
      schemaVersion: 1,
      kind: 'process-command-result',
      operation: outputOperation,
      service: 'zeus.process',
      result,
      ...(result.ok === false
        ? {
            reasonCode: result.reasonCode,
            message: result.message,
            nextSafeStep: result.nextSafeStep,
          }
        : {}),
    };
    if (json.isJsonMode) json.print(outcome);
    else if (result.ok === false) console.error(`[${result.reasonCode}] ${result.message}`);
    else printHuman(outputOperation, result);
    if (!outcome.ok) process.exitCode = 2;
    return outcome;
  } catch (error) {
    const outcome = errorOutcome(operation, error);
    if (json.isJsonMode) json.print(outcome);
    else console.error(`[${outcome.reasonCode}] ${outcome.message}`);
    process.exitCode = 2;
    return outcome;
  }
}

module.exports = {
  runProcess,
  printHelp,
};
