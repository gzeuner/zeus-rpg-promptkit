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

/**
 * inspect-object — Zeigt Eigenschaften von kompilierten IBM i Objekten an.
 *
 * Motivation aus Session CHANGE-1234:
 *   Zeus kennt nur Sourcen, nicht das compiled object landscape.
 *   Dieser Command zeigt per QSYS2.OBJECT_STATISTICS:
 *   - Kompilierungszeit, Besitzer, Quellmember
 *   - Journal-Status (bei *FILE)
 *   - Compiler-Version, Build-ID
 *
 * Usage:
 *   zeus inspect-object --profile <name> --lib <lib> --name <name> [--type *PGM|*FILE|*SRVPGM|*MODULE]
 *   zeus inspect-object --profile <name> --lib <lib> --name <name> --journal   (nur Journal-Info)
 */

const { resolveProfile, loadProfiles, resolveAnalyzeConfig, resolveAnalyzeDbConfig } = require('../../config/runtimeConfig');
const { isDbConfigured } = require('../../db2/db2Config');
const { runReadOnlyDb2Query } = require('../../db2/readOnlyQueryService');
const { validateSqlIdentifier, escapeSqlLiteral } = require('../../db2/readOnlyQueryService');
const { renderAsciiTable } = require('../helpers/asciiTable');

const SUPPORTED_TYPES = ['*PGM', '*SRVPGM', '*MODULE', '*FILE', '*CMD', '*DTAARA', '*JOBQ', '*OUTQ'];

function buildObjectStatisticsQuery(lib, name, objType) {
  const libLiteral = escapeSqlLiteral(lib.toUpperCase());
  const nameLiteral = escapeSqlLiteral(name.toUpperCase());
  const typeLiteral = escapeSqlLiteral(objType.toUpperCase());

  return `SELECT
    OBJNAME            AS NAME,
    OBJTYPE            AS TYPE,
    OBJLIB             AS LIBRARY,
    OBJATTRIBUTE       AS ATTRIBUTE,
    OBJOWNER           AS OWNER,
    OBJDEFINER         AS DEFINER,
    OBJCREATED         AS CREATED,
    CHANGE_TIMESTAMP   AS LAST_CHANGED,
    LAST_USED_TIMESTAMP AS LAST_USED,
    OBJTEXT            AS TEXT,
    SOURCE_FILE        AS SRC_FILE,
    SOURCE_LIBRARY     AS SRC_LIB,
    SOURCE_MEMBER      AS SRC_MEMBER,
    SOURCE_TIMESTAMP   AS SRC_TIMESTAMP,
    CREATED_SYSTEM     AS CREATED_ON,
    CREATED_SYSTEM_VERSION AS OS_VERSION,
    COMPILER           AS COMPILER,
    COMPILER_VERSION   AS COMPILER_VERSION,
    JOURNALED          AS JOURNALED,
    JOURNAL_NAME       AS JOURNAL_NAME,
    JOURNAL_LIBRARY    AS JOURNAL_LIB,
    JOURNAL_IMAGES     AS JOURNAL_IMAGES,
    OBJSIZE            AS SIZE_BYTES,
    SQL_OBJECT_TYPE    AS SQL_TYPE
  FROM TABLE(QSYS2.OBJECT_STATISTICS(${libLiteral}, ${typeLiteral}, ${nameLiteral})) AS X`;
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n === 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderObjectInfo(rows) {
  if (!rows || rows.length === 0) {
    return null;
  }

  const results = [];
  for (const row of rows) {
    const fields = [
      ['Name',            row.NAME       || row.name       || ''],
      ['Type',            row.TYPE       || row.type       || ''],
      ['Library',         row.LIBRARY    || row.library    || ''],
      ['Attribute',       row.ATTRIBUTE  || row.attribute  || ''],
      ['Owner',           row.OWNER      || row.owner      || ''],
      ['Definer',         row.DEFINER    || row.definer    || ''],
      ['Created',         row.CREATED    || row.created    || ''],
      ['Last Changed',    row.LAST_CHANGED || row.last_changed || ''],
      ['Last Used',       row.LAST_USED  || row.last_used  || ''],
      ['Text',            row.TEXT       || row.text       || ''],
      ['Source File',     row.SRC_FILE   || row.src_file   || ''],
      ['Source Library',  row.SRC_LIB    || row.src_lib    || ''],
      ['Source Member',   row.SRC_MEMBER || row.src_member || ''],
      ['Source Timestamp',row.SRC_TIMESTAMP || row.src_timestamp || ''],
      ['Created on System', row.CREATED_ON || row.created_on || ''],
      ['OS Version',      row.OS_VERSION || row.os_version || ''],
      ['Compiler',        row.COMPILER   || row.compiler   || ''],
      ['Compiler Version',row.COMPILER_VERSION || row.compiler_version || ''],
      ['Size',            formatBytes(row.SIZE_BYTES || row.size_bytes)],
      ['SQL Type',        row.SQL_TYPE   || row.sql_type   || ''],
    ].filter(([, v]) => String(v || '').trim() !== '');

    // Journal-Info
    const journaled = String(row.JOURNALED || row.journaled || 'NO').trim().toUpperCase();
    const journalName = String(row.JOURNAL_NAME || row.journal_name || '').trim();
    const journalLib  = String(row.JOURNAL_LIB  || row.journal_lib  || '').trim();
    const journalImages = String(row.JOURNAL_IMAGES || row.journal_images || '').trim();

    if (journaled === 'YES') {
      fields.push(['Journalized',  '✓ YES']);
      if (journalLib && journalName) {
        fields.push(['Journal',    `${journalLib}/${journalName} (${journalImages || '*AFTER'})`]);
      }
    } else {
      fields.push(['Journalized',  '✗ NO — SQLSTATE 55019 möglich bei COMMIT/ROLLBACK']);
    }

    results.push(renderAsciiTable(['Field', 'Value'], fields));
  }

  return results.join('\n\n');
}

async function runInspectObject(args) {
  const cwd = process.cwd();
  const env = process.env;

  const lib  = String(args.lib  || args.library || '').trim().toUpperCase();
  const name = String(args.name || '').trim().toUpperCase();
  const type = String(args.type || '*PGM').trim().toUpperCase();
  const journalOnly = Boolean(args.journal);

  if (!lib) {
    console.error('Fehler: --lib <library> ist erforderlich.');
    process.exit(2);
  }
  if (!name) {
    console.error('Fehler: --name <object> ist erforderlich.');
    process.exit(2);
  }

  // Identifier validieren
  try {
    validateSqlIdentifier(lib, '--lib');
    validateSqlIdentifier(name, '--name');
  } catch (err) {
    console.error(`Fehler: ${err.message}`);
    process.exit(2);
  }

  let resolvedAnalyzeConfig;
  try {
    const profiles = loadProfiles({ cwd, env, args });
    const profile = resolveProfile(profiles, args.profile, { env });
    if (profile && profile.productionSystem) {
      console.warn('\n  *** WARNUNG: Produktionssystem-Profil — nur lesender Zugriff! ***\n');
    }
    resolvedAnalyzeConfig = resolveAnalyzeConfig(args, { cwd, env });
  } catch (err) {
    console.error(`Konfigurationsfehler: ${err.message}`);
    process.exit(2);
  }

  const dbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata');
  if (!isDbConfigured(dbConfig)) {
    console.error('Fehler: DB2-Verbindung nicht konfiguriert. Prüfe das Profil mit: zeus doctor --profile <name>');
    process.exit(2);
  }

  const query = journalOnly
    ? `SELECT OBJNAME AS NAME, OBJLIB AS LIBRARY, OBJTYPE AS TYPE,
              JOURNALED, JOURNAL_NAME, JOURNAL_LIBRARY AS JOURNAL_LIB,
              JOURNAL_IMAGES
       FROM TABLE(QSYS2.OBJECT_STATISTICS(${escapeSqlLiteral(lib)}, ${escapeSqlLiteral(type)}, ${escapeSqlLiteral(name)})) AS X`
    : buildObjectStatisticsQuery(lib, name, type);

  let result;
  try {
    result = runReadOnlyDb2Query({ dbConfig, query, maxRows: 20 });
  } catch (err) {
    console.error(`DB2-Fehler: ${err.message}`);
    process.exit(1);
  }

  if (!result.rows || result.rows.length === 0) {
    console.log(`Kein Objekt ${lib}/${name} (${type}) gefunden.`);
    console.log('Tipp: Prüfe Bibliothek und Objektname. Unterstützte Typen: ' + SUPPORTED_TYPES.join(', '));
    return;
  }

  if (journalOnly) {
    const headers = ['Library', 'Name', 'Type', 'Journalized', 'Journal', 'Library', 'Images'];
    const matrix = result.rows.map((r) => [
      r.LIBRARY || r.library || '',
      r.NAME    || r.name    || '',
      r.TYPE    || r.type    || '',
      String(r.JOURNALED || r.journaled || 'NO').trim(),
      r.JOURNAL_NAME || r.journal_name || '',
      r.JOURNAL_LIB  || r.journal_lib  || '',
      r.JOURNAL_IMAGES || r.journal_images || '',
    ]);
    console.log(renderAsciiTable(headers, matrix));
    return;
  }

  const rendered = renderObjectInfo(result.rows);
  if (rendered) {
    console.log(`\nObjekt: ${lib}/${name} (${type})\n`);
    console.log(rendered);
  }

  console.log(`\n${result.rows.length} Objekt(e) gefunden.`);
}

module.exports = { runInspectObject };
