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
function normalizeName(name) {
  return String(name || '').trim().toUpperCase();
}

function mergeEntityList(scanResults, key, includeKindDefault) {
  const map = new Map();

  for (const result of scanResults || []) {
    for (const item of result[key] || []) {
      const normalized = normalizeName(item.name || item);
      if (!normalized) continue;

      if (!map.has(normalized)) {
        const base = {
          name: normalized,
          evidence: [],
        };
        if (item.kind || includeKindDefault) {
          base.kind = item.kind || includeKindDefault;
        }
        map.set(normalized, base);
      }

      const target = map.get(normalized);
      if (!target.kind && item.kind) {
        target.kind = item.kind;
      }

      const evidenceList = item.evidence || [];
      for (const evidence of evidenceList) {
        const serialized = JSON.stringify(evidence);
        const exists = target.evidence.some((entry) => JSON.stringify(entry) === serialized);
        if (!exists) {
          target.evidence.push(evidence);
        }
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function mergeSqlStatements(scanResults) {
  const map = new Map();

  for (const result of scanResults || []) {
    for (const sql of result.sqlStatements || []) {
      const key = `${sql.type || 'OTHER'}|${String(sql.text || '').toUpperCase()}`;
      if (!map.has(key)) {
        map.set(key, {
          type: sql.type || 'OTHER',
          text: sql.text || '',
          tables: Array.from(new Set((sql.tables || []).map((name) => normalizeName(name)))).sort(),
          evidence: [],
        });
      }

      const target = map.get(key);
      target.tables = Array.from(new Set([...(target.tables || []), ...((sql.tables || []).map((name) => normalizeName(name)))]))
        .filter(Boolean)
        .sort();

      for (const evidence of sql.evidence || []) {
        const serialized = JSON.stringify(evidence);
        const exists = target.evidence.some((entry) => JSON.stringify(entry) === serialized);
        if (!exists) {
          target.evidence.push(evidence);
        }
      }
    }
  }

  return Array.from(map.values());
}

function aggregateDependencies(scanResults) {
  const sourceFiles = [];
  const notes = [];

  for (const result of scanResults || []) {
    if (result.sourceFile) {
      sourceFiles.push(result.sourceFile);
    }
    for (const note of result.notes || []) {
      notes.push(note);
    }
  }

  return {
    sourceFiles,
    tables: mergeEntityList(scanResults, 'tables', 'FILE'),
    calls: mergeEntityList(scanResults, 'calls', 'PROGRAM'),
    copyMembers: mergeEntityList(scanResults, 'copyMembers'),
    sqlStatements: mergeSqlStatements(scanResults),
    notes,
  };
}

module.exports = {
  aggregateDependencies,
};
