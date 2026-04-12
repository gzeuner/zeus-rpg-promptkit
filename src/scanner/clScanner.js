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
const path = require('path');

function normalizeName(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeObjectName(value) {
  const normalized = normalizeName(value).replace(/^['"]|['"]$/g, '');
  if (!normalized) {
    return '';
  }
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function isCommentLine(rawLine) {
  const trimmed = String(rawLine || '').trim();
  return !trimmed || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//');
}

function commandFromLine(rawLine) {
  const trimmed = String(rawLine || '').trim();
  const match = trimmed.match(/^([A-Z][A-Z0-9_#$@]*)\b/i);
  return match ? normalizeName(match[1]) : '';
}

function extractKeywordValues(rawLine, keyword) {
  const values = [];
  const regex = new RegExp(`${keyword}\\(([^)]+)\\)`, 'ig');
  let match = regex.exec(rawLine);
  while (match) {
    const normalized = normalizeObjectName(match[1]);
    if (normalized) {
      values.push(normalized);
    }
    match = regex.exec(rawLine);
  }
  return values;
}

function uniqueByName(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = item && item.name ? normalizeName(item.name) : '';
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        ...item,
        name: key,
        evidence: [],
      });
    }
    const target = map.get(key);
    for (const evidence of item.evidence || []) {
      const exists = target.evidence.some((entry) => JSON.stringify(entry) === JSON.stringify(evidence));
      if (!exists) {
        target.evidence.push(evidence);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function scanClContent(filePath, content, sourceType = '') {
  const lines = String(content || '').split('\n');
  const ownerProgram = normalizeName(path.basename(String(filePath || ''), path.extname(String(filePath || ''))));
  const commands = [];
  const objectUsages = [];
  const calls = [];
  const tables = [];
  const nativeFiles = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (isCommentLine(rawLine)) {
      continue;
    }

    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    const command = commandFromLine(trimmed);
    if (!command) {
      continue;
    }

    const evidence = [{
      file: filePath,
      line: lineNumber,
      text: trimmed,
    }];

    commands.push({
      name: command,
      command,
      text: trimmed,
      evidence,
    });

    const callTargets = extractKeywordValues(trimmed, 'PGM');
    if (command === 'CALL') {
      for (const calledProgram of callTargets) {
        calls.push({
          name: calledProgram,
          kind: 'PROGRAM',
          evidence,
        });
      }
    }

    const fileKeywords = [
      { keyword: 'FILE', objectType: 'FILE' },
      { keyword: 'TOFILE', objectType: 'FILE' },
      { keyword: 'FROMFILE', objectType: 'FILE' },
    ];
    for (const fileKeyword of fileKeywords) {
      for (const fileName of extractKeywordValues(trimmed, fileKeyword.keyword)) {
        objectUsages.push({
          name: fileName,
          objectType: fileKeyword.objectType,
          command,
          evidence,
        });
        tables.push({
          name: fileName,
          kind: 'CL_FILE',
          evidence,
        });
        nativeFiles.push({
          name: fileName,
          kind: 'FILE',
          declaredAccess: ['READ'],
          keyed: false,
          evidence,
        });
      }
    }

    const otherObjectKeywords = ['MSGF', 'DTAARA', 'OUTQ', 'JOBQ'];
    for (const keyword of otherObjectKeywords) {
      for (const objectName of extractKeywordValues(trimmed, keyword)) {
        objectUsages.push({
          name: objectName,
          objectType: keyword,
          command,
          evidence,
        });
      }
    }
  }

  return {
    sourceFile: {
      path: filePath,
      sizeBytes: Buffer.byteLength(String(content || ''), 'utf8'),
      lines: lines.length,
      sourceType: normalizeName(sourceType) || 'CL',
    },
    tables: uniqueByName(tables),
    calls: uniqueByName(calls),
    copyMembers: [],
    sqlStatements: [],
    procedures: [],
    prototypes: [],
    procedureCalls: [],
    nativeFiles: uniqueByName(nativeFiles),
    nativeFileAccesses: [],
    modules: [],
    bindingDirectories: [],
    servicePrograms: [],
    diagnostics: [],
    notes: [],
    commands: uniqueByName(commands),
    objectUsages: uniqueByName(objectUsages),
    ddsFiles: [],
    sourceTypeAnalysis: {
      ownerProgram,
      sourceType: normalizeName(sourceType) || 'CL',
    },
  };
}

function scanClFile(filePath, options = {}) {
  const content = options.content !== undefined ? String(options.content) : fs.readFileSync(filePath, 'utf8');
  return scanClContent(filePath, content, options.sourceType || '');
}

module.exports = {
  scanClContent,
  scanClFile,
};
