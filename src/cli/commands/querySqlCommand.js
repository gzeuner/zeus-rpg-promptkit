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
const fs = require('fs');
const path = require('path');
const { renderAsciiTable } = require('../helpers/asciiTable');
const { renderCsv } = require('../helpers/csvRenderer');
const {
  loadProfiles,
  resolveAnalyzeConfig,
  resolveAnalyzeDbConfig,
  resolveProfile,
} = require('../../config/runtimeConfig');
const { printDbRuntimeConflictWarnings } = require('../helpers/runtimeConfigWarnings');
const {
  DEFAULT_MAX_ROWS,
  executeQuerySql,
  normalizeOutput,
  parseMaxRows,
  toRowMatrix,
} = require('../../core/queryService');
const { createJsonOutput } = require('../helpers/jsonOutput');

async function runQuerySql(args) {
  const watchSec = args.watch ? parseInt(String(args.watch), 10) : 0;
  if (watchSec > 0 && !isNaN(watchSec)) {
    // --watch: Query wiederholen bis Ctrl+C
    const watchArgs = { ...args, watch: undefined };
    console.log(`[watch] Starte Watch-Modus (alle ${watchSec}s). Ctrl+C zum Beenden.`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      process.stdout.write('\x1B[2J\x1B[0f'); // clear screen
      await runSingleQuery(watchArgs);
      process.stdout.write(`\n[watch] ${new Date().toLocaleTimeString()} | naechste Aktualisierung in ${watchSec}s\n`);
      await new Promise((resolve) => setTimeout(resolve, watchSec * 1000));
    }
  } else {
    await runSingleQuery(args);
  }
}

async function runSingleQuery(args) {
  let output;
  try {
    output = normalizeOutput(args.output);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  try {
    // productionSystem-Warnung: vor der Abfrage ausgeben (nicht bei CSV-Output)
    if (output !== 'csv') {
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
        // Profilfehler wird von executeQuerySql behandelt
      }
    }

    try {
      const config = resolveAnalyzeConfig(args, { cwd: process.cwd(), env: process.env });
      printDbRuntimeConflictWarnings(resolveAnalyzeDbConfig(config, 'metadata'));
    } catch (_) {
      // Konfigurationsfehler wird von executeQuerySql behandelt
    }

    const execution = executeQuerySql(args);

    const { sql, defaultSchema, columns, matrix } = execution;

    // --save: Ergebnis in Datei schreiben (CSV oder JSON)
    if (args.save && String(args.save).trim()) {
      const savePath = path.resolve(process.cwd(), String(args.save).trim());
      const ext = path.extname(savePath).toLowerCase();
      let content;
      if (ext === '.json') {
        const rows = matrix.map((row) =>
          Object.fromEntries(columns.map((col, i) => [col, Array.isArray(row) ? row[i] : row[col]]))
        );
        const json = createJsonOutput({ output: 'json' });
        content = json.stringify(rows) || JSON.stringify(rows, null, 2) + '\n';
      } else {
        content = renderCsv(columns, matrix);
      }
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
      fs.writeFileSync(savePath, content, 'utf8');
      if (output !== 'csv') {
        console.log(`Gespeichert: ${savePath} (${matrix.length} Zeile(n))`);
      }
      if (output === 'csv') {
        process.stdout.write(content);
        return;
      }
    }

    if (output === 'json') {
      const rows = matrix.map((row) =>
        Object.fromEntries(columns.map((col, i) => [col, Array.isArray(row) ? row[i] : row[col]]))
      );
      const json = createJsonOutput({ output: 'json' });
      json.print(rows);
      return;
    }

    if (output === 'csv') {
      process.stdout.write(renderCsv(columns, matrix));
      return;
    }

    if (defaultSchema) {
      console.log(`Default Schema: ${defaultSchema}`);
    }
    if (execution.libraryList && execution.libraryList.length > 0) {
      console.log(`Library List: ${execution.libraryList.join(', ')}`);
    }
    console.log(`SQL: ${sql}`);
    console.log('');

    if (matrix.length === 0) {
      console.log('0 row(s) returned');
      return;
    }

    console.log(renderAsciiTable(columns, matrix, { maxCellWidth: 40 }));
    console.log(`${matrix.length} row(s) returned`);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  DEFAULT_MAX_ROWS,
  normalizeOutput,
  parseMaxRows,
  runQuerySql,
  toRowMatrix,
};
