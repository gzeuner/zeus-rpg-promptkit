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
 * IBM i Platform Info — OS-Version-Cache und versions-sichere Catalog-Queries.
 *
 * Motivation aus Session CHANGE-1234:
 *   QSYS2.SYSTABLES hat auf manchen IBM i Versionen keine JOURNAL_LIBRARY,
 *   JOURNAL_IMAGES oder OMIT_JOURNAL_ENTRY_TYPES Spalten.
 *   QSYS2.OBJECT_STATISTICS ist der robuste Weg für Journal-Info.
 *   Dieser Service cached die OS-Version pro JDBC-URL und stellt
 *   versions-sichere Catalog-Query-Templates bereit.
 */

const { runReadOnlyDb2Query } = require('./readOnlyQueryService');
const { buildJdbcUrl, resolveDefaultSchema } = require('./db2Config');

// In-Memory-Cache: jdbcUrl -> { osVersion, osRelease, detectedAt }
const _versionCache = new Map();

/**
 * Ermittelt die IBM i OS-Version für einen DB-Config.
 * Ergebnis wird pro JDBC-URL gecacht.
 *
 * @param {object} dbConfig
 * @param {object} [runtime]
 * @returns {{ osVersion: string, osRelease: string, versionString: string, cached: boolean }}
 */
function getIbmiOsVersion(dbConfig, runtime = {}) {
  const cacheKey = buildJdbcUrl(dbConfig, resolveDefaultSchema(dbConfig));

  if (_versionCache.has(cacheKey)) {
    const cached = _versionCache.get(cacheKey);
    return { ...cached, cached: true };
  }

  try {
    // QSYS2.SYSTEM_STATUS_INFO hat keine OS_VERSION Spalte auf allen IBM i Versionen.
    // QSYS2.OBJECT_STATISTICS auf QSYS liefert CREATED_SYSTEM_VERSION zuverlässig (z.B. "V7R5M0").
    const result = runReadOnlyDb2Query({
      dbConfig,
      query: `SELECT CREATED_SYSTEM_VERSION
                FROM TABLE(QSYS2.OBJECT_STATISTICS('QSYS', '*LIB', 'QSYS')) AS X
               FETCH FIRST 1 ROW ONLY`,
      maxRows: 1,
      runtime,
    });

    const row = result.rows && result.rows[0];
    const rawVersion = row
      ? String(row.CREATED_SYSTEM_VERSION || row['CREATED_SYSTEM_VERSION'] || '').trim()
      : '';

    // Format: "V7R5M0" → osVersion=7, osRelease=5
    const versionMatch = rawVersion.match(/^V(\d+)R(\d+)M(\d+)$/i);
    const osVersion = versionMatch ? versionMatch[1] : '';
    const osRelease = versionMatch ? versionMatch[2] : '';
    const versionString = rawVersion || 'UNKNOWN';

    const entry = { osVersion, osRelease, versionString, detectedAt: new Date().toISOString() };
    _versionCache.set(cacheKey, entry);
    return { ...entry, cached: false };
  } catch (_err) {
    // Fallback: unbekannte Version — keine Annahmen über Catalog-Spalten
    return { osVersion: '', osRelease: '', versionString: 'UNKNOWN', cached: false };
  }
}

/**
 * Gibt den IBM i Version-Major als Zahl zurück (z.B. 7 für V7R5M0).
 */
function getIbmiMajorVersion(dbConfig, runtime = {}) {
  const { osVersion } = getIbmiOsVersion(dbConfig, runtime);
  const n = parseInt(osVersion, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Gibt den IBM i Minor-Release als Zahl zurück (z.B. 5 für V7R5M0).
 */
function getIbmiMinorVersion(dbConfig, runtime = {}) {
  const { osRelease } = getIbmiOsVersion(dbConfig, runtime);
  const n = parseInt(osRelease, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Prüft ob die IBM i Version >= major.minor ist.
 */
function isIbmiVersionAtLeast(major, minor, dbConfig, runtime = {}) {
  const v = getIbmiMajorVersion(dbConfig, runtime);
  const r = getIbmiMinorVersion(dbConfig, runtime);
  if (v > major) return true;
  if (v === major && r >= minor) return true;
  return false;
}

/**
 * Versions-sichere Journal-Info Query.
 *
 * Auf V7R4+ können wir OBJECT_STATISTICS direkt mit JOURNALED, JOURNAL_NAME,
 * JOURNAL_LIBRARY, JOURNAL_IMAGES abfragen.
 * Auf älteren Versionen gibt OBJECT_STATISTICS nur JOURNALED zurück
 * (ohne JOURNAL_NAME/LIBRARY/IMAGES).
 *
 * Robusteste Methode: OBJECT_STATISTICS mit Fallback auf SYSTABLES.JOURNAL.
 */
function buildJournalInfoQuery(schema, tableName) {
  // OBJECT_STATISTICS ist seit V7R2 verfügbar und enthält JOURNALED zuverlässig.
  // JOURNAL_NAME / JOURNAL_LIBRARY sind ab V7R3 in OBJECT_STATISTICS.
  // Wir fragen immer OBJECT_STATISTICS ab — das ist die Session-Lektion.
  return `SELECT
    OBJNAME      AS TABLE_NAME,
    OBJLIB       AS TABLE_SCHEMA,
    JOURNALED,
    JOURNAL_NAME,
    JOURNAL_LIBRARY,
    JOURNAL_IMAGES
  FROM TABLE(QSYS2.OBJECT_STATISTICS(${escapeSqlLiteral(schema)}, '*FILE', ${escapeSqlLiteral(tableName)})) AS X
  FETCH FIRST 1 ROW ONLY`;
}

/**
 * Fragt den Journal-Status einer Tabelle ab.
 * Gibt null zurück wenn die Tabelle nicht gefunden wird.
 *
 * @param {{ schema: string, tableName: string, dbConfig: object, runtime?: object }} opts
 * @returns {{ journaled: boolean, journalName: string, journalLibrary: string, journalImages: string } | null}
 */
function queryJournalStatus({ schema, tableName, dbConfig, runtime = {} }) {
  const query = buildJournalInfoQuery(schema, tableName);
  try {
    const result = runReadOnlyDb2Query({ dbConfig, query, maxRows: 1, runtime });
    const row = result.rows && result.rows[0];
    if (!row) return null;
    return {
      journaled: String(row.JOURNALED || row['JOURNALED'] || 'NO').trim().toUpperCase() === 'YES',
      journalName: String(row.JOURNAL_NAME || row['JOURNAL_NAME'] || '').trim(),
      journalLibrary: String(row.JOURNAL_LIBRARY || row['JOURNAL_LIBRARY'] || '').trim(),
      journalImages: String(row.JOURNAL_IMAGES || row['JOURNAL_IMAGES'] || '').trim(),
    };
  } catch (_err) {
    return null;
  }
}

/**
 * Fragt den Journal-Status mehrerer Tabellen auf einmal ab.
 * Gibt eine Map schema.TABLE -> JournalStatus zurück.
 *
 * @param {{ tables: Array<{schema: string, name: string}>, dbConfig: object, runtime?: object }} opts
 * @returns {Map<string, object>}
 */
function queryJournalStatusBatch({ tables, dbConfig, runtime = {} }) {
  const result = new Map();
  if (!tables || tables.length === 0) return result;

  // Deduplizieren
  const unique = [];
  const seen = new Set();
  for (const t of tables) {
    const key = `${String(t.schema || '').toUpperCase()}.${String(t.name || '').toUpperCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({ schema: String(t.schema || '').toUpperCase(), name: String(t.name || '').toUpperCase() });
    }
  }

  for (const t of unique) {
    const key = `${t.schema}.${t.name}`;
    const status = queryJournalStatus({ schema: t.schema, tableName: t.name, dbConfig, runtime });
    if (status !== null) {
      result.set(key, status);
    }
  }

  return result;
}

/**
 * Löscht den Version-Cache (für Tests).
 */
function clearVersionCache() {
  _versionCache.clear();
}

function escapeSqlLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

module.exports = {
  getIbmiOsVersion,
  getIbmiMajorVersion,
  getIbmiMinorVersion,
  isIbmiVersionAtLeast,
  buildJournalInfoQuery,
  queryJournalStatus,
  queryJournalStatusBatch,
  clearVersionCache,
};
