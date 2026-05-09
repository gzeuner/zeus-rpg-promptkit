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
const { renderAsciiTable } = require('../helpers/asciiTable');
const {
  buildQueryTableQueries,
  executeQueryTable,
  validateFilterPattern,
} = require('../../core/queryService');

async function runQueryTable(args) {
  let execution;
  try {
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
  console.log(renderAsciiTable(
    ['TABLE_SCHEMA', 'TABLE_NAME', 'COLUMN_NAME', 'DATA_TYPE', 'LENGTH', 'NUMERIC_SCALE', 'IS_NULLABLE'],
    columns.rows.map((row) => [
      row.TABLE_SCHEMA,
      row.TABLE_NAME,
      row.COLUMN_NAME,
      row.DATA_TYPE,
      row.LENGTH,
      row.NUMERIC_SCALE,
      row.IS_NULLABLE,
    ]),
    { maxCellWidth: 40 },
  ));
}

module.exports = {
  buildQueryTableQueries,
  runQueryTable,
  validateFilterPattern,
};
