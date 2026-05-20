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
const { renderAsciiTable } = require('../helpers/asciiTable');
const { renderCsv } = require('../helpers/csvRenderer');
const { resolveProfile, loadProfiles } = require('../../config/runtimeConfig');
const {
  DEFAULT_MAX_ROWS,
  executeQuerySql,
  normalizeOutput,
  parseMaxRows,
  toRowMatrix,
} = require('../../core/queryService');

async function runQuerySql(args) {
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

    const execution = executeQuerySql(args);

    const { sql, defaultSchema, columns, matrix } = execution;

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
