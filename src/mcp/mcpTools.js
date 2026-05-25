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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { executeBridgeCommand } = require('../cli/commands/bridgeCommand');
const { normalizeSeverity, parseMaxMessages } = require('../cli/commands/joblogCommand');
const { validateWriteSql, resolveWriteMode } = require('../cli/commands/writeSqlCommand');
const { runDoctorChecks } = require('../cli/commands/doctorCommand');
const {
  loadCanonicalAnalysis,
  normalizeFormat: normalizeQaFormat,
  normalizeStrict: normalizeQaStrict,
} = require('../cli/commands/qaCommand');
const { runQAPipeline, generateQAReport } = require('../qa/qaIntegration');
const {
  generateChangeTestScenario,
  generateJestTestTemplate,
  generateMarkdownTestPlan,
} = require('../investigation/testScenarioGenerator');
const {
  estimateDeploymentTimeline,
  generateDeploymentChecklist,
  identifyRiskAreas,
} = require('../report/deploymentChecklistBuilder');
const { buildLineComparison, readLines, resolveDiffPaths } = require('../diff/workspaceDiffService');
const { loadTestRunManifest } = require('../investigation/testRunTracker');
const {
  getImportManifestEntryExport,
  getImportManifestEntryOrigin,
  getImportManifestEntryValidation,
  readImportManifest,
  summarizeImportManifest,
} = require('../fetch/importManifest');
const {
  listWorkspaces,
  readWorkspaceById,
  resolveRegistryPath,
} = require('../workspace/analysisRegistryService');
const { readWorkspaceIndex } = require('../workspace/workspaceIndexBuilder');
const { findImpactGraph } = require('../cli/helpers/impactGraphResolver');
const { readAnalyzeRunManifest } = require('../analyze/analyzeRunManifest');
const {
  loadProfiles,
  readWorkCopyConfig,
  resolveAnalyzeConfig,
  resolveAnalyzeDbConfig,
  resolveBundleConfig,
  resolveFetchConfig,
  resolveProfile,
} = require('../config/runtimeConfig');
const { isDbConfigured } = require('../db2/db2Config');
const { escapeSqlLiteral, runReadOnlyDb2Query, validateSqlIdentifier } = require('../db2/readOnlyQueryService');
const { runWriteDb2Query } = require('../db2/writeQueryService');
const { executeQuerySql, executeQueryTable } = require('../core/queryService');
const { executeSearchSource, normalizeFilePattern } = require('../core/searchSourceService');
const { analyzeImpactFromGraph, normalizeId } = require('../impact/impactAnalyzer');
const { assessCanonicalModel } = require('../impact/riskAssessmentAnalyzer');
const { WORKFLOW_RUN_MANIFEST_FILE } = require('../workflow/workflowRunManifest');
const { searchLocalSources } = require('../investigation/fieldXrefService');
const { listAnalysisRuns } = require('../ui/localUiDataApi');
const { DEFAULT_UI_HOST, DEFAULT_UI_PORT } = require('../ui/localUiServer');
const {
  buildWorkCopyTargetName,
  discoverFetchedSources,
  parseMembersCsv: parseWorkCopyMembersCsv,
} = require('../workspace/workCopyService');

const SUPPORTED_INSPECT_OBJECT_TYPES = ['*PGM', '*SRVPGM', '*MODULE', '*FILE', '*CMD', '*DTAARA', '*JOBQ', '*OUTQ'];
const DEFAULT_MCP_PAYLOAD_ITEMS = 100;
const MAX_MCP_PAYLOAD_ITEMS = 1000;
const MCP_CURSOR_VERSION = 1;

function isPathWithinBase(targetPath, basePath) {
  const resolvedBase = resolvePathForBoundary(basePath);
  const resolvedTarget = resolvePathForBoundary(targetPath);
  if (resolvedTarget === resolvedBase) {
    return true;
  }
  const baseWithSep = resolvedBase.endsWith(path.sep)
    ? resolvedBase
    : `${resolvedBase}${path.sep}`;
  return resolvedTarget.startsWith(baseWithSep);
}

function resolvePathForBoundary(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  try {
    return fs.realpathSync.native(resolvedPath);
  } catch (_) {
    // TODO: Non-existent targets still fall back to lexical containment.
    // A follow-up hardening pass should resolve existing parent segments to close symlink escapes for not-yet-created paths.
    return resolvedPath;
  }
}

function assertPathWithinCwd({
  toolName,
  optionName,
  rawValue,
  resolvedPath,
  cwd,
}) {
  const input = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!input) {
    return;
  }
  if (isPathWithinBase(resolvedPath, cwd)) {
    return;
  }
  const error = new Error(
    `Invalid arguments for ${toolName}: ${optionName} must resolve inside workspace root (${cwd}).`,
  );
  error.code = 'TOOL_INVALID_ARGUMENTS';
  throw error;
}

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

function decodeMcpCursor(toolName, cursor) {
  const rawCursor = typeof cursor === 'string' ? cursor.trim() : '';
  if (!rawCursor) {
    return {
      cursor: null,
      offset: 0,
      isLegacyNumeric: false,
    };
  }
  if (/^\d+$/.test(rawCursor)) {
    throw createInvalidCursorError(toolName, 'legacy numeric cursor input is no longer supported; provide an opaque cursor token.');
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
  } catch (_) {
    throw createInvalidCursorError(toolName, 'value must be an opaque versioned token.');
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

function normalizeMcpRuntimeToolError(toolName, error) {
  const wrapped = new Error(
    `${toolName} failed to query backend service. Verify profile connectivity and required IBM i service availability.`,
  );
  wrapped.code = 'TOOL_RUNTIME_FAILURE';
  wrapped.cause = error;
  return wrapped;
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
      name: 'zeus.diff',
      description: 'Compares fetched source and workspace copy for a member and returns deterministic line diffs (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['profile', 'member'],
        properties: {
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Runtime profile used to resolve fetch/workspace roots.',
          },
          member: {
            type: 'string',
            minLength: 1,
            description: 'Member name to compare between fetched source and workspace copy.',
          },
          maxPayloadLines: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_MCP_PAYLOAD_ITEMS,
            description: 'Optional cap for returned diff lines in MCP payload.',
          },
        },
      },
    },
    {
      name: 'zeus.generate-test',
      description: 'Generates deterministic test-scenario content from existing canonical-analysis artifacts (read-only planning output).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['program'],
        properties: {
          program: {
            type: 'string',
            minLength: 1,
            description: 'Program name with existing canonical-analysis artifacts.',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Optional runtime profile used to resolve output root.',
          },
          out: {
            type: 'string',
            minLength: 1,
            description: 'Optional output root override.',
          },
          output: {
            type: 'string',
            minLength: 1,
            description: 'Optional alias for out.',
          },
          format: {
            type: 'string',
            enum: ['markdown', 'jest'],
            description: 'Generated scenario format.',
          },
          critical: {
            type: 'boolean',
            description: 'When true, prioritize critical-path scenarios.',
          },
          change: {
            type: 'boolean',
            description: 'When true, append change-specific scenario scaffolding.',
          },
          table: {
            type: 'string',
            minLength: 1,
            description: 'Optional table name used by change scenario mode.',
          },
          column: {
            type: 'string',
            minLength: 1,
            description: 'Optional column name used by change scenario mode.',
          },
          oldType: {
            type: 'string',
            minLength: 1,
            description: 'Optional previous type annotation for change scenario mode.',
          },
          newType: {
            type: 'string',
            minLength: 1,
            description: 'Optional new type annotation for change scenario mode.',
          },
          affectedPrograms: {
            type: 'string',
            minLength: 1,
            description: 'Optional comma-separated affected program names for change scenario mode.',
          },
        },
      },
    },
    {
      name: 'zeus.generate-checklist',
      description: 'Generates deterministic deployment-checklist content from local analysis/risk artifacts (read-only planning output).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['program'],
        properties: {
          program: {
            type: 'string',
            minLength: 1,
            description: 'Program name for checklist generation.',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Optional runtime profile used to resolve output root.',
          },
          out: {
            type: 'string',
            minLength: 1,
            description: 'Optional output root override.',
          },
          output: {
            type: 'string',
            minLength: 1,
            description: 'Optional alias for out.',
          },
          type: {
            type: 'string',
            enum: ['DDL_CHANGE', 'CODE_CHANGE', 'BOTH'],
            description: 'Checklist change type.',
          },
          impact: {
            type: 'string',
            minLength: 1,
            description: 'Optional impact label override (for example HIGH/MEDIUM/LOW).',
          },
          table: {
            type: 'string',
            minLength: 1,
            description: 'Optional table name referenced by the checklist.',
          },
          affected: {
            type: 'string',
            minLength: 1,
            description: 'Optional comma-separated affected program names.',
          },
        },
      },
    },
    {
      name: 'zeus.qa',
      description: 'Runs QA validation against canonical analysis artifacts and returns deterministic report output (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['input'],
        properties: {
          input: {
            type: 'string',
            minLength: 1,
            description: 'Path to canonical-analysis.json or a directory containing canonical-analysis.json.',
          },
          format: {
            type: 'string',
            enum: ['jira', 'markdown', 'json'],
            description: 'Report format.',
          },
          strict: {
            type: 'string',
            enum: ['LENIENT', 'STRICT'],
            description: 'QA strictness mode.',
          },
        },
      },
    },
    {
      name: 'zeus.analyses',
      description: 'Lists or shows registered analysis workspaces and index summaries (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['operation'],
        properties: {
          operation: {
            type: 'string',
            enum: ['list', 'show'],
            description: 'Read-only analyses operation.',
          },
          id: {
            type: 'string',
            minLength: 1,
            description: 'Workspace id (required for operation=show).',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Optional runtime profile used to resolve analyses registry path.',
          },
          registryPath: {
            type: 'string',
            minLength: 1,
            description: 'Optional analyses registry path override.',
          },
        },
      },
    },
    {
      name: 'zeus.fetch',
      description: 'Reads existing fetch import manifest metadata and deterministic file summaries (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['operation'],
        properties: {
          operation: {
            type: 'string',
            enum: ['summary', 'files'],
            description: 'Read-only fetch metadata operation.',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Optional runtime profile used to resolve fetch output root.',
          },
          out: {
            type: 'string',
            minLength: 1,
            description: 'Optional fetch output root override.',
          },
          maxPayloadItems: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_MCP_PAYLOAD_ITEMS,
            description: 'Optional cap for returned file entries when operation=files.',
          },
          cursor: {
            type: 'string',
            minLength: 1,
            description: 'Optional pagination cursor returned by a previous zeus.fetch call (operation=files).',
          },
        },
      },
    },
    {
      name: 'zeus.test-run',
      description: 'Reads existing test-run manifest metadata and rollback SQL previews (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['operation', 'manifest'],
        properties: {
          operation: {
            type: 'string',
            enum: ['show', 'rollback'],
            description: 'Read-only test-run operation.',
          },
          manifest: {
            type: 'string',
            minLength: 1,
            description: 'Path to test-run-manifest.json.',
          },
          maxPayloadItems: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_MCP_PAYLOAD_ITEMS,
            description: 'Optional cap for returned rollback statements when operation=rollback.',
          },
        },
      },
    },
    {
      name: 'zeus.copy-to-workspace',
      description: 'Builds a deterministic copy plan from fetched sources to workspace targets (read-only preview).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['operation', 'profile'],
        properties: {
          operation: {
            type: 'string',
            enum: ['plan'],
            description: 'Read-only copy-to-workspace operation.',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Runtime profile used to resolve fetch/work-copy roots.',
          },
          members: {
            type: 'string',
            minLength: 1,
            description: 'Optional comma-separated member filter.',
          },
          force: {
            type: 'boolean',
            description: 'When true, existing targets are marked as will-overwrite in the plan.',
          },
          out: {
            type: 'string',
            minLength: 1,
            description: 'Optional fetch output root override (same semantics as fetch --out).',
          },
          maxPayloadItems: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_MCP_PAYLOAD_ITEMS,
            description: 'Optional cap for returned plan entries.',
          },
          cursor: {
            type: 'string',
            minLength: 1,
            description: 'Optional pagination cursor returned by a previous zeus.copy-to-workspace call.',
          },
        },
      },
    },
    {
      name: 'zeus.serve',
      description: 'Returns deterministic local UI serve metadata (config/routes/run counts) without starting a server (read-only).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['operation'],
        properties: {
          operation: {
            type: 'string',
            enum: ['summary'],
            description: 'Read-only serve metadata operation.',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Optional runtime profile used for output-root and registry resolution.',
          },
          host: {
            type: 'string',
            minLength: 1,
            description: 'Optional UI host override (loopback only).',
          },
          port: {
            type: 'integer',
            minimum: 0,
            description: 'Optional UI port override; 0 means ephemeral at runtime.',
          },
          registryPath: {
            type: 'string',
            minLength: 1,
            description: 'Optional analyses registry path override.',
          },
          'registry-path': {
            type: 'string',
            minLength: 1,
            description: 'Alias for registryPath.',
          },
          sourceOutputRoot: {
            type: 'string',
            minLength: 1,
            description: 'Optional source output root override.',
          },
          'source-output-root': {
            type: 'string',
            minLength: 1,
            description: 'Alias for sourceOutputRoot.',
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
      name: 'zeus.write-sql',
      description: 'Plans or applies guarded DML statements (INSERT/UPDATE/DELETE/MERGE) with explicit MCP write gates.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['operation', 'profile', 'sql'],
        properties: {
          operation: {
            type: 'string',
            enum: ['plan', 'apply'],
            description: 'Use plan for non-mutating validation/preview; apply executes the statement when all write gates pass.',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Runtime profile name with DB2 write access.',
          },
          mode: {
            type: 'string',
            enum: ['upsert-sql', 'upsert', 'insert', 'update'],
            description: 'Write mode guard for accepted DML statement shape.',
          },
          sql: {
            type: 'string',
            minLength: 1,
            description: 'DML statement text to validate or execute.',
          },
          confirmToken: {
            type: 'string',
            minLength: 1,
            description: 'Required for operation=apply; must match ZEUS_MCP_WRITE_CONFIRM_TOKEN.',
          },
          maxRowsAffected: {
            type: 'integer',
            minimum: 1,
            description: 'Optional stricter row-safety cap for this call; cannot exceed configured profile policy.',
          },
        },
      },
    },
    {
      name: 'zeus.bridge',
      description: 'Runs guarded bridge preview operations (plan/report and dry-run stage/compile-run) without remote mutation.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['operation', 'profile', 'program'],
        properties: {
          operation: {
            type: 'string',
            enum: ['plan', 'report', 'stage', 'compile-run'],
            description: 'Bridge preview operation. Mutation/apply operations are intentionally blocked in MCP.',
          },
          profile: {
            type: 'string',
            minLength: 1,
            description: 'Runtime profile name with bridge configuration.',
          },
          program: {
            type: 'string',
            minLength: 1,
            description: 'Program identifier for bridge artifacts.',
          },
          source: {
            type: 'string',
            minLength: 1,
            description: 'Required when operation=plan; local source path.',
          },
          targetType: {
            type: 'string',
            enum: ['source-member', 'ifs-streamfile'],
            description: 'Optional bridge target type (defaults to source-member).',
          },
          targetLib: {
            type: 'string',
            minLength: 1,
            description: 'Optional target library (required for source-member plans).',
          },
          targetFile: {
            type: 'string',
            minLength: 1,
            description: 'Optional target source file (required for source-member plans).',
          },
          targetMember: {
            type: 'string',
            minLength: 1,
            description: 'Optional target member (required for source-member plans).',
          },
          targetMemberType: {
            type: 'string',
            minLength: 1,
            description: 'Optional target member type.',
          },
          targetIfs: {
            type: 'string',
            minLength: 1,
            description: 'Optional IFS target path (required for ifs-streamfile plans).',
          },
          beforeHash: {
            type: 'string',
            minLength: 1,
            description: 'Optional baseline content hash annotation for plan metadata.',
          },
          afterHash: {
            type: 'string',
            minLength: 1,
            description: 'Optional proposed content hash annotation for plan metadata.',
          },
          diffSummary: {
            type: 'string',
            minLength: 1,
            description: 'Optional human summary of intended bridge change.',
          },
          riskLevel: {
            type: 'string',
            minLength: 1,
            description: 'Optional risk label for plan metadata (for example LOW/MEDIUM/HIGH).',
          },
          actorMode: {
            type: 'string',
            minLength: 1,
            description: 'Optional actor mode annotation for bridge audit events.',
          },
          dryRun: {
            type: 'boolean',
            description: 'Required true for operation=stage and operation=compile-run in MCP.',
          },
          approvalFile: {
            type: 'string',
            minLength: 1,
            description: 'Optional approval artifact path used by stage/compile-run preview checks.',
          },
          template: {
            type: 'string',
            minLength: 1,
            description: 'Required compile template id for operation=compile-run.',
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

function executeReadOnlyDiff(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const env = context.env || process.env;
  const profileName = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  const member = args && typeof args.member === 'string'
    ? args.member.trim()
    : '';
  if (!profileName) {
    const error = new Error('Invalid arguments for zeus.diff: profile is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (!member) {
    const error = new Error('Invalid arguments for zeus.diff: member is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const maxPayloadLines = parseOptionalPositiveInteger(args && args.maxPayloadLines, {
    label: 'zeus.diff maxPayloadLines',
    min: 1,
    max: MAX_MCP_PAYLOAD_ITEMS,
  });

  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, profileName, { env });
  const analyzeConfig = resolveAnalyzeConfig(args, { cwd, env });
  const fetchConfig = resolveFetchConfig(args, { cwd, env });
  const workCopyConfig = readWorkCopyConfig(profile, env);
  const fetchRootInput = String(fetchConfig.out || '').trim();
  const workspaceRootInput = String(analyzeConfig.sourceRoot || workCopyConfig.root || '').trim();
  const fetchRoot = path.resolve(cwd, fetchRootInput);
  const workspaceRoot = path.resolve(cwd, workspaceRootInput);
  assertPathWithinCwd({
    toolName: 'zeus.diff',
    optionName: '--fetch-out',
    rawValue: fetchRootInput,
    resolvedPath: fetchRoot,
    cwd,
  });
  assertPathWithinCwd({
    toolName: 'zeus.diff',
    optionName: '--source-root',
    rawValue: workspaceRootInput,
    resolvedPath: workspaceRoot,
    cwd,
  });
  const resolved = resolveDiffPaths({
    member,
    fetchRoot,
    workspaceRoot,
    workCopyMode: workCopyConfig.extension,
  });
  const comparison = buildLineComparison(
    readLines(resolved.originalPath),
    readLines(resolved.modifiedPath),
  );
  const payloadLimit = Number.isInteger(maxPayloadLines) ? maxPayloadLines : DEFAULT_MCP_PAYLOAD_ITEMS;
  const payloadRows = comparison.rows.slice(0, payloadLimit);

  return {
    profile: profileName,
    member: resolved.member,
    fetchRoot,
    workspaceRoot,
    workCopyMode: String(workCopyConfig.extension || '').trim().toLowerCase(),
    originalPath: resolved.originalPath,
    modifiedPath: resolved.modifiedPath,
    maxPayloadLines: payloadLimit,
    payloadLineCount: payloadRows.length,
    payloadTruncated: comparison.rows.length > payloadRows.length,
    lineCount: comparison.rows.length,
    changedLineCount: Number(comparison.changedCount || 0),
    rows: payloadRows.map((row) => ({
      line: Number(row && row.line ? row.line : 0),
      marker: row && row.marker ? String(row.marker) : ' ',
      original: row && row.original ? String(row.original) : '',
      modified: row && row.modified ? String(row.modified) : '',
    })),
  };
}

function parseOptionalBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseCsvList(value) {
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

async function executeReadOnlyGenerateTest(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const env = context.env || process.env;
  const program = args && typeof args.program === 'string'
    ? args.program.trim().toUpperCase()
    : '';
  if (!program) {
    const error = new Error('Invalid arguments for zeus.generate-test: program is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  const format = args && typeof args.format === 'string'
    ? args.format.trim().toLowerCase()
    : 'markdown';
  if (format !== 'markdown' && format !== 'jest') {
    const error = new Error('Invalid arguments for zeus.generate-test: format must be markdown or jest.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const config = resolveAnalyzeConfig(args, { cwd, env });
  const outputRootInput = String(config && config.outputRoot ? config.outputRoot : 'output').trim();
  const outputRoot = path.resolve(cwd, outputRootInput || 'output');
  const outArg = args && typeof args.out === 'string' && args.out.trim()
    ? args.out.trim()
    : (args && typeof args.output === 'string' && args.output.trim() ? args.output.trim() : '');
  if (outArg) {
    assertPathWithinCwd({
      toolName: 'zeus.generate-test',
      optionName: '--out',
      rawValue: outArg,
      resolvedPath: outputRoot,
      cwd,
    });
  }

  const programDir = path.join(outputRoot, program);
  const analysisPath = path.join(programDir, 'canonical-analysis.json');
  if (!fs.existsSync(analysisPath)) {
    const error = new Error(`canonical-analysis.json not found at: ${analysisPath}. Run analyze first.`);
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  let canonicalAnalysis;
  try {
    canonicalAnalysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
  } catch (error) {
    const wrapped = new Error(`Failed to parse canonical analysis JSON: ${error.message}`);
    wrapped.code = 'TOOL_INVALID_ARGUMENTS';
    throw wrapped;
  }

  const isCritical = parseOptionalBooleanFlag(args && args.critical, false);
  let content;
  let extension;
  if (format === 'jest') {
    content = generateJestTestTemplate(program, canonicalAnalysis, { isCritical });
    extension = '.test.js';
  } else {
    content = generateMarkdownTestPlan(program, canonicalAnalysis, { isCriticalPath: isCritical });
    extension = '.test-plan.md';
  }

  const includeChangeScenario = parseOptionalBooleanFlag(args && args.change, false);
  if (includeChangeScenario) {
    const affectedPrograms = parseCsvList(args && args.affectedPrograms).map((entry) => ({
      name: entry,
      accessType: 'UNKNOWN',
    }));
    const changeScenario = generateChangeTestScenario(program, {
      table: args && typeof args.table === 'string' && args.table.trim() ? args.table.trim() : 'UNKNOWN',
      column: args && typeof args.column === 'string' && args.column.trim() ? args.column.trim() : 'UNKNOWN',
      oldType: args && typeof args.oldType === 'string' && args.oldType.trim() ? args.oldType.trim() : undefined,
      newType: args && typeof args.newType === 'string' && args.newType.trim() ? args.newType.trim() : undefined,
      affectedPrograms,
    });
    content = `${content}\n\n${changeScenario}`;
  }

  return {
    program,
    format,
    isCritical,
    includeChangeScenario,
    analysisPath,
    outputRoot,
    outputPathSuggestion: path.join(programDir, `test-scenarios${extension}`),
    content,
    contentLength: content.length,
  };
}

async function executeReadOnlyGenerateChecklist(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const env = context.env || process.env;
  const program = args && typeof args.program === 'string'
    ? args.program.trim().toUpperCase()
    : '';
  if (!program) {
    const error = new Error('Invalid arguments for zeus.generate-checklist: program is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const changeType = args && typeof args.type === 'string'
    ? args.type.trim().toUpperCase()
    : 'CODE_CHANGE';
  if (!['DDL_CHANGE', 'CODE_CHANGE', 'BOTH'].includes(changeType)) {
    const error = new Error('Invalid arguments for zeus.generate-checklist: type must be DDL_CHANGE, CODE_CHANGE, or BOTH.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const config = resolveAnalyzeConfig(args, { cwd, env });
  const outputRootInput = String(config && config.outputRoot ? config.outputRoot : 'output').trim();
  const outputRoot = path.resolve(cwd, outputRootInput || 'output');
  const outArg = args && typeof args.out === 'string' && args.out.trim()
    ? args.out.trim()
    : (args && typeof args.output === 'string' && args.output.trim() ? args.output.trim() : '');
  if (outArg) {
    assertPathWithinCwd({
      toolName: 'zeus.generate-checklist',
      optionName: '--out',
      rawValue: outArg,
      resolvedPath: outputRoot,
      cwd,
    });
  }

  const programDir = path.join(outputRoot, program);
  const analysisPath = path.join(programDir, 'canonical-analysis.json');
  const riskPath = path.join(programDir, 'risk-assessment.json');
  let canonicalAnalysis = null;
  let riskAssessment = null;

  if (fs.existsSync(analysisPath)) {
    try {
      canonicalAnalysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
    } catch (error) {
      const wrapped = new Error(`Failed to parse canonical analysis JSON: ${error.message}`);
      wrapped.code = 'TOOL_INVALID_ARGUMENTS';
      throw wrapped;
    }
  }
  if (fs.existsSync(riskPath)) {
    try {
      riskAssessment = JSON.parse(fs.readFileSync(riskPath, 'utf8'));
    } catch (error) {
      const wrapped = new Error(`Failed to parse risk assessment JSON: ${error.message}`);
      wrapped.code = 'TOOL_INVALID_ARGUMENTS';
      throw wrapped;
    }
  }

  const hasCriticalPath = Boolean(
    riskAssessment
    && riskAssessment.summary
    && String(riskAssessment.summary.riskLevel || '').toUpperCase() === 'RED'
  );
  const affectedPrograms = parseCsvList(args && args.affected);
  const affected = affectedPrograms.length > 0 ? affectedPrograms : [program];
  const impact = args && typeof args.impact === 'string' && args.impact.trim()
    ? args.impact.trim()
    : (hasCriticalPath ? 'HIGH' : 'MEDIUM');

  const checklist = generateDeploymentChecklist({
    program,
    table: args && typeof args.table === 'string' && args.table.trim() ? args.table.trim() : undefined,
    changeType,
    affectedPrograms: affected,
    hasCriticalPath,
    estimatedImpact: impact,
  });
  const timeline = estimateDeploymentTimeline({
    changeType,
    affectedProgramCount: affected.length,
    hasCriticalPath,
  });
  const riskAreas = canonicalAnalysis
    ? identifyRiskAreas(canonicalAnalysis, { program, changeType })
    : [];

  let document = checklist;
  if (timeline) {
    document += '\n## Timeline Estimate\n\n';
    document += `**Total Time:** ${timeline.totalHours} hours (${timeline.workDays} working days)\n\n`;
    document += '| Phase | Hours |\n';
    document += '|-------|-------|\n';
    Object.entries(timeline.hours || {}).forEach(([phase, hours]) => {
      document += `| ${phase} | ${hours}h |\n`;
    });
    document += '\n';
  }
  if (riskAreas.length > 0) {
    document += '\n## Identified Risk Areas\n\n';
    riskAreas.forEach((risk) => {
      const severity = risk && risk.severity ? String(risk.severity) : 'UNKNOWN';
      document += `- ${severity}: ${risk && risk.description ? String(risk.description) : ''}\n`;
      document += `  Mitigation: ${risk && risk.mitigation ? String(risk.mitigation) : ''}\n`;
    });
    document += '\n';
  }

  return {
    program,
    changeType,
    impact,
    affectedPrograms: affected,
    hasCriticalPath,
    outputRoot,
    analysisPath: fs.existsSync(analysisPath) ? analysisPath : null,
    riskPath: fs.existsSync(riskPath) ? riskPath : null,
    outputPathSuggestion: path.join(programDir, 'deployment-checklist.md'),
    timeline,
    riskAreaCount: riskAreas.length,
    content: document,
    contentLength: document.length,
  };
}

async function executeReadOnlyQa(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const input = args && typeof args.input === 'string'
    ? args.input.trim()
    : '';
  if (!input) {
    const error = new Error('Invalid arguments for zeus.qa: input is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  let format;
  let strict;
  try {
    format = normalizeQaFormat(args && args.format);
    strict = normalizeQaStrict(args && args.strict);
  } catch (error) {
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const inputPath = path.resolve(cwd, input);
  assertPathWithinCwd({
    toolName: 'zeus.qa',
    optionName: '--input',
    rawValue: input,
    resolvedPath: inputPath,
    cwd,
  });
  let canonicalAnalysis;
  try {
    canonicalAnalysis = loadCanonicalAnalysis(inputPath);
  } catch (error) {
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const qaResults = await runQAPipeline({
    canonicalAnalysis: canonicalAnalysis || {},
    sourceFiles: [],
    config: {},
  }, {
    qa: {
      qaMode: true,
      qaStrict: strict,
    },
  });

  const report = qaResults && qaResults.status === 'SKIPPED'
    ? {
      status: 'SKIPPED',
      message: qaResults.message || 'No QA report generated (QA mode not enabled)',
    }
    : generateQAReport(qaResults, { format });

  return {
    inputPath,
    format,
    strict,
    qaStatus: qaResults && qaResults.status ? String(qaResults.status) : 'UNKNOWN',
    durationMs: Number(qaResults && qaResults.duration ? qaResults.duration : 0),
    stageCount: Number(qaResults && qaResults.stagesRun ? qaResults.stagesRun : 0),
    failureCount: Array.isArray(qaResults && qaResults.failures) ? qaResults.failures.length : 0,
    report: report && typeof report === 'object' ? report : { format, content: String(report || '') },
  };
}

function resolveAnalysesRegistryPath(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const env = context.env || process.env;
  const profileName = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  const registryPathArg = args && typeof args.registryPath === 'string'
    ? args.registryPath.trim()
    : '';

  let profile = null;
  if (profileName) {
    const profiles = loadProfiles({ cwd, env, args });
    profile = resolveProfile(profiles, profileName, { env });
  }

  const resolvedRegistryPath = resolveRegistryPath({
    registryPath: registryPathArg || undefined,
    cwd,
    env,
    profile,
  });
  if (registryPathArg) {
    assertPathWithinCwd({
      toolName: 'zeus.analyses',
      optionName: '--registry-path',
      rawValue: registryPathArg,
      resolvedPath: resolvedRegistryPath,
      cwd,
    });
  }
  return {
    profileName: profileName || null,
    registryPath: resolvedRegistryPath,
  };
}

async function executeReadOnlyAnalyses(args = {}, context = {}) {
  const operation = args && typeof args.operation === 'string'
    ? args.operation.trim().toLowerCase()
    : '';
  if (!operation) {
    const error = new Error('Invalid arguments for zeus.analyses: operation is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (operation !== 'list' && operation !== 'show') {
    const error = new Error('Invalid arguments for zeus.analyses: operation must be list or show.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const resolved = resolveAnalysesRegistryPath(args, context);

  if (operation === 'list') {
    const workspaces = listWorkspaces(resolved.registryPath);
    const entries = workspaces.map((workspace) => {
      const index = readWorkspaceIndex(workspace.path);
      const programs = index && Array.isArray(index.programs) ? index.programs : [];
      return {
        id: String(workspace.id || ''),
        name: String(workspace.name || ''),
        path: String(workspace.path || ''),
        outputDir: String(workspace.outputDir || 'output'),
        sourceDir: String(workspace.sourceDir || 'rpg_sources'),
        system: String(workspace.system || ''),
        library: String(workspace.library || ''),
        profile: String(workspace.profile || ''),
        tags: Array.isArray(workspace.tags) ? workspace.tags.map((tag) => String(tag)) : [],
        registeredAt: workspace.registeredAt ? String(workspace.registeredAt) : null,
        lastAccessedAt: workspace.lastAccessedAt ? String(workspace.lastAccessedAt) : null,
        programCount: programs.length,
      };
    });
    return {
      operation: 'list',
      profile: resolved.profileName,
      registryPath: resolved.registryPath,
      workspaceCount: entries.length,
      workspaces: entries,
    };
  }

  const workspaceId = args && typeof args.id === 'string'
    ? args.id.trim()
    : '';
  if (!workspaceId) {
    const error = new Error('Invalid arguments for zeus.analyses: id is required when operation=show.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  const workspace = readWorkspaceById(resolved.registryPath, workspaceId);
  if (!workspace) {
    const error = new Error(`Workspace not found: ${workspaceId}`);
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  const index = readWorkspaceIndex(workspace.path);
  const programs = index && Array.isArray(index.programs) ? index.programs : [];
  const sourceMembers = index && index.sourceMembers && typeof index.sourceMembers === 'object'
    ? index.sourceMembers
    : {};
  const reports = index && Array.isArray(index.reports) ? index.reports : [];
  return {
    operation: 'show',
    profile: resolved.profileName,
    registryPath: resolved.registryPath,
    workspace: {
      id: String(workspace.id || ''),
      name: String(workspace.name || ''),
      description: String(workspace.description || ''),
      path: String(workspace.path || ''),
      outputDir: String(workspace.outputDir || 'output'),
      sourceDir: String(workspace.sourceDir || 'rpg_sources'),
      system: String(workspace.system || ''),
      library: String(workspace.library || ''),
      profile: String(workspace.profile || ''),
      tags: Array.isArray(workspace.tags) ? workspace.tags.map((tag) => String(tag)) : [],
      registeredAt: workspace.registeredAt ? String(workspace.registeredAt) : null,
      lastAccessedAt: workspace.lastAccessedAt ? String(workspace.lastAccessedAt) : null,
    },
    index: {
      available: Boolean(index),
      generatedAt: index && index.generatedAt ? String(index.generatedAt) : null,
      programCount: programs.length,
      programs: programs.map((program) => ({
        name: program && program.name ? String(program.name) : '',
        outputDir: program && program.outputDir ? String(program.outputDir) : '',
        analyzedAt: program && program.analyzedAt ? String(program.analyzedAt) : null,
        workflowMode: program && program.workflowMode ? String(program.workflowMode) : null,
        artifactCount: Number(program && program.artifactCount ? program.artifactCount : 0),
      })),
      sourceMembers,
      reportCount: reports.length,
      reports: reports.map((report) => ({
        path: report && report.path ? String(report.path) : '',
        title: report && report.title ? String(report.title) : '',
        generatedAt: report && report.generatedAt ? String(report.generatedAt) : null,
      })),
    },
  };
}

function resolveFetchManifest(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const env = context.env || process.env;
  const profile = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  const out = args && typeof args.out === 'string'
    ? args.out.trim()
    : '';
  const fetchArgs = {
    ...(profile ? { profile } : {}),
    ...(out ? { out } : {}),
  };
  const fetchConfig = resolveFetchConfig(fetchArgs, { cwd, env });
  const fetchRootInput = String(fetchConfig.out || '').trim();
  const fetchRoot = path.resolve(cwd, fetchRootInput || './rpg_sources');
  assertPathWithinCwd({
    toolName: 'zeus.fetch',
    optionName: '--out',
    rawValue: fetchRootInput,
    resolvedPath: fetchRoot,
    cwd,
  });
  const manifestResult = readImportManifest(fetchRoot);
  if (manifestResult && manifestResult.error) {
    const error = new Error(
      `Failed to parse fetch import manifest JSON at ${manifestResult.manifestPath}: ${manifestResult.error.message}`,
    );
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (!manifestResult || !manifestResult.manifest) {
    const error = new Error(`Fetch import manifest not found: ${manifestResult.manifestPath}. Run fetch first.`);
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  const summary = summarizeImportManifest(manifestResult.manifest, {
    manifestPath: manifestResult.manifestPath,
  });
  if (!summary) {
    const error = new Error(`Invalid fetch import manifest payload at ${manifestResult.manifestPath}.`);
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  return {
    profile: profile || null,
    fetchRoot,
    manifestPath: manifestResult.manifestPath,
    manifest: manifestResult.manifest,
    summary,
  };
}

async function executeReadOnlyFetch(args = {}, context = {}) {
  const operation = args && typeof args.operation === 'string'
    ? args.operation.trim().toLowerCase()
    : '';
  if (!operation) {
    const error = new Error('Invalid arguments for zeus.fetch: operation is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (operation !== 'summary' && operation !== 'files') {
    const error = new Error('Invalid arguments for zeus.fetch: operation must be summary or files.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const resolved = resolveFetchManifest(args, context);
  if (operation === 'summary') {
    return {
      operation: 'summary',
      profile: resolved.profile,
      fetchRoot: resolved.fetchRoot,
      manifestPath: resolved.manifestPath,
      summary: resolved.summary,
      cursor: null,
      cursorOffset: 0,
      nextCursor: null,
      maxPayloadItems: DEFAULT_MCP_PAYLOAD_ITEMS,
      payloadResultCount: 0,
      payloadTruncated: false,
      resultCount: Number(resolved.summary && resolved.summary.fileCount ? resolved.summary.fileCount : 0),
      files: [],
    };
  }

  const maxPayloadItems = parseOptionalPositiveInteger(args && args.maxPayloadItems, {
    label: 'zeus.fetch maxPayloadItems',
    min: 1,
    max: MAX_MCP_PAYLOAD_ITEMS,
  });
  const cursorState = decodeMcpCursor('zeus.fetch', args && args.cursor);
  const payloadLimit = Number.isInteger(maxPayloadItems) ? maxPayloadItems : DEFAULT_MCP_PAYLOAD_ITEMS;
  const rawFiles = Array.isArray(resolved.manifest && resolved.manifest.files)
    ? resolved.manifest.files
    : [];
  const files = rawFiles
    .map((entry) => {
      const origin = getImportManifestEntryOrigin(entry);
      const exportInfo = getImportManifestEntryExport(entry, resolved.manifest);
      const validation = getImportManifestEntryValidation(entry);
      return {
        sourceLib: origin.sourceLib ? String(origin.sourceLib) : '',
        sourceFile: origin.sourceFile ? String(origin.sourceFile) : '',
        member: origin.member ? String(origin.member) : '',
        sourceType: origin.sourceType ? String(origin.sourceType) : '',
        memberPath: origin.memberPath ? String(origin.memberPath) : '',
        remotePath: origin.remotePath ? String(origin.remotePath) : '',
        localPath: origin.localPath ? String(origin.localPath) : '',
        export: {
          status: exportInfo.status ? String(exportInfo.status) : 'unknown',
          transportRequested: exportInfo.transportRequested ? String(exportInfo.transportRequested) : null,
          transportUsed: exportInfo.transportUsed ? String(exportInfo.transportUsed) : null,
          fallbackUsed: Boolean(exportInfo.fallbackUsed),
          streamFileCcsid: Number(exportInfo.streamFileCcsid) || null,
          encodingPolicy: exportInfo.encodingPolicy ? String(exportInfo.encodingPolicy) : null,
        },
        validation: {
          status: validation.status ? String(validation.status) : 'invalid',
          exists: Boolean(validation.exists),
          sizeBytes: Number(validation.sizeBytes) || 0,
          sha256: validation.sha256 ? String(validation.sha256) : null,
          utf8Valid: Boolean(validation.utf8Valid),
          newlineStyle: validation.newlineStyle ? String(validation.newlineStyle) : 'UNKNOWN',
          messageCount: Array.isArray(validation.messages) ? validation.messages.length : 0,
        },
      };
    })
    .sort((left, right) => {
      if (left.localPath !== right.localPath) {
        return left.localPath.localeCompare(right.localPath);
      }
      if (left.sourceFile !== right.sourceFile) {
        return left.sourceFile.localeCompare(right.sourceFile);
      }
      return left.member.localeCompare(right.member);
    });

  const offset = cursorState.offset;
  if (!Number.isFinite(offset) || offset < 0 || offset > files.length) {
    throw createInvalidCursorError('zeus.fetch', 'cursor is outside available result range.');
  }
  const payloadFiles = files.slice(offset, offset + payloadLimit);
  const nextOffset = offset + payloadFiles.length;
  const nextCursor = nextOffset < files.length
    ? encodeMcpCursor('zeus.fetch', nextOffset)
    : null;

  return {
    operation: 'files',
    profile: resolved.profile,
    fetchRoot: resolved.fetchRoot,
    manifestPath: resolved.manifestPath,
    summary: resolved.summary,
    cursor: cursorState.cursor,
    cursorOffset: offset,
    nextCursor,
    maxPayloadItems: payloadLimit,
    payloadResultCount: payloadFiles.length,
    payloadTruncated: nextCursor !== null,
    resultCount: files.length,
    files: payloadFiles,
  };
}

function resolveTestRunManifestPath(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
  const manifestArg = args && typeof args.manifest === 'string'
    ? args.manifest.trim()
    : '';
  if (!manifestArg) {
    const error = new Error('Invalid arguments for zeus.test-run: manifest is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const manifestPath = path.resolve(cwd, manifestArg);
  assertPathWithinCwd({
    toolName: 'zeus.test-run',
    optionName: '--manifest',
    rawValue: manifestArg,
    resolvedPath: manifestPath,
    cwd,
  });
  return manifestPath;
}

function buildTestRunSnapshotSummaryEntries(snapshots = {}) {
  return Object.entries(snapshots)
    .map(([tableKey, entry]) => {
      const before = entry && entry.before && typeof entry.before === 'object'
        ? entry.before
        : null;
      const after = entry && entry.after && typeof entry.after === 'object'
        ? entry.after
        : null;
      const diff = entry && entry.diff && typeof entry.diff === 'object'
        ? entry.diff
        : null;
      const changedRows = Array.isArray(diff && diff.changedRows) ? diff.changedRows : [];
      return {
        table: String(tableKey || ''),
        beforeRowCount: before && Array.isArray(before.rows) ? before.rows.length : 0,
        afterRowCount: after && Array.isArray(after.rows) ? after.rows.length : 0,
        beforeCapturedAt: before && before.timestamp ? String(before.timestamp) : null,
        afterCapturedAt: after && after.timestamp ? String(after.timestamp) : null,
        afterHasError: Boolean(after && after.error),
        changedRowCount: changedRows.length,
      };
    })
    .sort((left, right) => left.table.localeCompare(right.table));
}

async function executeReadOnlyTestRun(args = {}, context = {}) {
  const operation = args && typeof args.operation === 'string'
    ? args.operation.trim().toLowerCase()
    : '';
  if (!operation) {
    const error = new Error('Invalid arguments for zeus.test-run: operation is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (operation !== 'show' && operation !== 'rollback') {
    const error = new Error('Invalid arguments for zeus.test-run: operation must be show or rollback.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const manifestPath = resolveTestRunManifestPath(args, context);
  let manifest;
  try {
    manifest = loadTestRunManifest(manifestPath);
  } catch (error) {
    const wrapped = new Error(`Failed to read test-run manifest at ${manifestPath}: ${error.message}`);
    wrapped.code = 'TOOL_INVALID_ARGUMENTS';
    throw wrapped;
  }
  const snapshots = manifest && manifest.snapshots && typeof manifest.snapshots === 'object'
    ? manifest.snapshots
    : {};
  const snapshotSummaries = buildTestRunSnapshotSummaryEntries(snapshots);
  const rollbackSql = Array.isArray(manifest && manifest.rollbackSql)
    ? manifest.rollbackSql.map((statement) => String(statement))
    : [];

  const base = {
    profile: null,
    manifestPath,
    manifest: {
      kind: manifest && manifest.kind ? String(manifest.kind) : null,
      schemaVersion: Number(manifest && manifest.schemaVersion ? manifest.schemaVersion : 0),
      runId: manifest && manifest.runId ? String(manifest.runId) : null,
      label: manifest && manifest.label ? String(manifest.label) : null,
      program: manifest && manifest.program ? String(manifest.program) : null,
      status: manifest && manifest.status ? String(manifest.status) : null,
      createdAt: manifest && manifest.createdAt ? String(manifest.createdAt) : null,
      capturedAt: manifest && manifest.capturedAt ? String(manifest.capturedAt) : null,
      tableCount: Array.isArray(manifest && manifest.tables) ? manifest.tables.length : 0,
      tables: Array.isArray(manifest && manifest.tables)
        ? manifest.tables.map((table) => String(table)).sort((left, right) => left.localeCompare(right))
        : [],
      snapshotCount: snapshotSummaries.length,
      rollbackStatementCount: rollbackSql.length,
    },
    snapshots: snapshotSummaries,
  };

  if (operation === 'show') {
    return {
      operation: 'show',
      ...base,
      maxPayloadItems: DEFAULT_MCP_PAYLOAD_ITEMS,
      payloadResultCount: 0,
      payloadTruncated: false,
      rollbackStatements: [],
    };
  }

  const maxPayloadItems = parseOptionalPositiveInteger(args && args.maxPayloadItems, {
    label: 'zeus.test-run maxPayloadItems',
    min: 1,
    max: MAX_MCP_PAYLOAD_ITEMS,
  });
  const payloadLimit = Number.isInteger(maxPayloadItems) ? maxPayloadItems : DEFAULT_MCP_PAYLOAD_ITEMS;
  const payloadStatements = rollbackSql.slice(0, payloadLimit);
  return {
    operation: 'rollback',
    ...base,
    maxPayloadItems: payloadLimit,
    payloadResultCount: payloadStatements.length,
    payloadTruncated: rollbackSql.length > payloadStatements.length,
    rollbackStatements: payloadStatements,
  };
}

async function executeReadOnlyCopyToWorkspace(args = {}, context = {}) {
  const operation = args && typeof args.operation === 'string'
    ? args.operation.trim().toLowerCase()
    : '';
  if (!operation) {
    const error = new Error('Invalid arguments for zeus.copy-to-workspace: operation is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (operation !== 'plan') {
    const error = new Error('Invalid arguments for zeus.copy-to-workspace: operation must be plan.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const cwd = context.cwd || process.cwd();
  const env = context.env || process.env;
  const profileName = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  if (!profileName) {
    const error = new Error('Missing required option: --profile <name>');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, profileName, { env });
  const fetchConfig = resolveFetchConfig(args, { cwd, env });
  const workCopyConfig = readWorkCopyConfig(profile, env);
  const sourceRootInput = String(fetchConfig.out || '').trim();
  const targetRootInput = String(workCopyConfig.root || '').trim();
  const sourceRoot = path.resolve(cwd, sourceRootInput);
  const targetRoot = path.resolve(cwd, targetRootInput);
  assertPathWithinCwd({
    toolName: 'zeus.copy-to-workspace',
    optionName: '--out',
    rawValue: sourceRootInput,
    resolvedPath: sourceRoot,
    cwd,
  });
  assertPathWithinCwd({
    toolName: 'zeus.copy-to-workspace',
    optionName: 'workCopy.root',
    rawValue: targetRootInput,
    resolvedPath: targetRoot,
    cwd,
  });
  if (!fs.existsSync(sourceRoot)) {
    const error = new Error(`Fetch output directory not found: ${sourceRoot}`);
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const workCopyMode = String(workCopyConfig.extension || '').trim().toLowerCase();
  const force = Boolean(args && args.force === true);
  const requestedMembers = parseWorkCopyMembersCsv(args && args.members);
  const requestedMemberSet = new Set(requestedMembers);
  const discovered = discoverFetchedSources(sourceRoot);
  const selectedEntries = requestedMemberSet.size > 0
    ? discovered.filter((entry) => requestedMemberSet.has(String(entry.member || '').toUpperCase()))
    : discovered;

  const planEntries = selectedEntries.map((entry) => {
    const targetName = buildWorkCopyTargetName(entry, workCopyMode);
    const targetPath = path.join(targetRoot, targetName);
    const targetExists = fs.existsSync(targetPath);
    let status = 'will copy';
    let note = '';
    if (targetExists && force) {
      status = 'will overwrite';
      note = 'Target exists and would be overwritten with --force.';
    } else if (targetExists) {
      status = 'already exists';
      note = 'Use --force to overwrite.';
    }
    return {
      status,
      member: String(entry.member || ''),
      source: String(entry.relativePath || ''),
      target: path.relative(cwd, targetPath).replace(/\\/g, '/'),
      note,
    };
  });

  if (requestedMemberSet.size > 0) {
    const selectedMemberSet = new Set(selectedEntries.map((entry) => String(entry.member || '').toUpperCase()));
    for (const requestedMember of Array.from(requestedMemberSet).sort((left, right) => left.localeCompare(right))) {
      if (selectedMemberSet.has(requestedMember)) {
        continue;
      }
      planEntries.push({
        status: 'skipped',
        member: requestedMember,
        source: '',
        target: '',
        note: 'No fetched source found for requested member.',
      });
    }
  }

  const sortedPlanEntries = planEntries.sort((left, right) => {
    if (String(left.member || '') !== String(right.member || '')) {
      return String(left.member || '').localeCompare(String(right.member || ''));
    }
    if (String(left.source || '') !== String(right.source || '')) {
      return String(left.source || '').localeCompare(String(right.source || ''));
    }
    return String(left.target || '').localeCompare(String(right.target || ''));
  });
  const maxPayloadItems = parseOptionalPositiveInteger(args && args.maxPayloadItems, {
    label: 'zeus.copy-to-workspace maxPayloadItems',
    min: 1,
    max: MAX_MCP_PAYLOAD_ITEMS,
  });
  const cursorState = decodeMcpCursor('zeus.copy-to-workspace', args && args.cursor);
  const payloadLimit = Number.isInteger(maxPayloadItems) ? maxPayloadItems : DEFAULT_MCP_PAYLOAD_ITEMS;
  const offset = cursorState.offset;
  if (!Number.isFinite(offset) || offset < 0 || offset > sortedPlanEntries.length) {
    throw createInvalidCursorError('zeus.copy-to-workspace', 'cursor is outside available result range.');
  }
  const payloadEntries = sortedPlanEntries.slice(offset, offset + payloadLimit);
  const nextOffset = offset + payloadEntries.length;
  const nextCursor = nextOffset < sortedPlanEntries.length
    ? encodeMcpCursor('zeus.copy-to-workspace', nextOffset)
    : null;

  const counts = {
    copyCandidateCount: sortedPlanEntries.filter((entry) => entry.status === 'will copy' || entry.status === 'will overwrite').length,
    overwriteCount: sortedPlanEntries.filter((entry) => entry.status === 'will overwrite').length,
    existingCount: sortedPlanEntries.filter((entry) => entry.status === 'already exists').length,
    skippedCount: sortedPlanEntries.filter((entry) => entry.status === 'skipped').length,
  };

  return {
    operation: 'plan',
    profile: profileName,
    sourceRoot,
    targetRoot,
    workCopyMode,
    force,
    requestedMemberCount: requestedMembers.length,
    discoveredCount: discovered.length,
    selectedCount: selectedEntries.length,
    ...counts,
    cursor: cursorState.cursor,
    cursorOffset: offset,
    nextCursor,
    maxPayloadItems: payloadLimit,
    payloadResultCount: payloadEntries.length,
    payloadTruncated: nextCursor !== null,
    resultCount: sortedPlanEntries.length,
    entries: payloadEntries,
  };
}

function normalizeServeHost(value) {
  const normalized = String(value || DEFAULT_UI_HOST).trim();
  if (!normalized || normalized === 'localhost') {
    return DEFAULT_UI_HOST;
  }
  if (normalized === '127.0.0.1' || normalized === '::1') {
    return normalized;
  }
  const error = new Error('Invalid arguments for zeus.serve: host must be localhost, 127.0.0.1, or ::1.');
  error.code = 'TOOL_INVALID_ARGUMENTS';
  throw error;
}

function parseServePort(value) {
  if (value === undefined || value === null) {
    return DEFAULT_UI_PORT;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    const error = new Error('Invalid arguments for zeus.serve: port must be a non-negative integer.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  return parsed;
}

async function executeReadOnlyServe(args = {}, context = {}) {
  const operation = args && typeof args.operation === 'string'
    ? args.operation.trim().toLowerCase()
    : '';
  if (!operation) {
    const error = new Error('Invalid arguments for zeus.serve: operation is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (operation !== 'summary') {
    const error = new Error('Invalid arguments for zeus.serve: operation must be summary.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const cwd = context.cwd || process.cwd();
  const env = context.env || process.env;
  const profileName = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  const profiles = loadProfiles({ cwd, env, args });
  const profile = profileName ? resolveProfile(profiles, profileName, { env }) : null;

  const bundleConfig = resolveBundleConfig(args, { cwd, env });
  const outputRootInput = String(bundleConfig && bundleConfig.sourceOutputRoot ? bundleConfig.sourceOutputRoot : 'output').trim();
  const outputRoot = path.resolve(cwd, outputRootInput || 'output');
  assertPathWithinCwd({
    toolName: 'zeus.serve',
    optionName: '--source-output-root',
    rawValue: outputRootInput,
    resolvedPath: outputRoot,
    cwd,
  });

  const host = normalizeServeHost(args && args.host);
  const port = parseServePort(args && args.port);
  const hasRegistryConfig = Boolean(
    (args && (args.registryPath || args['registry-path']))
    || env.ZEUS_ANALYSES_REGISTRY
    || (profile && profile.analysesRegistryPath),
  );
  const registryPath = hasRegistryConfig
    ? resolveRegistryPath({
      registryPath: args && (args.registryPath || args['registry-path']) ? (args.registryPath || args['registry-path']) : undefined,
      profile,
      env,
      cwd,
    })
    : null;
  if (args && (typeof args.registryPath === 'string' || typeof args['registry-path'] === 'string')) {
    const registryArg = typeof args.registryPath === 'string' ? args.registryPath : args['registry-path'];
    assertPathWithinCwd({
      toolName: 'zeus.serve',
      optionName: '--registry-path',
      rawValue: registryArg,
      resolvedPath: registryPath,
      cwd,
    });
  }

  const outputRootExists = fs.existsSync(outputRoot) && fs.statSync(outputRoot).isDirectory();
  const runs = outputRootExists ? listAnalysisRuns(outputRoot) : [];
  const workspaces = registryPath ? listWorkspaces(registryPath) : [];
  const latestRun = runs.length > 0 ? runs[0] : null;
  const bindUrl = port > 0
    ? `http://${host === '::1' ? '[::1]' : host}:${port}`
    : null;

  return {
    operation: 'summary',
    profile: profileName || null,
    outputRoot,
    outputRootExists,
    host,
    port,
    bindUrl,
    registryPath,
    registryConfigured: Boolean(registryPath),
    registryExists: Boolean(registryPath && fs.existsSync(registryPath)),
    workspaceCount: workspaces.length,
    runCount: runs.length,
    latestRun: latestRun
      ? {
        program: latestRun.program ? String(latestRun.program) : '',
        status: latestRun.status ? String(latestRun.status) : null,
        completedAt: latestRun.completedAt ? String(latestRun.completedAt) : null,
        artifactCount: Number(latestRun.artifactCount || 0),
        safeSharingEnabled: Boolean(latestRun.safeSharingEnabled),
      }
      : null,
    apiRoutes: [
      '/api/health',
      '/api/runs',
      '/api/runs/:program',
      '/api/runs/:program/views',
      '/api/runs/:program/artifacts/content',
      '/api/analyses',
      '/api/analyses/:workspaceId',
      '/api/analyses/:workspaceId/index',
      '/api/analyses/:workspaceId/touch',
      '/api/prompt-builder/contracts',
      '/api/prompt-builder/use-cases',
      '/api/prompt-builder/modules',
      '/api/prompt-builder/preview',
      '/api/prompt-builder/templates',
      '/api/prompt-builder/templates/:templateId',
      '/api/prompt-builder/context-sources',
      '/api/prompt-builder/context-sources/:program/prompts',
      '/api/prompt-builder/context-sources/import',
    ],
  };
}

function parseBridgeOperation(operation) {
  const normalized = typeof operation === 'string'
    ? operation.trim().toLowerCase()
    : '';
  if (!normalized) {
    const error = new Error('Invalid arguments for zeus.bridge: operation is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (!['plan', 'report', 'stage', 'compile-run'].includes(normalized)) {
    const error = new Error('Invalid arguments for zeus.bridge: operation must be plan, report, stage, or compile-run.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  return normalized;
}

function normalizeBridgeDryRunFlag(args = {}) {
  const value = Object.prototype.hasOwnProperty.call(args, 'dryRun')
    ? args.dryRun
    : args['dry-run'];
  return parseOptionalBooleanFlag(value, true);
}

function assertBridgePreviewPolicy(operation, dryRun) {
  if (operation === 'stage' || operation === 'compile-run') {
    if (dryRun === true) {
      return;
    }
    const error = new Error(
      `Tool is not allowed by MCP policy: zeus.bridge operation=${operation} requires dryRun=true.`,
    );
    error.code = 'TOOL_NOT_ALLOWED';
    throw error;
  }
}

function normalizeBridgeRunnerError(error) {
  if (error && (error.code === 'TOOL_NOT_ALLOWED' || error.code === 'TOOL_INVALID_ARGUMENTS')) {
    throw error;
  }

  const code = error && error.code ? String(error.code) : '';
  const message = String(error && error.message ? error.message : '');
  if (code === 'BRIDGE_DISABLED' || code === 'TARGET_NOT_ALLOWLISTED' || code === 'BRIDGE_EXECUTION_NOT_IMPLEMENTED') {
    const wrapped = new Error(message || 'Tool is not allowed by MCP policy: zeus.bridge refused by bridge policy.');
    wrapped.code = 'TOOL_NOT_ALLOWED';
    throw wrapped;
  }

  if (
    error && error.name === 'BridgeRefusalError'
  ) {
    const wrapped = new Error(message || 'Bridge preview request was refused.');
    wrapped.code = 'TOOL_INVALID_ARGUMENTS';
    throw wrapped;
  }

  if (
    /invalid arguments for zeus\.bridge/i.test(message)
    || /missing required option: --/i.test(message)
    || /unknown bridge subcommand/i.test(message)
    || /profile ".+" not found/i.test(message)
  ) {
    const wrapped = new Error(message || 'Invalid arguments for zeus.bridge.');
    wrapped.code = 'TOOL_INVALID_ARGUMENTS';
    throw wrapped;
  }

  throw error;
}

async function executeReadOnlyBridge(args = {}, context = {}) {
  const operation = parseBridgeOperation(args && args.operation);
  const profile = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  const program = args && typeof args.program === 'string'
    ? args.program.trim()
    : '';
  if (!profile) {
    const error = new Error('Invalid arguments for zeus.bridge: profile is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (!program) {
    const error = new Error('Invalid arguments for zeus.bridge: program is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (operation === 'plan') {
    const source = args && typeof args.source === 'string' ? args.source.trim() : '';
    if (!source) {
      const error = new Error('Invalid arguments for zeus.bridge: source is required for operation=plan.');
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }
  }

  const dryRun = normalizeBridgeDryRunFlag(args);
  assertBridgePreviewPolicy(operation, dryRun);

  const bridgeRunner = typeof context.bridgeRunner === 'function'
    ? context.bridgeRunner
    : executeBridgeCommand;

  const runnerArgs = {
    _: [operation],
    profile,
    program,
    ...(operation === 'stage' || operation === 'compile-run' ? { 'dry-run': true } : {}),
    ...(args && typeof args.source === 'string' && args.source.trim() ? { source: args.source.trim() } : {}),
    ...(args && typeof args.targetType === 'string' && args.targetType.trim() ? { 'target-type': args.targetType.trim() } : {}),
    ...(args && typeof args.targetLib === 'string' && args.targetLib.trim() ? { 'target-lib': args.targetLib.trim() } : {}),
    ...(args && typeof args.targetFile === 'string' && args.targetFile.trim() ? { 'target-file': args.targetFile.trim() } : {}),
    ...(args && typeof args.targetMember === 'string' && args.targetMember.trim() ? { 'target-member': args.targetMember.trim() } : {}),
    ...(args && typeof args.targetMemberType === 'string' && args.targetMemberType.trim() ? { 'target-member-type': args.targetMemberType.trim() } : {}),
    ...(args && typeof args.targetIfs === 'string' && args.targetIfs.trim() ? { 'target-ifs': args.targetIfs.trim() } : {}),
    ...(args && typeof args.beforeHash === 'string' && args.beforeHash.trim() ? { 'before-hash': args.beforeHash.trim() } : {}),
    ...(args && typeof args.afterHash === 'string' && args.afterHash.trim() ? { 'after-hash': args.afterHash.trim() } : {}),
    ...(args && typeof args.diffSummary === 'string' && args.diffSummary.trim() ? { 'diff-summary': args.diffSummary.trim() } : {}),
    ...(args && typeof args.riskLevel === 'string' && args.riskLevel.trim() ? { 'risk-level': args.riskLevel.trim() } : {}),
    ...(args && typeof args.actorMode === 'string' && args.actorMode.trim() ? { 'actor-mode': args.actorMode.trim() } : {}),
    ...(args && typeof args.approvalFile === 'string' && args.approvalFile.trim() ? { 'approval-file': args.approvalFile.trim() } : {}),
    ...(args && typeof args.template === 'string' && args.template.trim() ? { template: args.template.trim() } : {}),
  };

  let execution;
  try {
    execution = await bridgeRunner(runnerArgs, {
      cwd: context.cwd || process.cwd(),
      env: context.env || process.env,
    });
  } catch (error) {
    normalizeBridgeRunnerError(error);
  }

  const approval = execution && execution.approval && typeof execution.approval === 'object'
    ? execution.approval
    : null;
  return {
    operation,
    profile,
    program: execution && execution.program ? String(execution.program) : program.toUpperCase(),
    dryRun: operation === 'stage' || operation === 'compile-run' ? true : null,
    status: execution && execution.status ? String(execution.status) : (operation === 'report' ? 'reported' : 'planned'),
    plan: execution && execution.plan && typeof execution.plan === 'object'
      ? {
        planId: execution.plan.planId ? String(execution.plan.planId) : null,
        planHash: execution.plan.planHash ? String(execution.plan.planHash) : null,
        riskLevel: execution.plan.riskLevel ? String(execution.plan.riskLevel) : null,
        targetType: execution.plan.targetType ? String(execution.plan.targetType) : null,
        remoteTarget: execution.plan.remoteTarget && typeof execution.plan.remoteTarget === 'object'
          ? execution.plan.remoteTarget
          : null,
      }
      : null,
    compileTemplateId: execution && execution.compileTemplateId ? String(execution.compileTemplateId) : null,
    reason: execution && execution.reason ? String(execution.reason) : null,
    approval: approval
      ? {
        required: Boolean(approval.required),
        status: approval.status ? String(approval.status) : null,
        code: approval.code ? String(approval.code) : null,
        message: approval.message ? String(approval.message) : null,
        planPath: approval.planPath ? String(approval.planPath) : null,
        approvalPath: approval.approvalPath ? String(approval.approvalPath) : null,
        planId: approval.planId ? String(approval.planId) : null,
        planHash: approval.planHash ? String(approval.planHash) : null,
      }
      : null,
    artifacts: execution && execution.artifacts && typeof execution.artifacts === 'object'
      ? {
        jsonPath: execution.artifacts.jsonPath ? String(execution.artifacts.jsonPath) : null,
        mdPath: execution.artifacts.mdPath ? String(execution.artifacts.mdPath) : null,
      }
      : null,
    expectedArtifacts: execution && execution.expectedArtifacts && typeof execution.expectedArtifacts === 'object'
      ? execution.expectedArtifacts
      : null,
    auditPath: execution && execution.auditPath ? String(execution.auditPath) : null,
  };
}

function parseWriteSqlMode(mode) {
  const normalized = mode === undefined || mode === null
    ? 'upsert'
    : String(mode).trim().toLowerCase();
  if (!['upsert-sql', 'upsert', 'insert', 'update'].includes(normalized)) {
    const error = new Error('Invalid arguments for zeus.write-sql: mode must be one of upsert-sql, upsert, insert, update.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  return resolveWriteMode(normalized).command;
}

function parseWriteOperation(operation) {
  const normalized = typeof operation === 'string'
    ? operation.trim().toLowerCase()
    : '';
  if (!normalized) {
    const error = new Error('Invalid arguments for zeus.write-sql: operation is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (normalized !== 'plan' && normalized !== 'apply') {
    const error = new Error('Invalid arguments for zeus.write-sql: operation must be plan or apply.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  return normalized;
}

function isTruthyEnvFlag(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseConfigBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePositiveIntegerOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseOptionalMaxRowsAffectedArg(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const error = new Error('Invalid arguments for zeus.write-sql: maxRowsAffected must be a positive integer.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  return parsed;
}

function hashSql(sql) {
  return crypto.createHash('sha256').update(String(sql || ''), 'utf8').digest('hex');
}

function detectSqlStatementType(sql) {
  const match = String(sql || '').trim().match(/^([A-Za-z]+)/);
  return match ? String(match[1]).toUpperCase() : 'UNKNOWN';
}

function normalizeSqlIdentifier(value) {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }
  if (
    (input.startsWith('"') && input.endsWith('"'))
    || (input.startsWith('`') && input.endsWith('`'))
    || (input.startsWith('[') && input.endsWith(']'))
  ) {
    const inner = input.slice(1, -1);
    return inner.replace(/""/g, '"').toUpperCase();
  }
  return input.toUpperCase();
}

function parseQualifiedTableIdentifier(rawIdentifier) {
  const token = String(rawIdentifier || '').trim().replace(/[;,]+$/g, '');
  if (!token) {
    return null;
  }
  const compactToken = token.replace(/\s+/g, '');
  if (!compactToken) {
    return null;
  }
  const parts = compactToken
    .split('.')
    .map((entry) => normalizeSqlIdentifier(entry))
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const table = parts[parts.length - 1];
  const schema = parts.length > 1 ? parts[parts.length - 2] : null;
  if (!table) {
    return null;
  }
  return {
    schema,
    table,
    qualifiedName: schema ? `${schema}.${table}` : table,
  };
}

function resolveWriteTargetTable(sql) {
  const normalizedSql = String(sql || '').trim();
  const patterns = [
    /^\s*INSERT\s+INTO\s+([^\s(]+)/i,
    /^\s*UPDATE\s+([^\s(]+)/i,
    /^\s*DELETE\s+FROM\s+([^\s(]+)/i,
    /^\s*MERGE\s+INTO\s+([^\s(]+)/i,
  ];
  for (const pattern of patterns) {
    const match = normalizedSql.match(pattern);
    if (match && match[1]) {
      const parsed = parseQualifiedTableIdentifier(match[1]);
      if (parsed) {
        return parsed;
      }
    }
  }
  return null;
}

function normalizeWriteTableAllowlist(rawAllowTables) {
  if (!Array.isArray(rawAllowTables)) {
    return [];
  }
  const dedupe = new Set();
  const normalized = [];
  for (const entry of rawAllowTables) {
    const parsed = parseQualifiedTableIdentifier(entry);
    if (!parsed || !parsed.table) {
      continue;
    }
    if (dedupe.has(parsed.qualifiedName)) {
      continue;
    }
    dedupe.add(parsed.qualifiedName);
    normalized.push(parsed);
  }
  return normalized;
}

function evaluateWriteTableAllowlist({ sql, allowTables }) {
  const normalizedAllowTables = normalizeWriteTableAllowlist(allowTables);
  const target = resolveWriteTargetTable(sql);
  const allowlistEnabled = normalizedAllowTables.length > 0;
  let tableAllowed = true;
  let blockReason = null;

  if (allowlistEnabled) {
    if (!target || !target.table) {
      tableAllowed = false;
      blockReason = 'Unable to resolve target table from SQL while write-table allowlist is active.';
    } else {
      tableAllowed = normalizedAllowTables.some((entry) => {
        if (entry.table !== target.table) {
          return false;
        }
        if (!target.schema) {
          return !entry.schema;
        }
        if (!entry.schema) {
          return true;
        }
        return entry.schema === target.schema;
      });
      if (!tableAllowed) {
        blockReason = `Target table ${target.qualifiedName} is not allowlisted for this profile.`;
      }
    }
  }

  return {
    allowlistEnabled,
    tableAllowed,
    blockReason,
    targetSchema: target && target.schema ? target.schema : null,
    targetTable: target && target.table ? target.table : null,
    targetQualifiedName: target && target.qualifiedName ? target.qualifiedName : null,
    allowTables: normalizedAllowTables.map((entry) => entry.qualifiedName),
  };
}

function tokenizeTopLevelSqlKeywords(sql) {
  const text = String(sql || '');
  const tokens = [];
  let depth = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1] || '';

    if (char === '\'' ) {
      index += 1;
      while (index < text.length) {
        if (text[index] === '\'' && text[index + 1] === '\'') {
          index += 2;
          continue;
        }
        if (text[index] === '\'') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === '"' ) {
      index += 1;
      while (index < text.length) {
        if (text[index] === '"' && text[index + 1] === '"') {
          index += 2;
          continue;
        }
        if (text[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      index += 2;
      while (index < text.length && text[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length) {
        if (text[index] === '*' && text[index + 1] === '/') {
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === '(') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (end < text.length && /[A-Za-z0-9_$#]/.test(text[end])) {
        end += 1;
      }
      const keyword = text.slice(index, end).toUpperCase();
      if (depth === 0) {
        tokens.push(keyword);
      }
      index = end;
      continue;
    }

    index += 1;
  }
  return tokens;
}

function extractTopLevelWhereClause(sql) {
  const text = String(sql || '');
  let depth = 0;
  let index = 0;
  let whereStart = -1;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1] || '';

    if (char === '\'') {
      index += 1;
      while (index < text.length) {
        if (text[index] === '\'' && text[index + 1] === '\'') {
          index += 2;
          continue;
        }
        if (text[index] === '\'') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === '"') {
      index += 1;
      while (index < text.length) {
        if (text[index] === '"' && text[index + 1] === '"') {
          index += 2;
          continue;
        }
        if (text[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === '-' && next === '-') {
      index += 2;
      while (index < text.length && text[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length) {
        if (text[index] === '*' && text[index + 1] === '/') {
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === '(') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth === 0 && /[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (end < text.length && /[A-Za-z0-9_$#]/.test(text[end])) {
        end += 1;
      }
      const keyword = text.slice(index, end).toUpperCase();
      if (keyword === 'WHERE') {
        whereStart = index;
        break;
      }
      index = end;
      continue;
    }
    index += 1;
  }

  if (whereStart < 0) {
    return '';
  }
  const whereKeywordLength = 5;
  return text.slice(whereStart + whereKeywordLength).trim();
}

function isTrivialAlwaysTrueWhereClause(whereClause) {
  const compact = String(whereClause || '')
    .replace(/[;\s]+$/g, '')
    .trim()
    .replace(/^\(+/, '')
    .replace(/\)+$/, '')
    .replace(/\s+/g, '')
    .toUpperCase();

  if (!compact) {
    return true;
  }
  return compact === '1=1'
    || compact === '0=0'
    || compact === 'TRUE'
    || compact === '1<>0'
    || compact === '0<>1'
    || compact === '1<=1'
    || compact === '1>=1';
}

function stripSingleQuotedSqlLiterals(text) {
  const input = String(text || '');
  let output = '';
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char !== '\'') {
      output += char;
      index += 1;
      continue;
    }
    index += 1;
    while (index < input.length) {
      if (input[index] === '\'' && input[index + 1] === '\'') {
        index += 2;
        continue;
      }
      if (input[index] === '\'') {
        index += 1;
        break;
      }
      index += 1;
    }
    output += '\'\'';
  }
  return output;
}

function detectWeakWherePredicate(whereClause) {
  const raw = String(whereClause || '').trim().replace(/[;]+$/g, '');
  if (!raw) {
    return null;
  }
  const sanitized = stripSingleQuotedSqlLiterals(raw).toUpperCase();
  const collapsed = sanitized.replace(/\s+/g, ' ').trim();

  if (/\bOR\s+1\s*=\s*1\b/.test(collapsed) || /\bOR\s+TRUE\b/.test(collapsed)) {
    return 'Predicate is too weak for MCP apply (contains OR tautology such as OR 1=1).';
  }

  if (/^\(*\s*[A-Z0-9_.$#@\[\]"]+\s+IS\s+NOT\s+NULL\s*\)*$/.test(collapsed)) {
    return 'Predicate is too weak for MCP apply (single-column IS NOT NULL filter).';
  }

  if (/^\(*\s*[A-Z0-9_.$#@\[\]"]+\s+LIKE\s+'%+'\s*\)*$/i.test(raw)) {
    return "Predicate is too weak for MCP apply (LIKE '%' matches broadly).";
  }

  return null;
}

function resolveWriteRowSafetyPolicy({ config, requestedMaxRowsAffected, statementType }) {
  const rowSafety = config
    && config.testData
    && config.testData.writeSafety
    && typeof config.testData.writeSafety === 'object'
    ? config.testData.writeSafety
    : {};
  const normalizedStatementType = String(statementType || '').trim().toUpperCase();
  const enabled = parseConfigBoolean(rowSafety.enabled, true);
  const baseLimit = parsePositiveIntegerOrNull(rowSafety.maxRowsAffected);
  const byStatement = rowSafety && typeof rowSafety.maxRowsByStatement === 'object'
    ? rowSafety.maxRowsByStatement
    : {};
  const byStatementLimit = parsePositiveIntegerOrNull(byStatement[normalizedStatementType.toLowerCase()])
    || parsePositiveIntegerOrNull(byStatement[normalizedStatementType]);
  const defaultLimit = (normalizedStatementType === 'UPDATE' || normalizedStatementType === 'DELETE') ? 100 : null;
  const configuredMaxRowsAffected = byStatementLimit || baseLimit || defaultLimit;
  const effectiveMaxRowsAffected = requestedMaxRowsAffected && configuredMaxRowsAffected
    ? Math.min(requestedMaxRowsAffected, configuredMaxRowsAffected)
    : (requestedMaxRowsAffected || configuredMaxRowsAffected);

  return {
    enabled,
    configuredMaxRowsAffected,
    requestedMaxRowsAffected,
    effectiveMaxRowsAffected: enabled ? effectiveMaxRowsAffected : null,
    clampApplied: Boolean(
      enabled
      && requestedMaxRowsAffected
      && configuredMaxRowsAffected
      && requestedMaxRowsAffected > configuredMaxRowsAffected
    ),
    blockWhenCountUnavailable: parseConfigBoolean(rowSafety.blockWhenCountUnavailable, true),
  };
}

function readCountValueFromQueryResult(result) {
  const rows = Array.isArray(result && result.rows) ? result.rows : [];
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    const direct = row.ROW_COUNT !== undefined ? row.ROW_COUNT : (row.row_count !== undefined ? row.row_count : row.count);
    if (direct !== undefined) {
      const parsed = Number(direct);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const firstValue = Object.values(row)[0];
    const parsed = Number(firstValue);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(row) && row.length > 0) {
    const parsed = Number(row[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(row);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildRowSafetyPreflightCountQuery({ targetQualifiedName, whereClause }) {
  const target = String(targetQualifiedName || '').trim();
  const predicate = String(whereClause || '').trim().replace(/[;]+$/g, '');
  if (!target || !predicate) {
    return null;
  }
  return `SELECT COUNT(*) AS ROW_COUNT FROM ${target} WHERE ${predicate}`;
}

function evaluateWriteStatementGuard({ statementType, sql }) {
  const normalizedType = String(statementType || '').trim().toUpperCase();
  const whereRequired = normalizedType === 'UPDATE' || normalizedType === 'DELETE';
  if (!whereRequired) {
    return {
      whereRequired: false,
      wherePresent: true,
      predicateSafe: true,
      blockReason: null,
    };
  }
  const tokens = tokenizeTopLevelSqlKeywords(sql);
  const wherePresent = tokens.includes('WHERE');
  const whereClause = wherePresent ? extractTopLevelWhereClause(sql) : '';
  const weakPredicateReason = wherePresent ? detectWeakWherePredicate(whereClause) : null;
  const predicateSafe = wherePresent
    ? !isTrivialAlwaysTrueWhereClause(whereClause) && !weakPredicateReason
    : false;
  let blockReason = null;
  if (!wherePresent) {
    blockReason = `${normalizedType} statements require a top-level WHERE clause for MCP apply.`;
  } else if (!predicateSafe) {
    blockReason = weakPredicateReason
      || `${normalizedType} statements require a non-trivial WHERE predicate for MCP apply.`;
  }
  return {
    whereRequired: true,
    wherePresent,
    predicateSafe,
    blockReason,
    whereClause,
  };
}

async function executeWriteSql(args = {}, context = {}) {
  const operation = parseWriteOperation(args && args.operation);
  const profileName = args && typeof args.profile === 'string'
    ? args.profile.trim()
    : '';
  const sql = args && typeof args.sql === 'string'
    ? args.sql.trim()
    : '';
  if (!profileName) {
    const error = new Error('Invalid arguments for zeus.write-sql: profile is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  if (!sql) {
    const error = new Error('Invalid arguments for zeus.write-sql: sql is required.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }
  const mode = parseWriteSqlMode(args && args.mode);
  const requestedMaxRowsAffected = parseOptionalMaxRowsAffectedArg(args && args.maxRowsAffected);
  try {
    validateWriteSql(sql, { mode });
  } catch (error) {
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const cwd = context.cwd || process.cwd();
  const env = context.env || process.env;
  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, profileName, { env });
  const productionSystem = Boolean(profile && profile.productionSystem);
  const config = resolveAnalyzeConfig(args, { cwd, env });
  const dbConfig = resolveAnalyzeDbConfig(config, 'metadata');
  if (!isDbConfigured(dbConfig)) {
    const error = new Error('DB2 connection configuration is incomplete for the selected profile.');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const sqlFingerprint = hashSql(sql);
  const statementType = detectSqlStatementType(sql);
  const tableAllowlistPolicy = evaluateWriteTableAllowlist({
    sql,
    allowTables: config && config.testData && Array.isArray(config.testData.allowTables)
      ? config.testData.allowTables
      : [],
  });
  const statementGuard = evaluateWriteStatementGuard({
    statementType,
    sql,
  });
  const rowSafetyPolicy = resolveWriteRowSafetyPolicy({
    config,
    requestedMaxRowsAffected,
    statementType,
  });
  const writesEnabled = isTruthyEnvFlag(env.ZEUS_MCP_ENABLE_WRITES);
  const expectedConfirmToken = typeof env.ZEUS_MCP_WRITE_CONFIRM_TOKEN === 'string'
    ? env.ZEUS_MCP_WRITE_CONFIRM_TOKEN
    : '';
  const providedConfirmToken = args && typeof args.confirmToken === 'string' && args.confirmToken.trim()
    ? args.confirmToken.trim()
    : (args && typeof args['confirm-token'] === 'string' ? args['confirm-token'].trim() : '');
  const confirmationRequired = operation === 'apply';
  const applyGateReasons = [];
  if (!writesEnabled) {
    applyGateReasons.push('MCP write execution is disabled. Set ZEUS_MCP_ENABLE_WRITES=true to enable apply.');
  }
  if (!expectedConfirmToken) {
    applyGateReasons.push('Missing ZEUS_MCP_WRITE_CONFIRM_TOKEN in MCP server environment.');
  }
  if (productionSystem) {
    applyGateReasons.push('Selected profile is marked as productionSystem=true; write execution is blocked.');
  }
  if (tableAllowlistPolicy.allowlistEnabled && !tableAllowlistPolicy.tableAllowed) {
    applyGateReasons.push(tableAllowlistPolicy.blockReason || 'Target table is not allowlisted for write execution.');
  }
  if (statementGuard.whereRequired && !statementGuard.wherePresent) {
    applyGateReasons.push(statementGuard.blockReason || 'Statement policy blocked write execution.');
  }
  if (statementGuard.whereRequired && statementGuard.wherePresent && !statementGuard.predicateSafe) {
    applyGateReasons.push(statementGuard.blockReason || 'Statement policy blocked write execution.');
  }
  const tokenReady = Boolean(expectedConfirmToken && providedConfirmToken && providedConfirmToken === expectedConfirmToken);
  const tokenMismatch = Boolean(expectedConfirmToken && providedConfirmToken && providedConfirmToken !== expectedConfirmToken);
  const canApply = applyGateReasons.length === 0 && tokenReady;

  const blockReasons = [];
  if (operation === 'apply' && !writesEnabled) {
    blockReasons.push('MCP write execution is disabled. Set ZEUS_MCP_ENABLE_WRITES=true to enable apply.');
  }
  if (operation === 'apply' && !expectedConfirmToken) {
    blockReasons.push('Missing ZEUS_MCP_WRITE_CONFIRM_TOKEN in MCP server environment.');
  }
  if (operation === 'apply' && expectedConfirmToken && providedConfirmToken !== expectedConfirmToken) {
    blockReasons.push('Invalid confirm token for zeus.write-sql apply.');
  }
  if (operation === 'apply' && productionSystem) {
    blockReasons.push('Selected profile is marked as productionSystem=true; write execution is blocked.');
  }
  if (operation === 'apply' && tableAllowlistPolicy.allowlistEnabled && !tableAllowlistPolicy.tableAllowed) {
    blockReasons.push(tableAllowlistPolicy.blockReason || 'Target table is not allowlisted for write execution.');
  }
  if (operation === 'apply' && statementGuard.whereRequired && !statementGuard.wherePresent) {
    blockReasons.push(statementGuard.blockReason || 'Statement policy blocked write execution.');
  }
  if (operation === 'apply' && statementGuard.whereRequired && statementGuard.wherePresent && !statementGuard.predicateSafe) {
    blockReasons.push(statementGuard.blockReason || 'Statement policy blocked write execution.');
  }

  if (operation === 'plan') {
    return {
      operation: 'plan',
      profile: profileName,
      mode,
      statementType,
      sqlLength: sql.length,
      sqlFingerprint,
      productionSystem,
      writesEnabled,
      confirmationRequired: false,
      tableAllowlistEnabled: tableAllowlistPolicy.allowlistEnabled,
      tableAllowed: tableAllowlistPolicy.tableAllowed,
      targetSchema: tableAllowlistPolicy.targetSchema,
      targetTable: tableAllowlistPolicy.targetTable,
      targetQualifiedName: tableAllowlistPolicy.targetQualifiedName,
      allowTables: tableAllowlistPolicy.allowTables,
      whereRequired: statementGuard.whereRequired,
      wherePresent: statementGuard.wherePresent,
      predicateSafe: statementGuard.predicateSafe,
      rowSafetyEnabled: rowSafetyPolicy.enabled,
      rowSafetyConfiguredMaxRowsAffected: rowSafetyPolicy.configuredMaxRowsAffected,
      rowSafetyRequestedMaxRowsAffected: rowSafetyPolicy.requestedMaxRowsAffected,
      rowSafetyEffectiveMaxRowsAffected: rowSafetyPolicy.effectiveMaxRowsAffected,
      rowSafetyClampApplied: rowSafetyPolicy.clampApplied,
      rowSafetyPreflightRequired: Boolean(
        rowSafetyPolicy.enabled
        && rowSafetyPolicy.effectiveMaxRowsAffected
        && (statementType === 'UPDATE' || statementType === 'DELETE')
      ),
      canApply,
      blockReasons: [
        ...applyGateReasons,
        ...(tokenMismatch ? ['Provided confirm token does not match ZEUS_MCP_WRITE_CONFIRM_TOKEN.'] : []),
        ...(!providedConfirmToken ? ['Apply requires confirmToken input.'] : []),
      ],
    };
  }

  if (blockReasons.length > 0) {
    const error = new Error(`Tool is not allowed by MCP policy: zeus.write-sql apply blocked. ${blockReasons.join(' ')}`);
    error.code = 'TOOL_NOT_ALLOWED';
    throw error;
  }

  let preflightRowEstimate = null;
  if (
    rowSafetyPolicy.enabled
    && rowSafetyPolicy.effectiveMaxRowsAffected
    && (statementType === 'UPDATE' || statementType === 'DELETE')
  ) {
    const preflightQuery = buildRowSafetyPreflightCountQuery({
      targetQualifiedName: tableAllowlistPolicy.targetQualifiedName,
      whereClause: statementGuard.whereClause,
    });
    if (!preflightQuery) {
      const error = new Error(
        'Tool is not allowed by MCP policy: zeus.write-sql apply blocked. Row-safety preflight could not resolve target table/predicate.',
      );
      error.code = 'TOOL_NOT_ALLOWED';
      throw error;
    }
    try {
      const preflightResult = runReadOnlyDb2Query({
        dbConfig,
        query: preflightQuery,
        maxRows: 1,
      });
      preflightRowEstimate = readCountValueFromQueryResult(preflightResult);
    } catch (error) {
      if (rowSafetyPolicy.blockWhenCountUnavailable) {
        const blocked = new Error(
          'Tool is not allowed by MCP policy: zeus.write-sql apply blocked. Row-safety preflight count query failed.',
        );
        blocked.code = 'TOOL_NOT_ALLOWED';
        throw blocked;
      }
    }
    if (Number.isFinite(preflightRowEstimate) && preflightRowEstimate > rowSafetyPolicy.effectiveMaxRowsAffected) {
      const error = new Error(
        `Tool is not allowed by MCP policy: zeus.write-sql apply blocked. Estimated affected rows (${preflightRowEstimate}) exceed row-safety limit (${rowSafetyPolicy.effectiveMaxRowsAffected}).`,
      );
      error.code = 'TOOL_NOT_ALLOWED';
      throw error;
    }
  }

  const result = runWriteDb2Query({
    dbConfig,
    sql,
  });
  return {
    operation: 'apply',
    profile: profileName,
    mode,
    statementType,
    sqlLength: sql.length,
    sqlFingerprint,
    productionSystem,
    writesEnabled,
    confirmationRequired,
    tableAllowlistEnabled: tableAllowlistPolicy.allowlistEnabled,
    tableAllowed: tableAllowlistPolicy.tableAllowed,
    targetSchema: tableAllowlistPolicy.targetSchema,
    targetTable: tableAllowlistPolicy.targetTable,
    targetQualifiedName: tableAllowlistPolicy.targetQualifiedName,
    allowTables: tableAllowlistPolicy.allowTables,
    whereRequired: statementGuard.whereRequired,
    wherePresent: statementGuard.wherePresent,
    predicateSafe: statementGuard.predicateSafe,
    rowSafetyEnabled: rowSafetyPolicy.enabled,
    rowSafetyConfiguredMaxRowsAffected: rowSafetyPolicy.configuredMaxRowsAffected,
    rowSafetyRequestedMaxRowsAffected: rowSafetyPolicy.requestedMaxRowsAffected,
    rowSafetyEffectiveMaxRowsAffected: rowSafetyPolicy.effectiveMaxRowsAffected,
    rowSafetyClampApplied: rowSafetyPolicy.clampApplied,
    rowSafetyPreflightRequired: Boolean(
      rowSafetyPolicy.enabled
      && rowSafetyPolicy.effectiveMaxRowsAffected
      && (statementType === 'UPDATE' || statementType === 'DELETE')
    ),
    preflightRowEstimate: Number.isFinite(preflightRowEstimate) ? Number(preflightRowEstimate) : null,
    rowsAffected: Number(result && result.rowsAffected ? result.rowsAffected : 0),
  };
}

async function executeReadOnlySearchSource(args = {}, context = {}) {
  const cwd = context.cwd || process.cwd();
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
  const resolvedSourceRoot = path.resolve(cwd, sourceRoot);
  assertPathWithinCwd({
    toolName: 'zeus.search-source',
    optionName: '--source-root',
    rawValue: sourceRoot,
    resolvedPath: resolvedSourceRoot,
    cwd,
  });
  const maxPayloadItems = parseOptionalPositiveInteger(args && args.maxPayloadItems, {
    label: 'zeus.search-source maxPayloadItems',
    min: 1,
    max: MAX_MCP_PAYLOAD_ITEMS,
  });
  const cursorState = decodeMcpCursor('zeus.search-source', args && args.cursor);

  const execution = await executeSearchSource({
    'source-root': resolvedSourceRoot,
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
    cwd,
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
  assertPathWithinCwd({
    toolName: 'zeus.field-search',
    optionName: '--source-root',
    rawValue: sourceRootArg,
    resolvedPath: sourceRoot,
    cwd,
  });
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
  const cursorState = decodeMcpCursor('zeus.field-search', args && args.cursor);
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

  if (name === 'zeus.bridge') {
    const bridgeRunner = typeof context.bridgeRunner === 'function'
      ? context.bridgeRunner
      : executeReadOnlyBridge;

    let execution;
    try {
      execution = await bridgeRunner(args, {
        cwd: context.cwd || process.cwd(),
        env: context.env || process.env,
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_NOT_ALLOWED')
      ) {
        throw error;
      }
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.bridge/i.test(String(error && error.message ? error.message : ''))
        || /missing required option: --/i.test(String(error && error.message ? error.message : ''))
        || /unknown bridge subcommand/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
        throw error;
      }
      throw normalizeMcpRuntimeToolError('zeus.bridge', error);
    }

    const plan = execution && execution.plan && typeof execution.plan === 'object'
      ? execution.plan
      : {};
    const approval = execution && execution.approval && typeof execution.approval === 'object'
      ? execution.approval
      : {};
    const artifacts = execution && execution.artifacts && typeof execution.artifacts === 'object'
      ? execution.artifacts
      : {};
    const expectedArtifacts = execution && execution.expectedArtifacts && typeof execution.expectedArtifacts === 'object'
      ? execution.expectedArtifacts
      : null;

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      operation: execution && execution.operation ? String(execution.operation) : '',
      profile: execution && execution.profile ? String(execution.profile) : null,
      program: execution && execution.program ? String(execution.program) : '',
      dryRun: execution && execution.dryRun !== null && execution.dryRun !== undefined
        ? Boolean(execution.dryRun)
        : null,
      status: execution && execution.status ? String(execution.status) : 'unknown',
      reason: execution && execution.reason ? String(execution.reason) : null,
      plan: {
        planId: plan.planId ? String(plan.planId) : null,
        planHash: plan.planHash ? String(plan.planHash) : null,
        riskLevel: plan.riskLevel ? String(plan.riskLevel) : null,
        targetType: plan.targetType ? String(plan.targetType) : null,
        remoteTarget: plan.remoteTarget && typeof plan.remoteTarget === 'object'
          ? plan.remoteTarget
          : null,
      },
      compileTemplateId: execution && execution.compileTemplateId ? String(execution.compileTemplateId) : null,
      approval: {
        required: Boolean(approval.required),
        status: approval.status ? String(approval.status) : null,
        code: approval.code ? String(approval.code) : null,
        message: approval.message ? String(approval.message) : null,
        planPath: approval.planPath ? String(approval.planPath) : null,
        approvalPath: approval.approvalPath ? String(approval.approvalPath) : null,
        planId: approval.planId ? String(approval.planId) : null,
        planHash: approval.planHash ? String(approval.planHash) : null,
      },
      artifacts: {
        jsonPath: artifacts.jsonPath ? String(artifacts.jsonPath) : null,
        mdPath: artifacts.mdPath ? String(artifacts.mdPath) : null,
      },
      expectedArtifacts,
      auditPath: execution && execution.auditPath ? String(execution.auditPath) : null,
      timestamp: new Date().toISOString(),
    };
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
      cursorState = decodeMcpCursor('zeus.impact', args && args.cursor);
      execution = impactRunner(args, {
        cwd: context.cwd || process.cwd(),
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

  if (name === 'zeus.diff') {
    const diffRunner = typeof context.diffRunner === 'function'
      ? context.diffRunner
      : executeReadOnlyDiff;

    let execution;
    try {
      execution = await diffRunner(args, {
        cwd: context.cwd || process.cwd(),
        env: context.env || process.env,
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.diff/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
        || /no fetched source found for member/i.test(String(error && error.message ? error.message : ''))
        || /no workspace copy found for member/i.test(String(error && error.message ? error.message : ''))
        || /analyze\.sourceRoot must be a string/i.test(String(error && error.message ? error.message : ''))
        || /analyze\.outputRoot must be a string/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    const rows = Array.isArray(execution && execution.rows) ? execution.rows : [];
    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      profile: execution && execution.profile ? String(execution.profile) : '',
      member: execution && execution.member ? String(execution.member) : '',
      fetchRoot: execution && execution.fetchRoot ? String(execution.fetchRoot) : '',
      workspaceRoot: execution && execution.workspaceRoot ? String(execution.workspaceRoot) : '',
      workCopyMode: execution && execution.workCopyMode ? String(execution.workCopyMode) : '',
      originalPath: execution && execution.originalPath ? String(execution.originalPath) : '',
      modifiedPath: execution && execution.modifiedPath ? String(execution.modifiedPath) : '',
      maxPayloadLines: Number(execution && execution.maxPayloadLines ? execution.maxPayloadLines : DEFAULT_MCP_PAYLOAD_ITEMS),
      payloadLineCount: Number(execution && execution.payloadLineCount ? execution.payloadLineCount : rows.length),
      payloadTruncated: Boolean(execution && execution.payloadTruncated),
      lineCount: Number(execution && execution.lineCount ? execution.lineCount : rows.length),
      changedLineCount: Number(execution && execution.changedLineCount ? execution.changedLineCount : 0),
      rows: rows.map((row) => ({
        line: Number(row && row.line ? row.line : 0),
        marker: row && row.marker ? String(row.marker) : ' ',
        original: row && row.original ? String(row.original) : '',
        modified: row && row.modified ? String(row.modified) : '',
      })),
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.generate-test') {
    const generateTestRunner = typeof context.generateTestRunner === 'function'
      ? context.generateTestRunner
      : executeReadOnlyGenerateTest;

    let execution;
    try {
      execution = await generateTestRunner(args, {
        cwd: context.cwd || process.cwd(),
        env: context.env || process.env,
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.generate-test/i.test(String(error && error.message ? error.message : ''))
        || /canonical-analysis\.json not found at:/i.test(String(error && error.message ? error.message : ''))
        || /failed to parse canonical analysis json:/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      program: execution && execution.program ? String(execution.program) : '',
      format: execution && execution.format ? String(execution.format) : 'markdown',
      isCritical: Boolean(execution && execution.isCritical),
      includeChangeScenario: Boolean(execution && execution.includeChangeScenario),
      analysisPath: execution && execution.analysisPath ? String(execution.analysisPath) : '',
      outputRoot: execution && execution.outputRoot ? String(execution.outputRoot) : '',
      outputPathSuggestion: execution && execution.outputPathSuggestion ? String(execution.outputPathSuggestion) : '',
      contentLength: Number(execution && execution.contentLength ? execution.contentLength : 0),
      content: execution && execution.content ? String(execution.content) : '',
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.generate-checklist') {
    const generateChecklistRunner = typeof context.generateChecklistRunner === 'function'
      ? context.generateChecklistRunner
      : executeReadOnlyGenerateChecklist;

    let execution;
    try {
      execution = await generateChecklistRunner(args, {
        cwd: context.cwd || process.cwd(),
        env: context.env || process.env,
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.generate-checklist/i.test(String(error && error.message ? error.message : ''))
        || /failed to parse canonical analysis json:/i.test(String(error && error.message ? error.message : ''))
        || /failed to parse risk assessment json:/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      program: execution && execution.program ? String(execution.program) : '',
      changeType: execution && execution.changeType ? String(execution.changeType) : 'CODE_CHANGE',
      impact: execution && execution.impact ? String(execution.impact) : 'MEDIUM',
      affectedPrograms: Array.isArray(execution && execution.affectedPrograms) ? execution.affectedPrograms.map((entry) => String(entry)) : [],
      hasCriticalPath: Boolean(execution && execution.hasCriticalPath),
      outputRoot: execution && execution.outputRoot ? String(execution.outputRoot) : '',
      analysisPath: execution && execution.analysisPath ? String(execution.analysisPath) : null,
      riskPath: execution && execution.riskPath ? String(execution.riskPath) : null,
      outputPathSuggestion: execution && execution.outputPathSuggestion ? String(execution.outputPathSuggestion) : '',
      timeline: execution && execution.timeline && typeof execution.timeline === 'object' ? execution.timeline : null,
      riskAreaCount: Number(execution && execution.riskAreaCount ? execution.riskAreaCount : 0),
      contentLength: Number(execution && execution.contentLength ? execution.contentLength : 0),
      content: execution && execution.content ? String(execution.content) : '',
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.qa') {
    const qaRunner = typeof context.qaRunner === 'function'
      ? context.qaRunner
      : executeReadOnlyQa;

    let execution;
    try {
      execution = await qaRunner(args, {
        cwd: context.cwd || process.cwd(),
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.qa/i.test(String(error && error.message ? error.message : ''))
        || /invalid option: --format/i.test(String(error && error.message ? error.message : ''))
        || /invalid option: --strict/i.test(String(error && error.message ? error.message : ''))
        || /input path not found:/i.test(String(error && error.message ? error.message : ''))
        || /canonical-analysis\.json not found at:/i.test(String(error && error.message ? error.message : ''))
        || /failed to parse canonical analysis json:/i.test(String(error && error.message ? error.message : ''))
        || /invalid canonical analysis payload/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    const report = execution && execution.report && typeof execution.report === 'object'
      ? execution.report
      : {};

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      inputPath: execution && execution.inputPath ? String(execution.inputPath) : '',
      format: execution && execution.format ? String(execution.format) : 'markdown',
      strict: execution && execution.strict ? String(execution.strict) : 'LENIENT',
      qaStatus: execution && execution.qaStatus ? String(execution.qaStatus) : 'UNKNOWN',
      durationMs: Number(execution && execution.durationMs ? execution.durationMs : 0),
      stageCount: Number(execution && execution.stageCount ? execution.stageCount : 0),
      failureCount: Number(execution && execution.failureCount ? execution.failureCount : 0),
      report,
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.analyses') {
    const analysesRunner = typeof context.analysesRunner === 'function'
      ? context.analysesRunner
      : executeReadOnlyAnalyses;

    let execution;
    try {
      execution = await analysesRunner(args, {
        cwd: context.cwd || process.cwd(),
        env: context.env || process.env,
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.analyses/i.test(String(error && error.message ? error.message : ''))
        || /workspace not found:/i.test(String(error && error.message ? error.message : ''))
        || /invalid workspace id:/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      operation: execution && execution.operation ? String(execution.operation) : '',
      profile: execution && typeof execution.profile === 'string' ? execution.profile : null,
      registryPath: execution && execution.registryPath ? String(execution.registryPath) : '',
      workspaceCount: Number(execution && execution.workspaceCount ? execution.workspaceCount : 0),
      workspaces: Array.isArray(execution && execution.workspaces) ? execution.workspaces : [],
      workspace: execution && execution.workspace && typeof execution.workspace === 'object'
        ? execution.workspace
        : null,
      index: execution && execution.index && typeof execution.index === 'object'
        ? execution.index
        : null,
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.fetch') {
    const fetchRunner = typeof context.fetchRunner === 'function'
      ? context.fetchRunner
      : executeReadOnlyFetch;

    let execution;
    try {
      execution = await fetchRunner(args, {
        cwd: context.cwd || process.cwd(),
        env: context.env || process.env,
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.fetch/i.test(String(error && error.message ? error.message : ''))
        || /fetch import manifest not found:/i.test(String(error && error.message ? error.message : ''))
        || /failed to parse fetch import manifest json at/i.test(String(error && error.message ? error.message : ''))
        || /invalid fetch import manifest payload/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
        || /invalid configuration: fetch\./i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      operation: execution && execution.operation ? String(execution.operation) : '',
      profile: execution && typeof execution.profile === 'string' ? execution.profile : null,
      fetchRoot: execution && execution.fetchRoot ? String(execution.fetchRoot) : '',
      manifestPath: execution && execution.manifestPath ? String(execution.manifestPath) : '',
      summary: execution && execution.summary && typeof execution.summary === 'object'
        ? execution.summary
        : null,
      cursor: execution && typeof execution.cursor === 'string' && execution.cursor
        ? execution.cursor
        : null,
      cursorOffset: Number(execution && execution.cursorOffset ? execution.cursorOffset : 0),
      nextCursor: execution && typeof execution.nextCursor === 'string' && execution.nextCursor
        ? execution.nextCursor
        : null,
      maxPayloadItems: Number(execution && execution.maxPayloadItems ? execution.maxPayloadItems : DEFAULT_MCP_PAYLOAD_ITEMS),
      payloadResultCount: Number(execution && execution.payloadResultCount ? execution.payloadResultCount : 0),
      payloadTruncated: Boolean(execution && execution.payloadTruncated),
      resultCount: Number(execution && execution.resultCount ? execution.resultCount : 0),
      files: Array.isArray(execution && execution.files) ? execution.files : [],
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.test-run') {
    const testRunRunner = typeof context.testRunRunner === 'function'
      ? context.testRunRunner
      : executeReadOnlyTestRun;

    let execution;
    try {
      execution = await testRunRunner(args, {
        cwd: context.cwd || process.cwd(),
        env: context.env || process.env,
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.test-run/i.test(String(error && error.message ? error.message : ''))
        || /failed to read test-run manifest at/i.test(String(error && error.message ? error.message : ''))
        || /datei ist kein test-run-manifest/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      operation: execution && execution.operation ? String(execution.operation) : '',
      profile: execution && typeof execution.profile === 'string' ? execution.profile : null,
      manifestPath: execution && execution.manifestPath ? String(execution.manifestPath) : '',
      manifest: execution && execution.manifest && typeof execution.manifest === 'object'
        ? execution.manifest
        : null,
      snapshots: Array.isArray(execution && execution.snapshots) ? execution.snapshots : [],
      maxPayloadItems: Number(execution && execution.maxPayloadItems ? execution.maxPayloadItems : DEFAULT_MCP_PAYLOAD_ITEMS),
      payloadResultCount: Number(execution && execution.payloadResultCount ? execution.payloadResultCount : 0),
      payloadTruncated: Boolean(execution && execution.payloadTruncated),
      rollbackStatements: Array.isArray(execution && execution.rollbackStatements) ? execution.rollbackStatements : [],
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.copy-to-workspace') {
    const copyToWorkspaceRunner = typeof context.copyToWorkspaceRunner === 'function'
      ? context.copyToWorkspaceRunner
      : executeReadOnlyCopyToWorkspace;

    let execution;
    try {
      execution = await copyToWorkspaceRunner(args, {
        cwd: context.cwd || process.cwd(),
        env: context.env || process.env,
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.copy-to-workspace/i.test(String(error && error.message ? error.message : ''))
        || /missing required option: --profile <name>/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
        || /fetch output directory not found:/i.test(String(error && error.message ? error.message : ''))
        || /invalid configuration: fetch\./i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      operation: execution && execution.operation ? String(execution.operation) : '',
      profile: execution && execution.profile ? String(execution.profile) : null,
      sourceRoot: execution && execution.sourceRoot ? String(execution.sourceRoot) : '',
      targetRoot: execution && execution.targetRoot ? String(execution.targetRoot) : '',
      workCopyMode: execution && execution.workCopyMode ? String(execution.workCopyMode) : '',
      force: Boolean(execution && execution.force),
      requestedMemberCount: Number(execution && execution.requestedMemberCount ? execution.requestedMemberCount : 0),
      discoveredCount: Number(execution && execution.discoveredCount ? execution.discoveredCount : 0),
      selectedCount: Number(execution && execution.selectedCount ? execution.selectedCount : 0),
      copyCandidateCount: Number(execution && execution.copyCandidateCount ? execution.copyCandidateCount : 0),
      overwriteCount: Number(execution && execution.overwriteCount ? execution.overwriteCount : 0),
      existingCount: Number(execution && execution.existingCount ? execution.existingCount : 0),
      skippedCount: Number(execution && execution.skippedCount ? execution.skippedCount : 0),
      cursor: execution && typeof execution.cursor === 'string' && execution.cursor
        ? execution.cursor
        : null,
      cursorOffset: Number(execution && execution.cursorOffset ? execution.cursorOffset : 0),
      nextCursor: execution && typeof execution.nextCursor === 'string' && execution.nextCursor
        ? execution.nextCursor
        : null,
      maxPayloadItems: Number(execution && execution.maxPayloadItems ? execution.maxPayloadItems : DEFAULT_MCP_PAYLOAD_ITEMS),
      payloadResultCount: Number(execution && execution.payloadResultCount ? execution.payloadResultCount : 0),
      payloadTruncated: Boolean(execution && execution.payloadTruncated),
      resultCount: Number(execution && execution.resultCount ? execution.resultCount : 0),
      entries: Array.isArray(execution && execution.entries) ? execution.entries : [],
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.serve') {
    const serveRunner = typeof context.serveRunner === 'function'
      ? context.serveRunner
      : executeReadOnlyServe;

    let execution;
    try {
      execution = await serveRunner(args, {
        cwd: context.cwd || process.cwd(),
        env: context.env || process.env,
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.serve/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
        || /invalid configuration: bundle\./i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
      }
      throw error;
    }

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      operation: execution && execution.operation ? String(execution.operation) : '',
      profile: execution && typeof execution.profile === 'string' ? execution.profile : null,
      outputRoot: execution && execution.outputRoot ? String(execution.outputRoot) : '',
      outputRootExists: Boolean(execution && execution.outputRootExists),
      host: execution && execution.host ? String(execution.host) : DEFAULT_UI_HOST,
      port: Number(execution && execution.port !== undefined ? execution.port : DEFAULT_UI_PORT),
      bindUrl: execution && execution.bindUrl ? String(execution.bindUrl) : null,
      registryPath: execution && execution.registryPath ? String(execution.registryPath) : null,
      registryConfigured: Boolean(execution && execution.registryConfigured),
      registryExists: Boolean(execution && execution.registryExists),
      workspaceCount: Number(execution && execution.workspaceCount ? execution.workspaceCount : 0),
      runCount: Number(execution && execution.runCount ? execution.runCount : 0),
      latestRun: execution && execution.latestRun && typeof execution.latestRun === 'object'
        ? execution.latestRun
        : null,
      apiRoutes: Array.isArray(execution && execution.apiRoutes) ? execution.apiRoutes.map((entry) => String(entry)) : [],
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'zeus.write-sql') {
    const writeSqlRunner = typeof context.writeSqlRunner === 'function'
      ? context.writeSqlRunner
      : executeWriteSql;

    let execution;
    try {
      execution = await writeSqlRunner(args, {
        cwd: context.cwd || process.cwd(),
        env: context.env || process.env,
      });
    } catch (error) {
      if (
        (error && error.code === 'TOOL_NOT_ALLOWED')
      ) {
        throw error;
      }
      if (
        (error && error.code === 'TOOL_INVALID_ARGUMENTS')
        || /invalid arguments for zeus\.write-sql/i.test(String(error && error.message ? error.message : ''))
        || /missing required option: --profile/i.test(String(error && error.message ? error.message : ''))
        || /only accepts dml statements/i.test(String(error && error.message ? error.message : ''))
        || /db2 connection configuration is incomplete/i.test(String(error && error.message ? error.message : ''))
        || /profile ".+" not found/i.test(String(error && error.message ? error.message : ''))
      ) {
        error.code = 'TOOL_INVALID_ARGUMENTS';
        throw error;
      }
      throw normalizeMcpRuntimeToolError('zeus.write-sql', error);
    }

    return {
      ok: true,
      service: 'zeus-rpg-promptkit',
      operation: execution && execution.operation ? String(execution.operation) : '',
      profile: execution && execution.profile ? String(execution.profile) : null,
      mode: execution && execution.mode ? String(execution.mode) : 'upsert',
      statementType: execution && execution.statementType ? String(execution.statementType) : 'UNKNOWN',
      sqlLength: Number(execution && execution.sqlLength ? execution.sqlLength : 0),
      sqlFingerprint: execution && execution.sqlFingerprint ? String(execution.sqlFingerprint) : '',
      productionSystem: Boolean(execution && execution.productionSystem),
      writesEnabled: Boolean(execution && execution.writesEnabled),
      confirmationRequired: Boolean(execution && execution.confirmationRequired),
      tableAllowlistEnabled: Boolean(execution && execution.tableAllowlistEnabled),
      tableAllowed: Boolean(execution && execution.tableAllowed),
      targetSchema: execution && execution.targetSchema ? String(execution.targetSchema) : null,
      targetTable: execution && execution.targetTable ? String(execution.targetTable) : null,
      targetQualifiedName: execution && execution.targetQualifiedName ? String(execution.targetQualifiedName) : null,
      allowTables: Array.isArray(execution && execution.allowTables) ? execution.allowTables.map((entry) => String(entry)) : [],
      whereRequired: Boolean(execution && execution.whereRequired),
      wherePresent: Boolean(execution && execution.wherePresent),
      predicateSafe: Boolean(execution && execution.predicateSafe),
      rowSafetyEnabled: Boolean(execution && execution.rowSafetyEnabled),
      rowSafetyConfiguredMaxRowsAffected:
        execution && execution.rowSafetyConfiguredMaxRowsAffected !== undefined && execution.rowSafetyConfiguredMaxRowsAffected !== null
          ? Number(execution.rowSafetyConfiguredMaxRowsAffected)
          : null,
      rowSafetyRequestedMaxRowsAffected:
        execution && execution.rowSafetyRequestedMaxRowsAffected !== undefined && execution.rowSafetyRequestedMaxRowsAffected !== null
          ? Number(execution.rowSafetyRequestedMaxRowsAffected)
          : null,
      rowSafetyEffectiveMaxRowsAffected:
        execution && execution.rowSafetyEffectiveMaxRowsAffected !== undefined && execution.rowSafetyEffectiveMaxRowsAffected !== null
          ? Number(execution.rowSafetyEffectiveMaxRowsAffected)
          : null,
      rowSafetyClampApplied: Boolean(execution && execution.rowSafetyClampApplied),
      rowSafetyPreflightRequired: Boolean(execution && execution.rowSafetyPreflightRequired),
      preflightRowEstimate:
        execution && execution.preflightRowEstimate !== undefined && execution.preflightRowEstimate !== null
          ? Number(execution.preflightRowEstimate)
          : null,
      canApply: Boolean(execution && execution.canApply),
      blockReasons: Array.isArray(execution && execution.blockReasons) ? execution.blockReasons.map((entry) => String(entry)) : [],
      rowsAffected: Number(execution && execution.rowsAffected ? execution.rowsAffected : 0),
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
      } else {
        throw normalizeMcpRuntimeToolError('zeus.joblog', error);
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
      } else {
        throw normalizeMcpRuntimeToolError('zeus.inspect-object', error);
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
    evaluateWriteTableAllowlist,
    evaluateWriteStatementGuard,
    resolveWriteRowSafetyPolicy,
    encodeMcpCursor,
    isJoblogInfoUnavailableError,
    normalizeJoblogToolError,
    summarizeJoblogRows,
  },
};
