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

const { buildJdbcUrl, resolveDefaultSchema } = require('./db2Config');
const { runJavaHelper } = require('../fetch/jt400CommandRunner');
const { SECRET_ENV_SENTINEL, ensureJavaSourcesCompiled } = require('../java/javaRuntime');

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_$#@]{1,128}$/;
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})([-T ])(\d{2})[.:](\d{2})[.:](\d{2})(?:[.:](\d{1,6}))?$/;

function normalizeIdentifier(value, label) {
  const normalized = String(value || '').trim();
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a simple IBM i identifier.`);
  }
  return normalized.toUpperCase();
}

function normalizeTimestampLiteral(value, label) {
  const match = TIMESTAMP_PATTERN.exec(String(value || '').trim());
  if (!match) {
    throw new Error(`${label} must use an IBM i timestamp without quotes.`);
  }
  const [, year, month, day, , hour, minute, second, fraction = ''] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
  );
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  ) {
    throw new Error(`${label} is not a valid timestamp.`);
  }
  return `${year}-${month}-${day}-${hour}.${minute}.${second}${fraction ? `.${fraction}` : ''}`;
}

function parsePositiveInt(
  value,
  fallback,
  { max = Number.MAX_SAFE_INTEGER, allowZero = false } = {}
) {
  const candidate = value === undefined ? fallback : value;
  const parsed = Number.parseInt(String(candidate).trim(), 10);
  if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0) || parsed > max) {
    throw new Error(`Invalid numeric option: ${candidate}`);
  }
  return parsed;
}

function parseLayout(value) {
  const parts = Array.isArray(value) ? value : String(value || '').split(',');
  const layout = parts.filter(Boolean).map(part => {
    const fields =
      typeof part === 'string'
        ? part.trim().split(':')
        : [part.name, part.type, part.length, part.scale];
    if (fields.length < 3 || fields.length > 4) {
      throw new Error('Each layout column must be NAME:TYPE:LENGTH[:SCALE].');
    }
    const name = normalizeIdentifier(fields[0], 'layout column');
    const type = String(fields[1] || '')
      .trim()
      .toUpperCase();
    const length = Number.parseInt(fields[2], 10);
    const scale = fields.length === 4 ? Number.parseInt(fields[3], 10) : 0;
    if (
      !['P', 'C', 'B'].includes(type) ||
      !Number.isInteger(length) ||
      length <= 0 ||
      length > 65535
    ) {
      throw new Error(`Invalid layout column ${name}.`);
    }
    if (!Number.isInteger(scale) || scale < 0 || scale > 38 || (type === 'B' && length !== 4)) {
      throw new Error(`Invalid layout dimensions for ${name}.`);
    }
    return { name, type, length, scale };
  });
  if (layout.length === 0) {
    throw new Error('A non-empty --layout is required.');
  }
  if (layout.reduce((total, column) => total + column.length, 0) > 1024 * 1024) {
    throw new Error('The supplied layout is too large.');
  }
  const names = new Set();
  for (const column of layout) {
    if (names.has(column.name)) throw new Error(`Duplicate layout column: ${column.name}.`);
    names.add(column.name);
  }
  return layout;
}

function parseColumnList(value, label, layout) {
  const columns = String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => normalizeIdentifier(part, label));
  const unique = [...new Set(columns)];
  if (unique.length === 0) throw new Error(`At least one ${label} is required.`);
  const available = new Set(layout.map(column => column.name));
  for (const column of unique) {
    if (!available.has(column))
      throw new Error(`${label} is not present in the supplied layout: ${column}.`);
  }
  return unique;
}

function stripSqlCommentsAndLiterals(sql) {
  return String(sql || '')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');
}

function assertReadOnlySelect(sql, label) {
  const normalized = stripSqlCommentsAndLiterals(sql).trim();
  if (!/^(?:select|with)\b/i.test(normalized) || /;/.test(normalized)) {
    throw new Error(`${label} must be one read-only SELECT/WITH statement.`);
  }
  if (
    /\b(insert|update|delete|merge|drop|alter|create|grant|revoke|call|set|begin|commit|rollback|truncate)\b/i.test(
      normalized
    )
  ) {
    throw new Error(`${label} contains a non-read-only SQL operation.`);
  }
}

function parseJournalRowDiffOptions({ journalLibrary, journalName, start, end, maxPairs = 50000 }) {
  const normalizedStart = normalizeTimestampLiteral(start, 'start timestamp');
  const normalizedEnd = normalizeTimestampLiteral(end, 'end timestamp');
  if (normalizedStart >= normalizedEnd) {
    throw new Error('end timestamp must be later than start timestamp.');
  }
  return {
    journalLibrary: normalizeIdentifier(journalLibrary, 'journal library'),
    journalName: normalizeIdentifier(journalName, 'journal name'),
    start: normalizedStart,
    end: normalizedEnd,
    maxPairs: parsePositiveInt(maxPairs, 50000, { max: 1000000 }),
  };
}

function buildJournalQuery({ journalLibrary, journalName, start, end, maxPairs }) {
  const options = parseJournalRowDiffOptions({ journalLibrary, journalName, start, end, maxPairs });
  return `
    SELECT ENTRY_TIMESTAMP, SEQUENCE_NUMBER, JOURNAL_ENTRY_TYPE, JOB_NAME, JOB_NUMBER, ENTRY_DATA
    FROM TABLE(QSYS2.DISPLAY_JOURNAL('${options.journalLibrary}', '${options.journalName}',
           STARTING_RECEIVER_NAME => '*CURCHAIN',
           STARTING_TIMESTAMP => TIMESTAMP('${options.start}'),
           ENDING_TIMESTAMP => TIMESTAMP('${options.end}'))) X
    WHERE JOURNAL_ENTRY_TYPE IN ('UB','UP')
    ORDER BY SEQUENCE_NUMBER
    FETCH FIRST ${options.maxPairs * 2} ROWS ONLY
  `;
}

function parseJournalRowDiffResult(stdout) {
  const content = String(stdout || '').trim();
  if (!content) throw new Error('Journal row diff analyzer returned no output.');
  return JSON.parse(content);
}

function runJournalRowDiff({
  dbConfig,
  journalLibrary,
  journalName,
  start,
  end,
  maxPairs,
  auditQuery,
  layout,
  keyColumns,
  ignoreColumns = [],
  ccsid = 273,
  toleranceSeconds = 5,
  runtime = {},
}) {
  if (!dbConfig || !dbConfig.user || !dbConfig.password)
    throw new Error('DB2 configuration is incomplete.');
  const options = parseJournalRowDiffOptions({ journalLibrary, journalName, start, end, maxPairs });
  const parsedLayout = parseLayout(layout);
  const parsedKeys = Array.isArray(keyColumns)
    ? keyColumns.map(column => normalizeIdentifier(column, 'key column'))
    : parseColumnList(keyColumns, 'key column', parsedLayout);
  const parsedIgnore = Array.isArray(ignoreColumns)
    ? ignoreColumns.map(column => normalizeIdentifier(column, 'ignored column'))
    : ignoreColumns
      ? parseColumnList(ignoreColumns, 'ignored column', parsedLayout)
      : [];
  const layoutNames = new Set(parsedLayout.map(column => column.name));
  if (parsedKeys.length === 0 || parsedKeys.some(column => !layoutNames.has(column)))
    throw new Error('Key columns must be present in layout.');
  if (parsedIgnore.some(column => !layoutNames.has(column)))
    throw new Error('Ignored columns must be present in layout.');
  assertReadOnlySelect(auditQuery, 'audit query');
  const parsedCcsid = parsePositiveInt(ccsid, 273, { max: 65535 });
  const parsedTolerance = parsePositiveInt(toleranceSeconds, 5, { max: 86400, allowZero: true });
  const journalQuery = buildJournalQuery(options);
  if (!runtime.runJavaHelper) ensureJavaSourcesCompiled({ cwd: process.cwd() });
  const runJavaHelperFn = runtime.runJavaHelper || runJavaHelper;
  const jdbcUrl = buildJdbcUrl(dbConfig, resolveDefaultSchema(dbConfig));
  const args = [
    jdbcUrl,
    String(dbConfig.user),
    SECRET_ENV_SENTINEL,
    journalQuery,
    auditQuery,
    parsedLayout
      .map(column => `${column.name}:${column.type}:${column.length}:${column.scale || 0}`)
      .join(','),
    parsedKeys.join(','),
    parsedIgnore.join(','),
    String(parsedCcsid),
    String(parsedTolerance),
  ];
  const result = runJavaHelperFn('JournalRowDiffAnalyzer', args, {
    password: String(dbConfig.password),
  });
  if (result.status !== 0 && result.status !== 3) {
    throw new Error((result.stderr || '').trim() || 'Journal row diff analysis failed.');
  }
  return parseJournalRowDiffResult(result.stdout);
}

module.exports = {
  assertReadOnlySelect,
  buildJournalQuery,
  normalizeIdentifier,
  normalizeTimestampLiteral,
  parseColumnList,
  parseJournalRowDiffOptions,
  parseLayout,
  parseJournalRowDiffResult,
  runJournalRowDiff,
};
