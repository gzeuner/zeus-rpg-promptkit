'use strict';

const { renderAsciiTable } = require('../helpers/asciiTable');
const { renderCsv } = require('../helpers/csvRenderer');
const { createJsonOutput } = require('../helpers/jsonOutput');
const { executeDescribeJdbcTable, normalizeOutput } = require('../../core/queryService');

const COLUMN_HEADERS = [
  'COLUMN_NAME',
  'DATA_TYPE',
  'CHARACTER_MAXIMUM_LENGTH',
  'NUMERIC_PRECISION',
  'NUMERIC_SCALE',
  'IS_NULLABLE',
  'ORDINAL_POSITION',
];

function toColumnMatrix(rows) {
  return (rows || []).map(row => COLUMN_HEADERS.map(column => row && row[column]));
}

async function runDescribeTable(args) {
  const output = normalizeOutput(args.output);
  const execution = executeDescribeJdbcTable(args);
  const columnRows = execution.columns.rows || [];
  const json = createJsonOutput(args);

  if (json.isJsonMode) {
    json.print(execution);
    return;
  }
  if (output === 'csv') {
    process.stdout.write(renderCsv(COLUMN_HEADERS, toColumnMatrix(columnRows)));
    return;
  }

  console.log(`Table: ${execution.schema}.${execution.table}`);
  console.log(`Connection: ${execution.connection}`);
  if (execution.includeRowCount) {
    console.log(
      `Row count: ${execution.tableRowCount === null ? 'not available' : execution.tableRowCount}`
    );
  }
  console.log('');
  if (columnRows.length === 0) {
    console.log('No matching column metadata found in INFORMATION_SCHEMA.COLUMNS.');
    return;
  }
  console.log(renderAsciiTable(COLUMN_HEADERS, toColumnMatrix(columnRows), { maxCellWidth: 40 }));
}

module.exports = {
  COLUMN_HEADERS,
  runDescribeTable,
  toColumnMatrix,
};
