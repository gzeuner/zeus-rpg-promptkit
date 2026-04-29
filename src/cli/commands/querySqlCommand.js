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
const { resolveAnalyzeConfig } = require('../../config/runtimeConfig');
const { isDbConfigured } = require('../../db2/db2Config');
const { runReadOnlyDb2Query, validateReadOnlySql } = require('../../db2/readOnlyQueryService');
const { renderAsciiTable } = require('../helpers/asciiTable');
const { renderCsv } = require('../helpers/csvRenderer');

const DEFAULT_MAX_ROWS = 200;

function parseMaxRows(value) {
  if (value === undefined || value === null || value === true) {
    return DEFAULT_MAX_ROWS;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Invalid option: --max-rows must be a positive integer');
  }
  return parsed;
}

function normalizeOutput(value) {
  const normalized = String(value || 'table').trim().toLowerCase();
  if (normalized === 'table' || normalized === 'csv') {
    return normalized;
  }
  throw new Error('Invalid option: --output must be one of: table, csv');
}

function toRowMatrix(columns, rows) {
  return (rows || []).map((row) => (columns || []).map((column) => row && typeof row === 'object' ? row[column] : ''));
}

async function runQuerySql(args) {
  if (!args.profile || !String(args.profile).trim()) {
    console.error('Missing required option: --profile <name>');
    process.exit(2);
  }
  if (!args.sql || !String(args.sql).trim()) {
    console.error('Missing required option: --sql "SELECT ..."');
    process.exit(2);
  }

  const sql = String(args.sql).trim();
  const maxRows = parseMaxRows(args['max-rows']);
  const output = normalizeOutput(args.output);
  const config = resolveAnalyzeConfig(args);

  if (!isDbConfigured(config.db)) {
    console.error('DB2 connection configuration is incomplete for the selected profile.');
    process.exit(2);
  }

  validateReadOnlySql(sql);
  const result = runReadOnlyDb2Query({
    dbConfig: config.db,
    query: sql,
    maxRows,
  });
  const columns = Array.isArray(result.columns) ? result.columns : [];
  const matrix = toRowMatrix(columns, result.rows);

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
