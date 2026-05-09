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
const {
  escapeSqlLiteral,
  runReadOnlyDb2Query,
  validateSqlIdentifier,
} = require('./readOnlyQueryService');

const COLUMN_ALIASES = Object.freeze({
  APP_YEAR: ['APP_YEAR', 'P_YEAR', 'X_YEAR', 'APP_YEAR_ALT'],
  APP_NUMBER: ['APP_NUMBER', 'P_NUMBER', 'X_NUMBER', 'APP_NR'],
  DAN: ['INTERNAL_ITEM_ID', 'P_ITEM_ID', 'X_ITEM_ID', 'ITEM_ID', 'DAN'],
  VKST: ['LOCATION_ID', 'P_LOCATION', 'LOCATION', 'LOCATION_NR'],
  PREIS: ['APP_SALE_PRICE', 'P_PRICE', 'RECORDED_PRICE', 'SALE_PRICE'],
  TIMESTAMP: ['CHANGE_TIMESTAMP', 'X_TIMESTAMP', 'LAST_CHANGE'],
});

function getActualColumns(dbConfig, schema, table, runtime = {}) {
  const resolvedSchema = validateSqlIdentifier(schema, '--schema');
  const resolvedTable = validateSqlIdentifier(table, '--table');
  const result = runReadOnlyDb2Query({
    dbConfig,
    query: `SELECT COLUMN_NAME
FROM QSYS2.SYSCOLUMNS
WHERE TABLE_SCHEMA = ${escapeSqlLiteral(resolvedSchema)}
  AND TABLE_NAME = ${escapeSqlLiteral(resolvedTable)}
ORDER BY ORDINAL_POSITION`,
    maxRows: 500,
    runtime,
  });
  return (result.rows || [])
    .map((row) => String((row && row.COLUMN_NAME) || '').trim().toUpperCase())
    .filter(Boolean);
}

function resolveColumn(dbConfig, schema, table, logicalName, runtime = {}) {
  const candidates = COLUMN_ALIASES[String(logicalName || '').trim().toUpperCase()] || [String(logicalName || '').trim().toUpperCase()];
  const actualColumns = getActualColumns(dbConfig, schema, table, runtime);
  return candidates.find((candidate) => actualColumns.some((column) => column === String(candidate).trim().toUpperCase())) || null;
}

module.exports = {
  COLUMN_ALIASES,
  getActualColumns,
  resolveColumn,
};
