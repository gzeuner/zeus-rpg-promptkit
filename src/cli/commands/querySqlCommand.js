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
const { splitSqlStatements } = require('../../db2/sqlBatch');
const { createJsonOutput } = require('../helpers/jsonOutput');
const readline = require('readline');

async function runQuerySql(args) {
  const watchSec = args.watch ? parseInt(String(args.watch), 10) : 0;

  // REPL / interactive mode (new for Phase 2)
  const isRepl = !args.sql && !args.file && (args.repl || args.interactive || args.i);
  if (isRepl) {
    await runInteractiveRepl(args);
    return;
  }

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

async function runBatchFromFile(args) {
  const filePath = path.resolve(process.cwd(), String(args.file).trim());
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`Cannot read SQL file: ${filePath} — ${err.message}`);
    process.exit(2);
  }

  const statements = splitSqlStatements(content);
  if (statements.length === 0) {
    console.error('No executable SQL statements found in file.');
    process.exit(2);
  }

  await runSingleQuery(args);
}

function rowsToObjects(columns, matrix) {
  return matrix.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, Array.isArray(row) ? row[i] : row[col]]))
  );
}

function renderQueryExecution(execution, output) {
  if (execution.batch) {
    const statements = execution.statements || [];
    if (output === 'json') {
      const json = createJsonOutput({ output: 'json' });
      json.print(statements.map((entry, index) => {
        const columns = Array.isArray(entry.columns) ? entry.columns : [];
        const matrix = toRowMatrix(columns, entry.rows || []);
        return {
          index: index + 1,
          sql: entry.sql,
          rowCount: Number(entry.rowCount || matrix.length || 0),
          columns,
          rows: rowsToObjects(columns, matrix),
        };
      }));
      return;
    }

    if (output === 'csv') {
      statements.forEach((entry, index) => {
        const columns = Array.isArray(entry.columns) ? entry.columns : [];
        const matrix = toRowMatrix(columns, entry.rows || []);
        process.stdout.write(`# statement ${index + 1}: ${entry.sql}\n`);
        process.stdout.write(renderCsv(columns, matrix));
        if (!String(renderCsv(columns, matrix)).endsWith('\n')) {
          process.stdout.write('\n');
        }
      });
      return;
    }

    if (execution.defaultSchema) {
      console.log(`Default Schema: ${execution.defaultSchema}`);
    }
    if (execution.libraryList && execution.libraryList.length > 0) {
      console.log(`Library List: ${execution.libraryList.join(', ')}`);
    }
    console.log(`[batch] ${statements.length} statement(s)`);
    statements.forEach((entry, index) => {
      const columns = Array.isArray(entry.columns) ? entry.columns : [];
      const matrix = toRowMatrix(columns, entry.rows || []);
      console.log('');
      console.log(`-- [${index + 1}/${statements.length}]`);
      console.log(`SQL: ${entry.sql}`);
      console.log('');
      if (matrix.length === 0) {
        console.log('0 row(s) returned');
      } else {
        console.log(renderAsciiTable(columns, matrix, { maxCellWidth: 40 }));
        console.log(`${matrix.length} row(s) returned`);
      }
    });
    return;
  }

  const { sql, defaultSchema, columns, matrix } = execution;
  if (output === 'json') {
    const json = createJsonOutput({ output: 'json' });
    json.print(rowsToObjects(columns, matrix));
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

    // --save: Ergebnis in Datei schreiben (CSV oder JSON)
    if (args.save && String(args.save).trim()) {
      const savePath = path.resolve(process.cwd(), String(args.save).trim());
      const ext = path.extname(savePath).toLowerCase();
      let content;
      if (ext === '.json') {
        const json = createJsonOutput({ output: 'json' });
        if (execution.batch) {
          const payload = (execution.statements || []).map((entry, index) => {
            const columns = Array.isArray(entry.columns) ? entry.columns : [];
            const matrix = toRowMatrix(columns, entry.rows || []);
            return {
              index: index + 1,
              sql: entry.sql,
              rowCount: Number(entry.rowCount || matrix.length || 0),
              columns,
              rows: rowsToObjects(columns, matrix),
            };
          });
          content = json.stringify(payload) || JSON.stringify(payload, null, 2) + '\n';
        } else {
          const rows = rowsToObjects(execution.columns, execution.matrix);
          content = json.stringify(rows) || JSON.stringify(rows, null, 2) + '\n';
        }
      } else {
        if (execution.batch) {
          content = (execution.statements || []).map((entry, index) => {
            const columns = Array.isArray(entry.columns) ? entry.columns : [];
            const matrix = toRowMatrix(columns, entry.rows || []);
            return `# statement ${index + 1}: ${entry.sql}\n${renderCsv(columns, matrix)}`;
          }).join('\n');
        } else {
          content = renderCsv(execution.columns, execution.matrix);
        }
      }
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
      fs.writeFileSync(savePath, content, 'utf8');
      if (output !== 'csv') {
        const rowCount = execution.batch
          ? (execution.statements || []).reduce((sum, entry) => sum + Number(entry.rowCount || (entry.rows || []).length || 0), 0)
          : execution.matrix.length;
        console.log(`Gespeichert: ${savePath} (${rowCount} Zeile(n))`);
      }
      if (output === 'csv') {
        process.stdout.write(content);
        return;
      }
    }

    renderQueryExecution(execution, output);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

/**
 * Simple interactive REPL for query-sql.
 * Holds the node process (and thus guard cache) across queries, so after the first
 * query only one JVM/connection per statement (no repeated probe).
 */
async function runInteractiveRepl(initialArgs) {
  console.log('Entering query-sql REPL. Type SQL (or .exit / .help). Profile and other options from initial call are reused.');
  console.log('First query will perform connection probe; subsequent queries within this session use cached guard.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'SQL> ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    if (['.exit', '.quit', 'exit', 'quit'].includes(trimmed.toLowerCase())) {
      console.log('Exiting REPL.');
      rl.close();
      return;
    }
    if (['.help', 'help'].includes(trimmed.toLowerCase())) {
      console.log('Enter a read-only SQL statement and press Enter. .exit to quit.');
      rl.prompt();
      return;
    }

    const replArgs = { ...initialArgs, sql: trimmed, file: undefined, watch: undefined };

    try {
      await runSingleQuery(replArgs);
    } catch (err) {
      console.error('Error:', err.message);
    }
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('REPL closed.');
    process.exit(0);
  });
}

module.exports = {
  DEFAULT_MAX_ROWS,
  normalizeOutput,
  parseMaxRows,
  runQuerySql,
  splitSqlStatements,
  toRowMatrix,
};
