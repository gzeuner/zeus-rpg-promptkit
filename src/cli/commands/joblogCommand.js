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

const { renderAsciiTable } = require('../helpers/asciiTable');
const { resolveAnalyzeConfig, resolveAnalyzeDbConfig, loadProfiles, resolveProfile } = require('../../config/runtimeConfig');
const { isDbConfigured } = require('../../db2/db2Config');
const { runReadOnlyDb2Query, escapeSqlLiteral, validateSqlIdentifier } = require('../../db2/readOnlyQueryService');

/**
 * zeus joblog
 *
 * Query QSYS2.JOBLOG_INFO to display job messages.
 * Useful when a batch program fails silently (e.g., empty grid) and you need diagnostics.
 *
 * Usage:
 *   zeus joblog --profile <name> [--job <job-name>] [--severity WARNING|ERROR|INFO] [--max-messages <n>]
 */

async function runJoblog(args) {
  if (!args.profile || !String(args.profile).trim()) {
    console.error('Missing required option: --profile <name>');
    process.exit(2);
  }

  // Production system warning
  try {
    const profiles = loadProfiles({ cwd: process.cwd(), env: process.env, args });
    const profile = resolveProfile(profiles, args.profile, { env: process.env });
    if (profile && profile.productionSystem) {
      console.warn('');
      console.warn('  *** WARNUNG: Dieses Profil ist als productionSystem=true markiert! ***');
      console.warn('  *** Du bist mit einem PRODUKTIONSSYSTEM verbunden.                ***');
      console.warn('');
    }
  } catch (_) {
    // Profile error handled below
  }

  const config = resolveAnalyzeConfig(args, { cwd: process.cwd() });
  const dbConfig = resolveAnalyzeDbConfig(config, 'metadata');
  if (!isDbConfigured(dbConfig)) {
    console.error('DB2 connection configuration is incomplete for the selected profile.');
    process.exit(2);
  }

  const jobName = args.job ? String(args.job).trim().toUpperCase() : null;
  const severity = args.severity ? String(args.severity).trim().toUpperCase() : null;
  const maxMessages = parseInt(args['max-messages'] || '100', 10);

  // Build query
  const whereClauses = [];
  if (jobName) {
    whereClauses.push(`JOB_NAME LIKE ${escapeSqlLiteral(`${jobName}%`)}`);
  }
  if (severity && (severity === 'WARNING' || severity === 'ERROR' || severity === 'INFO')) {
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
    FETCH FIRST ${Math.min(maxMessages, 500)} ROWS ONLY
  `;

  try {
    const result = runReadOnlyDb2Query({
      dbConfig,
      query,
      maxRows: Math.min(maxMessages, 500),
    });

    if (!result.rows || result.rows.length === 0) {
      console.log('No job log entries found.');
      if (jobName) {
        console.log(`(searched for job: ${jobName})`);
      }
      return;
    }

    const columns = result.columns || [];
    const rows = result.rows || [];

    // Format output
    console.log(`Found ${rows.length} job log entries:`);
    console.log('');

    const matrix = rows.map(row =>
      columns.map(col => {
        const val = row[col];
        return val !== null && val !== undefined ? String(val).substring(0, 60) : '';
      })
    );

    console.log(renderAsciiTable(columns, matrix, { maxCellWidth: 50 }));
    console.log('');
    console.log(`Total: ${rows.length} message(s)`);

    if (rows.length >= maxMessages) {
      console.log(`(showing first ${maxMessages} entries; use --max-messages <n> to increase)`);
    }
  } catch (err) {
    console.error(`Job log query failed: ${err.message}`);
    if (err.message && err.message.includes('QSYS2.JOBLOG_INFO')) {
      console.error('');
      console.error('Note: QSYS2.JOBLOG_INFO may not be available on all IBM i versions.');
      console.error('Workaround: Use DSPJOBLOG in ACS or: SELECT * FROM QSYS2.HISTORY_LOG_INFO');
    }
    process.exit(2);
  }
}

module.exports = { runJoblog };
