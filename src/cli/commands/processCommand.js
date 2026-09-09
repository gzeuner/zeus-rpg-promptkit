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
  listGlossaryEntries,
  resolveGlossaryTerm,
  readGlossaryCatalog,
} = require('../../projectIntelligence/process/vocabulary');

const OPERATIONS = new Set(['list', 'describe', 'query', 'impact', 'diff', 'glossary']);

function printHelp() {
  console.log('Process Intelligence (local, read-only) commands:');
  console.log('  zeus process list --catalog <relative-path> [--status <status>] [--json]');
  console.log('  zeus process describe --catalog <relative-path> --id <process-id> [--json]');
  console.log(
    '  zeus process query --catalog <relative-path> --question "<question>" [--limit <n>] [--json]'
  );
  console.log(
    '  zeus process query --catalog <relative-path> --glossary <relative-path> --question "<question>" [scope options] [--json]'
  );
  console.log('  zeus process impact --catalog <relative-path> --id <process-id> [--json]');
  console.log('  zeus process diff --catalog <relative-path> --id <process-id> [--json]');
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
    'Results preserve lifecycle status, freshness, evidence references, confidence, and unknowns.'
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
  if (operation === 'query') {
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
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Run the process retrieval/query family. Every operation is local read-only
 * and consumes an explicitly named process-candidate catalog.
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
    if (operation === 'glossary') {
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
        result = listProcesses(catalog, { status: args.status });
      } else if (operation === 'describe') {
        result = describeProcess(catalog, requireValue(args, 'id'));
      } else if (operation === 'query') {
        const limit = args.limit == null || args.limit === true ? undefined : Number(args.limit);
        if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > 20)) {
          const error = new Error('--limit must be an integer from 1 to 20');
          error.code = 'PROCESS_LIMIT_INVALID';
          throw error;
        }
        const glossary = args.glossary
          ? readGlossaryCatalog(requireValue(args, 'glossary'))
          : undefined;
        result = queryProcesses(catalog, requireValue(args, 'question'), {
          limit,
          glossaryCatalog: glossary,
          ...scope,
        });
      } else if (operation === 'impact') {
        result = impactProcess(catalog, requireValue(args, 'id'));
      } else {
        result = diffProcess(catalog, requireValue(args, 'id'));
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
