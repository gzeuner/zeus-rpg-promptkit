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
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeSeverity, parseMaxMessages } = require('../cli/commands/joblogCommand');
const { runDoctorChecks } = require('../cli/commands/doctorCommand');
const { findImpactGraph } = require('../cli/helpers/impactGraphResolver');
const { readAnalyzeRunManifest } = require('../analyze/analyzeRunManifest');
const { resolveAnalyzeConfig, resolveAnalyzeDbConfig } = require('../config/runtimeConfig');
const { isDbConfigured } = require('../db2/db2Config');
const { escapeSqlLiteral, runReadOnlyDb2Query, validateSqlIdentifier } = require('../db2/readOnlyQueryService');
const { executeQuerySql, executeQueryTable } = require('../core/queryService');
const { executeSearchSource, normalizeFilePattern } = require('../core/searchSourceService');
const { analyzeImpactFromGraph, normalizeId } = require('../impact/impactAnalyzer');
const { assessCanonicalModel } = require('../impact/riskAssessmentAnalyzer');
const { WORKFLOW_RUN_MANIFEST_FILE } = require('../workflow/workflowRunManifest');
const { searchLocalSources } = require('../investigation/fieldXrefService');

const SUPPORTED_INSPECT_OBJECT_TYPES = ['*PGM', '*SRVPGM', '*MODULE', '*FILE', '*CMD', '*DTAARA', '*JOBQ', '*OUTQ'];
const DEFAULT_MCP_PAYLOAD_ITEMS = 100;
const MAX_MCP_PAYLOAD_ITEMS = 1000;
const MCP_CURSOR_VERSION = 1;

function readPackageVersion(cwd) {
  try {
    const packageJsonPath = path.resolve(cwd || process.cwd(), 'package.json');
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return String(parsed.version || '').trim() || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

function createInvalidCursorError(toolName, detail) {
  const error = new Error(`Invalid arguments for ${toolName} cursor: ${detail}`);
  error.code = 'TOOL_INVALID_ARGUMENTS';
  return error;
}

function encodeMcpCursor(toolName, offset) {
  return Buffer.from(JSON.stringify({
    v: MCP_CURSOR_VERSION,
    t: toolName,
    o: offset,
  }), 'utf8').toString('base64url');
}

function decodeMcpCursor(toolName, cursor, options = {}) {
  const allowLegacyNumericCursor = options.allowLegacyNumericCursor === true;
  const rawCursor = typeof cursor === 'string' ? cursor.trim() : '';
  if (!rawCursor) {
    return {
      cursor: null,
      offset: 0,
      isLegacyNumeric: false,
    };
  }
  if (/^\d+$/.test(rawCursor)) {
    if (!allowLegacyNumericCursor) {
      throw createInvalidCursorError(toolName, 'legacy numeric cursor input is disabled; provide an opaque cursor token.');
    }
    return {
      cursor: rawCursor,
      offset: Number.parseInt(rawCursor, 10),
      isLegacyNumeric: true,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
  } catch (_) {
    throw createInvalidCursorError(toolName, 'value must be a legacy numeric offset or an opaque versioned token.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw createInvalidCursorError(toolName, 'token payload must be an object.');
  }
  if (Number(parsed.v) !== MCP_CURSOR_VERSION) {
    throw createInvalidCursorError(toolName, `unsupported cursor version: ${parsed.v}`);
  }
  if (String(parsed.t || '') !== toolName) {
    throw createInvalidCursorError(toolName, 'token target does not match this tool.');
  }
  if (!Number.isInteger(parsed.o) || parsed.o < 0) {
    throw createInvalidCursorError(toolName, 'token offset must be a non-negative integer.');
  }

  return {
    cursor: rawCursor,
    offset: parsed.o,
    isLegacyNumeric: false,
  };
}

function normalizeJoblogToolError(error) {
  const message = error && error.message ? String(error.message) : String(error);
  if (/JOBLOG_INFO|SQL0204/i.test(message)) {
    const wrapped = new Error(
      'zeus.joblog requires QSYS2.JOBLOG_INFO on the target IBM i. This service is not available on the current system; use DSPJOBLOG in ACS or QSYS2.HISTORY_LOG_INFO as a fallback.',
    );
    wrapped.code = error && error.code ? error.code : undefined;
    return wrapped;
  }
  return error;
}

function isJoblogInfoUnavailableError(error) {
  const message = error && error.message ? String(error.message) : String(error);
  return /JOBLOG_INFO|SQL0204/i.test(message);
}

function buildHistoryLogFallbackSeverityClause(severity) {
  if (severity === 'ERROR') {
    return "(MESSAGE_TYPE IN ('ESCAPE', 'INQUIRY', 'NOTIFY') OR COALESCE(SEVERITY, 0) >= 30)";
  }
  if (severity === 'WARNING') {
    return '(COALESCE(SEVERITY, 0) BETWEEN 1 AND 29)';
  }
  if (severity === 'INFO') {
    return "(COALESCE(SEVERITY, 0) = 0 OR MESSAGE_TYPE IN ('INFORMATIONAL', 'COMPLETION', 'DIAGNOSTIC', 'SENDER', 'REQUEST', 'REPLY'))";
  }
  return null;
}

function buildHistoryLogFallbackQuery({ jobName, severity, maxMessages }) {
  const whereClauses = [];
  if (jobName) {
    whereClauses.push(`FROM_JOB LIKE ${escapeSqlLiteral(`%/${jobName}%`)}`);
  }
  const severityClause = buildHistoryLogFallbackSeverityClause(severity);
  if (severityClause) {
    whereClauses.push(severityClause);
  }
  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  return `
    SELECT
      FROM_JOB AS JOB_NAME,
      MESSAGE_ID,
      MESSAGE_TYPE,
      MESSAGE_TEXT,
      MESSAGE_TIMESTAMP
    FROM TABLE(QSYS2.HISTORY_LOG_INFO(CURRENT TIMESTAMP - 1 DAY)) X
    ${whereClause}
    FETCH FIRST ${maxMessages} ROWS ONLY
  `;
}

function summarizeJoblogRows({ profile, jobName, severity, maxMessages, result, backend }) {
  const rows = Array.isArray(result && result.rows) ? result.rows : [];
  const columns = Array.isArray(result && result.columns) ? result.columns : [];
  const messageIds = new Set(rows.map((row) => (row && row.MESSAGE_ID ? String(row.MESSAGE_ID) : '')).filter(Boolean));
  const compatibilityNote = backend === 'HISTORY_LOG_INFO'
    ? (
      severity
        ? `Compatibility mode: results came from HISTORY_LOG_INFO, so the requested severity "${severity}" is best-effort and may not exactly match JOBLOG_INFO semantics.`
        : 'Compatibility mode: results came from HISTORY_LOG_INFO because JOBLOG_INFO is unavailable on this system.'
    )
    : null;

  return {
    profile,
    job: jobName || null,
    severity: severity || null,
    maxMessages,
    backend,
    compatibilityNote,
    rowCount: rows.length,
    uniqueMessageIdCount: messageIds.size,
    limitReached: rows.length >= maxMessages,
    columns,
    rows,
  };
}

function listMcpTools() {
  return [
    {
      name: 'zeus.health',
      description: 'Returns a local health heartbeat and UTC timestamp.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: 'zeus.version',
      description: 'Returns Zeus package version and runtime metadata.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          includeNode: {
            type: 'boolean',
            description: 'Include current Node.js runtime version when true.',
          },
        },
      },
    },
    {
      name: 'zeus.doctor',
      description: 'Runs safe doctor checks for a profile and returns status-only summaries.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['profile'],
        properties: {
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Runtime profile name used for doctor checks.',
          },
        },
      },
    },
    {
      name: 'zeus.joblog',
      description: 'Queries IBM i joblog messages via QSYS2.JOBLOG_INFO (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['profile'],
        properties: {
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Runtime profile with DB2 metadata access.',
          },
          job: {
            type: 'string',
            minLength: 1,
            description: 'Optional job name prefix filter.',
          },
          severity: {
            type: 'string',
            enum: ['INFO', 'WARNING', 'ERROR'],
            description: 'Optional severity filter.',
          },
          maxMessages: {
            type: 'integer',
            minimum: 1,
            maximum: 500,
            description: 'Maximum number of joblog messages to return.',
          },
        },
      },
    },
    {
      name: 'zeus.assess-risk',
      description: 'Assesses program risk from existing canonical analysis artifacts (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['program'],
        properties: {
          program: {
            type: 'string',
            minLength: 1,
            description: 'Analyzed program output directory name.',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Optional runtime profile used to resolve default output root.',
          },
          out: {
            type: 'string',
            minLength: 1,
            description: 'Optional output root override containing canonical analysis artifacts.',
          },
          output: {
            type: 'string',
            minLength: 1,
            description: 'Optional alias for out.',
          },
          maxAccessPoints: {
            type: 'integer',
            minimum: 1,
            description: 'Maximum number of access points to include.',
          },
          maxCriticalPaths: {
            type: 'integer',
            minimum: 1,
            description: 'Maximum number of critical paths to include.',
          },
        },
      },
    },
    {
      name: 'zeus.inspect-object',
      description: 'Inspects IBM i object metadata via QSYS2.OBJECT_STATISTICS (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['profile', 'lib', 'name'],
        properties: {
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Runtime profile with DB2 metadata access.',
          },
          lib: {
            type: 'string',
            minLength: 1,
            description: 'Object library name.',
          },
          name: {
            type: 'string',
            minLength: 1,
            description: 'Object name.',
          },
          type: {
            type: 'string',
            enum: SUPPORTED_INSPECT_OBJECT_TYPES,
            description: 'Optional object type (defaults to *PGM).',
          },
          journalOnly: {
            type: 'boolean',
            description: 'When true, return only journal-related fields.',
          },
        },
      },
    },
    {
      name: 'zeus.field-search',
      description: 'Searches local source files for field usage and optional table context (read-only local subset).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceRoot', 'field'],
        properties: {
          sourceRoot: {
            type: 'string',
            minLength: 1,
            description: 'Local source root path to scan.',
          },
          field: {
            type: 'string',
            minLength: 1,
            description: 'Field name to search for.',
          },
          table: {
            type: 'string',
            minLength: 1,
            description: 'Optional table name to narrow SQL context.',
          },
          maxResults: {
            type: 'integer',
            minimum: 1,
            description: 'Maximum number of matches to return.',
          },
          maxPayloadItems: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_MCP_PAYLOAD_ITEMS,
            description: 'Optional cap for returned match entries in MCP payload.',
          },
          cursor: {
            type: 'string',
            minLength: 1,
            description: 'Optional pagination cursor returned by a previous zeus.field-search call.',
          },
          contextLines: {
            type: 'integer',
            minimum: 0,
            description: 'How many surrounding lines to include around each match.',
          },
        },
      },
    },
    {
      name: 'zeus.workflow',
      description: 'Reads existing workflow run manifest and returns deterministic workflow metadata (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['program'],
        properties: {
          program: {
            type: 'string',
            minLength: 1,
            description: 'Analyzed program output directory name.',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Optional runtime profile used to resolve default output root.',
          },
          out: {
            type: 'string',
            minLength: 1,
            description: 'Optional output root override containing workflow artifacts.',
          },
          output: {
            type: 'string',
            minLength: 1,
            description: 'Optional alias for out.',
          },
        },
      },
    },
    {
      name: 'zeus.bundle',
      description: 'Reads existing bundle manifests and returns deterministic bundle metadata (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['program'],
        properties: {
          program: {
            type: 'string',
            minLength: 1,
            description: 'Analyzed program output directory name.',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Optional runtime profile used to resolve default output roots.',
          },
          sourceOutputRoot: {
            type: 'string',
            minLength: 1,
            description: 'Optional source output root override (alias for source-output-root).',
          },
          'source-output-root': {
            type: 'string',
            minLength: 1,
            description: 'Optional source output root override.',
          },
          output: {
            type: 'string',
            minLength: 1,
            description: 'Optional bundle output root override.',
          },
          out: {
            type: 'string',
            minLength: 1,
            description: 'Optional alias for output.',
          },
        },
      },
    },
    {
      name: 'zeus.analyze',
      description: 'Reads existing analyze artifacts and returns deterministic run summaries (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['program'],
        properties: {
          program: {
            type: 'string',
            minLength: 1,
            description: 'Analyzed program output directory name.',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Optional runtime profile used to resolve default output root.',
          },
          out: {
            type: 'string',
            minLength: 1,
            description: 'Optional output root override containing analyze artifacts.',
          },
          output: {
            type: 'string',
            minLength: 1,
            description: 'Optional alias for out.',
          },
        },
      },
    },
    {
      name: 'zeus.impact',
      description: 'Computes reverse impact from existing analyze graph artifacts (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['target'],
        properties: {
          target: {
            type: 'string',
            minLength: 1,
            description: 'Target node identifier (program/table/field) used for impact analysis.',
          },
          program: {
            type: 'string',
            minLength: 1,
            description: 'Optional analyzed program output directory name for graph disambiguation.',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Optional runtime profile used to resolve default output root.',
          },
          out: {
            type: 'string',
            minLength: 1,
            description: 'Optional output root override containing analyze artifacts.',
          },
          output: {
            type: 'string',
            minLength: 1,
            description: 'Optional alias for out.',
          },
          maxItems: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_MCP_PAYLOAD_ITEMS,
            description: 'Optional cap for returned impact arrays (programs/callers).',
          },
          cursor: {
            type: 'string',
            minLength: 1,
            description: 'Optional pagination cursor returned by a previous zeus.impact call.',
          },
        },
      },
    },
    {
      name: 'zeus.query-table',
      description: 'Returns read-only table and column metadata for a profile/table lookup.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['profile', 'table'],
        properties: {
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Runtime profile name with DB2 read access.',
          },
          table: {
            type: 'string',
            minLength: 1,
            description: 'Table name to inspect.',
          },
          schema: {
            type: 'string',
            minLength: 1,
            description: 'Optional schema override.',
          },
          filter: {
            type: 'string',
            minLength: 1,
            description: 'Optional SQL LIKE pattern for column name filtering.',
          },
        },
      },
    },
    {
      name: 'zeus.query-sql',
      description: 'Executes a strict read-only SQL query for a profile and returns structured rows.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['profile', 'sql'],
        properties: {
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Runtime profile name with DB2 read access.',
          },
          sql: {
            type: 'string',
            minLength: 1,
            description: 'Read-only SQL statement (SELECT/WITH only).',
          },
          maxRows: {
            type: 'integer',
            minimum: 1,
            description: 'Maximum number of rows to return.',
          },
          defaultSchema: {
            type: 'string',
            minLength: 1,
            description: 'Optional default schema override.',
          },
          liblist: {
            type: 'string',
            minLength: 1,
            description: 'Optional comma-separated library list override.',
          },
        },
      },
    },
    {
      name: 'zeus.search-source',
      description: 'Searches local source files for term/member/table matches (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceRoot'],
        properties: {
          sourceRoot: {
            type: 'string',
            minLength: 1,
            description: 'Local source root path to scan.',
          },
          searchTerm: {
            type: 'string',
            minLength: 1,
            description: 'Free-text search term.',
          },
          member: {
            type: 'string',
            minLength: 1,
            description: 'Member name search criterion.',
          },
          table: {
            type: 'string',
            minLength: 1,
            description: 'Table-oriented SQL usage search criterion.',
          },
          filePattern: {
            type: 'string',
            minLength: 1,
            description: 'Optional glob pattern (for example *.rpgle).',
          },
          maxResults: {
            type: 'integer',
            minimum: 1,
            description: 'Maximum number of matches to return.',
          },
          maxPayloadItems: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_MCP_PAYLOAD_ITEMS,
            description: 'Optional cap for returned match entries in MCP payload.',
          },
          cursor: {
            type: 'string',
            minLength: 1,
            description: 'Optional pagination cursor returned by a previous zeus.search-source call.',
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Use case-sensitive matching when true.',
          },
        },
      },
    },
  ];
}

function executeReadOnlyImpact(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const target = args && typeof args.target === 'string'
    ? args.target.trim()
    : '';
  if (!target) {
    const error = new Error('Invalid arguments for zeus.impact: target is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const profile = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  const program = args && typeof args.program === 'string'
    ? args.program.trim()
    : '';
  const out = args && typeof args.out === 'string' && args.out.trim()
    ? args.out.trim()
    : (args && typeof args.output === 'string' && args.output.trim() ? args.output.trim() : '');

  const runnerArgs = {
    target,
    ...(profile ? { profile } : {}),
    ...(program ? { program } : {}),
    ...(out ? { out } : {}),
  };
  const config = resolveAnalyzeConfig(runnerArgs, { cwd });
  const outputRoot = path.resolve(cwd, config.outputRoot);
  const resolvedGraph = findImpactGraph({
    outputRoot,
    target,
    ...(program ? { program } : {}),
  });
  const graph = JSON.parse(fs.readFileSync(resolvedGraph.graphPath, 'utf8'));
  const result = analyzeImpactFromGraph(graph, target);

  return {
    profile: profile || null,
    target: normalizeId(target),
    program: resolvedGraph.program,
    graphPath: resolvedGraph.graphPath,
    outputProgramDir: resolvedGraph.outputProgramDir,
    result,
  };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function executeReadOnlyAnalyze(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const program = args && typeof args.program === 'string'
    ? args.program.trim()
    : '';
  if (!program) {
    const error = new Error('Invalid arguments for zeus.analyze: program is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const profile = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  const out = args && typeof args.out === 'string' && args.out.trim()
    ? args.out.trim()
    : (args && typeof args.output === 'string' && args.output.trim() ? args.output.trim() : '');

  const config = resolveAnalyzeConfig({
    ...(profile ? { profile } : {}),
    ...(out ? { out } : {}),
  }, { cwd });
  const outputRoot = path.resolve(cwd, config.outputRoot);
  const normalizedProgram = normalizeId(program);
  const outputProgramDir = path.join(outputRoot, normalizedProgram);
  if (!fs.existsSync(outputProgramDir)) {
    throw new Error(`Analyze output not found: ${outputProgramDir}. Run analyze first.`);
  }

  const manifest = readAnalyzeRunManifest(outputProgramDir);
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Analyze run manifest not found: ${path.join(outputProgramDir, 'analyze-run-manifest.json')}`);
  }

  const analysisIndexPath = path.join(outputProgramDir, 'analysis-index.json');
  const graphPath = path.join(outputProgramDir, 'program-call-tree.json');
  const analysisIndex = fs.existsSync(analysisIndexPath)
    ? readJsonFile(analysisIndexPath)
    : null;
  const graph = fs.existsSync(graphPath)
    ? readJsonFile(graphPath)
    : null;
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const summary = manifest.summary && typeof manifest.summary === 'object'
    ? manifest.summary
    : {};
  const graphSummary = graph && graph.summary && typeof graph.summary === 'object'
    ? graph.summary
    : {};

  return {
    profile: profile || null,
    program: normalizedProgram,
    status: manifest.run && manifest.run.status ? String(manifest.run.status) : 'unknown',
    completedAt: manifest.run && manifest.run.completedAt ? String(manifest.run.completedAt) : null,
    durationMs: Number(manifest.run && manifest.run.durationMs ? manifest.run.durationMs : 0),
    reproducible: Boolean(manifest.run && manifest.run.reproducible),
    summary: {
      stageCount: Number(summary.stageCount || 0),
      completedStageCount: Number(summary.completedStageCount || 0),
      failedStageCount: Number(summary.failedStageCount || 0),
      diagnosticCount: Number(summary.diagnosticCount || 0),
      errorCount: Number(summary.errorCount || 0),
      warningCount: Number(summary.warningCount || 0),
      generatedArtifactCount: Number(summary.generatedArtifactCount || 0),
      sourceFileCount: Number(summary.sourceFileCount || 0),
    },
    artifacts: {
      count: artifacts.length,
      files: artifacts
        .map((artifact) => String(artifact && artifact.path ? artifact.path : ''))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    },
    analysisIndex: {
      available: Boolean(analysisIndex),
      selectedMode: analysisIndex && analysisIndex.selectedMode ? String(analysisIndex.selectedMode) : null,
      selectedPreset: analysisIndex && analysisIndex.selectedPreset ? String(analysisIndex.selectedPreset) : null,
      taskCount: Array.isArray(analysisIndex && analysisIndex.tasks) ? analysisIndex.tasks.length : 0,
      guidedModeCount: Array.isArray(analysisIndex && analysisIndex.guidedModes) ? analysisIndex.guidedModes.length : 0,
    },
    graph: {
      available: Boolean(graph),
      nodeCount: Number(graphSummary.nodeCount || 0),
      edgeCount: Number(graphSummary.edgeCount || 0),
      programCount: Number(graphSummary.programCount || 0),
      tableCount: Number(graphSummary.tableCount || 0),
    },
  };
}

function executeReadOnlyBundle(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const program = args && typeof args.program === 'string'
    ? args.program.trim()
    : '';
  if (!program) {
    const error = new Error('Invalid arguments for zeus.bundle: program is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const profile = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  const sourceOutputRoot = args && typeof args.sourceOutputRoot === 'string' && args.sourceOutputRoot.trim()
    ? args.sourceOutputRoot.trim()
    : (args && typeof args['source-output-root'] === 'string' && args['source-output-root'].trim()
      ? args['source-output-root'].trim()
      : '');
  const bundleOutputRoot = args && typeof args.output === 'string' && args.output.trim()
    ? args.output.trim()
    : (args && typeof args.out === 'string' && args.out.trim() ? args.out.trim() : '');

  const config = resolveAnalyzeConfig({
    ...(profile ? { profile } : {}),
    ...(sourceOutputRoot ? { out: sourceOutputRoot } : {}),
  }, { cwd });

  const normalizedProgram = normalizeId(program);
  const resolvedSourceOutputRoot = path.resolve(cwd, config.outputRoot);
  const outputProgramDir = path.join(resolvedSourceOutputRoot, normalizedProgram);
  if (!fs.existsSync(outputProgramDir)) {
    throw new Error(`Bundle source program output not found: ${outputProgramDir}. Run analyze first.`);
  }

  const bundleManifestPath = path.join(outputProgramDir, 'bundle-manifest.json');
  if (!fs.existsSync(bundleManifestPath)) {
    throw new Error(`Bundle manifest not found: ${bundleManifestPath}. Run bundle first.`);
  }

  const manifest = readJsonFile(bundleManifestPath);
  const files = Array.isArray(manifest && manifest.files) ? manifest.files : [];
  const artifacts = Array.isArray(manifest && manifest.artifacts) ? manifest.artifacts : [];
  const summary = manifest && manifest.summary && typeof manifest.summary === 'object'
    ? manifest.summary
    : {};
  const safeSharing = manifest && manifest.safeSharing && typeof manifest.safeSharing === 'object'
    ? manifest.safeSharing
    : {};
  const analyzeRun = manifest && manifest.analyzeRun && typeof manifest.analyzeRun === 'object'
    ? manifest.analyzeRun
    : null;
  const sourceProvenance = manifest && manifest.sourceProvenance && typeof manifest.sourceProvenance === 'object'
    ? manifest.sourceProvenance
    : null;

  const resolvedBundleOutputRoot = bundleOutputRoot
    ? path.resolve(cwd, bundleOutputRoot)
    : path.resolve(cwd, 'bundles');
  const analysisBundleFileName = `${normalizedProgram}-analysis-bundle.zip`;
  const safeSharingBundleFileName = `${normalizedProgram}-safe-sharing-bundle.zip`;
  const analysisBundlePath = path.join(resolvedBundleOutputRoot, analysisBundleFileName);
  const safeSharingBundlePath = path.join(resolvedBundleOutputRoot, safeSharingBundleFileName);

  return {
    profile: profile || null,
    program: normalizedProgram,
    manifest: {
      schemaVersion: Number(manifest && manifest.schemaVersion ? manifest.schemaVersion : 0),
      generatedAt: manifest && manifest.generatedAt ? String(manifest.generatedAt) : null,
      summary: {
        totalFiles: Number(summary.totalFiles || 0),
        totalSizeBytes: Number(summary.totalSizeBytes || 0),
        jsonFiles: Number(summary.jsonFiles || 0),
        markdownFiles: Number(summary.markdownFiles || 0),
        htmlFiles: Number(summary.htmlFiles || 0),
      },
      safeSharing: {
        enabled: Boolean(safeSharing.enabled),
        sourceDir: safeSharing.sourceDir ? String(safeSharing.sourceDir) : null,
        redactionManifestFile: safeSharing.redactionManifestFile ? String(safeSharing.redactionManifestFile) : null,
      },
    },
    files: {
      count: files.length,
      paths: files.map((entry) => String(entry)).sort((left, right) => left.localeCompare(right)),
    },
    artifacts: {
      count: artifacts.length,
      totalSizeBytes: artifacts.reduce((sum, artifact) => (
        sum + Number(artifact && artifact.sizeBytes ? artifact.sizeBytes : 0)
      ), 0),
      kinds: artifacts.reduce((counts, artifact) => {
        const kind = artifact && artifact.kind ? String(artifact.kind) : 'unknown';
        counts[kind] = (counts[kind] || 0) + 1;
        return counts;
      }, {}),
    },
    analyzeRun: {
      available: Boolean(analyzeRun),
      status: analyzeRun && analyzeRun.status ? String(analyzeRun.status) : null,
      completedAt: analyzeRun && analyzeRun.completedAt ? String(analyzeRun.completedAt) : null,
      artifactCount: Number(analyzeRun && analyzeRun.artifactCount ? analyzeRun.artifactCount : 0),
    },
    sourceProvenance: {
      available: Boolean(sourceProvenance),
      sourceLib: sourceProvenance && sourceProvenance.sourceLib ? String(sourceProvenance.sourceLib) : null,
      transportUsed: sourceProvenance && sourceProvenance.transportUsed ? String(sourceProvenance.transportUsed) : null,
      fileCount: Number(sourceProvenance && sourceProvenance.fileCount ? sourceProvenance.fileCount : 0),
      exportedFileCount: Number(sourceProvenance && sourceProvenance.exportedFileCount ? sourceProvenance.exportedFileCount : 0),
      failedFileCount: Number(sourceProvenance && sourceProvenance.failedFileCount ? sourceProvenance.failedFileCount : 0),
      traceableFileCount: Number(sourceProvenance && sourceProvenance.traceableFileCount ? sourceProvenance.traceableFileCount : 0),
    },
    bundleOutputs: {
      root: resolvedBundleOutputRoot,
      analysisBundleFile: analysisBundleFileName,
      analysisBundleExists: fs.existsSync(analysisBundlePath),
      safeSharingBundleFile: safeSharingBundleFileName,
      safeSharingBundleExists: fs.existsSync(safeSharingBundlePath),
    },
  };
}

function executeReadOnlyWorkflow(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const program = args && typeof args.program === 'string'
    ? args.program.trim()
    : '';
  if (!program) {
    const error = new Error('Invalid arguments for zeus.workflow: program is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const profile = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  const out = args && typeof args.out === 'string' && args.out.trim()
    ? args.out.trim()
    : (args && typeof args.output === 'string' && args.output.trim() ? args.output.trim() : '');

  const config = resolveAnalyzeConfig({
    ...(profile ? { profile } : {}),
    ...(out ? { out } : {}),
  }, { cwd });

  const normalizedProgram = normalizeId(program);
  const outputRoot = path.resolve(cwd, config.outputRoot);
  const outputProgramDir = path.join(outputRoot, normalizedProgram);
  if (!fs.existsSync(outputProgramDir)) {
    throw new Error(`Workflow source program output not found: ${outputProgramDir}. Run analyze/workflow first.`);
  }

  const workflowManifestPath = path.join(outputProgramDir, WORKFLOW_RUN_MANIFEST_FILE);
  if (!fs.existsSync(workflowManifestPath)) {
    throw new Error(`Workflow run manifest not found: ${workflowManifestPath}. Run workflow first.`);
  }

  const manifest = readJsonFile(workflowManifestPath);
  const preset = manifest && manifest.preset && typeof manifest.preset === 'object'
    ? manifest.preset
    : null;
  const reviewWorkflow = preset && preset.reviewWorkflow && typeof preset.reviewWorkflow === 'object'
    ? preset.reviewWorkflow
    : null;
  const analyzeRun = manifest && manifest.analyzeRun && typeof manifest.analyzeRun === 'object'
    ? manifest.analyzeRun
    : null;
  const bundle = manifest && manifest.bundle && typeof manifest.bundle === 'object'
    ? manifest.bundle
    : null;
  const reproducibility = manifest && manifest.reproducibility && typeof manifest.reproducibility === 'object'
    ? manifest.reproducibility
    : null;

  return {
    profile: profile || null,
    program: normalizedProgram,
    schemaVersion: Number(manifest && manifest.schemaVersion ? manifest.schemaVersion : 0),
    kind: manifest && manifest.kind ? String(manifest.kind) : null,
    generatedAt: manifest && manifest.generatedAt ? String(manifest.generatedAt) : null,
    preset: {
      available: Boolean(preset),
      name: preset && preset.name ? String(preset.name) : null,
      title: preset && preset.title ? String(preset.title) : null,
      analyzeMode: preset && preset.analyzeMode ? String(preset.analyzeMode) : null,
      promptTemplateCount: Array.isArray(preset && preset.promptTemplates) ? preset.promptTemplates.length : 0,
      workflowKeyCount: Array.isArray(preset && preset.workflowKeys) ? preset.workflowKeys.length : 0,
      bundleArtifactCount: Array.isArray(preset && preset.bundleArtifacts) ? preset.bundleArtifacts.length : 0,
      reviewWorkflow: {
        intendedAudienceCount: Array.isArray(reviewWorkflow && reviewWorkflow.intendedAudience)
          ? reviewWorkflow.intendedAudience.length
          : 0,
        keyQuestionsAnsweredCount: Array.isArray(reviewWorkflow && reviewWorkflow.keyQuestionsAnswered)
          ? reviewWorkflow.keyQuestionsAnswered.length
          : 0,
        expectedDecisionsCount: Array.isArray(reviewWorkflow && reviewWorkflow.expectedDecisions)
          ? reviewWorkflow.expectedDecisions.length
          : 0,
      },
    },
    analyzeRun: {
      available: Boolean(analyzeRun),
      status: analyzeRun && analyzeRun.status ? String(analyzeRun.status) : null,
      completedAt: analyzeRun && analyzeRun.completedAt ? String(analyzeRun.completedAt) : null,
      generatedArtifactCount: Number(analyzeRun && analyzeRun.generatedArtifactCount ? analyzeRun.generatedArtifactCount : 0),
      safeSharingEnabled: Boolean(analyzeRun && analyzeRun.safeSharingEnabled),
      guidedModeName: analyzeRun && analyzeRun.guidedMode && typeof analyzeRun.guidedMode === 'object' && analyzeRun.guidedMode.name
        ? String(analyzeRun.guidedMode.name)
        : null,
    },
    bundle: {
      available: Boolean(bundle),
      zipPath: bundle && bundle.zipPath ? String(bundle.zipPath) : null,
      totalFiles: Number(bundle && bundle.totalFiles ? bundle.totalFiles : 0),
      totalSizeBytes: Number(bundle && bundle.totalSizeBytes ? bundle.totalSizeBytes : 0),
    },
    reproducibility: {
      available: Boolean(reproducibility),
      enabled: Boolean(reproducibility && reproducibility.enabled),
      contentFingerprint: reproducibility && reproducibility.contentFingerprint
        ? String(reproducibility.contentFingerprint)
        : null,
    },
  };
}

async function executeReadOnlyJoblog(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const profile = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  if (!profile) {
    const error = new Error('Invalid arguments for zeus.joblog: profile is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  let severity;
  let maxMessages;
  try {
    severity = normalizeSeverity(args && args.severity !== undefined ? args.severity : null);
    maxMessages = parseMaxMessages(args && args.maxMessages !== undefined ? args.maxMessages : undefined);
  } catch (error) {
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  const jobName = args && typeof args.job === 'string'
    ? args.job.trim().toUpperCase()
    : '';

  const config = resolveAnalyzeConfig({ profile }, { cwd });
  const dbConfig = resolveAnalyzeDbConfig(config, 'metadata');
  if (!isDbConfigured(dbConfig)) {
    const error = new Error('DB2 connection configuration is incomplete for the selected profile.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const whereClauses = [];
  if (jobName) {
    whereClauses.push(`JOB_NAME LIKE ${escapeSqlLiteral(`${jobName}%`)}`);
  }
  if (severity) {
    whereClauses.push(`MESSAGE_TYPE = ${escapeSqlLiteral(severity)}`);
  }
  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const query = `
    SELECT
      JOB_NAME,
      MESSAGE_ID,
      MESSAGE_TYPE,
      MESSAGE_TEXT,
      MESSAGE_TIMESTAMP
    FROM QSYS2.JOBLOG_INFO
    ${whereClause}
    ORDER BY MESSAGE_TIMESTAMP DESC
    FETCH FIRST ${maxMessages} ROWS ONLY
  `;

  try {
    const result = runReadOnlyDb2Query({
      dbConfig,
      query,
      maxRows: maxMessages,
    });
    return summarizeJoblogRows({
      profile,
      jobName,
      severity,
      maxMessages,
      result,
      backend: 'JOBLOG_INFO',
    });
  } catch (error) {
    if (!isJoblogInfoUnavailableError(error)) {
      throw error;
    }

    try {
      const fallbackResult = runReadOnlyDb2Query({
        dbConfig,
        query: buildHistoryLogFallbackQuery({ jobName, severity, maxMessages }),
        maxRows: maxMessages,
      });
      return summarizeJoblogRows({
        profile,
        jobName,
        severity,
        maxMessages,
        result: fallbackResult,
        backend: 'HISTORY_LOG_INFO',
      });
    } catch (fallbackError) {
      throw normalizeJoblogToolError(fallbackError);
    }
  }
}

function buildInspectObjectStatisticsQuery(lib, name, type, { journalOnly = false } = {}) {
  const libLiteral = escapeSqlLiteral(lib.toUpperCase());
  const nameLiteral = escapeSqlLiteral(name.toUpperCase());
  const typeLiteral = escapeSqlLiteral(type.toUpperCase());
  if (journalOnly) {
    return `SELECT
      OBJNAME AS NAME,
      OBJLIB AS LIBRARY,
      OBJTYPE AS TYPE,
      JOURNALED,
      JOURNAL_NAME,
      JOURNAL_LIBRARY AS JOURNAL_LIB,
      JOURNAL_IMAGES
    FROM TABLE(QSYS2.OBJECT_STATISTICS(${libLiteral}, ${typeLiteral}, ${nameLiteral})) AS X`;
  }

  return `SELECT
    OBJNAME AS NAME,
    OBJTYPE AS TYPE,
    OBJLIB AS LIBRARY,
    OBJATTRIBUTE AS ATTRIBUTE,
    OBJOWNER AS OWNER,
    OBJDEFINER AS DEFINER,
    OBJCREATED AS CREATED,
    CHANGE_TIMESTAMP AS LAST_CHANGED,
    LAST_USED_TIMESTAMP AS LAST_USED,
    OBJTEXT AS TEXT,
    SOURCE_FILE AS SRC_FILE,
    SOURCE_LIBRARY AS SRC_LIB,
    SOURCE_MEMBER AS SRC_MEMBER,
    SOURCE_TIMESTAMP AS SRC_TIMESTAMP,
    COMPILER AS COMPILER,
    COMPILER_VERSION AS COMPILER_VERSION,
    JOURNALED,
    JOURNAL_NAME,
    JOURNAL_LIBRARY AS JOURNAL_LIB,
    JOURNAL_IMAGES,
    OBJSIZE AS SIZE_BYTES,
    SQL_OBJECT_TYPE AS SQL_TYPE
  FROM TABLE(QSYS2.OBJECT_STATISTICS(${libLiteral}, ${typeLiteral}, ${nameLiteral})) AS X`;
}

async function executeReadOnlyInspectObject(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const profile = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  const lib = args && typeof args.lib === 'string'
    ? args.lib.trim().toUpperCase()
    : '';
  const name = args && typeof args.name === 'string'
    ? args.name.trim().toUpperCase()
    : '';
  const type = args && typeof args.type === 'string' && args.type.trim()
    ? args.type.trim().toUpperCase()
    : '*PGM';
  const journalOnly = Boolean(args && args.journalOnly === true);

  if (!profile) {
    const error = new Error('Invalid arguments for zeus.inspect-object: profile is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (!lib) {
    const error = new Error('Invalid arguments for zeus.inspect-object: lib is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (!name) {
    const error = new Error('Invalid arguments for zeus.inspect-object: name is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (!SUPPORTED_INSPECT_OBJECT_TYPES.includes(type)) {
    const error = new Error(`Invalid arguments for zeus.inspect-object: type must be one of ${SUPPORTED_INSPECT_OBJECT_TYPES.join(', ')}.`);
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  validateSqlIdentifier(lib, '--lib');
  validateSqlIdentifier(name, '--name');

  const config = resolveAnalyzeConfig({ profile }, { cwd });
  const dbConfig = resolveAnalyzeDbConfig(config, 'metadata');
  if (!isDbConfigured(dbConfig)) {
    const error = new Error('DB2 connection configuration is incomplete for the selected profile.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const query = buildInspectObjectStatisticsQuery(lib, name, type, { journalOnly });
  const result = runReadOnlyDb2Query({
    dbConfig,
    query,
    maxRows: 20,
  });
  const rows = Array.isArray(result && result.rows) ? result.rows : [];
  const columns = Array.isArray(result && result.columns) ? result.columns : [];

  return {
    profile,
    lib,
    name,
    type,
    journalOnly,
    rowCount: rows.length,
    columns,
    rows,
  };
}

async function executeReadOnlyAssessRisk(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const program = args && typeof args.program === 'string'
    ? args.program.trim().toUpperCase()
    : '';
  if (!program) {
    const error = new Error('Invalid arguments for zeus.assess-risk: program is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const profile = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  const out = args && typeof args.out === 'string' && args.out.trim()
    ? args.out.trim()
    : (args && typeof args.output === 'string' && args.output.trim() ? args.output.trim() : '');
  const maxAccessPoints = parseOptionalPositiveInteger(args && args.maxAccessPoints, {
    label: 'zeus.assess-risk maxAccessPoints',
    min: 1,
  });
  const maxCriticalPaths = parseOptionalPositiveInteger(args && args.maxCriticalPaths, {
    label: 'zeus.assess-risk maxCriticalPaths',
    min: 1,
  });

  const config = resolveAnalyzeConfig({
    ...(profile ? { profile } : {}),
    ...(out ? { out } : {}),
  }, { cwd });
  const outputRoot = path.resolve(cwd, config.outputRoot);
  const programDir = path.join(outputRoot, program);
  const analysisPath = path.join(programDir, 'canonical-analysis.json');
  if (!fs.existsSync(analysisPath)) {
    throw new Error(`Canonical analysis not found for program "${program}" at ${analysisPath}. Run analyze first.`);
  }

  const canonicalAnalysis = readJsonFile(analysisPath);
  const assessment = assessCanonicalModel(canonicalAnalysis, { verbose: false });
  const rawAccessPoints = Array.isArray(assessment && assessment.accessPoints) ? assessment.accessPoints : [];
  const rawCriticalPaths = Array.isArray(assessment && assessment.criticalPaths) ? assessment.criticalPaths : [];
  const accessLimit = Number.isInteger(maxAccessPoints) ? maxAccessPoints : 50;
  const criticalLimit = Number.isInteger(maxCriticalPaths) ? maxCriticalPaths : 25;
  const accessPoints = rawAccessPoints.slice(0, accessLimit);
  const criticalPaths = rawCriticalPaths.slice(0, criticalLimit);
  const riskMetrics = assessment && assessment.riskMetrics && typeof assessment.riskMetrics === 'object'
    ? assessment.riskMetrics
    : {};
  const summary = assessment && assessment.summary && typeof assessment.summary === 'object'
    ? assessment.summary
    : {};
  const recommendations = Array.isArray(assessment && assessment.recommendations)
    ? assessment.recommendations.map((entry) => String(entry))
    : [];

  return {
    profile: profile || null,
    program,
    summary: {
      riskLevel: summary.riskLevel ? String(summary.riskLevel) : 'UNKNOWN',
      distribution: summary.distribution ? String(summary.distribution) : '0🟢 / 0🟡 / 0🔴',
    },
    riskMetrics: {
      totalAccesses: Number(riskMetrics.totalAccesses || 0),
      greenCount: Number(riskMetrics.greenCount || 0),
      yellowCount: Number(riskMetrics.yellowCount || 0),
      redCount: Number(riskMetrics.redCount || 0),
    },
    recommendations,
    accessPoints: accessPoints.map((entry) => ({
      type: entry && entry.type ? String(entry.type) : '',
      subtype: entry && entry.subtype ? String(entry.subtype) : null,
      name: entry && entry.name ? String(entry.name) : null,
      intent: entry && entry.intent ? String(entry.intent) : null,
      tables: Array.isArray(entry && entry.tables) ? entry.tables.map((table) => String(table)) : [],
      assessment: entry && entry.assessment && typeof entry.assessment === 'object'
        ? {
          risk: entry.assessment.risk ? String(entry.assessment.risk) : 'UNKNOWN',
          score: Number(entry.assessment.score || 0),
          reason: entry.assessment.reason ? String(entry.assessment.reason) : null,
        }
        : { risk: 'UNKNOWN', score: 0, reason: null },
      evidenceCount: Array.isArray(entry && entry.evidence) ? entry.evidence.length : 0,
    })),
    criticalPaths: criticalPaths.map((entry) => ({
      type: entry && entry.type ? String(entry.type) : '',
      reason: entry && entry.reason ? String(entry.reason) : null,
      tables: Array.isArray(entry && entry.tables) ? entry.tables.map((table) => String(table)) : [],
      evidenceCount: Array.isArray(entry && entry.evidence) ? entry.evidence.length : 0,
    })),
    accessPointCount: rawAccessPoints.length,
    criticalPathCount: rawCriticalPaths.length,
    accessPointsTruncated: rawAccessPoints.length > accessLimit,
    criticalPathsTruncated: rawCriticalPaths.length > criticalLimit,
    maxAccessPoints: accessLimit,
    maxCriticalPaths: criticalLimit,
  };
}

async function executeReadOnlySearchSource(args = {}, context = {}) {
  const sourceRoot = args && typeof args.sourceRoot === 'string'
    ? args.sourceRoot.trim()
    : '';
  if (!sourceRoot) {
    const error = new Error('Invalid arguments for zeus.search-source: sourceRoot is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const searchTerm = args && typeof args.searchTerm === 'string'
    ? args.searchTerm.trim()
    : '';
  const member = args && typeof args.member === 'string'
    ? args.member.trim()
    : '';
  const table = args && typeof args.table === 'string'
    ? args.table.trim()
    : '';
  if (!searchTerm && !member && !table) {
    const error = new Error('Invalid arguments for zeus.search-source: provide searchTerm, member, or table.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  const maxPayloadItems = parseOptionalPositiveInteger(args && args.maxPayloadItems, {
    label: 'zeus.search-source maxPayloadItems',
    min: 1,
    max: MAX_MCP_PAYLOAD_ITEMS,
  });
  const cursorState = decodeMcpCursor('zeus.search-source', args && args.cursor, {
    allowLegacyNumericCursor: context.allowLegacyNumericCursor === true,
  });

  const execution = await executeSearchSource({
    'source-root': sourceRoot,
    ...(searchTerm ? { 'search-term': searchTerm } : {}),
    ...(member ? { member } : {}),
    ...(table ? { table } : {}),
    ...(args && typeof args.filePattern === 'string' && args.filePattern.trim()
      ? { 'file-pattern': args.filePattern.trim() }
      : {}),
    ...(args && args.maxResults !== undefined ? { 'max-results': args.maxResults } : {}),
    ...(args && args.caseSensitive === true ? { 'case-sensitive': 'true' } : {}),
    verbose: false,
  }, {
    cwd: context.cwd || process.cwd(),
  });

  const results = Array.isArray(execution && execution.results) ? execution.results : [];
  const sortedResults = results.slice().sort((left, right) => {
    if (String(left.file || '') !== String(right.file || '')) {
      return String(left.file || '').localeCompare(String(right.file || ''));
    }
    if (Number(left.lineNumber || 0) !== Number(right.lineNumber || 0)) {
      return Number(left.lineNumber || 0) - Number(right.lineNumber || 0);
    }
    return String(left.line || '').localeCompare(String(right.line || ''));
  });
  const payloadLimit = Number.isInteger(maxPayloadItems) ? maxPayloadItems : DEFAULT_MCP_PAYLOAD_ITEMS;
  const offset = cursorState.offset;
  if (!Number.isFinite(offset) || offset < 0 || offset > sortedResults.length) {
    throw createInvalidCursorError('zeus.search-source', 'cursor is outside available result range.');
  }
  const payloadResults = sortedResults.slice(offset, offset + payloadLimit);
  const nextOffset = offset + payloadResults.length;
  const nextCursor = nextOffset < sortedResults.length
    ? encodeMcpCursor('zeus.search-source', nextOffset)
    : null;
  const uniqueFiles = new Set(sortedResults.map((entry) => String(entry && entry.file ? entry.file : '')).filter(Boolean));
  const maxResults = Number(execution && execution.maxResults ? execution.maxResults : 0);

  return {
    sourceRoot,
    criteria: {
      searchTerm: searchTerm || null,
      member: member || null,
      table: table || null,
      filePattern: execution && execution.filePattern
        ? String(execution.filePattern)
        : normalizeFilePattern(args && args.filePattern ? String(args.filePattern) : ''),
      caseSensitive: Boolean(args && args.caseSensitive === true),
      maxResults,
    },
    noSourceFiles: Boolean(execution && execution.noSourceFiles),
    resultCount: sortedResults.length,
    cursor: cursorState.cursor,
    cursorOffset: offset,
    nextCursor,
    maxPayloadItems: payloadLimit,
    payloadResultCount: payloadResults.length,
    payloadTruncated: nextCursor !== null,
    matchedFileCount: uniqueFiles.size,
    limitReached: maxResults > 0 && sortedResults.length >= maxResults,
    matches: payloadResults.map((entry) => ({
      file: entry && entry.file ? String(entry.file) : '',
      lineNumber: Number(entry && entry.lineNumber ? entry.lineNumber : 0),
      line: entry && entry.line ? String(entry.line) : '',
    })),
  };
}

function parseOptionalPositiveInteger(value, { label, min = 1, max = null }) {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`Invalid arguments for ${label}: value must be an integer >= ${min}.`);
  }
  if (Number.isInteger(max) && parsed > max) {
    throw new Error(`Invalid arguments for ${label}: value must be an integer <= ${max}.`);
  }
  return parsed;
}

function loadTextFilesRecursive(sourceRoot) {
  const files = {};
  const stack = [sourceRoot];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relativePath = path.relative(sourceRoot, fullPath).replace(/\\/g, '/');
      try {
        files[relativePath] = fs.readFileSync(fullPath, 'utf8');
      } catch (_) {
        // Skip unreadable/binary files to keep behavior aligned with CLI command.
      }
    }
  }
  return files;
}

async function executeReadOnlyFieldSearch(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const sourceRootArg = args && typeof args.sourceRoot === 'string'
    ? args.sourceRoot.trim()
    : '';
  const field = args && typeof args.field === 'string'
    ? args.field.trim()
    : '';
  if (!sourceRootArg) {
    const error = new Error('Invalid arguments for zeus.field-search: sourceRoot is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (!field) {
    const error = new Error('Invalid arguments for zeus.field-search: field is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const sourceRoot = path.resolve(cwd, sourceRootArg);
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Field-search source root not found: ${sourceRoot}`);
  }

  const maxResults = parseOptionalPositiveInteger(args && args.maxResults, {
    label: 'zeus.field-search maxResults',
    min: 1,
  });
  const maxPayloadItems = parseOptionalPositiveInteger(args && args.maxPayloadItems, {
    label: 'zeus.field-search maxPayloadItems',
    min: 1,
    max: MAX_MCP_PAYLOAD_ITEMS,
  });
  const cursorState = decodeMcpCursor('zeus.field-search', args && args.cursor, {
    allowLegacyNumericCursor: context.allowLegacyNumericCursor === true,
  });
  const contextLines = parseOptionalPositiveInteger(args && args.contextLines, {
    label: 'zeus.field-search contextLines',
    min: 0,
  });
  const table = args && typeof args.table === 'string'
    ? args.table.trim()
    : '';

  const sourceFiles = loadTextFilesRecursive(sourceRoot);
  const localResult = searchLocalSources(sourceFiles, {
    field,
    ...(table ? { table } : {}),
    ...(Number.isInteger(maxResults) ? { maxResults } : {}),
    ...(Number.isInteger(contextLines) ? { contextLines } : {}),
  });
  const matches = Array.isArray(localResult && localResult.matches) ? localResult.matches : [];
  const sortedMatches = matches.slice().sort((left, right) => {
    if (String(left.file || '') !== String(right.file || '')) {
      return String(left.file || '').localeCompare(String(right.file || ''));
    }
    if (Number(left.line || 0) !== Number(right.line || 0)) {
      return Number(left.line || 0) - Number(right.line || 0);
    }
    return String(left.text || '').localeCompare(String(right.text || ''));
  });
  const payloadLimit = Number.isInteger(maxPayloadItems) ? maxPayloadItems : DEFAULT_MCP_PAYLOAD_ITEMS;
  const offset = cursorState.offset;
  if (!Number.isFinite(offset) || offset < 0 || offset > sortedMatches.length) {
    throw createInvalidCursorError('zeus.field-search', 'cursor is outside available result range.');
  }
  const payloadMatches = sortedMatches.slice(offset, offset + payloadLimit);
  const nextOffset = offset + payloadMatches.length;
  const nextCursor = nextOffset < sortedMatches.length
    ? encodeMcpCursor('zeus.field-search', nextOffset)
    : null;
  const uniqueFiles = new Set(sortedMatches.map((entry) => String(entry && entry.file ? entry.file : '')).filter(Boolean));

  return {
    sourceRoot,
    field: localResult && localResult.field ? String(localResult.field) : field.toUpperCase(),
    table: localResult && localResult.table ? String(localResult.table) : (table ? table.toUpperCase() : null),
    maxResults: Number.isInteger(maxResults) ? maxResults : 300,
    cursor: cursorState.cursor,
    cursorOffset: offset,
    nextCursor,
    maxPayloadItems: payloadLimit,
    contextLines: Number.isInteger(contextLines) ? contextLines : 2,
    fileCount: Object.keys(sourceFiles).length,
    resultCount: sortedMatches.length,
    payloadResultCount: payloadMatches.length,
    payloadTruncated: nextCursor !== null,
    matchedFileCount: uniqueFiles.size,
    truncated: Boolean(localResult && localResult.truncated),
    matches: payloadMatches.map((entry) => ({
      file: entry && entry.file ? String(entry.file) : '',
      line: Number(entry && entry.line ? entry.line : 0),
      text: entry && entry.text ? String(entry.text) : '',
      tableContexts: Array.isArray(entry && entry.tableContexts)
        ? entry.tableContexts.map((contextEntry) => ({
          table: contextEntry && contextEntry.table ? String(contextEntry.table) : '',
          intent: contextEntry && contextEntry.intent ? String(contextEntry.intent) : '',
          role: contextEntry && contextEntry.role ? String(contextEntry.role) : '',
        }))
        : [],
      contextBefore: Array.isArray(entry && entry.contextBefore)
        ? entry.contextBefore.map((contextEntry) => ({
          lineNo: Number(contextEntry && contextEntry.lineNo ? contextEntry.lineNo : 0),
          text: contextEntry && contextEntry.text ? String(contextEntry.text) : '',
        }))
        : [],
      contextAfter: Array.isArray(entry && entry.contextAfter)
        ? entry.contextAfter.map((contextEntry) => ({
          lineNo: Number(contextEntry && contextEntry.lineNo ? contextEntry.lineNo : 0),
          text: contextEntry && contextEntry.text ? String(contextEntry.text) : '',
        }))
        : [],
    })),
  };
}

async function executeMcpToolCall(name, args = {}, context = {}) {
  if (name === 'zeus.health') {
    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      mode: 'local-only',
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.version') {
    const includeNode = args && args.includeNode === true;
    const payload = {
      ok: true,
      service: 'zeus-rpg-promptkit',
      version: readPackageVersion(context.cwd || process.cwd()),
      protocol: 'mcp',
      timestamp: new Date().toISOString(),
    };
    if (includeNode) {
      payload.node = process.version;
    }
    return payload;
  }

  if (name === 'zeus.workflow') {
    const workflowRunner = typeof context.workflowRunner === 'function'
      ? context.workflowRunner
      : executeReadOnlyWorkflow;

    let execution;
    try {
      execution = workflowRunner(args, {
        cwd: context.cwd || process.cwd(),
      });
    } catch (error) {
      const invalidArgCodes = new Set([
        'PROGRAM_REQUIRED',
      ]);
      if (
        (error && error.code && invalidArgCodes.has(error.code))
        || /invalid arguments for zeus\.workflow/i.test(String(error && error.message ? error.message : ''))
        || /missing required option: --program/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
        || /analyze\.outputRoot must be a string/i.test(String(error && error.message ? error.message : ''))
        || /workflow source program output not found:/i.test(String(error && error.message ? error.message : ''))
        || /workflow run manifest not found:/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    const preset = execution && execution.preset && typeof execution.preset === 'object'
      ? execution.preset
      : {};
    const reviewWorkflow = preset && preset.reviewWorkflow && typeof preset.reviewWorkflow === 'object'
      ? preset.reviewWorkflow
      : {};
    const analyzeRun = execution && execution.analyzeRun && typeof execution.analyzeRun === 'object'
      ? execution.analyzeRun
      : {};
    const bundle = execution && execution.bundle && typeof execution.bundle === 'object'
      ? execution.bundle
      : {};
    const reproducibility = execution && execution.reproducibility && typeof execution.reproducibility === 'object'
      ? execution.reproducibility
      : {};

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      profile: execution && typeof execution.profile === 'string' ? execution.profile : null,
      program: execution && execution.program ? String(execution.program) : '',
      schemaVersion: Number(execution && execution.schemaVersion ? execution.schemaVersion : 0),
      kind: execution && execution.kind ? String(execution.kind) : null,
      generatedAt: execution && execution.generatedAt ? String(execution.generatedAt) : null,
      preset: {
        available: Boolean(preset.available),
        name: preset.name ? String(preset.name) : null,
        title: preset.title ? String(preset.title) : null,
        analyzeMode: preset.analyzeMode ? String(preset.analyzeMode) : null,
        promptTemplateCount: Number(preset.promptTemplateCount || 0),
        workflowKeyCount: Number(preset.workflowKeyCount || 0),
        bundleArtifactCount: Number(preset.bundleArtifactCount || 0),
        reviewWorkflow: {
          intendedAudienceCount: Number(reviewWorkflow.intendedAudienceCount || 0),
          keyQuestionsAnsweredCount: Number(reviewWorkflow.keyQuestionsAnsweredCount || 0),
          expectedDecisionsCount: Number(reviewWorkflow.expectedDecisionsCount || 0),
        },
      },
      analyzeRun: {
        available: Boolean(analyzeRun.available),
        status: analyzeRun.status ? String(analyzeRun.status) : null,
        completedAt: analyzeRun.completedAt ? String(analyzeRun.completedAt) : null,
        generatedArtifactCount: Number(analyzeRun.generatedArtifactCount || 0),
        safeSharingEnabled: Boolean(analyzeRun.safeSharingEnabled),
        guidedModeName: analyzeRun.guidedModeName ? String(analyzeRun.guidedModeName) : null,
      },
      bundle: {
        available: Boolean(bundle.available),
        zipPath: bundle.zipPath ? String(bundle.zipPath) : null,
        totalFiles: Number(bundle.totalFiles || 0),
        totalSizeBytes: Number(bundle.totalSizeBytes || 0),
      },
      reproducibility: {
        available: Boolean(reproducibility.available),
        enabled: Boolean(reproducibility.enabled),
        contentFingerprint: reproducibility.contentFingerprint ? String(reproducibility.contentFingerprint) : null,
      },
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.bundle') {
    const bundleRunner = typeof context.bundleRunner === 'function'
      ? context.bundleRunner
      : executeReadOnlyBundle;

    let execution;
    try {
      execution = bundleRunner(args, {
        cwd: context.cwd || process.cwd(),
      });
    } catch (error) {
      const invalidArgCodes = new Set([
        'PROGRAM_REQUIRED',
      ]);
      if (
        (error && error.code && invalidArgCodes.has(error.code))
        || /invalid arguments for zeus\.bundle/i.test(String(error && error.message ? error.message : ''))
        || /missing required option: --program/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
        || /analyze\.outputRoot must be a string/i.test(String(error && error.message ? error.message : ''))
        || /bundle source program output not found:/i.test(String(error && error.message ? error.message : ''))
        || /bundle manifest not found:/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    const manifest = execution && execution.manifest && typeof execution.manifest === 'object'
      ? execution.manifest
      : {};
    const manifestSummary = manifest && manifest.summary && typeof manifest.summary === 'object'
      ? manifest.summary
      : {};
    const manifestSafeSharing = manifest && manifest.safeSharing && typeof manifest.safeSharing === 'object'
      ? manifest.safeSharing
      : {};
    const files = execution && execution.files && typeof execution.files === 'object'
      ? execution.files
      : {};
    const artifacts = execution && execution.artifacts && typeof execution.artifacts === 'object'
      ? execution.artifacts
      : {};
    const artifactKinds = artifacts && artifacts.kinds && typeof artifacts.kinds === 'object'
      ? Object.entries(artifacts.kinds)
        .map(([kind, count]) => ({ kind: String(kind), count: Number(count || 0) }))
        .sort((left, right) => left.kind.localeCompare(right.kind))
      : [];
    const analyzeRun = execution && execution.analyzeRun && typeof execution.analyzeRun === 'object'
      ? execution.analyzeRun
      : {};
    const sourceProvenance = execution && execution.sourceProvenance && typeof execution.sourceProvenance === 'object'
      ? execution.sourceProvenance
      : {};
    const bundleOutputs = execution && execution.bundleOutputs && typeof execution.bundleOutputs === 'object'
      ? execution.bundleOutputs
      : {};

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      profile: execution && typeof execution.profile === 'string' ? execution.profile : null,
      program: execution && execution.program ? String(execution.program) : '',
      manifest: {
        schemaVersion: Number(manifest.schemaVersion || 0),
        generatedAt: manifest.generatedAt ? String(manifest.generatedAt) : null,
        summary: {
          totalFiles: Number(manifestSummary.totalFiles || 0),
          totalSizeBytes: Number(manifestSummary.totalSizeBytes || 0),
          jsonFiles: Number(manifestSummary.jsonFiles || 0),
          markdownFiles: Number(manifestSummary.markdownFiles || 0),
          htmlFiles: Number(manifestSummary.htmlFiles || 0),
        },
        safeSharing: {
          enabled: Boolean(manifestSafeSharing.enabled),
          sourceDir: manifestSafeSharing.sourceDir ? String(manifestSafeSharing.sourceDir) : null,
          redactionManifestFile: manifestSafeSharing.redactionManifestFile ? String(manifestSafeSharing.redactionManifestFile) : null,
        },
      },
      files: {
        count: Number(files.count || 0),
        paths: Array.isArray(files.paths) ? files.paths : [],
      },
      artifacts: {
        count: Number(artifacts.count || 0),
        totalSizeBytes: Number(artifacts.totalSizeBytes || 0),
        kinds: artifactKinds,
      },
      analyzeRun: {
        available: Boolean(analyzeRun.available),
        status: analyzeRun.status ? String(analyzeRun.status) : null,
        completedAt: analyzeRun.completedAt ? String(analyzeRun.completedAt) : null,
        artifactCount: Number(analyzeRun.artifactCount || 0),
      },
      sourceProvenance: {
        available: Boolean(sourceProvenance.available),
        sourceLib: sourceProvenance.sourceLib ? String(sourceProvenance.sourceLib) : null,
        transportUsed: sourceProvenance.transportUsed ? String(sourceProvenance.transportUsed) : null,
        fileCount: Number(sourceProvenance.fileCount || 0),
        exportedFileCount: Number(sourceProvenance.exportedFileCount || 0),
        failedFileCount: Number(sourceProvenance.failedFileCount || 0),
        traceableFileCount: Number(sourceProvenance.traceableFileCount || 0),
      },
      bundleOutputs: {
        root: bundleOutputs.root ? String(bundleOutputs.root) : null,
        analysisBundleFile: bundleOutputs.analysisBundleFile ? String(bundleOutputs.analysisBundleFile) : null,
        analysisBundleExists: Boolean(bundleOutputs.analysisBundleExists),
        safeSharingBundleFile: bundleOutputs.safeSharingBundleFile ? String(bundleOutputs.safeSharingBundleFile) : null,
        safeSharingBundleExists: Boolean(bundleOutputs.safeSharingBundleExists),
      },
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.analyze') {
    const analyzeRunner = typeof context.analyzeRunner === 'function'
      ? context.analyzeRunner
      : executeReadOnlyAnalyze;

    let execution;
    try {
      execution = analyzeRunner(args, {
        cwd: context.cwd || process.cwd(),
      });
    } catch (error) {
      const invalidArgCodes = new Set([
        'PROGRAM_REQUIRED',
      ]);
      if (
        (error && error.code && invalidArgCodes.has(error.code))
        || /invalid arguments for zeus\.analyze/i.test(String(error && error.message ? error.message : ''))
        || /missing required option: --program/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
        || /analyze\.outputRoot must be a string/i.test(String(error && error.message ? error.message : ''))
        || /analyze output not found:/i.test(String(error && error.message ? error.message : ''))
        || /analyze run manifest not found:/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    const summary = execution && execution.summary && typeof execution.summary === 'object'
      ? execution.summary
      : {};
    const artifacts = execution && execution.artifacts && typeof execution.artifacts === 'object'
      ? execution.artifacts
      : {};
    const analysisIndex = execution && execution.analysisIndex && typeof execution.analysisIndex === 'object'
      ? execution.analysisIndex
      : {};
    const graph = execution && execution.graph && typeof execution.graph === 'object'
      ? execution.graph
      : {};

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      profile: execution && typeof execution.profile === 'string' ? execution.profile : null,
      program: execution && execution.program ? String(execution.program) : '',
      status: execution && execution.status ? String(execution.status) : 'unknown',
      completedAt: execution && execution.completedAt ? String(execution.completedAt) : null,
      durationMs: Number(execution && execution.durationMs ? execution.durationMs : 0),
      reproducible: Boolean(execution && execution.reproducible),
      summary: {
        stageCount: Number(summary.stageCount || 0),
        completedStageCount: Number(summary.completedStageCount || 0),
        failedStageCount: Number(summary.failedStageCount || 0),
        diagnosticCount: Number(summary.diagnosticCount || 0),
        errorCount: Number(summary.errorCount || 0),
        warningCount: Number(summary.warningCount || 0),
        generatedArtifactCount: Number(summary.generatedArtifactCount || 0),
        sourceFileCount: Number(summary.sourceFileCount || 0),
      },
      artifacts: {
        count: Number(artifacts.count || 0),
        files: Array.isArray(artifacts.files) ? artifacts.files : [],
      },
      analysisIndex: {
        available: Boolean(analysisIndex.available),
        selectedMode: analysisIndex.selectedMode ? String(analysisIndex.selectedMode) : null,
        selectedPreset: analysisIndex.selectedPreset ? String(analysisIndex.selectedPreset) : null,
        taskCount: Number(analysisIndex.taskCount || 0),
        guidedModeCount: Number(analysisIndex.guidedModeCount || 0),
      },
      graph: {
        available: Boolean(graph.available),
        nodeCount: Number(graph.nodeCount || 0),
        edgeCount: Number(graph.edgeCount || 0),
        programCount: Number(graph.programCount || 0),
        tableCount: Number(graph.tableCount || 0),
      },
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.doctor') {
    const profile = args && typeof args.profile === 'string'
      ? args.profile.trim()
      : '';
    if (!profile) {
      const error = new Error('Invalid arguments for zeus.doctor: profile is required.');
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }

    const doctorRunner = typeof context.doctorRunner === 'function'
      ? context.doctorRunner
      : runDoctorChecks;
    const result = doctorRunner({ profile }, {
      cwd: context.cwd || process.cwd(),
      env: process.env,
    });
    const checks = Array.isArray(result && result.checks) ? result.checks : [];
    const byStatusCounts = checks.reduce((accumulator, check) => {
      const status = check && typeof check.status === 'string'
        ? check.status.toUpperCase()
        : 'UNKNOWN';
      accumulator.set(status, (accumulator.get(status) || 0) + 1);
      return accumulator;
    }, new Map());
    const summary = {
      total: checks.length,
      statuses: Array.from(byStatusCounts.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((left, right) => left.status.localeCompare(right.status)),
    };

    return {
      ok: !Boolean(result && result.hasCriticalFailure),
      service: 'zeus-rpg-promptkit',
      profile,
      summary,
      checks: checks.map((check) => ({
        name: check && check.name ? String(check.name) : 'unknown',
        status: check && check.status ? String(check.status).toUpperCase() : 'UNKNOWN',
      })),
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.query-sql') {
    const profile = args && typeof args.profile === 'string'
      ? args.profile.trim()
      : '';
    const sql = args && typeof args.sql === 'string'
      ? args.sql.trim()
      : '';
    if (!profile) {
      const error = new Error('Invalid arguments for zeus.query-sql: profile is required.');
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }
    if (!sql) {
      const error = new Error('Invalid arguments for zeus.query-sql: sql is required.');
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }

    const querySqlRunner = typeof context.querySqlRunner === 'function'
      ? context.querySqlRunner
      : executeQuerySql;

    const runnerArgs = {
      profile,
      sql,
      ...(args && args.maxRows !== undefined ? { 'max-rows': args.maxRows } : {}),
      ...(args && typeof args.defaultSchema === 'string' && args.defaultSchema.trim()
        ? { 'default-schema': args.defaultSchema.trim() }
        : {}),
      ...(args && typeof args.liblist === 'string' && args.liblist.trim()
        ? { liblist: args.liblist.trim() }
        : {}),
    };

    let execution;
    try {
      execution = querySqlRunner(runnerArgs, {
        cwd: context.cwd || process.cwd(),
      });
    } catch (error) {
      const invalidArgCodes = new Set([
        'PROFILE_REQUIRED',
        'SQL_REQUIRED',
        'SQL_FILE_NOT_FOUND',
        'DB2_CONFIG_INCOMPLETE',
      ]);
      if (
        (error && error.code && invalidArgCodes.has(error.code))
        || /read-only sql query/i.test(String(error && error.message ? error.message : ''))
        || /invalid option: --max-rows/i.test(String(error && error.message ? error.message : ''))
        || /invalid --default-schema/i.test(String(error && error.message ? error.message : ''))
        || /invalid --liblist/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      profile,
      defaultSchema: execution.defaultSchema || null,
      libraryList: Array.isArray(execution.libraryList) ? execution.libraryList : [],
      columns: Array.isArray(execution.columns) ? execution.columns : [],
      rows: Array.isArray(execution.rows) ? execution.rows : [],
      rowCount: Number(execution.rowCount || 0),
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.impact') {
    const impactRunner = typeof context.impactRunner === 'function'
      ? context.impactRunner
      : executeReadOnlyImpact;

    let maxItems;
    let cursorState;
    let execution;
    try {
      maxItems = parseOptionalPositiveInteger(args && args.maxItems, {
        label: 'zeus.impact maxItems',
        min: 1,
        max: MAX_MCP_PAYLOAD_ITEMS,
      });
      cursorState = decodeMcpCursor('zeus.impact', args && args.cursor, {
        allowLegacyNumericCursor: context.allowLegacyNumericCursor === true,
      });
      execution = impactRunner(args, {
        cwd: context.cwd || process.cwd(),
        allowLegacyNumericCursor: context.allowLegacyNumericCursor === true,
      });
    } catch (error) {
      const invalidArgCodes = new Set([
        'TARGET_REQUIRED',
      ]);
      if (
        (error && error.code && invalidArgCodes.has(error.code))
        || /invalid arguments for zeus\.impact/i.test(String(error && error.message ? error.message : ''))
        || /impact analysis requires --target/i.test(String(error && error.message ? error.message : ''))
        || /missing required option: --target/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
        || /analyze\.outputRoot must be a string/i.test(String(error && error.message ? error.message : ''))
        || /output directory not found:/i.test(String(error && error.message ? error.message : ''))
        || /no program-call-tree\.json found/i.test(String(error && error.message ? error.message : ''))
        || /could not infer graph for target/i.test(String(error && error.message ? error.message : ''))
        || /found in multiple program graphs/i.test(String(error && error.message ? error.message : ''))
        || /target ".+" not found in graph nodes/i.test(String(error && error.message ? error.message : ''))
        || /cross-program graph not found:/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    const result = execution && execution.result && typeof execution.result === 'object'
      ? execution.result
      : {};
    const ambiguity = result && result.ambiguity && typeof result.ambiguity === 'object'
      ? result.ambiguity
      : {};
    const itemLimit = Number.isInteger(maxItems) ? maxItems : DEFAULT_MCP_PAYLOAD_ITEMS;
    const directProgramsRaw = Array.isArray(result && result.directPrograms) ? result.directPrograms : [];
    const indirectProgramsRaw = Array.isArray(result && result.indirectPrograms) ? result.indirectPrograms : [];
    const directCallersRaw = Array.isArray(result && result.directCallers) ? result.directCallers : [];
    const indirectCallersRaw = Array.isArray(result && result.indirectCallers) ? result.indirectCallers : [];
    const offset = cursorState.offset;
    const maxAvailable = Math.max(
      directProgramsRaw.length,
      indirectProgramsRaw.length,
      directCallersRaw.length,
      indirectCallersRaw.length,
    );
    if (!Number.isFinite(offset) || offset < 0 || offset > maxAvailable) {
      throw createInvalidCursorError('zeus.impact', 'cursor is outside available result range.');
    }
    const directPrograms = directProgramsRaw.slice(offset, offset + itemLimit);
    const indirectPrograms = indirectProgramsRaw.slice(offset, offset + itemLimit);
    const directCallers = directCallersRaw.slice(offset, offset + itemLimit);
    const indirectCallers = indirectCallersRaw.slice(offset, offset + itemLimit);
    const pageSpan = Math.max(
      directPrograms.length,
      indirectPrograms.length,
      directCallers.length,
      indirectCallers.length,
    );
    const nextOffset = offset + pageSpan;
    const nextCursor = nextOffset < maxAvailable
      ? encodeMcpCursor('zeus.impact', nextOffset)
      : null;

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      profile: execution && typeof execution.profile === 'string' ? execution.profile : null,
      target: execution && execution.target ? String(execution.target) : '',
      program: execution && execution.program ? String(execution.program) : null,
      type: result && result.type ? String(result.type) : 'UNKNOWN',
      cursor: cursorState.cursor,
      cursorOffset: offset,
      nextCursor,
      maxItems: itemLimit,
      directPrograms,
      indirectPrograms,
      directCallers,
      indirectCallers,
      directProgramsCount: directProgramsRaw.length,
      indirectProgramsCount: indirectProgramsRaw.length,
      directCallersCount: directCallersRaw.length,
      indirectCallersCount: indirectCallersRaw.length,
      directProgramsTruncated: directProgramsRaw.length > offset + directPrograms.length,
      indirectProgramsTruncated: indirectProgramsRaw.length > offset + indirectPrograms.length,
      directCallersTruncated: directCallersRaw.length > offset + directCallers.length,
      indirectCallersTruncated: indirectCallersRaw.length > offset + indirectCallers.length,
      totalAffectedPrograms: Number(result && result.totalAffectedPrograms ? result.totalAffectedPrograms : 0),
      ambiguity: {
        targetAmbiguous: Boolean(ambiguity.targetAmbiguous),
        targetUnresolved: Boolean(ambiguity.targetUnresolved),
        ambiguousPrograms: Array.isArray(ambiguity.ambiguousPrograms) ? ambiguity.ambiguousPrograms : [],
        unresolvedPrograms: Array.isArray(ambiguity.unresolvedPrograms) ? ambiguity.unresolvedPrograms : [],
      },
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.query-table') {
    const profile = args && typeof args.profile === 'string'
      ? args.profile.trim()
      : '';
    const table = args && typeof args.table === 'string'
      ? args.table.trim()
      : '';
    if (!profile) {
      const error = new Error('Invalid arguments for zeus.query-table: profile is required.');
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }
    if (!table) {
      const error = new Error('Invalid arguments for zeus.query-table: table is required.');
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }

    const queryTableRunner = typeof context.queryTableRunner === 'function'
      ? context.queryTableRunner
      : executeQueryTable;

    const runnerArgs = {
      profile,
      table,
      ...(args && typeof args.schema === 'string' && args.schema.trim()
        ? { schema: args.schema.trim() }
        : {}),
      ...(args && typeof args.filter === 'string' && args.filter.trim()
        ? { filter: args.filter.trim() }
        : {}),
    };

    let execution;
    try {
      execution = queryTableRunner(runnerArgs, {
        cwd: context.cwd || process.cwd(),
      });
    } catch (error) {
      const invalidArgCodes = new Set([
        'PROFILE_REQUIRED',
        'TABLE_REQUIRED',
        'DB2_CONFIG_INCOMPLETE',
      ]);
      if (
        (error && error.code && invalidArgCodes.has(error.code))
        || /invalid --schema/i.test(String(error && error.message ? error.message : ''))
        || /invalid --table/i.test(String(error && error.message ? error.message : ''))
        || /invalid --filter pattern/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    const tableInfoRows = Array.isArray(execution && execution.tableInfo && execution.tableInfo.rows)
      ? execution.tableInfo.rows
      : [];
    const columnRows = Array.isArray(execution && execution.columns && execution.columns.rows)
      ? execution.columns.rows
      : [];

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      profile,
      table: execution && execution.table ? String(execution.table) : table,
      schema: execution && execution.schema ? String(execution.schema) : null,
      requestedSchema: execution && execution.requestedSchema ? String(execution.requestedSchema) : null,
      filter: execution && execution.filter ? String(execution.filter) : '',
      discoveredSchema: execution && execution.discoveredSchema ? String(execution.discoveredSchema) : '',
      tableInfo: tableInfoRows,
      columns: columnRows,
      tableCount: tableInfoRows.length,
      columnCount: columnRows.length,
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.search-source') {
    const searchSourceRunner = typeof context.searchSourceRunner === 'function'
      ? context.searchSourceRunner
      : executeReadOnlySearchSource;

    let execution;
    try {
      execution = await searchSourceRunner(args, {
        cwd: context.cwd || process.cwd(),
        allowLegacyNumericCursor: context.allowLegacyNumericCursor === true,
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.search-source/i.test(String(error && error.message ? error.message : ''))
        || /missing required option: --source-root/i.test(String(error && error.message ? error.message : ''))
        || /provide at least one search criterion/i.test(String(error && error.message ? error.message : ''))
        || /source root not found:/i.test(String(error && error.message ? error.message : ''))
        || /invalid option: --max-results/i.test(String(error && error.message ? error.message : ''))
        || /glob search failed:/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    const criteria = execution && execution.criteria && typeof execution.criteria === 'object'
      ? execution.criteria
      : {};
    const matches = Array.isArray(execution && execution.matches) ? execution.matches : [];

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      sourceRoot: execution && execution.sourceRoot ? String(execution.sourceRoot) : '',
      criteria: {
        searchTerm: criteria.searchTerm ? String(criteria.searchTerm) : null,
        member: criteria.member ? String(criteria.member) : null,
        table: criteria.table ? String(criteria.table) : null,
        filePattern: criteria.filePattern ? String(criteria.filePattern) : '',
        caseSensitive: Boolean(criteria.caseSensitive),
        maxResults: Number(criteria.maxResults || 0),
      },
      noSourceFiles: Boolean(execution && execution.noSourceFiles),
      resultCount: Number(execution && execution.resultCount ? execution.resultCount : 0),
      cursor: execution && typeof execution.cursor === 'string' && execution.cursor
        ? execution.cursor
        : null,
      cursorOffset: Number(execution && execution.cursorOffset ? execution.cursorOffset : 0),
      nextCursor: execution && typeof execution.nextCursor === 'string' && execution.nextCursor
        ? execution.nextCursor
        : null,
      maxPayloadItems: Number(execution && execution.maxPayloadItems ? execution.maxPayloadItems : DEFAULT_MCP_PAYLOAD_ITEMS),
      payloadResultCount: Number(execution && execution.payloadResultCount ? execution.payloadResultCount : matches.length),
      payloadTruncated: Boolean(execution && execution.payloadTruncated),
      matchedFileCount: Number(execution && execution.matchedFileCount ? execution.matchedFileCount : 0),
      limitReached: Boolean(execution && execution.limitReached),
      matches: matches.map((entry) => ({
        file: entry && entry.file ? String(entry.file) : '',
        lineNumber: Number(entry && entry.lineNumber ? entry.lineNumber : 0),
        line: entry && entry.line ? String(entry.line) : '',
      })),
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.field-search') {
    const fieldSearchRunner = typeof context.fieldSearchRunner === 'function'
      ? context.fieldSearchRunner
      : executeReadOnlyFieldSearch;

    let execution;
    try {
      execution = await fieldSearchRunner(args, {
        cwd: context.cwd || process.cwd(),
        allowLegacyNumericCursor: context.allowLegacyNumericCursor === true,
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.field-search/i.test(String(error && error.message ? error.message : ''))
        || /field-search source root not found:/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    const matches = Array.isArray(execution && execution.matches) ? execution.matches : [];
    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      sourceRoot: execution && execution.sourceRoot ? String(execution.sourceRoot) : '',
      field: execution && execution.field ? String(execution.field) : '',
      table: execution && execution.table ? String(execution.table) : null,
      maxResults: Number(execution && execution.maxResults ? execution.maxResults : 300),
      cursor: execution && typeof execution.cursor === 'string' && execution.cursor
        ? execution.cursor
        : null,
      cursorOffset: Number(execution && execution.cursorOffset ? execution.cursorOffset : 0),
      nextCursor: execution && typeof execution.nextCursor === 'string' && execution.nextCursor
        ? execution.nextCursor
        : null,
      maxPayloadItems: Number(execution && execution.maxPayloadItems ? execution.maxPayloadItems : DEFAULT_MCP_PAYLOAD_ITEMS),
      contextLines: Number(execution && execution.contextLines !== undefined ? execution.contextLines : 2),
      fileCount: Number(execution && execution.fileCount ? execution.fileCount : 0),
      resultCount: Number(execution && execution.resultCount ? execution.resultCount : 0),
      payloadResultCount: Number(execution && execution.payloadResultCount ? execution.payloadResultCount : matches.length),
      payloadTruncated: Boolean(execution && execution.payloadTruncated),
      matchedFileCount: Number(execution && execution.matchedFileCount ? execution.matchedFileCount : 0),
      truncated: Boolean(execution && execution.truncated),
      matches: matches.map((entry) => ({
        file: entry && entry.file ? String(entry.file) : '',
        line: Number(entry && entry.line ? entry.line : 0),
        text: entry && entry.text ? String(entry.text) : '',
        tableContexts: Array.isArray(entry && entry.tableContexts)
          ? entry.tableContexts.map((contextEntry) => ({
            table: contextEntry && contextEntry.table ? String(contextEntry.table) : '',
            intent: contextEntry && contextEntry.intent ? String(contextEntry.intent) : '',
            role: contextEntry && contextEntry.role ? String(contextEntry.role) : '',
          }))
          : [],
        contextBefore: Array.isArray(entry && entry.contextBefore)
          ? entry.contextBefore.map((contextEntry) => ({
            lineNo: Number(contextEntry && contextEntry.lineNo ? contextEntry.lineNo : 0),
            text: contextEntry && contextEntry.text ? String(contextEntry.text) : '',
          }))
          : [],
        contextAfter: Array.isArray(entry && entry.contextAfter)
          ? entry.contextAfter.map((contextEntry) => ({
            lineNo: Number(contextEntry && contextEntry.lineNo ? contextEntry.lineNo : 0),
            text: contextEntry && contextEntry.text ? String(contextEntry.text) : '',
          }))
          : [],
      })),
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.joblog') {
    const joblogRunner = typeof context.joblogRunner === 'function'
      ? context.joblogRunner
      : executeReadOnlyJoblog;

    let execution;
    try {
      execution = await joblogRunner(args, {
        cwd: context.cwd || process.cwd(),
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.joblog/i.test(String(error && error.message ? error.message : ''))
        || /invalid option: --severity/i.test(String(error && error.message ? error.message : ''))
        || /invalid option: --max-messages/i.test(String(error && error.message ? error.message : ''))
        || /db2 connection configuration is incomplete/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    const rows = Array.isArray(execution && execution.rows) ? execution.rows : [];
    const columns = Array.isArray(execution && execution.columns) ? execution.columns : [];
    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      profile: execution && execution.profile ? String(execution.profile) : '',
      job: execution && execution.job ? String(execution.job) : null,
      severity: execution && execution.severity ? String(execution.severity) : null,
      maxMessages: Number(execution && execution.maxMessages ? execution.maxMessages : 0),
      backend: execution && execution.backend ? String(execution.backend) : 'JOBLOG_INFO',
      compatibilityNote: execution && execution.compatibilityNote ? String(execution.compatibilityNote) : null,
      rowCount: Number(execution && execution.rowCount ? execution.rowCount : 0),
      uniqueMessageIdCount: Number(execution && execution.uniqueMessageIdCount ? execution.uniqueMessageIdCount : 0),
      limitReached: Boolean(execution && execution.limitReached),
      columns: columns.map((column) => String(column)),
      rows: rows.map((row) => (row && typeof row === 'object' ? row : {})),
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.inspect-object') {
    const inspectObjectRunner = typeof context.inspectObjectRunner === 'function'
      ? context.inspectObjectRunner
      : executeReadOnlyInspectObject;

    let execution;
    try {
      execution = await inspectObjectRunner(args, {
        cwd: context.cwd || process.cwd(),
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.inspect-object/i.test(String(error && error.message ? error.message : ''))
        || /invalid identifier/i.test(String(error && error.message ? error.message : ''))
        || /db2 connection configuration is incomplete/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    const rows = Array.isArray(execution && execution.rows) ? execution.rows : [];
    const columns = Array.isArray(execution && execution.columns) ? execution.columns : [];
    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      profile: execution && execution.profile ? String(execution.profile) : '',
      lib: execution && execution.lib ? String(execution.lib) : '',
      name: execution && execution.name ? String(execution.name) : '',
      type: execution && execution.type ? String(execution.type) : '*PGM',
      journalOnly: Boolean(execution && execution.journalOnly),
      rowCount: Number(execution && execution.rowCount ? execution.rowCount : 0),
      columns: columns.map((column) => String(column)),
      rows: rows.map((row) => (row && typeof row === 'object' ? row : {})),
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.assess-risk') {
    const assessRiskRunner = typeof context.assessRiskRunner === 'function'
      ? context.assessRiskRunner
      : executeReadOnlyAssessRisk;

    let execution;
    try {
      execution = await assessRiskRunner(args, {
        cwd: context.cwd || process.cwd(),
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.assess-risk/i.test(String(error && error.message ? error.message : ''))
        || /canonical analysis not found/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
        || /analyze\.outputRoot must be a string/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    const summary = execution && execution.summary && typeof execution.summary === 'object'
      ? execution.summary
      : {};
    const riskMetrics = execution && execution.riskMetrics && typeof execution.riskMetrics === 'object'
      ? execution.riskMetrics
      : {};
    const recommendations = Array.isArray(execution && execution.recommendations) ? execution.recommendations : [];
    const accessPoints = Array.isArray(execution && execution.accessPoints) ? execution.accessPoints : [];
    const criticalPaths = Array.isArray(execution && execution.criticalPaths) ? execution.criticalPaths : [];

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      profile: execution && typeof execution.profile === 'string' ? execution.profile : null,
      program: execution && execution.program ? String(execution.program) : '',
      summary: {
        riskLevel: summary.riskLevel ? String(summary.riskLevel) : 'UNKNOWN',
        distribution: summary.distribution ? String(summary.distribution) : '0🟢 / 0🟡 / 0🔴',
      },
      riskMetrics: {
        totalAccesses: Number(riskMetrics.totalAccesses || 0),
        greenCount: Number(riskMetrics.greenCount || 0),
        yellowCount: Number(riskMetrics.yellowCount || 0),
        redCount: Number(riskMetrics.redCount || 0),
      },
      recommendations: recommendations.map((entry) => String(entry)),
      accessPoints: accessPoints.map((entry) => ({
        type: entry && entry.type ? String(entry.type) : '',
        subtype: entry && entry.subtype ? String(entry.subtype) : null,
        name: entry && entry.name ? String(entry.name) : null,
        intent: entry && entry.intent ? String(entry.intent) : null,
        tables: Array.isArray(entry && entry.tables) ? entry.tables.map((table) => String(table)) : [],
        assessment: entry && entry.assessment && typeof entry.assessment === 'object'
          ? {
            risk: entry.assessment.risk ? String(entry.assessment.risk) : 'UNKNOWN',
            score: Number(entry.assessment.score || 0),
            reason: entry.assessment.reason ? String(entry.assessment.reason) : null,
          }
          : { risk: 'UNKNOWN', score: 0, reason: null },
        evidenceCount: Number(entry && entry.evidenceCount ? entry.evidenceCount : 0),
      })),
      criticalPaths: criticalPaths.map((entry) => ({
        type: entry && entry.type ? String(entry.type) : '',
        reason: entry && entry.reason ? String(entry.reason) : null,
        tables: Array.isArray(entry && entry.tables) ? entry.tables.map((table) => String(table)) : [],
        evidenceCount: Number(entry && entry.evidenceCount ? entry.evidenceCount : 0),
      })),
      accessPointCount: Number(execution && execution.accessPointCount ? execution.accessPointCount : 0),
      criticalPathCount: Number(execution && execution.criticalPathCount ? execution.criticalPathCount : 0),
      accessPointsTruncated: Boolean(execution && execution.accessPointsTruncated),
      criticalPathsTruncated: Boolean(execution && execution.criticalPathsTruncated),
      maxAccessPoints: Number(execution && execution.maxAccessPoints ? execution.maxAccessPoints : 0),
      maxCriticalPaths: Number(execution && execution.maxCriticalPaths ? execution.maxCriticalPaths : 0),
      timestamp: new Date().toISOString(),
    };
  }

  const error = new Error(`Unknown tool: ${name}`);
  error.code = 'TOOL_NOT_FOUND';
  throw error;
}

module.exports = {
  executeMcpToolCall,
  listMcpTools,
  readPackageVersion,
  __private: {
    buildHistoryLogFallbackQuery,
    buildHistoryLogFallbackSeverityClause,
    createInvalidCursorError,
    decodeMcpCursor,
    encodeMcpCursor,
    isJoblogInfoUnavailableError,
    normalizeJoblogToolError,
    summarizeJoblogRows,
  },
};
