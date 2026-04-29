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
const {
  escapeSqlLiteral,
  runReadOnlyDb2Query,
  validateSqlIdentifier,
} = require('./readOnlyQueryService');

const COLUMN_ALIASES = Object.freeze({
  WERBEJAHR: ['WERBEJAHR', 'PJAHR', 'XJAHR', 'WERBJAHR'],
  WERBENUMMER: ['WERBENUMMER', 'PWERBNR', 'XWERBNR', 'WERBNR'],
  DAN: ['INTERNE_ARTIKEL_DAN', 'PDAN', 'XDAN', 'ARTIKEL_DAN', 'DAN'],
  VKST: ['VERKAUFSSTELLE_ID', 'PVKST', 'VERKAUFSSTELLE', 'VKST_NR'],
  PREIS: ['WERBE_VERKAUFSPREIS', 'PWPREIS', 'PREIS_ERFASST', 'VKP'],
  TIMESTAMP: ['ZEITPUNKT_AENDERUNG', 'XTIMESTMP', 'LETZTEAENDERUNG'],
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
