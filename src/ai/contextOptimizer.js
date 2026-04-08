/*
Copyright 2026 Guido Zeuner

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
const { estimateTokensFromObject } = require('./tokenEstimator');

const DEFAULT_WORKFLOW_TOKEN_BUDGETS = {
  documentation: 2200,
  errorAnalysis: 1600,
};

const DEFAULT_OPTIONS = {
  maxTables: 20,
  maxProgramCalls: 20,
  maxCopyMembers: 10,
  maxSQLStatements: 10,
  maxSourceSnippets: 20,
  maxSnippetLines: 12,
  softTokenLimit: 3000,
  workflowTokenBudgets: DEFAULT_WORKFLOW_TOKEN_BUDGETS,
};

const WORKFLOW_KEYS = ['documentation', 'errorAnalysis'];

function normalizeName(value) {
  return String(value || '').trim().toUpperCase();
}

function asArray(value) {
  if (!Array.isArray(value)) return [];
  return value;
}

function uniqueStrings(values) {
  return Array.from(new Set(asArray(values).map((value) => String(value || '').trim()).filter(Boolean)));
}

function sortByName(values) {
  return [...asArray(values)].sort((a, b) => {
    const an = normalizeName(a && a.name ? a.name : a);
    const bn = normalizeName(b && b.name ? b.name : b);
    return an.localeCompare(bn);
  });
}

function dedupeByKey(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
}

function normalizeWorkflowBudgets(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const resolved = {};
  for (const key of WORKFLOW_KEYS) {
    const raw = input[key];
    resolved[key] = Number.isFinite(Number(raw))
      ? Math.max(1, Number(raw))
      : DEFAULT_WORKFLOW_TOKEN_BUDGETS[key];
  }
  return resolved;
}

function normalizeOptions(config) {
  const input = config && typeof config === 'object' ? config : {};
  return {
    maxTables: Number.isFinite(Number(input.maxTables)) ? Math.max(0, Number(input.maxTables)) : DEFAULT_OPTIONS.maxTables,
    maxProgramCalls: Number.isFinite(Number(input.maxProgramCalls)) ? Math.max(0, Number(input.maxProgramCalls)) : DEFAULT_OPTIONS.maxProgramCalls,
    maxCopyMembers: Number.isFinite(Number(input.maxCopyMembers)) ? Math.max(0, Number(input.maxCopyMembers)) : DEFAULT_OPTIONS.maxCopyMembers,
    maxSQLStatements: Number.isFinite(Number(input.maxSQLStatements)) ? Math.max(0, Number(input.maxSQLStatements)) : DEFAULT_OPTIONS.maxSQLStatements,
    maxSourceSnippets: Number.isFinite(Number(input.maxSourceSnippets)) ? Math.max(1, Number(input.maxSourceSnippets)) : DEFAULT_OPTIONS.maxSourceSnippets,
    maxSnippetLines: Number.isFinite(Number(input.maxSnippetLines)) ? Math.max(1, Number(input.maxSnippetLines)) : DEFAULT_OPTIONS.maxSnippetLines,
    softTokenLimit: Number.isFinite(Number(input.softTokenLimit)) ? Math.max(1, Number(input.softTokenLimit)) : DEFAULT_OPTIONS.softTokenLimit,
    workflowTokenBudgets: normalizeWorkflowBudgets(input.workflowTokenBudgets),
  };
}

function lineSlice(content, startLine, endLine) {
  const lines = String(content || '').split(/\r?\n/);
  const start = Math.max(1, Number(startLine) || 1);
  const end = Math.max(start, Number(endLine) || start);
  return lines.slice(start - 1, end).join('\n');
}

function loadSourceByRelativePath(context, relativePath) {
  const baseRoot = context && context.sourceRoot ? context.sourceRoot : process.cwd();
  const resolved = path.resolve(baseRoot, String(relativePath || ''));
  if (!fs.existsSync(resolved)) {
    return null;
  }
  return fs.readFileSync(resolved, 'utf8');
}

function toSnippet(context, evidence, maxSnippetLines) {
  if (!evidence || !evidence.file) return null;
  const content = loadSourceByRelativePath(context, evidence.file);
  if (content === null) return null;

  const startLine = Math.max(1, Number(evidence.startLine || evidence.line || 1));
  const evidenceEndLine = Math.max(startLine, Number(evidence.endLine || evidence.line || startLine));
  const endLine = Math.min(evidenceEndLine, startLine + maxSnippetLines - 1);
  const text = lineSlice(content, startLine, endLine).trim();
  if (!text) return null;

  return {
    file: evidence.file,
    startLine,
    endLine,
    text,
  };
}

function evidenceLocationKey(entry) {
  if (!entry) return '';
  return [
    String(entry.ref || ''),
    String(entry.file || ''),
    Number(entry.startLine || 0),
    Number(entry.endLine || 0),
    String(entry.snippet || '').trim(),
  ].join('|');
}

function sortCandidates(candidates) {
  return [...asArray(candidates)].sort((a, b) => {
    if (Number(a.workflowScore || a.score || 0) !== Number(b.workflowScore || b.score || 0)) {
      return Number(b.workflowScore || b.score || 0) - Number(a.workflowScore || a.score || 0);
    }
    const af = String(a.file || '');
    const bf = String(b.file || '');
    if (af !== bf) return af.localeCompare(bf);
    const aLine = Number(a.startLine || 0);
    const bLine = Number(b.startLine || 0);
    if (aLine !== bLine) return aLine - bLine;
    return String(a.label || '').localeCompare(String(b.label || ''));
  });
}

function shallowCloneItem(item) {
  return item && typeof item === 'object'
    ? JSON.parse(JSON.stringify(item))
    : item;
}

function mapByName(items) {
  return new Map(sortByName(items).map((entry) => [normalizeName(entry && entry.name), shallowCloneItem(entry)]));
}

function buildFallbackProjection(context) {
  const sqlStatements = asArray(context && context.sql && context.sql.statements)
    .map((statement, index) => ({
      id: `SQL_FALLBACK_${index + 1}`,
      type: normalizeName(statement.type || 'OTHER') || 'OTHER',
      intent: normalizeName(statement.intent || 'OTHER') || 'OTHER',
      text: String(statement.text || statement.snippet || '').trim(),
      tables: uniqueStrings(statement.tables),
      hostVariables: uniqueStrings(statement.hostVariables),
      dynamic: Boolean(statement.dynamic),
      unresolved: Boolean(statement.unresolved),
      uncertainty: uniqueStrings(statement.uncertainty),
      evidenceRefs: [],
      evidence: asArray(statement.evidence),
    }));
  return {
    program: normalizeName(context && context.program),
    riskMarkers: uniqueStrings(context && context.aiContext && context.aiContext.riskHints),
    uncertaintyMarkers: [],
    evidenceIndex: [],
    entities: {
      tables: sortByName(context && context.dependencies && context.dependencies.tables),
      programCalls: sortByName(context && context.dependencies && context.dependencies.programCalls),
      procedureCalls: [],
      copyMembers: sortByName(context && context.dependencies && context.dependencies.copyMembers),
      sqlStatements,
      nativeFiles: sortByName(context && context.nativeFileUsage && context.nativeFileUsage.files),
      binding: {
        modules: sortByName(context && context.bindingAnalysis && context.bindingAnalysis.modules),
      },
    },
  };
}

function buildEvidenceMap(projection) {
  return new Map(asArray(projection && projection.evidenceIndex).map((entry) => [String(entry.id || ''), entry]));
}

function resolveFirstEvidence(projection, evidenceMap, refs, inlineEvidence, context, maxSnippetLines) {
  const byRef = asArray(refs)
    .map((ref) => evidenceMap.get(String(ref)))
    .find(Boolean);
  if (byRef) {
    return {
      ref: byRef.id,
      file: byRef.file || '',
      startLine: Number(byRef.startLine || 0) || undefined,
      endLine: Number(byRef.endLine || byRef.startLine || 0) || undefined,
      snippet: String(byRef.snippet || byRef.rawText || '').trim(),
    };
  }

  const fallbackEvidence = asArray(inlineEvidence)[0];
  if (!fallbackEvidence) return null;
  const snippet = toSnippet(context, fallbackEvidence, maxSnippetLines);
  return {
    ref: null,
    file: fallbackEvidence.file || '',
    startLine: Number(fallbackEvidence.startLine || fallbackEvidence.line || 0) || undefined,
    endLine: Number(fallbackEvidence.endLine || fallbackEvidence.line || fallbackEvidence.startLine || 0) || undefined,
    snippet: snippet ? snippet.text : String(fallbackEvidence.text || '').trim(),
  };
}

function scoreSqlStatement(statement) {
  let score = 20;
  const type = normalizeName(statement.type || 'OTHER') || 'OTHER';
  const intent = normalizeName(statement.intent || 'OTHER') || 'OTHER';
  if (intent === 'WRITE') score += 70;
  if (intent === 'READ') score += 30;
  if (intent === 'CALL') score += 25;
  if (intent === 'TRANSACTION') score += 25;
  if (statement.dynamic) score += 85;
  if (statement.unresolved) score += 80;
  if (asArray(statement.uncertainty).length > 0) score += 25;
  if (asArray(statement.hostVariables).length > 0) score += 10;
  if (type === 'MERGE') score += 20;
  if (type === 'DELETE' || type === 'UPDATE' || type === 'INSERT') score += 20;
  return score;
}

function scoreProgramCall(call) {
  let score = 20;
  const resolution = normalizeName(call.resolution || call.kind || '');
  if (resolution === 'UNRESOLVED') score += 90;
  if (resolution === 'DYNAMIC') score += 80;
  if (resolution === 'EXTERNAL') score += 35;
  if (resolution === 'PROGRAM') score += 20;
  if (resolution === 'INTERNAL') score += 10;
  return score;
}

function scoreNativeFile(file) {
  let score = 20;
  if (file.mutating) score += 80;
  if (file.interactive) score += 70;
  if (file.keyed) score += 15;
  score += asArray(file.recordFormats).length * 8;
  return score;
}

function scoreConditionalLine(text) {
  const normalized = String(text || '').toUpperCase();
  let score = 15;
  if (/\bMONITOR\b/.test(normalized)) score += 30;
  if (/\bSELECT\b|\bWHEN\b/.test(normalized)) score += 15;
  if (/\bIF\b|\bELSEIF\b|\bDOW\b|\bDOU\b/.test(normalized)) score += 10;
  if (/%ERROR|%EOF|%FOUND|SQLCOD|SQLSTATE|\*IN\d{2}/.test(normalized)) score += 25;
  return score;
}

function scoreErrorPathLine(text) {
  const normalized = String(text || '').toUpperCase();
  let score = 35;
  if (/\bON-ERROR\b/.test(normalized)) score += 60;
  if (/\bROLLBACK\b|\bESCAPE\b|\bEXSR\b/.test(normalized)) score += 40;
  if (/SQLCOD|SQLSTATE|%ERROR|%STATUS/.test(normalized)) score += 35;
  if (/\bMONITOR\b/.test(normalized)) score += 20;
  return score;
}

function buildSqlCandidates(context, projection, evidenceMap, options) {
  return sortCandidates(asArray(projection.entities && projection.entities.sqlStatements)
    .map((statement) => {
      const evidence = resolveFirstEvidence(
        projection,
        evidenceMap,
        statement.evidenceRefs,
        statement.evidence,
        context,
        options.maxSnippetLines,
      );
      if (!evidence || !evidence.file) return null;
      return {
        key: `sql:${statement.id || evidenceLocationKey(evidence)}`,
        category: 'sql',
        score: scoreSqlStatement(statement),
        label: `${normalizeName(statement.type || 'SQL') || 'SQL'} SQL`,
        file: evidence.file,
        startLine: evidence.startLine,
        endLine: evidence.endLine,
        snippet: evidence.snippet || statement.text || '',
        ref: evidence.ref,
        sqlStatementId: statement.id,
        tableNames: uniqueStrings(statement.tables),
        programCallNames: [],
        nativeFileNames: [],
      };
    })
    .filter(Boolean));
}

function buildProgramCallCandidates(context, projection, evidenceMap, options) {
  const candidates = [];
  for (const call of asArray(projection.entities && projection.entities.programCalls)) {
    const evidence = resolveFirstEvidence(
      projection,
      evidenceMap,
      call.evidenceRefs,
      call.evidence,
      context,
      options.maxSnippetLines,
    );
    if (!evidence || !evidence.file) continue;
    candidates.push({
      key: `program-call:${normalizeName(call.name)}`,
      category: 'calls',
      score: scoreProgramCall({ kind: call.kind }),
      label: `Program Call ${call.name}`,
      file: evidence.file,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      snippet: evidence.snippet || call.name,
      ref: evidence.ref,
      sqlStatementId: null,
      tableNames: [],
      programCallNames: [call.name],
      nativeFileNames: [],
    });
  }

  for (const call of asArray(projection.entities && projection.entities.procedureCalls)) {
    const evidence = resolveFirstEvidence(
      projection,
      evidenceMap,
      call.evidenceRefs,
      call.evidence,
      context,
      options.maxSnippetLines,
    );
    if (!evidence || !evidence.file) continue;
    candidates.push({
      key: `procedure-call:${normalizeName(call.target)}:${normalizeName(call.resolution)}`,
      category: 'calls',
      score: scoreProgramCall(call),
      label: `Procedure Call ${call.target}`,
      file: evidence.file,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      snippet: evidence.snippet || call.target,
      ref: evidence.ref,
      sqlStatementId: null,
      tableNames: [],
      programCallNames: [],
      nativeFileNames: [],
    });
  }

  for (const moduleEntity of asArray(projection.entities && projection.entities.binding && projection.entities.binding.modules)) {
    if (!moduleEntity.unresolvedBindings) continue;
    const evidence = resolveFirstEvidence(
      projection,
      evidenceMap,
      moduleEntity.evidenceRefs,
      moduleEntity.evidence,
      context,
      options.maxSnippetLines,
    );
    if (!evidence || !evidence.file) continue;
    candidates.push({
      key: `binding-module:${normalizeName(moduleEntity.name)}`,
      category: 'errorPaths',
      score: 85,
      label: `Unresolved Binding ${moduleEntity.name}`,
      file: evidence.file,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      snippet: evidence.snippet || moduleEntity.name,
      ref: evidence.ref,
      sqlStatementId: null,
      tableNames: [],
      programCallNames: [],
      nativeFileNames: [],
    });
  }

  return sortCandidates(candidates);
}

function buildNativeFileCandidates(context, projection, evidenceMap, options) {
  return sortCandidates(asArray(projection.entities && projection.entities.nativeFiles)
    .map((file) => {
      const evidence = resolveFirstEvidence(
        projection,
        evidenceMap,
        file.evidenceRefs,
        file.evidence,
        context,
        options.maxSnippetLines,
      );
      if (!evidence || !evidence.file) return null;
      return {
        key: `native-file:${normalizeName(file.name)}`,
        category: 'fileUsage',
        score: scoreNativeFile(file),
        label: `Native File ${file.name}`,
        file: evidence.file,
        startLine: evidence.startLine,
        endLine: evidence.endLine,
        snippet: evidence.snippet || file.name,
        ref: evidence.ref,
        sqlStatementId: null,
        tableNames: [],
        programCallNames: [],
        nativeFileNames: [file.name],
      };
    })
    .filter(Boolean));
}

function buildHeuristicSourceSignals(context) {
  const conditionalCandidates = [];
  const errorCandidates = [];

  for (const sourceFile of asArray(context && context.sourceFiles)) {
    const file = sourceFile && sourceFile.path ? sourceFile.path : '';
    if (!file) continue;
    const content = loadSourceByRelativePath(context, file);
    if (content === null) continue;
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = String(lines[index] || '').trim();
      if (!line) continue;

      if (/\b(IF|ELSEIF|WHEN|SELECT|MONITOR|DOW|DOU)\b/i.test(line)) {
        conditionalCandidates.push({
          key: `conditional:${file}:${index + 1}:${line}`,
          category: 'conditionals',
          score: scoreConditionalLine(line),
          label: 'Conditional Logic',
          file,
          startLine: index + 1,
          endLine: index + 1,
          snippet: line,
          ref: null,
          sqlStatementId: null,
          tableNames: [],
          programCallNames: [],
          nativeFileNames: [],
        });
      }

      if (/\b(ON-ERROR|ROLLBACK|SQLCOD|SQLSTATE|%ERROR|%STATUS|MONITOR)\b/i.test(line)) {
        errorCandidates.push({
          key: `error-path:${file}:${index + 1}:${line}`,
          category: 'errorPaths',
          score: scoreErrorPathLine(line),
          label: 'Error Path',
          file,
          startLine: index + 1,
          endLine: index + 1,
          snippet: line,
          ref: null,
          sqlStatementId: null,
          tableNames: [],
          programCallNames: [],
          nativeFileNames: [],
        });
      }
    }
  }

  return {
    conditionals: sortCandidates(dedupeByKey(conditionalCandidates, (entry) => entry.key)),
    errorPaths: sortCandidates(dedupeByKey(errorCandidates, (entry) => entry.key)),
  };
}

function buildRankedTables(context, projection, sqlCandidates, fileCandidates) {
  const tableMap = mapByName(projection.entities && projection.entities.tables);
  const scoreMap = new Map();

  for (const table of tableMap.values()) {
    scoreMap.set(normalizeName(table.name), Number(table.evidenceRefs && table.evidenceRefs.length ? table.evidenceRefs.length * 5 : 0));
  }

  for (const candidate of sqlCandidates) {
    for (const tableName of asArray(candidate.tableNames)) {
      scoreMap.set(tableName, (scoreMap.get(tableName) || 0) + Math.max(10, Math.floor(candidate.score / 2)));
    }
  }

  for (const candidate of fileCandidates) {
    const nativeName = normalizeName(asArray(candidate.nativeFileNames)[0]);
    if (!nativeName || !scoreMap.has(nativeName)) continue;
    scoreMap.set(nativeName, (scoreMap.get(nativeName) || 0) + candidate.score);
  }

  for (const primaryTable of uniqueStrings(context && context.aiContext && context.aiContext.primaryTables)) {
    scoreMap.set(normalizeName(primaryTable), (scoreMap.get(normalizeName(primaryTable)) || 0) + 30);
  }

  return Array.from(tableMap.values())
    .map((entry) => ({
      ...entry,
      _score: scoreMap.get(normalizeName(entry.name)) || 0,
    }))
    .sort((a, b) => {
      if (a._score !== b._score) return b._score - a._score;
      return a.name.localeCompare(b.name);
    });
}

function buildRankedProgramCalls(context, projection, callCandidates) {
  const programCalls = mapByName(projection.entities && projection.entities.programCalls);
  const scoreMap = new Map();

  for (const call of programCalls.values()) {
    scoreMap.set(normalizeName(call.name), Number(call.evidenceRefs && call.evidenceRefs.length ? call.evidenceRefs.length * 5 : 0));
  }

  for (const candidate of callCandidates) {
    for (const callName of asArray(candidate.programCallNames)) {
      const key = normalizeName(callName);
      scoreMap.set(key, (scoreMap.get(key) || 0) + candidate.score);
    }
  }

  for (const primaryCall of uniqueStrings(context && context.aiContext && context.aiContext.primaryCalls)) {
    const key = normalizeName(primaryCall);
    scoreMap.set(key, (scoreMap.get(key) || 0) + 25);
  }

  return Array.from(programCalls.values())
    .map((entry) => ({
      ...entry,
      _score: scoreMap.get(normalizeName(entry.name)) || 0,
    }))
    .sort((a, b) => {
      if (a._score !== b._score) return b._score - a._score;
      return a.name.localeCompare(b.name);
    });
}

function buildRankedCopyMembers(projection) {
  return sortByName(projection.entities && projection.entities.copyMembers)
    .map((entry, index) => ({
      ...entry,
      _score: Math.max(1, 100 - index),
    }));
}

function buildRankedNativeFiles(projection) {
  return sortByName(projection.entities && projection.entities.nativeFiles)
    .map((entry) => ({
      ...entry,
      _score: scoreNativeFile(entry),
    }))
    .sort((a, b) => {
      if (a._score !== b._score) return b._score - a._score;
      return a.name.localeCompare(b.name);
    });
}

function buildRankedSqlStatements(projection) {
  return asArray(projection.entities && projection.entities.sqlStatements)
    .map((entry) => ({
      ...entry,
      _score: scoreSqlStatement(entry),
    }))
    .sort((a, b) => {
      if (a._score !== b._score) return b._score - a._score;
      const at = String(a.type || '');
      const bt = String(b.type || '');
      if (at !== bt) return at.localeCompare(bt);
      return String(a.text || '').localeCompare(String(b.text || ''));
    });
}

function categoryCaps(options) {
  return {
    sql: options.maxSQLStatements,
    calls: Math.max(1, Math.min(options.maxProgramCalls, options.maxSourceSnippets)),
    fileUsage: Math.max(1, Math.min(options.maxTables, options.maxSourceSnippets)),
    conditionals: Math.max(1, Math.min(4, options.maxSourceSnippets)),
    errorPaths: Math.max(1, Math.min(4, options.maxSourceSnippets)),
  };
}

function workflowMultipliers(workflowName) {
  if (workflowName === 'errorAnalysis') {
    return {
      sql: 1.45,
      calls: 1.35,
      fileUsage: 1.25,
      conditionals: 1.05,
      errorPaths: 1.7,
    };
  }
  return {
    sql: 1.2,
    calls: 1.0,
    fileUsage: 1.15,
    conditionals: 0.9,
    errorPaths: 1.1,
  };
}

function scoreWorkflowCandidate(candidate, workflowName) {
  const multipliers = workflowMultipliers(workflowName);
  const multiplier = multipliers[candidate.category] || 1;
  return Math.round(Number(candidate.score || 0) * multiplier);
}

function estimateCandidateTokens(candidate) {
  return estimateTokensFromObject({
    category: candidate.category,
    label: candidate.label,
    file: candidate.file,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    snippet: candidate.snippet,
  });
}

function addFillers(selected, fillerItems, usedNames, cap, nameFn) {
  for (const item of fillerItems) {
    if (selected.length >= cap) break;
    const name = normalizeName(nameFn(item));
    if (!name || usedNames.has(name)) continue;
    selected.push(shallowCloneItem(item));
    usedNames.add(name);
  }
}

function deriveWorkflowEntities(selection, rankedSets, options) {
  const tableNames = new Set();
  const programCallNames = new Set();
  const nativeFileNames = new Set();
  const sqlIds = new Set();

  for (const candidate of selection) {
    for (const tableName of asArray(candidate.tableNames)) {
      tableNames.add(normalizeName(tableName));
    }
    for (const programCallName of asArray(candidate.programCallNames)) {
      programCallNames.add(normalizeName(programCallName));
    }
    for (const nativeFileName of asArray(candidate.nativeFileNames)) {
      nativeFileNames.add(normalizeName(nativeFileName));
    }
    if (candidate.sqlStatementId) {
      sqlIds.add(String(candidate.sqlStatementId));
    }
  }

  const tables = [];
  addFillers(
    tables,
    rankedSets.tables.filter((entry) => tableNames.has(normalizeName(entry.name))),
    new Set(),
    options.maxTables,
    (item) => item.name,
  );
  addFillers(
    tables,
    rankedSets.tables,
    new Set(tables.map((item) => normalizeName(item.name))),
    options.maxTables,
    (item) => item.name,
  );

  const programCalls = [];
  addFillers(
    programCalls,
    rankedSets.programCalls.filter((entry) => programCallNames.has(normalizeName(entry.name))),
    new Set(),
    options.maxProgramCalls,
    (item) => item.name,
  );
  addFillers(
    programCalls,
    rankedSets.programCalls,
    new Set(programCalls.map((item) => normalizeName(item.name))),
    options.maxProgramCalls,
    (item) => item.name,
  );

  const copyMembers = [];
  addFillers(
    copyMembers,
    rankedSets.copyMembers,
    new Set(),
    options.maxCopyMembers,
    (item) => item.name,
  );

  const sqlStatements = [];
  addFillers(
    sqlStatements,
    rankedSets.sqlStatements.filter((entry) => sqlIds.has(String(entry.id))),
    new Set(),
    options.maxSQLStatements,
    (item) => item.id,
  );
  addFillers(
    sqlStatements,
    rankedSets.sqlStatements,
    new Set(sqlStatements.map((item) => String(item.id))),
    options.maxSQLStatements,
    (item) => item.id,
  );

  const nativeFiles = [];
  addFillers(
    nativeFiles,
    rankedSets.nativeFiles.filter((entry) => nativeFileNames.has(normalizeName(entry.name))),
    new Set(),
    Math.max(1, Math.min(options.maxTables, options.maxSourceSnippets)),
    (item) => item.name,
  );
  addFillers(
    nativeFiles,
    rankedSets.nativeFiles,
    new Set(nativeFiles.map((item) => normalizeName(item.name))),
    Math.max(1, Math.min(options.maxTables, options.maxSourceSnippets)),
    (item) => item.name,
  );

  return {
    tables,
    programCalls,
    copyMembers,
    sqlStatements,
    nativeFiles,
  };
}

function buildEvidencePacks(selection) {
  const packs = {
    sql: [],
    calls: [],
    fileUsage: [],
    conditionals: [],
    errorPaths: [],
  };

  selection.forEach((candidate, index) => {
    const entry = {
      rank: index + 1,
      score: candidate.workflowScore,
      label: candidate.label,
      file: candidate.file,
      startLine: candidate.startLine || null,
      endLine: candidate.endLine || null,
      snippet: candidate.snippet,
      ref: candidate.ref || null,
      category: candidate.category,
    };
    if (packs[candidate.category]) {
      packs[candidate.category].push(entry);
    }
  });

  return packs;
}

function materializeWorkflow(workflowName, selection, projection, rankedSets, context, options, budget) {
  const entities = deriveWorkflowEntities(selection, rankedSets, options);
  const evidencePacks = buildEvidencePacks(selection);
  const evidenceHighlights = selection.map((candidate, index) => ({
    rank: index + 1,
    score: candidate.workflowScore,
    label: candidate.label,
    file: candidate.file,
    startLine: candidate.startLine || null,
    endLine: candidate.endLine || null,
    snippet: candidate.snippet,
    ref: candidate.ref || null,
    category: candidate.category,
  }));

  const workflow = {
    name: workflowName === 'errorAnalysis' ? 'error-analysis' : 'documentation',
    tokenBudget: budget,
    estimatedTokens: 0,
    summary: context && context.summary ? context.summary.text : '',
    tables: entities.tables.map((entry) => ({
      name: entry.name,
      kind: entry.kind || 'TABLE',
      evidenceRefs: asArray(entry.evidenceRefs),
    })),
    programCalls: entities.programCalls.map((entry) => ({
      name: entry.name,
      kind: entry.kind || 'PROGRAM',
      evidenceRefs: asArray(entry.evidenceRefs),
    })),
    copyMembers: entities.copyMembers.map((entry) => ({
      name: entry.name,
      evidenceRefs: asArray(entry.evidenceRefs),
    })),
    sqlStatements: entities.sqlStatements.map((entry) => ({
      id: entry.id,
      type: entry.type,
      intent: entry.intent || 'OTHER',
      text: entry.text,
      tables: asArray(entry.tables),
      hostVariables: asArray(entry.hostVariables),
      dynamic: Boolean(entry.dynamic),
      unresolved: Boolean(entry.unresolved),
      uncertainty: asArray(entry.uncertainty),
      evidenceRefs: asArray(entry.evidenceRefs),
    })),
    nativeFiles: entities.nativeFiles.map((entry) => ({
      name: entry.name,
      kind: entry.kind || 'FILE',
      keyed: Boolean(entry.keyed),
      mutating: Boolean(entry.mutating),
      interactive: Boolean(entry.interactive),
      recordFormats: asArray(entry.recordFormats),
      evidenceRefs: asArray(entry.evidenceRefs),
    })),
    riskMarkers: uniqueStrings(projection && projection.riskMarkers),
    uncertaintyMarkers: uniqueStrings(projection && projection.uncertaintyMarkers),
    evidencePacks,
    evidenceHighlights,
    rankedEvidence: evidenceHighlights,
    dependencyGraphSummary: {
      nodeCount: Number(context && context.graph && context.graph.nodeCount) || 0,
      edgeCount: Number(context && context.graph && context.graph.edgeCount) || 0,
    },
    testData: context && context.testData ? context.testData : { status: 'skipped' },
  };
  workflow.estimatedTokens = estimateTokensFromObject(workflow);
  return workflow;
}

function selectWorkflowCandidates(workflowName, candidatesByCategory, options, budget) {
  const caps = categoryCaps(options);
  const selected = [];
  const selectedKeys = new Set();
  const counters = {
    sql: 0,
    calls: 0,
    fileUsage: 0,
    conditionals: 0,
    errorPaths: 0,
  };
  let consumedTokens = 0;
  const availableBudget = Math.max(120, budget - 220);

  const categoryOrder = workflowName === 'errorAnalysis'
    ? ['errorPaths', 'sql', 'calls', 'fileUsage', 'conditionals']
    : ['sql', 'fileUsage', 'calls', 'conditionals', 'errorPaths'];

  function trySelect(candidate) {
    if (!candidate || selectedKeys.has(candidate.key)) return false;
    if ((counters[candidate.category] || 0) >= (caps[candidate.category] || 0)) return false;
    const candidateTokens = estimateCandidateTokens(candidate);
    if ((consumedTokens + candidateTokens) > availableBudget && selected.length > 0) return false;
    selected.push(candidate);
    selectedKeys.add(candidate.key);
    counters[candidate.category] += 1;
    consumedTokens += candidateTokens;
    return true;
  }

  for (const category of categoryOrder) {
    const first = sortCandidates(candidatesByCategory[category])[0];
    trySelect(first);
  }

  const allCandidates = sortCandidates(Object.values(candidatesByCategory)
    .flatMap((entries) => asArray(entries))
    .map((candidate) => ({
      ...candidate,
      workflowScore: scoreWorkflowCandidate(candidate, workflowName),
    })));

  for (const candidate of allCandidates) {
    trySelect(candidate);
  }

  return sortCandidates(selected.map((candidate) => ({
    ...candidate,
    workflowScore: scoreWorkflowCandidate(candidate, workflowName),
  })));
}

function buildSummaryText(optimized, context) {
  const nativeSummary = context && context.nativeFileUsage && context.nativeFileUsage.summary
    ? context.nativeFileUsage.summary
    : null;

  const nativeText = nativeSummary
    ? ` It preserves ${nativeSummary.fileCount || 0} native files (${nativeSummary.mutatingFileCount || 0} mutating, ${nativeSummary.interactiveFileCount || 0} interactive).`
    : '';

  return `Optimized context for ${optimized.program} uses salience-ranked evidence packs, keeps ${optimized.summary.tables} tables, ${optimized.summary.programCalls} program calls, ${optimized.summary.copyMembers} copy members, ${optimized.summary.sqlStatements} SQL statements, and ${optimized.summary.evidenceHighlights} ranked evidence items.${nativeText}`;
}

function summarize(optimized) {
  const documentation = optimized && optimized.workflows ? optimized.workflows.documentation : null;
  return {
    tables: asArray(optimized.tables).length,
    programCalls: asArray(optimized.programCalls).length,
    copyMembers: asArray(optimized.copyMembers).length,
    sqlStatements: asArray(optimized.sqlStatements).length,
    evidenceHighlights: asArray(documentation && documentation.evidenceHighlights).length,
    workflowCount: Object.keys((optimized && optimized.workflows) || {}).length,
  };
}

function optimizeContext(context, config = {}, aiProjectionInput = null) {
  const options = normalizeOptions(config);
  const projection = aiProjectionInput && typeof aiProjectionInput === 'object'
    ? aiProjectionInput
    : buildFallbackProjection(context);
  const evidenceMap = buildEvidenceMap(projection);

  const sqlCandidates = buildSqlCandidates(context, projection, evidenceMap, options);
  const callCandidates = buildProgramCallCandidates(context, projection, evidenceMap, options);
  const fileCandidates = buildNativeFileCandidates(context, projection, evidenceMap, options);
  const heuristicSignals = buildHeuristicSourceSignals(context);

  const rankedSets = {
    tables: buildRankedTables(context, projection, sqlCandidates, fileCandidates),
    programCalls: buildRankedProgramCalls(context, projection, callCandidates),
    copyMembers: buildRankedCopyMembers(projection),
    sqlStatements: buildRankedSqlStatements(projection),
    nativeFiles: buildRankedNativeFiles(projection),
  };

  const workflows = {};
  for (const workflowKey of WORKFLOW_KEYS) {
    const selection = selectWorkflowCandidates(
      workflowKey,
      {
        sql: sqlCandidates,
        calls: callCandidates,
        fileUsage: fileCandidates,
        conditionals: heuristicSignals.conditionals,
        errorPaths: heuristicSignals.errorPaths,
      },
      options,
      options.workflowTokenBudgets[workflowKey],
    );

    let workflow = materializeWorkflow(
      workflowKey,
      selection,
      projection,
      rankedSets,
      context,
      options,
      options.workflowTokenBudgets[workflowKey],
    );

    let trimmedSelection = [...selection];
    while (trimmedSelection.length > 1 && workflow.estimatedTokens > options.workflowTokenBudgets[workflowKey]) {
      trimmedSelection.pop();
      workflow = materializeWorkflow(
        workflowKey,
        trimmedSelection,
        projection,
        rankedSets,
        context,
        options,
        options.workflowTokenBudgets[workflowKey],
      );
    }

    workflows[workflowKey] = workflow;
  }

  const documentationWorkflow = workflows.documentation;
  const optimized = {
    program: normalizeName(context && context.program),
    scannedAt: context && context.scannedAt ? context.scannedAt : new Date().toISOString(),
    sourceRoot: context && context.sourceRoot ? context.sourceRoot : '',
    graph: context && context.graph ? context.graph : {
      nodeCount: 0,
      edgeCount: 0,
      files: {},
    },
    summary: {},
    tables: asArray(documentationWorkflow && documentationWorkflow.tables),
    programCalls: asArray(documentationWorkflow && documentationWorkflow.programCalls),
    copyMembers: asArray(documentationWorkflow && documentationWorkflow.copyMembers),
    sqlStatements: asArray(documentationWorkflow && documentationWorkflow.sqlStatements),
    snippets: asArray(documentationWorkflow && documentationWorkflow.evidenceHighlights)
      .slice(0, options.maxSourceSnippets)
      .map((entry) => ({
        file: entry.file,
        startLine: entry.startLine,
        endLine: entry.endLine,
        text: entry.snippet,
        rank: entry.rank,
        score: entry.score,
        category: entry.category,
      })),
    workflows,
    notes: asArray(context && context.notes),
    optimization: {
      applied: true,
      strategy: 'salience-ranked-evidence-packs',
      limits: options,
    },
  };

  optimized.summary = summarize(optimized);
  optimized.summary.text = buildSummaryText(optimized, context);
  optimized.estimatedTokens = estimateTokensFromObject(optimized);

  return optimized;
}

module.exports = {
  DEFAULT_CONTEXT_OPTIMIZER_OPTIONS: DEFAULT_OPTIONS,
  optimizeContext,
};
