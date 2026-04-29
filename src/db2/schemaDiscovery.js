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
const { escapeSqlLiteral, runReadOnlyDb2Query, validateSqlIdentifier } = require('./readOnlyQueryService');

const PREFERRED_SCHEMAS = Object.freeze(['DATEIEN', 'PRODLIB', 'DATEN', 'PROD']);

function sortSchemaCandidates(rows) {
  return [...(rows || [])].sort((left, right) => {
    const leftSchema = String((left && left.TABLE_SCHEMA) || '').trim().toUpperCase();
    const rightSchema = String((right && right.TABLE_SCHEMA) || '').trim().toUpperCase();
    const leftPreferredIndex = PREFERRED_SCHEMAS.indexOf(leftSchema);
    const rightPreferredIndex = PREFERRED_SCHEMAS.indexOf(rightSchema);
    const leftRank = leftPreferredIndex === -1 ? Number.MAX_SAFE_INTEGER : leftPreferredIndex;
    const rightRank = rightPreferredIndex === -1 ? Number.MAX_SAFE_INTEGER : rightPreferredIndex;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return leftSchema.localeCompare(rightSchema);
  });
}

function discoverSchema(dbConfig, tableName, runtime = {}) {
  const table = validateSqlIdentifier(tableName, '--table');
  const result = runReadOnlyDb2Query({
    dbConfig,
    query: `SELECT TABLE_SCHEMA
FROM QSYS2.SYSTABLES
WHERE TABLE_NAME = ${escapeSqlLiteral(table)}
ORDER BY TABLE_SCHEMA`,
    maxRows: 20,
    runtime,
  });
  const sorted = sortSchemaCandidates(result.rows);
  return sorted[0] || null;
}

module.exports = {
  discoverSchema,
  PREFERRED_SCHEMAS,
  sortSchemaCandidates,
};
