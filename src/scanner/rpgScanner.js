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
const fs = require('fs');

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isCommentLine(rawLine) {
  if (!rawLine) return true;
  if (rawLine.length >= 7 && rawLine[6] === '*') {
    return true;
  }

  const trimmed = rawLine.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('*')) return true;
  if (trimmed.startsWith('//')) return true;
  return false;
}

function normalizeName(name) {
  return String(name || '').trim().toUpperCase();
}

function normalizeTableName(rawName) {
  const cleaned = String(rawName || '').trim().replace(/^"(.*)"$/, '$1').replace(/\//g, '.');
  if (!cleaned) return '';
  const segments = cleaned.split('.').filter(Boolean);
  const table = segments.length > 0 ? segments[segments.length - 1] : cleaned;
  return normalizeName(table);
}

function addEntity(map, name, payload) {
  const normalized = normalizeName(name);
  if (!normalized) return;

  if (!map.has(normalized)) {
    map.set(normalized, {
      ...payload,
      name: normalized,
      evidence: [],
    });
  }

  const entity = map.get(normalized);
  const evidenceKey = JSON.stringify(payload.evidence);
  const hasEvidence = entity.evidence.some((item) => JSON.stringify(item) === evidenceKey);
  if (!hasEvidence) {
    entity.evidence.push(payload.evidence);
  }
}

function detectSqlType(sqlText) {
  const normalized = normalizeWhitespace(sqlText).toUpperCase();
  if (/\bSELECT\b/.test(normalized)) return 'SELECT';
  if (/\bINSERT\b/.test(normalized)) return 'INSERT';
  if (/\bUPDATE\b/.test(normalized)) return 'UPDATE';
  if (/\bDELETE\b/.test(normalized)) return 'DELETE';
  if (/\bMERGE\b/.test(normalized)) return 'MERGE';
  return 'OTHER';
}

function extractSqlTables(sqlText) {
  const tables = new Set();
  const regex = /\b(?:FROM|JOIN|UPDATE|INTO|MERGE\s+INTO)\s+("[^"]+"|[A-Z0-9_#$@./]+)/gi;
  let match = regex.exec(sqlText);

  while (match) {
    const normalized = normalizeTableName(match[1]);
    if (normalized) {
      tables.add(normalized);
    }
    match = regex.exec(sqlText);
  }

  return Array.from(tables).sort();
}

function scanContent(filePath, content) {
  const lines = content.split(/\r?\n/);
  const tablesMap = new Map();
  const callsMap = new Map();
  const copyMembersMap = new Map();
  const sqlStatements = [];

  let inExecSql = false;
  let execStartLine = 0;
  let execBuffer = [];

  const finalizeExecSql = (endLine) => {
    if (execBuffer.length === 0) return;

    const sqlText = normalizeWhitespace(execBuffer.join(' '));
    const tables = extractSqlTables(sqlText);
    sqlStatements.push({
      type: detectSqlType(sqlText),
      text: sqlText,
      tables,
      evidence: [
        {
          file: filePath,
          startLine: execStartLine,
          endLine,
        },
      ],
    });

    for (const tableName of tables) {
      addEntity(tablesMap, tableName, {
        kind: 'SQL',
        evidence: { file: filePath, line: execStartLine, text: sqlText },
      });
    }

    execBuffer = [];
    inExecSql = false;
    execStartLine = 0;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const lineNo = i + 1;

    if (isCommentLine(rawLine)) {
      continue;
    }

    const trimmed = rawLine.trim();

    const dclFMatch = rawLine.match(/^\s*dcl-f\s+([A-Z0-9_#$@]+)/i);
    if (dclFMatch) {
      const upperLine = rawLine.toUpperCase();
      let kind = 'FILE';
      if (upperLine.includes('WORKSTN')) kind = 'WORKSTN';
      if (upperLine.includes('PRINTER')) kind = 'PRINTER';
      if (upperLine.includes('DISK')) kind = 'DISK';
      addEntity(tablesMap, dclFMatch[1], {
        kind,
        evidence: { file: filePath, line: lineNo, text: trimmed },
      });
    }

    const fixedFSpecMatch = rawLine.match(/^\s*F[A-Z0-9_#$@]/i);
    if (fixedFSpecMatch) {
      const trimmedUpper = trimmed.toUpperCase();
      if (!trimmedUpper.startsWith('FROM ')) {
        const tokenMatch = rawLine.match(/^\s*F([A-Z0-9_#$@]+)/i);
        const fIndex = rawLine.search(/F/i);
        const fixedColName = fIndex >= 0 ? rawLine.slice(fIndex + 1, fIndex + 11).replace(/\s+/g, '') : '';
        const tableName = ((tokenMatch ? tokenMatch[1] : '') || fixedColName).trim();
        if (tableName) {
          const upperLine = rawLine.toUpperCase();
          let kind = 'FILE';
          if (upperLine.includes('WORKSTN')) kind = 'WORKSTN';
          if (upperLine.includes('PRINTER')) kind = 'PRINTER';
          if (upperLine.includes('DISK')) kind = 'DISK';
          addEntity(tablesMap, tableName, {
            kind,
            evidence: { file: filePath, line: lineNo, text: trimmed },
          });
        }
      }
    }

    const copyMatch = rawLine.match(/^\s*\/(?:COPY|INCLUDE)\s+(.+)$/i) || rawLine.match(/^\s*COPY\s+(.+)$/i);
    if (copyMatch) {
      const copyName = normalizeName(copyMatch[1].replace(/["']/g, '').trim());
      if (copyName) {
        addEntity(copyMembersMap, copyName, {
          evidence: { file: filePath, line: lineNo, text: trimmed },
        });
      }
    }

    const callPatterns = [
      { regex: /\bCALL\s+PGM\s*\(\s*['"]?([A-Z0-9_#$@./]+)['"]?\s*\)/i, kind: 'PROGRAM' },
      { regex: /\bCALL\s+['"]([A-Z0-9_#$@]+)['"]/i, kind: 'PROGRAM' },
      { regex: /\bCALL\s+(?!PGM\b)([A-Z0-9_#$@]+)\b/i, kind: 'PROGRAM' },
      { regex: /\bCALLP\s*\(\s*['"]([A-Z0-9_#$@]+)['"]\s*\)/i, kind: 'PROCEDURE' },
      { regex: /\bCALLP\s+([A-Z0-9_#$@]+)\b/i, kind: 'PROCEDURE' },
      { regex: /\bCALLPRC\s*\(\s*['"]([A-Z0-9_#$@]+)['"]\s*\)/i, kind: 'PROCEDURE' },
      { regex: /\bCALLPRC\s*\(\s*([A-Z0-9_#$@]+)\s*\)/i, kind: 'PROCEDURE' },
      { regex: /\bCALLB\s+['"]?([A-Z0-9_#$@]+)['"]?/i, kind: 'PROCEDURE' },
    ];

    for (const pattern of callPatterns) {
      const match = rawLine.match(pattern.regex);
      if (match) {
        addEntity(callsMap, match[1], {
          kind: pattern.kind,
          evidence: { file: filePath, line: lineNo, text: trimmed },
        });
      }
    }

    if (/\bCALLP\s*\(/i.test(rawLine) && !/\bCALLP\s*\(\s*['"][A-Z0-9_#$@]+['"]\s*\)/i.test(rawLine)) {
      addEntity(callsMap, '<DYNAMIC>', {
        kind: 'DYNAMIC',
        evidence: { file: filePath, line: lineNo, text: trimmed },
      });
    }

    const execSqlMatch = rawLine.match(/\bEXEC\s+SQL\b/i);
    if (execSqlMatch) {
      if (inExecSql) {
        finalizeExecSql(lineNo - 1);
      }

      inExecSql = true;
      execStartLine = lineNo;
      const sqlPart = rawLine.slice(execSqlMatch.index);
      execBuffer.push(sqlPart.trim());
      if (rawLine.includes(';')) {
        finalizeExecSql(lineNo);
      }
      continue;
    }

    if (inExecSql) {
      execBuffer.push(trimmed);
      if (rawLine.includes(';')) {
        finalizeExecSql(lineNo);
      }
      continue;
    }

    if (/\b(SELECT|INSERT|UPDATE|DELETE|MERGE|WITH)\b/i.test(rawLine)) {
      const sqlText = normalizeWhitespace(trimmed);
      const tables = extractSqlTables(sqlText);
      sqlStatements.push({
        type: detectSqlType(sqlText),
        text: sqlText,
        tables,
        evidence: [
          {
            file: filePath,
            startLine: lineNo,
            endLine: lineNo,
          },
        ],
      });

      for (const tableName of tables) {
        addEntity(tablesMap, tableName, {
          kind: 'SQL',
          evidence: { file: filePath, line: lineNo, text: sqlText },
        });
      }
    }
  }

  if (inExecSql) {
    finalizeExecSql(lines.length);
  }

  return {
    sourceFile: {
      path: filePath,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      lines: lines.length,
    },
    tables: Array.from(tablesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    calls: Array.from(callsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    copyMembers: Array.from(copyMembersMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    sqlStatements,
    notes: [],
  };
}

function scanRpgFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return scanContent(filePath, content);
}

function mergeEntities(targetMap, entities, withKind) {
  for (const entity of entities) {
    const key = normalizeName(entity.name);
    if (!targetMap.has(key)) {
      const base = {
        name: key,
        evidence: [],
      };
      if (withKind) {
        base.kind = entity.kind || withKind;
      }
      targetMap.set(key, base);
    }

    const target = targetMap.get(key);
    if (withKind && !target.kind && entity.kind) {
      target.kind = entity.kind;
    }

    for (const evidence of entity.evidence || []) {
      const evidenceKey = JSON.stringify(evidence);
      const exists = target.evidence.some((item) => JSON.stringify(item) === evidenceKey);
      if (!exists) {
        target.evidence.push(evidence);
      }
    }
  }
}

function mergeSqlStatements(scanResults) {
  const map = new Map();
  for (const result of scanResults) {
    for (const sql of result.sqlStatements || []) {
      const key = `${sql.type}|${sql.text.toUpperCase()}`;
      if (!map.has(key)) {
        map.set(key, {
          type: sql.type,
          text: sql.text,
          tables: Array.from(new Set(sql.tables || [])).sort(),
          evidence: [],
        });
      }

      const item = map.get(key);
      item.tables = Array.from(new Set([...(item.tables || []), ...(sql.tables || [])])).sort();

      for (const evidence of sql.evidence || []) {
        const evidenceKey = JSON.stringify(evidence);
        const exists = item.evidence.some((entry) => JSON.stringify(entry) === evidenceKey);
        if (!exists) {
          item.evidence.push(evidence);
        }
      }
    }
  }
  return Array.from(map.values());
}

function scanSourceFiles(filePaths, options = {}) {
  const scanResults = [];
  const notes = [];
  const scanCache = options && options.scanCache ? options.scanCache : null;

  for (const filePath of filePaths || []) {
    try {
      const result = scanCache && typeof scanCache.getOrScan === 'function'
        ? scanCache.getOrScan(filePath, scanRpgFile)
        : scanRpgFile(filePath);
      scanResults.push(result);
    } catch (error) {
      notes.push(`Skipped file ${filePath}: ${error.message}`);
    }
  }

  const sourceFiles = [];
  for (const result of scanResults) {
    sourceFiles.push(result.sourceFile);
  }

  const tablesMap = new Map();
  const callsMap = new Map();
  const copyMembersMap = new Map();
  mergeEntities(tablesMap, scanResults.flatMap((item) => item.tables || []), 'FILE');
  mergeEntities(callsMap, scanResults.flatMap((item) => item.calls || []), 'PROGRAM');
  mergeEntities(copyMembersMap, scanResults.flatMap((item) => item.copyMembers || []));

  return {
    sourceFiles,
    tables: Array.from(tablesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    calls: Array.from(callsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    copyMembers: Array.from(copyMembersMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    sqlStatements: mergeSqlStatements(scanResults),
    notes,
  };
}

module.exports = {
  scanRpgFile,
  scanSourceFiles,
};
