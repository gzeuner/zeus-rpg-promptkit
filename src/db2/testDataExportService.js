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
const os = require('os');
const path = require('path');
const {
  ensureJavaHelperCompiled,
  runJavaHelper,
  SECRET_ENV_SENTINEL,
} = require('../fetch/jt400CommandRunner');
const {
  normalizeIdentifier,
  resolveDefaultSchema,
  buildJdbcUrl,
  isDbConfigured,
} = require('./db2Config');
const {
  buildCompactTestDataLink,
  buildDb2TableLookupIndex,
  buildDb2SourceLinkage,
  normalizeCatalogTable,
} = require('./db2EvidenceLinker');
const { REDACTED_VALUE, sanitizeValue } = require('../security/secretMasking');

const JSON_FILE = 'test-data.json';
const INDEX_FILE = 'test-data-index.json';
const MARKDOWN_FILE = 'test-data.md';
const DEFAULT_TEST_DATA_LIMIT = 50;
const MAX_BATCH_TABLES = 64;
const MARKDOWN_COLUMN_LIMIT = 8;
const MARKDOWN_ROW_LIMIT = 10;

function elapsedMilliseconds(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function writePerformanceLog(verbose, metrics) {
  if (!verbose) return;
  const milliseconds = value => Number(value).toFixed(1);
  process.stderr.write(
    `[perf] test-data helperMs=${milliseconds(metrics.helperMs)} responseBytes=${metrics.responseBytes} parseMs=${milliseconds(metrics.parseMs)} maskMs=${milliseconds(metrics.maskMs)} artifactMs=${milliseconds(metrics.artifactMs)} totalMs=${milliseconds(metrics.totalMs)} batchCount=${metrics.batchCount} maxResponseBytes=${metrics.maxResponseBytes}\n`
  );
}

function buildTestDataIndex(payload, summary) {
  const tables = Array.isArray(payload && payload.tables) ? payload.tables : [];
  const exportedTableCount = tables.filter(table => table.status === 'exported').length;

  return {
    schemaVersion: 1,
    kind: 'test-data-index',
    program: payload && payload.program ? payload.program : null,
    rowLimit: Number(payload && payload.rowLimit) || null,
    summary: {
      status: summary && summary.status ? summary.status : 'exported',
      tableCount:
        summary && Number.isFinite(Number(summary.tableCount))
          ? Number(summary.tableCount)
          : exportedTableCount,
      requestedTableCount:
        summary && Number.isFinite(Number(summary.requestedTableCount))
          ? Number(summary.requestedTableCount)
          : tables.length,
      skippedTableCount:
        summary && Number.isFinite(Number(summary.skippedTableCount))
          ? Number(summary.skippedTableCount)
          : tables.length - exportedTableCount,
      rowLimit: Number(payload && payload.rowLimit) || null,
      policySummary: summary && summary.policySummary ? summary.policySummary : null,
    },
    tables: tables.map(table => ({
      schema: table.schema || '',
      table: table.table || table.systemName || '',
      systemSchema: table.systemSchema || '',
      systemName: table.systemName || '',
      status: table.status || null,
      rowCount: Number.isFinite(Number(table.rowCount)) ? Number(table.rowCount) : null,
      maskedColumnCount:
        table.policyDecision && Array.isArray(table.policyDecision.maskedColumns)
          ? table.policyDecision.maskedColumns.length
          : 0,
      policyEligibility:
        table.policyDecision && table.policyDecision.eligibility
          ? table.policyDecision.eligibility
          : null,
      sourceLink: table.sourceLink
        ? {
            matchStatus: table.sourceLink.matchStatus || null,
            sourceEvidenceCount: Array.isArray(table.sourceLink.sourceEvidence)
              ? table.sourceLink.sourceEvidence.length
              : 0,
          }
        : null,
    })),
  };
}

function writeTestDataIndex(outputDir, payload, summary) {
  const filePath = path.join(outputDir, INDEX_FILE);
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(buildTestDataIndex(payload, summary), null, 2)}\n`,
    'utf8'
  );
  return filePath;
}

function normalizeMaskColumns(testDataConfig) {
  return Array.from(
    new Set(
      ((testDataConfig && testDataConfig.maskColumns) || [])
        .map(value => normalizeIdentifier(value))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function writeOutputs(outputDir, payload, markdown, summary) {
  fs.writeFileSync(
    path.join(outputDir, JSON_FILE),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(path.join(outputDir, MARKDOWN_FILE), markdown, 'utf8');
  writeTestDataIndex(outputDir, payload, summary);
}

function parseJavaJson(stdout) {
  const content = String(stdout || '').trim();
  if (!content) {
    return null;
  }
  return JSON.parse(content);
}

function encodeBatchField(value) {
  return Buffer.from(String(value === undefined || value === null ? '' : value), 'utf8').toString(
    'base64url'
  );
}

function createBatchRequestFile(entries) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-test-data-batch-'));
  const filePath = path.join(tempDir, 'requests.tsv');
  try {
    const lines = entries.map(entry =>
      [
        entry.schema,
        entry.table,
        ...(entry.columns || [])
          .filter(column => column && column.primaryKey)
          .map(column => String(column.name || '').trim())
          .filter(Boolean),
      ]
        .map(encodeBatchField)
        .join('\t')
    );
    fs.writeFileSync(filePath, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
    return { tempDir, filePath };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function parseQualifiedTableName(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  if (raw.includes('.')) {
    const [schema, table] = raw.split('.', 2);
    return {
      schema: normalizeIdentifier(schema),
      table: normalizeIdentifier(table),
    };
  }

  if (raw.includes('/')) {
    const [schema, table] = raw.split('/', 2);
    return {
      schema: normalizeIdentifier(schema),
      table: normalizeIdentifier(table),
    };
  }

  return {
    schema: '',
    table: normalizeIdentifier(raw),
  };
}

function formatQualifiedPolicyTable(entry) {
  if (!entry) {
    return '';
  }
  return entry.schema ? `${entry.schema}.${entry.table}` : entry.table;
}

function buildTestDataPolicy(testDataConfig) {
  return {
    allowTables: Array.from(
      new Map(
        ((testDataConfig && testDataConfig.allowTables) || [])
          .map(value => parseQualifiedTableName(value))
          .filter(Boolean)
          .map(entry => [`${entry.schema}|${entry.table}`, entry])
      ).values()
    ).sort((a, b) => formatQualifiedPolicyTable(a).localeCompare(formatQualifiedPolicyTable(b))),
    denyTables: Array.from(
      new Map(
        ((testDataConfig && testDataConfig.denyTables) || [])
          .map(value => parseQualifiedTableName(value))
          .filter(Boolean)
          .map(entry => [`${entry.schema}|${entry.table}`, entry])
      ).values()
    ).sort((a, b) => formatQualifiedPolicyTable(a).localeCompare(formatQualifiedPolicyTable(b))),
    maskColumns: normalizeMaskColumns(testDataConfig),
    maskRules: ((testDataConfig && testDataConfig.maskRules) || [])
      .map(rule => ({
        schema: normalizeIdentifier(rule && rule.schema),
        table: normalizeIdentifier(rule && rule.table),
        columns: Array.from(
          new Set(
            (rule && Array.isArray(rule.columns) ? rule.columns : [])
              .map(value => normalizeIdentifier(value))
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b)),
        value:
          typeof rule === 'object' && typeof rule.value === 'string' && rule.value.trim()
            ? rule.value.trim()
            : 'MASKED',
      }))
      .filter(rule => (rule.schema || rule.table) && rule.columns.length > 0),
  };
}

function policyCandidates(entry) {
  return {
    tables: Array.from(
      new Set(
        [normalizeIdentifier(entry.table), normalizeIdentifier(entry.systemName)].filter(Boolean)
      )
    ),
    schemas: Array.from(
      new Set(
        [normalizeIdentifier(entry.schema), normalizeIdentifier(entry.systemSchema)].filter(Boolean)
      )
    ),
  };
}

function matchesPolicyTable(entry, policyEntry) {
  if (!entry || !policyEntry) {
    return false;
  }
  const candidates = policyCandidates(entry);
  const policyTable = normalizeIdentifier(policyEntry.table);
  const policySchema = normalizeIdentifier(policyEntry.schema);
  if (!policyTable) {
    return false;
  }

  const tableMatches = candidates.tables.includes(policyTable);
  if (!tableMatches) {
    return false;
  }

  if (!policySchema) {
    return true;
  }

  return candidates.schemas.includes(policySchema);
}

function resolvePolicyDecision(entry, policy) {
  const allowTables = Array.isArray(policy && policy.allowTables) ? policy.allowTables : [];
  const denyTables = Array.isArray(policy && policy.denyTables) ? policy.denyTables : [];

  if (
    allowTables.length > 0 &&
    !allowTables.some(allowEntry => matchesPolicyTable(entry, allowEntry))
  ) {
    return {
      eligibility: 'not-allowlisted',
      reason: `Skipped because ${entry.table} is not included in the configured test-data allowlist.`,
    };
  }

  const denyMatch = denyTables.find(denyEntry => matchesPolicyTable(entry, denyEntry));
  if (denyMatch) {
    return {
      eligibility: 'denied',
      reason: `Skipped because ${entry.table} matches the configured test-data denylist entry ${formatQualifiedPolicyTable(denyMatch)}.`,
    };
  }

  return {
    eligibility: 'eligible',
    reason: null,
  };
}

function resolveMaskingPlanForTable(entry, policy) {
  const maskedColumns = new Map();
  const matchedRules = [];

  for (const column of Array.isArray(policy && policy.maskColumns) ? policy.maskColumns : []) {
    maskedColumns.set(column, {
      value: 'MASKED',
      source: 'global-mask-columns',
    });
  }

  for (const rule of Array.isArray(policy && policy.maskRules) ? policy.maskRules : []) {
    if (!matchesPolicyTable(entry, rule)) {
      continue;
    }
    matchedRules.push({
      schema: rule.schema || '',
      table: rule.table || '',
      columns: [...rule.columns],
      value: rule.value || 'MASKED',
    });
    for (const column of rule.columns) {
      maskedColumns.set(column, {
        value: rule.value || 'MASKED',
        source: 'mask-rule',
      });
    }
  }

  return {
    maskedColumns: Array.from(maskedColumns.keys()).sort((a, b) => a.localeCompare(b)),
    maskedColumnValues: maskedColumns,
    matchedRules,
  };
}

function buildRequestedTables(dependencies) {
  return Array.from(
    new Set(
      ((dependencies && dependencies.tables) || [])
        .map(entry => parseQualifiedTableName(entry && entry.name ? entry.name : entry))
        .filter(Boolean)
        .map(entry => `${entry.schema}|${entry.table}`)
    )
  )
    .map(key => {
      const [schema, table] = key.split('|');
      return { schema, table };
    })
    .sort((a, b) => {
      if (a.table !== b.table) return a.table.localeCompare(b.table);
      return a.schema.localeCompare(b.schema);
    });
}

function applyPolicyToPlanEntry(entry, policy) {
  if (entry.status === 'skipped') {
    return {
      ...entry,
      policyDecision: {
        eligibility: 'skipped',
        reason: entry.note || 'Skipped before policy evaluation.',
      },
    };
  }

  const decision = resolvePolicyDecision(entry, policy);
  if (decision.eligibility !== 'eligible') {
    return {
      ...entry,
      status: 'skipped',
      note: decision.reason,
      policyDecision: decision,
    };
  }

  return {
    ...entry,
    policyDecision: decision,
  };
}

function buildExtractionPlan({
  requestedTables,
  metadataPayload,
  defaultSchema,
  policy = buildTestDataPolicy({}),
}) {
  const plan = new Map();
  const metadataTables = (
    metadataPayload && Array.isArray(metadataPayload.tables) ? metadataPayload.tables : []
  ).map(table =>
    normalizeCatalogTable({
      ...table,
      columns: Array.isArray(table && table.columns) ? table.columns : [],
    })
  );
  const lookupIndex = buildDb2TableLookupIndex(metadataTables);

  for (const table of metadataTables) {
    if (!table.table && !table.systemName) continue;
    const key = `${table.schema}|${table.table}`;
    plan.set(key, {
      schema: table.schema,
      table: table.table,
      systemSchema: table.systemSchema,
      systemName: table.systemName,
      columns: table.columns,
      status: 'pending',
    });
  }

  for (const requestedTable of requestedTables) {
    const requestedAliases = [
      requestedTable.schema && requestedTable.table
        ? `${requestedTable.schema}.${requestedTable.table}`
        : '',
      requestedTable.schema && requestedTable.table
        ? `${requestedTable.schema}/${requestedTable.table}`
        : '',
      requestedTable.table,
    ]
      .filter(Boolean)
      .map(value => normalizeIdentifier(value));
    const matches = Array.from(
      new Map(
        requestedAliases
          .flatMap(alias => lookupIndex.aliasIndex.get(alias) || [])
          .map(entry => [
            `${entry.schema}|${entry.table}|${entry.systemSchema}|${entry.systemName}`,
            entry,
          ])
      ).values()
    );

    if (matches.length === 1) {
      const match = matches[0];
      const key = `${match.schema}|${match.table}`;
      if (!plan.has(key)) {
        plan.set(key, {
          schema: match.schema,
          table: match.table,
          systemSchema: match.systemSchema,
          systemName: match.systemName,
          columns: match.columns || [],
          status: 'pending',
        });
      }
      continue;
    }

    if (matches.length > 1) {
      plan.set(`${requestedTable.schema || ''}|${requestedTable.table}`, {
        schema: '',
        table: requestedTable.table,
        systemSchema: '',
        systemName: requestedTable.table,
        columns: [],
        status: 'skipped',
        note: `Skipped because ${requestedTable.table} matched multiple DB2 catalog objects.`,
      });
      continue;
    }

    const schema = requestedTable.schema || defaultSchema;
    const key = `${schema}|${requestedTable.table}`;
    if (plan.has(key)) {
      continue;
    }
    if (!schema) {
      plan.set(`|${requestedTable.table}`, {
        schema: '',
        table: requestedTable.table,
        systemSchema: '',
        systemName: requestedTable.table,
        columns: [],
        status: 'skipped',
        note: 'Skipped because no schema was detected and no default schema/library is configured.',
      });
      continue;
    }

    plan.set(key, {
      schema,
      table: requestedTable.table,
      systemSchema: schema,
      systemName: requestedTable.table,
      columns: [],
      status: 'pending',
    });
  }

  return Array.from(plan.values())
    .map(entry => applyPolicyToPlanEntry(entry, policy))
    .sort((a, b) => {
      if (a.table !== b.table) return a.table.localeCompare(b.table);
      return a.schema.localeCompare(b.schema);
    });
}

function maskRows(rows, columns, maskingPlan) {
  if (
    !maskingPlan ||
    !(maskingPlan.maskedColumnValues instanceof Map) ||
    maskingPlan.maskedColumnValues.size === 0
  ) {
    return rows;
  }

  return rows.map(row => {
    const masked = {};
    for (const columnName of columns) {
      const normalizedColumn = normalizeIdentifier(columnName);
      const replacement = maskingPlan.maskedColumnValues.get(normalizedColumn);
      if (replacement) {
        masked[columnName] =
          row[columnName] === null || row[columnName] === undefined
            ? row[columnName]
            : replacement.value;
      } else {
        masked[columnName] = row[columnName];
      }
    }
    return masked;
  });
}

function renderValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value).replace(/\|/g, '\\|');
  }
  return String(value).replace(/\|/g, '\\|');
}

function renderPolicyLine(policy) {
  const parts = [];
  if ((policy.allowTables || []).length > 0) {
    parts.push(`allowlist: ${policy.allowTables.map(formatQualifiedPolicyTable).join(', ')}`);
  }
  if ((policy.denyTables || []).length > 0) {
    parts.push(`denylist: ${policy.denyTables.map(formatQualifiedPolicyTable).join(', ')}`);
  }
  if ((policy.maskColumns || []).length > 0) {
    parts.push(`global masked columns: ${policy.maskColumns.join(', ')}`);
  }
  if ((policy.maskRules || []).length > 0) {
    parts.push(`mask rules: ${policy.maskRules.length}`);
  }
  return parts.length > 0 ? parts.join(' | ') : 'No explicit extraction policy.';
}

function renderTableMarkdown(table) {
  const lines = [`## Table ${table.table}`, ''];
  lines.push(`Schema: ${table.schema || '(unknown)'}`);
  lines.push('');
  if (table.sourceLink) {
    lines.push(`Match Status: ${table.sourceLink.matchStatus}`);
    if ((table.sourceLink.sourceEvidence || []).length > 0) {
      lines.push('');
      lines.push('Source Evidence:');
      for (const evidence of table.sourceLink.sourceEvidence) {
        lines.push(`- ${evidence.file}:${evidence.startLine || 1}`);
      }
    }
    lines.push('');
  }
  if (table.policyDecision) {
    lines.push(`Policy Decision: ${table.policyDecision.eligibility}`);
    if (table.policyDecision.reason) {
      lines.push(`Policy Note: ${table.policyDecision.reason}`);
    }
    if ((table.policyDecision.maskedColumns || []).length > 0) {
      lines.push(`Masked Columns: ${table.policyDecision.maskedColumns.join(', ')}`);
    }
    lines.push('');
  }

  if (table.status && table.status !== 'exported') {
    lines.push(`Status: ${table.status}`);
    if (table.note) {
      lines.push('');
      lines.push(table.note);
    }
    lines.push('');
    return lines;
  }

  lines.push(`Extracted Rows: ${table.rowCount}`);
  if (table.note) {
    lines.push(`Note: ${table.note}`);
  }
  lines.push('');

  const columns = Array.isArray(table.columns) ? table.columns : [];
  if (columns.length === 0) {
    lines.push('No columns were returned.');
    lines.push('');
    return lines;
  }

  const visibleColumns = columns.slice(0, MARKDOWN_COLUMN_LIMIT);
  if (columns.length > visibleColumns.length) {
    lines.push(`Showing ${visibleColumns.length} of ${columns.length} columns.`);
    lines.push('');
  }

  lines.push(`| ${visibleColumns.join(' | ')} |`);
  lines.push(`| ${visibleColumns.map(() => '---').join(' | ')} |`);

  const rows = Array.isArray(table.rows) ? table.rows.slice(0, MARKDOWN_ROW_LIMIT) : [];
  if (rows.length === 0) {
    lines.push(`| ${visibleColumns.map(() => '').join(' | ')} |`);
  } else {
    for (const row of rows) {
      lines.push(`| ${visibleColumns.map(column => renderValue(row[column])).join(' | ')} |`);
    }
  }

  if ((table.rows || []).length > rows.length) {
    lines.push('');
    lines.push(`Showing ${rows.length} of ${table.rows.length} extracted rows.`);
  }

  lines.push('');
  return lines;
}

function renderTestDataMarkdown(program, rowLimit, tables, notes, policy) {
  const lines = [
    '# Test Data Extract',
    '',
    `Program: ${normalizeIdentifier(program)}`,
    '',
    `Row Limit per Table: ${rowLimit}`,
    `Policy: ${renderPolicyLine(policy || buildTestDataPolicy({}))}`,
    '',
  ];

  if (notes.length > 0) {
    lines.push('Notes:');
    for (const note of notes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  if (!tables || tables.length === 0) {
    lines.push('No test data was extracted.');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  for (const table of tables) {
    lines.push(...renderTableMarkdown(table));
  }

  return `${lines.join('\n')}\n`;
}

function summarizePolicyApplication(policy, tables) {
  const entries = Array.isArray(tables) ? tables : [];
  return {
    allowlistCount: Array.isArray(policy.allowTables) ? policy.allowTables.length : 0,
    denylistCount: Array.isArray(policy.denyTables) ? policy.denyTables.length : 0,
    maskRuleCount: Array.isArray(policy.maskRules) ? policy.maskRules.length : 0,
    globalMaskColumnCount: Array.isArray(policy.maskColumns) ? policy.maskColumns.length : 0,
    deniedTableCount: entries.filter(
      table => table.policyDecision && table.policyDecision.eligibility === 'denied'
    ).length,
    notAllowlistedTableCount: entries.filter(
      table => table.policyDecision && table.policyDecision.eligibility === 'not-allowlisted'
    ).length,
    maskedTableCount: entries.filter(
      table => table.policyDecision && (table.policyDecision.maskedColumns || []).length > 0
    ).length,
    maskedColumnCount: entries.reduce(
      (sum, table) =>
        sum +
        (table.policyDecision && table.policyDecision.maskedColumns
          ? table.policyDecision.maskedColumns.length
          : 0),
      0
    ),
  };
}

function createSkippedSummary(reason, note, rowLimit, requestedTableCount, policy) {
  const policySummary = summarizePolicyApplication(policy, []);
  return {
    summary: {
      status: 'skipped',
      file: JSON_FILE,
      markdownFile: MARKDOWN_FILE,
      tableCount: 0,
      requestedTableCount,
      skippedTableCount: requestedTableCount,
      rowLimit,
      reason,
      policy,
      policySummary,
    },
    notes: [note],
  };
}

function exportTestData({
  program,
  dependencies,
  dbConfig,
  outputDir,
  metadataPayload,
  canonicalAnalysis,
  context,
  testDataConfig,
  skipTestData = false,
  verbose = false,
  helpers = {},
}) {
  const exportStartedAt = process.hrtime.bigint();
  const performanceMetrics = {
    helperMs: 0,
    responseBytes: 0,
    batchCount: 0,
    maxResponseBytes: 0,
    parseMs: 0,
    maskMs: 0,
    artifactMs: 0,
    totalMs: 0,
  };
  const ensureHelperCompiled =
    typeof helpers.ensureJavaHelperCompiled === 'function'
      ? helpers.ensureJavaHelperCompiled
      : ensureJavaHelperCompiled;
  const runHelper =
    typeof helpers.runJavaHelper === 'function' ? helpers.runJavaHelper : runJavaHelper;
  const rowLimit = Number(testDataConfig && testDataConfig.limit) || DEFAULT_TEST_DATA_LIMIT;
  const requestedTables = buildRequestedTables(dependencies);
  const policy = buildTestDataPolicy(testDataConfig);
  const safeError = value => {
    const password = String((dbConfig && dbConfig.password) || '');
    const raw = String(value || '');
    return sanitizeValue(password ? raw.split(password).join(REDACTED_VALUE) : raw);
  };

  if (skipTestData) {
    return createSkippedSummary(
      'test data extraction was disabled by CLI flag',
      'Test data extraction was skipped because --skip-test-data was provided.',
      rowLimit,
      requestedTables.length,
      policy
    );
  }

  if (!isDbConfigured(dbConfig)) {
    return createSkippedSummary(
      'no DB2 connection configuration was available',
      'Test data extraction was skipped because no DB2 connection configuration was available.',
      rowLimit,
      requestedTables.length,
      policy
    );
  }

  const defaultSchema = resolveDefaultSchema(dbConfig);
  const jdbcUrl = buildJdbcUrl(dbConfig, defaultSchema);
  if (!jdbcUrl) {
    return createSkippedSummary(
      'DB2 connection configuration is incomplete',
      'Test data extraction was skipped because DB2 connection configuration is incomplete.',
      rowLimit,
      requestedTables.length,
      policy
    );
  }

  const plan = buildExtractionPlan({
    requestedTables,
    metadataPayload,
    defaultSchema,
    policy,
  });
  const metadataLinkage =
    metadataPayload && Array.isArray(metadataPayload.tableLinks)
      ? {
          tableLinks: metadataPayload.tableLinks,
          tableLinkByExactKey: new Map(
            metadataPayload.tableLinks.flatMap(link =>
              (link.matches || []).map(match => [
                `${normalizeIdentifier(match.schema)}|${normalizeIdentifier(match.table)}`,
                link,
              ])
            )
          ),
        }
      : buildDb2SourceLinkage({
          requestedTables: requestedTables.map(entry => entry.table),
          exportedTables: plan,
          canonicalAnalysis,
          context,
        });
  const notes = [];
  const tables = [];

  if (plan.length === 0) {
    const payload = {
      program: normalizeIdentifier(program),
      rowLimit,
      policy,
      tables: [],
      notes,
    };
    const summary = {
      status: 'exported',
      file: JSON_FILE,
      indexFile: INDEX_FILE,
      markdownFile: MARKDOWN_FILE,
      tableCount: 0,
      requestedTableCount: 0,
      skippedTableCount: 0,
      rowLimit,
      policy,
      policySummary: summarizePolicyApplication(policy, []),
    };
    writeOutputs(
      outputDir,
      payload,
      renderTestDataMarkdown(program, rowLimit, [], notes, policy),
      summary
    );
    return {
      payload,
      summary,
      notes,
    };
  }

  const eligibleEntries = plan.filter(entry => entry.status !== 'skipped');
  let batchExecutionError = '';
  let batchOutputError = '';

  if (eligibleEntries.length > 0) {
    try {
      ensureHelperCompiled('Db2TestDataExtractor.java', 'Db2TestDataExtractor');
    } catch (error) {
      return createSkippedSummary(
        `the DB2 helper could not run: ${safeError(error.message)}`,
        `Test data extraction was skipped because the DB2 helper could not run: ${safeError(error.message)}`,
        rowLimit,
        requestedTables.length,
        policy
      );
    }

    if (verbose) {
      eligibleEntries.forEach(entry => {
        console.log(
          `[verbose] Extracting test data for ${entry.schema}.${entry.table} (limit ${rowLimit})`
        );
      });
    }
  }

  function* readBatchResults() {
    let completedCount = 0;
    while (completedCount < eligibleEntries.length) {
      const batchEntries = eligibleEntries.slice(completedCount, completedCount + MAX_BATCH_TABLES);
      const requestFile = createBatchRequestFile(batchEntries);
      let result;
      const helperStartedAt = process.hrtime.bigint();
      performanceMetrics.batchCount += 1;
      try {
        result = runHelper(
          'Db2TestDataExtractor',
          [
            jdbcUrl,
            String(dbConfig.user),
            SECRET_ENV_SENTINEL,
            '--batch-file',
            requestFile.filePath,
            String(rowLimit),
          ],
          { password: String(dbConfig.password) }
        );
      } catch (error) {
        batchExecutionError = safeError(error.message);
        break;
      } finally {
        performanceMetrics.helperMs += elapsedMilliseconds(helperStartedAt);
        fs.rmSync(requestFile.tempDir, { recursive: true, force: true });
      }
      const responseBytes = Buffer.byteLength(String(result.stdout || ''), 'utf8');
      performanceMetrics.responseBytes += responseBytes;
      performanceMetrics.maxResponseBytes = Math.max(
        performanceMetrics.maxResponseBytes,
        responseBytes
      );
      if (result.status !== 0) {
        batchExecutionError =
          safeError((result.stderr || '').trim()) || 'unknown DB2 test data error';
        break;
      }
      const parseStartedAt = process.hrtime.bigint();
      let parsed;
      try {
        parsed = parseJavaJson(result.stdout);
        if (
          !parsed ||
          !Array.isArray(parsed.results) ||
          parsed.results.length === 0 ||
          parsed.results.length > batchEntries.length ||
          (parsed.hasMore !== undefined && typeof parsed.hasMore !== 'boolean') ||
          (parsed.results.length < batchEntries.length
            ? parsed.hasMore !== true
            : parsed.hasMore === true) ||
          parsed.results.some((item, index) => {
            const table = item?.status === 'exported' ? item.data : item;
            return (
              !['exported', 'error'].includes(item?.status) ||
              normalizeIdentifier(table?.schema) !==
                normalizeIdentifier(batchEntries[index].schema) ||
              normalizeIdentifier(table?.table) !== normalizeIdentifier(batchEntries[index].table)
            );
          })
        ) {
          throw new Error(
            'Batch helper returned an invalid result count, identity or continuation.'
          );
        }
      } catch (error) {
        batchOutputError = safeError(error.message);
        break;
      } finally {
        performanceMetrics.parseMs += elapsedMilliseconds(parseStartedAt);
      }
      completedCount += parsed.results.length;
      result = null;
      yield* parsed.results;
    }
  }

  const batchResults = readBatchResults();
  for (const entry of plan) {
    const sourceLink =
      metadataLinkage.tableLinkByExactKey.get(
        `${normalizeIdentifier(entry.schema)}|${normalizeIdentifier(entry.table)}`
      ) || null;

    if (entry.status === 'skipped') {
      tables.push({
        schema: entry.schema,
        table: entry.table,
        status: 'skipped',
        rowCount: 0,
        columns: [],
        rows: [],
        note: entry.note,
        policyDecision: entry.policyDecision,
        sourceLink,
      });
      notes.push(`Skipped test data extraction for ${entry.table}: ${entry.note}`);
      continue;
    }

    const helperResult = batchResults.next().value;
    const addErrorResult = note => {
      tables.push({
        schema: entry.schema,
        table: entry.table,
        status: 'error',
        rowCount: 0,
        columns: [],
        rows: [],
        note,
        policyDecision: entry.policyDecision,
        sourceLink,
      });
    };

    if (batchExecutionError && !helperResult) {
      addErrorResult(batchExecutionError);
      notes.push(
        `Test data extraction failed for ${entry.schema}.${entry.table}: ${batchExecutionError}`
      );
      continue;
    }

    if (batchOutputError && !helperResult) {
      addErrorResult(`Invalid helper output: ${batchOutputError}`);
      notes.push(
        `Test data extraction returned invalid output for ${entry.schema}.${entry.table}: ${batchOutputError}`
      );
      continue;
    }

    const returnedTable = helperResult && (helperResult.data || helperResult);
    if (
      !returnedTable ||
      normalizeIdentifier(returnedTable.schema) !== normalizeIdentifier(entry.schema) ||
      normalizeIdentifier(returnedTable.table) !== normalizeIdentifier(entry.table)
    ) {
      const errorMessage = 'Batch helper returned an invalid or mismatched table result.';
      addErrorResult(`Invalid helper output: ${errorMessage}`);
      notes.push(
        `Test data extraction returned invalid output for ${entry.schema}.${entry.table}: ${errorMessage}`
      );
      continue;
    }

    if (helperResult.status === 'error') {
      const errorText = safeError(helperResult.error).trim() || 'unknown DB2 test data error';
      addErrorResult(errorText);
      notes.push(`Test data extraction failed for ${entry.schema}.${entry.table}: ${errorText}`);
      continue;
    }

    const parsed = helperResult && helperResult.data;
    if (!parsed || helperResult.status !== 'exported') {
      const errorMessage = 'Batch helper returned an invalid or mismatched table result.';
      addErrorResult(`Invalid helper output: ${errorMessage}`);
      notes.push(
        `Test data extraction returned invalid output for ${entry.schema}.${entry.table}: ${errorMessage}`
      );
      continue;
    }

    const primaryKeyColumns = (entry.columns || [])
      .filter(column => column && column.primaryKey)
      .map(column => String(column.name || '').trim())
      .filter(Boolean);
    const maskStartedAt = process.hrtime.bigint();
    try {
      const columns = Array.isArray(parsed.columns) ? parsed.columns : [];
      const resolvedEntry = {
        schema: normalizeIdentifier(parsed.schema || entry.schema),
        table: normalizeIdentifier(parsed.table || entry.table),
        systemSchema: normalizeIdentifier(entry.systemSchema || parsed.schema || entry.schema),
        systemName: normalizeIdentifier(entry.systemName || parsed.table || entry.table),
      };
      const maskingPlan = resolveMaskingPlanForTable(resolvedEntry, policy);
      const rows = maskRows(Array.isArray(parsed.rows) ? parsed.rows : [], columns, maskingPlan);
      const tableEntry = {
        schema: resolvedEntry.schema,
        table: resolvedEntry.table,
        status: 'exported',
        rowCount: Number.isFinite(Number(parsed.rowCount)) ? Number(parsed.rowCount) : rows.length,
        columns,
        rows,
        policyDecision: {
          ...entry.policyDecision,
          maskedColumns: maskingPlan.maskedColumns,
          matchedRules: maskingPlan.matchedRules,
        },
        sourceLink:
          metadataLinkage.tableLinkByExactKey.get(
            `${resolvedEntry.schema}|${resolvedEntry.table}`
          ) || null,
      };
      if (primaryKeyColumns.length > 0) {
        tableEntry.note = `Rows ordered by primary key: ${primaryKeyColumns.join(', ')}.`;
      }
      tables.push(tableEntry);
    } catch (error) {
      addErrorResult(`Invalid helper output: ${safeError(error.message)}`);
      notes.push(
        `Test data extraction returned invalid output for ${entry.schema}.${entry.table}: ${safeError(error.message)}`
      );
    } finally {
      performanceMetrics.maskMs += elapsedMilliseconds(maskStartedAt);
      helperResult.data = null;
    }
  }
  batchResults.return();

  const sortedNotes = Array.from(new Set(notes)).sort((a, b) => a.localeCompare(b));
  const policySummary = summarizePolicyApplication(policy, tables);
  const payload = {
    program: normalizeIdentifier(program),
    rowLimit,
    policy,
    tables,
    notes: sortedNotes,
  };
  const summary = {
    status: 'exported',
    file: JSON_FILE,
    indexFile: INDEX_FILE,
    markdownFile: MARKDOWN_FILE,
    tableCount: tables.filter(table => table.status === 'exported').length,
    requestedTableCount: requestedTables.length,
    skippedTableCount: tables.filter(table => table.status !== 'exported').length,
    rowLimit,
    policy,
    policySummary,
    tables: tables.map(table => {
      const link = table.sourceLink || {
        requestedName: normalizeIdentifier(table.table),
        matchStatus: 'resolved',
        sourceEvidence: [],
        sqlReferences: [],
        nativeFiles: [],
      };
      return buildCompactTestDataLink(link, table);
    }),
  };
  const artifactStartedAt = process.hrtime.bigint();
  const markdown = renderTestDataMarkdown(program, rowLimit, tables, sortedNotes, policy);
  writeOutputs(outputDir, payload, markdown, summary);
  performanceMetrics.artifactMs = elapsedMilliseconds(artifactStartedAt);
  performanceMetrics.totalMs = elapsedMilliseconds(exportStartedAt);
  writePerformanceLog(verbose, performanceMetrics);

  return {
    payload,
    summary,
    notes: sortedNotes,
  };
}

module.exports = {
  buildTestDataIndex,
  buildExtractionPlan,
  buildTestDataPolicy,
  exportTestData,
  INDEX_FILE,
  DEFAULT_TEST_DATA_LIMIT,
  maskRows,
  renderTestDataMarkdown,
  resolveMaskingPlanForTable,
  resolvePolicyDecision,
  writeTestDataIndex,
};
