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
const { runDoctorChecks } = require('../cli/commands/doctorCommand');
const { executeQuerySql } = require('../core/queryService');

function readPackageVersion(cwd) {
  try {
    const packageJsonPath = path.resolve(cwd || process.cwd(), 'package.json');
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return String(parsed.version || '').trim() || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
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
  ];
}

function executeMcpToolCall(name, args = {}, context = {}) {
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

  const error = new Error(`Unknown tool: ${name}`);
  error.code = 'TOOL_NOT_FOUND';
  throw error;
}

module.exports = {
  executeMcpToolCall,
  listMcpTools,
  readPackageVersion,
};
