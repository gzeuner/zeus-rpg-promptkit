#!/usr/bin/env node
/*
 * query-table.js — Führt READ-ONLY SQL-Abfragen über jt400 aus.
 * Verwendet die zeus-internen Java-Helper und Profil-Konfiguration.
 *
 * Aufruf:
 *   node scripts/query-table.js --profile <name> --table <TABELLE> [--schema <SCHEMA>]
 *
 * Beispiel:
 *   node scripts/query-table.js --profile sample-fetch --table APPTABLE --schema APPDATA
 */

'use strict';

const path = require('path');
const { loadProfiles, resolveProfile } = require('../src/config/runtimeConfig');
const { ensureJavaHelperCompiled, runJavaHelper } = require('../src/fetch/jt400CommandRunner');
const { buildJdbcUrl, resolveDefaultSchema, isDbConfigured } = require('../src/db2/db2Config');

// ── CLI-Argumente parsen ────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      args[key] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.profile || !args.table) {
  console.error('Verwendung: node scripts/query-table.js --profile <name> --table <TABELLE> [--schema <SCHEMA>]');
  process.exit(1);
}

// ── Profil auflösen ─────────────────────────────────────────────────────────
const profiles = loadProfiles({ cwd: path.resolve(__dirname, '..') });
const profile  = resolveProfile(profiles, args.profile);

// DB-Config: aus Profil.db oder Profil.fetch (Fetch-Profile haben die Credentials)
const dbConfig = (profile && profile.db && isDbConfigured(profile.db))
  ? profile.db
  : (profile && profile.fetch ? {
      host:     profile.fetch.host,
      user:     profile.fetch.user,
      password: profile.fetch.password,
    } : null);

if (!dbConfig || !isDbConfigured(dbConfig)) {
  console.error('Keine DB2-Verbindungsdaten im Profil. Prüfe ZEUS_DB_HOST/ZEUS_DB_USER/ZEUS_DB_PASSWORD oder ZEUS_FETCH_* ENV-Variablen.');
  process.exit(1);
}

const schema = (args.schema || resolveDefaultSchema(dbConfig) || '').toUpperCase();
const table  = args.table.toUpperCase();
const url    = buildJdbcUrl(dbConfig, schema);

console.log(`\n=== zeus query-table ===`);
console.log(`Host   : ${dbConfig.host || '(aus URL)'}`);
console.log(`Schema : ${schema || '(keines)'}`);
console.log(`Tabelle: ${table}`);
console.log(`JDBC   : ${url}\n`);

// ── Java-Helper kompilieren (idempotent) ────────────────────────────────────
ensureJavaHelperCompiled();

// ── Hilfsfunktion: Query ausführen ──────────────────────────────────────────
function runQuery(label, sql) {
  console.log(`\n--- ${label} ---`);
  console.log(`SQL: ${sql.replace(/\s+/g, ' ').trim()}\n`);

  const result = runJavaHelper('Db2DiagnosticQueryRunner', [
    url,
    dbConfig.user,
    dbConfig.password,
    sql,
  ]);

  if (result.status !== 0) {
    console.error(`Fehler (exit ${result.status}): ${result.stderr || result.stdout}`);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch (_) {
    console.log(result.stdout);
    return;
  }

  if (!parsed.rows || parsed.rows.length === 0) {
    console.log('(keine Zeilen)');
    return;
  }

  // Spaltenbreiten berechnen
  const columns = parsed.columns || Object.keys(parsed.rows[0]);
  const widths  = columns.map((c) =>
    Math.max(c.length, ...parsed.rows.map((r) => String(r[c] ?? '').length))
  );

  // Header
  console.log(columns.map((c, i) => c.padEnd(widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));

  // Zeilen
  for (const row of parsed.rows) {
    console.log(columns.map((c, i) => String(row[c] ?? '').padEnd(widths[i])).join('  '));
  }
  console.log(`\n(${parsed.rows.length} Zeile(n))`);
}

// ── Queries ausführen ────────────────────────────────────────────────────────
runQuery(
  'Tabellen-Info',
  `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TEXT, ROW_LENGTH, NUMBER_ROWS
   FROM QSYS2.SYSTABLES
   WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}'`
);

runQuery(
  'Spalten-Info (alle Felder)',
  `SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE,
          IS_NULLABLE, COLUMN_TEXT, COLUMN_HEADING
   FROM QSYS2.SYSCOLUMNS
   WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}'
   ORDER BY ORDINAL_POSITION`
);

runQuery(
  'AZL*-Felder (Modul-relevante Spalten)',
  `SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE,
          IS_NULLABLE, COLUMN_TEXT, COLUMN_HEADING
   FROM QSYS2.SYSCOLUMNS
   WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}'
     AND (COLUMN_NAME LIKE 'AZL%' OR COLUMN_NAME LIKE 'AZLMO%'
          OR COLUMN_NAME LIKE 'AZLBO%' OR COLUMN_NAME LIKE 'AZLLN%'
          OR COLUMN_NAME LIKE 'AZLFA%')
   ORDER BY ORDINAL_POSITION`
);
