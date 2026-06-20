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
const fs = require('fs');
const path = require('path');
const { scanClFile } = require('./clScanner');
const { scanDdsFile } = require('./ddsScanner');
const { validateEmbeddedSql } = require('../validator/sqlRpgValidator');
const {
  classifySourceFile,
  normalizeSourceType,
  sourceTypeFamily,
  summarizeSourceTypes,
} = require('../source/sourceType');

const NATIVE_IO_OPCODES = new Set([
  'CHAIN',
  'SETLL',
  'SETGT',
  'READ',
  'READE',
  'READP',
  'READPE',
  'WRITE',
  'UPDATE',
  'DELETE',
  'EXFMT',
]);
const BINDER_SOURCE_EXTENSIONS = new Set(['.BND', '.BINDER', '.BNDSRC']);
const SQL_ALIAS_STOP_WORDS = new Set([
  'ON',
  'WHERE',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'CROSS',
  'GROUP',
  'ORDER',
  'HAVING',
  'UNION',
  'FETCH',
  'FOR',
  'OFFSET',
  'LIMIT',
]);

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isCommentLine(rawLine) {
  if (!rawLine) return true;
  if (rawLine.length >= 7 && rawLine[6] === '*') {
    return true;
  }

  const trimmed = rawLine.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('/*')) return true;
  // Free form *INxx indicators or *ON/*OFF are not comments. Only pure star comments.
  if (trimmed.startsWith('*')) {
    const upper = trimmed.toUpperCase();
    if (/^\*IN(\d{1,2}|[A-Z]{1,3}|\s*\()/i.test(trimmed) || /^\*(ON|OFF)\b/i.test(upper)) {
      return false;
    }
    // **FREE header and classic * comments
    return true;
  }
  return false;
}

function normalizeName(name) {
  return String(name || '').trim().toUpperCase();
}

function normalizeTableName(rawName) {
  const cleaned = String(rawName || '').trim().replace(/^"(.*)"$/, '$1').replace(/\//g, '.');
  if (!cleaned) return '';
  const segments = cleaned.split('.').filter(Boolean);
  const table = segments.length > 0 ? segments[segments.length - 1] : cleaned;
  return normalizeName(table);
}

function toRelativeProgramName(filePath) {
  return normalizeName(path.basename(String(filePath || ''), path.extname(String(filePath || ''))));
}

function normalizeDefinitionName(rawName, fallbackName) {
  const normalized = normalizeName(rawName);
  if (!normalized || normalized === '*N') {
    return normalizeName(fallbackName);
  }
  return normalized;
}

function uniqueSortedStrings(values) {
  return Array.from(new Set((values || []).map((value) => normalizeName(value)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function addEntity(map, name, payload) {
  const normalized = normalizeName(name);
  if (!normalized) return;

  if (!map.has(normalized)) {
    map.set(normalized, {
      ...payload,
      name: normalized,
      evidence: [],
    });
  }

  const entity = map.get(normalized);
  const evidenceKey = JSON.stringify(payload.evidence);
  const hasEvidence = entity.evidence.some((item) => JSON.stringify(item) === evidenceKey);
  if (!hasEvidence) {
    entity.evidence.push(payload.evidence);
  }
}

function addStructuredItem(map, key, payload) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, {
      ...payload,
      evidence: [],
    });
  }

  const item = map.get(key);
  const evidenceList = payload.evidence || [];
  for (const evidence of evidenceList) {
    const evidenceKey = JSON.stringify(evidence);
    const exists = item.evidence.some((entry) => JSON.stringify(entry) === evidenceKey);
    if (!exists) {
      item.evidence.push(evidence);
    }
  }
}

function detectSqlType(sqlText) {
  const normalized = normalizeWhitespace(sqlText).toUpperCase();
  if (/^EXEC\s+SQL\b/.test(normalized)) {
    return detectSqlType(normalized.replace(/^EXEC\s+SQL\s+/, ''));
  }
  if (/^DECLARE\b.+\bCURSOR\b/.test(normalized)) return 'DECLARE_CURSOR';
  if (/^OPEN\b/.test(normalized)) return 'OPEN_CURSOR';
  if (/^FETCH\b/.test(normalized)) return 'FETCH';
  if (/^CLOSE\b/.test(normalized)) return 'CLOSE_CURSOR';
  if (/^PREPARE\b/.test(normalized)) return 'PREPARE';
  if (/^EXECUTE\s+IMMEDIATE\b/.test(normalized)) return 'EXECUTE_IMMEDIATE';
  if (/^EXECUTE\b/.test(normalized)) return 'EXECUTE';
  if (/^CALL\b/.test(normalized)) return 'CALL';
  if (/^VALUES\b/.test(normalized)) return 'VALUES';
  if (/^SELECT\b/.test(normalized) || /^WITH\b/.test(normalized)) return 'SELECT';
  if (/^INSERT\b/.test(normalized)) return 'INSERT';
  if (/^UPDATE\b/.test(normalized)) return 'UPDATE';
  if (/^DELETE\b/.test(normalized)) return 'DELETE';
  if (/^MERGE\b/.test(normalized)) return 'MERGE';
  if (/^SET\b/.test(normalized)) return 'SET';
  if (/^COMMIT\b/.test(normalized)) return 'COMMIT';
  if (/^ROLLBACK\b/.test(normalized)) return 'ROLLBACK';
  return 'OTHER';
}

function isSchemaQualified(rawName) {
  const cleaned = String(rawName || '').trim().replace(/^"(.*)"$/, '$1');
  // Qualified if it contains a dot (SCHEMA.TABLE) or slash (LIBRARY/FILE IBM i legacy)
  return cleaned.includes('.') || cleaned.includes('/');
}

function extractSqlTables(sqlText) {
  const tables = new Set();
  let hasUnqualifiedTables = false;
  const patterns = [
    /\b(?:FROM|JOIN)\s+("[^"]+"|[A-Z0-9_#$@./]+)/gi,
    /\bINSERT\s+INTO\s+("[^"]+"|[A-Z0-9_#$@./]+)/gi,
    /\bUPDATE\s+("[^"]+"|[A-Z0-9_#$@./]+)/gi,
    /\bDELETE\s+FROM\s+("[^"]+"|[A-Z0-9_#$@./]+)/gi,
    /\bMERGE\s+INTO\s+("[^"]+"|[A-Z0-9_#$@./]+)/gi,
  ];

  for (const regex of patterns) {
    let match = regex.exec(sqlText);
    while (match) {
      const rawMatch = match[1];
      const normalized = normalizeTableName(rawMatch);
      if (normalized) {
        tables.add(normalized);
        if (!isSchemaQualified(rawMatch)) {
          hasUnqualifiedTables = true;
        }
      }
      match = regex.exec(sqlText);
    }
  }

  return { tables: Array.from(tables).sort(), hasUnqualifiedTables };
}

function extractSqlHostVariables(sqlText) {
  const variables = new Set();
  const regex = /(^|[^A-Z0-9_#$@]):([A-Z][A-Z0-9_#$@]*)/gi;
  let match = regex.exec(sqlText);

  while (match) {
    variables.add(normalizeName(match[2]));
    match = regex.exec(sqlText);
  }

  return Array.from(variables).sort((a, b) => a.localeCompare(b));
}

function extractSqlCursorActions(sqlText) {
  const actions = [];
  const patterns = [
    { action: 'DECLARE', regex: /\bDECLARE\s+([A-Z0-9_#$@]+)\s+CURSOR\b/i },
    { action: 'OPEN', regex: /\bOPEN\s+([A-Z0-9_#$@]+)\b/i },
    { action: 'FETCH', regex: /\bFETCH(?:\s+NEXT)?(?:\s+FROM)?\s+([A-Z0-9_#$@]+)\b/i },
    { action: 'CLOSE', regex: /\bCLOSE\s+([A-Z0-9_#$@]+)\b/i },
  ];

  for (const pattern of patterns) {
    const match = sqlText.match(pattern.regex);
    if (match) {
      actions.push({
        name: normalizeName(match[1]),
        action: pattern.action,
      });
    }
  }

  return actions
    .filter((entry) => entry.name)
    .sort((a, b) => {
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.action.localeCompare(b.action);
    });
}

function estimateSelectColumnCount(sqlText) {
  // Heuristic: count top-level commas in the SELECT list before FROM
  const normalized = normalizeWhitespace(sqlText);
  const selectMatch = normalized.match(/\bselect\s+(.+?)\s+from\b/i);
  if (!selectMatch) return 0;
  let list = selectMatch[1];

  // Remove common noise (but keep structure)
  // Simple top level comma count, skipping balanced parens and strings
  let count = 1;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === "'" && (i === 0 || list[i-1] !== "'")) {
      inString = !inString;
    }
    if (inString) continue;
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      count++;
    }
  }
  return count;
}

function hasDynamicSqlMarker(sqlText, sqlType) {
  const normalized = normalizeWhitespace(sqlText).toUpperCase();
  if (['PREPARE', 'EXECUTE', 'EXECUTE_IMMEDIATE'].includes(sqlType)) {
    return true;
  }
  if (/\bFROM\s+:[A-Z][A-Z0-9_#$@]*\b/i.test(normalized)) {
    return true;
  }
  if (/\bCURSOR\s+FOR\s+:[A-Z][A-Z0-9_#$@]*\b/i.test(normalized)) {
    return true;
  }
  const declareCursorMatch = normalized.match(/\bCURSOR\s+FOR\s+([A-Z0-9_#$@]+)\b/);
  if (sqlType === 'DECLARE_CURSOR' && declareCursorMatch) {
    const target = declareCursorMatch[1];
    if (!['SELECT', 'WITH', 'VALUES'].includes(target)) {
      return true;
    }
  }
  return false;
}

function determineSqlIntent(sqlType, sqlText) {
  if (['SELECT', 'FETCH', 'VALUES'].includes(sqlType)) return 'READ';
  if (['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(sqlType)) return 'WRITE';
  if (sqlType === 'DECLARE_CURSOR') {
    return /\bCURSOR\s+FOR\s+(SELECT|WITH|VALUES)\b/i.test(sqlText) ? 'READ' : 'CURSOR';
  }
  if (['OPEN_CURSOR', 'CLOSE_CURSOR'].includes(sqlType)) return 'CURSOR';
  if (sqlType === 'CALL') return 'CALL';
  if (['COMMIT', 'ROLLBACK'].includes(sqlType)) return 'TRANSACTION';
  return 'OTHER';
}

function normalizeSqlAlias(rawAlias) {
  const alias = normalizeName(rawAlias);
  if (!alias || SQL_ALIAS_STOP_WORDS.has(alias)) {
    return '';
  }
  return alias;
}

function normalizeSqlJoinType(rawJoinType) {
  const normalized = normalizeWhitespace(rawJoinType).toUpperCase();
  if (!normalized) return 'INNER';
  return normalized.replace(/\s+OUTER$/, '');
}

function extractStaticSqlQueryBody(sqlText, sqlType) {
  const normalized = normalizeWhitespace(sqlText);
  if (sqlType === 'SELECT') {
    return normalized;
  }
  if (sqlType === 'DECLARE_CURSOR') {
    const match = normalized.match(/\bCURSOR\s+FOR\s+(.+)$/i);
    return match ? normalizeWhitespace(match[1]) : '';
  }
  return '';
}

function splitSqlWhereFilters(whereClause) {
  const normalized = normalizeWhitespace(whereClause);
  if (!normalized) {
    return {
      filters: [],
      complex: false,
    };
  }

  const complex = /\bOR\b|\bNOT\b|\bEXISTS\b|\bIN\s*\(|\bBETWEEN\b|\bLIKE\b|\(/i.test(normalized);
  if (complex) {
    return {
      filters: [normalized],
      complex: true,
    };
  }

  return {
    filters: normalized
      .split(/\s+AND\s+/i)
      .map((entry) => normalizeWhitespace(entry))
      .filter(Boolean),
    complex: false,
  };
}

function extractSqlRelationSemantics(sqlText, sqlType, dynamic) {
  const empty = {
    driverTable: null,
    joins: [],
    filters: [],
    confidence: null,
    uncertainty: [],
  };

  if (dynamic || !['SELECT', 'DECLARE_CURSOR'].includes(sqlType)) {
    return empty;
  }

  const queryBody = extractStaticSqlQueryBody(sqlText, sqlType);
  if (!queryBody) {
    return {
      ...empty,
      confidence: 'LOW',
      uncertainty: ['RELATIONSHIP_PARSE_PARTIAL'],
    };
  }

  const uncertainty = [];
  if (/^\s*WITH\b/i.test(queryBody)) {
    uncertainty.push('CTE_SQL');
  }
  if (/\bFROM\s+[^;]+,\s*("[^"]+"|[A-Z0-9_#$@./]+)/i.test(queryBody)) {
    uncertainty.push('LEGACY_JOIN_SYNTAX');
  }

  const fromMatch = queryBody.match(/\bFROM\s+("[^"]+"|[A-Z0-9_#$@./]+)(?:\s+(?:AS\s+)?([A-Z][A-Z0-9_#$@]*))?/i);
  const driverTable = fromMatch ? normalizeTableName(fromMatch[1]) : '';
  if (!driverTable) {
    uncertainty.push('RELATIONSHIP_PARSE_PARTIAL');
  }

  const joins = [];
  const joinRegex = /\b(?:(INNER|LEFT(?:\s+OUTER)?|RIGHT(?:\s+OUTER)?|FULL(?:\s+OUTER)?|CROSS)\s+)?JOIN\s+("[^"]+"|[A-Z0-9_#$@./]+)(?:\s+(?:AS\s+)?([A-Z][A-Z0-9_#$@]*))?(?:\s+ON\s+(.+?))?(?=\s+(?:(?:INNER|LEFT(?:\s+OUTER)?|RIGHT(?:\s+OUTER)?|FULL(?:\s+OUTER)?|CROSS)\s+)?JOIN\b|\s+\b(?:WHERE|GROUP|ORDER|HAVING|UNION|FETCH|FOR|OFFSET|LIMIT)\b|$)/gi;
  let joinMatch = joinRegex.exec(queryBody);
  while (joinMatch) {
    const joinType = normalizeSqlJoinType(joinMatch[1]);
    const table = normalizeTableName(joinMatch[2]);
    const alias = normalizeSqlAlias(joinMatch[3]);
    const condition = normalizeWhitespace(joinMatch[4] || '');
    if (!condition && joinType !== 'CROSS') {
      uncertainty.push('JOIN_CONDITION_PARTIAL');
    }
    if (table) {
      joins.push({
        table,
        alias: alias || null,
        joinType,
        condition: condition || null,
        hostVariables: extractSqlHostVariables(condition),
      });
    }
    joinMatch = joinRegex.exec(queryBody);
  }

  const whereMatch = queryBody.match(/\bWHERE\s+(.+?)(?=\s+\b(?:GROUP|ORDER|HAVING|UNION|FETCH|FOR|OFFSET|LIMIT)\b|$)/i);
  const filters = [];
  if (whereMatch) {
    const split = splitSqlWhereFilters(whereMatch[1]);
    if (split.complex) {
      uncertainty.push('FILTER_COMPLEX_PREDICATE');
    }
    for (const entry of split.filters) {
      filters.push({
        text: entry,
        hostVariables: extractSqlHostVariables(entry),
      });
    }
  }

  let confidence = null;
  if (driverTable) {
    confidence = uncertainty.some((marker) => ['RELATIONSHIP_PARSE_PARTIAL'].includes(marker))
      ? 'LOW'
      : uncertainty.some((marker) => ['CTE_SQL', 'LEGACY_JOIN_SYNTAX', 'JOIN_CONDITION_PARTIAL', 'FILTER_COMPLEX_PREDICATE'].includes(marker))
        ? 'MEDIUM'
        : 'HIGH';
  } else if (joins.length > 0 || filters.length > 0) {
    confidence = 'LOW';
  }

  return {
    driverTable: driverTable || null,
    joins,
    filters,
    confidence,
    uncertainty: Array.from(new Set(uncertainty)).sort((a, b) => a.localeCompare(b)),
  };
}

function buildSqlUncertainty({ sqlType, intent, tables, cursors, dynamic, unresolved, hasUnqualifiedTables }) {
  const markers = [];
  if (dynamic) {
    markers.push('DYNAMIC_SQL');
  }
  if (unresolved) {
    markers.push('UNRESOLVED_SQL');
  }
  if ((intent === 'READ' || intent === 'WRITE') && tables.length === 0 && (cursors || []).length === 0) {
    markers.push('UNRESOLVED_TABLES');
  }
  if (hasUnqualifiedTables) {
    markers.push('UNRESOLVED_LIBRARY');
  }
  if (sqlType === 'OTHER') {
    markers.push('UNKNOWN_STATEMENT_TYPE');
  }
  return Array.from(new Set(markers)).sort((a, b) => a.localeCompare(b));
}

function createSqlStatement({
  filePath,
  startLine,
  endLine,
  sqlText,
}) {
  const normalizedText = normalizeWhitespace(sqlText);
  const type = detectSqlType(normalizedText);
  const { tables, hasUnqualifiedTables } = extractSqlTables(normalizedText);
  const hostVariables = extractSqlHostVariables(normalizedText);
  const cursors = extractSqlCursorActions(normalizedText);
  const dynamic = hasDynamicSqlMarker(normalizedText, type);
  const intent = determineSqlIntent(type, normalizedText);
  const readsData = intent === 'READ';
  const writesData = intent === 'WRITE';
  const unresolved = dynamic || ((readsData || writesData) && tables.length === 0 && cursors.length === 0);
  const relationSemantics = extractSqlRelationSemantics(normalizedText, type, dynamic);
  const selectColumnCount = (['SELECT', 'DECLARE_CURSOR'].includes(type) && !dynamic)
    ? estimateSelectColumnCount(normalizedText)
    : null;
  const uncertainty = uniqueSortedStrings([
    ...buildSqlUncertainty({
      sqlType: type,
      intent,
      tables,
      cursors,
      dynamic,
      unresolved,
      hasUnqualifiedTables,
    }),
    ...(relationSemantics.uncertainty || []),
  ]);

  return {
    type,
    intent,
    text: normalizedText,
    tables,
    hostVariables,
    cursors,
    selectColumnCount,
    readsData,
    writesData,
    dynamic,
    unresolved,
    driverTable: relationSemantics.driverTable || null,
    joins: relationSemantics.joins || [],
    filters: relationSemantics.filters || [],
    confidence: relationSemantics.confidence || null,
    uncertainty,
    evidence: [
      {
        file: filePath,
        startLine,
        endLine,
      },
    ],
  };
}

function createDefinition({
  filePath,
  ownerProgram,
  name,
  kind,
  startLine,
  endLine,
  sourceForm,
  exported = false,
  imported = false,
  externalName = null,
  text = '',
  paramCount = 0,
  hasPi = false,
  returnType = null,
}) {
  const def = {
    name,
    kind,
    ownerProgram,
    sourceFile: filePath,
    startLine,
    endLine,
    sourceForm,
    exported: Boolean(exported),
    imported: Boolean(imported),
    externalName: externalName ? normalizeName(externalName) : null,
    evidence: [{
      file: filePath,
      startLine,
      endLine,
      text: normalizeWhitespace(text),
    }],
  };
  if (kind === 'PROCEDURE') {
    def.paramCount = Number(paramCount) || 0;
    def.hasPi = Boolean(hasPi);
    def.returnType = returnType ? normalizeName(returnType) : null;
  }
  return def;
}

function createProcedureCall({
  filePath,
  ownerProgram,
  ownerName,
  ownerKind,
  lineNo,
  text,
  name,
  resolution,
  targetKind,
  targetProgram = null,
}) {
  return {
    name: normalizeName(name),
    ownerProgram: normalizeName(ownerProgram),
    ownerName: normalizeName(ownerName),
    ownerKind: normalizeName(ownerKind),
    resolution: normalizeName(resolution),
    targetKind: normalizeName(targetKind),
    targetProgram: targetProgram ? normalizeName(targetProgram) : null,
    ownerFile: filePath,
    evidence: [{
      file: filePath,
      line: lineNo,
      text: normalizeWhitespace(text),
    }],
  };
}

function createNativeFileDeclaration({
  filePath,
  ownerProgram,
  name,
  kind,
  lineNo,
  declaredAccess,
  keyed,
  text,
}) {
  return {
    name: normalizeName(name),
    ownerProgram: normalizeName(ownerProgram),
    sourceFile: filePath,
    kind: normalizeName(kind || 'FILE') || 'FILE',
    declaredAccess: uniqueSortedStrings(declaredAccess),
    keyed: Boolean(keyed),
    evidence: [{
      file: filePath,
      line: lineNo,
      text: normalizeWhitespace(text),
    }],
  };
}

function createNativeFileAccess({
  filePath,
  ownerProgram,
  ownerName,
  ownerKind,
  lineNo,
  text,
  fileName,
  fileKind,
  opcode,
  accessKind,
  recordFormat = null,
  keyed = false,
  interactive = false,
  mutating = false,
}) {
  return {
    fileName: normalizeName(fileName),
    fileKind: normalizeName(fileKind || 'FILE') || 'FILE',
    opcode: normalizeName(opcode),
    accessKind: normalizeName(accessKind),
    recordFormat: recordFormat ? normalizeName(recordFormat) : null,
    keyed: Boolean(keyed),
    interactive: Boolean(interactive),
    mutating: Boolean(mutating),
    ownerProgram: normalizeName(ownerProgram),
    ownerName: normalizeName(ownerName),
    ownerKind: normalizeName(ownerKind),
    ownerFile: filePath,
    evidence: [{
      file: filePath,
      line: lineNo,
      text: normalizeWhitespace(text),
    }],
  };
}

function createModule({
  filePath,
  ownerProgram,
  name,
  lineNo,
  kind,
  bindingDirectories = [],
  servicePrograms = [],
  importedProcedures = [],
  text,
}) {
  return {
    name: normalizeName(name),
    ownerProgram: normalizeName(ownerProgram),
    sourceFile: filePath,
    kind: normalizeName(kind || 'PROGRAM_MODULE') || 'PROGRAM_MODULE',
    bindingDirectories: uniqueSortedStrings(bindingDirectories),
    servicePrograms: uniqueSortedStrings(servicePrograms),
    importedProcedures: uniqueSortedStrings(importedProcedures),
    evidence: [{
      file: filePath,
      line: lineNo,
      text: normalizeWhitespace(text),
    }],
  };
}

function createBindingDirectory({
  filePath,
  name,
  lineNo,
  text,
}) {
  return {
    name: normalizeName(name),
    sourceFile: filePath,
    evidence: [{
      file: filePath,
      line: lineNo,
      text: normalizeWhitespace(text),
    }],
  };
}

function createServiceProgram({
  filePath,
  name,
  lineNo,
  sourceKind = 'HINT',
  exports = [],
  text,
}) {
  return {
    name: normalizeName(name),
    sourceFile: filePath || null,
    sourceKind: normalizeName(sourceKind || 'HINT') || 'HINT',
    exports: (exports || [])
      .map((entry) => ({
        symbol: normalizeName(entry && entry.symbol),
        signatureLevel: normalizeName(entry && entry.signatureLevel ? entry.signatureLevel : 'CURRENT') || 'CURRENT',
      }))
      .filter((entry) => entry.symbol)
      .sort((a, b) => {
        if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
        return a.signatureLevel.localeCompare(b.signatureLevel);
      }),
    evidence: [{
      file: filePath || '',
      line: lineNo,
      text: normalizeWhitespace(text),
    }],
  };
}

function createBindingDiagnostic({
  code,
  severity = 'warning',
  message,
  filePath,
  ownerProgram = null,
  symbol = null,
  moduleName = null,
  serviceProgram = null,
}) {
  return {
    code: normalizeName(code),
    severity: String(severity || 'warning').toLowerCase(),
    message: String(message || '').trim(),
    details: {
      file: filePath || '',
      ownerProgram: ownerProgram ? normalizeName(ownerProgram) : null,
      moduleName: moduleName ? normalizeName(moduleName) : null,
      symbol: symbol ? normalizeName(symbol) : null,
      serviceProgram: serviceProgram ? normalizeName(serviceProgram) : null,
    },
  };
}

function isBinderSourceFile(filePath, lines) {
  const ext = String(path.extname(String(filePath || '')) || '').toUpperCase();
  if (BINDER_SOURCE_EXTENSIONS.has(ext)) {
    return true;
  }
  return (lines || []).some((line) => /\bSTRPGMEXP\b|\bENDPGMEXP\b|\bEXPORT\s+SYMBOL\b/i.test(String(line || '')));
}

function isRpgLikeSourceFile(filePath) {
  const ext = String(path.extname(String(filePath || '')) || '').toUpperCase();
  return ['.RPG', '.RPGLE', '.SQLRPGLE', '.RPGILE'].includes(ext);
}

function extractKeywordValues(text, keyword) {
  const match = String(text || '').match(new RegExp(`\\b${keyword}\\s*\\(([^)]*)\\)`, 'i'));
  if (!match) return [];

  const raw = match[1] || '';
  const quoted = Array.from(raw.matchAll(/['"]([^'"]+)['"]/g)).map((entry) => entry[1]);
  if (quoted.length > 0) {
    return uniqueSortedStrings(quoted);
  }

  return uniqueSortedStrings(raw
    .split(/[:\s,]+/)
    .map((value) => value.replace(/^\*/, ''))
    .filter(Boolean));
}

function collectControlOptionBlocks(lines) {
  const blocks = [];
  let collecting = false;
  let buffer = [];
  let startLine = 0;

  for (let i = 0; i < (lines || []).length; i += 1) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    if (isCommentLine(rawLine)) continue;
    const trimmed = String(rawLine || '').trim();

    if (!collecting && /^ctl-opt\b/i.test(trimmed)) {
      collecting = true;
      startLine = lineNo;
      buffer = [trimmed];
      if (trimmed.includes(';')) {
        blocks.push({ lineNo: startLine, text: normalizeWhitespace(buffer.join(' ')) });
        collecting = false;
        buffer = [];
      }
      continue;
    }

    if (collecting) {
      buffer.push(trimmed);
      if (trimmed.includes(';')) {
        blocks.push({ lineNo: startLine, text: normalizeWhitespace(buffer.join(' ')) });
        collecting = false;
        buffer = [];
      }
      continue;
    }

    if (/^\s*H\b/i.test(rawLine) && /\b(BNDDIR|BNDSRVPGM|NOMAIN)\b/i.test(rawLine)) {
      blocks.push({ lineNo, text: normalizeWhitespace(trimmed) });
    }
  }

  if (collecting && buffer.length > 0) {
    blocks.push({ lineNo: startLine || 1, text: normalizeWhitespace(buffer.join(' ')) });
  }

  return blocks;
}

function collectBinderSourceSemantics(filePath, lines) {
  const serviceProgramName = toRelativeProgramName(filePath);
  const exports = [];
  let signatureLevel = 'CURRENT';
  let firstLine = 1;

  for (let i = 0; i < (lines || []).length; i += 1) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    if (isCommentLine(rawLine)) continue;
    const trimmed = String(rawLine || '').trim();

    const startMatch = trimmed.match(/\bSTRPGMEXP\b(?:.*\bPGMLVL\s*\(\s*\*?([A-Z]+)\s*\))?/i);
    if (startMatch) {
      signatureLevel = normalizeName(startMatch[1] || 'CURRENT') || 'CURRENT';
      firstLine = lineNo;
    }

    const exportMatch = trimmed.match(/\bEXPORT\s+SYMBOL\s*\(\s*['"]?([A-Z0-9_#$@]+)['"]?\s*\)/i);
    if (exportMatch) {
      exports.push({
        symbol: exportMatch[1],
        signatureLevel,
      });
      if (!firstLine) {
        firstLine = lineNo;
      }
    }
  }

  const servicePrograms = exports.length > 0 || isBinderSourceFile(filePath, lines)
    ? [createServiceProgram({
      filePath,
      name: serviceProgramName,
      lineNo: firstLine || 1,
      sourceKind: 'BINDER_SOURCE',
      exports,
      text: `Binder source for ${serviceProgramName}`,
    })]
    : [];

  return {
    modules: [],
    bindingDirectories: [],
    servicePrograms,
    diagnostics: [],
  };
}

function collectModuleBindingSemantics(filePath, lines, ownerProgram, prototypes) {
  if (!isRpgLikeSourceFile(filePath)) {
    return {
      modules: [],
      bindingDirectories: [],
      servicePrograms: [],
      diagnostics: [],
    };
  }

  const controlBlocks = collectControlOptionBlocks(lines);
  const bindingDirectoryMap = new Map();
  const serviceProgramMap = new Map();
  let moduleLineNo = 1;
  let moduleText = path.basename(filePath);
  let noMain = false;

  for (const block of controlBlocks) {
    moduleLineNo = block.lineNo || moduleLineNo;
    moduleText = block.text || moduleText;
    if (/\bNOMAIN\b/i.test(block.text || '')) {
      noMain = true;
    }

    for (const bindingDirectory of extractKeywordValues(block.text, 'BNDDIR')) {
      bindingDirectoryMap.set(bindingDirectory, createBindingDirectory({
        filePath,
        name: bindingDirectory,
        lineNo: block.lineNo,
        text: block.text,
      }));
    }

    for (const serviceProgram of extractKeywordValues(block.text, 'BNDSRVPGM')) {
      serviceProgramMap.set(serviceProgram, createServiceProgram({
        filePath,
        name: serviceProgram,
        lineNo: block.lineNo,
        sourceKind: 'HINT',
        exports: [],
        text: block.text,
      }));
    }
  }

  const importedProcedures = uniqueSortedStrings((prototypes || [])
    .filter((entry) => entry.imported)
    .map((entry) => entry.name));
  const bindingDirectories = Array.from(bindingDirectoryMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  const servicePrograms = Array.from(serviceProgramMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  const modules = [createModule({
    filePath,
    ownerProgram,
    name: ownerProgram,
    lineNo: moduleLineNo,
    kind: noMain ? 'NOMAIN_MODULE' : 'PROGRAM_MODULE',
    bindingDirectories: bindingDirectories.map((entry) => entry.name),
    servicePrograms: servicePrograms.map((entry) => entry.name),
    importedProcedures,
    text: moduleText,
  })];

  const diagnostics = [];
  if (importedProcedures.length > 0 && bindingDirectories.length === 0 && servicePrograms.length === 0) {
    diagnostics.push(createBindingDiagnostic({
      code: 'UNRESOLVED_BINDING_IMPORTS',
      message: `Imported procedures lack explicit binding evidence in ${ownerProgram}.`,
      filePath,
      ownerProgram,
      moduleName: ownerProgram,
    }));
  }

  return {
    modules,
    bindingDirectories,
    servicePrograms,
    diagnostics,
  };
}

function parseFixedPrototype(rawLine) {
  const match = rawLine.match(/^\s*D\s+([A-Z0-9_#$@*]+)\s+PR\b(.*)$/i);
  if (!match) return null;
  return {
    name: match[1],
    detail: match[2] || '',
  };
}

function inferNativeFileKind(detail) {
  const upper = String(detail || '').toUpperCase();
  if (upper.includes('WORKSTN')) return 'WORKSTN';
  if (upper.includes('PRINTER')) return 'PRINTER';
  if (upper.includes('DISK')) return 'DISK';
  return 'FILE';
}

function parseDeclaredAccess(detail) {
  const upper = String(detail || '').toUpperCase();
  const usageMatch = upper.match(/\bUSAGE\s*\(\s*([^)]+)\)/);
  const modes = new Set();
  const tokens = usageMatch ? usageMatch[1].split(/[:\s,]+/) : [];

  for (const token of tokens) {
    const normalized = token.replace(/^\*/, '');
    if (normalized === 'INPUT') {
      modes.add('READ');
    } else if (normalized === 'OUTPUT' || normalized === 'ADD') {
      modes.add('WRITE');
    } else if (normalized === 'UPDATE') {
      modes.add('READ');
      modes.add('UPDATE');
    }
  }

  return Array.from(modes).sort((a, b) => a.localeCompare(b));
}

function parseFixedDeclaredAccess(rawLine) {
  const match = rawLine.match(/^\s*F[A-Z0-9_#$@]+\s+([A-Z]{1,3})\b/i);
  const token = match ? normalizeName(match[1]) : '';
  const modes = new Set();

  if (token.includes('I')) {
    modes.add('READ');
  }
  if (token.includes('O')) {
    modes.add('WRITE');
  }
  if (token.includes('U')) {
    modes.add('READ');
    modes.add('UPDATE');
  }

  return Array.from(modes).sort((a, b) => a.localeCompare(b));
}

function collectDefinitions(filePath, lines) {
  const ownerProgram = toRelativeProgramName(filePath);
  const proceduresMap = new Map();
  const prototypesMap = new Map();

  let currentProcedure = null;
  let currentPrototype = null;
  let currentSubroutine = null;

  function finalizeProcedure(endLine) {
    if (!currentProcedure) return;
    const definition = createDefinition({
      filePath,
      ownerProgram,
      name: currentProcedure.name,
      kind: 'PROCEDURE',
      startLine: currentProcedure.startLine,
      endLine,
      sourceForm: 'FREE_FORM',
      exported: currentProcedure.exported,
      text: currentProcedure.text,
      paramCount: currentProcedure.paramCount || 0,
      hasPi: !!currentProcedure.hasPi,
      returnType: currentProcedure.returnType || null,
    });
    addStructuredItem(
      proceduresMap,
      `${definition.ownerProgram}|${definition.sourceFile}|${definition.kind}|${definition.name}|${definition.startLine}`,
      definition,
    );
    currentProcedure = null;
  }

  function finalizePrototype(endLine) {
    if (!currentPrototype) return;
    const definition = createDefinition({
      filePath,
      ownerProgram,
      name: currentPrototype.name,
      kind: 'PROTOTYPE',
      startLine: currentPrototype.startLine,
      endLine,
      sourceForm: currentPrototype.sourceForm,
      exported: currentPrototype.exported,
      imported: currentPrototype.imported,
      externalName: currentPrototype.externalName,
      text: currentPrototype.text,
    });
    addStructuredItem(
      prototypesMap,
      `${definition.ownerProgram}|${definition.sourceFile}|${definition.kind}|${definition.name}|${definition.startLine}`,
      definition,
    );
    currentPrototype = null;
  }

  function finalizeSubroutine(endLine) {
    if (!currentSubroutine) return;
    const definition = createDefinition({
      filePath,
      ownerProgram,
      name: currentSubroutine.name,
      kind: 'SUBROUTINE',
      startLine: currentSubroutine.startLine,
      endLine,
      sourceForm: 'FIXED_FORM',
      text: currentSubroutine.text,
    });
    addStructuredItem(
      proceduresMap,
      `${definition.ownerProgram}|${definition.sourceFile}|${definition.kind}|${definition.name}|${definition.startLine}`,
      definition,
    );
    currentSubroutine = null;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    if (isCommentLine(rawLine)) {
      continue;
    }

    const trimmed = rawLine.trim();

    if (currentPrototype) {
      if (/\bend-pr\b/i.test(trimmed)) {
        finalizePrototype(lineNo);
      }
      continue;
    }

    if (currentProcedure) {
      if (/\bend-proc\b/i.test(trimmed)) {
        finalizeProcedure(lineNo);
      } else if (!currentProcedure.hasPi && /^dcl-pi\b/i.test(trimmed)) {
        currentProcedure.hasPi = true;
        const piDetail = trimmed.replace(/^dcl-pi\s*/i, '').trim();
        if (/\bend-pi\b/i.test(piDetail)) {
          // single line pi
          const retMatch = piDetail.match(/\b(end-pi|)\s*([A-Z][A-Z0-9_]*|\*)\s*$/i);
          if (retMatch && retMatch[2] && retMatch[2] !== 'END-PI') currentProcedure.returnType = normalizeName(retMatch[2]);
        }
        // count simple parms on this line if any
        const parmMatches = (trimmed.match(/\b[A-Z0-9_#$@]+\s+(like|char|zoned|packed|int|uns|date|time|timestamp|varchar|ind|pointer|object)\b/gi) || []).length;
        if (parmMatches) currentProcedure.paramCount = parmMatches;
      } else if (currentProcedure.hasPi) {
        if (/\bend-pi\b/i.test(trimmed)) {
          // end of pi, param count may have been set from dcl-parm but rough count ok
        } else {
          // rough param detection on dcl-parm or inline
          if (/^\s*dcl-parm\s+/i.test(trimmed) || /^\s*[A-Z0-9_#$@]+\s+(like|char|zoned|packed|int|uns|date|time|varchar|ind)\b/i.test(trimmed)) {
            currentProcedure.paramCount = (currentProcedure.paramCount || 0) + 1;
          }
          const retCandidate = trimmed.match(/^\s*([A-Z][A-Z0-9_]*|\*)\s*;\s*$/i);
          if (retCandidate && !currentProcedure.returnType) {
            currentProcedure.returnType = normalizeName(retCandidate[1]);
          }
        }
      }
      continue;
    }

    if (currentSubroutine) {
      if (/^\s*endsr\b/i.test(trimmed) || /\bENDSR\b/i.test(trimmed)) {
        finalizeSubroutine(lineNo);
      }
      continue;
    }

    const dclPrMatch = trimmed.match(/^dcl-pr\s+([A-Z0-9_#$@*]+)\b(.*)$/i);
    if (dclPrMatch) {
      const detail = dclPrMatch[2] || '';
      const externalMatch = detail.match(/\bext(?:proc|pgm)\s*\(\s*['"]?([A-Z0-9_#$@]+)['"]?\s*\)/i);
      currentPrototype = {
        name: normalizeDefinitionName(dclPrMatch[1], ownerProgram),
        startLine: lineNo,
        sourceForm: 'FREE_FORM',
        imported: Boolean(externalMatch),
        exported: /\bexport\b/i.test(detail),
        externalName: externalMatch ? externalMatch[1] : null,
        text: trimmed,
      };
      if (/\bend-pr\b/i.test(trimmed)) {
        finalizePrototype(lineNo);
      }
      continue;
    }

    const fixedPrototype = parseFixedPrototype(rawLine);
    if (fixedPrototype) {
      const externalMatch = String(fixedPrototype.detail || '').match(/\bEXT(?:PROC|PGM)\s*\(\s*['"]?([A-Z0-9_#$@]+)['"]?\s*\)/i);
      const definition = createDefinition({
        filePath,
        ownerProgram,
        name: normalizeDefinitionName(fixedPrototype.name, ownerProgram),
        kind: 'PROTOTYPE',
        startLine: lineNo,
        endLine: lineNo,
        sourceForm: 'FIXED_FORM',
        imported: Boolean(externalMatch),
        externalName: externalMatch ? externalMatch[1] : null,
        text: trimmed,
      });
      addStructuredItem(
        prototypesMap,
        `${definition.ownerProgram}|${definition.sourceFile}|${definition.kind}|${definition.name}|${definition.startLine}`,
        definition,
      );
      continue;
    }

    const dclProcMatch = trimmed.match(/^dcl-proc\s+([A-Z0-9_#$@*]+)\b(.*)$/i);
    if (dclProcMatch) {
      currentProcedure = {
        name: normalizeDefinitionName(dclProcMatch[1], ownerProgram),
        startLine: lineNo,
        exported: /\bexport\b/i.test(dclProcMatch[2] || ''),
        text: trimmed,
        paramCount: 0,
        hasPi: false,
        returnType: null,
      };
      if (/\bend-proc\b/i.test(trimmed)) {
        finalizeProcedure(lineNo);
      }
      continue;
    }

    const freeBegsrMatch = trimmed.match(/^begsr\s+([A-Z0-9_#$@*]+)\b/i);
    if (freeBegsrMatch) {
      currentSubroutine = {
        name: normalizeDefinitionName(freeBegsrMatch[1], ownerProgram),
        startLine: lineNo,
        text: trimmed,
      };
      continue;
    }

    const fixedBegsrMatch = rawLine.match(/^\s*C?\s*([A-Z0-9_#$@*]+)\s+BEGSR\b/i);
    if (fixedBegsrMatch) {
      currentSubroutine = {
        name: normalizeDefinitionName(fixedBegsrMatch[1], ownerProgram),
        startLine: lineNo,
        text: trimmed,
      };
    }
  }

  if (currentPrototype) {
    finalizePrototype(lines.length);
  }
  if (currentProcedure) {
    finalizeProcedure(lines.length);
  }
  if (currentSubroutine) {
    finalizeSubroutine(lines.length);
  }

  const procedures = Array.from(proceduresMap.values()).sort((a, b) => {
    if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    return a.name.localeCompare(b.name);
  });
  const localProcedureNames = new Set(procedures.map((entry) => entry.name));
  const prototypes = Array.from(prototypesMap.values())
    .map((prototype) => ({
      ...prototype,
      imported: prototype.imported || !localProcedureNames.has(prototype.name),
    }))
    .sort((a, b) => {
      if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
      if (a.startLine !== b.startLine) return a.startLine - b.startLine;
      return a.name.localeCompare(b.name);
    });

  return {
    ownerProgram,
    procedures,
    prototypes,
  };
}

function collectBifUsages(filePath, lines) {
  const ownerProgram = toRelativeProgramName(filePath);
  const usages = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (isCommentLine(rawLine)) continue;
    let match;
    const regex = /%([A-Z][A-Z0-9_]*)\s*\(/gi;
    // eslint-disable-next-line no-cond-assign
    while ((match = regex.exec(rawLine)) !== null) {
      const bif = normalizeName(match[1]);
      if (!bif) continue;
      const key = `${ownerProgram}:${bif}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      usages.push({
        name: bif,
        ownerProgram,
        evidence: [{ file: filePath, line: i + 1, text: rawLine.trim() }],
      });
    }
  }

  return usages.sort((a, b) => a.name.localeCompare(b.name) || a.evidence.line - b.evidence.line);
}

function normalizeIndicator(ind) {
  if (!ind) return '*IN';
  const raw = String(ind).toUpperCase().trim();
  if (/^\d{1,2}$/.test(raw)) {
    const num = raw.padStart(2, '0');
    return '*IN' + num;
  }
  // Only accept well-known RPG indicator suffixes
  const known = ['LR', 'RT', 'OF', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8', 'U9', 'KA', 'KB', 'KC', 'KD', 'KE', 'KF', 'KG', 'KH', 'KI', 'KJ', 'KK', 'KL', 'KM', 'KN', 'KO', 'KP', 'KQ', 'KR', 'KS', 'KT', 'KU', 'KV', 'KW', 'KX', 'KY', 'KZ'];
  if (known.includes(raw)) {
    return '*IN' + raw;
  }
  if (/^\d{1,2}$/.test(raw)) return '*IN' + raw.padStart(2, '0');
  // numeric padded already handled
  return null; // reject unknown like INPUT
}

function collectIndicatorUsages(filePath, lines) {
  const ownerProgram = toRelativeProgramName(filePath);
  const usages = [];
  const seen = new Set();

  const indicatorRegex = /\*IN((\d{1,2})|([A-Z]{2,3}))\b(?!\w)|\*IN\s*\(\s*(\d{1,2}|[A-Z]{2,3})\s*\)/gi;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (isCommentLine(rawLine)) continue;
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = indicatorRegex.exec(rawLine)) !== null) {
      let ind = match[1] || match[4] || match[2] || match[3];
      const normalized = normalizeIndicator(ind);
      if (!normalized) continue;
      const key = `${ownerProgram}:${normalized}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Heuristic write detection: left side of = or SETON/SETOFF or MOVE *IN
      const upper = rawLine.toUpperCase();
      const isWrite = /(?:^|[^A-Z0-9_])\*IN(?:\d{2}|[A-Z]{1,3}|\s*\()\s*=/i.test(upper) ||
                      /\bSETON\b|\bSETOFF\b/i.test(upper) ||
                      /\bMOVE\b.*\*IN/i.test(upper);
      usages.push({
        name: normalized,
        kind: isWrite ? 'WRITE' : 'READ',
        ownerProgram,
        evidence: [{ file: filePath, line: i + 1, text: rawLine.trim() }],
      });
    }
  }

  return usages.sort((a, b) => a.name.localeCompare(b.name) || a.evidence.line - b.evidence.line);
}

function collectDataDeclarations(filePath, lines) {
  const ownerProgram = toRelativeProgramName(filePath);
  const dataStructures = [];
  const standaloneFields = [];
  const constants = [];

  let currentDS = null;
  let inDS = false;

  function finalizeDS(endLine) {
    if (!currentDS) return;
    dataStructures.push({
      name: currentDS.name,
      ownerProgram,
      qualified: currentDS.qualified,
      like: currentDS.like || null,
      dim: currentDS.dim || null,
      external: currentDS.external || null,
      subfieldCount: currentDS.subfields.length,
      subfields: currentDS.subfields.slice(0, 12), // bounded for token efficiency
      sourceForm: currentDS.sourceForm,
      startLine: currentDS.startLine,
      endLine,
      evidence: [{ file: filePath, startLine: currentDS.startLine, endLine, text: currentDS.text }],
    });
    currentDS = null;
    inDS = false;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (isCommentLine(rawLine)) continue;
    const trimmed = rawLine.trim();

    // Free form DCL-DS
    const dclDsMatch = trimmed.match(/^dcl-ds\s+([A-Z0-9_#$@]+)\b(.*)$/i);
    if (dclDsMatch) {
      if (currentDS) finalizeDS(i);
      const detail = (dclDsMatch[2] || '').toLowerCase();
      const likeMatch = detail.match(/\blikeds\s*\(\s*([A-Z0-9_#$@.]+)\s*\)/i) ||
                        detail.match(/\bliker ec\s*\(\s*([A-Z0-9_#$@.]+)\s*\)/i);
      const qualified = /\bqualified\b/i.test(detail);
      const dimMatch = detail.match(/\bdim\s*\(\s*(\d+)\s*\)/i);
      const extMatch = detail.match(/\bext(name|fld)\s*\(\s*['"]?([^'")]+)['"]?\s*\)/i);
      currentDS = {
        name: normalizeName(dclDsMatch[1]),
        startLine: i + 1,
        qualified,
        like: likeMatch ? normalizeName(likeMatch[1]) : null,
        dim: dimMatch ? dimMatch[1] : null,
        external: extMatch ? normalizeName(extMatch[2]) : null,
        subfields: [],
        sourceForm: 'FREE_FORM',
        text: trimmed,
      };
      inDS = true;
      if (/\bend-ds\b/i.test(trimmed)) {
        finalizeDS(i + 1);
      }
      continue;
    }

    if (inDS && currentDS) {
      if (/\bend-ds\b/i.test(trimmed)) {
        finalizeDS(i + 1);
        continue;
      }
      // Capture simple subfield names (dcl-subf or bare name + type-ish)
      const subMatch = trimmed.match(/^(?:dcl-subf\s+)?([A-Z0-9_#$@]+)\b/i);
      if (subMatch && !/^(dcl-ds|end-ds|dcl-proc|dcl-pi|dcl-pr|if|else|for|dcl-f)\b/i.test(subMatch[1])) {
        const sfName = normalizeName(subMatch[1]);
        if (sfName && !currentDS.subfields.includes(sfName)) {
          currentDS.subfields.push(sfName);
        }
      }
      continue;
    }

    // Free form DCL-S (standalone)
    const dclSMatch = trimmed.match(/^dcl-s\s+([A-Z0-9_#$@]+)\b(.*)$/i);
    if (dclSMatch) {
      const name = normalizeName(dclSMatch[1]);
      const detail = dclSMatch[2] || '';
      const likeMatch = detail.match(/\blike\s*\(\s*([A-Z0-9_#$@.]+)\s*\)/i);
      standaloneFields.push({
        name,
        ownerProgram,
        like: likeMatch ? normalizeName(likeMatch[1]) : null,
        detail: normalizeWhitespace(detail).slice(0, 80),
        sourceForm: 'FREE_FORM',
        evidence: [{ file: filePath, line: i + 1, text: trimmed }],
      });
      continue;
    }

    // Free form DCL-C constant
    const dclCMatch = trimmed.match(/^dcl-c\s+([A-Z0-9_#$@]+)\b(.*)$/i);
    if (dclCMatch) {
      constants.push({
        name: normalizeName(dclCMatch[1]),
        ownerProgram,
        value: normalizeWhitespace((dclCMatch[2] || '').slice(0, 60)),
        sourceForm: 'FREE_FORM',
        evidence: [{ file: filePath, line: i + 1, text: trimmed }],
      });
      continue;
    }

    // Fixed form D spec rough support (very common in legacy)
    // D NAME     DS or D NAME            S or D NAME     C
    const fixedD = rawLine.match(/^\s*D\s+([A-Z0-9_#$@]+)\s+([A-Z ]{2,})\s*(.*)$/i);
    if (fixedD) {
      const name = normalizeName(fixedD[1]);
      const spec = (fixedD[2] || '').trim().toUpperCase();
      const rest = fixedD[3] || '';
      if (spec.includes('DS') || /DS\b/.test(spec)) {
        const like = rest.match(/LIKEDS\s*\(\s*([A-Z0-9_.]+)\s*\)/i);
        dataStructures.push({
          name,
          ownerProgram,
          qualified: /QUALIFIED/i.test(rest),
          like: like ? normalizeName(like[1]) : null,
          dim: null,
          external: null,
          subfieldCount: 0,
          subfields: [],
          sourceForm: 'FIXED_FORM',
          startLine: i + 1,
          endLine: i + 1,
          evidence: [{ file: filePath, line: i + 1, text: trimmed }],
        });
      } else if (spec.includes(' S') || spec === 'S' || /\bS\b/.test(spec)) {
        const like = rest.match(/LIKE\s*\(\s*([A-Z0-9_.]+)\s*\)/i);
        standaloneFields.push({
          name,
          ownerProgram,
          like: like ? normalizeName(like[1]) : null,
          detail: normalizeWhitespace(rest).slice(0, 60),
          sourceForm: 'FIXED_FORM',
          evidence: [{ file: filePath, line: i + 1, text: trimmed }],
        });
      } else if (spec.includes(' C') || spec === 'C') {
        constants.push({
          name,
          ownerProgram,
          value: normalizeWhitespace(rest).slice(0, 40),
          sourceForm: 'FIXED_FORM',
          evidence: [{ file: filePath, line: i + 1, text: trimmed }],
        });
      }
    }
  }

  if (currentDS) finalizeDS(lines.length);

  return {
    dataStructures: dataStructures.sort((a, b) => a.name.localeCompare(b.name)),
    standaloneFields: standaloneFields.sort((a, b) => a.name.localeCompare(b.name)),
    constants: constants.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function collectNativeFileDeclarations(filePath, lines) {
  const ownerProgram = toRelativeProgramName(filePath);
  const nativeFilesMap = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    if (isCommentLine(rawLine)) {
      continue;
    }

    const trimmed = rawLine.trim();
    const dclFMatch = rawLine.match(/^\s*dcl-f\s+([A-Z0-9_#$@]+)\b(.*)$/i);
    if (dclFMatch) {
      const declaration = createNativeFileDeclaration({
        filePath,
        ownerProgram,
        name: dclFMatch[1],
        kind: inferNativeFileKind(dclFMatch[2] || ''),
        lineNo,
        declaredAccess: parseDeclaredAccess(dclFMatch[2] || ''),
        keyed: /\bKEYED\b/i.test(dclFMatch[2] || ''),
        text: trimmed,
      });
      addStructuredItem(nativeFilesMap, declaration.name, declaration);
      continue;
    }

    const fixedFSpecMatch = rawLine.match(/^\s*F[A-Z0-9_#$@]/i);
    if (!fixedFSpecMatch) {
      continue;
    }

    const trimmedUpper = trimmed.toUpperCase();
    if (trimmedUpper.startsWith('FROM ')) {
      continue;
    }

    const tokenMatch = rawLine.match(/^\s*F([A-Z0-9_#$@]+)/i);
    const fIndex = rawLine.search(/F/i);
    const fixedColName = fIndex >= 0 ? rawLine.slice(fIndex + 1, fIndex + 11).replace(/\s+/g, '') : '';
    const tableName = ((tokenMatch ? tokenMatch[1] : '') || fixedColName).trim();
    if (!tableName) {
      continue;
    }

    const declaration = createNativeFileDeclaration({
      filePath,
      ownerProgram,
      name: tableName,
      kind: inferNativeFileKind(rawLine),
      lineNo,
      declaredAccess: parseFixedDeclaredAccess(rawLine),
      keyed: /\bK\b/i.test(rawLine),
      text: trimmed,
    });
    addStructuredItem(nativeFilesMap, declaration.name, declaration);
  }

  return Array.from(nativeFilesMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function findCurrentOwner(lineNo, ownerProgram, procedures) {
  const active = (procedures || []).find((procedure) => lineNo >= procedure.startLine && lineNo <= procedure.endLine);
  if (active) {
    return {
      ownerProgram,
      ownerName: active.name,
      ownerKind: active.kind,
    };
  }
  return {
    ownerProgram,
    ownerName: ownerProgram,
    ownerKind: 'PROGRAM',
  };
}

function classifyProcedureCall(targetName, localProcedures, prototypes, forceInternalSubroutine = false) {
  const normalized = normalizeName(targetName);
  if (!normalized) {
    return {
      resolution: 'DYNAMIC',
      targetKind: 'DYNAMIC',
      targetProgram: null,
      name: '<DYNAMIC>',
    };
  }

  if (forceInternalSubroutine) {
    const subroutine = (localProcedures || []).find((entry) => entry.kind === 'SUBROUTINE' && entry.name === normalized);
    if (subroutine) {
      return {
        resolution: 'INTERNAL',
        targetKind: 'SUBROUTINE',
        targetProgram: subroutine.ownerProgram,
        name: normalized,
      };
    }
    return {
      resolution: 'UNRESOLVED',
      targetKind: 'UNRESOLVED',
      targetProgram: null,
      name: normalized,
    };
  }

  const localProcedure = (localProcedures || []).find((entry) => entry.name === normalized);
  if (localProcedure) {
    return {
      resolution: 'INTERNAL',
      targetKind: localProcedure.kind,
      targetProgram: localProcedure.ownerProgram,
      name: normalized,
    };
  }

  const prototype = (prototypes || []).find((entry) => entry.name === normalized);
  if (prototype) {
    return {
      resolution: 'EXTERNAL',
      targetKind: 'PROTOTYPE',
      targetProgram: prototype.ownerProgram,
      name: normalized,
    };
  }

  return {
    resolution: 'UNRESOLVED',
    targetKind: 'UNRESOLVED',
    targetProgram: null,
    name: normalized,
  };
}

function looksLikeStandaloneSql(text) {
  const normalized = normalizeWhitespace(text).toUpperCase();
  if (/^SELECT\b.*\bFROM\b/.test(normalized)) return true;
  if (/^INSERT\b.*\bINTO\b/.test(normalized)) return true;
  if (/^UPDATE\b.*\bSET\b/.test(normalized)) return true;
  if (/^DELETE\b\s+FROM\b/.test(normalized)) return true;
  if (/^MERGE\b\s+INTO\b/.test(normalized)) return true;
  if (/^WITH\b/.test(normalized)) return true;
  return false;
}

function mapNativeOpcode(opcode) {
  const normalized = normalizeName(opcode);
  if (['CHAIN', 'READ', 'READE', 'READP', 'READPE'].includes(normalized)) {
    return {
      accessKind: 'READ',
      keyed: ['CHAIN', 'READE', 'READPE'].includes(normalized),
      interactive: false,
      mutating: false,
    };
  }
  if (['SETLL', 'SETGT'].includes(normalized)) {
    return {
      accessKind: 'POSITION',
      keyed: true,
      interactive: false,
      mutating: false,
    };
  }
  if (normalized === 'WRITE') {
    return {
      accessKind: 'WRITE',
      keyed: false,
      interactive: false,
      mutating: true,
    };
  }
  if (normalized === 'UPDATE') {
    return {
      accessKind: 'UPDATE',
      keyed: false,
      interactive: false,
      mutating: true,
    };
  }
  if (normalized === 'DELETE') {
    return {
      accessKind: 'DELETE',
      keyed: false,
      interactive: false,
      mutating: true,
    };
  }
  if (normalized === 'EXFMT') {
    return {
      accessKind: 'DISPLAY',
      keyed: false,
      interactive: true,
      mutating: false,
    };
  }
  return null;
}

function extractTargetToken(text) {
  const matches = String(text || '').match(/[A-Z0-9_#$@*]+/gi);
  if (!matches || matches.length === 0) return '';
  return matches[matches.length - 1];
}

function parseFreeFormNativeIo(trimmed) {
  if (!trimmed || looksLikeStandaloneSql(trimmed)) {
    return null;
  }

  const opcodeMatch = trimmed.match(/^(CHAIN|SETLL|SETGT|READPE|READP|READE|READ|WRITE|UPDATE|DELETE|EXFMT)\b(?:\s*\([^)]*\))?\s+(.+)$/i);
  if (!opcodeMatch) {
    return null;
  }

  const opcode = normalizeName(opcodeMatch[1]);
  if (!NATIVE_IO_OPCODES.has(opcode)) {
    return null;
  }

  const target = extractTargetToken(opcodeMatch[2].replace(/[;)]\s*$/, ''));
  if (!target) {
    return null;
  }

  return {
    opcode,
    target: normalizeName(target),
  };
}

function parseFixedFormNativeIo(rawLine) {
  const match = rawLine.match(/^\s*C\b.*?\b(CHAIN|SETLL|SETGT|READPE|READP|READE|READ|WRITE|UPDATE|DELETE|EXFMT)\b\s+([A-Z0-9_#$@*]+)/i);
  if (!match) {
    return null;
  }

  const opcode = normalizeName(match[1]);
  if (!NATIVE_IO_OPCODES.has(opcode)) {
    return null;
  }

  return {
    opcode,
    target: normalizeName(match[2]),
  };
}

function resolveNativeFileTarget(targetName, opcode, nativeFiles) {
  const normalizedTarget = normalizeName(targetName);
  if (!normalizedTarget) {
    return null;
  }

  const direct = (nativeFiles || []).find((entry) => entry.name === normalizedTarget);
  if (direct) {
    return {
      fileName: direct.name,
      fileKind: direct.kind || 'FILE',
      keyed: Boolean(direct.keyed),
      recordFormat: null,
    };
  }

  if (normalizeName(opcode) === 'EXFMT') {
    const workstationFiles = (nativeFiles || []).filter((entry) => entry.kind === 'WORKSTN');
    if (workstationFiles.length === 1) {
      return {
        fileName: workstationFiles[0].name,
        fileKind: workstationFiles[0].kind,
        keyed: Boolean(workstationFiles[0].keyed),
        recordFormat: normalizedTarget,
      };
    }
  }

  if (normalizeName(opcode) === 'WRITE') {
    const printerFiles = (nativeFiles || []).filter((entry) => entry.kind === 'PRINTER');
    if (printerFiles.length === 1) {
      return {
        fileName: printerFiles[0].name,
        fileKind: printerFiles[0].kind,
        keyed: Boolean(printerFiles[0].keyed),
        recordFormat: normalizedTarget,
      };
    }

    const workstationFiles = (nativeFiles || []).filter((entry) => entry.kind === 'WORKSTN');
    if (workstationFiles.length === 1) {
      return {
        fileName: workstationFiles[0].name,
        fileKind: workstationFiles[0].kind,
        keyed: Boolean(workstationFiles[0].keyed),
        recordFormat: normalizedTarget,
      };
    }
  }

  return null;
}

function scanContent(filePath, content) {
  const lines = content.split(/\r?\n/);
  if (isBinderSourceFile(filePath, lines)) {
    const binderSemantics = collectBinderSourceSemantics(filePath, lines);
    return {
      sourceFile: {
        path: filePath,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        lines: lines.length,
      },
      tables: [],
      calls: [],
      copyMembers: [],
      sqlStatements: [],
      procedures: [],
      prototypes: [],
      procedureCalls: [],
      nativeFiles: [],
      nativeFileAccesses: [],
      bifUsages: [],
      indicatorUsages: [],
      dataStructures: [],
      standaloneFields: [],
      constants: [],
      modules: binderSemantics.modules,
      bindingDirectories: binderSemantics.bindingDirectories,
      servicePrograms: binderSemantics.servicePrograms,
      diagnostics: binderSemantics.diagnostics,
      notes: [],
    };
  }

  const tablesMap = new Map();
  const callsMap = new Map();
  const copyMembersMap = new Map();
  const procedureCallsMap = new Map();
  const nativeFileAccessesMap = new Map();
  const sqlStatements = [];

  const { ownerProgram, procedures, prototypes } = collectDefinitions(filePath, lines);
  const nativeFiles = collectNativeFileDeclarations(filePath, lines);
  const bindingSemantics = collectModuleBindingSemantics(filePath, lines, ownerProgram, prototypes);
  const bifUsages = collectBifUsages(filePath, lines);
  const indicatorUsages = collectIndicatorUsages(filePath, lines);
  const dataDeclarations = collectDataDeclarations(filePath, lines);

  let inExecSql = false;
  let execStartLine = 0;
  let execBuffer = [];

  const finalizeExecSql = (endLine) => {
    if (execBuffer.length === 0) return;

    const statement = createSqlStatement({
      filePath,
      startLine: execStartLine,
      endLine,
      sqlText: execBuffer.join(' '),
    });
    sqlStatements.push(statement);

    for (const tableName of statement.tables) {
      addEntity(tablesMap, tableName, {
        kind: statement.dynamic ? 'SQL_DYNAMIC' : 'SQL',
        evidence: { file: filePath, line: execStartLine, text: statement.text },
      });
    }

    execBuffer = [];
    inExecSql = false;
    execStartLine = 0;
  };

  const addProcedureCallEntry = (call) => {
    addStructuredItem(
      procedureCallsMap,
      [
        call.ownerProgram,
        call.ownerFile,
        call.ownerName,
        call.ownerKind,
        call.name,
        call.resolution,
        call.targetKind,
        call.targetProgram || '',
        (call.evidence && call.evidence[0] && (call.evidence[0].line || call.evidence[0].startLine)) || 0,
      ].join('|'),
      call,
    );
  };

  const addNativeFileAccessEntry = (access) => {
    addStructuredItem(
      nativeFileAccessesMap,
      [
        access.fileName,
        access.ownerProgram,
        access.ownerFile,
        access.ownerName,
        access.ownerKind,
        access.opcode,
        access.accessKind,
        access.recordFormat || '',
        (access.evidence && access.evidence[0] && access.evidence[0].line) || 0,
      ].join('|'),
      access,
    );
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const lineNo = i + 1;

    if (isCommentLine(rawLine)) {
      continue;
    }

    const trimmed = rawLine.trim();
    const owner = findCurrentOwner(lineNo, ownerProgram, procedures);

    const dclFMatch = rawLine.match(/^\s*dcl-f\s+([A-Z0-9_#$@]+)/i);
    if (dclFMatch) {
      const upperLine = rawLine.toUpperCase();
      let kind = 'FILE';
      if (upperLine.includes('WORKSTN')) kind = 'WORKSTN';
      if (upperLine.includes('PRINTER')) kind = 'PRINTER';
      if (upperLine.includes('DISK')) kind = 'DISK';
      addEntity(tablesMap, dclFMatch[1], {
        kind,
        evidence: { file: filePath, line: lineNo, text: trimmed },
      });
    }

    const fixedFSpecMatch = rawLine.match(/^\s*F[A-Z0-9_#$@]/i);
    if (fixedFSpecMatch) {
      const trimmedUpper = trimmed.toUpperCase();
      if (!trimmedUpper.startsWith('FROM ')) {
        const tokenMatch = rawLine.match(/^\s*F([A-Z0-9_#$@]+)/i);
        const fIndex = rawLine.search(/F/i);
        const fixedColName = fIndex >= 0 ? rawLine.slice(fIndex + 1, fIndex + 11).replace(/\s+/g, '') : '';
        const tableName = ((tokenMatch ? tokenMatch[1] : '') || fixedColName).trim();
        if (tableName) {
          const upperLine = rawLine.toUpperCase();
          let kind = 'FILE';
          if (upperLine.includes('WORKSTN')) kind = 'WORKSTN';
          if (upperLine.includes('PRINTER')) kind = 'PRINTER';
          if (upperLine.includes('DISK')) kind = 'DISK';
          addEntity(tablesMap, tableName, {
            kind,
            evidence: { file: filePath, line: lineNo, text: trimmed },
          });
        }
      }
    }

    const copyMatch = rawLine.match(/^\s*\/(?:COPY|INCLUDE)\s+(.+)$/i) || rawLine.match(/^\s*COPY\s+(.+)$/i);
    if (copyMatch) {
      const copyName = normalizeName(copyMatch[1].replace(/["']/g, '').trim());
      if (copyName) {
        addEntity(copyMembersMap, copyName, {
          evidence: { file: filePath, line: lineNo, text: trimmed },
        });
      }
    }

    const nativeIoMatch = parseFreeFormNativeIo(trimmed) || parseFixedFormNativeIo(rawLine);
    if (nativeIoMatch) {
      const resolvedTarget = resolveNativeFileTarget(nativeIoMatch.target, nativeIoMatch.opcode, nativeFiles);
      const opcodeAttributes = mapNativeOpcode(nativeIoMatch.opcode);
      if (resolvedTarget && opcodeAttributes) {
        addNativeFileAccessEntry(createNativeFileAccess({
          filePath,
          ownerProgram: owner.ownerProgram,
          ownerName: owner.ownerName,
          ownerKind: owner.ownerKind,
          lineNo,
          text: trimmed,
          fileName: resolvedTarget.fileName,
          fileKind: resolvedTarget.fileKind,
          opcode: nativeIoMatch.opcode,
          accessKind: opcodeAttributes.accessKind,
          recordFormat: resolvedTarget.recordFormat,
          keyed: opcodeAttributes.keyed || resolvedTarget.keyed,
          interactive: opcodeAttributes.interactive || resolvedTarget.fileKind === 'WORKSTN',
          mutating: opcodeAttributes.mutating,
        }));
      }
    }

    const programCallPatterns = [
      /\bCALL\s+PGM\s*\(\s*['"]?([A-Z0-9_#$@./]+)['"]?\s*\)/i,
      /\bCALL\s+['"]([A-Z0-9_#$@]+)['"]/i,
      /\bCALL\s+(?!PGM\b)([A-Z0-9_#$@]+)\b/i,
    ];

    for (const regex of programCallPatterns) {
      const match = rawLine.match(regex);
      if (match) {
        addEntity(callsMap, match[1], {
          kind: 'PROGRAM',
          evidence: { file: filePath, line: lineNo, text: trimmed },
        });
      }
    }

    const staticProcedureCallPatterns = [
      /\bCALLP\s*\(\s*['"]([A-Z0-9_#$@]+)['"]\s*\)/i,
      /\bCALLP\s+([A-Z0-9_#$@]+)\b/i,
      /\bCALLPRC\s*\(\s*['"]([A-Z0-9_#$@]+)['"]\s*\)/i,
      /\bCALLPRC\s*\(\s*([A-Z0-9_#$@]+)\s*\)/i,
      /\bCALLB\s+['"]?([A-Z0-9_#$@]+)['"]?/i,
    ];

    for (const regex of staticProcedureCallPatterns) {
      const match = rawLine.match(regex);
      if (match) {
        const classification = classifyProcedureCall(match[1], procedures, prototypes);
        addProcedureCallEntry(createProcedureCall({
          filePath,
          ownerProgram: owner.ownerProgram,
          ownerName: owner.ownerName,
          ownerKind: owner.ownerKind,
          lineNo,
          text: trimmed,
          name: classification.name,
          resolution: classification.resolution,
          targetKind: classification.targetKind,
          targetProgram: classification.targetProgram,
        }));
      }
    }

    const exsrMatch = trimmed.match(/^exsr\s+([A-Z0-9_#$@*]+)\b/i) || rawLine.match(/\bEXSR\s+([A-Z0-9_#$@*]+)\b/i);
    if (exsrMatch) {
      const classification = classifyProcedureCall(exsrMatch[1], procedures, prototypes, true);
      addProcedureCallEntry(createProcedureCall({
        filePath,
        ownerProgram: owner.ownerProgram,
        ownerName: owner.ownerName,
        ownerKind: owner.ownerKind,
        lineNo,
        text: trimmed,
        name: classification.name,
        resolution: classification.resolution,
        targetKind: classification.targetKind,
        targetProgram: classification.targetProgram,
      }));
    }

    const dynamicProcedurePatterns = [
      /\bCALLP\s*\((?!\s*['"][A-Z0-9_#$@]+['"]\s*\))/i,
      /\bCALLPRC\s*\((?!\s*['"][A-Z0-9_#$@]+['"]\s*\))(?!\s*[A-Z0-9_#$@]+\s*\))/i,
    ];
    if (dynamicProcedurePatterns.some((regex) => regex.test(rawLine))) {
      addProcedureCallEntry(createProcedureCall({
        filePath,
        ownerProgram: owner.ownerProgram,
        ownerName: owner.ownerName,
        ownerKind: owner.ownerKind,
        lineNo,
        text: trimmed,
        name: '<DYNAMIC>',
        resolution: 'DYNAMIC',
        targetKind: 'DYNAMIC',
      }));
    }

    const execSqlMatch = rawLine.match(/\bEXEC\s+SQL\b/i);
    if (execSqlMatch) {
      if (inExecSql) {
        finalizeExecSql(lineNo - 1);
      }

      inExecSql = true;
      execStartLine = lineNo;
      const sqlPart = rawLine.slice(execSqlMatch.index);
      execBuffer.push(sqlPart.trim());
      if (rawLine.includes(';')) {
        finalizeExecSql(lineNo);
      }
      continue;
    }

    if (inExecSql) {
      execBuffer.push(trimmed);
      if (rawLine.includes(';')) {
        finalizeExecSql(lineNo);
      }
      continue;
    }

    if (looksLikeStandaloneSql(rawLine)) {
      const statement = createSqlStatement({
        filePath,
        startLine: lineNo,
        endLine: lineNo,
        sqlText: trimmed,
      });
      sqlStatements.push(statement);

      for (const tableName of statement.tables) {
        addEntity(tablesMap, tableName, {
          kind: statement.dynamic ? 'SQL_DYNAMIC' : 'SQL',
          evidence: { file: filePath, line: lineNo, text: statement.text },
        });
      }
    }
  }

  if (inExecSql) {
    finalizeExecSql(lines.length);
  }

  // Run embedded SQL validation (cursor/fetch mismatches, host var issues, dynamic markers)
  let sqlValidation = { validationErrors: [], validationWarnings: [] };
  try {
    sqlValidation = validateEmbeddedSql(sqlStatements);
  } catch (e) {
    // Fail closed for validation - do not break scan
  }

  // Attach validation results to individual statements where possible
  const errorMap = new Map();
  for (const err of sqlValidation.validationErrors || []) {
    const key = err.cursor || '';
    if (!errorMap.has(key)) errorMap.set(key, []);
    errorMap.get(key).push(err);
  }

  for (const stmt of sqlStatements) {
    const cursors = (stmt.cursors || []).map(c => c.name);
    const errs = [];
    for (const name of cursors) {
      if (errorMap.has(name)) errs.push(...errorMap.get(name));
    }
    if (errs.length) {
      stmt.validationErrors = errs;
    }
    // Mark dynamic more explicitly if validator confirms
  }

  return {
    sourceFile: {
      path: filePath,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      lines: lines.length,
    },
    tables: Array.from(tablesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    calls: Array.from(callsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    copyMembers: Array.from(copyMembersMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    sqlStatements,
    procedures,
    prototypes,
    procedureCalls: Array.from(procedureCallsMap.values()).sort((a, b) => {
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.ownerName !== b.ownerName) return a.ownerName.localeCompare(b.ownerName);
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.resolution.localeCompare(b.resolution);
    }),
    nativeFiles,
    nativeFileAccesses: Array.from(nativeFileAccessesMap.values()).sort((a, b) => {
      if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.ownerName !== b.ownerName) return a.ownerName.localeCompare(b.ownerName);
      if (a.opcode !== b.opcode) return a.opcode.localeCompare(b.opcode);
      return ((a.evidence && a.evidence[0] && a.evidence[0].line) || 0) - ((b.evidence && b.evidence[0] && b.evidence[0].line) || 0);
    }),
    bifUsages,
    indicatorUsages,
    dataStructures: dataDeclarations.dataStructures,
    standaloneFields: dataDeclarations.standaloneFields,
    constants: dataDeclarations.constants,
    modules: bindingSemantics.modules,
    bindingDirectories: bindingSemantics.bindingDirectories,
    servicePrograms: bindingSemantics.servicePrograms,
    diagnostics: bindingSemantics.diagnostics,
    notes: [],
    sqlValidation,
  };
}

function scanRpgFile(filePath, options = {}) {
  const content = options.content !== undefined ? String(options.content) : fs.readFileSync(filePath, 'utf8');
  const result = scanContent(filePath, content);
  result.sourceFile.sourceType = normalizeSourceType(options.sourceType || classifySourceFile(filePath));
  return result;
}

function scanStructuredSourceFile(filePath, options = {}) {
  const sourceType = normalizeSourceType(options.sourceType || classifySourceFile(filePath));
  const family = sourceTypeFamily(sourceType);

  if (family === 'CL') {
    return scanClFile(filePath, {
      content: options.content,
      sourceType,
    });
  }

  if (family === 'DDS') {
    return scanDdsFile(filePath, {
      content: options.content,
      sourceType,
    });
  }

  return scanRpgFile(filePath, {
    content: options.content,
    sourceType,
  });
}

function mergeEntities(targetMap, entities, withKind) {
  for (const entity of entities || []) {
    const key = normalizeName(entity.name);
    if (!key) continue;
    if (!targetMap.has(key)) {
      const base = {
        name: key,
        evidence: [],
      };
      if (withKind) {
        base.kind = entity.kind || withKind;
      }
      targetMap.set(key, base);
    }

    const target = targetMap.get(key);
    if (withKind && !target.kind && entity.kind) {
      target.kind = entity.kind;
    }

    for (const evidence of entity.evidence || []) {
      const evidenceKey = JSON.stringify(evidence);
      const exists = target.evidence.some((item) => JSON.stringify(item) === evidenceKey);
      if (!exists) {
        target.evidence.push(evidence);
      }
    }
  }
}

function mergeStructuredItems(scanResults, key, identityBuilder, merger) {
  const map = new Map();
  for (const result of scanResults || []) {
    for (const item of result[key] || []) {
      const identity = identityBuilder(item);
      if (!identity) continue;
      if (!map.has(identity)) {
        map.set(identity, {
          ...item,
          evidence: [],
        });
      }
      const target = map.get(identity);
      if (typeof merger === 'function') {
        merger(target, item);
      }
      for (const evidence of item.evidence || []) {
        const evidenceKey = JSON.stringify(evidence);
        const exists = target.evidence.some((entry) => JSON.stringify(entry) === evidenceKey);
        if (!exists) {
          target.evidence.push(evidence);
        }
      }
    }
  }
  return Array.from(map.values());
}

function mergeSqlStatements(scanResults) {
  const map = new Map();
  for (const result of scanResults || []) {
    for (const sql of result.sqlStatements || []) {
      const key = `${sql.type}|${sql.text.toUpperCase()}`;
      if (!map.has(key)) {
        map.set(key, {
          type: sql.type,
          intent: sql.intent || 'OTHER',
          text: sql.text,
          tables: Array.from(new Set(sql.tables || [])).sort(),
          hostVariables: Array.from(new Set(sql.hostVariables || [])).sort(),
          cursors: Array.from(new Set((sql.cursors || []).map((entry) => `${entry.name}:${entry.action}`)))
            .map((value) => {
              const [name, action] = value.split(':');
              return { name, action };
            })
            .sort((a, b) => {
              if (a.name !== b.name) return a.name.localeCompare(b.name);
              return a.action.localeCompare(b.action);
            }),
          readsData: Boolean(sql.readsData),
          writesData: Boolean(sql.writesData),
          dynamic: Boolean(sql.dynamic),
          unresolved: Boolean(sql.unresolved),
          driverTable: sql.driverTable || null,
          joins: Array.isArray(sql.joins) ? sql.joins.map((entry) => ({ ...entry })) : [],
          filters: Array.isArray(sql.filters) ? sql.filters.map((entry) => ({ ...entry })) : [],
          confidence: sql.confidence || null,
          uncertainty: Array.from(new Set(sql.uncertainty || [])).sort(),
          evidence: [],
        });
      }

      const item = map.get(key);
      item.tables = Array.from(new Set([...(item.tables || []), ...(sql.tables || [])])).sort();
      item.hostVariables = Array.from(new Set([...(item.hostVariables || []), ...(sql.hostVariables || [])])).sort();
      item.readsData = item.readsData || Boolean(sql.readsData);
      item.writesData = item.writesData || Boolean(sql.writesData);
      item.dynamic = item.dynamic || Boolean(sql.dynamic);
      item.unresolved = item.unresolved || Boolean(sql.unresolved);
      item.driverTable = item.driverTable || sql.driverTable || null;
      const joinMap = new Map((item.joins || []).map((entry) => [JSON.stringify(entry), entry]));
      for (const join of sql.joins || []) {
        joinMap.set(JSON.stringify(join), { ...join });
      }
      item.joins = Array.from(joinMap.values());
      const filterMap = new Map((item.filters || []).map((entry) => [JSON.stringify(entry), entry]));
      for (const filter of sql.filters || []) {
        filterMap.set(JSON.stringify(filter), { ...filter });
      }
      item.filters = Array.from(filterMap.values());
      const confidenceRank = {
        HIGH: 3,
        MEDIUM: 2,
        LOW: 1,
      };
      const currentConfidence = normalizeName(item.confidence);
      const nextConfidence = normalizeName(sql.confidence);
      if ((confidenceRank[nextConfidence] || 0) > (confidenceRank[currentConfidence] || 0)) {
        item.confidence = sql.confidence || null;
      }
      item.uncertainty = Array.from(new Set([...(item.uncertainty || []), ...(sql.uncertainty || [])])).sort();
      const cursorSet = new Set((item.cursors || []).map((entry) => `${entry.name}:${entry.action}`));
      for (const cursor of sql.cursors || []) {
        cursorSet.add(`${cursor.name}:${cursor.action}`);
      }
      item.cursors = Array.from(cursorSet)
        .map((value) => {
          const [name, action] = value.split(':');
          return { name, action };
        })
        .sort((a, b) => {
          if (a.name !== b.name) return a.name.localeCompare(b.name);
          return a.action.localeCompare(b.action);
        });

      for (const evidence of sql.evidence || []) {
        const evidenceKey = JSON.stringify(evidence);
        const exists = item.evidence.some((entry) => JSON.stringify(entry) === evidenceKey);
        if (!exists) {
          item.evidence.push(evidence);
        }
      }
    }
  }
  return Array.from(map.values());
}

function scanSourceFiles(filePaths, options = {}) {
  const scanResults = [];
  const notes = [];
  const scanCache = options && options.scanCache ? options.scanCache : null;

  for (const filePath of filePaths || []) {
    try {
      const sourceMetadata = options.sourceMetadataByPath instanceof Map
        ? (options.sourceMetadataByPath.get(path.resolve(String(filePath || ''))) || null)
        : null;
      const scanFn = (resolvedPath) => scanStructuredSourceFile(resolvedPath, {
        content: sourceMetadata && typeof sourceMetadata.normalizedText === 'string'
          ? sourceMetadata.normalizedText
          : undefined,
        sourceType: sourceMetadata && sourceMetadata.sourceType
          ? sourceMetadata.sourceType
          : undefined,
      });
      const result = scanCache && typeof scanCache.getOrScan === 'function'
        ? scanCache.getOrScan(filePath, scanFn)
        : scanFn(filePath);
      if (sourceMetadata) {
        result.sourceFile = {
          ...result.sourceFile,
          path: result.sourceFile && result.sourceFile.path ? result.sourceFile.path : sourceMetadata.path,
          sizeBytes: Number(sourceMetadata.sizeBytes) || result.sourceFile.sizeBytes || 0,
          lines: typeof sourceMetadata.normalizedText === 'string'
            ? sourceMetadata.normalizedText.split('\n').length
            : result.sourceFile.lines,
          sourceType: sourceMetadata.sourceType || result.sourceFile.sourceType || classifySourceFile(filePath),
          detectedEncoding: sourceMetadata.detectedEncoding || null,
          normalizationStatus: sourceMetadata.normalizationStatus || 'ok',
          newlineStyle: sourceMetadata.newlineStyle || 'UNKNOWN',
          normalizedNewlineStyle: sourceMetadata.normalizedNewlineStyle || 'UNKNOWN',
        };
      }
      scanResults.push(result);
    } catch (error) {
      notes.push(`Skipped file ${filePath}: ${error.message}`);
    }
  }

  const sourceFiles = [];
  for (const result of scanResults) {
    sourceFiles.push(result.sourceFile);
  }

  const tablesMap = new Map();
  const callsMap = new Map();
  const copyMembersMap = new Map();
  mergeEntities(tablesMap, scanResults.flatMap((item) => item.tables || []), 'FILE');
  mergeEntities(callsMap, scanResults.flatMap((item) => item.calls || []), 'PROGRAM');
  mergeEntities(copyMembersMap, scanResults.flatMap((item) => item.copyMembers || []));
  const procedures = mergeStructuredItems(
    scanResults,
    'procedures',
    (item) => [item.ownerProgram, item.sourceFile, item.kind, item.name, item.startLine, item.endLine].join('|'),
  ).sort((a, b) => {
    if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
    if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    return a.name.localeCompare(b.name);
  });
  const prototypes = mergeStructuredItems(
    scanResults,
    'prototypes',
    (item) => [item.ownerProgram, item.sourceFile, item.kind, item.name, item.startLine, item.endLine].join('|'),
  ).sort((a, b) => {
    if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
    if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    return a.name.localeCompare(b.name);
  });
  const modules = mergeStructuredItems(
    scanResults,
    'modules',
    (item) => [item.ownerProgram, item.sourceFile, item.kind, item.name].join('|'),
    (target, item) => {
      target.kind = target.kind || item.kind;
      target.bindingDirectories = uniqueSortedStrings([...(target.bindingDirectories || []), ...(item.bindingDirectories || [])]);
      target.servicePrograms = uniqueSortedStrings([...(target.servicePrograms || []), ...(item.servicePrograms || [])]);
      target.importedProcedures = uniqueSortedStrings([...(target.importedProcedures || []), ...(item.importedProcedures || [])]);
    },
  ).sort((a, b) => {
    if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
    if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
    return a.name.localeCompare(b.name);
  });
  const bindingDirectories = mergeStructuredItems(
    scanResults,
    'bindingDirectories',
    (item) => item.name,
  ).sort((a, b) => a.name.localeCompare(b.name));
  const servicePrograms = mergeStructuredItems(
    scanResults,
    'servicePrograms',
    (item) => item.name,
    (target, item) => {
      target.sourceKind = target.sourceKind === 'BINDER_SOURCE' ? target.sourceKind : (item.sourceKind || target.sourceKind || 'HINT');
      target.sourceFile = target.sourceFile || item.sourceFile || null;
      const exportSet = new Set((target.exports || []).map((entry) => `${entry.symbol}:${entry.signatureLevel || 'CURRENT'}`));
      for (const entry of item.exports || []) {
        exportSet.add(`${normalizeName(entry.symbol)}:${normalizeName(entry.signatureLevel || 'CURRENT') || 'CURRENT'}`);
      }
      target.exports = Array.from(exportSet)
        .map((value) => {
          const [symbol, signatureLevel] = value.split(':');
          return { symbol, signatureLevel };
        })
        .sort((a, b) => {
          if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
          return a.signatureLevel.localeCompare(b.signatureLevel);
        });
    },
  ).sort((a, b) => a.name.localeCompare(b.name));
  const diagnostics = mergeStructuredItems(
    scanResults,
    'diagnostics',
    (item) => [item.code, item.details && item.details.file, item.details && item.details.ownerProgram, item.details && item.details.symbol, item.details && item.details.serviceProgram].join('|'),
  ).sort((a, b) => {
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    return String(a.message || '').localeCompare(String(b.message || ''));
  });

  const exportedProcedures = new Set((procedures || []).filter((entry) => entry.exported).map((entry) => entry.name));
  for (const serviceProgram of servicePrograms) {
    for (const exportedSymbol of serviceProgram.exports || []) {
      if (!exportedProcedures.has(exportedSymbol.symbol)) {
        diagnostics.push(createBindingDiagnostic({
          code: 'UNRESOLVED_BINDER_EXPORT',
          message: `Binder export symbol ${exportedSymbol.symbol} could not be matched to a local exported procedure.`,
          filePath: serviceProgram.sourceFile,
          symbol: exportedSymbol.symbol,
          serviceProgram: serviceProgram.name,
        }));
      }
    }
  }
  diagnostics.sort((a, b) => {
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    return String(a.message || '').localeCompare(String(b.message || ''));
  });
  for (const diagnostic of diagnostics) {
    notes.push(diagnostic.message);
  }

  const commands = mergeStructuredItems(
    scanResults,
    'commands',
    (item) => [
      item.command || item.name,
      item.text || '',
      item.evidence && item.evidence[0] && item.evidence[0].file,
      item.evidence && item.evidence[0] && item.evidence[0].line,
    ].join('|'),
  ).sort((a, b) => {
    if (String(a.command || a.name) !== String(b.command || b.name)) {
      return String(a.command || a.name).localeCompare(String(b.command || b.name));
    }
    return String(a.text || '').localeCompare(String(b.text || ''));
  });
  const objectUsages = mergeStructuredItems(
    scanResults,
    'objectUsages',
    (item) => [
      item.objectType,
      item.name,
      item.command,
      item.evidence && item.evidence[0] && item.evidence[0].file,
      item.evidence && item.evidence[0] && item.evidence[0].line,
    ].join('|'),
  ).sort((a, b) => {
    if (String(a.objectType || '') !== String(b.objectType || '')) return String(a.objectType || '').localeCompare(String(b.objectType || ''));
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  const ddsFiles = mergeStructuredItems(
    scanResults,
    'ddsFiles',
    (item) => item.name,
    (target, item) => {
      target.kind = target.kind || item.kind || 'DISK';
      target.sourceType = target.sourceType || item.sourceType || 'DDS';
      target.recordFormats = uniqueSortedStrings([...(target.recordFormats || []), ...(item.recordFormats || [])]);
      target.referencedFiles = uniqueSortedStrings([...(target.referencedFiles || []), ...(item.referencedFiles || [])]);
    },
  ).sort((a, b) => a.name.localeCompare(b.name));
  const sourceTypeSummary = summarizeSourceTypes(sourceFiles);

  return {
    sourceFiles,
    tables: Array.from(tablesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    calls: Array.from(callsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    copyMembers: Array.from(copyMembersMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    sqlStatements: mergeSqlStatements(scanResults),
    procedures,
    prototypes,
    procedureCalls: mergeStructuredItems(
      scanResults,
      'procedureCalls',
      (item) => [
        item.ownerProgram,
        item.ownerFile,
        item.ownerName,
        item.ownerKind,
        item.name,
        item.resolution,
        item.targetKind,
        item.targetProgram || '',
        (item.evidence && item.evidence[0] && (item.evidence[0].line || item.evidence[0].startLine)) || 0,
      ].join('|'),
    ).sort((a, b) => {
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.ownerName !== b.ownerName) return a.ownerName.localeCompare(b.ownerName);
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.resolution.localeCompare(b.resolution);
    }),
    nativeFiles: mergeStructuredItems(
      scanResults,
      'nativeFiles',
      (item) => item.name,
      (target, item) => {
        target.kind = target.kind === 'FILE' && item.kind ? item.kind : (target.kind || item.kind || 'FILE');
        target.keyed = Boolean(target.keyed || item.keyed);
        target.declaredAccess = uniqueSortedStrings([...(target.declaredAccess || []), ...(item.declaredAccess || [])]);
      },
    ).sort((a, b) => a.name.localeCompare(b.name)),
    nativeFileAccesses: mergeStructuredItems(
      scanResults,
      'nativeFileAccesses',
      (item) => [
        item.fileName,
        item.ownerProgram,
        item.ownerFile,
        item.ownerName,
        item.ownerKind,
        item.opcode,
        item.accessKind,
        item.recordFormat || '',
        (item.evidence && item.evidence[0] && item.evidence[0].line) || 0,
      ].join('|'),
    ).sort((a, b) => {
      if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.ownerName !== b.ownerName) return a.ownerName.localeCompare(b.ownerName);
      if (a.opcode !== b.opcode) return a.opcode.localeCompare(b.opcode);
      return ((a.evidence && a.evidence[0] && a.evidence[0].line) || 0) - ((b.evidence && b.evidence[0] && b.evidence[0].line) || 0);
    }),
    bifUsages: mergeStructuredItems(
      scanResults,
      'bifUsages',
      (item) => [item.ownerProgram, item.name, (item.evidence && item.evidence[0] && item.evidence[0].line) || 0].join('|'),
    ).sort((a, b) => a.name.localeCompare(b.name) || a.ownerProgram.localeCompare(b.ownerProgram)),
    indicatorUsages: mergeStructuredItems(
      scanResults,
      'indicatorUsages',
      (item) => [item.ownerProgram, item.name, item.kind, (item.evidence && item.evidence[0] && item.evidence[0].line) || 0].join('|'),
    ).sort((a, b) => a.name.localeCompare(b.name) || a.ownerProgram.localeCompare(b.ownerProgram)),
    dataStructures: mergeStructuredItems(
      scanResults,
      'dataStructures',
      (item) => [item.ownerProgram, item.name, item.startLine].join('|'),
    ).sort((a, b) => a.name.localeCompare(b.name)),
    standaloneFields: mergeStructuredItems(
      scanResults,
      'standaloneFields',
      (item) => [item.ownerProgram, item.name, (item.evidence && item.evidence[0] && item.evidence[0].line) || 0].join('|'),
    ).sort((a, b) => a.name.localeCompare(b.name)),
    constants: mergeStructuredItems(
      scanResults,
      'constants',
      (item) => [item.ownerProgram, item.name].join('|'),
    ).sort((a, b) => a.name.localeCompare(b.name)),
    modules,
    bindingDirectories,
    servicePrograms,
    diagnostics,
    notes,
    commands,
    objectUsages,
    ddsFiles,
    sourceTypeSummary,
    sourceTypeAnalysis: {
      summary: sourceTypeSummary,
      commands,
      objectUsages,
      ddsFiles,
    },
    sqlValidation: mergeValidationResults(scanResults),
  };
}

function mergeValidationResults(scanResults) {
  const allErrors = [];
  const allWarnings = [];
  for (const result of scanResults || []) {
    const v = result.sqlValidation || {};
    if (Array.isArray(v.validationErrors)) allErrors.push(...v.validationErrors);
    if (Array.isArray(v.validationWarnings)) allWarnings.push(...v.validationWarnings);
  }
  return {
    validationErrors: allErrors,
    validationWarnings: allWarnings,
  };
}

module.exports = {
  scanRpgFile,
  scanSourceFiles,
};
