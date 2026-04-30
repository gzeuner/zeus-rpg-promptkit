/*
Copyright 2026 Guido Zeuner

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
const {
  DEFAULT_MAX_ROWS,
  executeQuerySql,
  normalizeOutput,
  parseMaxRows,
  toRowMatrix,
} = require('../../core/queryService');

async function runQuerySql(args) {
  let execution;
  try {
    execution = executeQuerySql(args);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const { sql, output, columns, matrix } = execution;

  if (output === 'csv') {
    process.stdout.write(renderCsv(columns, matrix));
    return;
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

module.exports = {
  DEFAULT_MAX_ROWS,
  normalizeOutput,
  parseMaxRows,
  runQuerySql,
  toRowMatrix,
};
