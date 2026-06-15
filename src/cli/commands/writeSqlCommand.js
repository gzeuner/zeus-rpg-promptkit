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
const { resolveAnalyzeConfig, resolveAnalyzeDbConfig, loadProfiles, resolveProfile } = require('../../config/runtimeConfig');
const { isDbConfigured } = require('../../db2/db2Config');
const { runWriteDb2Query } = require('../../db2/writeQueryService');
const { runReadOnlyDb2Query } = require('../../db2/readOnlyQueryService');

const PREFLIGHT_OPERATIONS = /^\s*(DELETE|UPDATE)\s+/i;
const BACKUP_PREFIX = 'BAK';
const BACKUP_TIMESTAMP_LENGTH = 12;
const BACKUP_NAME_MAX_LENGTH = 18;

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
  delete: {
    command: 'delete',
    pattern: /^\s*DELETE\s+/i,
    accepted: 'DELETE',
  },
  'write-sql': {
    command: 'write-sql',
    pattern: /^\s*(INSERT|UPDATE|DELETE|MERGE)\s+/i,
    accepted: 'INSERT, UPDATE, DELETE, MERGE',
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

function extractTargetTable(sql) {
  // DELETE FROM <schema.table> or UPDATE <schema.table>
  const m = sql.match(/^\s*(?:DELETE\s+FROM|UPDATE)\s+([\w$.]+)/i);
  return m ? m[1].toUpperCase() : null;
}

function buildPreflightCountSql(sql) {
  const table = extractTargetTable(sql);
  if (!table) return null;

  // DELETE FROM <table> [WHERE ...]
  const deleteWhere = sql.match(/^\s*DELETE\s+FROM\s+[\w$.]+(?:\s+(WHERE\s+[\s\S]+?))?\s*$/i);
  if (deleteWhere) {
    const where = deleteWhere[1] ? deleteWhere[1].trim() : null;
    return where
      ? `SELECT COUNT(*) AS ANZAHL FROM ${table} ${where}`
      : `SELECT COUNT(*) AS ANZAHL FROM ${table}`;
  }

  // UPDATE <table> SET ... [WHERE ...]
  const updateWhere = sql.match(/^\s*UPDATE\s+[\w$.]+\s+SET\s+[\s\S]+?(?:\s+(WHERE\s+[\s\S]+?))?\s*$/i);
  if (updateWhere) {
    const where = updateWhere[1] ? updateWhere[1].trim() : null;
    return where
      ? `SELECT COUNT(*) AS ANZAHL FROM ${table} ${where}`
      : `SELECT COUNT(*) AS ANZAHL FROM ${table}`;
  }

  return `SELECT COUNT(*) AS ANZAHL FROM ${table}`;
}

function buildBackupSql(targetTable, schema) {
  const parts = targetTable.split('.');
  const tableName = parts[parts.length - 1];
  const backupSchema = schema || (parts.length > 1 ? parts[0] : null);
  const backupName = buildBackupObjectName(tableName);
  const backupFqn = backupSchema ? `${backupSchema}.${backupName}` : backupName;
  return `CREATE TABLE ${backupFqn} AS (SELECT * FROM ${targetTable}) WITH DATA`;
}

function sanitizeBackupNameSegment(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '');
  return normalized.replace(/^_+/, '');
}

function formatBackupTimestamp(now = new Date()) {
  return new Date(now)
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(2, 2 + BACKUP_TIMESTAMP_LENGTH);
}

function buildBackupObjectName(tableName, { now = new Date() } = {}) {
  const timestamp = formatBackupTimestamp(now);
  const maxTableLength = Math.max(1, BACKUP_NAME_MAX_LENGTH - BACKUP_PREFIX.length - BACKUP_TIMESTAMP_LENGTH);
  const tableSegment = sanitizeBackupNameSegment(tableName).slice(0, maxTableLength) || 'T';
  return `${BACKUP_PREFIX}${tableSegment}${timestamp}`.slice(0, BACKUP_NAME_MAX_LENGTH);
}

function resolveBackupSchema(args, config, targetTable) {
  if (args['backup-schema']) {
    return String(args['backup-schema']).trim().toUpperCase();
  }
  if (config && config.db && config.db.defaultSchema) {
    return String(config.db.defaultSchema).trim().toUpperCase();
  }
  const parts = String(targetTable || '').split('.');
  return parts.length > 1 ? String(parts[0]).trim().toUpperCase() : null;
}

function ensureBackupCreated({
  args,
  config,
  dbConfig,
  sql,
  services = {},
}) {
  const shouldBackup = Boolean(args.backup || args['require-backup']);
  if (!shouldBackup) {
    return null;
  }

  const runWriteDb2QueryFn = services.runWriteDb2Query || runWriteDb2Query;
  const targetTable = extractTargetTable(sql);
  if (!targetTable) {
    if (args['require-backup']) {
      throw new Error('Zieltabelle konnte nicht aus SQL ermittelt werden. --require-backup verhindert die Schreiboperation.');
    }
    console.error('[backup] Zieltabelle konnte nicht aus SQL ermittelt werden — Backup übersprungen.');
    return null;
  }

  const backupSchema = resolveBackupSchema(args, config, targetTable);
  const backupSql = buildBackupSql(targetTable, backupSchema);
  console.log(`[backup] Sichere Tabelle: ${targetTable}`);
  console.log(`[backup] CREATE-Statement: ${backupSql}`);
  runWriteDb2QueryFn({
    dbConfig,
    sql: backupSql,
    runtime: {
      scopeLabel: 'DB2 backup connection',
    },
  });
  console.log('[backup] Backup-Tabelle erfolgreich angelegt.');
  return {
    targetTable,
    backupSchema,
    backupSql,
  };
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

  // Pre-flight: Row-Count für DELETE/UPDATE anzeigen und ggf. auf --confirm warten
  if (PREFLIGHT_OPERATIONS.test(sql)) {
    const countSql = buildPreflightCountSql(sql);
    if (countSql) {
      let rowCount = '?';
      try {
        const countResult = runReadOnlyDb2Query({
          dbConfig,
          query: countSql,
          maxRows: 1,
          runtime: {
            scopeLabel: 'DB2 preflight read-only connection',
          },
        });
        const row = (countResult.rows || [])[0];
        rowCount = row ? (row.ANZAHL || row.anzahl || Object.values(row)[0] || '?') : '?';
      } catch (_) {
        // Count-Fehler ist nicht kritisch — weiter ohne Zahl
      }
      console.log(`[preflight] Betroffene Zeilen: ${rowCount}`);
      if (args['dry-run']) {
        console.log('');
        console.log('[dry-run] Kein SQL ausgef\u00fchrt. Beende mit --confirm oder --force um tats\u00e4chlich auszuf\u00fchren.');
        process.exit(0);
      }
      if (!args.confirm && !args.force) {
        console.error('');
        console.error('[preflight] Abbruch \u2014 bitte --confirm zum Ausf\u00fchren oder --force zum \u00dcberspringen der Pr\u00fcfung angeben.');
        process.exit(4);
      }
      console.log('');
    }
  }

  // Backup: vor DELETE/UPDATE eine Sicherungskopie der Zieltabelle anlegen
  if (args.backup || args['require-backup']) {
    try {
      ensureBackupCreated({
        args,
        config,
        dbConfig,
        sql,
      });
    } catch (err) {
      console.error(`[backup] FEHLER beim Anlegen der Backup-Tabelle: ${err.message}`);
      console.error('[backup] Abbruch — SQL wurde NICHT ausgeführt.');
      process.exit(1);
    }
    console.log('');
  }

  let result;
  try {
    result = runWriteDb2Query({
      dbConfig,
      sql,
      runtime: {
        scopeLabel: 'DB2 write connection',
      },
    });
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

async function runDeleteSql(args) {
  await runWriteSql(args, { mode: 'delete' });
}

module.exports = {
  buildBackupObjectName,
  buildBackupSql,
  ensureBackupCreated,
  extractTargetTable,
  formatBackupTimestamp,
  resolveSqlText,
  resolveWriteMode,
  runDeleteSql,
  runInsertSql,
  runUpdateSql,
  runUpsertSql,
  validateWriteSql,
};
