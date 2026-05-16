/*
Copyright 2026 Zeus PromptKit Contributors

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
const { resolveAnalyzeConfig, resolveAnalyzeDbConfig, loadProfiles, resolveProfile } = require('../../config/runtimeConfig');
const { isDbConfigured } = require('../../db2/db2Config');
const { runWriteDb2Query } = require('../../db2/writeQueryService');

const WRITE_MODES = Object.freeze({
  'upsert-sql': {
    command: 'upsert-sql',
    pattern: /^\s*(INSERT|UPDATE|DELETE|MERGE)\s+/i,
    accepted: 'INSERT, UPDATE, DELETE, MERGE',
  },
  upsert: {
    command: 'upsert',
    pattern: /^\s*(INSERT|UPDATE|DELETE|MERGE)\s+/i,
    accepted: 'INSERT, UPDATE, DELETE, MERGE',
  },
  insert: {
    command: 'insert',
    pattern: /^\s*INSERT\s+/i,
    accepted: 'INSERT',
  },
  update: {
    command: 'update',
    pattern: /^\s*UPDATE\s+/i,
    accepted: 'UPDATE',
  },
});

function resolveWriteMode(mode = 'upsert-sql') {
  const key = String(mode || 'upsert-sql').trim().toLowerCase();
  return WRITE_MODES[key] || WRITE_MODES['upsert-sql'];
}

function validateWriteSql(sql, { mode = 'upsert-sql' } = {}) {
  const writeMode = resolveWriteMode(mode);
  if (!writeMode.pattern.test(sql)) {
    throw new Error(
      `${writeMode.command} only accepts DML statements: ${writeMode.accepted}. ` +
      'Use query-sql for SELECT statements.'
    );
  }
}

function resolveSqlText(args, { cwd = process.cwd() } = {}) {
  if (args.file && String(args.file).trim()) {
    const filePath = path.resolve(cwd, String(args.file).trim());
    try {
      return fs.readFileSync(filePath, 'utf8').trim();
    } catch (err) {
      const error = new Error(`Cannot read SQL file: ${filePath} — ${err.message}`);
      error.code = 'SQL_FILE_NOT_FOUND';
      throw error;
    }
  }
  if (args.sql && String(args.sql).trim()) {
    return String(args.sql).trim();
  }
  const error = new Error('Missing required option: --sql "<DML ...>" or --file <path>');
  error.code = 'SQL_REQUIRED';
  throw error;
}

async function runWriteSql(args, { mode = 'upsert-sql' } = {}) {
  const writeMode = resolveWriteMode(mode);

  if (!args.profile || !String(args.profile).trim()) {
    console.error('Missing required option: --profile <name>');
    process.exit(2);
  }

  // Safety: warn loudly when connected to a production system.
  try {
    const profiles = loadProfiles({ cwd: process.cwd(), env: process.env, args });
    const profile = resolveProfile(profiles, args.profile, { env: process.env });
    if (profile && profile.productionSystem) {
      console.error('');
      console.error('  *** FEHLER: Dieses Profil ist als productionSystem=true markiert!      ***');
      console.error(`  *** ${writeMode.command} verweigert Write-Operationen auf Produktionssystemen.   ***`);
      console.error('  *** Bitte SQL manuell in ACS ausführen.                                ***');
      console.error('');
      process.exit(3);
    }
  } catch (profileError) {
    if (profileError.code !== 'PROFILE_NOT_FOUND') {
      // Profile loading can fail for other reasons — let the main path handle it.
    }
  }

  let sql;
  try {
    sql = resolveSqlText(args, { cwd: process.cwd() });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  try {
    validateWriteSql(sql, { mode });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const config = resolveAnalyzeConfig(args, { cwd: process.cwd() });
  const dbConfig = resolveAnalyzeDbConfig(config, 'metadata');
  if (!isDbConfigured(dbConfig)) {
    console.error('DB2 connection configuration is incomplete for the selected profile.');
    process.exit(2);
  }

  console.log(`SQL: ${sql}`);
  console.log('');

  let result;
  try {
    result = runWriteDb2Query({ dbConfig, sql });
  } catch (err) {
    console.error(`Fehler bei der Ausführung: ${err.message}`);
    process.exit(1);
  }

  console.log(`${result.rowsAffected} row(s) affected`);
}

async function runUpsertSql(args) {
  await runWriteSql(args, { mode: 'upsert-sql' });
}

async function runInsertSql(args) {
  await runWriteSql(args, { mode: 'insert' });
}

async function runUpdateSql(args) {
  await runWriteSql(args, { mode: 'update' });
}

module.exports = { runUpsertSql, runInsertSql, runUpdateSql, validateWriteSql, resolveWriteMode };
