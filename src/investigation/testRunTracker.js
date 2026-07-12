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
 * Test-Run Tracker — Lifecycle-Tracking für IBM i Integrationstests
 *
 * Motivation aus Session CHANGE-1234:
 *   Beim manuellen Testen auf SYS_TEST gab es keinen strukturierten Überblick
 *   darüber welche DAN-Nummern / Sätze vor dem Test in welchem Zustand waren
 *   und welche Rollback-SQL-Statements nötig waren um den Zustand wieder herzustellen.
 *
 * Workflow:
 *   1. zeus test-run start --profile <p> --table <lib.table> --key <col>=<val>
 *      → speichert Before-Snapshot als test-run-manifest.json
 *   2. Test durchführen (manuell oder automatisiert)
 *   3. zeus test-run capture --profile <p> --manifest <path>
 *      → liest After-Snapshot, vergleicht mit Before, schreibt Diff + Rollback-SQL
 *   4. zeus test-run rollback --manifest <path>
 *      → zeigt Rollback-SQL (NICHT ausführen — nur anzeigen!)
 *
 * Sicherheit: Diese Klasse führt KEINE Write-Operationen aus.
 *   Rollback-SQL wird nur angezeigt / geschrieben, NIE automatisch ausgeführt.
 */

const path = require('path');
const fs = require('fs');

/**
 * Baut eine SELECT-Abfrage um einen einzelnen Datensatz zu lesen.
 * @param {string} schema
 * @param {string} table
 * @param {{ [col: string]: string|number }} keyColumns - WHERE-Bedingung
 * @param {string[]} [selectColumns] - zu lesende Spalten (null = alle)
 */
function buildSnapshotQuery(schema, tableName, keyColumns, selectColumns) {
  const { validateSqlIdentifier, escapeSqlLiteral } = require('../db2/readOnlyQueryService');
  validateSqlIdentifier(schema, 'schema');
  validateSqlIdentifier(tableName, 'table');

  const selectPart =
    selectColumns && selectColumns.length > 0
      ? selectColumns
          .map(c => {
            validateSqlIdentifier(c, 'column');
            return c;
          })
          .join(', ')
      : '*';

  const whereParts = Object.entries(keyColumns).map(([col, val]) => {
    validateSqlIdentifier(col, 'key column');
    if (typeof val === 'number') {
      return `${col} = ${Number(val)}`;
    }
    return `${col} = ${escapeSqlLiteral(String(val))}`;
  });

  return `SELECT ${selectPart} FROM ${schema}.${tableName} WHERE ${whereParts.join(' AND ')}`;
}

/**
 * Liest einen Before- oder After-Snapshot aus der DB.
 *
 * @param {{ schema: string, table: string, keyColumns: object, selectColumns?: string[], dbConfig: object, runtime: object }} options
 * @returns {{ rows: object[], query: string, timestamp: string }}
 */
function captureSnapshot({ schema, table, keyColumns, selectColumns, dbConfig, runtime }) {
  const { runReadOnlyDb2Query } = require('../db2/readOnlyQueryService');

  const query = buildSnapshotQuery(schema, table, keyColumns, selectColumns || []);
  const result = runReadOnlyDb2Query({ dbConfig, query, maxRows: 200 });

  return {
    rows: result.rows || [],
    columns: result.columns || [],
    query,
    timestamp: new Date().toISOString(),
    table: `${schema}.${table}`,
    keyColumns,
  };
}

/**
 * Vergleicht Before- und After-Snapshot, gibt Diff und Rollback-SQL zurück.
 *
 * @param {{ schema: string, table: string, keyColumns: object, before: object, after: object }} options
 * @returns {{ changedRows: Array, rollbackSql: string[] }}
 */
function diffSnapshots({ schema, table, keyColumns, before, after }) {
  const { escapeSqlLiteral } = require('../db2/readOnlyQueryService');
  const beforeRows = before.rows || [];
  const afterRows = after.rows || [];

  const changedRows = [];
  const rollbackSql = [];

  // Zeilen matchen via PK-Felder
  const keyCols = Object.keys(keyColumns);

  for (const afterRow of afterRows) {
    const matchingBefore = beforeRows.find(br =>
      keyCols.every(
        k =>
          String(br[k] || br[k.toLowerCase()] || '').trim() ===
          String(afterRow[k] || afterRow[k.toLowerCase()] || '').trim()
      )
    );

    if (!matchingBefore) {
      changedRows.push({ type: 'INSERTED', row: afterRow });
      // Rollback: DELETE
      const whereParts = keyCols.map(k => {
        const val = afterRow[k] || afterRow[k.toLowerCase()];
        if (val === null || val === undefined) return `${k} IS NULL`;
        if (typeof val === 'number' || /^\d+$/.test(String(val).trim()))
          return `${k} = ${Number(val)}`;
        return `${k} = ${escapeSqlLiteral(String(val))}`;
      });
      rollbackSql.push(`DELETE FROM ${schema}.${table} WHERE ${whereParts.join(' AND ')};`);
      continue;
    }

    // Spaltenweise Vergleich
    const diffs = {};
    for (const [col, afterVal] of Object.entries(afterRow)) {
      const beforeVal = matchingBefore[col];
      if (String(afterVal ?? '') !== String(beforeVal ?? '')) {
        diffs[col] = { before: beforeVal, after: afterVal };
      }
    }

    if (Object.keys(diffs).length > 0) {
      changedRows.push({ type: 'UPDATED', row: afterRow, diffs });

      // Rollback: UPDATE mit Before-Werten
      const setParts = Object.entries(diffs).map(([col, { before: bVal }]) => {
        if (bVal === null || bVal === undefined) return `${col} = NULL`;
        if (typeof bVal === 'number' || /^\d+$/.test(String(bVal).trim()))
          return `${col} = ${Number(bVal)}`;
        return `${col} = ${escapeSqlLiteral(String(bVal))}`;
      });
      const whereParts = keyCols.map(k => {
        const val = afterRow[k] || afterRow[k.toLowerCase()];
        if (val === null || val === undefined) return `${k} IS NULL`;
        if (typeof val === 'number' || /^\d+$/.test(String(val).trim()))
          return `${k} = ${Number(val)}`;
        return `${k} = ${escapeSqlLiteral(String(val))}`;
      });
      rollbackSql.push(
        `UPDATE ${schema}.${table} SET ${setParts.join(', ')} WHERE ${whereParts.join(' AND ')};`
      );
    }
  }

  // Gelöschte Zeilen (in Before aber nicht in After)
  for (const beforeRow of beforeRows) {
    const isStillPresent = afterRows.some(ar =>
      keyCols.every(
        k =>
          String(ar[k] || ar[k.toLowerCase()] || '').trim() ===
          String(beforeRow[k] || beforeRow[k.toLowerCase()] || '').trim()
      )
    );

    if (!isStillPresent) {
      changedRows.push({ type: 'DELETED', row: beforeRow });
      // Rollback: INSERT mit Before-Werten
      const cols = Object.keys(beforeRow).filter(
        k => beforeRow[k] !== null && beforeRow[k] !== undefined
      );
      const vals = cols.map(c => {
        const v = beforeRow[c];
        if (typeof v === 'number' || /^\d+$/.test(String(v).trim())) return String(Number(v));
        return escapeSqlLiteral(String(v));
      });
      rollbackSql.push(
        `INSERT INTO ${schema}.${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`
      );
    }
  }

  return { changedRows, rollbackSql };
}

/**
 * Erstellt ein Test-Run-Manifest (JSON) das Before-Snapshot, Testbeschreibung
 * und Rollback-SQL enthält.
 *
 * @param {{ runId: string, label: string, program: string, tables: Array, beforeSnapshots: Map, outputPath: string }} options
 * @returns {string} Pfad zur geschriebenen Manifest-Datei
 */
function writeTestRunManifest({ runId, label, program, tables, beforeSnapshots, outputPath }) {
  const manifest = {
    kind: 'test-run-manifest',
    schemaVersion: 1,
    runId: runId || `TR-${Date.now()}`,
    label: label || 'Unbenannter Testlauf',
    program: String(program || '').toUpperCase(),
    createdAt: new Date().toISOString(),
    status: 'STARTED',
    tables: tables || [],
    snapshots: {},
    rollbackSql: [],
    _note:
      'Rollback-SQL ist nur zur manuellen Ausführung in ACS gedacht. Zeus führt es NICHT automatisch aus.',
  };

  if (beforeSnapshots) {
    for (const [key, snapshot] of beforeSnapshots.entries()) {
      manifest.snapshots[key] = { before: snapshot, after: null };
    }
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf8');
  return outputPath;
}

/**
 * Lädt ein vorhandenes Test-Run-Manifest.
 */
function loadTestRunManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (manifest.kind !== 'test-run-manifest') {
    throw new Error(`Datei ist kein test-run-manifest: ${manifestPath}`);
  }
  return manifest;
}

/**
 * Ergänzt das Manifest um After-Snapshot + Diff + Rollback-SQL und schreibt es zurück.
 */
function captureAndUpdateManifest({ manifestPath, afterSnapshots, dbConfig, runtime }) {
  const manifest = loadTestRunManifest(manifestPath);
  const allRollback = [];

  for (const [key, entry] of Object.entries(manifest.snapshots)) {
    if (!entry.before) continue;

    const afterSnapshot = afterSnapshots && afterSnapshots.get(key);
    if (afterSnapshot) {
      entry.after = afterSnapshot;
    } else {
      // Neu lesen
      const { table, keyColumns } = entry.before;
      const [schema, tableName] = table.split('.');
      try {
        entry.after = captureSnapshot({ schema, table: tableName, keyColumns, dbConfig, runtime });
      } catch (err) {
        entry.after = { error: err.message, timestamp: new Date().toISOString() };
      }
    }

    if (entry.before && entry.after && !entry.after.error) {
      const [schema, tableName] = entry.before.table.split('.');
      const { changedRows, rollbackSql } = diffSnapshots({
        schema,
        table: tableName,
        keyColumns: entry.before.keyColumns,
        before: entry.before,
        after: entry.after,
      });
      entry.diff = { changedRows };
      allRollback.push(...rollbackSql);
    }
  }

  manifest.status = 'CAPTURED';
  manifest.capturedAt = new Date().toISOString();
  manifest.rollbackSql = allRollback;

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

module.exports = {
  buildSnapshotQuery,
  captureSnapshot,
  diffSnapshots,
  writeTestRunManifest,
  loadTestRunManifest,
  captureAndUpdateManifest,
};
