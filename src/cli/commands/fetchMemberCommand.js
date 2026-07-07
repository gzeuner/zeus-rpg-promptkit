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
const { resolveFetchConfig } = require('../../config/runtimeConfig');
const { exportSourceMemberViaJdbc } = require('../../fetch/jt400CommandRunner');

const DEFAULT_SOURCE_FILE = 'QRPGLESRC';
const DEFAULT_STREAM_FILE_CCSID = 1208;

async function runFetchMember(args) {
  const verbose = Boolean(args.verbose);

  const memberArg = String(args.member || args.m || '').trim();
  if (!memberArg) {
    console.error('Missing required option: --member <name> (komma-getrennte Liste moeglich)');
    process.exit(2);
  }

  const members = memberArg.split(',').map((m) => m.trim().toUpperCase()).filter(Boolean);

  const sourceFile = String(args.file || args['source-file'] || DEFAULT_SOURCE_FILE).trim().toUpperCase();

  let fetchConfig;
  let outDir;
  try {
    fetchConfig = resolveFetchConfig(args, { cwd: process.cwd() });
    outDir = String(args.out || fetchConfig.out || '.').trim();
  } catch (_) {
    outDir = String(args.out || '.').trim();
  }

  let host, user, password;
  try {
    fetchConfig = fetchConfig || resolveFetchConfig(args, { cwd: process.cwd() });
    host = fetchConfig.host;
    user = fetchConfig.user;
    password = fetchConfig.password;
  } catch (err) {
    console.error('Konfigurationsfehler: ' + err.message);
    process.exit(2);
  }

  const sourceLib = String(args.lib || args['source-lib'] || (fetchConfig && (fetchConfig.sourceLib || fetchConfig.sourceLibrary)) || '').trim().toUpperCase();
  if (!sourceLib) {
    console.error('Missing required option: --lib <library> oder Profilwert fetch.sourceLib/fetch.sourceLibrary');
    process.exit(2);
  }

  // Helpful validation: catch common mix-up of --lib (Library) vs Source File (e.g. QRPGLESRC)
  if (/^Q[A-Z0-9]*SRC$/i.test(sourceLib) || /SRC$/i.test(sourceLib)) {
    console.warn(
      `[WARN] --lib / sourceLib="${sourceLib}" sieht aus wie ein Source-File-Name (z. B. QRPGLESRC). ` +
      'Falls gemeint war der Source File, nutze --file. ' +
      'Falls eine Library gemeint ist, ignoriere diese Warnung.'
    );
  }

  if (!host || !user || !password) {
    console.error('Fehlende Verbindungskonfiguration (host/user/password). --profile oder Env-Variablen setzen.');
    process.exit(2);
  }

  if (fetchConfig && fetchConfig.hostEnvOverride) {
    console.warn(
      `[WARN] ZEUS_FETCH_HOST="${fetchConfig.hostEnvOverride.envValue}" ueberschreibt`
      + ` Profil-Wert "${fetchConfig.hostEnvOverride.profileValue}".`
      + ' Benutze --host <HOST> zum expliziten Setzen.',
    );
  }
  if (fetchConfig && fetchConfig.sourceLibEnvOverride) {
    console.warn(
      `[WARN] ZEUS_FETCH_SOURCE_LIB="${fetchConfig.sourceLibEnvOverride.envValue}" ueberschreibt`
      + ` Profil-Wert "${fetchConfig.sourceLibEnvOverride.profileValue}".`
      + ' Benutze --lib <LIB> zum expliziten Setzen.',
    );
  }

  const ext = resolveExtension(sourceFile);
  const localSubDir = path.resolve(process.cwd(), outDir, sourceFile);
  if (!fs.existsSync(localSubDir)) {
    fs.mkdirSync(localSubDir, { recursive: true });
  }

  let errors = 0;
  for (const member of members) {
    const localFile = path.join(localSubDir, member + ext);

    if (verbose) {
      console.log('[verbose] IBM i: ' + host);
      console.log('[verbose] Source: ' + sourceLib + '/' + sourceFile + '(' + member + ')');
      console.log('[verbose] Local:  ' + localFile);
    }

    console.log('Fetching ' + sourceLib + '/' + sourceFile + '(' + member + ') -> ' + localFile + ' ...');

    const result = exportSourceMemberViaJdbc({
      host,
      user,
      password,
      sourceLib,
      sourceFile,
      member,
      targetPath: localFile,
      streamFileCcsid: DEFAULT_STREAM_FILE_CCSID,
      writeMode: 'local',
      verbose,
    });

    if (!result.ok) {
      const msgs = result.messages.join('; ') || result.stderr || 'Unbekannter Fehler';
      console.error('  FEHLER: ' + msgs);
      errors++;
      continue;
    }

    // Post-Fetch-Verifikation: sicherstellen, dass die Datei wirklich lokal
    // gelandet ist. Ein OK-Status vom Exporter allein reicht nicht.
    let localStat = null;
    try {
      localStat = fs.statSync(localFile);
    } catch (_) {
      localStat = null;
    }
    if (!localStat || !localStat.isFile() || localStat.size === 0) {
      console.error('  FEHLER: Lokale Datei wurde nicht (oder leer) geschrieben: ' + localFile);
      errors++;
      continue;
    }

    console.log('  OK -- ' + result.linesWritten + ' Zeilen: ' + localFile);
    if (result.usedFallback) console.log('  (JDBC-Fallback verwendet)');
  }

  if (errors > 0) {
    console.error('\n' + errors + ' von ' + members.length + ' Member(n) fehlgeschlagen.');
    process.exit(1);
  }
  if (members.length > 1) {
    console.log('\n' + members.length + ' Member erfolgreich abgerufen.');
  }
}

function resolveExtension(sourceFile) {
  const upper = sourceFile.toUpperCase();
  // Exact matches for standard IBM i source files
  if (upper === 'QRPGLESRC' || upper === 'QRPGFREE') return '.rpgle';
  if (upper === 'QCLLESRC' || upper === 'QCLSRC') return '.clle';
  if (upper === 'QDDSSRC') return '.dds';
  if (upper === 'QSQLSRC' || upper === 'SQLSRC') return '.sql';
  if (upper === 'QCPYSRC') return '.rpgleinc';
  if (upper === 'QSRVSRC') return '.bnd';
  // Heuristics for custom / non-standard source files (e.g. SQLTBLSRC, DDL sources)
  if (upper.includes('SQL') || upper.includes('TBL') || upper.includes('TABLE') || upper.includes('DDL')) {
    return '.sql';
  }
  if (upper.includes('DDS')) return '.dds';
  if (upper.includes('CL')) return '.clle';
  if (upper.includes('RPG')) return '.rpgle';
  return '.rpgle';
}

module.exports = { runFetchMember };
