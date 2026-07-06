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

/**
 * Environment discovery service.
 *
 * Runs READ-ONLY IBM i catalog queries to enumerate the building blocks of an
 * environment so that profiles / resource models can be created, expanded and
 * refined with evidence instead of guesswork:
 *
 *   - libraries / schemas          (QSYS2.SYSSCHEMAS)
 *   - source physical files        (QSYS2.SYSTABLES, known QxxxSRC names)
 *   - source members (optional)    (QSYS2.SYSPARTITIONSTAT)
 *   - application tables / files   (QSYS2.SYSTABLES)
 *
 * The query runner is injectable so the transformation logic is fully unit
 * testable without a live system. All queries are strictly read-only and use
 * escaped literals — this service never mutates IBM i state.
 */

const {
  runReadOnlyDb2Query,
  escapeSqlLiteral,
  validateSqlIdentifier,
} = require('../db2/readOnlyQueryService');
const { describeTarget } = require('./resourceModel');

const KNOWN_SOURCE_FILE_NAMES = Object.freeze([
  'QRPGLESRC',
  'QSRVSRC',
  'QCPYSRC',
  'QCLLESRC',
  'QCLSRC',
  'QSQLSRC',
  'QTBLSRC',
  'QDDSSRC',
]);

// Prefixes of IBM-supplied / tooling libraries that are rarely the subject of
// a migration analysis. They are still listed in the raw schema inventory, but
// excluded from bounded table discovery and from the suggested resources
// skeleton so the signal is not drowned out by system noise.
const SYSTEM_SCHEMA_PREFIXES = Object.freeze(['Q', 'SYS', '#', '$', '@']);

const MAX_SUGGESTED_SCHEMAS = 25;

const DEFAULT_DISCOVERY_OPTIONS = Object.freeze({
  maxRows: 500,
  maxSchemasForTables: 5,
  maxSourceFilesForMembers: 10,
  includeMembers: false,
  includeTables: true,
});

/** True for IBM-supplied / tooling schemas that should be de-prioritized. */
function isSystemSchema(name) {
  const value = String(name === undefined || name === null ? '' : name).trim().toUpperCase();
  if (!value) return true;
  return SYSTEM_SCHEMA_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeIdentifierList(values) {
  if (values === undefined || values === null) return [];
  const list = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  for (const entry of list) {
    if (entry === undefined || entry === null) continue;
    const text = String(entry).trim().toUpperCase();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/** Case-insensitive cell lookup against a row object returned by the query runner. */
function readCell(row, ...names) {
  if (!isPlainObject(row)) return '';
  const lowerMap = new Map();
  for (const [key, value] of Object.entries(row)) {
    lowerMap.set(String(key).toLowerCase(), value);
  }
  for (const name of names) {
    const value = lowerMap.get(String(name).toLowerCase());
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function rowsOf(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  return [];
}

function buildSchemaInventoryQuery({ schemas } = {}) {
  const filter = normalizeIdentifierList(schemas);
  const where = filter.length > 0
    ? `WHERE SCHEMA_NAME IN (${filter.map((s) => escapeSqlLiteral(s)).join(', ')})`
    : "WHERE SCHEMA_NAME NOT LIKE 'Q%' AND SCHEMA_NAME NOT LIKE 'SYS%'";
  return `SELECT SCHEMA_NAME FROM QSYS2.SYSSCHEMAS ${where} ORDER BY SCHEMA_NAME`;
}

function buildSourceFileInventoryQuery({ libraries } = {}) {
  const inList = KNOWN_SOURCE_FILE_NAMES.map((name) => escapeSqlLiteral(name)).join(', ');
  const libs = normalizeIdentifierList(libraries);
  const libFilter = libs.length > 0
    ? `AND TABLE_SCHEMA IN (${libs.map((l) => escapeSqlLiteral(l)).join(', ')})`
    : '';
  return [
    'SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TEXT',
    'FROM QSYS2.SYSTABLES',
    `WHERE TABLE_NAME IN (${inList})`,
    libFilter,
    'ORDER BY TABLE_SCHEMA, TABLE_NAME',
  ].filter(Boolean).join(' ');
}

function buildTableInventoryQuery({ schema } = {}) {
  const normalizedSchema = validateSqlIdentifier(schema, 'schema');
  const excludeList = KNOWN_SOURCE_FILE_NAMES.map((name) => escapeSqlLiteral(name)).join(', ');
  return [
    'SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE',
    'FROM QSYS2.SYSTABLES',
    `WHERE TABLE_SCHEMA = ${escapeSqlLiteral(normalizedSchema)}`,
    `AND TABLE_NAME NOT IN (${excludeList})`,
    'ORDER BY TABLE_SCHEMA, TABLE_NAME',
  ].join(' ');
}

function buildMemberInventoryQuery({ schema, sourceFile } = {}) {
  const normalizedSchema = validateSqlIdentifier(schema, 'schema');
  const normalizedFile = validateSqlIdentifier(sourceFile, 'sourceFile');
  return [
    'SELECT TABLE_PARTITION AS MEMBER_NAME',
    'FROM QSYS2.SYSPARTITIONSTAT',
    `WHERE TABLE_SCHEMA = ${escapeSqlLiteral(normalizedSchema)}`,
    `AND TABLE_NAME = ${escapeSqlLiteral(normalizedFile)}`,
    'ORDER BY TABLE_PARTITION',
  ].join(' ');
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}

function dedupeByKey(entries, keyFn) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = keyFn(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * Orchestrates read-only discovery against a target system.
 *
 * @param {object} params
 * @param {object} params.dbConfig resolved DB connection config (with secrets)
 * @param {object} [params.scope] { libraries, schemas, includeMembers, includeTables }
 * @param {function} [params.runQuery] injectable query runner ({ dbConfig, query, maxRows }) => { rows }
 * @param {object} [params.options]
 * @returns {Promise<object>} discovery report (sanitized, no secrets)
 */
async function discoverEnvironment({ dbConfig, scope = {}, runQuery, options = {} } = {}) {
  if (!isPlainObject(dbConfig)) {
    throw new Error('discoverEnvironment requires a dbConfig with connection details.');
  }
  const opts = { ...DEFAULT_DISCOVERY_OPTIONS, ...options };
  const execute = typeof runQuery === 'function' ? runQuery : runReadOnlyDb2Query;
  const run = async (query) => execute({ dbConfig, query, maxRows: opts.maxRows });

  const requestedLibraries = normalizeIdentifierList(scope.libraries);
  const requestedSchemas = normalizeIdentifierList(scope.schemas);
  const notes = [];

  // 1) Schemas / libraries.
  let schemas = uniqueSorted([...requestedLibraries, ...requestedSchemas]);
  try {
    const schemaRows = rowsOf(await run(buildSchemaInventoryQuery({ schemas: requestedSchemas })));
    const discoveredSchemas = schemaRows.map((row) => readCell(row, 'SCHEMA_NAME')).filter(Boolean);
    schemas = uniqueSorted([...schemas, ...discoveredSchemas]);
  } catch (error) {
    notes.push(`Schema discovery skipped: ${error.message}`);
  }

  // 2) Source physical files.
  const sourceFiles = [];
  try {
    const sourceRows = rowsOf(await run(buildSourceFileInventoryQuery({ libraries: requestedLibraries })));
    for (const row of sourceRows) {
      const schemaName = readCell(row, 'TABLE_SCHEMA');
      const fileName = readCell(row, 'TABLE_NAME');
      if (schemaName && fileName) {
        sourceFiles.push({ schema: schemaName, name: fileName, text: readCell(row, 'TABLE_TEXT') });
      }
    }
  } catch (error) {
    notes.push(`Source file discovery skipped: ${error.message}`);
  }

  // Libraries that actually hold source code.
  const sourceLibraries = uniqueSorted(sourceFiles.map((entry) => entry.schema));
  if (sourceLibraries.length > 0) {
    schemas = uniqueSorted([...schemas, ...sourceLibraries]);
  }

  // 3) Application tables (bounded by maxSchemasForTables).
  const tables = [];
  if (opts.includeTables) {
    // Honor explicit --schemas as-is; otherwise prefer real user schemas so the
    // bounded table-discovery budget is not spent on IBM system libraries.
    const candidateSchemas = requestedSchemas.length > 0
      ? requestedSchemas
      : schemas.filter((schema) => !isSystemSchema(schema));
    const tableSchemas = candidateSchemas.slice(0, opts.maxSchemasForTables);
    for (const schema of tableSchemas) {
      try {
        const tableRows = rowsOf(await run(buildTableInventoryQuery({ schema })));
        for (const row of tableRows) {
          const schemaName = readCell(row, 'TABLE_SCHEMA') || schema;
          const tableName = readCell(row, 'TABLE_NAME');
          if (tableName) {
            tables.push({ schema: schemaName, name: tableName, type: readCell(row, 'TABLE_TYPE') });
          }
        }
      } catch (error) {
        notes.push(`Table discovery skipped for schema ${schema}: ${error.message}`);
      }
    }
  }

  // 4) Source members (optional, bounded).
  const members = [];
  if (opts.includeMembers) {
    for (const entry of sourceFiles.slice(0, opts.maxSourceFilesForMembers)) {
      try {
        const memberRows = rowsOf(await run(buildMemberInventoryQuery({ schema: entry.schema, sourceFile: entry.name })));
        for (const row of memberRows) {
          const memberName = readCell(row, 'MEMBER_NAME', 'TABLE_PARTITION');
          if (memberName) {
            members.push({ schema: entry.schema, sourceFile: entry.name, name: memberName });
          }
        }
      } catch (error) {
        notes.push(`Member discovery skipped for ${entry.schema}/${entry.name}: ${error.message}`);
      }
    }
  }

  const target = describeTarget(dbConfig, null);

  return {
    kind: 'environment-discovery-report',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    target: {
      systemKey: target.systemKey,
      displayName: target.displayName,
      host: target.host,
    },
    schemas,
    sourceLibraries,
    sourceFiles: dedupeByKey(sourceFiles, (e) => `${e.schema}.${e.name}`)
      .sort((a, b) => (`${a.schema}.${a.name}`).localeCompare(`${b.schema}.${b.name}`)),
    tables: dedupeByKey(tables, (e) => `${e.schema}.${e.name}`)
      .sort((a, b) => (`${a.schema}.${a.name}`).localeCompare(`${b.schema}.${b.name}`)),
    members: dedupeByKey(members, (e) => `${e.schema}.${e.sourceFile}.${e.name}`)
      .sort((a, b) => (`${a.schema}.${a.sourceFile}.${a.name}`).localeCompare(`${b.schema}.${b.sourceFile}.${b.name}`)),
    notes,
  };
}

/**
 * Produces a `resources` config skeleton from a discovery report so users can
 * paste it into a profile to create / expand / refine an environment.
 *
 * @param {object} report discovery report from discoverEnvironment
 * @param {object} [options] { system }
 * @returns {object} resources skeleton
 */
function suggestResourcesConfig(report, options = {}) {
  const safeReport = isPlainObject(report) ? report : {};
  const system = options.system ? String(options.system).trim() : '';
  const sourceFiles = uniqueSorted((safeReport.sourceFiles || []).map((entry) => entry.name));
  const sourceLibraries = uniqueSorted(safeReport.sourceLibraries || []);
  const schemas = uniqueSorted(safeReport.schemas || []);
  const dataSchemas = uniqueSorted((safeReport.tables || []).map((entry) => entry.schema));
  const members = uniqueSorted((safeReport.members || []).map((entry) => entry.name));

  // Prefer evidence-backed user schemas (those that actually contained tables),
  // then fall back to non-system schemas from the inventory. Bound the list so
  // the skeleton stays a usable starting point instead of dumping hundreds of
  // IBM-supplied libraries.
  const userSchemas = schemas.filter((schema) => !isSystemSchema(schema));
  const metadataSchemas = (dataSchemas.length > 0 ? dataSchemas : userSchemas)
    .slice(0, MAX_SUGGESTED_SCHEMAS);
  const dataSchemaList = (dataSchemas.length > 0 ? dataSchemas : userSchemas)
    .slice(0, MAX_SUGGESTED_SCHEMAS);

  const withSystem = (block) => (system ? { system, ...block } : block);

  return {
    sourceCode: withSystem({
      libraries: sourceLibraries,
      sourceFiles,
      ...(members.length > 0 ? { members } : {}),
    }),
    objects: withSystem({
      libraries: uniqueSorted([...sourceLibraries, ...dataSchemas]),
      objectTypes: ['*PGM', '*SRVPGM'],
    }),
    metadata: withSystem({
      schemas: metadataSchemas,
    }),
    data: withSystem({
      schemas: dataSchemaList,
    }),
  };
}

module.exports = {
  KNOWN_SOURCE_FILE_NAMES,
  DEFAULT_DISCOVERY_OPTIONS,
  isSystemSchema,
  discoverEnvironment,
  suggestResourcesConfig,
  buildSchemaInventoryQuery,
  buildSourceFileInventoryQuery,
  buildTableInventoryQuery,
  buildMemberInventoryQuery,
};
