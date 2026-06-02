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
const { resolveAnalyzeConfig, resolveAnalyzeDbConfig } = require('../../config/runtimeConfig');
const {
  buildQueryTableQueries,
  executeQueryTable,
  validateFilterPattern,
} = require('../../core/queryService');
const { printDbRuntimeConflictWarnings } = require('../helpers/runtimeConfigWarnings');

async function runQueryTable(args) {
  let execution;
  try {
    const config = resolveAnalyzeConfig(args, { cwd: process.cwd(), env: process.env });
    printDbRuntimeConflictWarnings(resolveAnalyzeDbConfig(config, 'metadata'));
    execution = executeQueryTable(args);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const {
    table,
    schema: effectiveSchema,
    requestedSchema,
    tableInfo,
    columns,
  } = execution;

  console.log(`Table lookup: ${effectiveSchema ? `${effectiveSchema}.${table}` : table}`);
  if (!requestedSchema && effectiveSchema) {
    console.log(`Schema discovery: ${table} -> ${effectiveSchema}`);
  }
  console.log('');

  if ((tableInfo.rows || []).length === 0) {
    console.log('No matching table metadata found in QSYS2.SYSTABLES.');
  } else {
    console.log('Table Info');
    console.log(renderAsciiTable(
      ['TABLE_SCHEMA', 'TABLE_NAME'],
      tableInfo.rows.map((row) => [row.TABLE_SCHEMA, row.TABLE_NAME]),
    ));
  }

  if ((columns.rows || []).length === 0) {
    console.log('No matching column metadata found in QSYS2.SYSCOLUMNS.');
    return;
  }

  console.log('Columns');
  const COLUMN_HEADERS = ['TABLE_SCHEMA', 'TABLE_NAME', 'COLUMN_NAME', 'DATA_TYPE', 'LENGTH', 'NUMERIC_SCALE', 'IS_NULLABLE'];
  const columnRows = columns.rows.map((row) => [
    row.TABLE_SCHEMA,
    row.TABLE_NAME,
    row.COLUMN_NAME,
    row.DATA_TYPE,
    row.LENGTH,
    row.NUMERIC_SCALE,
    row.IS_NULLABLE,
  ]);

  // --save: Ergebnis in Datei schreiben (CSV oder JSON)
  if (args.save && String(args.save).trim()) {
    const savePath = path.resolve(process.cwd(), String(args.save).trim());
    const ext = path.extname(savePath).toLowerCase();
    let content;
    if (ext === '.json') {
      const rows = columnRows.map((row) => Object.fromEntries(COLUMN_HEADERS.map((h, i) => [h, row[i]])));
      content = JSON.stringify(rows, null, 2) + '\n';
    } else {
      content = renderCsv(COLUMN_HEADERS, columnRows);
    }
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, content, 'utf8');
    console.log(`Gespeichert: ${savePath} (${columnRows.length} Spalte(n))`);
  }

  console.log(renderAsciiTable(
    COLUMN_HEADERS,
    columnRows,
    { maxCellWidth: 40 },
  ));
}

module.exports = {
  buildQueryTableQueries,
  runQueryTable,
  validateFilterPattern,
};
