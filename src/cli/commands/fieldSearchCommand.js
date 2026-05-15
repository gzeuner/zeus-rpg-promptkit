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
const { resolveProfile, loadProfiles } = require('../../config/runtimeConfig');
const { renderAsciiTable } = require('../helpers/asciiTable');
const {
  searchLocalSources,
  searchRemoteSources,
  searchFileXrefViaSql,
} = require('../../investigation/fieldXrefService');
const { runReadOnlyDb2Query } = require('../../db2/readOnlyQueryService');

/**
 * Load all source files from a local directory tree into a map relPath → content.
 */
function loadSourceFiles(sourceRoot) {
  const files = {};
  if (!fs.existsSync(sourceRoot)) return files;

  function walk(dir, base) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(base, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        walk(full, base);
      } else if (entry.isFile()) {
        try {
          files[rel] = fs.readFileSync(full, 'utf8');
        } catch (_) {
          // skip unreadable files
        }
      }
    }
  }
  walk(sourceRoot, sourceRoot);
  return files;
}

function resolveDbConfig(profile) {
  return profile && profile.db ? profile.db : null;
}

function printSectionHeader(title) {
  const line = '═'.repeat(60);
  console.log('');
  console.log(line);
  console.log(`  ${title}`);
  console.log(line);
}

function printLocalMatches(result, { verbose }) {
  printSectionHeader(`Stufe 1 — Lokale Quellsuche: "${result.field}"${result.table ? ` in Tabelle ${result.table}` : ''}`);

  if (result.matchCount === 0) {
    console.log('  Keine Treffer in lokalen Quellen.');
    return;
  }

  console.log(`  ${result.matchCount} Treffer${result.truncated ? ' (truncated)' : ''}`);
  console.log('');

  // Group by file
  const byFile = {};
  for (const m of result.matches) {
    if (!byFile[m.file]) byFile[m.file] = [];
    byFile[m.file].push(m);
  }

  for (const [file, matches] of Object.entries(byFile)) {
    console.log(`  ${file}`);
    for (const m of matches) {
      const contexts = m.tableContexts.length > 0
        ? m.tableContexts.map((tc) => `${tc.intent}:${tc.table}`).join(', ')
        : '';
      const contextStr = contexts ? `  [${contexts}]` : '';
      console.log(`    Zeile ${m.line}: ${m.text.trim()}${contextStr}`);
      if (verbose && m.contextBefore.length > 0) {
        for (const c of m.contextBefore) {
          console.log(`      ↑ ${c.lineNo}: ${c.text.trim()}`);
        }
      }
      if (verbose && m.contextAfter.length > 0) {
        for (const c of m.contextAfter) {
          console.log(`      ↓ ${c.lineNo}: ${c.text.trim()}`);
        }
      }
    }
    console.log('');
  }
}

function printRemoteMatches(result) {
  printSectionHeader(`Stufe 2 — Remote-Suche auf IBM i: ${result.sourceLib}/${result.sourceFile}`);

  if (result.error) {
    console.log(`  Fehler: ${result.error}`);
    return;
  }

  console.log(`  Durchsucht: ${result.memberCount} Member`);
  console.log(`  Treffer: ${result.matchCount}${result.truncated ? ' (truncated)' : ''}`);

  if (result.matchCount === 0) {
    console.log('  Keine Treffer auf IBM i.');
    return;
  }

  console.log('');

  // Group by member
  const byMember = {};
  for (const m of result.matches) {
    if (!byMember[m.member]) byMember[m.member] = [];
    byMember[m.member].push(m);
  }

  const rows = [];
  for (const [member, matches] of Object.entries(byMember).sort()) {
    for (const m of matches) {
      rows.push([member, String(m.line), m.text.trim().slice(0, 80)]);
    }
  }

  console.log(renderAsciiTable(['Member', 'Zeile', 'Text'], rows, { maxCellWidth: 80 }));
}

function printXrefMatches(result) {
  printSectionHeader(`Stufe 3 — Datei-Querverweise (QSYS2.SYSDEPEND): ${result.table}`);

  if (result.error) {
    console.log(`  Hinweis: ${result.error}`);
    console.log('  QSYS2.SYSDEPEND ist möglicherweise nicht verfügbar.');
    return;
  }

  if (result.matchCount === 0) {
    console.log('  Keine Abhängigkeiten gefunden.');
    return;
  }

  const rows = result.matches.map((row) => [
    row.DEP_TYPE || row.DEPTPYE || '',
    row.PROGRAM_LIB || row.DEPLIB || '',
    row.PROGRAM_NAME || row.DEPOBJ || '',
    row.DEPENDS_LIB || row.DEPLIB2 || '',
  ]);

  console.log(renderAsciiTable(['Typ', 'Programm-Library', 'Programm', 'Referenziert in Lib'], rows, { maxCellWidth: 40 }));
}

/**
 * Main entry point for `zeus field-search` command.
 *
 * Args:
 *   --profile <name>        Zeus profile
 *   --field <name>          Field name to search (required)
 *   --table <name>          Optional: table name to narrow context
 *   --source <path>         Local source root (overrides profile)
 *   --source-lib <lib>      IBM i source library for remote search (e.g. APPLIB)
 *   --source-file <file>    IBM i source file (default: QRPGLESRC)
 *   --mode local|remote|xref|all   Which search modes to run (default: all)
 *   --max-results <n>       Max matches per mode (default: 300)
 *   --verbose               Show context lines
 */
async function runFieldSearch(args) {
  const field = args.field ? String(args.field).toUpperCase().trim() : null;
  if (!field) {
    console.error('--field <name> ist erforderlich');
    process.exit(2);
  }

  const table = args.table ? String(args.table).toUpperCase().trim() : null;
  const maxResults = args['max-results'] ? parseInt(args['max-results'], 10) : 300;
  const verbose = args.verbose === true || args.verbose === 'true';
  const modeArg = String(args.mode || 'all').toLowerCase();
  const runLocal = modeArg === 'all' || modeArg === 'local';
  const runRemote = modeArg === 'all' || modeArg === 'remote';
  const runXref = modeArg === 'all' || modeArg === 'xref';

  // Load profile
  let profile;
  try {
    const profiles = loadProfiles({ cwd: process.cwd(), env: process.env, args });
    profile = resolveProfile(profiles, args.profile, { env: process.env });
  } catch (err) {
    console.error(`Profil-Fehler: ${err.message}`);
    process.exit(2);
  }

  // Resolve source root
  const sourceRoot = args.source || (profile && profile.sourceRoot)
    ? path.resolve(process.cwd(), args.source || profile.sourceRoot)
    : null;

  console.log(`Zeus Field Search — Feld: "${field}"${table ? ` | Tabelle: "${table}"` : ''}`);
  console.log(`Profil: ${args.profile || '(keins)'}`);

  // ── Stufe 1: Lokale Suche ───────────────────────────────────────────────
  if (runLocal) {
    if (!sourceRoot || !fs.existsSync(sourceRoot)) {
      console.log('\n[Stufe 1] Kein lokaler Quellpfad verfügbar — übersprungen.');
      console.log('  Hinweis: --source <pfad> angeben oder sourceRoot im Profil konfigurieren.');
    } else {
      console.log(`\n[Stufe 1] Lade lokale Quellen aus: ${sourceRoot}`);
      const sourceFiles = loadSourceFiles(sourceRoot);
      const fileCount = Object.keys(sourceFiles).length;
      console.log(`  ${fileCount} Dateien geladen`);

      const localResult = searchLocalSources(sourceFiles, { field, table, maxResults, contextLines: verbose ? 2 : 0 });
      printLocalMatches(localResult, { verbose });
    }
  }

  // ── Stufe 2: Remote-Suche via IbmiSourceSearcher ────────────────────────
  if (runRemote) {
    const dbConfig = resolveDbConfig(profile);
    const host = dbConfig && dbConfig.host ? dbConfig.host : null;
    const user = dbConfig && dbConfig.user ? dbConfig.user : null;
    const password = dbConfig && dbConfig.password ? dbConfig.password : null;
    const sourceLib = args['source-lib'] || null;
    const sourceFile = args['source-file'] || 'QRPGLESRC';

    if (!host || !user || !password) {
      console.log('\n[Stufe 2] Keine Datenbankverbindung konfiguriert — übersprungen.');
      console.log('  Hinweis: --profile mit db.host/user/password konfigurieren.');
    } else if (!sourceLib) {
      console.log('\n[Stufe 2] --source-lib fehlt — übersprungen.');
      console.log('  Hinweis: --source-lib <LIB> (z.B. APPLIB) angeben.');
    } else {
      console.log(`\n[Stufe 2] Starte Remote-Suche auf ${host}: ${sourceLib}/${sourceFile}...`);
      try {
        const remoteResult = searchRemoteSources({
          host, user, password, sourceLib, sourceFile, field, table, maxResults,
        });
        printRemoteMatches(remoteResult);
      } catch (err) {
        console.log(`\n[Stufe 2] Fehler: ${err.message}`);
      }
    }
  }

  // ── Stufe 3: Datei-Querverweise via SQL (QSYS2.SYSDEPEND) ────────────────
  if (runXref && table) {
    const dbConfig = resolveDbConfig(profile);
    const hasDb = dbConfig && dbConfig.host && dbConfig.user && dbConfig.password;

    if (!hasDb) {
      console.log('\n[Stufe 3] Keine Datenbankverbindung — übersprungen.');
    } else {
      console.log(`\n[Stufe 3] Suche Datei-Querverweise für Tabelle "${table}" in QSYS2.SYSDEPEND...`);
      try {
        const queryFn = async (sql, maxRows) => {
          const raw = runReadOnlyDb2Query({
            dbConfig,
            query: sql,
            maxRows: maxRows || 500,
          });
          return { rows: raw.rows || [], columns: raw.columns || [] };
        };

        const xrefResult = await searchFileXrefViaSql({
          runQuery: queryFn,
          table,
          schema: args.schema || null,
        });
        printXrefMatches(xrefResult);
      } catch (err) {
        console.log(`\n[Stufe 3] Fehler: ${err.message}`);
      }
    }
  } else if (runXref && !table) {
    console.log('\n[Stufe 3] --table nicht angegeben — Stufe 3 übersprungen (benötigt Tabellenname).');
  }

  console.log('');
  console.log('field-search abgeschlossen.');
}

module.exports = { runFieldSearch };
