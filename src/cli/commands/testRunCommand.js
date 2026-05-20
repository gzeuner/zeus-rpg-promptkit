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

/**
 * test-run — Lifecycle-Tracking für IBM i Integrationstests
 *
 * Subcommands:
 *   zeus test-run start   --profile <name> --program <pgm> --table <lib.table> --key <col>=<val> [--label <text>] [--out <dir>]
 *   zeus test-run capture --profile <name> --manifest <path>
 *   zeus test-run show    --manifest <path>
 *   zeus test-run rollback --manifest <path>   (zeigt Rollback-SQL — führt es NICHT aus)
 *
 * Beispiel (aus Session CHANGE-1234):
 *   zeus test-run start --profile sample-dev --program APPPGM --table APPLIB.APP_TABLE_00 --key ID=88656 --label "CHANGE-1234 Test DAN=127002"
 *   # ... Test durchführen ...
 *   zeus test-run capture --profile sample-dev --manifest test-run-manifest.json
 *   zeus test-run rollback --manifest test-run-manifest.json
 */

const path = require('path');
const { resolveProfile, loadProfiles, resolveAnalyzeConfig, resolveAnalyzeDbConfig } = require('../../config/runtimeConfig');
const { isDbConfigured } = require('../../db2/db2Config');
const {
  captureSnapshot,
  writeTestRunManifest,
  loadTestRunManifest,
  captureAndUpdateManifest,
} = require('../../investigation/testRunTracker');

/**
 * Parst --key col=val oder --key col:val Argumente.
 * Mehrfach verwendbar: --key ID=123 --key STATUS=5
 */
function parseKeyColumns(rawKeys) {
  const keyColumns = {};
  const keyList = Array.isArray(rawKeys) ? rawKeys : rawKeys ? [rawKeys] : [];
  for (const kv of keyList) {
    const sep = kv.includes('=') ? '=' : ':';
    const idx = kv.indexOf(sep);
    if (idx === -1) {
      throw new Error(`Ungültiges --key Format: "${kv}" — erwartet col=wert`);
    }
    const col = kv.slice(0, idx).trim().toUpperCase();
    const val = kv.slice(idx + 1).trim();
    keyColumns[col] = /^\d+$/.test(val) ? Number(val) : val;
  }
  return keyColumns;
}

/**
 * Parst --table schema.table oder schema/table Argumente.
 * Mehrfach verwendbar.
 */
function parseTableRef(rawTable) {
  const s = String(rawTable || '').trim().replace('/', '.').toUpperCase();
  const parts = s.split('.');
  if (parts.length !== 2) {
    throw new Error(`Ungültiges --table Format: "${rawTable}" — erwartet SCHEMA.TABLE`);
  }
  return { schema: parts[0], table: parts[1] };
}

async function run(args) {
  const subcommand = String(args.subcommand || args.sub || args._[0] || args._[1] || '').trim().toLowerCase();

  if (!subcommand || subcommand === 'help') {
    console.log('');
    console.log('zeus test-run — Lifecycle-Tracking für IBM i Integrationstests');
    console.log('');
    console.log('Subcommands:');
    console.log('  start    — Before-Snapshot aufnehmen, Manifest anlegen');
    console.log('  capture  — After-Snapshot aufnehmen, Diff + Rollback-SQL schreiben');
    console.log('  show     — Manifest anzeigen');
    console.log('  rollback — Rollback-SQL aus Manifest anzeigen (nicht ausführen!)');
    console.log('');
    console.log('Beispiel:');
    console.log('  zeus test-run start --profile sample-dev --program APPPGM \\');
    console.log('       --table APPLIB.APP_TABLE_00 --key ID=88656 --label "Test DAN=127002"');
    console.log('  zeus test-run capture --profile sample-dev --manifest test-run-manifest.json');
    console.log('  zeus test-run rollback --manifest test-run-manifest.json');
    console.log('');
    return;
  }

  if (subcommand === 'show') {
    const manifestPath = args.manifest || args.m;
    if (!manifestPath) {
      console.error('Fehler: --manifest <path> ist erforderlich.');
      process.exit(2);
    }
    let manifest;
    try {
      manifest = loadTestRunManifest(path.resolve(manifestPath));
    } catch (err) {
      console.error(`Fehler beim Laden: ${err.message}`);
      process.exit(2);
    }
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (subcommand === 'rollback') {
    const manifestPath = args.manifest || args.m;
    if (!manifestPath) {
      console.error('Fehler: --manifest <path> ist erforderlich.');
      process.exit(2);
    }
    let manifest;
    try {
      manifest = loadTestRunManifest(path.resolve(manifestPath));
    } catch (err) {
      console.error(`Fehler beim Laden: ${err.message}`);
      process.exit(2);
    }

    const sql = manifest.rollbackSql || [];
    if (sql.length === 0) {
      if (String(manifest.status || '').toUpperCase() === 'CAPTURED') {
        console.log('Kein Rollback-SQL erforderlich (keine Datenänderung zwischen Before/After erkannt).');
      } else {
        console.log('Kein Rollback-SQL vorhanden (noch kein After-Snapshot aufgenommen?).');
        console.log('Führe zuerst aus: zeus test-run capture --manifest <path>');
      }
      return;
    }

    console.log('');
    console.log('*** ROLLBACK-SQL (nur zur MANUELLEN Ausführung in ACS!) ***');
    console.log('*** Zeus führt diese Statements NICHT automatisch aus!   ***');
    console.log('');
    for (const stmt of sql) {
      console.log(stmt);
    }
    console.log('');
    console.log(`${sql.length} Statement(s) — bitte in ACS Script Runner ausführen.`);
    return;
  }

  // Für start + capture: DB-Verbindung nötig
  const cwd = process.cwd();
  const env = process.env;
  let resolvedAnalyzeConfig;
  if (!args.profile || !String(args.profile).trim()) {
    console.error('Fehler: --profile <name> ist erforderlich.');
    process.exit(2);
  }

  try {
    const profiles = loadProfiles({ cwd, env, args });
    const profile = resolveProfile(profiles, args.profile, { env });
    if (profile && profile.productionSystem) {
      console.error('');
      console.error('  *** FEHLER: Produktionssystem-Profil! ***');
      console.error('  *** test-run ist nur für Testsysteme erlaubt. ***');
      console.error('');
      process.exit(2);
    }
    resolvedAnalyzeConfig = resolveAnalyzeConfig(args, { cwd, env });
  } catch (err) {
    console.error(`Konfigurationsfehler: ${err.message}`);
    process.exit(2);
  }

  const dbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata');
  if (!isDbConfigured(dbConfig)) {
    console.error('Fehler: DB2-Verbindung nicht konfiguriert. Prüfe: zeus doctor --profile <name>');
    process.exit(2);
  }

  if (subcommand === 'start') {
    const program  = String(args.program || args.p || '').trim().toUpperCase();
    const rawTable = args.table || args.t;
    const rawKeys  = args.key   || args.k;
    const label    = String(args.label || args.l || `Testlauf ${new Date().toISOString()}`).trim();
    const outDir   = String(args.out   || '.').trim();

    if (!program) { console.error('Fehler: --program <name> ist erforderlich.'); process.exit(2); }
    if (!rawTable) { console.error('Fehler: --table <schema.table> ist erforderlich.'); process.exit(2); }
    if (!rawKeys)  { console.error('Fehler: --key <col=val> ist erforderlich.'); process.exit(2); }

    let tableRef, keyColumns;
    try {
      tableRef = parseTableRef(rawTable);
      keyColumns = parseKeyColumns(rawKeys);
    } catch (err) {
      console.error(`Fehler: ${err.message}`);
      process.exit(2);
    }

    console.log(`\nBefore-Snapshot: ${tableRef.schema}.${tableRef.table} (${JSON.stringify(keyColumns)})`);

    let beforeSnapshot;
    try {
      beforeSnapshot = captureSnapshot({
        schema: tableRef.schema,
        table: tableRef.table,
        keyColumns,
        dbConfig,
      });
    } catch (err) {
      console.error(`DB2-Fehler beim Snapshot: ${err.message}`);
      process.exit(2);
    }

    const runId = `TR-${Date.now()}`;
    const manifestPath = path.resolve(outDir, 'test-run-manifest.json');
    const beforeSnapshots = new Map([[`${tableRef.schema}.${tableRef.table}`, beforeSnapshot]]);

    writeTestRunManifest({
      runId,
      label,
      program,
      tables: [`${tableRef.schema}.${tableRef.table}`],
      beforeSnapshots,
      outputPath: manifestPath,
    });

    console.log(`Before-Snapshot aufgenommen: ${beforeSnapshot.rows.length} Zeile(n)`);
    console.log(`Manifest geschrieben: ${manifestPath}`);
    console.log('');
    console.log('Nächster Schritt nach dem Test:');
    console.log(`  zeus test-run capture --profile ${args.profile || 'default'} --manifest ${manifestPath}`);
    return;
  }

  if (subcommand === 'capture') {
    const manifestPath = args.manifest || args.m;
    if (!manifestPath) {
      console.error('Fehler: --manifest <path> ist erforderlich.');
      process.exit(2);
    }

    const absPath = path.resolve(manifestPath);
    let manifest;
    try {
      manifest = captureAndUpdateManifest({ manifestPath: absPath, dbConfig });
    } catch (err) {
      console.error(`Fehler: ${err.message}`);
      process.exit(2);
    }

    const rollbackCount = (manifest.rollbackSql || []).length;
    console.log(`After-Snapshot aufgenommen. ${rollbackCount} Rollback-Statement(s) generiert.`);
    console.log(`Manifest aktualisiert: ${absPath}`);
    if (rollbackCount > 0) {
      console.log('');
      console.log('Rollback-SQL anzeigen:');
      console.log(`  zeus test-run rollback --manifest ${absPath}`);
    }
    return;
  }

  console.error(`Unbekannter Subcommand: ${subcommand}`);
  console.error('Verfügbar: start, capture, show, rollback');
  process.exit(2);
}

module.exports = { run };
