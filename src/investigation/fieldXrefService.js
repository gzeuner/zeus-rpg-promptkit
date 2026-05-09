/*
Copyright 2026 Zeus PromptKit Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

'use strict';

const { ensureJavaSourcesCompiled, runJavaClass } = require('../java/javaRuntime');

/**
 * SQL context patterns for Stufe 1: detect field+table relationship in source lines.
 * Each pattern captures the table context around a field reference.
 */
const SQL_CONTEXT_PATTERNS = [
  // UPDATE table SET field = ...
  { re: /\bUPDATE\s+(\w+[\w.]*)\b/i, intent: 'WRITES', role: 'SET' },
  // INSERT INTO table ... field
  { re: /\bINSERT\s+INTO\s+(\w+[\w.]*)\b/i, intent: 'WRITES', role: 'INSERT' },
  // DELETE FROM table WHERE field
  { re: /\bDELETE\s+FROM\s+(\w+[\w.]*)\b/i, intent: 'WRITES', role: 'DELETE' },
  // SELECT ... FROM table (or JOIN table)
  { re: /\bFROM\s+(\w+[\w.]*)\b/i, intent: 'READS', role: 'FROM' },
  { re: /\bJOIN\s+(\w+[\w.]*)\b/i, intent: 'READS', role: 'JOIN' },
  // INTO :hostvar FROM table
  { re: /\bFOR\s+(\w+[\w.]*)\b/i, intent: 'READS', role: 'CURSOR' },
];

/**
 * Normalize a table name: strip schema prefix, uppercase.
 */
function normalizeTableName(name) {
  const parts = String(name || '').split('.');
  return parts[parts.length - 1].toUpperCase().trim();
}

/**
 * Given a single source line, extract all table contexts visible in that line.
 * Returns array of { table, intent, role } or empty array.
 */
function extractTableContextFromLine(line) {
  const tables = [];
  for (const { re, intent, role } of SQL_CONTEXT_PATTERNS) {
    const match = re.exec(line);
    if (match) {
      const table = normalizeTableName(match[1]);
      if (table && table.length > 0 && table !== 'FROM' && table !== 'INTO' && table !== 'WHERE') {
        tables.push({ table, intent, role });
      }
    }
  }
  return tables;
}

/**
 * Stufe 1: Search already-fetched local source files for a field (and optional table).
 *
 * @param {Object} sourceTextByRelativePath - map of relPath → file content string
 * @param {Object} options
 * @param {string} options.field - field name to search for (required)
 * @param {string} [options.table] - optional table to narrow context
 * @param {number} [options.maxResults] - max matches to return
 * @param {number} [options.contextLines] - lines of context around match (0 = none)
 * @returns {Object} search result
 */
function searchLocalSources(sourceTextByRelativePath, options = {}) {
  const field = String(options.field || '').trim().toUpperCase();
  const table = options.table ? String(options.table).trim().toUpperCase() : null;
  const maxResults = Number.isInteger(options.maxResults) && options.maxResults > 0
    ? options.maxResults
    : 300;
  const contextLines = Number.isInteger(options.contextLines) && options.contextLines >= 0
    ? options.contextLines
    : 2;

  if (!field) {
    throw new Error('field option is required');
  }

  const lowerField = field.toLowerCase();
  const matches = [];

  for (const [relPath, content] of Object.entries(sourceTextByRelativePath)) {
    if (matches.length >= maxResults) {
      break;
    }
    const lines = String(content || '').split('\n');

    for (let idx = 0; idx < lines.length; idx++) {
      if (matches.length >= maxResults) break;
      const line = lines[idx];
      if (!line.toLowerCase().includes(lowerField)) continue;

      // Collect context window (lines before + after)
      const contextBefore = [];
      const contextAfter = [];
      if (contextLines > 0) {
        for (let c = Math.max(0, idx - contextLines); c < idx; c++) {
          contextBefore.push({ lineNo: c + 1, text: lines[c] });
        }
        for (let c = idx + 1; c <= Math.min(lines.length - 1, idx + contextLines); c++) {
          contextAfter.push({ lineNo: c + 1, text: lines[c] });
        }
      }

      // Try to detect table context: look at match line and surrounding lines for SQL keywords
      const windowText = [
        ...contextBefore.map((l) => l.text),
        line,
        ...contextAfter.map((l) => l.text),
      ].join(' ');
      const tableContexts = extractTableContextFromLine(windowText);

      // If table filter given, only include if the table appears in context
      if (table) {
        const hasTable = tableContexts.some((tc) => tc.table === table);
        if (!hasTable) continue;
      }

      matches.push({
        file: relPath,
        line: idx + 1,
        text: line.trimEnd(),
        field,
        tableContexts,
        contextBefore,
        contextAfter,
      });
    }
  }

  return {
    kind: 'field-search-local',
    field,
    table: table || null,
    matchCount: matches.length,
    truncated: matches.length >= maxResults,
    matches,
  };
}

/**
 * Stufe 2: Remote search on IBM i via IbmiSourceSearcher Java helper.
 * Searches all members in sourceLib/sourceFile on the live IBM i system.
 *
 * @param {Object} options
 * @param {string} options.host
 * @param {string} options.user
 * @param {string} options.password
 * @param {string} options.sourceLib  - e.g. "APPLIB"
 * @param {string} options.sourceFile - e.g. "QRPGLESRC"
 * @param {string} options.field      - field name to search
 * @param {string} [options.table]    - optional: filter by table context
 * @param {number} [options.maxResults]
 * @returns {Object} parsed result from IbmiSourceSearcher JSON output
 */
function searchRemoteSources(options = {}) {
  const { host, user, password, sourceLib, sourceFile, field, table, maxResults = 500 } = options;

  if (!host || !user || !password) {
    throw new Error('host, user, password are required for remote search');
  }
  if (!sourceLib || !sourceFile) {
    throw new Error('sourceLib and sourceFile are required for remote search');
  }
  if (!field) {
    throw new Error('field is required for remote search');
  }

  ensureJavaSourcesCompiled();

  // Build search term: if table given, search for both field and table as separate terms
  const searchTerm = table ? `${field}|${table}` : field;

  const result = runJavaClass('IbmiSourceSearcher', [
    host, user, password, sourceLib, sourceFile, searchTerm, String(maxResults),
  ]);

  const stdout = (result.stdout || '').trim();
  if (!stdout) {
    throw new Error(`IbmiSourceSearcher returned no output. stderr: ${(result.stderr || '').trim()}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (_) {
    throw new Error(`IbmiSourceSearcher returned invalid JSON: ${stdout.slice(0, 200)}`);
  }

  if (!parsed.ok) {
    throw new Error(`IbmiSourceSearcher failed: ${parsed.error || 'unknown error'}`);
  }

  // Post-process: if table filter given, analyze matches for table context
  let filteredMatches = parsed.matches || [];
  if (table) {
    const upperTable = table.toUpperCase();
    const upperField = field.toUpperCase();

    // Group matches by member, then correlate: member must contain BOTH field and table references
    const memberHasField = new Set();
    const memberHasTable = new Set();
    for (const m of filteredMatches) {
      const termUpper = m.term.toUpperCase();
      if (termUpper === upperField) memberHasField.add(m.member);
      if (termUpper === upperTable) memberHasTable.add(m.member);
    }
    // Keep only members that reference both
    const relevantMembers = new Set([...memberHasField].filter((m) => memberHasTable.has(m)));
    // Return only field matches from relevant members (not the table matches)
    filteredMatches = filteredMatches.filter(
      (m) => m.term.toUpperCase() === upperField && relevantMembers.has(m.member)
    );
  }

  return {
    kind: 'field-search-remote',
    field: field.toUpperCase(),
    table: table ? table.toUpperCase() : null,
    sourceLib: (sourceLib || '').toUpperCase(),
    sourceFile: (sourceFile || '').toUpperCase(),
    memberCount: parsed.memberCount || 0,
    matchCount: filteredMatches.length,
    truncated: parsed.truncated || false,
    matches: filteredMatches,
    timestamp: parsed.timestamp,
  };
}

/**
 * Stufe 3: DSPPGMREF-based file-level cross reference.
 * "Which programs in <sourceLib> reference file <tableName>?"
 * Uses QTEMP outfile approach via DB2 query after DSPPGMREF populates it.
 *
 * Note: DSPPGMREF OUTPUT(*OUTFILE) requires a real interactive/batch job context.
 * This implementation uses QSYS2.PROGRAM_INFO as a pure-SQL alternative.
 *
 * @param {Object} options
 * @param {Function} options.runQuery - async function(sql, maxRows) → { rows, columns }
 * @param {string} options.table - table/file name to find references for
 * @param {string} [options.schema] - optional schema to filter programs
 * @returns {Object}
 */
async function searchFileXrefViaSql(options = {}) {
  const { runQuery, table, schema } = options;
  if (!table) throw new Error('table is required for file cross-reference search');
  const upperTable = table.toUpperCase().trim();
  const upperSchema = schema ? schema.toUpperCase().trim() : null;

  // QSYS2.PROGRAM_INFO gives programs and their referenced objects.
  // For file-level cross-reference, use QSYS2.BOUND_MODULE_INFO joined with
  // SYSCOLUMNS to find table usage. The most reliable approach on IBM i
  // is to query QSYS2.SYSDEPEND or use the outfile from DSPPGMREF.
  // As a SQL-only fallback we query QSYS2.SYSDEPEND (object dependency catalog).
  const schemaFilter = upperSchema ? `AND DEPLIB = '${upperSchema}'` : '';
  const sql = `
    SELECT
      DEPTPYE AS DEP_TYPE,
      DEPLIB  AS PROGRAM_LIB,
      DEPOBJ  AS PROGRAM_NAME,
      DEPPGM  AS DEPENDS_ON,
      DEPLIB2 AS DEPENDS_LIB
    FROM QSYS2.SYSDEPEND
    WHERE DEPPGM = '${upperTable}'
      ${schemaFilter}
    ORDER BY DEPLIB, DEPOBJ
    FETCH FIRST 500 ROWS ONLY
  `.trim();

  try {
    const result = await runQuery(sql, 500);
    return {
      kind: 'file-xref-sql',
      table: upperTable,
      schema: upperSchema,
      matchCount: (result.rows || []).length,
      matches: result.rows || [],
      columns: result.columns || [],
      sql,
    };
  } catch (err) {
    // SYSDEPEND may not be available on all versions; surface the error gracefully
    return {
      kind: 'file-xref-sql',
      table: upperTable,
      schema: upperSchema,
      matchCount: 0,
      matches: [],
      columns: [],
      sql,
      error: err.message,
    };
  }
}

module.exports = {
  searchLocalSources,
  searchRemoteSources,
  searchFileXrefViaSql,
  extractTableContextFromLine,
  normalizeTableName,
};
