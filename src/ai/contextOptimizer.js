const fs = require('fs');
const path = require('path');
const { estimateTokensFromObject } = require('./tokenEstimator');

const DEFAULT_OPTIONS = {
  maxTables: 20,
  maxProgramCalls: 20,
  maxCopyMembers: 10,
  maxSQLStatements: 10,
  maxSourceSnippets: 20,
  maxSnippetLines: 12,
  softTokenLimit: 3000,
};

function normalizeName(value) {
  return String(value || '').trim().toUpperCase();
}

function asArray(value) {
  if (!Array.isArray(value)) return [];
  return value;
}

function asNameList(values) {
  const mapped = asArray(values)
    .map((item) => (item && item.name ? item.name : item))
    .map((name) => normalizeName(name))
    .filter(Boolean);
  return Array.from(new Set(mapped)).sort((a, b) => a.localeCompare(b));
}

function dedupeByKey(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function normalizeOptions(config) {
  const input = config && typeof config === 'object' ? config : {};
  return {
    maxTables: Number.isFinite(Number(input.maxTables)) ? Math.max(0, Number(input.maxTables)) : DEFAULT_OPTIONS.maxTables,
    maxProgramCalls: Number.isFinite(Number(input.maxProgramCalls)) ? Math.max(0, Number(input.maxProgramCalls)) : DEFAULT_OPTIONS.maxProgramCalls,
    maxCopyMembers: Number.isFinite(Number(input.maxCopyMembers)) ? Math.max(0, Number(input.maxCopyMembers)) : DEFAULT_OPTIONS.maxCopyMembers,
    maxSQLStatements: Number.isFinite(Number(input.maxSQLStatements)) ? Math.max(0, Number(input.maxSQLStatements)) : DEFAULT_OPTIONS.maxSQLStatements,
    maxSourceSnippets: Number.isFinite(Number(input.maxSourceSnippets)) ? Math.max(0, Number(input.maxSourceSnippets)) : DEFAULT_OPTIONS.maxSourceSnippets,
    maxSnippetLines: Number.isFinite(Number(input.maxSnippetLines)) ? Math.max(1, Number(input.maxSnippetLines)) : DEFAULT_OPTIONS.maxSnippetLines,
    softTokenLimit: Number.isFinite(Number(input.softTokenLimit)) ? Math.max(1, Number(input.softTokenLimit)) : DEFAULT_OPTIONS.softTokenLimit,
  };
}

function sortSqlByOccurrence(statements) {
  return [...asArray(statements)].sort((a, b) => {
    const ae = asArray(a && a.evidence)[0] || {};
    const be = asArray(b && b.evidence)[0] || {};
    const af = String(ae.file || '');
    const bf = String(be.file || '');
    if (af !== bf) return af.localeCompare(bf);

    const aLine = Number(ae.startLine || ae.line || 0);
    const bLine = Number(be.startLine || be.line || 0);
    if (aLine !== bLine) return aLine - bLine;

    const at = String(a && a.type || '');
    const bt = String(b && b.type || '');
    if (at !== bt) return at.localeCompare(bt);
    return String(a && a.text || '').localeCompare(String(b && b.text || ''));
  });
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

function buildSqlStatements(sqlStatements, maxSQLStatements) {
  return sortSqlByOccurrence(sqlStatements)
    .slice(0, maxSQLStatements)
    .map((statement) => ({
      type: normalizeName(statement.type || 'OTHER') || 'OTHER',
      tables: asNameList(statement.tables),
      snippet: String(statement.text || '').trim(),
      evidence: asArray(statement.evidence),
    }));
}

function scoreSnippet(snippet, selectedSqlStatements) {
  let score = 1;
  for (const statement of selectedSqlStatements) {
    const evidenceList = asArray(statement.evidence);
    const linked = evidenceList.some((ev) => {
      if (String(ev.file || '') !== snippet.file) return false;
      const evStart = Number(ev.startLine || ev.line || 0);
      const evEnd = Number(ev.endLine || ev.line || evStart);
      return snippet.startLine <= evEnd && snippet.endLine >= evStart;
    });
    if (linked) {
      score += 50;
    }
  }
  return score;
}

function buildSnippets(context, selectedSqlStatements, options) {
  const snippetCandidates = [];

  for (const statement of selectedSqlStatements) {
    for (const evidence of asArray(statement.evidence)) {
      const snippet = toSnippet(context, evidence, options.maxSnippetLines);
      if (!snippet) continue;
      snippetCandidates.push(snippet);
    }
  }

  const unique = dedupeByKey(snippetCandidates, (snippet) => `${snippet.file}:${snippet.startLine}:${snippet.endLine}`)
    .map((snippet) => ({ ...snippet, _score: scoreSnippet(snippet, selectedSqlStatements) }))
    .sort((a, b) => {
      if (a._score !== b._score) return b._score - a._score;
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return a.startLine - b.startLine;
    })
    .slice(0, options.maxSourceSnippets)
    .map((snippet) => ({
      file: snippet.file,
      startLine: snippet.startLine,
      endLine: snippet.endLine,
      text: snippet.text,
    }));

  return unique;
}

function summarize(optimized) {
  return {
    tables: asArray(optimized.tables).length,
    programCalls: asArray(optimized.programCalls).length,
    copyMembers: asArray(optimized.copyMembers).length,
    sqlStatements: asArray(optimized.sqlStatements).length,
  };
}

function optimizeContext(context, config = {}) {
  const options = normalizeOptions(config);
  const dependencies = (context && context.dependencies) || {};
  const sqlBlock = (context && context.sql) || {};

  const tables = asNameList(dependencies.tables).slice(0, options.maxTables);
  const programCalls = asNameList(dependencies.programCalls).slice(0, options.maxProgramCalls);
  const copyMembers = asNameList(dependencies.copyMembers).slice(0, options.maxCopyMembers);

  const selectedSql = buildSqlStatements(sqlBlock.statements, options.maxSQLStatements);
  const snippets = buildSnippets(context, selectedSql, options);

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
    tables,
    programCalls,
    copyMembers,
    sqlStatements: selectedSql.map((statement) => ({
      type: statement.type,
      tables: statement.tables,
      snippet: statement.snippet,
    })),
    snippets,
    notes: asArray(context && context.notes),
    optimization: {
      applied: true,
      limits: options,
    },
  };

  optimized.summary = summarize(optimized);
  optimized.summary.text = `Optimized context for ${optimized.program} keeps ${optimized.summary.tables} tables, ${optimized.summary.programCalls} program calls, ${optimized.summary.copyMembers} copy members, and ${optimized.summary.sqlStatements} SQL statements.`;
  optimized.estimatedTokens = estimateTokensFromObject(optimized);

  return optimized;
}

module.exports = {
  DEFAULT_CONTEXT_OPTIMIZER_OPTIONS: DEFAULT_OPTIONS,
  optimizeContext,
};
