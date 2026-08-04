'use strict';

const fs = require('fs');
const path = require('path');
const { buildPuiProjection } = require('../../pui/puiProjection');
const {
  extractAndPersistNeutralPuiKnowledge,
} = require('../../knowledge/extractors/puiPatternExtractor');
const { readFinalKnowledgeCatalog } = require('../../knowledge/knowledgePipeline');
const { createJsonOutput } = require('../helpers/jsonOutput');

function printHelp() {
  console.log('Knowledge commands:');
  console.log(
    '  zeus knowledge extract --mode ui-patterns --file <dds> --out <root> --run-id <id> [--json]'
  );
  console.log('  zeus knowledge validate --input <project-neutral-knowledge.json> [--json]');
  console.log('  zeus knowledge inspect --input <project-neutral-knowledge.json> [--json]');
  console.log('');
  console.log(
    'Local-only. No DDDL persistence, remote access, analyze auto-import, or MCP exposure.'
  );
}

function requiredString(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required option: --${name} <value>`);
  }
  return value.trim();
}

function readLocalFile(fileArg) {
  const resolved = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`File not found: ${resolved}`);
  }
  return { resolved, content: fs.readFileSync(resolved, 'utf8') };
}

function printResult(args, result) {
  if (args.json) {
    createJsonOutput(args).print(result);
    return;
  }
  if (result.available === false) {
    console.error(`[${result.status}] ${result.reason}`);
    return;
  }
  console.log(`Knowledge catalog: ${result.path || '(generated)'}`);
  if (result.catalog) console.log(`Patterns: ${result.catalog.patterns.length}`);
}

async function run(args = {}) {
  const operation = String((Array.isArray(args._) && args._[0]) || 'help')
    .trim()
    .toLowerCase();
  if (!operation || operation === 'help' || args.help === true || args.h === true) {
    printHelp();
    return { ok: true, operation: 'help' };
  }

  try {
    if (operation === 'extract') {
      const mode = String(args.mode || 'ui-patterns')
        .trim()
        .toLowerCase();
      if (mode !== 'ui-patterns') throw new Error('Only --mode ui-patterns is supported.');
      const file = requiredString(args, 'file');
      const outputRoot = requiredString(args, 'out');
      const runId = requiredString(args, 'run-id');
      const input = readLocalFile(file);
      const projection = buildPuiProjection(input.content, {
        file: path.relative(process.cwd(), input.resolved) || file,
      });
      const written = extractAndPersistNeutralPuiKnowledge({
        projection,
        outputRoot: path.resolve(process.cwd(), outputRoot),
        runId,
      });
      const result = {
        ok: true,
        operation,
        mode,
        path: written.path,
        patternCount: written.catalog.patterns.length,
      };
      printResult(args, { ...result, catalog: written.catalog });
      return result;
    }

    if (operation === 'validate' || operation === 'inspect') {
      const input = requiredString(args, 'input');
      const result = readFinalKnowledgeCatalog({ catalogPath: path.resolve(process.cwd(), input) });
      const output = { ok: result.available, operation, ...result };
      if (operation === 'inspect' && result.available && !args.json) {
        printResult(args, result);
        return output;
      }
      printResult(args, output);
      if (!result.available) process.exitCode = 2;
      return output;
    }

    throw new Error(`Unknown knowledge operation: ${operation}`);
  } catch (error) {
    const result = {
      ok: false,
      operation,
      status: 'failed',
      reason: error.message || String(error),
    };
    if (args.json) createJsonOutput(args).print(result);
    else console.error(result.reason);
    process.exitCode = 2;
    return result;
  }
}

module.exports = { run, printHelp };
