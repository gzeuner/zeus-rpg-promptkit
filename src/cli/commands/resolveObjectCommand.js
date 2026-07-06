'use strict';

const { renderAsciiTable } = require('../helpers/asciiTable');
const { createJsonOutput } = require('../helpers/jsonOutput');
const {
  resolveAnalyzeConfig,
  resolveAnalyzeDbConfig,
} = require('../../config/runtimeConfig');
const { isDbConfigured } = require('../../db2/db2Config');
const { resolveObjectsByName } = require('../../db2/tableNameResolutionService');
const { printDbRuntimeConflictWarnings } = require('../helpers/runtimeConfigWarnings');

function normalizeRequireColumns(value) {
  if (value === undefined || value === null || value === false) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function buildResolveObjectDiagnosticLines(result) {
  const diagnostics = result && result.diagnostics ? result.diagnostics : null;
  if (!diagnostics) {
    return [];
  }

  const lines = [
    `Search mode: ${diagnostics.searchMode}${diagnostics.schemaProvided ? '' : ' (all visible schemas)'}`,
    `Catalog attempts: ${diagnostics.attemptCount}`,
    `Elapsed: ${diagnostics.elapsedMs} ms`,
  ];

  if (diagnostics.fallbackUsed && diagnostics.catalogVariant) {
    lines.push(`Catalog fallback: ${diagnostics.catalogVariant}`);
  }

  for (const recommendation of diagnostics.recommendations || []) {
    lines.push(`Hint: ${recommendation}`);
  }

  return lines;
}

async function runResolveObject(args) {
  if (!args.profile || !String(args.profile).trim()) {
    console.error('Missing required option: --profile <name>');
    process.exit(2);
  }

  const rawName = String(args.table || args.name || args.object || '').trim();
  if (!rawName) {
    console.error('Missing required option: --table <name>');
    process.exit(2);
  }

  let config;
  try {
    config = resolveAnalyzeConfig(args, { cwd: process.cwd(), env: process.env });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const dbConfig = resolveAnalyzeDbConfig(config, 'metadata');
  printDbRuntimeConflictWarnings(dbConfig);
  if (!isDbConfigured(dbConfig)) {
    console.error('DB2 connection configuration is incomplete for the selected profile.');
    process.exit(2);
  }

  const requireColumns = normalizeRequireColumns(args['require-column']);
  const includeRowCount = Boolean(args['include-row-count']);

  let result;
  try {
    result = resolveObjectsByName(dbConfig, rawName, {
      schema: args.schema || null,
      requireColumns,
      includeRowCount,
      runtime: {
        scopeLabel: 'DB2 resolve-object connection',
      },
    });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  console.log(`Resolve object: ${String(rawName).trim().toUpperCase()}`);
  if (args.schema) {
    console.log(`Schema filter: ${String(args.schema).trim().toUpperCase()}`);
  }
  if (requireColumns.length > 0) {
    console.log(`Required columns: ${requireColumns.map((entry) => entry.toUpperCase()).join(', ')}`);
  }
  buildResolveObjectDiagnosticLines(result).forEach((line) => console.log(line));
  console.log('');

  if (!result.found) {
    console.log('No matching objects found in QSYS2.SYSTABLES.');
    return;
  }

  const json = createJsonOutput(args);
  if (json.isJsonMode) {
    json.print(result);
    return;
  }

  const headers = ['Schema', 'SQL Name', 'System Name', 'Type', 'Columns'];
  if (includeRowCount) {
    headers.push('Row Count');
  }

  const matrix = result.objects.map((entry) => {
    const columnStatus = entry.requiredColumns.length === 0
      ? 'n/a'
      : (entry.allRequiredColumnsPresent
        ? 'OK'
        : `Missing: ${entry.missingRequiredColumns.join(', ')}`);

    const row = [
      entry.schema,
      entry.sqlName,
      entry.systemName,
      entry.type || '',
      columnStatus,
    ];

    if (includeRowCount) {
      row.push(entry.rowCountError ? `Unavailable: ${entry.rowCountError}` : String(entry.rowCount));
    }

    return row;
  });

  console.log(renderAsciiTable(headers, matrix, { maxCellWidth: 50 }));
}

module.exports = {
  buildResolveObjectDiagnosticLines,
  normalizeRequireColumns,
  runResolveObject,
};
