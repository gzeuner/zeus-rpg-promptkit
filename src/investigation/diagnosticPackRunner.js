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

const { buildJdbcUrl, isDbConfigured, resolveDefaultSchema } = require('../db2/db2Config');
const { runClCommand, runJavaHelper } = require('../fetch/jt400CommandRunner');
const { getDiagnosticPack } = require('./diagnosticPackRegistry');
const {
  buildReproducibilityMetadata,
  hashNormalizedValue,
  normalizeReproducibilitySettings,
  resolveTimestamp,
} = require('../reproducibility/reproducibility');

const DIAGNOSTIC_PACK_REPORT_SCHEMA_VERSION = 1;
const DIAGNOSTIC_PACK_MANIFEST_SCHEMA_VERSION = 1;
const ALLOWED_COMMAND_PREFIXES = ['DSPOBJD', 'DSPFD', 'DSPPGMREF', 'DSPSRVPGM', 'DSPDBR'];
const FORBIDDEN_SQL_PATTERN = /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|TRUNCATE|CALL|GRANT|REVOKE)\b/i;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePackNames(value) {
  return Array.from(new Set(asArray(value)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function parseDiagnosticParameterString(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((result, entry) => {
      const splitIndex = entry.indexOf('=');
      if (splitIndex <= 0) {
        return result;
      }
      const key = entry.slice(0, splitIndex).trim();
      const rawValue = entry.slice(splitIndex + 1).trim();
      if (!key) {
        return result;
      }
      result[key] = rawValue;
      return result;
    }, {});
}

function resolvePackParameters(pack, parameterValues) {
  const provided = parameterValues && typeof parameterValues === 'object' ? parameterValues : {};
  const resolved = {};
  const errors = [];

  for (const parameter of asArray(pack.parameters)) {
    const value = String(provided[parameter.name] || '').trim();
    resolved[parameter.name] = value;
    if (parameter.required && !value) {
      errors.push(`Missing required diagnostic pack parameter "${parameter.name}" for ${pack.name}.`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(resolved, 'library') && !resolved.library) {
    resolved.library = '*LIBL';
  }
  if (Object.prototype.hasOwnProperty.call(resolved, 'objectType') && !resolved.objectType) {
    resolved.objectType = '*ALL';
  }

  return {
    resolved,
    errors,
  };
}

function applyTemplate(template, parameters) {
  return String(template || '').replace(/\$\{([^}]+)\}/g, (_, key) => String(parameters[key] || '').trim());
}

function validateReadOnlySql(query) {
  const normalized = String(query || '').trim();
  if (!normalized) {
    throw new Error('Diagnostic SQL step is empty.');
  }
  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    throw new Error('Diagnostic SQL step must start with SELECT or WITH.');
  }
  if (FORBIDDEN_SQL_PATTERN.test(normalized)) {
    throw new Error('Diagnostic SQL step contains a non-read-only keyword.');
  }
}

function validateReadOnlyCommand(command) {
  const normalized = String(command || '').trim().toUpperCase();
  if (!normalized) {
    throw new Error('Diagnostic command step is empty.');
  }
  const prefix = normalized.split(/\s+/, 1)[0];
  if (!ALLOWED_COMMAND_PREFIXES.includes(prefix)) {
    throw new Error(`Diagnostic command step is not in the read-only allowlist: ${prefix}`);
  }
}

function parseSqlStepResult(stdout) {
  const content = String(stdout || '').trim();
  if (!content) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
    };
  }
  return JSON.parse(content);
}

function defaultExecutors() {
  return {
    sql: ({ dbConfig, query, maxRows }) => {
      const jdbcUrl = buildJdbcUrl(dbConfig, resolveDefaultSchema(dbConfig));
      const result = runJavaHelper('Db2DiagnosticQueryRunner', [
        jdbcUrl,
        String(dbConfig.user),
        String(dbConfig.password),
        query,
        String(maxRows || 50),
      ]);
      if (result.status !== 0) {
        throw new Error((result.stderr || '').trim() || 'Diagnostic SQL helper failed.');
      }
      return parseSqlStepResult(result.stdout);
    },
    command: ({ ibmiConfig, command, verbose }) => runClCommand({
      host: ibmiConfig.host,
      user: ibmiConfig.user,
      password: ibmiConfig.password,
      command,
      verbose,
    }),
  };
}

function summarizeStepOutput(step, output) {
  if (step.kind === 'command') {
    return {
      messageCount: asArray(output && output.messages).length,
      ok: output && output.ok === true,
    };
  }
  return {
    rowCount: Number(output && output.rowCount) || asArray(output && output.rows).length,
    columnCount: asArray(output && output.columns).length,
  };
}

function executeStep(step, parameters, runtime, executors) {
  if (step.kind === 'command') {
    const command = applyTemplate(step.command, parameters);
    validateReadOnlyCommand(command);
    if (!runtime.ibmiConfigured) {
      return {
        kind: step.kind,
        status: 'skipped',
        reason: 'IBM i host credentials were not configured for command diagnostics.',
        command,
        output: null,
      };
    }
    const output = executors.command({
      ibmiConfig: runtime.ibmiConfig,
      command,
      verbose: runtime.verbose,
    });
    return {
      kind: step.kind,
      status: output && output.ok === true ? 'succeeded' : 'failed',
      command,
      output: {
        ok: output && output.ok === true,
        messages: asArray(output && output.messages),
        exitCode: Number(output && output.exitCode) || 0,
      },
    };
  }

  const query = applyTemplate(step.query, parameters);
  validateReadOnlySql(query);
  if (!runtime.dbConfigured) {
    return {
      kind: step.kind,
      status: 'skipped',
      reason: 'DB2 credentials were not configured for SQL diagnostics.',
      query,
      output: null,
    };
  }
  const output = executors.sql({
    dbConfig: runtime.dbConfig,
    query,
    maxRows: Number(step.maxRows) || 50,
  });
  return {
    kind: step.kind,
    status: 'succeeded',
    query,
    output: {
      columns: asArray(output && output.columns),
      rows: asArray(output && output.rows),
      rowCount: Number(output && output.rowCount) || asArray(output && output.rows).length,
    },
  };
}

function buildPackReport(pack, parameterValues, stepResults) {
  return {
    name: pack.name,
    title: pack.title,
    description: pack.description,
    parameters: parameterValues,
    steps: stepResults.map((step) => ({
      id: step.id,
      title: step.title,
      kind: step.kind,
      status: step.status,
      ...(step.query ? { query: step.query } : {}),
      ...(step.command ? { command: step.command } : {}),
      ...(step.reason ? { reason: step.reason } : {}),
      ...(step.output ? { output: step.output } : {}),
      outputSummary: summarizeStepOutput(step, step.output),
    })),
    summary: {
      stepCount: stepResults.length,
      succeededStepCount: stepResults.filter((step) => step.status === 'succeeded').length,
      failedStepCount: stepResults.filter((step) => step.status === 'failed').length,
      skippedStepCount: stepResults.filter((step) => step.status === 'skipped').length,
    },
  };
}

function buildDiagnosticPackManifest(report, reproducibility) {
  const reproducibilitySettings = normalizeReproducibilitySettings(reproducibility);
  const manifest = {
    schemaVersion: DIAGNOSTIC_PACK_MANIFEST_SCHEMA_VERSION,
    kind: 'diagnostic-query-pack-manifest',
    generatedAt: resolveTimestamp(reproducibilitySettings),
    enabled: Boolean(report && report.enabled),
    summary: report ? report.summary : {
      packCount: 0,
      succeededPackCount: 0,
      failedPackCount: 0,
      skippedPackCount: 0,
      stepCount: 0,
    },
    packs: asArray(report && report.packs).map((pack) => ({
      name: pack.name,
      title: pack.title,
      summary: pack.summary,
    })),
  };

  manifest.reproducibility = buildReproducibilityMetadata(
    reproducibilitySettings,
    hashNormalizedValue({
      enabled: manifest.enabled,
      summary: manifest.summary,
      packs: manifest.packs,
    }),
  );
  return manifest;
}

function runDiagnosticPacks(options = {}) {
  const packNames = normalizePackNames(options.packNames);
  const parameterValues = parseDiagnosticParameterString(options.parameterString);
  const reproducibility = normalizeReproducibilitySettings(options.reproducibility);

  if (packNames.length === 0) {
    const emptyReport = {
      schemaVersion: DIAGNOSTIC_PACK_REPORT_SCHEMA_VERSION,
      kind: 'diagnostic-query-pack-report',
      enabled: false,
      packs: [],
      summary: {
        packCount: 0,
        succeededPackCount: 0,
        failedPackCount: 0,
        skippedPackCount: 0,
        stepCount: 0,
      },
      notes: [],
    };
    return {
      report: emptyReport,
      manifest: buildDiagnosticPackManifest(emptyReport, reproducibility),
      notes: [],
    };
  }

  const runtime = {
    dbConfig: options.dbConfig || null,
    ibmiConfig: options.ibmiConfig || null,
    dbConfigured: isDbConfigured(options.dbConfig),
    ibmiConfigured: Boolean(
      options.ibmiConfig
      && String(options.ibmiConfig.host || '').trim()
      && String(options.ibmiConfig.user || '').trim()
      && options.ibmiConfig.password !== undefined
      && options.ibmiConfig.password !== null
    ),
    verbose: Boolean(options.verbose),
  };
  const executors = {
    ...defaultExecutors(),
    ...(options.executors || {}),
  };

  const packs = [];
  const notes = [];

  for (const packName of packNames) {
    const pack = getDiagnosticPack(packName);
    const parameterResolution = resolvePackParameters(pack, parameterValues);
    if (parameterResolution.errors.length > 0) {
      packs.push({
        name: pack.name,
        title: pack.title,
        description: pack.description,
        parameters: parameterResolution.resolved,
        steps: [],
        summary: {
          stepCount: 0,
          succeededStepCount: 0,
          failedStepCount: 0,
          skippedStepCount: 0,
        },
        error: parameterResolution.errors.join(' '),
      });
      notes.push(parameterResolution.errors.join(' '));
      continue;
    }

    const stepResults = [];
    let packFailed = false;
    for (const step of asArray(pack.steps)) {
      try {
        const executed = executeStep(step, parameterResolution.resolved, runtime, executors);
        stepResults.push({
          id: step.id,
          title: step.title,
          ...executed,
        });
        if (executed.status === 'failed') {
          packFailed = true;
        }
      } catch (error) {
        packFailed = true;
        stepResults.push({
          id: step.id,
          title: step.title,
          kind: step.kind,
          status: 'failed',
          reason: error.message,
          output: null,
        });
      }
    }

    const report = buildPackReport(pack, parameterResolution.resolved, stepResults);
    if (packFailed) {
      notes.push(`Diagnostic pack ${pack.name} completed with at least one failed step.`);
    }
    packs.push(report);
  }

  const report = {
    schemaVersion: DIAGNOSTIC_PACK_REPORT_SCHEMA_VERSION,
    kind: 'diagnostic-query-pack-report',
    enabled: true,
    generatedAt: resolveTimestamp(reproducibility),
    packs,
    summary: {
      packCount: packs.length,
      succeededPackCount: packs.filter((pack) => !pack.error && pack.summary.failedStepCount === 0 && pack.summary.skippedStepCount < pack.summary.stepCount).length,
      failedPackCount: packs.filter((pack) => pack.error || pack.summary.failedStepCount > 0).length,
      skippedPackCount: packs.filter((pack) => pack.summary.stepCount > 0 && pack.summary.skippedStepCount === pack.summary.stepCount).length,
      stepCount: packs.reduce((sum, pack) => sum + pack.summary.stepCount, 0),
    },
    notes,
  };

  return {
    report,
    manifest: buildDiagnosticPackManifest(report, reproducibility),
    notes,
  };
}

function renderDiagnosticPackMarkdown(report) {
  const lines = [
    '# Diagnostic Query Packs',
    '',
  ];

  if (!report || !report.enabled) {
    lines.push('No diagnostic packs were selected for this run.');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  lines.push(`Packs: ${report.summary.packCount}`);
  lines.push(`Steps: ${report.summary.stepCount}`);
  lines.push(`Failed Packs: ${report.summary.failedPackCount}`);
  lines.push('');

  for (const pack of asArray(report.packs)) {
    lines.push(`## ${pack.name}`);
    lines.push(pack.description || '');
    lines.push('');
    if (pack.error) {
      lines.push(`Error: ${pack.error}`);
      lines.push('');
      continue;
    }
    lines.push(`Parameters: ${Object.entries(pack.parameters || {}).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`);
    lines.push('');
    for (const step of asArray(pack.steps)) {
      lines.push(`### ${step.id}`);
      lines.push(`- Kind: ${step.kind}`);
      lines.push(`- Status: ${step.status}`);
      if (step.reason) {
        lines.push(`- Reason: ${step.reason}`);
      }
      if (step.outputSummary && Number.isFinite(step.outputSummary.rowCount)) {
        lines.push(`- Rows: ${step.outputSummary.rowCount}`);
      }
      if (step.outputSummary && Number.isFinite(step.outputSummary.messageCount)) {
        lines.push(`- Messages: ${step.outputSummary.messageCount}`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  ALLOWED_COMMAND_PREFIXES,
  DIAGNOSTIC_PACK_MANIFEST_SCHEMA_VERSION,
  DIAGNOSTIC_PACK_REPORT_SCHEMA_VERSION,
  buildDiagnosticPackManifest,
  parseDiagnosticParameterString,
  renderDiagnosticPackMarkdown,
  runDiagnosticPacks,
  validateReadOnlyCommand,
  validateReadOnlySql,
};
